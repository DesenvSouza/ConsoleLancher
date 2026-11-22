import { useState } from "react";
import type { Game } from "../lib/types";
import { useLibrary } from "../store/library";
import type { BlockSize, BlockStyle } from "../store/home";
import { Focusable } from "./Focusable";

/** Capa provisória gerada a partir do matiz do jogo, enquanto a arte real não carrega (ou não existe). */
export function coverStyle(hue: number) {
  return {
    background: `radial-gradient(120% 80% at 20% 0%, hsl(${hue} 70% 45%) 0%, transparent 60%), linear-gradient(160deg, hsl(${(hue + 40) % 360} 55% 22%), hsl(${hue} 60% 9%))`,
  };
}

const ART_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps";

/**
 * Arte do jogo no CDN da Steam (cartaz 600x900 ou capa panorâmica). Enquanto carrega, ou se não
 * existir, aparece o degradê com o título; quando a arte carrega, o título (já está na imagem) some.
 */
export function CoverArt({ game, shape }: { game: Game; shape: "poster" | "wide" }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const url = game.source === "steam" && game.appId ? `${ART_CDN}/${game.appId}/${shape === "wide" ? "header.jpg" : "library_600x900.jpg"}` : null;

  return (
    <>
      {url && state !== "error" && (
        <img
          className={`cover-img ${state === "ok" ? "is-loaded" : ""}`}
          src={url}
          alt=""
          loading="lazy"
          // Decodifica a imagem fora da thread principal: com muitas capas, a decodificação síncrona travava a tela.
          decoding="async"
          draggable={false}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
      )}
      {state !== "ok" && <span className="card-title">{game.title}</span>}
    </>
  );
}

interface Props {
  game: Game;
  focusKey: string;
  /** "grid" usa o mesmo formato do cartaz. */
  variant?: BlockStyle;
  size?: BlockSize;
  scroll?: boolean | "x";
  smooth?: () => boolean;
  /** Mostra o selo "Instalar" nos jogos não instalados (padrão: sim). */
  showBadge?: boolean;
  onPress: () => void;
  onFocus?: () => void;
}

export function GameCard({ game, focusKey, variant = "poster", size = "m", scroll, smooth, showBadge = true, onPress, onFocus }: Props) {
  const shape = variant === "wide" ? "wide" : "poster";
  const running = useLibrary((s) => s.runningAppId !== null && s.runningAppId === game.appId);

  return (
    <Focusable focusKey={focusKey} className={`card card-${shape} card-${size}`} scroll={scroll} smooth={smooth} onPress={onPress} onFocus={onFocus}>
      <div className="card-cover" style={coverStyle(game.hue)}>
        <CoverArt game={game} shape={shape} />
        {running && <span className="badge badge-running">Em execução</span>}
        {!running && showBadge && game.state === "not_installed" && <span className="badge">Instalar</span>}
        {game.state === "installing" && (
          <div className="card-progress">
            <div style={{ width: `${(game.progress ?? 0) * 100}%` }} />
          </div>
        )}
      </div>
    </Focusable>
  );
}
