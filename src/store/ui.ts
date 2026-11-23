import { create } from "zustand";
import { playSound } from "../audio/sounds";
import type { Screen } from "../lib/types";

interface UIStore {
  screen: Screen;
  history: Screen[];
  /** Quantos diálogos/menus estão abertos. Enquanto > 0 (modalOpen), o "voltar" global é ignorado. */
  modalDepth: number;
  modalOpen: boolean;
  /** Último card focado na Home, para voltar exatamente onde o jogador estava. */
  homeFocusKey: string | null;
  /** Último card focado na Biblioteca. */
  libraryFocusKey: string | null;
  setLibraryFocusKey: (k: string) => void;
  /** Jogo sob o foco na Home ou na Biblioteca (alvo do menu Start). */
  focusedGameId: string | null;
  /** Menu de opções do jogo (botão Start). */
  contextGameId: string | null;
  /** Confirmação de desinstalar aberta para este jogo. */
  confirmUninstallId: string | null;
  confirmCloseGameId: string | null;
  /** Confirmação de cancelar o download/instalação aberta para este jogo. */
  confirmCancelInstallId: string | null;
  /** Aviso rápido no rodapé (some sozinho). */
  toast: { id: number; text: string } | null;
  showToast: (text: string, sound?: "success" | "warning") => void;

  navigate: (s: Screen) => void;
  /** Vai a um destino principal (os botões do cabeçalho): o "voltar" a partir dele leva ao Início. */
  goTo: (target: "home" | "library" | "downloads" | "settings") => void;
  back: () => void;
  setModalOpen: (v: boolean) => void;
  setHomeFocusKey: (k: string) => void;
  setFocusedGame: (id: string) => void;
  openContext: (id: string) => void;
  closeContext: () => void;
  askUninstall: (id: string) => void;
  clearUninstall: () => void;
  askCancelInstall: (id: string) => void;
  clearCancelInstall: () => void;
  askCloseGame: (id: string) => void;
  clearCloseGame: () => void;
}

export const useUI = create<UIStore>((set, get) => ({
  screen: { name: "home" },
  history: [],
  modalDepth: 0,
  modalOpen: false,
  homeFocusKey: null,
  libraryFocusKey: null,
  setLibraryFocusKey: (libraryFocusKey) => set({ libraryFocusKey }),
  focusedGameId: null,
  contextGameId: null,
  confirmUninstallId: null,
  confirmCloseGameId: null,
  confirmCancelInstallId: null,
  toast: null,
  showToast: (text, sound) => {
    if (sound) playSound(sound);
    const id = Date.now();
    set({ toast: { id, text } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 5000);
  },

  navigate: (s) => set({ screen: s, history: [...get().history, get().screen] }),
  goTo: (target) => {
    if (get().screen.name === target) return;
    playSound("open");
    set({ screen: { name: target }, history: target === "home" ? [] : [{ name: "home" }] });
  },
  back: () => {
    const { history } = get();
    if (history.length === 0) return;
    playSound("back");
    set({ screen: history[history.length - 1], history: history.slice(0, -1) });
  },
  setModalOpen: (v) => {
    const depth = Math.max(0, get().modalDepth + (v ? 1 : -1));
    set({ modalDepth: depth, modalOpen: depth > 0 });
  },
  setHomeFocusKey: (homeFocusKey) => set({ homeFocusKey }),
  setFocusedGame: (focusedGameId) => set({ focusedGameId }),
  openContext: (contextGameId) => {
    playSound("open");
    set({ contextGameId });
  },
  closeContext: () => set({ contextGameId: null }),
  askUninstall: (confirmUninstallId) => {
    playSound("open");
    set({ confirmUninstallId });
  },
  clearUninstall: () => set({ confirmUninstallId: null }),
  askCancelInstall: (confirmCancelInstallId) => {
    playSound("open");
    set({ confirmCancelInstallId });
  },
  clearCancelInstall: () => set({ confirmCancelInstallId: null }),
  askCloseGame: (confirmCloseGameId) => {
    playSound("open");
    set({ confirmCloseGameId });
  },
  clearCloseGame: () => set({ confirmCloseGameId: null }),
}));
