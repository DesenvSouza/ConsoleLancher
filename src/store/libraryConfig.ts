import { create } from "zustand";
import { persist } from "zustand/middleware";
import { emptyRule, type HiddenMode, type TabRule } from "../lib/libraryRules";

/** Uma aba da biblioteca: um nome e uma regra de filtro. */
export interface LibraryTab {
  id: string;
  name: string;
  /** Visível na barra de abas (as ocultas continuam guardadas e podem ser reativadas). */
  enabled: boolean;
  rule: TabRule;
}

export type CardSize = "s" | "m" | "l";
export const CARD_SIZE_LABELS: Record<CardSize, string> = { s: "Pequeno", m: "Médio", l: "Grande" };
export const CARD_SIZES: CardSize[] = ["s", "m", "l"];

/** Os ids das abas padrão são os mesmos dos filtros antigos, então a aba escolhida antes continua valendo. */
export const DEFAULT_TABS: LibraryTab[] = [
  { id: "all", name: "Todos", enabled: true, rule: emptyRule() },
  { id: "installed", name: "Instalados", enabled: true, rule: { ...emptyRule(), install: "installed" } },
  { id: "not_installed", name: "Não instalados", enabled: true, rule: { ...emptyRule(), install: "not_installed" } },
  { id: "favorites", name: "Favoritos", enabled: true, rule: { ...emptyRule(), favorite: true } },
];

interface LibraryConfig {
  tabs: LibraryTab[];
  hidden: HiddenMode;
  cardSize: CardSize;
  /** Mostra o número de jogos em cada aba. */
  showCounts: boolean;
  /** Mostra o selo "Instalar" nos jogos não instalados. */
  showBadges: boolean;

  setOptions: (patch: Partial<Pick<LibraryConfig, "hidden" | "cardSize" | "showCounts" | "showBadges">>) => void;
  updateTab: (id: string, patch: Partial<Pick<LibraryTab, "name" | "enabled">>) => void;
  updateRule: (id: string, patch: Partial<TabRule>) => void;
  /** Cria uma aba nova (visível, sem filtros) e devolve o id dela. */
  addTab: () => string;
  deleteTab: (id: string) => void;
  moveTab: (id: string, dir: -1 | 1) => void;
  reset: () => void;
}

const clone = (tabs: LibraryTab[]): LibraryTab[] => tabs.map((t) => ({ ...t, rule: { ...t.rule } }));

export const useLibraryConfig = create<LibraryConfig>()(
  persist(
    (set, get) => ({
      tabs: clone(DEFAULT_TABS),
      hidden: "show",
      cardSize: "m",
      showCounts: true,
      showBadges: true,

      setOptions: (patch) => set(patch),
      updateTab: (id, patch) => set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
      updateRule: (id, patch) => set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, rule: { ...t.rule, ...patch } } : t)) }),
      addTab: () => {
        const id = `tab-${Date.now().toString(36)}`;
        set({ tabs: [...get().tabs, { id, name: "Nova aba", enabled: true, rule: emptyRule() }] });
        return id;
      },
      deleteTab: (id) => {
        if (get().tabs.length <= 1) return; // sempre sobra pelo menos uma aba
        set({ tabs: get().tabs.filter((t) => t.id !== id) });
      },
      moveTab: (id, dir) => {
        const list = [...get().tabs];
        const i = list.findIndex((t) => t.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        set({ tabs: list });
      },
      reset: () => set({ tabs: clone(DEFAULT_TABS), hidden: "show", cardSize: "m", showCounts: true, showBadges: true }),
    }),
    { name: "launcher-library-config", version: 1 },
  ),
);

/** Abas visíveis, na ordem. Se o jogador escondeu todas, cai na primeira para a Biblioteca nunca ficar sem aba. */
export function visibleTabs(tabs: LibraryTab[]): LibraryTab[] {
  const on = tabs.filter((t) => t.enabled);
  return on.length > 0 ? on : tabs.slice(0, 1);
}
