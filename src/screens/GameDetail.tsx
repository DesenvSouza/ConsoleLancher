import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { Hints, TopBar, formatLastPlayed, formatPlaytime, formatSize } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { CoverArt, coverStyle } from "../components/GameCard";
import { GameInfo } from "../components/GameInfo";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";

export function GameDetail({ gameId }: { gameId: string }) {
  const game = useLibrary((s) => s.games.find((g) => g.id === gameId));
  const { play, install, toggleFavorite, cancelInstall } = useLibrary.getState();
  const uninstalling = useLibrary((s) => !!s.pendingUninstall[gameId]);
  const launching = useLibrary((s) => !!s.launching[gameId]);
  const back = useUI((s) => s.back);
  const askUninstall = useUI((s) => s.askUninstall);
  const modalOpen = useUI((s) => s.modalOpen);
  const running = useLibrary((s) => s.runningAppId !== null && s.runningAppId === game?.appId);
  const state = game?.state;

  // O botão de desinstalar desaparece durante o pedido e o jogo pode sumir após a remoção.
  useEffect(() => {
    if (modalOpen) return;
    const ui = useUI.getState();
    if (ui.screen.name !== "detail" || ui.screen.gameId !== gameId) return;
    if (!state && ui.history.length > 0) {
      ui.back();
      return;
    }
    setFocus(state && !uninstalling ? "detail-primary" : "detail-back");
  }, [gameId, state, modalOpen, uninstalling]);

  if (!game) {
    return (
      <div className="screen detail">
        <TopBar title="Detalhes do jogo" />
        <section className="detail-body detail-unavailable">
          <div className="empty-state">
            <h2>Jogo indisponível nesta biblioteca</h2>
            <Focusable focusKey="detail-back" className="btn btn-primary" onPress={back} scroll={false}>Voltar</Focusable>
          </div>
        </section>
        <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />
      </div>
    );
  }

  const availableState = uninstalling ? undefined : game.state;
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
          <GameInfo game={game} />

          <dl className="stats">
            <div><dt>Tempo de jogo</dt><dd>{formatPlaytime(game.playtimeMin)}</dd></div>
            <div><dt>Última vez</dt><dd>{formatLastPlayed(game.lastPlayedAt)}</dd></div>
            <div><dt>Tamanho</dt><dd>{formatSize(game.sizeGB)}</dd></div>
          </dl>

          {uninstalling && <p className="operation-status" role="status">Desinstalando…</p>}
          {availableState === "installing" && (
            <div className="progress">
              <div className="progress-bar"><div style={{ width: `${(game.progress ?? 0) * 100}%` }} /></div>
              <span>Baixando… {Math.round((game.progress ?? 0) * 100)}%</span>
            </div>
          )}

          <FocusGroup focusKey="detail-actions" className="actions" preferredChildFocusKey="detail-primary">
            {availableState === "installed" && !running && (
              <Focusable focusKey="detail-primary" className={`btn btn-primary ${launching ? "is-busy" : ""}`} onPress={() => play(game.id)} scroll={false}>
                {launching ? <><span className="spinner" />Abrindo…</> : "Jogar"}
              </Focusable>
            )}
            {availableState === "installed" && running && (
              <Focusable focusKey="detail-primary" className="btn" scroll={false}>Em execução…</Focusable>
            )}
            {availableState === "not_installed" && (
              <Focusable focusKey="detail-primary" className="btn btn-primary" onPress={() => install(game.id)} scroll={false}>Instalar</Focusable>
            )}
            {availableState === "installing" && (
              <Focusable focusKey="detail-primary" className="btn" scroll={false}>Instalando…</Focusable>
            )}
            {availableState === "installing" && (
              <Focusable focusKey="detail-cancel" className="btn btn-ghost-danger" onPress={() => cancelInstall(game.id)} scroll={false}>Cancelar download</Focusable>
            )}
            <Focusable focusKey="detail-fav" className="btn" onPress={() => toggleFavorite(game.id)} scroll={false}>
              {game.favorite ? "★ Nos favoritos" : "☆ Favoritar"}
            </Focusable>
            {availableState === "installed" && !running && (
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
