import { useEffect } from "react";
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
export function GameInfo({ game, durationLine }: { game: Game; durationLine?: string | null }) {
  const appId = game.appId;
  const preferred = useUserData((u) => u.preferredLanguage);
  const meta = useLibrary((s) => (appId ? s.appMeta[appId] : undefined));
  const store = useLibrary((s) => (appId ? s.storeDetails[`${appId}:${steamLanguage()}`] : undefined));

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

  const full = meta?.controllerSupport === 2 || meta?.categories.includes(28);
  const partial = meta?.controllerSupport === 1 || meta?.categories.includes(18);
  const controller: [Level, string] | null = !meta
    ? null
    : full
      ? ["ok", t("✓ Suporte completo")]
      : partial
        ? ["warn", t("≈ Suporte parcial")]
        : ["bad", t("✗ Sem suporte a controle")];

  const year = meta?.releaseDate ? new Date(meta.releaseDate * 1000).getFullYear() : undefined;
  const genres = details?.genres ?? [];
  const byline = [meta?.developer, year ? String(year) : details?.releaseDate].filter(Boolean).join(" · ");
  const ratings = [meta?.reviewPercent ? t("{n}% de avaliações positivas", { n: meta.reviewPercent }) : "", meta?.metacritic ? `Metacritic ${meta.metacritic}` : ""].filter(Boolean).join(" · ");

  return (
    <div className="game-info">
      {(genres.length > 0 || byline) && (
        <p className="info-meta">
          {genres.map((g) => (
            <span key={g} className="chip">{g}</span>
          ))}
          {byline && <span className="info-byline">{byline}</span>}
        </p>
      )}
      {description ? <p className="info-desc">{description}</p> : loadingText ? <p className="info-desc info-muted">{t("Carregando a descrição…")}</p> : null}

      <dl className="info-rows">
        <Row label={t("Idioma")} level={langLevel} title={lang.title} detail={lang.detail} />
        {controller && <Row label={t("Controle")} level={controller[0]} title={controller[1]} />}
        {ratings && <Row label={t("Avaliações")} level="neutral" title={ratings} />}
        {durationLine && <Row label={t("Duração")} level="neutral" title={durationLine} detail="HowLongToBeat" />}
      </dl>
    </div>
  );
}
