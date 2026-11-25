import { useMemo } from "react";
import { compareText, t } from "../../i18n";
import { usePreviewGames } from "../../hooks/usePreviewGames";
import { useUniqueGames } from "../../hooks/useUniqueGames";
import { SAMPLE_FEATURED_META } from "../../lib/sampleLibrary";
import { useRuleContext } from "../../hooks/useRuleContext";
import { applyHidden, matchesRule } from "../../lib/libraryRules";
import { homeRows } from "../../lib/homeRows";
import type { Game } from "../../lib/types";
import { BLOCK_TITLES, useHome } from "../../store/home";
import { tabName, useLibraryConfig, visibleTabs } from "../../store/libraryConfig";
import { useNotInstalled } from "../../store/notInstalled";
import { useUserData } from "../../store/userData";
import { Hints, TopBar, formatLastPlayed, formatPlaytime, formatSize, gameSubtitle } from "../Chrome";
import { CardFace, CoverArt, coverStyle } from "../GameCard";
import { DurationSection, DurationStats, durationHint, durationLine, useGameDuration } from "../GameDuration";
import { GameInfo } from "../GameInfo";
import { ScreenBackground } from "../ScreenBackground";
import { PreviewFrame } from "./PreviewFrame";

/** O nome da moldura diz quando o que aparece é a biblioteca fictícia. */
const previewLabel = (screen: string, sample: boolean) => (sample ? t("{screen} · dados de exemplo", { screen }) : screen);

/** Cartão só para olhar (não é focável): a capa, os selos e o resto do cartão de verdade. */
function PreviewCard({ game, shape, size, focused, showSource }: { game: Game; shape: "poster" | "wide"; size: "s" | "m" | "l"; focused?: boolean; showSource?: boolean }) {
  return (
    <div className={`card card-${shape} card-${size} ${focused ? "is-focused" : ""}`}>
      <CardFace game={game} shape={shape} showSource={showSource} />
    </div>
  );
}

/** A página inicial em miniatura, com as fileiras, o destaque e o fundo escolhidos. */
export function HomePreview() {
  const { games, featured: hero, sample } = usePreviewGames();
  const { blocks, showHero, rowMode } = useHome();
  const showStoreIcons = useLibraryConfig((s) => s.showStoreIcons);
  const hideNotInstalled = useNotInstalled((n) => n.hideFromHome);
  const unique = useUniqueGames(games);
  const rows = useMemo(() => homeRows(blocks, unique, hideNotInstalled), [blocks, unique, hideNotInstalled]);
  // "Uma por vez" mostra só a fileira selecionada; "Todas" deixa ver as seguintes. A primeira fileira começa pelo destaque.
  const shown = (rowMode === "one" ? rows.slice(0, 1) : rows.slice(0, 3)).map((row, i) => ({
    ...row,
    games: i === 0 ? [hero, ...row.games.filter((g) => g.id !== hero.id)] : row.games,
  }));

  return (
    <PreviewFrame label={previewLabel(t("Início"), sample)}>
      <div className="screen home pv-screen">
        <ScreenBackground game={hero} />
        <TopBar title={t("Início")} current="home" />
        {showHero && (
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
                  <PreviewCard key={g.id} game={g} shape={block.style === "wide" ? "wide" : "poster"} size={block.size} focused={rowIndex === 0 && i === 0} showSource={showStoreIcons} />
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
  const { featured: game, sample } = usePreviewGames();
  const duration = useGameDuration(game, { sample: true });
  const durationStyle = useUserData((u) => u.hltbStyle);

  return (
    <PreviewFrame label={previewLabel(t("Página do jogo"), sample)}>
      <div className="screen detail pv-screen">
        <ScreenBackground game={game} />
        <TopBar title={t("Detalhes do jogo")} />
        <section className="detail-body">
          <div className="detail-cover" style={coverStyle(game.hue)}>
            <CoverArt game={game} shape="poster" />
          </div>
          <div className="detail-info">
            <h1>{game.title}</h1>
            <div className="actions">
              <div className="btn btn-primary is-focused">{t("Jogar")}</div>
              <div className="btn">{t("☆ Favoritar")}</div>
              <div className="btn btn-ghost-danger">{t("Desinstalar")}</div>
              <div className="btn">{t("Voltar")}</div>
            </div>
            <GameInfo game={game} sample={sample ? SAMPLE_FEATURED_META : undefined} durationLine={duration && durationStyle === "line" ? durationLine(duration) : null} />
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
          </div>
        </section>
        <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }, { btn: "Select", label: "Configurações" }]} />
      </div>
    </PreviewFrame>
  );
}

/** A biblioteca em miniatura, com o tamanho das capas, as abas e as contagens escolhidos. */
export function LibraryPreview({ tabId }: { tabId?: string } = {}) {
  const { games, featured, sample } = usePreviewGames();
  const config = useLibraryConfig();
  const installedFirst = useNotInstalled((n) => n.installedFirst);
  // A aba em foco nas configurações aparece mesmo se estiver oculta.
  const tabs = useMemo(() => {
    const visible = visibleTabs(config.tabs);
    const chosen = config.tabs.find((tab) => tab.id === tabId);
    return chosen && !visible.includes(chosen) ? [...visible, chosen] : visible;
  }, [config.tabs, tabId]);
  const shownTab = tabs.find((tab) => tab.id === tabId) ?? tabs[0];
  // As mesmas regras da Biblioteca: jogos ocultos, primeira aba, contagens e "instalados primeiro".
  const ctx = useRuleContext();
  const shownOnce = useUniqueGames(games);
  const pool = useMemo(() => applyHidden(shownOnce, config.hidden, ctx), [shownOnce, config.hidden, ctx]);
  const { list, counts } = useMemo(() => {
    const sorted = pool.filter((g) => matchesRule(g, shownTab.rule, ctx)).sort((a, b) => compareText(a.title, b.title));
    return {
      list: installedFirst ? [...sorted.filter((g) => g.state !== "not_installed"), ...sorted.filter((g) => g.state === "not_installed")] : sorted,
      counts: Object.fromEntries(tabs.map((tab) => [tab.id, pool.filter((g) => matchesRule(g, tab.rule, ctx)).length])) as Record<string, number>, // i18n-ignore
    };
  }, [ctx, pool, tabs, shownTab, installedFirst]);

  return (
    <PreviewFrame label={previewLabel(t("Biblioteca"), sample)}>
      <div className="screen library pv-screen">
        <TopBar title={t("Biblioteca")} current="library" />
        <div className="library-bar">
          <div className="tabs">
            {tabs.map((tab) => (
              <span key={tab.id} className={`tab ${tab.id === shownTab.id ? "is-active" : ""}`}>
                {tabName(tab)}
                {config.showCounts && <em> {counts[tab.id]}</em>}
              </span>
            ))}
          </div>
        </div>
        <div className={`library-grid size-${config.cardSize}`}>
          {[...list.filter((g) => g.id === featured.id), ...list.filter((g) => g.id !== featured.id)].slice(0, 40).map((g, i) => (
            <PreviewCard key={g.id} game={g} shape="poster" size={config.cardSize} focused={i === 0} showSource={config.showStoreIcons} />
          ))}
        </div>
        <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "X", label: "Buscar" }, { btn: "Y", label: "Ordenar" }, { btn: "B", label: "Voltar" }]} />
      </div>
    </PreviewFrame>
  );
}
