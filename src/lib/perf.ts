import { isTauri } from "./api";

/** Contador de desempenho (FPS, frametime, hardware): tipos, padrões e a ponte com src-tauri/src/perf.rs. */

export type PerfPosition = "top-left" | "top-center" | "top-right" | "middle-left" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
export type PerfLayout = "vertical" | "horizontal";
export type PerfBackground = "glass" | "solid" | "none";
export type PerfNames = "short" | "full";

export const PERF_POSITIONS: { id: PerfPosition; name: string }[] = [
  { id: "top-left", name: "Canto superior esquerdo" },
  { id: "top-center", name: "Topo, no centro" },
  { id: "top-right", name: "Canto superior direito" },
  { id: "middle-left", name: "Meio, à esquerda" },
  { id: "middle-right", name: "Meio, à direita" },
  { id: "bottom-left", name: "Canto inferior esquerdo" },
  { id: "bottom-center", name: "Base, no centro" },
  { id: "bottom-right", name: "Canto inferior direito" },
];

export const PERF_LAYOUTS: { id: PerfLayout; name: string }[] = [
  { id: "vertical", name: "Em coluna" },
  { id: "horizontal", name: "Em linha" },
];

export const PERF_BACKGROUNDS: { id: PerfBackground; name: string }[] = [
  { id: "glass", name: "Vidro escuro" },
  { id: "solid", name: "Sólido" },
  { id: "none", name: "Sem fundo" },
];

export const PERF_NAMES: { id: PerfNames; name: string }[] = [
  { id: "short", name: "Curto (RTX 3060 Ti)" },
  { id: "full", name: "Completo (NVIDIA GeForce RTX 3060 Ti)" },
];

/** O que aparece no contador: cada item liga e desliga sozinho. */
export interface PerfItems {
  fps: boolean;
  average: boolean;
  low1: boolean;
  low01: boolean;
  frametime: boolean;
  graph: boolean;
  game: boolean;
  cpuName: boolean;
  cpuUsage: boolean;
  gpuName: boolean;
  gpuUsage: boolean;
  gpuTemp: boolean;
  gpuPower: boolean;
  vram: boolean;
  ram: boolean;
}

/** Cores em #RRGGBB. `fps` pode ser "auto": o número muda de cor conforme as faixas de FPS. */
export interface PerfColors {
  fps: string;
  text: string;
  label: string;
  background: string;
  accent: string;
  good: string;
  warn: string;
  bad: string;
}

export interface PerfConfig {
  enabled: boolean;
  /** Só aparece quando há um jogo sendo medido (fora disso, some). */
  onlyInGame: boolean;
  position: PerfPosition;
  /** Tamanho (1 = 100%). */
  scale: number;
  layout: PerfLayout;
  background: PerfBackground;
  /** Opacidade do fundo (0 a 1). */
  opacity: number;
  names: PerfNames;
  items: PerfItems;
  colors: PerfColors;
  /** FPS a partir do qual o número fica "bom" (verde) e "aceitável" (amarelo); abaixo é "ruim" (vermelho). */
  fpsGood: number;
  fpsWarn: number;
  /** Temperatura (°C) a partir da qual avisa (amarelo) e alerta (vermelho). */
  tempWarn: number;
  tempHot: number;
}

export const DEFAULT_PERF: PerfConfig = {
  enabled: false,
  onlyInGame: true,
  position: "top-left",
  scale: 1,
  layout: "vertical",
  background: "glass",
  opacity: 0.72,
  names: "short",
  items: {
    fps: true,
    average: true,
    low1: true,
    low01: false,
    frametime: true,
    graph: true,
    game: false,
    cpuName: false,
    cpuUsage: true,
    gpuName: false,
    gpuUsage: true,
    gpuTemp: true,
    gpuPower: false,
    vram: true,
    ram: false,
  },
  colors: { fps: "auto", text: "#ffffff", label: "#9aa3b5", background: "#0b0d14", accent: "#3b9cff", good: "#3ddc84", warn: "#ffd43b", bad: "#ff5c5c" },
  fpsGood: 60,
  fpsWarn: 30,
  tempWarn: 75,
  tempHot: 88,
};

export type PerfPreset = "complete" | "compact" | "minimal" | "custom";

/** Modelos prontos: mudam só o que aparece (e a disposição); cores e posição ficam como estão. */
export const PERF_PRESETS: { id: Exclude<PerfPreset, "custom">; name: string; layout: PerfLayout; items: Partial<PerfItems> }[] = [
  {
    id: "complete",
    name: "Completo",
    layout: "vertical",
    items: { fps: true, average: true, low1: true, low01: true, frametime: true, graph: true, game: true, cpuName: true, cpuUsage: true, gpuName: true, gpuUsage: true, gpuTemp: true, gpuPower: true, vram: true, ram: true },
  },
  {
    id: "compact",
    name: "Compacto",
    layout: "vertical",
    items: { fps: true, average: true, low1: true, low01: false, frametime: true, graph: true, game: false, cpuName: false, cpuUsage: true, gpuName: false, gpuUsage: true, gpuTemp: true, gpuPower: false, vram: false, ram: false },
  },
  {
    id: "minimal",
    name: "Mínimo",
    layout: "horizontal",
    items: { fps: true, average: false, low1: false, low01: false, frametime: false, graph: false, game: false, cpuName: false, cpuUsage: false, gpuName: false, gpuUsage: false, gpuTemp: false, gpuPower: false, vram: false, ram: false },
  },
];

/** Qual modelo a configuração atual reproduz (ou "custom" se foi ajustada à mão). */
export function currentPreset(config: PerfConfig): PerfPreset {
  const found = PERF_PRESETS.find((preset) => preset.layout === config.layout && (Object.keys(config.items) as (keyof PerfItems)[]).every((key) => config.items[key] === (preset.items[key] ?? false)));
  return found?.id ?? "custom";
}

/** Cores à escolha (texto, números, destaque, gráfico). */
export const PERF_PALETTE: { hex: string; name: string }[] = [
  { hex: "#ffffff", name: "Branco" },
  { hex: "#c9ced9", name: "Cinza claro" },
  { hex: "#9aa3b5", name: "Prata" },
  { hex: "#3b9cff", name: "Azul" },
  { hex: "#22d3ee", name: "Ciano" },
  { hex: "#14d2b0", name: "Turquesa" },
  { hex: "#3ddc84", name: "Verde" },
  { hex: "#a3e635", name: "Lima" },
  { hex: "#ffd43b", name: "Amarelo" },
  { hex: "#f5c542", name: "Dourado" },
  { hex: "#ff9f43", name: "Laranja" },
  { hex: "#ff5c5c", name: "Vermelho" },
  { hex: "#ff6fae", name: "Rosa" },
  { hex: "#a78bfa", name: "Roxo" },
];

/** Cores de fundo à escolha (as escuras funcionam melhor sobre jogos). */
export const PERF_BACKGROUND_PALETTE: { hex: string; name: string }[] = [
  { hex: "#000000", name: "Preto" },
  { hex: "#0b0d14", name: "Grafite escuro" },
  { hex: "#1c1f27", name: "Grafite" },
  { hex: "#0b1530", name: "Azul-noite" },
  { hex: "#2a0c18", name: "Vinho" },
  { hex: "#0b2218", name: "Verde-floresta" },
  { hex: "#1a1030", name: "Roxo-escuro" },
  { hex: "#f3f5fa", name: "Branco" },
];

export const PERF_SCALES = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
export const PERF_OPACITIES = [0.2, 0.35, 0.5, 0.65, 0.72, 0.8, 0.9, 1];
export const PERF_FPS_GOOD = [30, 45, 60, 75, 90, 100, 120, 144];
export const PERF_FPS_WARN = [15, 20, 24, 30, 40, 45, 60, 90];
export const PERF_TEMP_WARN = [60, 65, 70, 75, 80];
export const PERF_TEMP_HOT = [75, 80, 85, 88, 90, 95];

// ───────── Estado vindo do Rust ─────────

export type PerfCapture = { state: "idle" | "starting" | "running" | "denied" } | { state: "failed"; message: string };

export interface FrameSummary {
  fps: number;
  average: number;
  low1: number;
  low01: number;
  /** Tempo do último quadro (ms) e o pior dos últimos 120. */
  frametime: number;
  frametimeMax: number;
  frames: number;
  /** Os últimos tempos de quadro (ms), do mais antigo ao mais novo. */
  history: number[];
}

export interface PerfSnapshot {
  config: Partial<PerfConfig>;
  capture: PerfCapture;
  member: boolean;
  game: { pid: number; process: string; summary: FrameSummary } | null;
  hw: {
    cpu: { name: string; shortName: string; usage: number | null; temperature: number | null };
    gpu: { name: string; shortName: string; usage: number | null; temperature: number | null; powerPercent: number | null; fanRpm: number | null; vramUsed: number | null; vramTotal: number | null };
    ram: { usedMb: number; totalMb: number };
  };
  screenWidth: number;
  /** O launcher está na frente: a janela do contador se esconde. */
  launcherInFront: boolean;
}

export interface PerfStatus {
  enabled: boolean;
  capture: PerfCapture;
}

/** Junta `patch` em `base` por campo (objetos), como o Rust faz. */
export function mergeConfig<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) out[key] = mergeConfig(out[key], value);
  return out as T;
}

/**
 * Completa um pedido de mudança para as faixas continuarem em ordem: quem foi mudado fica como pedido e a vizinha se ajusta
 * para a opção mais próxima que respeite "aceitável < bom" e "atenção < crítica".
 */
export function withOrderedLimits<P extends object>(current: PerfConfig, patch: P): P & Partial<PerfConfig> {
  const out = { ...patch } as P & Partial<PerfConfig>;
  const pair = (low: "fpsWarn" | "tempWarn", high: "fpsGood" | "tempHot", lows: number[], highs: number[]) => {
    const a = out[low] ?? current[low];
    const b = out[high] ?? current[high];
    if (a < b) return;
    const above = highs.find((v) => v > a);
    const below = [...lows].reverse().find((v) => v < b);
    // Mudou o valor de baixo: sobe o de cima. Mudou o de cima (ou os dois vieram errados): desce o de baixo.
    if (out[low] !== undefined && out[high] === undefined && above !== undefined) out[high] = above;
    else if (below !== undefined) out[low] = below;
    else if (above !== undefined) out[high] = above;
  };
  pair("fpsWarn", "fpsGood", PERF_FPS_WARN, PERF_FPS_GOOD);
  pair("tempWarn", "tempHot", PERF_TEMP_WARN, PERF_TEMP_HOT);
  return out;
}

/** A configuração com os padrões nos campos que faltam (o arquivo pode ser de uma versão mais antiga) e as faixas em ordem. */
export function withDefaults(config: Partial<PerfConfig> | null | undefined): PerfConfig {
  const full = mergeConfig(DEFAULT_PERF, config ?? {});
  return { ...full, ...withOrderedLimits(full, {}) };
}

// ───────── Ponte ─────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

// No navegador (sem o Tauri) o contador é só uma simulação, para a tela poder ser vista e testada.
let mockConfig: PerfConfig = DEFAULT_PERF;
// Para ver a janela do contador no navegador: /?perf=1 (e, se quiser, &cfg=<JSON com os campos a mudar>).
if (!isTauri && typeof location !== "undefined" && new URLSearchParams(location.search).has("perf")) {
  let extra: unknown = {};
  try {
    extra = JSON.parse(new URLSearchParams(location.search).get("cfg") ?? "{}");
  } catch {
    // JSON inválido: ignora
  }
  mockConfig = mergeConfig({ ...DEFAULT_PERF, enabled: true, onlyInGame: false }, extra);
}

/** Dados de exemplo animados: usados no navegador e na prévia quando ainda não há jogo sendo medido. */
export function demoSnapshot(config: PerfConfig, now = Date.now()): PerfSnapshot {
  const wave = (speed: number, phase = 0) => (Math.sin(now / speed + phase) + 1) / 2;
  const history = Array.from({ length: 120 }, (_, i) => {
    const t = now - (119 - i) * 8;
    const base = 6.9 + wave(900, i / 9) * 1.2;
    const stutter = Math.sin(t / 37) > 0.985 ? 14 : 0;
    return Math.round((base + stutter) * 10) / 10;
  });
  const frametime = history[history.length - 1];
  return {
    config,
    capture: { state: "running" },
    member: true,
    game: {
      pid: 4242,
      process: "game.exe",
      summary: {
        fps: Math.round(1000 / frametime),
        average: 141,
        low1: 112,
        low01: 94,
        frametime,
        frametimeMax: Math.max(...history),
        frames: Math.round(1000 / frametime),
        history,
      },
    },
    hw: {
      cpu: { name: "AMD Ryzen 7 7700 8-Core Processor", shortName: "Ryzen 7 7700", usage: Math.round(18 + wave(2500) * 22), temperature: null },
      gpu: {
        name: "AMD Radeon RX 9070 XT",
        shortName: "RX 9070 XT",
        usage: Math.round(68 + wave(1800, 1) * 26),
        temperature: Math.round(61 + wave(7000) * 12),
        powerPercent: Math.round(70 + wave(2200) * 20),
        fanRpm: 1450,
        vramUsed: 7400 + Math.round(wave(5000) * 400),
        vramTotal: 16304,
      },
      ram: { usedMb: 14600, totalMb: 32768 },
    },
    screenWidth: typeof window !== "undefined" ? window.screen.width : 1920,
    launcherInFront: false,
  };
}

export const perf = {
  getConfig: async (): Promise<PerfConfig> => (isTauri ? withDefaults(await invoke<Partial<PerfConfig>>("perf_get_config")) : mockConfig),
  setConfig: async (patch: unknown): Promise<PerfConfig> => {
    if (!isTauri) {
      mockConfig = mergeConfig(mockConfig, patch);
      return mockConfig;
    }
    return withDefaults(await invoke<Partial<PerfConfig>>("perf_set_config", { patch }));
  },
  snapshot: async (): Promise<PerfSnapshot> => (isTauri ? invoke<PerfSnapshot>("perf_snapshot") : demoSnapshot(mockConfig)),
  status: async (): Promise<PerfStatus> => (isTauri ? invoke<PerfStatus>("perf_status") : { enabled: mockConfig.enabled, capture: { state: "running" } }),
  grantPermission: async (): Promise<void> => {
    if (isTauri) await invoke("perf_grant_permission");
  },
};
