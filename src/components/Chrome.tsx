import { useEffect, useState } from "react";
import type { Game } from "../lib/types";
import { useUI } from "../store/ui";

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <span className="clock">{now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>;
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
          {h.label}
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
      <Clock />
    </header>
  );
}

/** Linha de resumo do jogo (herói da Home): tempo jogado ou estado de instalação. */
export function gameSubtitle(g: Game): string {
  if (g.state === "installed") return formatPlaytime(g.playtimeMin);
  if (g.state === "installing") return g.progress === undefined ? "Preparando download…" : `Baixando… ${Math.round(g.progress * 100)}%`;
  const parts = ["Não instalado"];
  if (g.playtimeMin > 0) parts.push(formatPlaytime(g.playtimeMin));
  return parts.join(" · ");
}

export function formatSize(gb: number): string {
  return gb > 0 ? `${gb} GB` : "—";
}

export function formatPlaytime(min: number): string {
  if (min <= 0) return "Nunca jogado";
  const h = Math.floor(min / 60);
  return h >= 1 ? `${h} h jogadas` : `${min} min jogados`;
}

export function formatLastPlayed(ts?: number): string {
  if (!ts) return "—";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  return `Há ${days} dias`;
}
