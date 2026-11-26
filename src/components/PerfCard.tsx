import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { t } from "../i18n";
import { FRAMES_STALE_MS, perf, type FrameSummary, type PerfConfig, type PerfPosition, type PerfSnapshot, withDefaults } from "../lib/perf";

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

/**
 * Gráfico de frametime com o tempo no eixo horizontal (6 s; a direita é "agora"). Cada barra é o pior quadro daquele instante;
 * onde não há barra, nenhum quadro terminou. A escala é fixa (o dobro do tempo de quadro da meta) e um pico que passa dela
 * ganha uma marca no topo e o valor escrito, sem encolher o resto.
 */
function FrameGraph({ summary, config }: { summary: FrameSummary; config: PerfConfig }) {
  const columns = summary.history;
  const height = 28;
  const target = 1000 / config.fpsGood;
  const top = Math.max(target * 2, 25);
  const clipped = summary.frametimeMax > top;
  return (
    <div className="perf-graph-box">
      <svg className="perf-graph" viewBox={`0 0 ${Math.max(columns.length, 1)} ${height}`} preserveAspectRatio="none" role="img" aria-label={t("Gráfico de frametime")}>
        <line x1="0" x2={columns.length} y1={height - (target / top) * height} y2={height - (target / top) * height} className="perf-graph-target" />
        {columns.map((ms, i) => {
          if (ms === null) return null;
          const h = Math.max(1, Math.min(height, (ms / top) * height));
          return (
            <Fragment key={i}>
              <rect x={i} y={height - h} width="0.82" height={h} fill={frameColor(ms, config)} />
              {ms > top && <rect x={i - 0.6} y="0" width="2.2" height="3.5" fill={config.colors.text} />}
            </Fragment>
          );
        })}
      </svg>
      {clipped && <span className="perf-graph-peak">▲ {Math.round(summary.frametimeMax)} ms</span>}
    </div>
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

  // Sem quadros recentes (ou sem leitura chegando) os números "de agora" não são mostrados como se fossem atuais.
  const stalled = !!summary && summary.ageMs > FRAMES_STALE_MS;
  const current = summary && !stalled && !snapshot.delayed;
  const fps = current ? summary.fps : null;
  const frametime = current ? summary.frametime : null;
  const whole = (value: number | null | undefined) => (value === null || value === undefined ? "—" : String(Math.round(value)));
  const chips: { label: string; value: string; unit?: string; color?: string }[] = [];
  if (summary) {
    if (items.average) chips.push({ label: t("Média"), value: whole(summary.average) });
    if (items.low1) chips.push({ label: t("1% low"), value: whole(summary.low1) });
    if (items.low01) chips.push({ label: t("0,1% low"), value: whole(summary.low01) });
    if (items.frametime) chips.push({ label: t("Frametime"), value: frametime === null ? "—" : frametime.toFixed(1), unit: "ms", color: frametime === null ? undefined : frameColor(frametime, config) });
  }
  let frameNote: string | null = null;
  if (snapshot.delayed) frameNote = t("Leitura atrasada");
  else if (summary && stalled) frameNote = t("Sem quadros há {s} s", { s: Math.max(1, Math.round(summary.ageMs / 1000)) });
  else if (summary && summary.fps === null) frameNote = t("Medindo…");

  // Item ligado sem leitura mostra "—" (a linha não some nem muda de lugar quando o Windows atrasa uma informação).
  const cpuRow = items.cpuName || items.cpuUsage;
  const gpuRow = items.gpuName || items.gpuUsage || items.gpuTemp || items.gpuPower;
  const vramRow = items.vram;
  const ramRow = items.ram;
  const hardware = cpuRow || gpuRow || vramRow || ramRow;
  const showFps = items.fps;
  const showStats = chips.length > 0;
  const showGraph = items.graph && !!summary && summary.history.some((column) => column !== null);
  const gameName = items.game && snapshot.game ? snapshot.game.process.replace(/\.exe$/i, "") : "";

  return (
    <div className={`perf-card perf-${config.layout} perf-bg-${config.background}`} style={style}>
      {gameName && <div className="perf-game">{gameName}</div>}

      {(showFps || showStats) && (
        <div className="perf-top">
          {showFps && (
            <div className="perf-fps">
              <b style={{ color: fps !== null ? fpsColor(fps, config) : colors.label }}>{whole(fps)}</b>
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
      {!denied && !failed && !summary && (items.fps || items.average || items.low1 || items.low01 || items.frametime || items.graph) && <div className="perf-note">{t("Aguardando um jogo…")}</div>}
      {!denied && !failed && frameNote && (items.fps || items.frametime || items.graph) && <div className="perf-note">{frameNote}</div>}

      {hardware && (
        <div className="perf-hw">
          {cpuRow && (
            <Row tag="CPU" name={items.cpuName ? (full ? cpu.name : cpu.shortName) : undefined}>
              {items.cpuUsage && <Num value={whole(cpu.usage)} unit="%" />}
            </Row>
          )}
          {gpuRow && (
            <Row tag="GPU" name={items.gpuName ? (full ? gpu.name : gpu.shortName) : undefined}>
              {items.gpuUsage && <Num value={whole(gpu.usage)} unit="%" />}
              {items.gpuTemp && <Num value={whole(gpu.temperature)} unit="°C" color={gpu.temperature === null ? undefined : tempColor(gpu.temperature, config)} />}
              {items.gpuPower && <Num value={whole(gpu.powerPercent)} unit={t("% pot.")} />}
            </Row>
          )}
          {vramRow && (
            <Row tag="VRAM">
              <Num value={gpu.vramUsed === null ? "—" : gpu.vramTotal ? `${gb(gpu.vramUsed)}/${gb(gpu.vramTotal)}` : gb(gpu.vramUsed)} unit="GB" />
            </Row>
          )}
          {ramRow && (
            <Row tag="RAM">
              <Num value={ram.totalMb > 0 ? `${gb(ram.usedMb)}/${gb(ram.totalMb)}` : "—"} unit="GB" />
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

/** Uma resposta que demora mais que isto é abandonada: a próxima pergunta não espera por ela. */
const REPLY_LIMIT_MS = 1500;

/** Pergunta ao Rust o estado do contador algumas vezes por segundo. Se as respostas pararem, o resultado vem marcado como atrasado. */
export function usePerfSnapshot(everyMs: number): PerfSnapshot | null {
  const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    let busy = false;
    let lastGood = performance.now();
    const tick = async () => {
      if (performance.now() - lastGood > REPLY_LIMIT_MS + everyMs) setSnapshot((now) => (now && !now.delayed ? { ...now, delayed: true } : now));
      if (busy) return;
      busy = true;
      let limit = 0;
      try {
        const late = new Promise<never>((_, reject) => {
          limit = window.setTimeout(() => reject(new Error("timeout")), REPLY_LIMIT_MS);
        });
        // Uma resposta que chega depois do limite é descartada junto com a corrida: nunca substitui uma mais nova.
        const next = await Promise.race([perf.snapshot(), late]);
        lastGood = performance.now();
        if (alive) setSnapshot(next);
      } catch (e) {
        console.error("perf_snapshot falhou", e); // i18n-ignore
      } finally {
        window.clearTimeout(limit);
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
