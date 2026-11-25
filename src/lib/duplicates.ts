import { STORE_ORDER, type StoreId } from "./stores";
import type { Game } from "./types";

/**
 * Jogos repetidos entre lojas (o mesmo jogo na Steam e na Epic, por exemplo): quando o jogador pede, o Início e a Biblioteca
 * mostram só uma cópia, dando preferência à loja escolhida. Nada é apagado: as cópias continuam instaladas, aparecem em
 * Downloads e voltam ao escolher "Mostrar todos" ou ao filtrar a Biblioteca por uma loja.
 */

export interface DuplicateOptions {
  /** A loja cuja cópia aparece. */
  preferred: StoreId;
  /** Se só uma cópia de outra loja está instalada, mostra a instalada (para o jogo continuar à mão). */
  preferInstalled: boolean;
  /** AppID do jogo em execução: a cópia que está rodando é sempre a mostrada. */
  runningAppId?: string | null;
}

/**
 * Só pacotes de conteúdo do mesmo jogo. Ficam de fora "Remastered", "Definitive Edition", "Special Edition" e afins: costumam
 * ser outra versão do jogo (um remaster), que o jogador quer ver separada.
 */
const SAME_GAME_SUFFIX =
  /\s+(?:(?:standard|deluxe|digital deluxe|premium|ultimate|complete|gold|collector s|collectors)\s+edition|goty(?:\s+edition)?|game of the year(?:\s+edition)?|director s cut|directors cut|versao do diretor)$/;

/** Título comparável entre lojas: sem acentos, marcas e pontuação, e sem o nome do pacote no fim. */
export function duplicateKey(title: string): string {
  let key = title
    .replace(/[™®©]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
  for (let previous = ""; previous !== key; ) {
    previous = key;
    key = key.replace(SAME_GAME_SUFFIX, "");
  }
  return key;
}

/** Os grupos do mesmo jogo presentes em mais de uma loja. Cópias dentro de uma mesma loja nunca formam um grupo sozinhas. */
export function duplicateGroups(games: Game[]): Game[][] {
  const byKey = new Map<string, Game[]>();
  for (const game of games) {
    const key = duplicateKey(game.title);
    if (!key) continue;
    const group = byKey.get(key);
    if (group) group.push(game);
    else byKey.set(key, [game]);
  }
  return [...byKey.values()].filter((group) => new Set(group.map((g) => g.source)).size > 1);
}

/** Qual loja do grupo aparece: a que está rodando, a instalada (se pedido), a preferida e, por último, a ordem das lojas. */
function winnerStore(group: Game[], options: DuplicateOptions): StoreId {
  const rank = (g: Game): number[] => [
    options.runningAppId && g.appId === options.runningAppId ? 0 : 1,
    options.preferInstalled && g.state === "not_installed" ? 1 : 0,
    g.source === options.preferred ? 0 : 1,
    STORE_ORDER.indexOf(g.source),
  ];
  const compare = (a: Game, b: Game) => {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  return [...group].sort(compare)[0].source;
}

/** A lista sem as cópias das outras lojas, na mesma ordem. A cópia mostrada leva a data da última vez jogada em qualquer uma. */
export function hideDuplicates(games: Game[], options: DuplicateOptions): Game[] {
  const hidden = new Set<string>();
  const played = new Map<string, number>();
  for (const group of duplicateGroups(games)) {
    const store = winnerStore(group, options);
    const last = Math.max(0, ...group.map((g) => g.lastPlayedAt ?? 0));
    for (const game of group) {
      if (game.source !== store) hidden.add(game.id);
      else if (last > (game.lastPlayedAt ?? 0)) played.set(game.id, last);
    }
  }
  if (hidden.size === 0) return games;
  return games.filter((g) => !hidden.has(g.id)).map((g) => (played.has(g.id) ? { ...g, lastPlayedAt: played.get(g.id) } : g));
}
