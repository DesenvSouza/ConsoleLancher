import { create } from "zustand";
import { persist } from "zustand/middleware";
import { compareText } from "../i18n";
import type { Game } from "../lib/types";

export type LibrarySort = "name" | "recent" | "playtime" | "size";

export const SORTS: { id: LibrarySort; label: string }[] = [
  { id: "name", label: "Nome (A–Z)" },
  { id: "recent", label: "Jogados recentemente" },
  { id: "playtime", label: "Mais jogados" },
  { id: "size", label: "Maior tamanho" },
];

interface LibraryViewStore {
  /** Aba selecionada (id de uma aba de useLibraryConfig). */
  tabId: string;
  sort: LibrarySort;
  /** Busca atual (não é guardada: ao reabrir o app a biblioteca começa sem busca). */
  query: string;
  /** Mostrando todos os jogos, ignorando as abas (não é guardado: a Biblioteca sempre abre numa aba). */
  scopeAll: boolean;
  set: (patch: Partial<Pick<LibraryViewStore, "tabId" | "sort" | "query" | "scopeAll">>) => void;
}

export const useLibraryView = create<LibraryViewStore>()(
  persist(
    (set) => ({ tabId: "all", sort: "name", query: "", scopeAll: false, set: (patch) => set(patch) }),
    {
      name: "launcher-library-view",
      version: 2,
      partialize: (s) => ({ tabId: s.tabId, sort: s.sort }),
      // v1 guardava "filter" (all/installed/not_installed/favorites): são os mesmos ids das abas padrão.
      migrate: (old, version) => {
        const state = (old ?? {}) as { filter?: string; tabId?: string; sort?: LibrarySort };
        return {
          tabId: (version < 2 ? state.filter : state.tabId) ?? "all",
          sort: state.sort ?? ("name" as LibrarySort),
        };
      },
    },
  ),
);

const byName = (a: Game, b: Game) => compareText(a.title, b.title);

export function sortGames(list: Game[], sort: LibrarySort): Game[] {
  const out = [...list];
  switch (sort) {
    case "recent":
      return out.sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || byName(a, b));
    case "playtime":
      return out.sort((a, b) => b.playtimeMin - a.playtimeMin || byName(a, b));
    case "size":
      return out.sort((a, b) => b.sizeGB - a.sizeGB || byName(a, b));
    default:
      return out.sort(byName);
  }
}
