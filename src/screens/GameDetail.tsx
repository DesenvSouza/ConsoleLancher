import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { Hints, TopBar, formatLastPlayed, formatPlaytime, formatSize } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { CoverArt, coverStyle } from "../components/GameCard";
import { ScreenBackground } from "../components/ScreenBackground";
import { DurationSection, DurationStats, durationHint, durationLine, useGameDuration } from "../components/GameDuration";
import { GameInfo } from "../components/GameInfo";
import { t, te } from "../i18n";
import { api } from "../lib/api";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { useUserData } from "../store/userData";

export function GameDetail({ gameId }: { gameId: string }) {
  const game = useLibrary((s) => s.games.find((g) => g.id === gameId));
  const { play, install, toggleFavorite } = useLibrary.getState();
  const uninstalling = useLibrary((s) => !!s.pendingUninstall[gameId]);
  const uninstallIssue = useLibrary((s) => s.uninstallIssues[gameId]);
  const launching = useLibrary((s) => !!s.launching[gameId]);
  const back = useUI((s) => s.back);
  const askUninstall = useUI((s) => s.askUninstall);
  const askCloseGame = useUI((s) => s.askCloseGame);
  const modalOpen = useUI((s) => s.modalOpen);
  const running = useLibrary((s) => s.runningAppId !== null && s.runningAppId === game?.appId);
  const state = game?.state;
  // Duração (HowLongToBeat): onde e quais tempos aparecem é escolha do jogador (Configurações › Jogos e conta).
  const duration = useGameDuration(game);
  const durationStyle = useUserData((u) => u.hltbStyle);

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
        <TopBar title={t("Detalhes do jogo")} />
        <section className="detail-body detail-unavailable">
          <div className="empty-state">
            <h2>{t("Jogo indisponível nesta biblioteca")}</h2>
            <Focusable focusKey="detail-back" className="btn btn-primary" onPress={back} scroll={false}>{t("Voltar")}</Focusable>
          </div>
        </section>
        <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />
      </div>
    );
  }

  const availableState = uninstalling ? undefined : game.state;
  return (
    <div className="screen detail">
      <ScreenBackground game={game} />
      <TopBar title={t("Detalhes do jogo")} />

      <section className="detail-body">
        <div className="detail-cover" style={coverStyle(game.hue)}>
          <CoverArt game={game} shape="poster" />
        </div>

        <div className="detail-info">
          <h1>{game.title}</h1>

          {/* Estado e ação principal logo abaixo do título: "Jogar" / "Instalar" não dependem de rolar nem de ler a descrição. */}
          {uninstalling && <p className="operation-status" role="status">{t("Desinstalando {title}…", { title: game.title })}</p>}
          {!uninstalling && uninstallIssue && game.state === "installed" && (
            <p className="operation-status update-warn" role="alert">
              {uninstallIssue === "timeout" ? t("A Steam ainda não confirmou a desinstalação. O jogo continua instalado.") : t("Não foi possível desinstalar o jogo. Ele continua instalado.")}
            </p>
          )}
          {running && <p className="operation-status" role="status">{t("Em execução")}</p>}
          {!running && !uninstalling && game.update === "pending" && <p className="operation-status update-note" role="status">{t("Há uma atualização para este jogo. A Steam vai baixá-la antes de abrir.")}</p>}
          {availableState === "installing" && (
            <div className="progress">
              <div className="progress-bar"><div style={{ width: `${(game.progress ?? 0) * 100}%` }} /></div>
              <span>{game.update ? t("Atualizando… {pct}%", { pct: Math.round((game.progress ?? 0) * 100) }) : t("Baixando… {pct}%", { pct: Math.round((game.progress ?? 0) * 100) })}</span>
            </div>
          )}

          <FocusGroup focusKey="detail-actions" className="actions" preferredChildFocusKey="detail-primary">
            {availableState === "installed" && (
              <Focusable
                focusKey="detail-primary"
                className={`btn btn-primary ${launching ? "is-busy" : ""}`}
                onPress={running ? () => void api.resumeGame().catch((error) => useUI.getState().showToast(te(error), "warning")) : launching ? undefined : () => play(game.id)}
                scroll={false}
              >
                {running ? t("Voltar ao jogo") : launching ? <><span className="spinner" />{t("Abrindo…")}</> : t("Jogar")}
              </Focusable>
            )}
            {availableState === "installed" && running && (
              <Focusable focusKey="detail-close" className="btn btn-ghost-danger" onPress={() => askCloseGame(game.id)} scroll={false}>{t("Fechar o jogo")}</Focusable>
            )}
            {availableState === "not_installed" && (
              <Focusable focusKey="detail-primary" className="btn btn-primary" onPress={() => install(game.id)} scroll={false}>{t("Instalar")}</Focusable>
            )}
            {availableState === "installing" && (
              <Focusable focusKey="detail-primary" className="btn" scroll={false}>{game.update ? t("Atualizando…") : t("Instalando…")}</Focusable>
            )}
            {availableState === "installing" && !game.update && (
              <Focusable focusKey="detail-cancel" className="btn btn-ghost-danger" onPress={() => useUI.getState().askCancelInstall(game.id)} scroll={false}>{t("Cancelar download")}</Focusable>
            )}
            <Focusable focusKey="detail-fav" className="btn" onPress={() => toggleFavorite(game.id)} scroll={false}>
              {game.favorite ? t("★ Nos favoritos") : t("☆ Favoritar")}
            </Focusable>
            {availableState === "installed" && !running && !launching && (
              <Focusable focusKey="detail-uninstall" className="btn btn-ghost-danger" onPress={() => askUninstall(game.id)} scroll={false}>{uninstallIssue ? t("Tentar desinstalar de novo") : t("Desinstalar")}</Focusable>
            )}
            <Focusable focusKey="detail-back" className="btn" onPress={back} scroll={false}>{t("Voltar")}</Focusable>
          </FocusGroup>

          <GameInfo game={game} durationLine={duration && durationStyle === "line" ? durationLine(duration) : null} />

          <dl className="stats">
            <div>
              <dt>{t("Tempo de jogo")}</dt>
              <dd>
                {formatPlaytime(game.playtimeMin)}
                {duration && durationStyle === "hint" && durationHint(duration) && <small className="stat-hint">{durationHint(duration)}</small>}
              </dd>
            </div>
            <div><dt>{t("Última vez")}</dt><dd>{formatLastPlayed(game.lastPlayedAt)}</dd></div>
            <div><dt>{t("Tamanho")}</dt><dd>{formatSize(game.sizeGB)}</dd></div>
            {duration && durationStyle === "stats" && <DurationStats duration={duration} />}
          </dl>
          {duration && durationStyle === "stats" && <p className="stats-source">{t("Duração: HowLongToBeat")}</p>}
          {duration && durationStyle === "section" && <DurationSection duration={duration} playedMin={game.playtimeMin} />}

        </div>
      </section>

      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }, { btn: "Select", label: "Configurações" }]} />
    </div>
  );
}
