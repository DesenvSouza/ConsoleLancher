import { normalizeText } from "./util";
import type { AppMeta, Collection, FilterGroup, FilterSpec } from "./steam";
import type { Game } from "./types";

// Regras de uma aba da biblioteca. Todas as condições escolhidas precisam valer ao mesmo tempo (E).

export type InstallRule = "any" | "installed" | "not_installed" | "installing";
export type PlayedRule = "any" | "never" | "played" | "recent";
/** Jogos ocultos na Steam: mostrar com os demais, esconder, ou mostrar só eles. */
export type HiddenMode = "show" | "hide" | "only";

export interface TabRule {
  install: InstallRule;
  /** Só os favoritos do launcher. */
  favorite: boolean;
  played: PlayedRule;
  /** Tempo de jogo mínimo, em horas (0 = sem limite). */
  minHours: number;
  /** Tamanho mínimo no disco, em GB (0 = sem limite; só jogos instalados têm tamanho). */
  minGB: number;
  /** Coleção da Steam a que o jogo precisa pertencer. */
  collectionId: string | null;
  /** Texto que o nome precisa conter. */
  text: string;
}

export const emptyRule = (): TabRule => ({ install: "any", favorite: false, played: "any", minHours: 0, minGB: 0, collectionId: null, text: "" });

export const INSTALL_LABELS: Record<InstallRule, string> = { any: "Qualquer", installed: "Instalados", not_installed: "Não instalados", installing: "Baixando" };
export const PLAYED_LABELS: Record<PlayedRule, string> = { any: "Qualquer", never: "Nunca jogados", played: "Já jogados", recent: "Últimos 30 dias" };
export const HIDDEN_LABELS: Record<HiddenMode, string> = { show: "Mostrar com os demais", hide: "Esconder", only: "Mostrar só os ocultos" };

export interface RuleContext {
  /** id da coleção → AppIDs dos jogos dela. */
  collections: Map<string, Set<string>>;
  now: number;
}

const DAY = 86_400_000;

/**
 * Monta o contexto das regras. As coleções comuns trazem a lista de jogos; as dinâmicas (filtros salvos da Steam,
 * como "suporte a controle") são avaliadas aqui, jogo a jogo, com os dados que a Steam guarda de cada um.
 */
export function makeContext(collections: Collection[], now = Date.now(), games: Game[] = [], meta: Record<string, AppMeta> = {}): RuleContext {
  const map = new Map<string, Set<string>>();
  for (const c of collections) {
    if (c.dynamic && c.filter && isSupportedSpec(c.filter)) {
      map.set(c.id, new Set(games.filter((g) => matchesFilterSpec(g, c.filter!, meta[g.appId ?? g.id], now)).map((g) => g.appId ?? g.id)));
    } else {
      map.set(c.id, new Set(c.appIds));
    }
  }
  return { collections: map, now };
}

// ───────── Coleções dinâmicas da Steam ─────────
// Os filtros seguem a lógica do cliente da Steam (steamui): cada grupo vale se não tem opções, ou se alguma
// (união) / todas (interseção) as opções valem; e os grupos precisam valer todos ao mesmo tempo.

/** Grupos que ainda não sei avaliar: 5 assinatura, 6 jogos dos amigos, 7 idiomas. */
export function isSupportedSpec(spec: FilterSpec): boolean {
  return [5, 6, 7].every((i) => (spec.groups[i]?.options.length ?? 0) === 0);
}

const groupMatches = (group: FilterGroup | undefined, test: (option: number) => boolean) =>
  !group || group.options.length === 0 || (group.acceptUnion ? group.options.some(test) : group.options.every(test));

const TYPE_IDS: Record<string, number> = { game: 1, application: 2, tool: 4, music: 2048, video: 8192 };

export function matchesFilterSpec(g: Game, spec: FilterSpec, meta: AppMeta | undefined, now = Date.now()): boolean {
  const played = g.playtimeMin > 0 || !!g.lastPlayedAt;
  const cat = (n: number) => !!meta && meta.categories.includes(n);
  const any = (...ns: number[]) => ns.some(cat);

  // Grupo 0: tipo do app (sem dados, conta como jogo).
  const typeId = meta ? TYPE_IDS[meta.kind] ?? 0 : 1;
  if (!groupMatches(spec.groups[0], (o) => o === typeId)) return false;

  // Grupo 1: situação do jogo neste PC.
  const status = (o: number) => {
    switch (o) {
      case 1: case 2: return g.state === "installed";
      case 3: return played;
      case 4: return !played;
      case 5: return true;
      default: return false; // 6 = privado
    }
  };
  if (!groupMatches(spec.groups[1], status)) return false;

  // Grupo 2: recursos (controle, VR, multijogador, Steam Deck...). Sem dados do jogo, nenhum recurso vale.
  const feature = (o: number) => {
    if (!meta) return false;
    switch (o) {
      case 1: return meta.controllerSupport === 2 || cat(28);
      case 2: return meta.controllerSupport >= 1 || any(28, 18);
      case 3: return cat(31);
      case 4: return cat(29);
      case 5: return cat(30);
      case 6: return cat(22);
      case 7: return cat(2);
      case 8: return any(1, 36, 37, 27, 20, 24);
      case 9: return any(9, 38, 39);
      case 10: return cat(23);
      case 11: return cat(44);
      case 12: return meta.deck >= 3;
      case 13: return meta.deck >= 2;
      case 14: return meta.deck !== 1;
      case 15: return true;
      case 16: return any(55, 56);
      case 17: return cat(56);
      case 18: return any(57, 58);
      case 19: return cat(58);
      case 20: return cat(59);
      case 21: return cat(60);
      case 22: return cat(61);
      case 23: return cat(62);
      case 26: return true;
      case 27: return cat(37);
      default: return false;
    }
  };
  if (!groupMatches(spec.groups[2], feature)) return false;

  // Grupo 4: tags da loja. Grupo 8: categorias da loja (inclui os recursos de acessibilidade).
  if (!groupMatches(spec.groups[4], (o) => !!meta && meta.tags.includes(o))) return false;
  if (!groupMatches(spec.groups[8], (o) => cat(o))) return false;

  const text = spec.searchText.trim();
  if (text && !normalizeText(g.title).includes(normalizeText(text))) return false;
  void now;
  return true;
}

/** Nome da coleção para a lista de escolha ("Console (dinâmica)"). */
export function collectionLabel(c: Collection): string {
  return c.dynamic ? `${c.name} (dinâmica)` : c.name;
}

export function matchesRule(g: Game, r: TabRule, ctx: RuleContext): boolean {
  if (r.install === "installed" && g.state !== "installed") return false;
  if (r.install === "not_installed" && g.state !== "not_installed") return false;
  if (r.install === "installing" && g.state !== "installing") return false;
  if (r.favorite && !g.favorite) return false;

  const playedAny = g.playtimeMin > 0 || !!g.lastPlayedAt;
  if (r.played === "never" && playedAny) return false;
  if (r.played === "played" && !playedAny) return false;
  if (r.played === "recent" && !(g.lastPlayedAt && ctx.now - g.lastPlayedAt <= 30 * DAY)) return false;

  if (r.minHours > 0 && g.playtimeMin < r.minHours * 60) return false;
  if (r.minGB > 0 && g.sizeGB < r.minGB) return false;

  if (r.collectionId) {
    const members = ctx.collections.get(r.collectionId);
    if (!members || !members.has(g.appId ?? g.id)) return false;
  }
  const text = r.text.trim();
  if (text && !normalizeText(g.title).includes(normalizeText(text))) return false;
  return true;
}

/** Aplica a opção "jogos ocultos na Steam" antes de qualquer aba. */
export function applyHidden(games: Game[], mode: HiddenMode, ctx: RuleContext): Game[] {
  if (mode === "show") return games;
  const hidden = ctx.collections.get("hidden") ?? new Set<string>();
  return games.filter((g) => hidden.has(g.appId ?? g.id) === (mode === "only"));
}

/** Resumo da regra em uma linha, para a lista de abas ("Instalados · Favoritos · Mais de 10 h"). */
export function describeRule(r: TabRule, collections: Collection[]): string {
  const parts: string[] = [];
  if (r.install !== "any") parts.push(INSTALL_LABELS[r.install]);
  if (r.favorite) parts.push("Favoritos");
  if (r.played !== "any") parts.push(PLAYED_LABELS[r.played]);
  if (r.minHours > 0) parts.push(`${r.minHours}+ h jogadas`);
  if (r.minGB > 0) parts.push(`${r.minGB}+ GB`);
  if (r.collectionId) parts.push(`Coleção: ${collections.find((c) => c.id === r.collectionId)?.name ?? "(removida)"}`);
  // (a coleção pode ser dinâmica: o nome é o mesmo da Steam)
  if (r.text.trim()) parts.push(`Nome contém “${r.text.trim()}”`);
  return parts.length ? parts.join(" · ") : "Todos os jogos";
}
