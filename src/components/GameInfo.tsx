import type { AppMeta } from "../lib/steam";
import { useEffect } from "react";
import { useGameControllerSupport } from "../hooks/useGameControllerSupport";
import type { Game } from "../lib/types";
import { steamLanguage, t } from "../i18n";
import { languageStatus } from "../lib/languages";
import { useLibrary } from "../store/library";
import { useUserData } from "../store/userData";

type Level = "ok" | "warn" | "bad" | "neutral";

function Row({ label, level, title, detail }: { label: string; level: Level; title: string; detail?: string }) {
  return (
    <div className={`info-row info-${level}`}>
      <dt>{label}</dt>
      <dd>
        <b>{title}</b>
        {detail && <span>{detail}</span>}
      </dd>
    </div>
  );
}

/**
 * Informações do jogo na página dele: descrição, idioma preferido (o jogo tem ou não), suporte a controle
 * e avaliações. Os dados vêm do appinfo local da Steam e, a descrição, da loja (com cache).
 */
export function GameInfo({ game, durationLine, sample }: { game: Game; durationLine?: string | null; sample?: AppMeta }) {
  // Idiomas e avaliações usam os dados guardados no appinfo da Steam. Nas prévias com a biblioteca fictícia, os dados vêm
  // prontos em `sample` e nada é consultado.
  const appId = game.source === "steam" && !sample ? game.appId : undefined;
  const preferred = useUserData((u) => u.preferredLanguage);
  const storeMeta = useLibrary((s) => (appId ? s.appMeta[appId] : undefined));
  const meta = sample ?? storeMeta;
  const store = useLibrary((s) => (appId ? s.storeDetails[`${appId}:${steamLanguage()}`] : undefined));
  const known = useGameControllerSupport(game);
  const support = sample ? "full" : known.support;
  const override = sample ? undefined : known.override;

  useEffect(() => {
    if (appId) void useLibrary.getState().loadStoreDetails(appId);
  }, [appId]);

  // Sem os dados do jogo (idiomas, controle, avaliações), relê o arquivo da Steam: ele pode ter sido reescrito.
  useEffect(() => {
    if (appId && !meta) void useLibrary.getState().refreshAppMeta({ missingFor: appId });
  }, [appId, meta]);


  const details = store && typeof store === "object" ? store : undefined;
  const description = details?.shortDescription || game.description || "";
  const loadingText = store === "loading" && !description;

  const lang = languageStatus(meta, preferred);
  const langLevel: Level = lang.level === "full" ? "ok" : lang.level === "partial" ? "warn" : lang.level === "missing" ? "bad" : "neutral";

  const controller: Record<typeof support, [Level, string]> = {
    full: ["ok", t("✓ Suporte completo")],
    partial: ["warn", t("≈ Suporte parcial")],
    supported: ["ok", t("✓ Com suporte")],
    none: ["bad", t("✗ Sem suporte a controle")],
    unknown: ["neutral", t("Suporte a controle não confirmado")],
  };

  const year = meta?.releaseDate ? new Date(meta.releaseDate * 1000).getFullYear() : undefined;
  const genres = details?.genres ?? [];
  const byline = [meta?.developer ?? game.developer, year ? String(year) : details?.releaseDate].filter(Boolean).join(" · ");
  const ratings = [meta?.reviewPercent ? t("{n}% de avaliações positivas", { n: meta.reviewPercent }) : "", meta?.metacritic ? `Metacritic ${meta.metacritic}` : ""].filter(Boolean).join(" · ");

  return (
    <div className="game-info">
      {(genres.length > 0 || byline || game.source === "epic") && (
        <p className="info-meta">
          {game.source === "epic" && <span className="chip">{t("Epic Games")}</span>}
          {genres.map((g) => (
            <span key={g} className="chip">{g}</span>
          ))}
          {byline && <span className="info-byline">{byline}</span>}
        </p>
      )}
      {description ? <p className="info-desc">{description}</p> : loadingText ? <p className="info-desc info-muted">{t("Carregando a descrição…")}</p> : null}

      <dl className="info-rows">
        {game.source === "steam" && <Row label={t("Idioma")} level={langLevel} title={lang.title} detail={lang.detail} />}
        <Row label={t("Controle")} level={controller[support][0]} title={controller[support][1]} detail={override !== undefined ? t("Marcado por você") : !sample && known.steamVersion ? t("Informado pela versão da Steam") : undefined} />
        {ratings && <Row label={t("Avaliações")} level="neutral" title={ratings} />}
        {durationLine && <Row label={t("Duração")} level="neutral" title={durationLine} detail="HowLongToBeat" />}
      </dl>
    </div>
  );
}
