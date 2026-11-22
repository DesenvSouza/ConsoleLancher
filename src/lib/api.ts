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

/**
 * Ponte com o backend Rust. Cada função vira um comando em src-tauri/src/lib.rs.
 * Por enquanto só a Steam está ligada; as outras lojas entram no marco M5.
 */
export const api = {
  launchGame: (g: Game) => call("steam_run", { appId: g.appId }),
  installGame: (g: Game) => call("steam_install", { appId: g.appId }),
  uninstallGame: (g: Game) => call("steam_uninstall", { appId: g.appId }),
  /** Cancelar um download é o mesmo comando de remover: a Steam apaga o que já baixou. */
  cancelInstall: (g: Game) => call("steam_uninstall", { appId: g.appId }),
  /** Pede à Steam para verificar a integridade dos arquivos do jogo. */
  verifyGame: (g: Game) => call("steam_validate", { appId: g.appId }),
  /** Abre a página do jogo na loja (dentro da Steam). */
  openStorePage: (g: Game) => call("steam_store", { appId: g.appId }),
  exitToDesktop: () => call("exit_to_desktop"),

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
    await win.unminimize();
    await win.setFocus();
  },

  /** Alterna tela cheia (F11). A janela já abre em tela cheia, cobrindo a barra do Windows. */
  toggleFullscreen: async () => {
    if (!isTauri) {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      return;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  },
};
