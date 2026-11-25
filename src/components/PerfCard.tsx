import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { t } from "../i18n";
import { perf, type FrameSummary, type PerfConfig, type PerfPosition, type PerfSnapshot, withDefaults } from "../lib/perf";

/** #RRGGBB → rgba(...) com a opacidade pedida. */
function rgba(hex: string, alpha: number): string {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000";
  const n = parseInt(value.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Texto claro ou escuro, o que ler melhor sobre o fundo escolhido. */
function readableOn(hex: string): string {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "000000", 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.6 ? "#0b0d14" : "#ffffff";
}

const gb = (mb: number) => (mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1);

function fpsColor(fps: number, config: PerfConfig): string {
  if (config.colors.fps !== "auto") return config.colors.fps;
  return fps >= config.fpsGood ? config.colors.good : fps >= config.fpsWarn ? config.colors.warn : config.colors.bad;
}

function frameColor(ms: number, config: PerfConfig): string {
  if (ms <= 1000 / config.fpsGood) return config.colors.good;
  if (ms <= 1000 / config.fpsWarn) return config.colors.warn;
  return config.colors.bad;
}

function tempColor(celsius: number, config: PerfConfig): string {
  return celsius >= config.tempHot ? config.colors.bad : celsius >= config.tempWarn ? config.colors.warn : config.colors.text;
}

/** Gráfico de frametime: uma barra por quadro (as mais altas são os engasgos), colorida pela faixa de FPS. */
function FrameGraph({ summary, config }: { summary: FrameSummary; config: PerfConfig }) {
  const history = summary.history;
  const height = 28;
  const top = Math.max(33.4, Math.min(100, summary.frametimeMax * 1.1));
  const target = 1000 / config.fpsGood;
  return (
    <svg className="perf-graph" viewBox={`0 0 ${Math.max(history.length, 1)} ${height}`} preserveAspectRatio="none" role="img" aria-label={t("Gráfico de frametime")}>
      <line x1="0" x2={history.length} y1={height - (target / top) * height} y2={height - (target / top) * height} className="perf-graph-target" />
      {history.map((ms, i) => {
        const h = Math.max(1, Math.min(height, (ms / top) * height));
        return <rect key={i} x={i} y={height - h} width="0.82" height={h} fill={frameColor(ms, config)} />;
      })}
    </svg>
  );
}

/** Uma linha de hardware: etiqueta, nome e números. */
function Row({ tag, name, children }: { tag: string; name?: string; children: ReactNode }) {
  return (
    <div className="perf-row">
      <span className="perf-tag">{tag}</span>
      {name && <span className="perf-name">{name}</span>}
      <span className="perf-nums">{children}</span>
    </div>
  );
}

function Num({ value, unit, color }: { value: string; unit?: string; color?: string }) {
  return (
    <span className="perf-num" style={color ? { color } : undefined}>
      {value}
      {unit && <small>{unit}</small>}
    </span>
  );
}

/**
 * O contador em si: o mesmo desenho aparece sobre o jogo (janela transparente) e na prévia das configurações.
 * Só mostra o que está ligado e o que o Windows informou (item sem dado some, em vez de mostrar um número inventado).
 */
export function PerfCard({ config, snapshot }: { config: PerfConfig; snapshot: PerfSnapshot }) {
  const { items, colors } = config;
  const summary = snapshot.game?.summary ?? null;
  const { cpu, gpu, ram } = snapshot.hw;
  const full = config.names === "full";
  const denied = snapshot.capture.state === "denied";
  const failed = snapshot.capture.state === "failed";
  const style = {
    "--perf-text": colors.text,
    "--perf-label": colors.label,
    "--perf-accent": colors.accent,
    "--perf-bg": config.background === "none" ? "transparent" : rgba(colors.background, config.background === "solid" ? 1 : config.opacity),
    "--perf-bg-text": config.background === "none" ? colors.text : colors.text,
    "--perf-edge": config.background === "glass" ? rgba(readableOn(colors.background), 0.1) : "transparent",
  } as CSSProperties;

  const chips: { label: string; value: string; unit?: string; color?: string }[] = [];
  if (summary) {
    if (items.average) chips.push({ label: t("Média"), value: String(Math.round(summary.average)) });
    if (items.low1) chips.push({ label: t("1% low"), value: String(Math.round(summary.low1)) });
    if (items.low01) chips.push({ label: t("0,1% low"), value: String(Math.round(summary.low01)) });
    if (items.frametime) chips.push({ label: t("Frametime"), value: summary.frametime.toFixed(1), unit: "ms", color: frameColor(summary.frametime, config) });
  }

  const cpuRow = (items.cpuName && cpu.name) || (items.cpuUsage && cpu.usage !== null);
  const gpuRow = (items.gpuName && gpu.name) || (items.gpuUsage && gpu.usage !== null) || (items.gpuTemp && gpu.temperature !== null) || (items.gpuPower && gpu.powerPercent !== null);
  const vramRow = items.vram && gpu.vramUsed !== null;
  const ramRow = items.ram && ram.totalMb > 0;
  const hardware = cpuRow || gpuRow || vramRow || ramRow;
  const showFps = items.fps;
  const showStats = chips.length > 0;
  const showGraph = items.graph && !!summary && summary.history.length > 1;
  const gameName = items.game && snapshot.game ? snapshot.game.process.replace(/\.exe$/i, "") : "";

  return (
    <div className={`perf-card perf-${config.layout} perf-bg-${config.background}`} style={style}>
      {gameName && <div className="perf-game">{gameName}</div>}

      {(showFps || showStats) && (
        <div className="perf-top">
          {showFps && (
            <div className="perf-fps">
              <b style={{ color: summary ? fpsColor(summary.fps, config) : colors.label }}>{summary ? Math.round(summary.fps) : "—"}</b>
              <span>FPS</span>
            </div>
          )}
          {showStats && (
            <div className="perf-chips">
              {chips.map((chip) => (
                <div className="perf-chip" key={chip.label}>
                  <small>{chip.label}</small>
                  <b style={chip.color ? { color: chip.color } : undefined}>
                    {chip.value}
                    {chip.unit && <i>{chip.unit}</i>}
                  </b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showGraph && summary && <FrameGraph summary={summary} config={config} />}

      {(denied || failed) && (items.fps || items.average || items.low1 || items.frametime || items.graph) && (
        <div className="perf-note">{denied ? t("FPS indisponível: falta permissão (Configurações › Sistema › Contador de FPS).") : t("A medição de FPS falhou.")}</div>
      )}
      {!denied && !failed && !summary && (showFps || showStats) && <div className="perf-note">{t("Aguardando um jogo…")}</div>}

      {hardware && (
        <div className="perf-hw">
          {cpuRow && (
            <Row tag="CPU" name={items.cpuName ? (full ? cpu.name : cpu.shortName) : undefined}>
              {items.cpuUsage && cpu.usage !== null && <Num value={String(Math.round(cpu.usage))} unit="%" />}
            </Row>
          )}
          {gpuRow && (
            <Row tag="GPU" name={items.gpuName ? (full ? gpu.name : gpu.shortName) : undefined}>
              {items.gpuUsage && gpu.usage !== null && <Num value={String(Math.round(gpu.usage))} unit="%" />}
              {items.gpuTemp && gpu.temperature !== null && <Num value={String(Math.round(gpu.temperature))} unit="°C" color={tempColor(gpu.temperature, config)} />}
              {items.gpuPower && gpu.powerPercent !== null && <Num value={String(Math.round(gpu.powerPercent))} unit={t("% pot.")} />}
            </Row>
          )}
          {vramRow && gpu.vramUsed !== null && (
            <Row tag="VRAM">
              <Num value={gpu.vramTotal ? `${gb(gpu.vramUsed)}/${gb(gpu.vramTotal)}` : gb(gpu.vramUsed)} unit="GB" />
            </Row>
          )}
          {ramRow && (
            <Row tag="RAM">
              <Num value={`${gb(ram.usedMb)}/${gb(ram.totalMb)}`} unit="GB" />
            </Row>
          )}
        </div>
      )}
    </div>
  );
}

/** Alinhamento do contador dentro da janela (ou da prévia) conforme a posição escolhida. */
export function stageAlignment(position: PerfPosition): CSSProperties {
  const [vertical, horizontal] = position.split("-");
  return {
    alignItems: vertical === "top" ? "flex-start" : vertical === "bottom" ? "flex-end" : "center",
    justifyContent: horizontal === "left" ? "flex-start" : horizontal === "right" ? "flex-end" : "center",
  };
}

/** Pergunta ao Rust o estado do contador algumas vezes por segundo. */
export function usePerfSnapshot(everyMs: number): PerfSnapshot | null {
  const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await perf.snapshot();
        if (alive) setSnapshot(next);
      } catch (e) {
        console.error("perf_snapshot falhou", e); // i18n-ignore
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), everyMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [everyMs]);
  return snapshot;
}

/** A janela transparente do contador (aberta com ?perf=1). */
export function PerfOverlayWindow() {
  const snapshot = usePerfSnapshot(250);
  const config = useMemo(() => (snapshot ? withDefaults(snapshot.config) : null), [snapshot]);

  useEffect(() => {
    document.documentElement.classList.add("perf-window");
    return () => document.documentElement.classList.remove("perf-window");
  }, []);
  useEffect(() => {
    if (!snapshot || !config) return;
    // 1rem = 1/130 da largura do monitor, vezes o tamanho escolhido. A largura vem em pixels da tela: dividida pela escala do
    // Windows, senão numa TV com 150% a 300% o contador saía esse tanto maior.
    document.documentElement.style.fontSize = `${(snapshot.screenWidth / (window.devicePixelRatio || 1) / 130) * config.scale}px`;
  }, [snapshot, config]);

  if (!snapshot || !config || !config.enabled) return null;
  // Com o jogo aberto e o jogador no launcher (Início, Configurações, Guia), o contador não aparece por cima dele.
  if (snapshot.launcherInFront) return null;
  const denied = snapshot.capture.state === "denied" || snapshot.capture.state === "failed";
  // Sem permissão o aviso aparece mesmo sem jogo (senão ligar o contador parece não fazer nada).
  if (config.onlyInGame && !snapshot.game && !denied) return null;
  return (
    <div className="perf-stage" style={stageAlignment(config.position)}>
      <PerfCard config={config} snapshot={snapshot} />
    </div>
  );
}
