import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api, isTauri } from "../lib/api";
import back from "./effects/back.wav?url";
import launch from "./effects/launch.wav?url";
import move from "./effects/move.wav?url";
import open from "./effects/open.wav?url";
import operation from "./effects/operation.wav?url";
import select from "./effects/select.wav?url";
import success from "./effects/success.wav?url";
import warning from "./effects/warning.wav?url";

const effects = { back, launch, move, open, operation, select, success, warning };
type Cue = keyof typeof effects;

interface SoundSettings {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useSoundSettings = create<SoundSettings>()(
  persist(
    (set) => ({ enabled: true, setEnabled: (enabled) => set({ enabled }) }),
    { name: "launcher-sound-effects" },
  ),
);

let browserAudio: HTMLAudioElement | undefined;
let pending: Cue | undefined;

/** Só a janela principal restaura a preferência. O processo nativo aplica o mesmo valor ao Guia. */
export function startSoundEffects() {
  const apply = (enabled: boolean) => {
    if (isTauri) {
      void api.setSoundEffects(enabled).catch((error) => console.error("Falha ao configurar o áudio", error)); // i18n-ignore
    } else if (!enabled) {
      browserAudio?.pause();
    }
  };
  apply(useSoundSettings.getState().enabled);
  useSoundSettings.subscribe((state, previous) => {
    if (state.enabled !== previous.enabled) apply(state.enabled);
  });
}

/** Uma ação pode emitir um som de seleção e em seguida substituí-lo pelo som da operação. */
export function playSound(cue: Cue) {
  if (pending) {
    if (cue !== "move") pending = cue;
    return;
  }
  pending = cue;
  queueMicrotask(() => {
    const next = pending!;
    pending = undefined;
    if (isTauri) {
      void api.playSoundEffect(next).catch((error) => console.error("Falha ao reproduzir o áudio", error)); // i18n-ignore
      return;
    }
    if (!useSoundSettings.getState().enabled || (next === "move" && browserAudio && !browserAudio.paused)) return;

    browserAudio?.pause();
    browserAudio = new Audio(effects[next]);
    // A versão no navegador pode exigir a primeira interação para liberar o áudio.
    void browserAudio.play().catch(() => {});
  });
}
