import { create } from "zustand";
import { persist } from "zustand/middleware";
import { t } from "../i18n";

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

/**
 * Plano de fundo da página inicial.
 * - gradient: degradê gerado a partir do jogo selecionado (o padrão de sempre)
 * - art: arte panorâmica do jogo selecionado
 * - blur: capa do jogo selecionado, bem desfocada (só o clima de cores)
 * - color: cor sólida à escolha
 */
export type BackgroundStyle = "gradient" | "art" | "blur" | "color";

export const BACKGROUND_STYLES: { id: BackgroundStyle; name: string; hint: string }[] = [
  { id: "gradient", name: "Degradê do jogo", hint: "Cores do jogo selecionado, suaves" },
  { id: "art", name: "Arte do jogo", hint: "A arte do jogo selecionado atrás de tudo" },
  { id: "blur", name: "Capa desfocada", hint: "A capa do jogo selecionado, bem desfocada" },
  { id: "color", name: "Cor sólida", hint: "Uma cor fixa, sem mudar com o jogo" },
];

/** Cores da opção "Cor sólida" (`css` é o valor usado no fundo). */
export const BACKGROUND_COLORS: { id: string; name: string; css: string }[] = [
  { id: "black", name: "Preto", css: "#000000" },
  { id: "graphite", name: "Grafite", css: "#1c1f27" },
  { id: "navy", name: "Azul-noite", css: "#0d1b36" },
  { id: "wine", name: "Vinho", css: "#3a0f1f" },
  { id: "forest", name: "Verde-floresta", css: "#0e2a1f" },
  { id: "accent", name: "Cor de destaque", css: "color-mix(in srgb, var(--accent) 38%, var(--bg))" },
];

interface HomeStore {
  blocks: HomeBlock[];
  /** Mostra o destaque grande (título e descrição) no topo. */
  showHero: boolean;
  rowMode: RowMode;
  background: BackgroundStyle;
  /** Id de `BACKGROUND_COLORS` usado quando o estilo é "Cor sólida". */
  backgroundColor: string;
  /** Quanto do plano de fundo aparece (0.1 a 1). */
  backgroundStrength: number;
  /** Quanto a "Capa desfocada" é desfocada (0.05 a 1; 1 = 5rem de desfoque). */
  backgroundBlur: number;
  update: (id: string, patch: Partial<HomeBlock>) => void;
  move: (id: string, dir: -1 | 1) => void;
  setShowHero: (v: boolean) => void;
  setRowMode: (m: RowMode) => void;
  setBackground: (patch: Partial<Pick<HomeStore, "background" | "backgroundColor" | "backgroundStrength" | "backgroundBlur">>) => void;
  reset: () => void;
}

const DEFAULT_BACKGROUND = { background: "gradient" as BackgroundStyle, backgroundColor: "graphite", backgroundStrength: 0.55, backgroundBlur: 0.45 };

export const useHome = create<HomeStore>()(
  persist(
    (set, get) => ({
      blocks: DEFAULT_BLOCKS,
      showHero: true,
      rowMode: "one",
      ...DEFAULT_BACKGROUND,
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
      setBackground: (patch) => set(patch),
      // O plano de fundo é uma escolha de aparência (Configurações › Aparência), então não volta junto com as fileiras.
      reset: () => set({ blocks: DEFAULT_BLOCKS, showHero: true, rowMode: "one" }),
    }),
    { name: "launcher-home", version: 1 },
  ),
);

export function describeBlock(b: HomeBlock): string {
  if (!b.enabled) return t("Fileira oculta");
  const limit = b.limit === 0 ? t("todos") : t("até {n}", { n: b.limit });
  return `${t(STYLE_LABELS[b.style])} · ${t(SIZE_LABELS[b.size])} · ${limit}`;
}
