import type { AppMeta } from "./steam";

/** Idiomas da Steam (código → nome em português). */
const NAMES: Record<string, string> = {
  english: "Inglês", brazilian: "Português (Brasil)", portuguese: "Português (Portugal)", spanish: "Espanhol (Espanha)",
  latam: "Espanhol (América Latina)", french: "Francês", german: "Alemão", italian: "Italiano", japanese: "Japonês",
  koreana: "Coreano", schinese: "Chinês (simplificado)", tchinese: "Chinês (tradicional)", russian: "Russo",
  polish: "Polonês", turkish: "Turco", dutch: "Holandês", swedish: "Sueco", thai: "Tailandês", arabic: "Árabe",
  ukrainian: "Ucraniano", czech: "Tcheco", hungarian: "Húngaro", danish: "Dinamarquês", finnish: "Finlandês",
  norwegian: "Norueguês", greek: "Grego", romanian: "Romeno", bulgarian: "Búlgaro", vietnamese: "Vietnamita",
  indonesian: "Indonésio",
};

/** Idiomas que dá para escolher como preferido, na ordem da lista de configurações. */
export const PREFERRED_LANGUAGES = [
  "brazilian", "portuguese", "english", "spanish", "latam", "french", "german", "italian", "japanese", "koreana", "schinese", "tchinese", "russian",
];

export const DEFAULT_LANGUAGE = "brazilian";

export const languageName = (code: string) => NAMES[code] ?? code;

/** Idiomas "parentes": o mais próximo que serve quase tão bem quanto o preferido. */
const RELATED: Record<string, string> = { brazilian: "portuguese", portuguese: "brazilian", spanish: "latam", latam: "spanish", schinese: "tchinese", tchinese: "schinese" };

export interface LanguageStatus {
  /** full = tem o idioma preferido; partial = só um parente próximo; missing = não tem; unknown = a Steam não informa. */
  level: "full" | "partial" | "missing" | "unknown";
  title: string;
  detail: string;
}

/** O jogo tem o idioma preferido? Diz também o que há nele (interface, áudio, legendas) ou o que há no lugar. */
export function languageStatus(meta: AppMeta | undefined, preferred: string): LanguageStatus {
  const langs = meta?.languages ?? [];
  const name = languageName(preferred);
  if (langs.length === 0) return { level: "unknown", title: "Idiomas não informados", detail: "A Steam não lista os idiomas deste jogo." };

  const exact = langs.find((l) => l.code === preferred);
  if (exact) return { level: "full", title: `✓ ${name}`, detail: "" };

  const related = RELATED[preferred] && langs.find((l) => l.code === RELATED[preferred]);
  if (related) return { level: "partial", title: `≈ Só ${languageName(related.code)}`, detail: `Sem ${name}` };

  const others = langs.map((l) => languageName(l.code));
  const shown = others.slice(0, 4).join(", ");
  return { level: "missing", title: `✗ Sem ${name}`, detail: `Disponível: ${shown}${others.length > 4 ? ` e mais ${others.length - 4}` : ""}` };
}
