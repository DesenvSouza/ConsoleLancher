import { compareText } from "../i18n";
import type { HomeBlock, BlockKind } from "../store/home";
import type { Game } from "./types";

const byTitle = (a: Game, b: Game) => compareText(a.title, b.title);

/** Os jogos de uma fileira da página inicial, na ordem dela. */
export function pickBlockGames(kind: BlockKind, games: Game[]): Game[] {
  switch (kind) {
    case "recent":
      return games.filter((g) => g.lastPlayedAt).sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
    case "favorites":
      return games.filter((g) => g.favorite).sort(byTitle);
    case "installed":
      return games.filter((g) => g.state === "installed").sort(byTitle);
    case "notInstalled":
      return games.filter((g) => g.state !== "installed").sort(byTitle);
    default:
      return [...games].sort(byTitle);
  }
}

/**
 * As fileiras da página inicial (as ligadas e que têm jogos), conforme as opções do jogador. Serve à própria Início e à
 * prévia das configurações, para as duas mostrarem sempre o mesmo.
 */
export function homeRows(blocks: HomeBlock[], games: Game[], hideNotInstalled: boolean): { block: HomeBlock; games: Game[] }[] {
  return blocks
    .filter((b) => b.enabled)
    .map((b) => {
      // Opção "esconder não instalados": só a fileira "Não instalados" os mostra.
      const list = pickBlockGames(b.kind, hideNotInstalled && b.kind !== "notInstalled" ? games.filter((g) => g.state !== "not_installed") : games);
      return { block: b, games: b.limit > 0 ? list.slice(0, b.limit) : list };
    })
    .filter((r) => r.games.length > 0);
}
