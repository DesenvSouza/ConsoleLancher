import { create } from "zustand";
import { api } from "../lib/api";
import { useDownloads } from "./downloads";
import { useEpic } from "./epic";
import { useLibrary } from "./library";

/**
 * Reinicialização do PC: obrigatória ao ativar o modo console (ele só vale depois de reiniciar) e sugerida depois de uma
 * atualização do launcher. A espera dá tempo de ler o aviso e de gravar as configurações antes de o Windows fechar tudo.
 */
export const RESTART_SECONDS = 5;

/** O pedido ao Windows em andamento: um cancelamento espera por ele, para não ser atropelado. */
let requesting: Promise<void> | null = null;

/** Por que o PC está sendo reiniciado (muda o texto do aviso). */
export type RestartReason = "console" | "update";

/** Por que não dá para reiniciar agora; null quando dá. O texto vem em português, para traduzir. */
export function restartBlocker(): string | null {
  const { runningAppId, launching } = useLibrary.getState();
  if (runningAppId !== null || Object.keys(launching).length > 0) return "Feche o jogo antes: o PC será reiniciado.";
  const epic = useEpic.getState();
  if (Object.keys(epic.installs).length > 0 || epic.legendaryDownloading) return "Espere a instalação da Epic terminar antes: o PC será reiniciado.";
  const downloads = useDownloads.getState();
  if (downloads.shutdownArmed || downloads.countdownEndsAt !== null) return "Há um desligamento programado. Cancele-o antes de reiniciar.";
  return null;
}

interface RestartState {
  /** Instante em que o PC será reiniciado, enquanto a contagem está na tela. */
  endsAt: number | null;
  /** O Windows não aceitou o pedido: o jogador precisa reiniciar pelo menu de energia. */
  failed: boolean;
  reason: RestartReason;
  start: (reason?: RestartReason) => Promise<void>;
  /** Desfaz o pedido (só o reinício sugerido depois de uma atualização; o do modo console é obrigatório). */
  cancel: () => Promise<boolean>;
  /** O prazo passou e o PC continua ligado: mostra o aviso para o jogador seguir. */
  giveUp: () => void;
  dismiss: () => void;
}

export const useRestart = create<RestartState>()((set, get) => ({
  endsAt: null,
  failed: false,
  reason: "console",
  start: async (reason = "console") => {
    if (get().endsAt !== null) return;
    set({ endsAt: Date.now() + RESTART_SECONDS * 1000, failed: false, reason });
    try {
      requesting = api.restartPc(RESTART_SECONDS);
      await requesting;
    } catch (e) {
      console.error("power_restart falhou", e); // i18n-ignore
      set({ endsAt: null, failed: true });
    }
  },
  cancel: async () => {
    if (get().reason !== "update" || get().endsAt === null) return false;
    try {
      await requesting?.catch(() => undefined);
      await api.cancelRestart();
      set({ endsAt: null, failed: false });
      return true;
    } catch (e) {
      console.error("power_cancel falhou", e); // i18n-ignore
      return false;
    }
  },
  giveUp: () => set({ endsAt: null, failed: true }),
  dismiss: () => set({ endsAt: null, failed: false }),
}));
