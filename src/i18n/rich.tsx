import { Fragment, type ReactNode } from "react";

/**
 * Texto traduzido com trechos em negrito: `<b>…</b>` dentro do texto vira <b>. Assim a frase inteira é traduzida de
 * uma vez (a ordem das palavras muda de um idioma para outro) e o negrito acompanha.
 */
export function rich(text: string): ReactNode {
  return text.split(/(<b>.*?<\/b>)/g).map((part, i) =>
    part.startsWith("<b>") ? <b key={i}>{part.slice(3, -4)}</b> : <Fragment key={i}>{part}</Fragment>,
  );
}
