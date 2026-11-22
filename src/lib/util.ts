export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Texto sem acentos e em minúsculas, para buscar "pokemon" e achar "Pokémon". */
export const normalizeText = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Avança/volta em uma lista circular. */
export function cycle<T>(list: readonly T[], current: number, dir: 1 | -1): T {
  return list[(current + dir + list.length) % list.length];
}

/** Índice de `value` em `list` (0 se não achar). */
export function indexOf<T>(list: readonly T[], value: T): number {
  return Math.max(0, list.indexOf(value));
}
