import { create } from "zustand";
import { persist } from "zustand/middleware";
import { playSound } from "../audio/sounds";
import { t, te } from "../i18n";
import { updater, type AvailableUpdate, type UpdateStatus } from "../lib/update";
import { useDownloads } from "./downloads";
import { useEpic } from "./epic";
import { useLibrary } from "./library";
import { useUI } from "./ui";

/**
 * Atualização do launcher: procura uma versão nova, avisa uma vez e só instala quando o jogador confirma.
 * Nunca instala com um jogo aberto, uma instalação da Epic em andamento ou um desligamento programado.
 */

/** Por que não dá para instalar agora (a instalação fecha o launcher); null quando dá. O texto vem em português, para traduzir. */
export function updateBlocker(): string | null {
  const { runningAppId, launching } = useLibrary.getState();
  if (runningAppId !== null) return "Feche o jogo para instalar a atualização.";
  if (Object.keys(launching).length > 0) return "Há um jogo abrindo. Instale a atualização depois de fechá-lo.";
  const epic = useEpic.getState();
  if (Object.keys(epic.installs).length > 0) return "Espere a instalação do jogo da Epic terminar para atualizar.";
  if (epic.legendaryDownloading) return "Espere o download do instalador da Epic terminar para atualizar.";
  const downloads = useDownloads.getState();
  if (downloads.shutdownArmed || downloads.countdownEndsAt !== null) return "Há um desligamento programado. Cancele-o antes de atualizar.";
  return null;
}

interface UpdateState {
  /** Procurar sozinho ao abrir e de tempos em tempos. */
  auto: boolean;
  /** Última versão sobre a qual o aviso já apareceu sozinho. */
  notified: string | null;
  /** A versão que estava rodando da última vez (para avisar que a atualização deu certo). */
  lastRun: string | null;
  /** Versão recém-instalada cuja sugestão de reiniciar o PC ainda não foi respondida. */
  restartSuggestion: string | null;

  status: UpdateStatus | null;
  available: AvailableUpdate | null;
  /** Quando a última procura que deu certo terminou. */
  checkedAt: number | null;
  phase: "idle" | "checking" | "downloading" | "applying";
  error: string | null;
  /** O aviso da atualização está aberto. */
  dialog: boolean;

  setAuto: (auto: boolean) => void;
  answerRestartSuggestion: () => void;
  refresh: () => Promise<void>;
  /** `manual`: o jogador pediu, então o resultado (ou o erro) é mostrado a ele. */
  check: (manual: boolean) => Promise<void>;
  open: () => void;
  close: () => void;
  /** Baixa (se ainda não baixou) e instala. */
  install: () => Promise<void>;
}

export const useUpdate = create<UpdateState>()(
  persist(
    (set, get) => ({
      auto: true,
      notified: null,
      lastRun: null,
      restartSuggestion: null,
      status: null,
      available: null,
      checkedAt: null,
      phase: "idle",
      error: null,
      dialog: false,

      setAuto: (auto) => set({ auto }),
      answerRestartSuggestion: () => set({ restartSuggestion: null }),

      refresh: async () => {
        try {
          const status = await updater.status();
          set({ status });
          const before = get().lastRun;
          if (before !== status.current) {
            // Primeira execução não é atualização.
            set({ lastRun: status.current, ...(before ? { restartSuggestion: status.current } : {}) });
          }
        } catch (e) {
          console.error("update_status falhou", e); // i18n-ignore
        }
      },

      check: async (manual) => {
        if (get().phase !== "idle") return;
        set({ phase: "checking", error: null });
        try {
          await get().refresh();
          const available = await updater.check();
          set({ available, checkedAt: Date.now(), phase: "idle" });
          if (!manual) return;
          if (available) {
            // Quem pediu e já viu o aviso não precisa dele de novo.
            set({ notified: available.version });
            get().open();
          } else {
            useUI.getState().showToast(t("Você já está na versão mais recente ({version}).", { version: get().status?.current ?? "" }), "success");
          }
        } catch (e) {
          set({ phase: "idle" });
          if (manual) useUI.getState().showToast(te(e), "warning");
          else console.warn("procura de atualização falhou", e); // i18n-ignore
        }
      },

      open: () => {
        if (!get().available) return;
        playSound("open");
        set({ dialog: true, error: null });
      },
      close: () => set({ dialog: false, error: null }),

      install: async () => {
        const available = get().available;
        if (!available || get().phase !== "idle" || updateBlocker()) return;
        set({ error: null });
        try {
          await get().refresh();
          if (get().status?.ready !== available.version) {
            set({ phase: "downloading" });
            const version = await updater.download();
            // Pode ter saído uma versão ainda mais nova entre a procura e o download.
            set({ available: version === available.version ? available : { version, notes: null } });
            await get().refresh();
          }
          // O jogador pode ter fechado o aviso (ou aberto um jogo) durante o download: aí a instalação espera por ele.
          if (!get().dialog || updateBlocker()) {
            set({ phase: "idle" });
            if (!get().dialog) useUI.getState().showToast(t("Atualização baixada. Instale em Configurações › Sistema e energia."), "success");
            return;
          }
          set({ phase: "applying" });
          await updater.apply();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          set({ phase: "idle", error: message });
          if (!get().dialog) useUI.getState().showToast(te(e), "warning");
        }
      },
    }),
    { name: "launcher-update", version: 1, partialize: ({ auto, notified, lastRun, restartSuggestion }) => ({ auto, notified, lastRun, restartSuggestion }) },
  ),
);
