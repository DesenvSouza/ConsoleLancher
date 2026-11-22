import { create } from "zustand";
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
  /** Aviso rápido no rodapé (some sozinho). */
  toast: { id: number; text: string } | null;
  showToast: (text: string) => void;

  navigate: (s: Screen) => void;
  back: () => void;
  setModalOpen: (v: boolean) => void;
  setHomeFocusKey: (k: string) => void;
  setFocusedGame: (id: string) => void;
  openContext: (id: string) => void;
  closeContext: () => void;
  askUninstall: (id: string) => void;
  clearUninstall: () => void;
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
  toast: null,
  showToast: (text) => {
    const id = Date.now();
    set({ toast: { id, text } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 5000);
  },

  navigate: (s) => set({ screen: s, history: [...get().history, get().screen] }),
  back: () => {
    const { history } = get();
    if (history.length === 0) return;
    set({ screen: history[history.length - 1], history: history.slice(0, -1) });
  },
  setModalOpen: (v) => {
    const depth = Math.max(0, get().modalDepth + (v ? 1 : -1));
    set({ modalDepth: depth, modalOpen: depth > 0 });
  },
  setHomeFocusKey: (homeFocusKey) => set({ homeFocusKey }),
  setFocusedGame: (focusedGameId) => set({ focusedGameId }),
  openContext: (contextGameId) => set({ contextGameId }),
  closeContext: () => set({ contextGameId: null }),
  askUninstall: (confirmUninstallId) => set({ confirmUninstallId }),
  clearUninstall: () => set({ confirmUninstallId: null }),
}));
