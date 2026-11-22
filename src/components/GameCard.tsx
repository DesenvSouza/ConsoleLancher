import { useState } from "react";
import type { Game } from "../lib/types";
import { useLibrary } from "../store/library";
import type { BlockSize, BlockStyle } from "../store/home";
import { useNotInstalled } from "../store/notInstalled";
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

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Não instalado">
    <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" />
  </svg>
);

/**
 * O rosto do cartão: capa, selos e barra de progresso. Fica separado do cartão focável para a tela de
 * configuração poder mostrar uma prévia sem registrar nada na navegação.
 */
export function CardFace({ game, shape, showBadge = true }: { game: Game; shape: "poster" | "wide"; showBadge?: boolean }) {
  const running = useLibrary((s) => s.runningAppId !== null && s.runningAppId === game.appId);
  const uninstalling = useLibrary((s) => !!s.pendingUninstall[game.id]);
  const ni = useNotInstalled();
  const notInstalled = !uninstalling && !running && game.state === "not_installed";
  // Capa dos não instalados: cinza e/ou escurecida; ao focar pode voltar à cor.
  const coverClass = notInstalled && ni.cover !== "normal" ? `ni-${ni.cover} ${ni.colorOnFocus ? "ni-focus-color" : ""}` : "";

  return (
    <>
      <div className={`card-cover ${coverClass}`} style={coverStyle(game.hue)}>
        <CoverArt game={game} shape={shape} />
        {!uninstalling && running && <span className="badge badge-running">Em execução</span>}
        {uninstalling && <span className="badge">Desinstalando…</span>}
        {!uninstalling && game.state === "installing" && (
          <div className="card-progress">
            <div style={{ width: `${(game.progress ?? 0) * 100}%` }} />
          </div>
        )}
      </div>
      {/* Fora da capa, para o filtro cinza da capa não apagar a cor do selo. */}
      {notInstalled && showBadge && ni.badge !== "none" && (
        <span className={`badge badge-ni badge-pos-${ni.badgePos}`}>
          {ni.badge === "icon" ? <DownloadIcon /> : ni.badge === "install" ? "Instalar" : "Não instalado"}
        </span>
      )}
    </>
  );
}

export function GameCard({ game, focusKey, variant = "poster", size = "m", scroll, smooth, showBadge = true, onPress, onFocus }: Props) {
  const shape = variant === "wide" ? "wide" : "poster";

  return (
    <Focusable focusKey={focusKey} className={`card card-${shape} card-${size}`} scroll={scroll} smooth={smooth} onPress={onPress} onFocus={onFocus}>
      <CardFace game={game} shape={shape} showBadge={showBadge} />
    </Focusable>
  );
}
