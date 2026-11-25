import { Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { musicDebug, startMenuMusic, useMusic } from "./audio/music";
import { startSoundEffects } from "./audio/sounds";
import { t, te, useLanguage } from "./i18n";
import { GuideApp } from "./guide/GuideApp";
import { PerfOverlayWindow } from "./components/PerfCard";
import { initInput } from "./input/actions";
import { useEpic } from "./store/epic";
import { startGamepad, xinputToPad, type XInputPad } from "./input/gamepad";
import { detectPadKind, usePadKind } from "./input/padKind";
import { steam } from "./lib/steam";
import { useHltb } from "./store/hltb";
import { useHome } from "./store/home";
import { useLibrary } from "./store/library";
import { useLibraryConfig } from "./store/libraryConfig";
import { startSystemSync } from "./store/system";
import { useUI } from "./store/ui";
import { startDownloadsMonitor, useDownloads } from "./store/downloads";
import { useUserData } from "./store/userData";
import { applyTheme, useTheme } from "./theme/themeStore";
import { startSettingsPublisher, startSettingsReceiver } from "./lib/settingsSync";
import "./styles/global.css";
import "./styles/perf.css";
import "./styles/setup.css";

// Só em desenvolvimento: expõe as stores no console para testar estados difíceis de reproduzir.
if (import.meta.env.DEV) Object.assign(window, { __launcher: { epic: useEpic, library: useLibrary, home: useHome, ui: useUI, userData: useUserData, steam, libraryConfig: useLibraryConfig, hltb: useHltb, language: useLanguage, i18n: { t, te }, theme: useTheme, music: useMusic, musicDebug, downloads: useDownloads } });

// A mesma página serve a duas janelas: o launcher e o menu do botão Guia (aberto com ?guide=1).
const isGuide = new URLSearchParams(location.search).has("guide");
// ...e o contador de desempenho (FPS) por cima dos jogos é uma terceira janela, aberta com ?perf=1.
const isPerf = new URLSearchParams(location.search).has("perf");

if (!isPerf) {
  initInput();
  startSystemSync();
}
/** Leitura do controle mais velha que isto não é usada (a normal chega a cada 16 ms). */
const PAD_STALE_MS = 150;
if (!isGuide && !isPerf) {
  startSoundEffects();
  startMenuMusic();
  // Mede os downloads e cuida do desligamento programado, mesmo com a página de downloads fechada.
  startDownloadsMonitor();
  let rustPad: ReturnType<typeof xinputToPad> | null = null;
  // Quando foi a última leitura do controle. Enquanto o Windows está ocupado (criando uma janela, por exemplo) a leitura
  // atrasa e o último estado continua "apertado": sem este cuidado o direcional se repetia sozinho e o A valia duas vezes.
  let rustPadAt = 0;
  // O bloqueio do launcher vale também para o fallback da Gamepad API.
  let launcherActive = !steam.available;
  startGamepad(() => (rustPad ? [rustPad] : navigator.getGamepads()), () => launcherActive && (!rustPad || performance.now() - rustPadAt < PAD_STALE_MS));
  // Ícones dos botões (Xbox ou PlayStation) seguem o controle que está em uso; o Guia recebe isso pelo Rust.
  const watchPadKind = () => {
    const kind = detectPadKind(navigator.getGamepads());
    if (kind) usePadKind.getState().setDetected(kind);
  };
  window.addEventListener("gamepadconnected", watchPadKind);
  setInterval(watchPadKind, 400);

  if (steam.available) {
    void import("@tauri-apps/api/event").then(({ listen }) => listen("guide-open-library", () => {
      const ui = useUI.getState();
      if (ui.screen.name !== "library") ui.navigate({ name: "library" });
    })).catch((error) => console.error("Falha ao ligar o atalho da biblioteca", error)); // i18n-ignore
    void import("@tauri-apps/api/event").then(({ listen }) => listen("guide-open-home", () => {
      const ui = useUI.getState();
      if (ui.screen.name !== "home") ui.navigate({ name: "home" });
    })).catch((error) => console.error("Falha ao ligar o atalho do início", error)); // i18n-ignore
    let reading = false;
    let focusVersion = 0;
    window.addEventListener("blur", () => {
      launcherActive = false;
      focusVersion++;
    });
    setInterval(() => {
      if (reading || !document.hasFocus()) return;
      reading = true;
      const requestedVersion = focusVersion;
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<{ pads: boolean; launcher: XInputPad; launcherActive: boolean }>("guide_poll"))
        .then((p) => {
          if (requestedVersion !== focusVersion) return;
          launcherActive = p.launcherActive;
          rustPad = p.pads ? xinputToPad(p.launcher) : null;
          rustPadAt = performance.now();
        })
        .catch(() => {
          launcherActive = false;
          rustPad = null;
        })
        .finally(() => {
          reading = false;
        });
    }, 16);
  }
}

applyTheme(useTheme.getState());
useTheme.subscribe((s) => applyTheme(s));
// O Guia tem a própria pasta de dados: o tema e o idioma chegam a ele pelo Rust.
if (isGuide || isPerf) startSettingsReceiver();
else startSettingsPublisher();
if (isGuide) document.documentElement.classList.add("guide-window");

/** O menu do Guia é outra janela: quando o idioma muda, ele se refaz inteiro para não ficar com texto no idioma antigo. */
function GuideRoot() {
  const lang = useLanguage((s) => s.lang);
  return (
    <Fragment key={lang}>
      <GuideApp />
    </Fragment>
  );
}

/** A janela do contador também se refaz inteira quando o idioma muda. */
function PerfRoot() {
  const lang = useLanguage((s) => s.lang);
  return (
    <Fragment key={lang}>
      <PerfOverlayWindow />
    </Fragment>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isPerf ? <PerfRoot /> : isGuide ? <GuideRoot /> : <App />}</StrictMode>,
);
