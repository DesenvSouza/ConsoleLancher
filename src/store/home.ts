import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Que jogos o bloco mostra. */
export type BlockKind = "recent" | "favorites" | "installed" | "notInstalled" | "all";
/** Como o bloco aparece: cartaz (vertical), panorâmico (horizontal) ou grade (várias linhas). */
export type BlockStyle = "poster" | "wide" | "grid";
export type BlockSize = "s" | "m" | "l";

export interface HomeBlock {
  id: string;
  kind: BlockKind;
  enabled: boolean;
  style: BlockStyle;
  size: BlockSize;
  /** Máximo de jogos no bloco (0 = todos). */
  limit: number;
}

export const BLOCK_TITLES: Record<BlockKind, string> = {
  recent: "Continuar jogando",
  favorites: "Favoritos",
  installed: "Instalados",
  notInstalled: "Na biblioteca, não instalados",
  all: "Todos os jogos",
};

export const STYLE_LABELS: Record<BlockStyle, string> = { poster: "Cartaz", wide: "Panorâmico", grid: "Grade" };
export const SIZE_LABELS: Record<BlockSize, string> = { s: "Pequeno", m: "Médio", l: "Grande" };
export const STYLES: BlockStyle[] = ["poster", "wide", "grid"];
export const SIZES: BlockSize[] = ["s", "m", "l"];
export const LIMITS = [5, 10, 20, 50, 0];

const block = (kind: BlockKind, over: Partial<HomeBlock> = {}): HomeBlock => ({
  id: kind,
  kind,
  enabled: true,
  style: "poster",
  size: "m",
  limit: 10,
  ...over,
});

const DEFAULT_BLOCKS: HomeBlock[] = [
  block("recent"),
  block("favorites", { limit: 0 }),
  block("installed", { limit: 0 }),
  block("notInstalled", { limit: 0 }),
  block("all", { enabled: false, style: "grid", size: "s", limit: 0 }),
];

/** "one": só a fileira focada aparece (as outras somem ao rolar). "all": todas visíveis, com rolagem. */
export type RowMode = "one" | "all";

interface HomeStore {
  blocks: HomeBlock[];
  /** Mostra o destaque grande (título e descrição) no topo. */
  showHero: boolean;
  rowMode: RowMode;
  update: (id: string, patch: Partial<HomeBlock>) => void;
  move: (id: string, dir: -1 | 1) => void;
  setShowHero: (v: boolean) => void;
  setRowMode: (m: RowMode) => void;
  reset: () => void;
}

export const useHome = create<HomeStore>()(
  persist(
    (set, get) => ({
      blocks: DEFAULT_BLOCKS,
      showHero: true,
      rowMode: "one",
      update: (id, patch) => set({ blocks: get().blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }),
      move: (id, dir) => {
        const list = [...get().blocks];
        const i = list.findIndex((b) => b.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        set({ blocks: list });
      },
      setShowHero: (showHero) => set({ showHero }),
      setRowMode: (rowMode) => set({ rowMode }),
      reset: () => set({ blocks: DEFAULT_BLOCKS, showHero: true, rowMode: "one" }),
    }),
    { name: "launcher-home", version: 1 },
  ),
);

export function describeBlock(b: HomeBlock): string {
  if (!b.enabled) return "Oculto";
  const limit = b.limit === 0 ? "todos" : `até ${b.limit}`;
  return `${STYLE_LABELS[b.style]} · ${SIZE_LABELS[b.size]} · ${limit}`;
}
