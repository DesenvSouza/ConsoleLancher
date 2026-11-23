import { create } from "zustand";
import type { LaunchMark, LaunchStatus } from "../lib/steam";

interface LaunchState {
  /** Ponto do log da Steam no momento do "Jogar" (id do jogo → posição). */
  marks: Record<string, LaunchMark>;
  /** Última leitura da etapa de cada abertura (id do jogo → etapa). */
  status: Record<string, LaunchStatus>;
  /** O jogador fechou a tela de uma abertura (id → etapa em que fechou): ela só volta se a etapa mudar. */
  dismissed: Record<string, string>;
  setMark: (id: string, from: LaunchMark) => void;
  setStatus: (id: string, status: LaunchStatus) => void;
  dismiss: (id: string) => void;
  clear: (id: string) => void;
}

export const useLaunch = create<LaunchState>((set, get) => ({
  marks: {},
  status: {},
  dismissed: {},
  setMark: (id, from) => set({ marks: { ...get().marks, [id]: from } }),
  setStatus: (id, status) => set({ status: { ...get().status, [id]: status } }),
  dismiss: (id) => set({ dismissed: { ...get().dismissed, [id]: get().status[id]?.task ?? "" } }),
  clear: (id) => {
    const { [id]: _m, ...marks } = get().marks;
    const { [id]: _s, ...status } = get().status;
    const { [id]: _d, ...dismissed } = get().dismissed;
    set({ marks, status, dismissed });
  },
}));
