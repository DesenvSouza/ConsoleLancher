import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTauri } from "../lib/api";
import { MIN_SPEED, SpeedMeter, buildQueue, isInQueue, manifestDone, remainingBytes, withEstimates, type QueueItem } from "../lib/downloads";
import { steam, type DiskInfo } from "../lib/steam";
import { useLibrary } from "./library";

/** Segundos entre o fim dos downloads e o desligamento: dá tempo de cancelar. */
export const SHUTDOWN_DELAY_SEC = 60;
/** A fila precisa ficar vazia por este tempo antes de contar como concluída (a Steam passa de um jogo ao outro em instantes). */
const EMPTY_BEFORE_DONE_MS = 15_000;

interface DownloadsState {
  items: QueueItem[];
  /** Velocidade medida (bytes/s). */
  speed: number;
  remaining: number;
  etaSec: number | null;
  finishAt: number | null;
  disks: DiskInfo[];

  /** Desligar o PC quando a fila de downloads acabar. */
  shutdownArmed: boolean;
  /** Já houve algum download desde que o desligamento foi programado (programar com a fila vazia não desliga nada). */
  sawDownload: boolean;
  /** Instante em que o PC será desligado, quando a contagem final está rolando. */
  countdownEndsAt: number | null;

  setShutdownArmed: (armed: boolean) => void;
  cancelShutdown: () => Promise<void>;
  shutdownNow: () => Promise<void>;
  refreshDisks: () => Promise<void>;
}

export const useDownloads = create<DownloadsState>()(
  persist(
    (set, get) => ({
      items: [],
      speed: 0,
      remaining: 0,
      etaSec: null,
      finishAt: null,
      disks: [],
      shutdownArmed: false,
      sawDownload: false,
      countdownEndsAt: null,

      setShutdownArmed: (shutdownArmed) => set({ shutdownArmed, sawDownload: shutdownArmed ? get().items.length > 0 : false }),

      cancelShutdown: async () => {
        set({ shutdownArmed: false, sawDownload: false, countdownEndsAt: null });
        if (isTauri) await steam.powerCancel().catch(() => {});
      },

      shutdownNow: async () => {
        set({ shutdownArmed: false, sawDownload: false, countdownEndsAt: null });
        if (!isTauri) return;
        await steam.powerCancel().catch(() => {});
        await steam.powerSchedule(0).catch(() => {});
      },

      refreshDisks: async () => {
        if (!isTauri) {
          set({ disks: MOCK_DISKS });
          return;
        }
        const paths = [...new Set(useLibrary.getState().installed.map((a) => a.libraryPath).filter(Boolean))];
        if (paths.length === 0) return;
        const disks = await steam.diskUsage(paths).catch(() => null);
        if (disks) set({ disks });
      },
    }),
    // Só o desligamento programado vale entre uma abertura e outra do launcher.
    { name: "launcher-downloads", version: 1, partialize: (s) => ({ shutdownArmed: s.shutdownArmed }) },
  ),
);

// ───────── Dados de mentira (navegador) ─────────

const GB = 1024 ** 3;
const MOCK_DISKS: DiskInfo[] = [{ path: "D:\\SteamLibrary", free: 212 * GB, total: 931 * GB }];

function mockQueue(): QueueItem[] {
  return [
    { appId: "1091500", title: "Cyberpunk 2077", state: "active", total: 70 * GB, done: 21 * GB, libraryPath: "D:\\SteamLibrary", etaSec: null, finishAt: null },
    { appId: "1245620", title: "Elden Ring", state: "queued", total: 52 * GB, done: 0, libraryPath: "D:\\SteamLibrary", etaSec: null, finishAt: null },
    { appId: "1086940", title: "Baldur's Gate 3", state: "queued", total: 122 * GB, done: 0, libraryPath: "D:\\SteamLibrary", etaSec: null, finishAt: null },
  ];
}

// ───────── Monitor ─────────

let started = false;

/**
 * Acompanha os downloads a cada segundo, mesmo com a página fechada: mede a velocidade, estima quando termina e,
 * se o jogador programou, desliga o PC depois que a fila inteira acabar. Chamar uma vez, na janela principal.
 */
export function startDownloadsMonitor() {
  if (started) return;
  started = true;

  const meter = new SpeedMeter();
  /** Para cada item ativo: o contador de gravação na primeira vez que o vimos e quanto já estava feito. */
  const bases: Record<string, { written: number; start: number }> = {};
  let mock = mockQueue();
  let emptySince: number | null = null;
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      let items: QueueItem[];
      let speed: number;

      if (isTauri) {
        const lib = useLibrary.getState();
        const titleOf = (id: string, fallback: string) => lib.games.find((g) => g.id === id)?.title ?? fallback;
        const inQueue = lib.installed.filter(isInQueue);
        // O manifesto nem sempre marca o item como "baixando" (a Steam demora a atualizá-lo): o contador de gravação
        // é quem diz se há download de verdade, então ele é lido sempre que houver algo na fila.
        const flagged = inQueue.filter((a) => (a.stateFlags & (256 | 512 | 1_048_576)) !== 0);
        const written = inQueue.length > 0 ? await steam.bytesWritten().catch(() => null) : null;

        const live: Record<string, number> = {};
        let forceActive: string | undefined;
        if (written !== null) {
          speed = meter.push(written, now);
          let active = flagged;
          if (active.length === 0 && speed >= MIN_SPEED) {
            // Há gravação, mas nenhum item marcado: é o que está mais adiantado (empate: o primeiro da lista).
            const lead = inQueue.reduce((best, a) => (manifestDone(a) > manifestDone(best) ? a : best), inQueue[0]);
            forceActive = lead.appId;
            active = [lead];
          }
          // O contador é do cliente inteiro: só dá para atribuí-lo a um item quando só há um baixando.
          if (active.length === 1) {
            const app = active[0];
            const total = app.bytesToStage || app.bytesToDownload;
            bases[app.appId] ??= { written, start: manifestDone(app) };
            // O mesmo progresso que a página do jogo mostra (a biblioteca também mede pelo contador), para os dois concordarem.
            const shown = (lib.liveProgress[app.appId] ?? 0) * total;
            live[app.appId] = Math.max(shown, bases[app.appId].start + (written - bases[app.appId].written));
          }
        } else {
          meter.reset();
          speed = 0;
        }
        for (const id of Object.keys(bases)) if (!inQueue.some((a) => a.appId === id)) delete bases[id];
        items = withEstimates(buildQueue(lib.installed, titleOf, live, forceActive), speed, now);
      } else {
        // Sem a Steam (navegador): uma fila de mentira que avança, para ver a página funcionando.
        speed = 24 * 1024 * 1024 * (0.85 + Math.random() * 0.3);
        if (mock.length > 0) {
          mock[0] = { ...mock[0], done: Math.min(mock[0].total, mock[0].done + speed) };
          if (mock[0].done >= mock[0].total) mock = mock.slice(1).map((m, i) => (i === 0 ? { ...m, state: "active" as const } : m));
        }
        items = withEstimates(mock, speed, now);
      }

      const remaining = remainingBytes(items);
      const last = items[items.length - 1];
      const state = useDownloads.getState();
      useDownloads.setState({
        items,
        speed,
        remaining,
        etaSec: last?.etaSec ?? null,
        finishAt: last?.finishAt ?? null,
        sawDownload: state.shutdownArmed && items.length > 0 ? true : state.sawDownload,
      });

      // Desligamento programado: a fila precisa ter existido e ficado vazia por um tempo.
      if (state.shutdownArmed && state.countdownEndsAt === null) {
        const pending = isTauri ? Object.keys(useLibrary.getState().pendingInstall).length : 0;
        if (items.length === 0 && pending === 0) {
          emptySince ??= now;
          if (state.sawDownload && now - emptySince >= EMPTY_BEFORE_DONE_MS) {
            useDownloads.setState({ countdownEndsAt: now + SHUTDOWN_DELAY_SEC * 1000 });
            // É o Windows quem conta o tempo: se o launcher fechar, o desligamento continua valendo.
            if (isTauri) void steam.powerSchedule(SHUTDOWN_DELAY_SEC).catch(() => {});
          }
        } else {
          emptySince = null;
        }
      } else {
        emptySince = null;
      }
    } finally {
      busy = false;
    }
  };

  void tick();
  setInterval(() => void tick(), 1000);
}
