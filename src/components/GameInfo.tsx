import { useEffect } from "react";
import type { Game } from "../lib/types";
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
export function GameInfo({ game }: { game: Game }) {
  const appId = game.appId;
  const preferred = useUserData((u) => u.preferredLanguage);
  const meta = useLibrary((s) => (appId ? s.appMeta[appId] : undefined));
  const store = useLibrary((s) => (appId ? s.storeDetails[`${appId}:${preferred}`] : undefined));

  useEffect(() => {
    if (appId) void useLibrary.getState().loadStoreDetails(appId);
  }, [appId, preferred]);

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
      ? ["ok", "✓ Suporte completo"]
      : partial
        ? ["warn", "≈ Suporte parcial"]
        : ["bad", "✗ Sem suporte a controle"];

  const year = meta?.releaseDate ? new Date(meta.releaseDate * 1000).getFullYear() : undefined;
  const genres = details?.genres ?? [];
  const byline = [meta?.developer, year ? String(year) : details?.releaseDate].filter(Boolean).join(" · ");
  const ratings = [meta?.reviewPercent ? `${meta.reviewPercent}% de avaliações positivas` : "", meta?.metacritic ? `Metacritic ${meta.metacritic}` : ""].filter(Boolean).join(" · ");

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
      {description ? <p className="info-desc">{description}</p> : loadingText ? <p className="info-desc info-muted">Carregando a descrição…</p> : null}

      <dl className="info-rows">
        <Row label="Idioma" level={langLevel} title={lang.title} detail={lang.detail} />
        {controller && <Row label="Controle" level={controller[0]} title={controller[1]} />}
        {ratings && <Row label="Avaliações" level="neutral" title={ratings} />}
      </dl>
    </div>
  );
}
