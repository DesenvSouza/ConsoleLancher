import { useEffect, useState, type CSSProperties } from "react";
import type { Game } from "../lib/types";
import { BACKGROUND_COLORS, useHome } from "../store/home";
import { coverStyle } from "./GameCard";

const ART_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps";

/** Endereços da arte do jogo, do melhor para o pior (a arte panorâmica não existe em todos os jogos). */
function artCandidates(game: Game | undefined, style: "art" | "blur"): string[] {
  if (!game || game.source !== "steam" || !game.appId) return [];
  const base = `${ART_CDN}/${game.appId}`;
  return style === "art" ? [`${base}/library_hero.jpg`, `${base}/header.jpg`] : [`${base}/header.jpg`, `${base}/library_hero.jpg`];
}

/**
 * Carrega a arte antes de mostrá-la. Enquanto a nova carrega, devolve a anterior (o fundo não pisca); se nenhuma
 * existir, devolve null e o fundo cai no degradê do jogo.
 */
function useLoadedArt(urls: string[]): string | null {
  const [loaded, setLoaded] = useState<string | null>(null);
  const key = urls.join("|");
  useEffect(() => {
    if (!key) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    // Pequena espera: ao passar rápido pelos cards, só o último jogo chega a baixar a arte.
    const timer = setTimeout(async () => {
      for (const url of key.split("|")) {
        const ok = await new Promise<boolean>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
        if (cancelled) return;
        if (ok) {
          setLoaded(url);
          return;
        }
      }
      setLoaded(null);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);
  return loaded;
}

interface Layer {
  /** Muda quando o visual muda: dispara a troca suave entre o fundo antigo e o novo. */
  key: string;
  className: string;
  style: CSSProperties;
}

/** Plano de fundo da página inicial e da página do jogo, conforme a escolha do jogador (Configurações › Aparência). */
export function ScreenBackground({ game }: { game: Game | undefined }) {
  const style = useHome((s) => s.background);
  const colorId = useHome((s) => s.backgroundColor);
  const strength = useHome((s) => s.backgroundStrength);
  const blur = useHome((s) => s.backgroundBlur);

  const art = useLoadedArt(style === "art" || style === "blur" ? artCandidates(game, style) : []);

  let layer: Layer;
  if (style === "color") {
    const color = (BACKGROUND_COLORS.find((c) => c.id === colorId) ?? BACKGROUND_COLORS[1]).css;
    layer = { key: `color:${color}`, className: "hbg-layer", style: { background: color } };
  } else if ((style === "art" || style === "blur") && art) {
    layer = {
      key: `${style}:${art}`,
      className: "hbg-layer",
      style:
        style === "blur"
          ? {
              backgroundImage: `url("${art}")`,
              // O desfoque deixa as bordas transparentes: a imagem cresce um pouco (mais, quanto maior o desfoque) para escondê-las.
              filter: `blur(${(blur * 5).toFixed(2)}rem) saturate(1.3)`,
              transform: `scale(${(1.05 + blur * 0.2).toFixed(3)})`,
            }
          : { backgroundImage: `url("${art}")` },
    };
  } else {
    const hue = game?.hue ?? 250;
    layer = { key: `gradient:${hue}`, className: "hbg-layer", style: coverStyle(hue) };
  }

  // O fundo novo aparece por cima do antigo (fade); o antigo sai depois que a troca termina.
  const [shown, setShown] = useState<{ current: Layer; previous: Layer | null }>({ current: layer, previous: null });
  useEffect(() => {
    setShown((s) => (s.current.key === layer.key ? { ...s, current: layer } : { current: layer, previous: s.current }));
    // `layer` é recalculado a cada desenho; só a chave diz se o visual mudou.
  }, [layer.key]);

  // Ajustes que não trocam o fundo (o desfoque, por exemplo) valem na hora, sem fade.
  const current = shown.current.key === layer.key ? layer : shown.current;
  const flat = style === "color";
  return (
    <div className={`hero-bg ${flat ? "hbg-flat" : ""}`} style={{ opacity: flat ? 1 : strength }} aria-hidden>
      {shown.previous && <div className={shown.previous.className} style={shown.previous.style} />}
      <div
        key={current.key}
        className={`${current.className} ${shown.previous ? "hbg-in" : ""}`}
        style={current.style}
        onAnimationEnd={() => setShown((s) => ({ ...s, previous: null }))}
      />
    </div>
  );
}
