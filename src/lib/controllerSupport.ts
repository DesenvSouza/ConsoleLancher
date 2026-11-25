import type { AppMeta } from "./steam";
import type { Game } from "./types";

export type ControllerSupport = "full" | "partial" | "supported" | "none" | "unknown";

export function steamControllerSupport(meta: AppMeta | undefined): ControllerSupport {
  if (!meta) return "unknown";
  if (meta.controllerSupport === 2 || meta.categories.includes(28)) return "full";
  if (meta.controllerSupport === 1 || meta.categories.includes(18)) return "partial";
  return "none";
}

/** Edições e acabamentos que não mudam de jogo: "Control Ultimate Edition" e "Control" são o mesmo jogo para este fim. */
const EDITION_WORDS = /\b(standard|deluxe|digital deluxe|premium|ultimate|complete|definitive|gold|special|collector'?s|goty|game of the year|directors? cut|edition|bundle)\b/g;

/** Título comparável entre lojas: sem acentos, marcas, pontuação nem palavras de edição. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/[™®©]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(EDITION_WORDS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const RANK: Record<ControllerSupport, number> = { full: 3, partial: 2, supported: 2, none: 1, unknown: 0 };

/**
 * Suporte a controle dos jogos da Steam por título. A Epic nem sempre marca o suporte a controle (Control e Hogwarts Legacy
 * têm, mas a etiqueta não está no catálogo dela); quando o mesmo jogo está na Steam, vale o que a Steam sabe.
 */
export function steamTwinIndex(games: Game[], appMeta: Record<string, AppMeta>): Map<string, ControllerSupport> {
  const index = new Map<string, ControllerSupport>();
  for (const game of games) {
    if (game.source !== "steam") continue;
    const meta = appMeta[game.appId ?? game.id];
    if (!meta) continue;
    const key = normalizeTitle(game.title);
    const support = steamControllerSupport(meta);
    if (key && RANK[support] > (RANK[index.get(key) ?? "unknown"])) index.set(key, support);
  }
  return index;
}

/** O que a loja da Steam disse de cada jogo da Epic procurado pelo nome (chave: título normalizado). */
export type SteamLookup = Record<string, { support: "full" | "partial" | "none" | "nomatch"; checkedAt: number }>;

export function gameControllerSupport(game: Game, meta: AppMeta | undefined, epicSupported?: boolean, override?: boolean, twins?: Map<string, ControllerSupport>, lookup?: SteamLookup): ControllerSupport {
  if (override !== undefined) return override ? "supported" : "none";
  if (game.source === "steam") return steamControllerSupport(meta);
  if (game.source !== "epic") return "unknown";
  if (epicSupported) return "supported";
  const twin = twins?.get(normalizeTitle(game.title));
  if (twin && hasControllerSupport(twin)) return twin;
  const found = lookup?.[normalizeTitle(game.title)]?.support;
  return found === "full" || found === "partial" ? found : "unknown";
}

export function hasControllerSupport(support: ControllerSupport): boolean {
  return support !== "none" && support !== "unknown";
}
