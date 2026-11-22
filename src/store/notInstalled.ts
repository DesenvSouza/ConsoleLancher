import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Como avisar que um jogo não está instalado. */
export type BadgeStyle = "install" | "notInstalled" | "icon" | "none";
export type BadgePos = "top-right" | "top-left" | "bottom";
export type CoverStyle = "normal" | "gray" | "dim" | "gray-dim";

export const BADGE_LABELS: Record<BadgeStyle, string> = { install: "Instalar", notInstalled: "Não instalado", icon: "Ícone de download", none: "Nenhum" };
export const BADGE_POS_LABELS: Record<BadgePos, string> = { "top-right": "Canto superior direito", "top-left": "Canto superior esquerdo", bottom: "Faixa na base" };
export const COVER_LABELS: Record<CoverStyle, string> = { normal: "Normal", gray: "Cinza", dim: "Escurecida", "gray-dim": "Cinza e escurecida" };
export const BADGE_STYLES = Object.keys(BADGE_LABELS) as BadgeStyle[];
export const BADGE_POSITIONS = Object.keys(BADGE_POS_LABELS) as BadgePos[];
export const COVER_STYLES = Object.keys(COVER_LABELS) as CoverStyle[];

interface NotInstalledConfig {
  /** O que o selo do cartão diz. */
  badge: BadgeStyle;
  badgePos: BadgePos;
  /** Tratamento da capa dos jogos não instalados. */
  cover: CoverStyle;
  /** Ao focar o cartão, a capa volta à cor normal (para ver a arte). */
  colorOnFocus: boolean;
  /** Esconde os não instalados das fileiras da página inicial (menos a fileira "Não instalados"). */
  hideFromHome: boolean;
  /** Na biblioteca, os instalados vêm antes dos não instalados. */
  installedFirst: boolean;

  set: (patch: Partial<Omit<NotInstalledConfig, "set" | "reset">>) => void;
  reset: () => void;
}

const DEFAULTS = { badge: "install", badgePos: "top-right", cover: "normal", colorOnFocus: true, hideFromHome: false, installedFirst: false } as const;

export const useNotInstalled = create<NotInstalledConfig>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULTS }),
    }),
    { name: "launcher-not-installed", version: 1 },
  ),
);
