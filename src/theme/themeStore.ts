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
  /** Menos movimento: sem zoom no item focado, sem transições e sem rolagem animada. */
  reduceMotion: boolean;
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
      reduceMotion: false,
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

function luminance([r, g, b]: number[]): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: number[], b: number[]): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Versão da cor para usar em TEXTO: escurece (tema claro) ou clareia (tema escuro) aos poucos até ter contraste de
 * leitura (4,5) com os fundos do tema. Laranja ou amarelo sobre branco, por exemplo, ficariam ilegíveis sem isso.
 */
function readableColor(hex: string, backgrounds: string[], darkTheme: boolean): string {
  const targets = backgrounds.map(hexToRgb);
  const toward = darkTheme ? 255 : 0;
  let rgb: number[] = hexToRgb(hex);
  for (let step = 0; step < 24 && targets.some((bg) => contrastRatio(rgb, bg) < 4.5); step++) {
    rgb = rgb.map((v) => Math.round(v + (toward - v) * 0.1));
  }
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A cor de destaque como fundo de botão e o texto que vai sobre ela, sempre com contraste de leitura (4,5): texto branco
 * quando basta; senão escuro; se nenhum dos dois alcança, a cor é escurecida só o necessário para o branco servir.
 */
export function accentPair(hex: string): { fill: string; text: string } {
  const white = [255, 255, 255];
  const dark = "#0b0d14";
  let rgb: number[] = hexToRgb(hex);
  if (contrastRatio(white, rgb) >= 4.5) return { fill: hex, text: "#ffffff" };
  if (contrastRatio(hexToRgb(dark), rgb) >= 4.5) return { fill: hex, text: dark };
  for (let step = 0; step < 24 && contrastRatio(white, rgb) < 4.5; step++) rgb = rgb.map((v) => Math.round(v * 0.97));
  return { fill: `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`, text: "#ffffff" };
}

/** Texto sobre a cor de perigo: branco, ou escuro se o branco ficar abaixo de 3:1 (o mínimo para texto grande em negrito). */
function textOnDanger(hex: string, scale: number): string {
  // Interface pequena (abaixo de 90%): o texto deixa de contar como "grande", e o mínimo sobe para 4,5:1.
  const need = scale < 0.9 ? 4.5 : 3;
  return contrastRatio([255, 255, 255], hexToRgb(hex)) >= need ? "#ffffff" : "#1a0509";
}

/** Escreve o tema atual como variáveis CSS em :root. Chamado a cada mudança. */
export function applyTheme(s: ThemeSettings) {
  const theme = getTheme(s.themeId);
  const c = theme.colors;
  const chosen = s.accent ?? c.accent;
  const { fill: accent, text: accentText } = accentPair(chosen);
  const [r, g, b] = hexToRgb(accent);
  const root = document.documentElement.style;

  root.setProperty("--bg", c.bg);
  root.setProperty("--bg-elevated", c.bgElevated);
  root.setProperty("--surface", c.surface);
  root.setProperty("--surface-hover", c.surfaceHover);
  root.setProperty("--text", c.text);
  root.setProperty("--text-muted", c.textMuted);
  root.setProperty("--danger", c.danger);
  root.setProperty("--danger-text", textOnDanger(c.danger, s.fontScale));
  root.setProperty("--success", c.success);
  root.setProperty("--accent", accent);
  root.setProperty("--accent-rgb", `${r} ${g} ${b}`);
  root.setProperty("--accent-text", accentText);
  // Cores de destaque, sucesso, aviso e perigo quando usadas como cor de TEXTO.
  const dark = theme.id !== "daylight";
  const grounds = [c.bg, c.bgElevated, c.surface];
  root.setProperty("--accent-fg", readableColor(accent, grounds, dark));
  root.setProperty("--success-fg", readableColor(c.success, grounds, dark));
  root.setProperty("--danger-fg", readableColor(c.danger, grounds, dark));
  root.setProperty("--warn-fg", readableColor("#f0b429", grounds, dark));
  root.setProperty("--radius", `${s.radius / 16}rem`);
  root.setProperty("--font-scale", String(s.fontScale));
  // Com a interface bem ampliada a página do jogo precisa de menos texto para caber na tela.
  document.documentElement.classList.toggle("ui-large", s.fontScale > 1.25);
  root.setProperty("--glow", String(s.glow));
  document.documentElement.classList.toggle("reduce-motion", !!s.reduceMotion);
  root.colorScheme = theme.id === "daylight" ? "light" : "dark";
}
