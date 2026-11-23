import { useMemo } from "react";
import { compareText, t } from "../../i18n";
import { applyHidden, makeContext, matchesRule } from "../../lib/libraryRules";
import { homeRows } from "../../lib/homeRows";
import type { Game } from "../../lib/types";
import { BLOCK_TITLES, useHome } from "../../store/home";
import { useLibrary } from "../../store/library";
import { tabName, useLibraryConfig, visibleTabs } from "../../store/libraryConfig";
import { useNotInstalled } from "../../store/notInstalled";
import { useUserData } from "../../store/userData";
import { Hints, TopBar, formatLastPlayed, formatPlaytime, formatSize, gameSubtitle } from "../Chrome";
import { CardFace, CoverArt, coverStyle } from "../GameCard";
import { DurationSection, DurationStats, durationHint, durationLine, useGameDuration } from "../GameDuration";
import { GameInfo } from "../GameInfo";
import { ScreenBackground } from "../ScreenBackground";
import { PreviewFrame } from "./PreviewFrame";

/** Jogo de exemplo das prévias: o último jogado (ou o primeiro com arte da Steam), para o fundo e a capa serem reconhecíveis. */
function usePreviewGame(): Game | undefined {
  return useLibrary((s) => {
    const withArt = s.games.filter((g) => g.source === "steam" && g.appId);
    const pool = withArt.length > 0 ? withArt : s.games;
    return pool.reduce<Game | undefined>((best, g) => ((g.lastPlayedAt ?? 0) > (best?.lastPlayedAt ?? -1) ? g : best), pool[0]);
  });
}

/** Cartão só para olhar (não é focável): a capa, os selos e o resto do cartão de verdade. */
function PreviewCard({ game, shape, size, focused }: { game: Game; shape: "poster" | "wide"; size: "s" | "m" | "l"; focused?: boolean }) {
  return (
    <div className={`card card-${shape} card-${size} ${focused ? "is-focused" : ""}`}>
      <CardFace game={game} shape={shape} />
    </div>
  );
}

/** A página inicial em miniatura, com as fileiras, o destaque e o fundo escolhidos. */
export function HomePreview() {
  const games = useLibrary((s) => s.games);
  const { blocks, showHero, rowMode } = useHome();
  const hideNotInstalled = useNotInstalled((n) => n.hideFromHome);
  const rows = useMemo(() => homeRows(blocks, games, hideNotInstalled), [blocks, games, hideNotInstalled]);
  const fallback = usePreviewGame();
  const hero = rows[0]?.games[0] ?? fallback;
  // "Uma por vez" mostra só a fileira selecionada; "Todas" deixa ver as seguintes.
  const shown = rowMode === "one" ? rows.slice(0, 1) : rows.slice(0, 3);

  return (
    <PreviewFrame label={t("Início")}>
      <div className="screen home pv-screen">
        <ScreenBackground game={hero} />
        <TopBar title={t("Início")} />
        {showHero && hero && (
          <section className="hero">
            <h1>{hero.title}</h1>
            <p className="hero-meta">{gameSubtitle(hero)}</p>
            {hero.description && <p className="hero-desc">{hero.description}</p>}
          </section>
        )}
        <div className="rows">
          {shown.map(({ block, games: list }, rowIndex) => (
            <section key={block.id} className="row row-active">
              <h2>{t(BLOCK_TITLES[block.kind])}</h2>
              <div className={`row-track ${block.style === "grid" ? "grid" : ""}`}>
                {list.slice(0, block.style === "grid" ? 24 : 14).map((g, i) => (
                  <PreviewCard key={g.id} game={g} shape={block.style === "wide" ? "wide" : "poster"} size={block.size} focused={rowIndex === 0 && i === 0} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <Hints items={[{ btn: "A", label: "Abrir" }, { btn: "Start", label: "Opções do jogo" }, { btn: "X", label: "Biblioteca" }, { btn: "Y", label: "Downloads" }, { btn: "Select", label: "Configurações" }]} />
      </div>
    </PreviewFrame>
  );
}

/** A página de um jogo em miniatura, com o fundo, a duração e o resto como o jogador configurou. */
export function DetailPreview() {
  const game = usePreviewGame();
  const duration = useGameDuration(game, { sample: true });
  const durationStyle = useUserData((u) => u.hltbStyle);
  if (!game) return null;

  return (
    <PreviewFrame label={t("Página do jogo")}>
      <div className="screen detail pv-screen">
        <ScreenBackground game={game} />
        <TopBar title={t("Detalhes do jogo")} />
        <section className="detail-body">
          <div className="detail-cover" style={coverStyle(game.hue)}>
            <CoverArt game={game} shape="poster" />
          </div>
          <div className="detail-info">
            <h1>{game.title}</h1>
            <GameInfo game={game} durationLine={duration && durationStyle === "line" ? durationLine(duration) : null} />
            <dl className="stats">
              <div>
                <dt>{t("Tempo de jogo")}</dt>
                <dd>
                  {formatPlaytime(game.playtimeMin)}
                  {duration && durationStyle === "hint" && durationHint(duration) && <small className="stat-hint">{durationHint(duration)}</small>}
                </dd>
              </div>
              <div>
                <dt>{t("Última vez")}</dt>
                <dd>{formatLastPlayed(game.lastPlayedAt)}</dd>
              </div>
              <div>
                <dt>{t("Tamanho")}</dt>
                <dd>{formatSize(game.sizeGB)}</dd>
              </div>
              {duration && durationStyle === "stats" && <DurationStats duration={duration} />}
            </dl>
            {duration && durationStyle === "stats" && <p className="stats-source">{t("Duração: HowLongToBeat")}</p>}
            {duration && durationStyle === "section" && <DurationSection duration={duration} playedMin={game.playtimeMin} />}
            <div className="actions">
              <div className="btn btn-primary is-focused">{t("Jogar")}</div>
              <div className="btn">{t("☆ Favoritar")}</div>
              <div className="btn btn-ghost-danger">{t("Desinstalar")}</div>
              <div className="btn">{t("Voltar")}</div>
            </div>
          </div>
        </section>
        <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }, { btn: "Select", label: "Configurações" }]} />
      </div>
    </PreviewFrame>
  );
}

/** A biblioteca em miniatura, com o tamanho das capas, as abas e as contagens escolhidos. */
export function LibraryPreview() {
  const games = useLibrary((s) => s.games);
  const collections = useLibrary((s) => s.collections);
  const appMeta = useLibrary((s) => s.appMeta);
  const config = useLibraryConfig();
  const installedFirst = useNotInstalled((n) => n.installedFirst);
  const tabs = useMemo(() => visibleTabs(config.tabs), [config.tabs]);
  // As mesmas regras da Biblioteca: jogos ocultos, primeira aba, contagens e "instalados primeiro".
  const { list, counts } = useMemo(() => {
    const ctx = makeContext(collections, Date.now(), games, appMeta);
    const pool = applyHidden(games, config.hidden, ctx);
    const sorted = pool.filter((g) => matchesRule(g, tabs[0].rule, ctx)).sort((a, b) => compareText(a.title, b.title));
    return {
      list: installedFirst ? [...sorted.filter((g) => g.state !== "not_installed"), ...sorted.filter((g) => g.state === "not_installed")] : sorted,
      counts: Object.fromEntries(tabs.map((tab) => [tab.id, pool.filter((g) => matchesRule(g, tab.rule, ctx)).length])) as Record<string, number>, // i18n-ignore
    };
  }, [games, collections, appMeta, config.hidden, tabs, installedFirst]);

  return (
    <PreviewFrame label={t("Biblioteca")}>
      <div className="screen library pv-screen">
        <TopBar title={t("Biblioteca")} />
        <div className="library-bar">
          <div className="tabs">
            {tabs.map((tab, i) => (
              <span key={tab.id} className={`tab ${i === 0 ? "is-active" : ""}`}>
                {tabName(tab)}
                {config.showCounts && <em> {counts[tab.id]}</em>}
              </span>
            ))}
          </div>
        </div>
        <div className={`library-grid size-${config.cardSize}`}>
          {list.slice(0, 40).map((g, i) => (
            <PreviewCard key={g.id} game={g} shape="poster" size={config.cardSize} focused={i === 0} />
          ))}
        </div>
        <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "X", label: "Buscar" }, { btn: "Y", label: "Ordenar" }, { btn: "B", label: "Voltar" }]} />
      </div>
    </PreviewFrame>
  );
}
