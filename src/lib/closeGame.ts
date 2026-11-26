import { te } from "../i18n";
import { useUI } from "../store/ui";
import { api } from "./api";
import type { Game } from "./types";

const warn = (error: unknown) => useUI.getState().showToast(te(error), "warning");

/** "Fechar o jogo": confirma o pedido normal ou, se o jogo já não responde, oferece forçar. */
export async function askCloseGame(game: Game): Promise<void> {
  const state = game.appId ? await api.gameCloseState(game.appId).catch(() => null) : null;
  if (game.appId && state?.force) useUI.getState().askForceClose(game.appId);
  else useUI.getState().askCloseGame(game.id);
}

/** O pedido normal de fechar; se o jogo não tem mais janela para recebê-lo, oferece forçar. */
export async function closeNormally(game: Game): Promise<void> {
  try {
    await api.closeGame(game);
  } catch (error) {
    const state = game.appId ? await api.gameCloseState(game.appId).catch(() => null) : null;
    if (game.appId && state?.force) useUI.getState().askForceClose(game.appId);
    else warn(error);
  }
}

/** Um jogo que continua rodando sem janela recebe a oferta de forçar; senão, só o aviso. */
export async function offerForceClose(appId: string, otherwise: string): Promise<void> {
  const state = await api.gameCloseState(appId).catch(() => null);
  if (state?.running && !state.window) useUI.getState().askForceClose(appId);
  else useUI.getState().showToast(otherwise, "warning");
}

/** "Voltar ao jogo": sem janela não há para onde ir. */
export async function resumeGame(game: Game): Promise<void> {
  const state = game.appId ? await api.gameCloseState(game.appId).catch(() => null) : null;
  if (game.appId && state?.running && !state.window) useUI.getState().askForceClose(game.appId);
  else await api.resumeGame().catch(warn);
}
