import { isTauri } from "../lib/api";

export const POWER_OPTIONS = [
  { id: "suspend", label: "Suspender o PC" },
  { id: "restart", label: "Reiniciar o PC" },
  { id: "shutdown", label: "Desligar o PC" },
] as const;

export type PowerOption = (typeof POWER_OPTIONS)[number]["id"];
export type PowerOptions = Record<PowerOption, boolean>;

const STORAGE_KEY = "launcher-guide-power";
const defaults: PowerOptions = { suspend: true, restart: true, shutdown: true };

export async function readPowerOptions(): Promise<PowerOptions> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PowerOptions>("guide_power_options");
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
}

export async function setPowerOption(option: PowerOption, enabled: boolean): Promise<PowerOptions> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PowerOptions>("guide_set_power_option", { option, enabled });
  }
  const updated = { ...await readPowerOptions(), [option]: enabled };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}
