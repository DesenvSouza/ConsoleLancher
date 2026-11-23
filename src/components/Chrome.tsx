import { useEffect, useState } from "react";
import { formatNumber, locale, t } from "../i18n";
import type { Game } from "../lib/types";
import { useUI } from "../store/ui";
import { SystemIndicators } from "./System";

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return <span className="clock">{now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false })}</span>;
}

type Glyph = "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "Start" | "Select";

export interface Hint {
  btn: Glyph;
  label: string;
}

/**
 * Legenda dos botões no rodapé, como no Big Picture. Com um menu ou diálogo aberto, a legenda da tela some
 * (os botões dela não valem enquanto ele está aberto) e o próprio menu mostra a dele, com `modal`.
 */
export function Hints({ items, modal = false }: { items: Hint[]; modal?: boolean }) {
  const modalOpen = useUI((s) => s.modalOpen);
  if (items.length === 0 || (modalOpen && !modal)) return null;
  return (
    <footer className={`hints ${modal ? "hints-modal" : ""}`}>
      {items.map((h) => (
        <span key={h.btn + h.label} className="hint">
          <i className={`glyph glyph-${h.btn.toLowerCase()}`}>{h.btn}</i>
          {t(h.label)}
        </span>
      ))}
    </footer>
  );
}

/** Ícone de botão do controle (o mesmo das legendas), para usar dentro de textos. */
export function ButtonGlyph({ btn }: { btn: Glyph }) {
  return <i className={`glyph glyph-${btn.toLowerCase()}`}>{btn}</i>;
}

export function TopBar({ title }: { title: string }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-dot" />
        {title}
      </div>
      <div className="topbar-right">
        <SystemIndicators />
        <Clock />
      </div>
    </header>
  );
}

/** Linha de resumo do jogo (herói da Home): tempo jogado ou estado de instalação. */
export function gameSubtitle(g: Game): string {
  if (g.state === "installed") return g.playtimeMin > 0 ? t("{time} de jogo", { time: formatPlaytime(g.playtimeMin) }) : t("Nunca jogado");
  if (g.state === "installing") return g.progress === undefined ? t("Preparando download…") : t("Baixando… {pct}%", { pct: Math.round(g.progress * 100) });
  const parts = [t("Não instalado")];
  if (g.playtimeMin > 0) parts.push(t("{time} de jogo", { time: formatPlaytime(g.playtimeMin) }));
  return parts.join(" · ");
}

export function formatSize(gb: number): string {
  if (gb <= 0) return "—";
  // Um decimal basta (e evita "12.345678 GB" quando o tamanho vem quebrado).
  const text = gb >= 10 ? String(Math.round(gb)) : formatNumber(Math.round(gb * 10) / 10);
  return `${text} GB`;
}

/** "45 min", "3 h 20 min", "120 h" (sem "de jogo": quem usa acrescenta o contexto). */
export function formatPlaytime(min: number): string {
  if (min <= 0) return t("Nunca jogado");
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return h < 10 && rest > 0 ? `${h} h ${rest} min` : `${h} h`;
}

export function formatLastPlayed(ts?: number): string {
  if (!ts) return "—";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return t("Hoje");
  if (days === 1) return t("Ontem");
  return t("Há {n} dias", { n: days });
}
