import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DICTIONARY } from "./dict";

/**
 * Idioma do LAUNCHER (textos de telas, menus e avisos). É uma escolha separada do "idioma preferido dos jogos"
 * (que só diz em que língua o jogador quer jogar e é conferido na página do jogo).
 *
 * Como funciona: o texto em português do código é a chave. `t("Voltar")` devolve "Voltar", "Back" ou "Volver"
 * conforme o idioma escolhido; um texto sem tradução aparece em português (e avisa no console em desenvolvimento).
 * Valores variáveis entram por `{nome}`: `t("Baixando… {pct}%", { pct: 40 })`.
 */
export type Lang = "pt" | "en" | "es";

export const LANGUAGES: { id: Lang; /** Nome na própria língua. */ name: string; /** Código para datas, horas e números. */ locale: string }[] = [
  { id: "pt", name: "Português (Brasil)", locale: "pt-BR" },
  { id: "en", name: "English", locale: "en-US" },
  { id: "es", name: "Español", locale: "es-ES" },
];

/** Primeira abertura: usa o idioma do Windows se for inglês ou espanhol; senão, português. */
function detectLanguage(): Lang {
  const code = (typeof navigator !== "undefined" ? navigator.language : "pt").toLowerCase();
  if (code.startsWith("en")) return "en";
  if (code.startsWith("es")) return "es";
  return "pt";
}

interface LanguageStore {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const STORAGE_KEY = "launcher-language";

export const useLanguage = create<LanguageStore>()(
  persist(
    (set) => ({
      lang: detectLanguage(),
      setLang: (lang) => set({ lang }),
    }),
    { name: STORAGE_KEY, version: 1 },
  ),
);

const warned = new Set<string>();

function fill(text: string, params?: Record<string, string | number>): string {
  return params ? text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole)) : text;
}

/** Traduz um texto (a chave é o português) para o idioma atual. Chamar sempre na hora de desenhar, nunca no topo do módulo. */
export function t(text: string, params?: Record<string, string | number>): string {
  const { lang } = useLanguage.getState();
  if (lang === "pt") return fill(text, params);
  const translated = DICTIONARY[text]?.[lang === "en" ? 0 : 1];
  if (translated === undefined && import.meta.env.DEV && !warned.has(`${lang}:${text}`)) {
    warned.add(`${lang}:${text}`);
    console.warn(`[i18n] sem tradução (${lang}): ${text}`);
  }
  return fill(translated ?? text, params);
}

interface MessageTemplate {
  pattern: RegExp;
  names: string[];
  versions: [string, string];
}

let templates: MessageTemplate[] | undefined;

/** Textos com {valores} viram modelos, para reconhecer mensagens do backend que têm uma parte variável. */
function messageTemplates(): MessageTemplate[] {
  templates ??= Object.entries(DICTIONARY)
    .filter(([key]) => key.includes("{"))
    .map(([key, versions]) => {
      const names: string[] = [];
      const source = key
        .split(/(\{\w+\})/)
        .map((part) => {
          const name = /^\{(\w+)\}$/.exec(part)?.[1];
          if (name) {
            names.push(name);
            return "([\\s\\S]+?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      return { pattern: new RegExp(`^${source}$`), names, versions };
    });
  return templates;
}

/**
 * Mensagens de erro que vêm do backend (Rust) já em português: traduz as conhecidas, inteiras ou com uma parte variável
 * ("Falha de rede: {detail}" mantém o detalhe). Qualquer outra aparece como veio.
 */
export function te(error: unknown): string {
  const message = String(error).replace(/^Error: /, "");
  const { lang } = useLanguage.getState();
  if (lang === "pt") return message;
  const index = lang === "en" ? 0 : 1;
  const whole = DICTIONARY[message]?.[index];
  if (whole !== undefined) return whole;
  for (const { pattern, names, versions } of messageTemplates()) {
    const match = pattern.exec(message);
    if (match) return fill(versions[index], Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
  }
  return message;
}

/** Idioma do launcher no código da Steam (a loja devolve descrição e gêneros nesse idioma). */
export function steamLanguage(): string {
  const { lang } = useLanguage.getState();
  return lang === "en" ? "english" : lang === "es" ? "spanish" : "brazilian";
}

/** Código de região do idioma atual (datas, horas, números). */
export function locale(): string {
  const { lang } = useLanguage.getState();
  return LANGUAGES.find((l) => l.id === lang)?.locale ?? "pt-BR";
}

/** Número com o separador decimal do idioma (4,5 em português e espanhol; 4.5 em inglês). */
export function formatNumber(value: number, maximumFractionDigits = 1): string {
  return value.toLocaleString(locale(), { maximumFractionDigits });
}

/** Ordena textos pelo alfabeto do idioma. */
export function compareText(a: string, b: string): number {
  return a.localeCompare(b, locale());
}

function applyHtmlLang(lang: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = LANGUAGES.find((l) => l.id === lang)?.locale ?? "pt-BR";
}

// O idioma vale também para o menu do Guia (outra janela): quando uma janela muda a escolha, a outra a relê.
applyHtmlLang(useLanguage.getState().lang);
useLanguage.subscribe((s) => applyHtmlLang(s.lang));
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) void useLanguage.persist.rehydrate();
  });
}
