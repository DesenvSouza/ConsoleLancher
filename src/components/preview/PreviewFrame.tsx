import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PreviewContext } from "./context";

/**
 * Moldura de uma prévia ao vivo: desenha uma tela inteira do launcher (do tamanho real da janela, com as mesmas medidas
 * em rem, inclusive o "Tamanho da interface") e a reduz para caber na moldura. Assim a prévia é o launcher de verdade em
 * miniatura, não uma imitação: tema, cores, fundo, tamanho, cantos e brilho valem na hora.
 *
 * O conteúdo recebe `pointer-events: none` e não registra nenhum foco: é só para olhar.
 */
export function PreviewFrame({ label, children }: { label: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [shrink, setShrink] = useState(0.2);
  const [ratio, setRatio] = useState(() => `${window.innerWidth} / ${window.innerHeight}`);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      setShrink(el.getBoundingClientRect().width / window.innerWidth);
      setRatio(`${window.innerWidth} / ${window.innerHeight}`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <figure className="pv">
      <figcaption className="pv-label">{label}</figcaption>
      <div ref={frame} className="pv-frame" style={{ aspectRatio: ratio }} aria-hidden>
        <div className="pv-canvas" style={{ transform: `scale(${shrink})` }}>
          <PreviewContext.Provider value>{children}</PreviewContext.Provider>
        </div>
      </div>
    </figure>
  );
}
