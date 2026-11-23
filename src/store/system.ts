import { useEffect } from "react";
import { create } from "zustand";
import { t, te } from "../i18n";
import { api, isTauri, type PadBattery, type SystemStatus, type SystemVolume } from "../lib/api";
import { useUI } from "./ui";

const VOLUME_STEP = 5;

interface SystemStore {
  status: SystemStatus | null;
  /** Painel "Sistema" aberto (janela principal). */
  panelOpen: boolean;
  /** Tela aberta dentro do painel (Wi-Fi ou Bluetooth); null = o painel principal. */
  subpanel: "wifi" | "bluetooth" | null;
  /** Linha do painel principal que abriu a tela de dentro (o foco volta para ela). */
  returnFocus: string | null;
  openPanel: () => void;
  closePanel: () => void;
  openSubpanel: (name: "wifi" | "bluetooth") => void;
  closeSubpanel: () => void;
  refresh: () => Promise<void>;
  /** Soma `steps` degraus de 5% ao volume (negativo diminui). */
  stepVolume: (steps: number) => void;
  toggleMute: () => void;
  /** Passa para a saída de áudio seguinte (+1) ou anterior (-1). */
  stepOutput: (dir: 1 | -1) => void;
}

// O volume muda em rajadas (segurar o botão): só o último valor pedido é enviado, um de cada vez e em ordem.
let wantedVolume: number | null = null;
let sendingVolume = false;
let lastLocalChange = 0;

function warn(error: unknown) {
  useUI.getState().showToast(te(error), "warning");
}

export const useSystem = create<SystemStore>((set, get) => {
  async function flushVolume() {
    if (sendingVolume) return;
    sendingVolume = true;
    try {
      while (wantedVolume !== null) {
        const percent = wantedVolume;
        wantedVolume = null;
        const volume = await api.setVolume(percent);
        lastLocalChange = Date.now();
        const status = get().status;
        if (status) set({ status: { ...status, volume } });
      }
    } catch (error) {
      wantedVolume = null;
      warn(error);
    } finally {
      sendingVolume = false;
    }
  }

  return {
    status: null,
    panelOpen: false,
    subpanel: null,
    returnFocus: null,
    openPanel: () => set({ panelOpen: true, subpanel: null, returnFocus: null }),
    closePanel: () => set({ panelOpen: false, subpanel: null, returnFocus: null }),
    openSubpanel: (subpanel) => set({ subpanel, returnFocus: `sys-${subpanel}` }),
    closeSubpanel: () => set({ subpanel: null }),

    refresh: async () => {
      try {
        const next = await api.systemStatus();
        // Logo depois de o jogador mexer no volume, o que o Windows devolve pode ser o valor antigo.
        const recentlyChanged = sendingVolume || wantedVolume !== null || Date.now() - lastLocalChange < 800;
        const current = get().status;
        set({ status: recentlyChanged && current ? { ...next, volume: current.volume } : next });
      } catch {
        // Sem resposta do backend: mantém o que já se sabia.
      }
    },

    stepVolume: (steps) => {
      const status = get().status;
      if (!status?.volume) return;
      const base = wantedVolume ?? status.volume.percent;
      const percent = Math.max(0, Math.min(100, Math.round(base / VOLUME_STEP) * VOLUME_STEP + steps * VOLUME_STEP));
      wantedVolume = percent;
      // Mostra na hora; o Windows confirma em seguida.
      set({ status: { ...status, volume: { percent, muted: percent === 0 ? status.volume.muted : false } } });
      void flushVolume();
    },

    toggleMute: () => {
      const status = get().status;
      if (!status?.volume) return;
      const muted = !status.volume.muted;
      set({ status: { ...status, volume: { ...status.volume, muted } } });
      lastLocalChange = Date.now();
      api.setMute(muted).then((volume) => {
        const current = get().status;
        if (current) set({ status: { ...current, volume } });
      }).catch(warn);
    },

    stepOutput: (dir) => {
      const status = get().status;
      if (!status || status.outputs.length < 2) return;
      const index = Math.max(0, status.outputs.findIndex((o) => o.current));
      const next = status.outputs[(index + dir + status.outputs.length) % status.outputs.length];
      set({ status: { ...status, outputs: status.outputs.map((o) => ({ ...o, current: o.id === next.id })) } });
      api.setOutput(next.id).then((fresh) => {
        lastLocalChange = Date.now();
        set({ status: fresh });
      }).catch((error) => {
        warn(error);
        void get().refresh();
      });
    },
  };
});

// ───────── Atualização periódica compartilhada ─────────

const watchers = new Map<symbol, number>();
let timer: ReturnType<typeof setInterval> | undefined;

function restartTimer() {
  clearInterval(timer);
  timer = undefined;
  if (watchers.size === 0) return;
  const every = Math.min(...watchers.values());
  timer = setInterval(() => {
    if (!document.hidden) void useSystem.getState().refresh();
  }, every);
}

/** Mantém `status` atualizado enquanto o componente existir. Vários componentes dividem a mesma consulta. */
export function useSystemPolling(everyMs = 5000) {
  useEffect(() => {
    const id = Symbol("system-watcher");
    watchers.set(id, everyMs);
    restartTimer();
    void useSystem.getState().refresh();
    const onVisible = () => {
      if (!document.hidden) void useSystem.getState().refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      watchers.delete(id);
      restartTimer();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [everyMs]);
}

/**
 * O volume e a saída de áudio mudam também por outra janela (o menu Guia é uma janela à parte): o Rust avisa as duas e
 * cada uma atualiza o que mostra, sem esperar a próxima consulta periódica.
 */
export function startSystemSync() {
  if (!isTauri) return;
  void import("@tauri-apps/api/event").then(({ listen }) => {
    void listen<SystemVolume>("system-volume", (event) => {
      // No meio de uma rajada daqui mesmo, o valor que já está na tela é mais novo que o do aviso.
      if (sendingVolume || wantedVolume !== null) return;
      const status = useSystem.getState().status;
      if (status) {
        lastLocalChange = Date.now();
        useSystem.setState({ status: { ...status, volume: event.payload } });
      }
    });
    void listen<SystemStatus>("system-status", (event) => {
      lastLocalChange = Date.now();
      useSystem.setState({ status: event.payload });
    });
  });
}

/** Texto curto do nível da bateria do controle. */
export function batteryText(battery: PadBattery): string {
  switch (battery) {
    case "wired": return t("com fio");
    case "empty": return t("bateria vazia");
    case "low": return t("bateria baixa");
    case "medium": return t("bateria média");
    case "full": return t("bateria cheia");
    default: return t("bateria desconhecida");
  }
}
