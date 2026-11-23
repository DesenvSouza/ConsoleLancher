import { useEffect } from "react";
import { formatNumber, t } from "../i18n";
import type { Game } from "../lib/types";
import { useHltb } from "../store/hltb";
import { useUserData, type HltbTimes } from "../store/userData";
import { formatPlaytime } from "./Chrome";

/** Um tempo da HowLongToBeat, pronto para mostrar. */
export interface DurationItem {
  id: "main" | "extras" | "completionist";
  /** Rótulo curto (colunas e cartões). */
  label: string;
  minutes: number;
}

export interface GameDuration {
  items: DurationItem[];
  /** Tempo da história principal (para comparar com o que o jogador já jogou). */
  mainMin: number | null;
}

const TIMES: Record<HltbTimes, DurationItem["id"][]> = {
  all: ["main", "extras", "completionist"],
  "main-extras": ["main", "extras"],
  main: ["main"],
};

/**
 * Duração do jogo (HowLongToBeat) conforme as opções do jogador. Pede o dado ao site se preciso (com cache) e devolve null
 * enquanto não há resposta, quando a opção está desligada ou quando o site não conhece o jogo.
 */
/** Tempos de exemplo para a prévia das configurações quando o site não tem (ou ainda não respondeu) o jogo. */
const SAMPLE_INFO = { mainMin: 1500, extrasMin: 2700, completionistMin: 4800 };

export function useGameDuration(game: Game | undefined, options?: { sample?: boolean }): GameDuration | null {
  const show = useUserData((u) => u.showHltb);
  const times = useUserData((u) => u.hltbTimes);
  const appId = game?.appId;
  const info = useHltb((s) => (appId ? s.entries[appId]?.info : undefined));

  useEffect(() => {
    if (appId && show && game?.source === "steam") void useHltb.getState().load(appId, game.title);
  }, [appId, show, game?.source, game?.title]);

  const base = info ?? (options?.sample ? SAMPLE_INFO : undefined);
  if (!show || !base) return null;
  const all: Record<DurationItem["id"], DurationItem | null> = {
    main: base.mainMin ? { id: "main", label: t("Para zerar"), minutes: base.mainMin } : null,
    extras: base.extrasMin ? { id: "extras", label: t("Com extras"), minutes: base.extrasMin } : null,
    completionist: base.completionistMin ? { id: "completionist", label: t("Completista"), minutes: base.completionistMin } : null,
  };
  const items = TIMES[times].map((id) => all[id]).filter((item): item is DurationItem => item !== null);
  return items.length > 0 ? { items, mainMin: base.mainMin } : null;
}

/** Texto da linha de duração (estilo "Linha de texto"). */
export function durationLine(duration: GameDuration): string {
  return duration.items.map((item) => `${item.label} ${formatPlaytime(item.minutes)}`).join(" · ");
}

/** Colunas extras para a linha de números (estilo "Junto dos números"). */
export function DurationStats({ duration }: { duration: GameDuration }) {
  return (
    <>
      <div className="stat-sep" aria-hidden />
      {duration.items.map((item) => (
        <div key={item.id} className="stat-hltb">
          <dt>{item.label}</dt>
          <dd>{formatPlaytime(item.minutes)}</dd>
        </div>
      ))}
    </>
  );
}

/** Quantas vezes a história principal o jogador já jogou, em texto. */
function progressText(playedMin: number, mainMin: number | null): string {
  if (playedMin <= 0) return t("Você ainda não jogou");
  const played = t("Você jogou {time}", { time: formatPlaytime(playedMin) });
  if (!mainMin) return played;
  const ratio = playedMin / mainMin;
  if (ratio >= 1.05) return `${played} (${t("{n}× a história principal", { n: formatNumber(ratio) })})`;
  if (ratio >= 0.95) return `${played} (${t("a história principal inteira")})`;
  return `${played} (${t("{n}% da história principal", { n: Math.round(ratio * 100) })})`;
}

/** Bloco próprio com os tempos e uma barra do quanto o jogador já jogou (estilo "Seção própria"). */
export function DurationSection({ duration, playedMin }: { duration: GameDuration; playedMin: number }) {
  // A barra vai até o maior entre o último tempo e o que o jogador jogou; os marcadores mostram onde cada tempo cai.
  const last = duration.items[duration.items.length - 1].minutes;
  const scale = Math.max(last, playedMin, 1);
  return (
    <section className="duration" aria-label={t("Duração do jogo")}>
      <h3 className="duration-title">
        {t("Quanto tempo leva")} <small>HowLongToBeat</small>
      </h3>
      <div className="duration-cards">
        {duration.items.map((item) => (
          <div key={item.id} className="duration-card">
            <span>{item.label}</span>
            <b>{formatPlaytime(item.minutes)}</b>
          </div>
        ))}
      </div>
      <div className="duration-bar" role="progressbar" aria-valuemin={0} aria-valuemax={scale} aria-valuenow={Math.min(playedMin, scale)}>
        <div className="duration-fill" style={{ width: `${Math.min(100, (playedMin / scale) * 100)}%` }} />
        {duration.items.map((item) => (
          <i key={item.id} className="duration-mark" style={{ left: `${(item.minutes / scale) * 100}%` }} />
        ))}
      </div>
      <p className="duration-note">{progressText(playedMin, duration.mainMin)}</p>
    </section>
  );
}

/** Dica discreta ao lado do tempo de jogo (estilo "Dica curta"): só a história principal. */
export function durationHint(duration: GameDuration): string | null {
  return duration.mainMin ? t("a história leva ~{time}", { time: formatPlaytime(duration.mainMin) }) : null;
}
