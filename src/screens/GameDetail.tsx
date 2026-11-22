import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { Hints, TopBar, formatLastPlayed, formatPlaytime, formatSize } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { CoverArt, coverStyle } from "../components/GameCard";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";

export function GameDetail({ gameId }: { gameId: string }) {
  const game = useLibrary((s) => s.games.find((g) => g.id === gameId));
  const { play, install, toggleFavorite, cancelInstall } = useLibrary.getState();
  const back = useUI((s) => s.back);
  const askUninstall = useUI((s) => s.askUninstall);
  const running = useLibrary((s) => s.runningAppId !== null && s.runningAppId === game?.appId);

  // Ao abrir, e sempre que o jogo muda de estado (instalou, desinstalou), o foco volta ao botão principal.
  useEffect(() => {
    setFocus("detail-primary");
  }, [gameId, game?.state]);

  if (!game) return null;

  return (
    <div className="screen detail">
      <div className="hero-bg" style={coverStyle(game.hue)} />
      <TopBar title={game.source === "steam" ? "Steam" : game.source} />

      <section className="detail-body">
        <div className="detail-cover" style={coverStyle(game.hue)}>
          <CoverArt game={game} shape="poster" />
        </div>

        <div className="detail-info">
          <h1>{game.title}</h1>
          {game.description && <p className="hero-desc">{game.description}</p>}

          <dl className="stats">
            <div><dt>Tempo de jogo</dt><dd>{formatPlaytime(game.playtimeMin)}</dd></div>
            <div><dt>Última vez</dt><dd>{formatLastPlayed(game.lastPlayedAt)}</dd></div>
            <div><dt>Tamanho</dt><dd>{formatSize(game.sizeGB)}</dd></div>
          </dl>

          {game.state === "installing" && (
            <div className="progress">
              <div className="progress-bar"><div style={{ width: `${(game.progress ?? 0) * 100}%` }} /></div>
              <span>Baixando… {Math.round((game.progress ?? 0) * 100)}%</span>
            </div>
          )}

          <FocusGroup focusKey="detail-actions" className="actions" preferredChildFocusKey="detail-primary">
            {game.state === "installed" && !running && (
              <Focusable focusKey="detail-primary" className="btn btn-primary" onPress={() => play(game.id)} scroll={false}>Jogar</Focusable>
            )}
            {game.state === "installed" && running && (
              <Focusable focusKey="detail-primary" className="btn" scroll={false}>Em execução…</Focusable>
            )}
            {game.state === "not_installed" && (
              <Focusable focusKey="detail-primary" className="btn btn-primary" onPress={() => install(game.id)} scroll={false}>Instalar</Focusable>
            )}
            {game.state === "installing" && (
              <Focusable focusKey="detail-primary" className="btn" scroll={false}>Instalando…</Focusable>
            )}
            {game.state === "installing" && (
              <Focusable focusKey="detail-cancel" className="btn btn-ghost-danger" onPress={() => cancelInstall(game.id)} scroll={false}>Cancelar download</Focusable>
            )}
            <Focusable focusKey="detail-fav" className="btn" onPress={() => toggleFavorite(game.id)} scroll={false}>
              {game.favorite ? "★ Nos favoritos" : "☆ Favoritar"}
            </Focusable>
            {game.state === "installed" && (
              <Focusable focusKey="detail-uninstall" className="btn btn-ghost-danger" onPress={() => askUninstall(game.id)} scroll={false}>Desinstalar</Focusable>
            )}
            <Focusable focusKey="detail-back" className="btn" onPress={back} scroll={false}>Voltar</Focusable>
          </FocusGroup>
        </div>
      </section>

      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }, { btn: "Select", label: "Configurações" }]} />
    </div>
  );
}
