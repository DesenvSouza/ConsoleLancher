import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OwnedGame } from "../lib/steam";

/**
 * Dados que são do launcher (e não da Steam): favoritos, última vez jogado, tempo jogado por aqui
 * e o cache da lista de jogos da conta. Fica salvo no armazenamento do app.
 */
interface UserData {
  favorites: Record<string, true>;
  lastPlayedAt: Record<string, number>;
  /** Minutos jogados pelo launcher desde a última sincronização com a Steam. */
  extraPlaytimeMin: Record<string, number>;
  owned: OwnedGame[];
  ownedFetchedAt: number;
  steamId: string | null;
  /** Esconde as notificações da Steam no canto da tela (a Steam fica só como motor, atrás do launcher). */
  hideSteamToasts: boolean;
  /** O botão Guia do controle não deve abrir a Steam por cima do launcher. */
  blockSteamGuide: boolean;

  setHideSteamToasts: (v: boolean) => void;
  setBlockSteamGuide: (v: boolean) => void;
  setFavorite: (id: string, value: boolean) => void;
  markPlayed: (id: string, at: number) => void;
  recordSession: (id: string, minutes: number, at: number) => void;
  setOwned: (games: OwnedGame[], steamId: string) => void;
  /** Esquece a lista de jogos da conta (ao remover a chave): sobram só os instalados. Favoritos e histórico ficam guardados. */
  clearOwned: () => void;
}

export const useUserData = create<UserData>()(
  persist(
    (set, get) => ({
      favorites: {},
      lastPlayedAt: {},
      extraPlaytimeMin: {},
      owned: [],
      ownedFetchedAt: 0,
      steamId: null,
      hideSteamToasts: true,
      blockSteamGuide: true,

      setHideSteamToasts: (hideSteamToasts) => set({ hideSteamToasts }),
      setBlockSteamGuide: (blockSteamGuide) => set({ blockSteamGuide }),
      setFavorite: (id, value) => {
        const favorites = { ...get().favorites };
        if (value) favorites[id] = true;
        else delete favorites[id];
        set({ favorites });
      },
      markPlayed: (id, at) => set({ lastPlayedAt: { ...get().lastPlayedAt, [id]: at } }),
      recordSession: (id, minutes, at) =>
        set({
          lastPlayedAt: { ...get().lastPlayedAt, [id]: at },
          extraPlaytimeMin: { ...get().extraPlaytimeMin, [id]: (get().extraPlaytimeMin[id] ?? 0) + minutes },
        }),
      // Uma sincronização traz o tempo oficial da Steam, que já inclui as sessões jogadas por aqui.
      setOwned: (owned, steamId) => set({ owned, steamId, ownedFetchedAt: Date.now(), extraPlaytimeMin: {} }),
      clearOwned: () => set({ owned: [], ownedFetchedAt: 0 }),
    }),
    { name: "launcher-user", version: 1 },
  ),
);
