import { isTauri } from "./api";

/** Espelham as structs de src-tauri/src/epic.rs (camelCase). */
export interface EpicStatus {
  signedIn: boolean;
  displayName?: string;
  /** A Epic Games Launcher está instalada neste PC. */
  launcherInstalled: boolean;
}

export interface EpicGame {
  appName: string;
  namespace: string;
  catalogItemId: string;
  title: string;
  developer: string;
  description: string;
  imageTall?: string;
  imageWide?: string;
}

export type EpicCatalogGame = Pick<EpicGame, "namespace" | "catalogItemId" | "title">;

export function epicCatalogKey(game: Pick<EpicCatalogGame, "namespace" | "catalogItemId">): string {
  return `${game.namespace}:${game.catalogItemId}`;
}

export interface EpicInstalled {
  appName: string;
  namespace: string;
  catalogItemId: string;
  title: string;
  installLocation: string;
  launchExecutable: string;
  sizeBytes: number;
  incomplete: boolean;
  /** "egl" (instalado pela Epic Games Launcher) ou "legendary" (instalado pelo launcher, sem a Epic Games Launcher). */
  managedBy: "egl" | "legendary";
}

/** Andamento de uma instalação feita pelo launcher (Legendary). */
export interface EpicInstallState {
  status: "preparing" | "running" | "done" | "failed" | "cancelled";
  /** 0 a 100. */
  percent: number;
  message?: string;
}

export interface EpicLoginEvent {
  state: "done" | "cancelled" | "error";
  status?: EpicStatus;
  error?: string;
}

export interface EpicRunning {
  appName: string;
  title: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

/** Ponte com src-tauri/src/epic.rs. No navegador (sem o Tauri) não há Epic: tudo devolve vazio. */
export const epic = {
  status: async (): Promise<EpicStatus> => (isTauri ? invoke<EpicStatus>("epic_status") : { signedIn: false, launcherInstalled: false }),
  openLogin: async (): Promise<void> => {
    if (isTauri) await invoke("epic_open_login");
  },
  /** Abre a página de login da Epic numa janela do launcher; o resultado chega pelo evento "epic-login" (ver `onLogin`). */
  openLoginWindow: async (): Promise<void> => {
    if (isTauri) await invoke("epic_login_window");
  },
  onLogin: async (handler: (event: EpicLoginEvent) => void): Promise<() => void> => {
    if (!isTauri) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<EpicLoginEvent>("epic-login", (e) => handler(e.payload));
  },
  signIn: (code: string) => invoke<EpicStatus>("epic_sign_in", { code }),
  signOut: async (): Promise<void> => {
    if (isTauri) await invoke("epic_sign_out");
  },
  library: () => invoke<EpicGame[]>("epic_library"),
  controllerSupport: (games: EpicCatalogGame[]) => invoke<Record<string, boolean>>("epic_controller_support", { games }),
  installed: async (): Promise<EpicInstalled[]> => (isTauri ? invoke<EpicInstalled[]>("epic_installed") : []),
  launch: (appName: string) => invoke<void>("epic_launch", { appName }),
  legendaryAvailable: async (): Promise<boolean> => (isTauri ? invoke<boolean>("epic_legendary_available") : false),
  installStart: (appName: string) => invoke<void>("epic_install_start", { appName }),
  installStates: async (): Promise<Record<string, EpicInstallState>> => (isTauri ? invoke<Record<string, EpicInstallState>>("epic_install_states") : {}),
  installCancel: (appName: string) => invoke<void>("epic_install_cancel", { appName }),
  installForget: (appName: string) => invoke<void>("epic_install_forget", { appName }),
  uninstall: (appName: string) => invoke<void>("epic_uninstall", { appName }),
  install: (namespace: string, catalogItemId: string, appName: string) => invoke<void>("epic_install", { namespace, catalogItemId, appName }),
  openLibrary: () => invoke<void>("epic_open_library"),
  running: async (): Promise<EpicRunning | null> => (isTauri ? invoke<EpicRunning | null>("epic_running") : null),
  closeGame: () => invoke<void>("epic_close_game"),
};
