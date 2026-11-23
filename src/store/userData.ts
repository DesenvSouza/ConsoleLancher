import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OwnedGame } from "../lib/steam";

/** Onde a duração (HowLongToBeat) aparece na página do jogo. */
export type HltbStyle = "stats" | "section" | "line" | "hint";
/** Quais tempos mostrar: os três, só história principal e com extras, ou só a história principal. */
export type HltbTimes = "all" | "main-extras" | "main";

export const HLTB_STYLES: { id: HltbStyle; name: string; hint: string }[] = [
  { id: "stats", name: "Junto dos números", hint: "Em colunas ao lado de Tempo de jogo, Última vez e Tamanho" },
  { id: "section", name: "Seção própria", hint: "Um bloco com os tempos e uma barra do quanto você já jogou" },
  { id: "line", name: "Linha de texto", hint: "Uma linha \"Duração\" junto de Idioma, Controle e Avaliações" },
  { id: "hint", name: "Dica curta", hint: "Só a história principal, ao lado do seu tempo de jogo" },
];

export const HLTB_TIMES: { id: HltbTimes; name: string }[] = [
  { id: "all", name: "Todos (principal, extras e completista)" },
  { id: "main-extras", name: "Principal e extras" },
  { id: "main", name: "Só a história principal" },
];

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
  /** Idioma preferido (código da Steam). A página do jogo diz se o jogo o tem. */
  preferredLanguage: string;
  /** Mostra a duração do jogo (HowLongToBeat) na página dele. Consulta o site howlongtobeat.com. */
  showHltb: boolean;
  /** Onde a duração aparece na página do jogo. */
  hltbStyle: HltbStyle;
  /** Quais tempos aparecem. */
  hltbTimes: HltbTimes;

  setShowHltb: (v: boolean) => void;
  setHltbStyle: (v: HltbStyle) => void;
  setHltbTimes: (v: HltbTimes) => void;
  setHideSteamToasts: (v: boolean) => void;
  setPreferredLanguage: (code: string) => void;
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
      preferredLanguage: "brazilian",
      showHltb: true,
      hltbStyle: "stats",
      hltbTimes: "all",

      setShowHltb: (showHltb) => set({ showHltb }),
      setHltbStyle: (hltbStyle) => set({ hltbStyle }),
      setHltbTimes: (hltbTimes) => set({ hltbTimes }),
      setHideSteamToasts: (hideSteamToasts) => set({ hideSteamToasts }),
      setPreferredLanguage: (preferredLanguage) => set({ preferredLanguage }),
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
      // Uma sincronização traz o tempo oficial da Steam, que já inclui as sessões jogadas por aqui. Só some o tempo extra
      // dos jogos cujo tempo oficial já subiu: uma sincronização feita logo depois de fechar um jogo pode vir antes de a
      // Steam contar a sessão, e apagar os minutos faria o tempo de jogo voltar atrás.
      setOwned: (owned, steamId) => {
        const before = new Map(get().owned.map((g) => [g.appId, g.playtimeMin]));
        const sameAccount = get().steamId === steamId && before.size > 0;
        const extraPlaytimeMin = { ...get().extraPlaytimeMin };
        for (const game of owned) {
          if (!sameAccount || game.playtimeMin > (before.get(game.appId) ?? 0)) delete extraPlaytimeMin[game.appId];
        }
        set({ owned, steamId, ownedFetchedAt: Date.now(), extraPlaytimeMin: sameAccount ? extraPlaytimeMin : {} });
      },
      clearOwned: () => set({ owned: [], ownedFetchedAt: 0 }),
    }),
    { name: "launcher-user", version: 1 },
  ),
);
