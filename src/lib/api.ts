import type { Game } from "./types";

/** true quando rodando dentro do Tauri; false no navegador (npm run dev). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call(cmd: string, args?: Record<string, unknown>): Promise<void> {
  if (!isTauri) {
    console.info(`[mock] ${cmd}`, args ?? "");
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd, args);
}

/** Início com o Windows e modo console (o launcher no lugar da área de trabalho). */
export interface StartupStatus {
  /** false no modo de desenvolvimento. */
  available: boolean;
  autostart: boolean;
  console: boolean;
  /** Este launcher está rodando agora como a área de trabalho (sem Explorer). */
  consoleActive: boolean;
  /** Script que desfaz o modo console por fora do launcher. */
  restoreScript: string;
}

// No navegador (sem o Tauri) o estado é só simulado, para a tela poder ser vista e testada.
let mockStartup: StartupStatus = { available: true, autostart: false, console: false, consoleActive: false, restoreScript: "C:\Users\Jogador\AppData\Roaming\launcher\Voltar-ao-Explorer.bat" }; // i18n-ignore

async function invokeStartup(cmd: string, args?: Record<string, unknown>): Promise<StartupStatus> {
  if (!isTauri) {
    if (cmd === "startup_set_autostart") mockStartup = { ...mockStartup, autostart: Boolean(args?.enabled) };
    if (cmd === "startup_set_console") mockStartup = { ...mockStartup, console: Boolean(args?.enabled) };
    return mockStartup;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<StartupStatus>(cmd, args);
}

/** Volume, saída de áudio, rede e bateria do controle (o que a bandeja do Windows mostraria). */
export interface SystemOutput { id: string; name: string; current: boolean }
export interface SystemNetwork {
  kind: "wifi" | "wired" | "none";
  /** Nome da rede Wi-Fi. */
  name: string;
  /** Sinal do Wi-Fi, de 0 a 100. */
  signal: number;
  internet: boolean;
  /** O PC tem adaptador Wi-Fi (senão as opções de Wi-Fi nem aparecem). */
  wifiAdapter: boolean;
}
export interface SystemBluetooth {
  /** O PC tem adaptador Bluetooth. */
  adapter: boolean;
  /** Dispositivos emparelhados conectados agora. */
  connected: number;
}
export type PadBattery = "wired" | "empty" | "low" | "medium" | "full" | "unknown";
export interface SystemPad { number: number; battery: PadBattery }
export interface SystemVolume { percent: number; muted: boolean }
export interface SystemStatus {
  /** null quando o Windows não respondeu sobre o áudio. */
  volume: SystemVolume | null;
  outputs: SystemOutput[];
  network: SystemNetwork;
  bluetooth: SystemBluetooth;
  pads: SystemPad[];
}

// No navegador (sem o Tauri) o estado é simulado, para as telas poderem ser vistas e testadas.
let mockSystem: SystemStatus = {
  volume: { percent: 60, muted: false },
  outputs: [
    { id: "tv", name: "TV (NVIDIA High Definition Audio)", current: true },
    { id: "fone", name: "Fones (Realtek Audio)", current: false },
    { id: "monitor", name: "Monitor (NVIDIA High Definition Audio)", current: false },
  ],
  network: { kind: "wifi", name: "Casa 5G", signal: 72, internet: true, wifiAdapter: true },
  bluetooth: { adapter: true, connected: 1 },
  pads: [{ number: 1, battery: "medium" }],
};

async function invokeSystem<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    if (cmd === "system_set_volume") mockSystem = { ...mockSystem, volume: { percent: Number(args?.percent), muted: false } };
    if (cmd === "system_set_mute") mockSystem = { ...mockSystem, volume: { percent: mockSystem.volume?.percent ?? 0, muted: Boolean(args?.muted) } };
    if (cmd === "system_set_output") mockSystem = { ...mockSystem, outputs: mockSystem.outputs.map((o) => ({ ...o, current: o.id === args?.id })) };
    return (cmd === "system_status" || cmd === "system_set_output" ? mockSystem : mockSystem.volume) as T;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Wi-Fi e Bluetooth (painel Sistema). */
export type WifiSecurity = "open" | "wpa2" | "wpa3" | "wpa" | "enterprise" | "other";
export interface WifiNetwork {
  ssid: string;
  /** 0 a 100. */
  signal: number;
  security: WifiSecurity;
  /** O Windows já guarda a senha desta rede. */
  known: boolean;
  connected: boolean;
}
export interface WifiList {
  /** false quando o PC não tem Wi-Fi (ou o adaptador está desligado). */
  adapter: boolean;
  networks: WifiNetwork[];
}
export interface BtDevice {
  id: string;
  name: string;
  paired: boolean;
  connected: boolean;
  kind: "audio" | "input" | "other";
}
export interface BtList {
  adapter: boolean;
  devices: BtDevice[];
}

// Simulação para o navegador (sem o Tauri).
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let mockWifi: WifiNetwork[] = [
  { ssid: "Casa 5G", signal: 82, security: "wpa2", known: true, connected: true },
  { ssid: "Casa 2.4G", signal: 64, security: "wpa2", known: true, connected: false },
  { ssid: "Vizinho", signal: 40, security: "wpa3", known: false, connected: false },
  { ssid: "Cafe Livre", signal: 25, security: "open", known: false, connected: false },
  { ssid: "Empresa", signal: 55, security: "enterprise", known: false, connected: false },
];
let mockBt: BtDevice[] = [
  { id: "fone", name: "Fone JBL Live 770NC", paired: true, connected: true, kind: "audio" },
  { id: "controle", name: "Controle Xbox", paired: true, connected: false, kind: "input" },
  { id: "caixa", name: "Caixa QCY", paired: true, connected: false, kind: "audio" },
];
const mockNearby: BtDevice[] = [{ id: "tv", name: "[TV] Samsung 55", paired: false, connected: false, kind: "audio" }];

async function invokeWireless<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  await sleep(cmd === "bluetooth_discover" ? 2500 : cmd === "wifi_list" && args?.rescan ? 1200 : 300);
  switch (cmd) {
    case "wifi_list": return { adapter: true, networks: mockWifi } as T;
    case "wifi_connect":
      mockWifi = mockWifi.map((n) => ({ ...n, connected: n.ssid === args?.ssid, known: n.known || n.ssid === args?.ssid }));
      return undefined as T;
    case "wifi_disconnect": mockWifi = mockWifi.map((n) => ({ ...n, connected: false })); return undefined as T;
    case "wifi_forget": mockWifi = mockWifi.map((n) => (n.ssid === args?.ssid ? { ...n, known: false, connected: false } : n)); return undefined as T;
    case "bluetooth_paired": return { adapter: true, devices: mockBt } as T;
    case "bluetooth_discover": return { adapter: true, devices: mockNearby } as T;
    case "bluetooth_pair": mockBt = [...mockBt, { ...mockNearby[0], paired: true }]; return undefined as T;
    case "bluetooth_set_connected": mockBt = mockBt.map((d) => (d.id === args?.id ? { ...d, connected: Boolean(args?.connect) } : d)); return undefined as T;
    case "bluetooth_forget": mockBt = mockBt.filter((d) => d.id !== args?.id); return undefined as T;
    default: return undefined as T;
  }
}

/**
 * Ponte com o backend Rust. Cada função vira um comando em src-tauri/src/lib.rs.
 * Por enquanto só a Steam está ligada; as outras lojas entram no marco M5.
 */
export const api = {
  launchGame: (g: Game) => call("steam_run", { appId: g.appId }),
  closeGame: (g: Game) => call("steam_close_game", { appId: g.appId }),
  installGame: (g: Game) => call("steam_install", { appId: g.appId }),
  uninstallGame: (g: Game) => call("steam_uninstall", { appId: g.appId }),
  /** Cancelar um download é o mesmo comando de remover: a Steam apaga o que já baixou. */
  cancelInstall: (g: Game) => call("steam_uninstall", { appId: g.appId }),
  /** Pede à Steam para verificar a integridade dos arquivos do jogo. */
  verifyGame: (g: Game) => call("steam_validate", { appId: g.appId }),
  /** Abre a página do jogo na loja (dentro da Steam). */
  openStorePage: (g: Game) => call("steam_store", { appId: g.appId }),
  setSoundEffects: (enabled: boolean) => call("sound_set_enabled", { enabled }),
  playSoundEffect: (cue: string) => call("sound_play", { cue }),
  exitToDesktop: () => call("exit_to_desktop"),
  systemStatus: () => invokeSystem<SystemStatus>("system_status"),
  setVolume: (percent: number) => invokeSystem<SystemVolume>("system_set_volume", { percent }),
  setMute: (muted: boolean) => invokeSystem<SystemVolume>("system_set_mute", { muted }),
  setOutput: (id: string) => invokeSystem<SystemStatus>("system_set_output", { id }),
  wifiList: (rescan: boolean) => invokeWireless<WifiList>("wifi_list", { rescan }),
  wifiConnect: (ssid: string, password?: string) => invokeWireless<void>("wifi_connect", { ssid, password: password ?? null }),
  wifiDisconnect: () => invokeWireless<void>("wifi_disconnect"),
  wifiForget: (ssid: string) => invokeWireless<void>("wifi_forget", { ssid }),
  bluetoothPaired: () => invokeWireless<BtList>("bluetooth_paired"),
  bluetoothDiscover: () => invokeWireless<BtList>("bluetooth_discover"),
  bluetoothPair: (id: string) => invokeWireless<void>("bluetooth_pair", { id }),
  bluetoothSetConnected: (id: string, connect: boolean) => invokeWireless<void>("bluetooth_set_connected", { id, connect }),
  bluetoothForget: (id: string) => invokeWireless<void>("bluetooth_forget", { id }),
  startupStatus: () => invokeStartup("startup_status"),
  setAutostart: (enabled: boolean) => invokeStartup("startup_set_autostart", { enabled }),
  setConsoleMode: (enabled: boolean) => invokeStartup("startup_set_console", { enabled }),

  /** Texto da área de transferência (botão "Colar" do teclado na tela). */
  readClipboard: async (): Promise<string> => {
    if (!isTauri) return (await navigator.clipboard?.readText?.().catch(() => "")) ?? "";
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("read_clipboard");
  },

  /** Traz o launcher de volta para a frente (quando o jogo fecha). */
  bringToFront: async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (await win.isMinimized()) await win.unminimize();
    if (!(await win.isFocused())) await win.setFocus();
  },

  /** Alterna tela cheia (F11). A janela já abre em tela cheia, cobrindo a barra do Windows. */
  toggleFullscreen: async () => {
    if (!isTauri) {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      return;
    }
    await call("toggle_fullscreen");
  },
};
