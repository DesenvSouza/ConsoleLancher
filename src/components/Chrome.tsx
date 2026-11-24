import { useEffect, useState, type ReactElement } from "react";
import { formatNumber, locale, t } from "../i18n";
import type { Game } from "../lib/types";
import { useUI } from "../store/ui";
import { useDownloads } from "../store/downloads";
import { openDownloadsQueue } from "../screens/Downloads";
import { FocusGroup, Focusable } from "./Focusable";
import { glyphText, useGlyphKind, type PadKind } from "../input/padKind";
import { useInPreview } from "./preview/context";
import { SystemIndicators } from "./System";

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return <span className="clock">{now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false })}</span>;
}

type Glyph = "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "Start" | "Select" | "LR";

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
  const kind = useGlyphKind();
  if (items.length === 0 || (modalOpen && !modal)) return null;
  return (
    <footer className={`hints ${modal ? "hints-modal" : ""}`}>
      {items.map((h) => (
        <span key={h.btn + h.label} className="hint">
          <i className={`glyph glyph-${h.btn.toLowerCase()} ${kind === "playstation" ? "glyph-ps" : ""}`}><GlyphFace btn={h.btn} kind={kind} /></i>
          {t(h.label)}
        </span>
      ))}
    </footer>
  );
}

const PS_SHAPES: Record<string, ReactElement> = {
  A: <path d="M6 6l12 12M18 6L6 18" />,
  B: <circle cx="12" cy="12" r="6.3" />,
  X: <rect x="6" y="6" width="12" height="12" rx="0.6" />,
  Y: <path d="M12 5L19.2 17.4H4.8z" strokeLinejoin="round" />,
};

/** Conteúdo do ícone: no PlayStation, os quatro símbolos são desenhados (as fontes os fazem de tamanhos e espessuras diferentes). */
function GlyphFace({ btn, kind }: { btn: Glyph; kind: PadKind }) {
  if (kind === "playstation" && PS_SHAPES[btn]) {
    return <svg className="glyph-shape" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>{PS_SHAPES[btn]}</svg>;
  }
  return <>{glyphText(btn, kind)}</>;
}

/** Ícone de botão do controle (o mesmo das legendas), para usar dentro de textos. */
export function ButtonGlyph({ btn }: { btn: Glyph }) {
  const kind = useGlyphKind();
  return <i className={`glyph glyph-${btn.toLowerCase()} ${kind === "playstation" ? "glyph-ps" : ""}`}><GlyphFace btn={btn} kind={kind} /></i>;
}

/** O PC vai ser desligado quando os downloads acabarem: avisa em qualquer tela, não só em Downloads. */
function ShutdownArmedBadge() {
  const armed = useDownloads((s) => s.shutdownArmed);
  if (!armed) return null;
  return <span className="sys-ind warn" title={t("Desliga o PC ao concluir os downloads")}>⏻ {t("Desliga ao concluir os downloads")}</span>;
}

/** Destinos principais do launcher, com botão no cabeçalho. */
export type NavTarget = "home" | "library" | "downloads" | "settings";

const NAV: { id: Exclude<NavTarget, "settings">; label: string }[] = [
  { id: "home", label: "Início" },
  { id: "library", label: "Biblioteca" },
  { id: "downloads", label: "Downloads" },
];

function goTo(target: NavTarget) {
  if (target === "downloads") openDownloadsQueue();
  useUI.getState().goTo(target);
}

/** Engrenagem de configurações (o nome fica no rótulo acessível e na dica). */
function GearIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Um botão do cabeçalho: focável na tela de verdade, só desenho na prévia. */
function NavButton({ id, label, current, extra = "", icon }: { id: NavTarget; label: string; current?: NavTarget; extra?: string; icon?: boolean }) {
  const preview = useInPreview();
  const className = `nav-pill ${extra} ${icon ? "nav-pill-icon" : ""} ${current === id ? "is-current" : ""}`;
  const content = icon ? <GearIcon /> : t(label);
  if (preview) return <span className={className}>{content}</span>;
  return (
    <Focusable focusKey={`nav-${id}`} className={className} scroll={false} label={t(label)} onPress={() => goTo(id)}>
      {content}
    </Focusable>
  );
}

/**
 * Cabeçalho das telas. Com `current`, mostra os botões Início, Biblioteca e Downloads (e Configurações à direita), todos
 * alcançáveis pelo direcional e por A; os atalhos X, Y e Select continuam valendo. Sem `current` (telas internas), mostra
 * o título da tela.
 */
export function TopBar({ title, current }: { title: string; current?: NavTarget }) {
  const preview = useInPreview();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-dot" />
        {current ? (
          preview ? (
            <nav className="nav-pills" aria-label={t("Navegação principal")}>
              {NAV.map((item) => <NavButton key={item.id} id={item.id} label={item.label} current={current} />)}
            </nav>
          ) : (
            <FocusGroup focusKey="topbar-nav" className="nav-pills" preferredChildFocusKey={`nav-${current === "settings" ? "home" : current}`}>
              {NAV.map((item) => <NavButton key={item.id} id={item.id} label={item.label} current={current} />)}
            </FocusGroup>
          )
        ) : (
          title
        )}
      </div>
      <div className="topbar-right">
        <ShutdownArmedBadge />
        <SystemIndicators />
        {current && <NavButton id="settings" label="Configurações" current={current} extra="nav-settings" icon />}
        <Clock />
      </div>
    </header>
  );
}

/** Linha de resumo do jogo (herói da Home): tempo jogado ou estado de instalação. */
export function gameSubtitle(g: Game): string {
  if (g.state === "installed") {
    const played = g.playtimeMin > 0 ? t("{time} de jogo", { time: formatPlaytime(g.playtimeMin) }) : t("Nunca jogado");
    return g.update === "pending" ? `${played} · ${t("Atualização disponível")}` : played;
  }
  if (g.state === "installing" && g.update) return g.progress === undefined ? t("Preparando atualização…") : t("Atualizando… {pct}%", { pct: Math.round(g.progress * 100) });
  if (g.state === "installing") return g.progress === undefined ? t("Preparando download…") : t("Baixando… {pct}%", { pct: Math.round(g.progress * 100) });
  const parts = [t("Não instalado")];
  if (g.playtimeMin > 0) parts.push(t("{time} de jogo", { time: formatPlaytime(g.playtimeMin) }));
  return parts.join(" · ");
}

export function formatSize(gb: number): string {
  if (gb <= 0) return "—";
  // Abaixo de 1 GB, em MB (a lista de armazenamento já mostra assim): o mesmo jogo, o mesmo número nas duas telas.
  if (gb < 1) return `${Math.max(1, Math.round(gb * 1024))} MB`;
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
