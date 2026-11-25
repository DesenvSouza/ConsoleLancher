import { create } from "zustand";
import { api } from "../lib/api";
import { useDownloads } from "./downloads";
import { useEpic } from "./epic";
import { useLibrary } from "./library";

/**
 * Reinicialização do PC, obrigatória ao ativar o modo console (ele só vale depois de reiniciar).
 * A espera dá tempo de ler o aviso e de o launcher gravar as configurações antes de o Windows fechar tudo.
 */
export const RESTART_SECONDS = 15;

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
  start: () => Promise<void>;
  dismiss: () => void;
}

export const useRestart = create<RestartState>()((set, get) => ({
  endsAt: null,
  failed: false,
  start: async () => {
    if (get().endsAt !== null) return;
    set({ endsAt: Date.now() + RESTART_SECONDS * 1000, failed: false });
    try {
      await api.restartPc(RESTART_SECONDS);
    } catch (e) {
      console.error("power_restart falhou", e); // i18n-ignore
      set({ endsAt: null, failed: true });
    }
  },
  dismiss: () => set({ endsAt: null, failed: false }),
}));
