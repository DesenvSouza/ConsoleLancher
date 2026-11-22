export interface ThemeColors {
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceHover: string;
  text: string;
  textMuted: string;
  accent: string;
  danger: string;
  success: string;
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
}

export const THEMES: Theme[] = [
  {
    id: "midnight",
    name: "Meia-noite",
    colors: { bg: "#0b0d14", bgElevated: "#11141f", surface: "#171b29", surfaceHover: "#212638", text: "#eef1fb", textMuted: "#8a91a8", accent: "#7c5cff", danger: "#ff5470", success: "#3ddc97" },
  },
  {
    id: "oled",
    name: "OLED preto",
    colors: { bg: "#000000", bgElevated: "#08080a", surface: "#111114", surfaceHover: "#1b1b20", text: "#f4f4f6", textMuted: "#7c7c88", accent: "#00d1b2", danger: "#ff5470", success: "#3ddc97" },
  },
  {
    id: "aurora",
    name: "Aurora",
    colors: { bg: "#0a1220", bgElevated: "#0f1a2e", surface: "#15233c", surfaceHover: "#1d3052", text: "#e9f3ff", textMuted: "#7f95b5", accent: "#3b9cff", danger: "#ff6b81", success: "#42e0a5" },
  },
  {
    id: "ember",
    name: "Brasa",
    colors: { bg: "#120c0b", bgElevated: "#1b1210", surface: "#261917", surfaceHover: "#35231f", text: "#fff1ea", textMuted: "#b09088", accent: "#ff7a3d", danger: "#ff4d5e", success: "#6fdc8c" },
  },
  {
    id: "daylight",
    name: "Claro",
    colors: { bg: "#eef0f6", bgElevated: "#ffffff", surface: "#ffffff", surfaceHover: "#e3e7f2", text: "#161a28", textMuted: "#5d667f", accent: "#5b3df5", danger: "#d92f4c", success: "#16a46a" },
  },
];

/** Cores de destaque oferecidas na tela de configurações (null = usar a do tema). */
export const ACCENT_PRESETS: { name: string; value: string | null }[] = [
  { name: "Padrão do tema", value: null },
  { name: "Violeta", value: "#7c5cff" },
  { name: "Turquesa", value: "#00d1b2" },
  { name: "Rosa", value: "#ff5c8a" },
  { name: "Âmbar", value: "#ffb020" },
  { name: "Azul", value: "#3b9cff" },
  { name: "Verde", value: "#4ade80" },
  { name: "Laranja", value: "#ff7a3d" },
];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
