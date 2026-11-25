import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTauri } from "../lib/api";
import { useIntro } from "../store/intro";
import { useLibrary } from "../store/library";
import chegada from "./music/luz-de-chegada.ogg?url";
import neon from "./music/pulso-de-neon.ogg?url";
import chuva from "./music/janela-de-chuva.ogg?url";
import ceu from "./music/ceu-frio.ogg?url";
import encontro from "./music/ponto-de-encontro.ogg?url";
import canal from "./music/canal-16.ogg?url";
import mare from "./music/mare-de-vidro.ogg?url";
import tarde from "./music/fim-de-tarde.ogg?url";
import cartografia from "./music/cartografia-noturna.ogg?url";
import suspensao from "./music/tela-em-suspensao.ogg?url";

/** As faixas de fundo (feitas para repetir sem emenda). Os nomes são nomes próprios: não são traduzidos. */
export const TRACKS = [
  { id: "luz-de-chegada", name: "Luz de Chegada", url: chegada }, // i18n-ignore
  { id: "pulso-de-neon", name: "Pulso de Neon", url: neon }, // i18n-ignore
  { id: "janela-de-chuva", name: "Janela de Chuva", url: chuva }, // i18n-ignore
  { id: "ceu-frio", name: "Céu Frio", url: ceu }, // i18n-ignore
  { id: "ponto-de-encontro", name: "Ponto de Encontro", url: encontro }, // i18n-ignore
  { id: "canal-16", name: "Canal 16", url: canal }, // i18n-ignore
  { id: "mare-de-vidro", name: "Maré de Vidro", url: mare }, // i18n-ignore
  { id: "fim-de-tarde", name: "Fim de Tarde", url: tarde }, // i18n-ignore
  { id: "cartografia-noturna", name: "Cartografia Noturna", url: cartografia }, // i18n-ignore
  { id: "tela-em-suspensao", name: "Tela em Suspensão", url: suspensao }, // i18n-ignore
] as const;

export type TrackId = (typeof TRACKS)[number]["id"];
/** "off" = sem música; "all" = todas, em sequência embaralhada; ou uma faixa só, repetindo. */
export type MusicChoice = "off" | "all" | TrackId;

export const MUSIC_CHOICES: MusicChoice[] = ["off", "all", ...TRACKS.map((t) => t.id)];

/** Como o launcher vem de fábrica (o assistente de configuração já começa assim): uma faixa calma, baixinha. */
export const DEFAULT_MUSIC: { choice: MusicChoice; volume: number } = { choice: "tela-em-suspensao", volume: 10 }; // i18n-ignore

interface MusicSettings {
  choice: MusicChoice;
  /** 0 a 100. */
  volume: number;
  setChoice: (choice: MusicChoice) => void;
  setVolume: (volume: number) => void;
}

export const useMusic = create<MusicSettings>()(
  persist(
    (set) => ({
      ...DEFAULT_MUSIC,
      setChoice: (choice) => set({ choice }),
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(100, Math.round(volume / 10) * 10)) }),
    }),
    {
      name: "launcher-music",
      version: 1,
      // Quem tinha escolhido uma faixa que não existe mais passa para a de fábrica (o volume e o "desligada" ficam).
      migrate: (stored) => {
        const saved = (stored ?? {}) as { choice?: MusicChoice; volume?: number };
        return {
          choice: saved.choice && MUSIC_CHOICES.includes(saved.choice) ? saved.choice : DEFAULT_MUSIC.choice,
          volume: typeof saved.volume === "number" ? saved.volume : DEFAULT_MUSIC.volume,
        } as MusicSettings;
      },
    },
  ),
);

// ───────── Reprodução ─────────
//
// A música usa o Web Audio (a faixa é decodificada uma vez e repetida pelo próprio motor de áudio), e não um <audio loop>:
// o <audio> faz uma pequena parada ao voltar ao início, e aqui a repetição é contínua, amostra por amostra. No modo "todas",
// a faixa seguinte é agendada para começar exatamente quando a atual termina.

const FADE_SECONDS = 0.7;
/** Depois que o menu Guia fecha, o launcher leva um instante para recuperar o foco: não vale pausar nesse intervalo. */
const GUIDE_GRACE_MS = 3500;

type Mode = "single" | "all";
interface Playing {
  track: TrackId;
  source: AudioBufferSourceNode;
  /** Instante (relógio do áudio) em que a faixa começou e em que termina (só no modo "todas"). */
  endsAt: number;
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
const decoded = new Map<TrackId, Promise<AudioBuffer>>();
let current: Playing | null = null;
let queued: Playing | null = null;
/** O que o jogador pediu para tocar (muda na hora; `current` só existe depois de decodificar a faixa). */
let target: { track: TrackId; mode: Mode } | null = null;
let generation = 0;
let suspendTimer: ReturnType<typeof setTimeout> | undefined;
let playlist: TrackId[] = [];

let windowActive = true;
let guideOpen = false;
let guideClosedAt = 0;

function audio(): { ctx: AudioContext; gain: GainNode } {
  if (!context || !master) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
  }
  return { ctx: context, gain: master };
}

function decode(track: TrackId): Promise<AudioBuffer> {
  let found = decoded.get(track);
  if (!found) {
    const { ctx } = audio();
    found = fetch(TRACKS.find((t) => t.id === track)!.url)
      .then((response) => response.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data));
    decoded.set(track, found);
    // Guarda só as faixas em uso (cada uma decodificada ocupa dezenas de MB).
    for (const id of [...decoded.keys()]) if (id !== track && id !== current?.track && id !== queued?.track && decoded.size > 2) decoded.delete(id);
    found.catch(() => decoded.delete(track));
  }
  return found;
}

function shuffled(except?: TrackId): TrackId[] {
  const ids = TRACKS.map((t) => t.id).filter((id) => id !== except) as TrackId[];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/** A próxima faixa do modo "todas": nunca repete a que acabou de tocar. */
function nextTrack(after: TrackId): TrackId {
  if (playlist.length === 0) playlist = shuffled(after);
  return playlist.shift()!;
}

/** Há um jogo aberto (ou abrindo): o launcher não está "livre" e a música não toca. */
function gameBusy(): boolean {
  const { runningAppId, launching } = useLibrary.getState();
  return runningAppId !== null || Object.keys(launching).length > 0;
}

/** O launcher está à frente: com o foco, ou com o menu Guia (que é dele) aberto — ou recém-fechado. */
function launcherFront(): boolean {
  return windowActive || guideOpen || Date.now() - guideClosedAt < GUIDE_GRACE_MS;
}

function shouldPlay(): boolean {
  return useMusic.getState().choice !== "off" && launcherFront() && !gameBusy() && !useIntro.getState().playing;
}

function stopSources() {
  generation += 1;
  for (const item of [current, queued]) {
    if (!item) continue;
    item.source.onended = null;
    try {
      item.source.stop();
    } catch {
      // já parada
    }
    item.source.disconnect();
  }
  current = null;
  queued = null;
}

function startSource(ctx: AudioContext, gain: GainNode, track: TrackId, buffer: AudioBuffer, loop: boolean, when: number): Playing {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  source.connect(gain);
  source.start(Math.max(when, 0));
  return { track, source, endsAt: Math.max(when, ctx.currentTime) + buffer.duration };
}

/** No modo "todas": agenda a faixa seguinte para o instante exato em que a atual termina. */
async function scheduleNext(token: number) {
  if (!current || queued) return;
  const after = current;
  const next = nextTrack(after.track);
  const buffer = await decode(next);
  if (token !== generation || current !== after || queued) return;
  const { ctx, gain } = audio();
  queued = startSource(ctx, gain, next, buffer, false, after.endsAt);
  after.source.onended = () => {
    if (token !== generation || !queued) return;
    current = queued;
    queued = null;
    void scheduleNext(token);
  };
}

async function begin(track: TrackId, mode: Mode) {
  stopSources();
  const token = generation;
  target = { track, mode };
  const buffer = await decode(track);
  if (token !== generation) return;
  const { ctx, gain } = audio();
  current = startSource(ctx, gain, track, buffer, mode === "single", ctx.currentTime);
  if (mode === "all") void scheduleNext(token);
}

function rampTo(value: number, seconds = FADE_SECONDS) {
  const { ctx, gain } = audio();
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(value, now + seconds);
}

/** Põe o som de acordo com o estado atual: toca (com entrada suave) ou pausa (com saída suave). */
function apply() {
  const { choice, volume } = useMusic.getState();
  if (!shouldPlay()) {
    if (context && context.state === "running") {
      rampTo(0);
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(() => {
        if (!shouldPlay()) void context?.suspend();
      }, FADE_SECONDS * 1000 + 100);
    }
    return;
  }

  clearTimeout(suspendTimer);
  if (choice === "all") {
    if (target?.mode !== "all") void begin(nextTrack(target?.track ?? TRACKS[0].id), "all");
  } else if (target?.mode !== "single" || target.track !== choice) {
    void begin(choice as TrackId, "single");
  }

  const { ctx } = audio();
  void ctx.resume().then(() => rampTo(volume / 100)).catch(() => {
    // O navegador ainda não liberou o áudio (precisa de uma primeira interação): tenta de novo na próxima.
  });
}

/**
 * Música de fundo do launcher: toca com a janela em primeiro plano (ou com o menu Guia aberto) e sem jogo aberto, e pausa
 * (com saída suave) quando um jogo abre ou o launcher perde o foco. Só a janela principal chama isto.
 */
export function startMenuMusic() {
  windowActive = document.visibilityState === "visible" && document.hasFocus();
  const refresh = () => {
    windowActive = document.visibilityState === "visible" && document.hasFocus();
    apply();
  };
  window.addEventListener("focus", refresh);
  window.addEventListener("blur", refresh);
  document.addEventListener("visibilitychange", refresh);
  // O navegador só libera o áudio depois da primeira interação: qualquer uma tenta de novo.
  for (const event of ["keydown", "pointerdown", "gamepadconnected"]) window.addEventListener(event, () => { if (context?.state === "suspended" && shouldPlay()) apply(); }, { passive: true });

  // O menu Guia é outra janela: abri-lo tira o foco do launcher, mas a música continua (se não há jogo).
  if (isTauri) {
    void import("@tauri-apps/api/event").then(({ listen }) => listen<boolean>("guide-visibility", (event) => {
      guideOpen = event.payload;
      if (!guideOpen) {
        guideClosedAt = Date.now();
        setTimeout(apply, GUIDE_GRACE_MS + 50);
      }
      apply();
    }));
  }

  useMusic.subscribe((state, previous) => {
    if (state.choice !== previous.choice) playlist = [];
    apply();
  });
  useLibrary.subscribe((state, previous) => {
    if (state.runningAppId !== previous.runningAppId || state.launching !== previous.launching) apply();
  });
  // A música começa quando a abertura em vídeo termina.
  useIntro.subscribe(() => apply());
  apply();
}

/** Só para testes em desenvolvimento. */
export const musicDebug = {
  state: () => ({
    context: context?.state,
    gain: master ? Math.round(master.gain.value * 100) / 100 : null,
    current: current && { track: current.track, loop: current.source.loop, endsAt: current.endsAt },
    queued: queued?.track,
    target,
    now: context?.currentTime,
  }),
  guide: (open: boolean) => {
    guideOpen = open;
    if (!open) guideClosedAt = Date.now();
    apply();
  },
  blur: (active: boolean) => {
    windowActive = active;
    apply();
  },
};
