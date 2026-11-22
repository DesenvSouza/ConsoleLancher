import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getTheme } from "./themes";

export interface ThemeSettings {
  themeId: string;
  /** null = usa a cor de destaque do tema. */
  accent: string | null;
  /** Arredondamento dos cantos, em px (na escala base). */
  radius: number;
  /** Escala geral da interface (1 = 100%). */
  fontScale: number;
  /** Intensidade do brilho no item focado (0..1). */
  glow: number;
}

interface ThemeStore extends ThemeSettings {
  set: (patch: Partial<ThemeSettings>) => void;
}

export const useTheme = create<ThemeStore>()(
  persist(
    (set) => ({
      themeId: "midnight",
      accent: null,
      radius: 14,
      fontScale: 1,
      glow: 0.6,
      set: (patch) => set(patch),
    }),
    { name: "launcher-theme" },
  ),
);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Preto ou branco, o que ficar mais legível sobre a cor informada. */
function readableOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0b0d14" : "#ffffff";
}

/** Escreve o tema atual como variáveis CSS em :root. Chamado a cada mudança. */
export function applyTheme(s: ThemeSettings) {
  const theme = getTheme(s.themeId);
  const c = theme.colors;
  const accent = s.accent ?? c.accent;
  const [r, g, b] = hexToRgb(accent);
  const root = document.documentElement.style;

  root.setProperty("--bg", c.bg);
  root.setProperty("--bg-elevated", c.bgElevated);
  root.setProperty("--surface", c.surface);
  root.setProperty("--surface-hover", c.surfaceHover);
  root.setProperty("--text", c.text);
  root.setProperty("--text-muted", c.textMuted);
  root.setProperty("--danger", c.danger);
  root.setProperty("--success", c.success);
  root.setProperty("--accent", accent);
  root.setProperty("--accent-rgb", `${r} ${g} ${b}`);
  root.setProperty("--accent-text", readableOn(accent));
  root.setProperty("--radius", `${s.radius / 16}rem`);
  root.setProperty("--font-scale", String(s.fontScale));
  root.setProperty("--glow", String(s.glow));
  root.colorScheme = theme.id === "daylight" ? "light" : "dark";
}
