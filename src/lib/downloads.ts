import { locale, t } from "../i18n";
import type { InstalledApp } from "./steam";

// Bits de StateFlags dos manifestos da Steam (os mesmos de merge.ts).
const FULLY_INSTALLED = 4;
const UPDATE_REQUIRED = 2;
const UPDATE_RUNNING = 256;
const UPDATE_STARTED = 512;
const DOWNLOADING = 1_048_576;
const RUNNING = UPDATE_RUNNING | UPDATE_STARTED | DOWNLOADING;
const BUSY = UPDATE_REQUIRED | RUNNING;

/** Abaixo disto a velocidade medida é ruído: não dá para estimar o tempo. */
export const MIN_SPEED = 100 * 1024;

export interface QueueItem {
  appId: string;
  title: string;
  /** active = baixando agora; queued = esperando a vez; paused = baixando, mas sem avançar há um tempo. */
  state: "active" | "queued" | "paused";
  /** É atualização de um jogo já instalado (e não uma instalação nova): cancelar apagaria o jogo, então não se oferece. */
  isUpdate: boolean;
  /** Total a gravar em disco (0 = a Steam ainda não informou). */
  total: number;
  /** Quanto já foi gravado. */
  done: number;
  libraryPath: string;
  /** Segundos até este item terminar, contando os que vêm antes dele na fila (null = sem estimativa). */
  etaSec: number | null;
  /** Instante (ms) previsto para este item terminar. */
  finishAt: number | null;
}

/** O manifesto indica um download/atualização em andamento ou esperando? (a mesma regra de merge.ts) */
export function isInQueue(app: InstalledApp): boolean {
  const flags = app.stateFlags;
  const downloading = (flags & BUSY) !== 0 && app.bytesToDownload > 0 && app.bytesDownloaded < app.bytesToDownload;
  if (flags & FULLY_INSTALLED && !downloading) return false;
  return downloading || (flags & BUSY) !== 0;
}

/** Quanto o manifesto diz que já foi gravado (ele só atualiza de tempos em tempos). */
export function manifestDone(app: InstalledApp): number {
  const total = app.bytesToStage || app.bytesToDownload;
  if (!total) return 0;
  if (app.bytesToDownload > 0) return Math.min(total, Math.round((total * app.bytesDownloaded) / app.bytesToDownload));
  return Math.min(total, app.bytesStaged);
}

/**
 * Fila de downloads a partir dos manifestos. `liveDone` traz o quanto a medição em tempo real (contador de gravação
 * da Steam) já viu de cada item: vale no lugar do manifesto quando for maior.
 */
export function buildQueue(
  installed: InstalledApp[],
  titleOf: (appId: string, fallback: string) => string,
  liveDone: Record<string, number> = {},
  /** Item que se sabe estar baixando mesmo sem a marca no manifesto (a Steam demora a atualizá-lo). */
  forceActive?: string,
): QueueItem[] {
  const items: QueueItem[] = installed
    .filter(isInQueue)
    .map((app) => {
      const total = app.bytesToStage || app.bytesToDownload;
      const done = Math.min(total || Infinity, Math.max(manifestDone(app), liveDone[app.appId] ?? 0));
      return {
        appId: app.appId,
        title: titleOf(app.appId, app.name),
        isUpdate: (app.stateFlags & FULLY_INSTALLED) !== 0,
        state: (app.stateFlags & RUNNING) !== 0 || app.appId === forceActive ? "active" : "queued",
        total,
        done: Number.isFinite(done) ? done : 0,
        libraryPath: app.libraryPath,
        etaSec: null,
        finishAt: null,
      } satisfies QueueItem;
    });
  // O que está baixando vai primeiro; os outros ficam na ordem em que a Steam os listou.
  return [...items.filter((i) => i.state === "active"), ...items.filter((i) => i.state !== "active")];
}

/** Bytes que faltam para toda a fila (itens sem tamanho conhecido não entram na conta). */
export function remainingBytes(items: QueueItem[]): number {
  return items.reduce((sum, i) => sum + Math.max(0, i.total - i.done), 0);
}

/** Preenche o tempo e o horário previstos de cada item, em fila, com a velocidade medida (bytes/s). */
export function withEstimates(items: QueueItem[], speed: number, now: number): QueueItem[] {
  if (speed < MIN_SPEED) return items.map((i) => ({ ...i, etaSec: null, finishAt: null }));
  let elapsed = 0;
  return items.map((i) => {
    if (!i.total) return { ...i, etaSec: null, finishAt: null };
    elapsed += Math.max(0, i.total - i.done) / speed;
    return { ...i, etaSec: Math.round(elapsed), finishAt: now + elapsed * 1000 };
  });
}

/**
 * Mede a velocidade com um contador que só cresce (bytes gravados pela Steam): taxa média da janela de
 * `windowMs` mais recente, suavizada para o número não pular de um segundo para o outro.
 */
export class SpeedMeter {
  private samples: Array<{ t: number; bytes: number }> = [];
  private smooth = 0;
  constructor(private windowMs = 8000, private alpha = 0.35) {}

  push(bytes: number, now: number): number {
    const last = this.samples[this.samples.length - 1];
    // O contador voltou (a Steam reiniciou): recomeça a medição.
    if (last && bytes < last.bytes) this.reset();
    this.samples.push({ t: now, bytes });
    while (this.samples.length > 2 && now - this.samples[0].t > this.windowMs) this.samples.shift();
    const first = this.samples[0];
    const span = (now - first.t) / 1000;
    if (span < 1) return this.smooth;
    const raw = Math.max(0, (bytes - first.bytes) / span);
    this.smooth = this.smooth === 0 ? raw : this.smooth + this.alpha * (raw - this.smooth);
    return this.smooth;
  }

  /** Sem download em andamento: zera, para a próxima medição não herdar a velocidade antiga. */
  reset() {
    this.samples = [];
    this.smooth = 0;
  }

  get speed() {
    return this.smooth;
  }
}

// ───────── Textos ─────────

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** 1,5 GB, 320 MB... (base 1024, como o Windows mostra). */
export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  const text = value >= 100 || i === 0 ? Math.round(value).toString() : value.toFixed(value >= 10 ? 1 : 2);
  return `${text.replace(".", (1.1).toLocaleString(locale()).charAt(1))} ${UNITS[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec < MIN_SPEED / 10 ? "—" : `${formatBytes(bytesPerSec)}/s`;
}

/** "42 s", "18 min", "2 h 05 min". */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")} min`;
}

/** "21:47", ou "amanhã 01:10" quando passa da meia-noite. */
export function formatClock(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false });
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date(now).toDateString()).getTime()) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return t("amanhã {time}", { time });
  return `${d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" })} ${time}`;
}
