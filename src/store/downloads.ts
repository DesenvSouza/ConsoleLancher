import { create } from "zustand";
import { persist } from "zustand/middleware";
import { t, te } from "../i18n";
import { isTauri } from "../lib/api";
import { MIN_SPEED, SpeedMeter, buildEpicQueue, buildQueue, isInQueue, manifestDone, remainingBytes, withEstimates, type QueueItem } from "../lib/downloads";
import { steam, type DiskInfo } from "../lib/steam";
import { parentFolder } from "../lib/stores";
import type { Game } from "../lib/types";
import { useEpic } from "./epic";
import { useLibrary } from "./library";
import { useUI } from "./ui";

/** Muda a cada armar/cancelar/desligar: um agendamento atrasado do Windows que chegue depois disso é descartado. */
let epoch = 0;

/** Todos os jogos acompanhados terminaram instalados e sem atualização pendente (cancelado, removido ou indefinido = não). */
export function allFinishedWell(ids: string[], games: Game[]): { ok: boolean; title?: string } {
  for (const id of ids) {
    const game = games.find((g) => g.id === id);
    if (!game || game.state !== "installed" || game.update) return { ok: false, title: game?.title ?? id };
  }
  return { ok: ids.length > 0 };
}

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
  /** Os jogos que estavam na fila (ou entraram nela) desde que o desligamento foi programado: todos precisam terminar bem. */
  watched: string[];

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
      watched: [],

      // Programar vale para os downloads da fila de agora (e os que entrarem depois). Sem nenhum download na fila não há o
      // que acompanhar: nada é programado "para o futuro".
      setShutdownArmed: (shutdownArmed) => {
        epoch += 1;
        if (shutdownArmed && get().items.length === 0) {
          useUI.getState().showToast(t("Não há downloads na fila para acompanhar."), "warning");
          return;
        }
        set({ shutdownArmed, sawDownload: shutdownArmed, watched: shutdownArmed ? get().items.map((i) => i.appId) : [] });
      },

      // A tela só diz "cancelado" quando o Windows confirmou. Se o cancelamento falhar, a contagem continua na tela e o aviso
      // pede para tentar de novo (antes o erro era descartado e o PC desligava mesmo com a tela dizendo o contrário).
      cancelShutdown: async () => {
        epoch += 1;
        if (isTauri) {
          try {
            await steam.powerCancel();
          } catch (error) {
            useUI.getState().showToast(`${te(error)} ${t("O desligamento continua programado: tente cancelar de novo.")}`, "warning");
            return;
          }
        }
        set({ shutdownArmed: false, sawDownload: false, countdownEndsAt: null, watched: [] });
      },

      shutdownNow: async () => {
        epoch += 1;
        if (isTauri) {
          try {
            await steam.powerCancel();
          } catch (error) {
            useUI.getState().showToast(te(error), "warning");
            return;
          }
          try {
            await steam.powerSchedule(0);
          } catch (error) {
            // O agendamento anterior já foi cancelado: a contagem na tela não vale mais.
            set({ shutdownArmed: false, sawDownload: false, countdownEndsAt: null, watched: [] });
            useUI.getState().showToast(`${te(error)} ${t("O PC não será desligado.")}`, "warning");
            return;
          }
        }
        set({ shutdownArmed: false, sawDownload: false, countdownEndsAt: null, watched: [] });
      },

      refreshDisks: async () => {
        if (!isTauri) {
          set({ disks: MOCK_DISKS });
          return;
        }
        // As pastas das bibliotecas da Steam e as pastas onde a Epic instalou jogos (cada uma vira um cartão de disco).
        const epicFolders = useEpic.getState().installed.filter((g) => !g.incomplete).map((g) => parentFolder(g.installLocation));
        const paths = [...new Set([...useLibrary.getState().installed.map((a) => a.libraryPath), ...epicFolders].filter(Boolean))];
        if (paths.length === 0) return;
        const disks = await steam.diskUsage(paths).catch(() => null);
        if (disks) set({ disks });
      },
    }),
    // Nada é guardado entre uma abertura e outra: o desligamento programado é ligado à fila daquele momento, e sem a lista
    // de downloads acompanhados não há como saber se terminaram bem. (Versão 2 descarta o "armado" guardado antes.)
    { name: "launcher-downloads", version: 2, partialize: () => ({}), migrate: () => ({}) },
  ),
);

// ───────── Dados de mentira (navegador) ─────────

const GB = 1024 ** 3;
const MOCK_DISKS: DiskInfo[] = [{ path: "D:\\SteamLibrary", free: 212 * GB, total: 931 * GB }];

function mockQueue(): QueueItem[] {
  return [
    { appId: "1091500", title: "Cyberpunk 2077", isUpdate: false, state: "active", total: 70 * GB, done: 21 * GB, libraryPath: "D:\\SteamLibrary", etaSec: null, finishAt: null },
    { appId: "1245620", title: "Elden Ring", isUpdate: true, state: "queued", total: 52 * GB, done: 0, libraryPath: "D:\\SteamLibrary", etaSec: null, finishAt: null },
    { appId: "1086940", title: "Baldur's Gate 3", isUpdate: false, state: "queued", total: 122 * GB, done: 0, libraryPath: "D:\\SteamLibrary", etaSec: null, finishAt: null },
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
  /** Pedindo ao Windows para programar o desligamento (a contagem só aparece depois que ele confirma). */
  let scheduling = false;

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
        const steamQueue = withEstimates(buildQueue(lib.installed, titleOf, live, forceActive), speed, now);
        const epicQueue = buildEpicQueue(useLibrary.getState().games, useEpic.getState().installs);
        items = [...steamQueue, ...epicQueue];
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
        watched: state.shutdownArmed ? [...new Set([...state.watched, ...items.map((i) => i.appId)])] : state.watched,
      });

      // Desligamento programado: a fila precisa ter existido e ficado vazia por um tempo, e não pode haver jogo aberto
      // (desligar o PC com alguém jogando seria a pior surpresa: espera o jogo fechar).
      const lib = useLibrary.getState();
      const gameOpen = lib.runningAppId !== null || Object.keys(lib.launching).length > 0;
      if (state.shutdownArmed && state.countdownEndsAt === null) {
        const pending = isTauri ? Object.keys(useLibrary.getState().pendingInstall).length : 0;
        if (items.length === 0 && pending === 0 && !gameOpen) {
          emptySince ??= now;
          if (state.sawDownload && now - emptySince >= EMPTY_BEFORE_DONE_MS && !scheduling) {
            // A fila vazia não prova que deu certo: cancelar o último download também a esvazia. Só desliga se todos os
            // jogos acompanhados terminaram instalados.
            // No navegador a fila é de mentira: não há jogos reais para conferir.
            const finished = isTauri ? allFinishedWell(useDownloads.getState().watched, useLibrary.getState().games) : { ok: true };
            if (!finished.ok) {
              useDownloads.setState({ shutdownArmed: false, sawDownload: false, watched: [] });
              useUI.getState().showToast(
                finished.title ? t("Desligamento cancelado: {title} não foi concluído.", { title: finished.title }) : t("Desligamento cancelado: não deu para confirmar que os downloads terminaram."),
                "warning",
              );
            } else if (isTauri) {
              // É o Windows quem conta o tempo: se o launcher fechar, o desligamento continua valendo. A contagem na tela
              // só começa depois que ele aceitou o agendamento.
              scheduling = true;
              const mine = epoch;
              steam.powerSchedule(SHUTDOWN_DELAY_SEC).then(() => {
                // Desarmou (ou cancelou) enquanto o Windows respondia: o agendamento que chegou atrasado é desfeito.
                if (mine !== epoch || !useDownloads.getState().shutdownArmed) {
                  void steam.powerCancel().catch(() => undefined);
                  return;
                }
                useDownloads.setState({ countdownEndsAt: Date.now() + SHUTDOWN_DELAY_SEC * 1000 });
              }).catch((error) => {
                useDownloads.setState({ shutdownArmed: false, sawDownload: false });
                useUI.getState().showToast(`${te(error)} ${t("O PC não será desligado.")}`, "warning");
              }).finally(() => { scheduling = false; });
            } else {
              useDownloads.setState({ countdownEndsAt: now + SHUTDOWN_DELAY_SEC * 1000 });
            }
          }
        } else {
          emptySince = null;
        }
      } else {
        emptySince = null;
      }
      // Um jogo abriu durante a contagem final: a pessoa está usando o PC, então o desligamento é cancelado.
      if (state.countdownEndsAt !== null && gameOpen) {
        void useDownloads.getState().cancelShutdown().then(() => {
          if (useDownloads.getState().countdownEndsAt === null) useUI.getState().showToast(t("Desligamento cancelado: um jogo foi aberto."));
        });
      }
    } finally {
      busy = false;
    }
  };

  void tick();
  setInterval(() => void tick(), 1000);
}
