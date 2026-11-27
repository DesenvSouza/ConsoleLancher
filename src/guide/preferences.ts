import { isTauri } from "../lib/api";

export const POWER_OPTIONS = [
  { id: "suspend", label: "Suspender o PC" },
  { id: "restart", label: "Reiniciar o PC" },
  { id: "shutdown", label: "Desligar o PC" },
] as const;

export type PowerOption = (typeof POWER_OPTIONS)[number]["id"];
export type PowerOptions = Record<PowerOption, boolean>;
/** O que o menu do Guia guarda: os botões de energia e se o jogo pausa enquanto ele está aberto. */
export type GuideOptions = PowerOptions & { pauseGame: boolean };
export type GuideOption = keyof GuideOptions;

const STORAGE_KEY = "launcher-guide-power";
const defaults: GuideOptions = { suspend: true, restart: true, shutdown: true, pauseGame: false };

export async function readPowerOptions(): Promise<GuideOptions> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GuideOptions>("guide_power_options");
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
}

export async function setPowerOption(option: GuideOption, enabled: boolean): Promise<GuideOptions> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GuideOptions>("guide_set_power_option", { option: option === "pauseGame" ? "pause_game" : option, enabled });
  }
  const updated = { ...await readPowerOptions(), [option]: enabled };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}
