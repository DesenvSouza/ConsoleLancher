import { Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { musicDebug, startMenuMusic, useMusic } from "./audio/music";
import { startSoundEffects } from "./audio/sounds";
import { t, te, useLanguage } from "./i18n";
import { GuideApp } from "./guide/GuideApp";
import { PerfOverlayWindow } from "./components/PerfCard";
import { Intro } from "./components/Intro";
import { initInput } from "./input/actions";
import { useEpic } from "./store/epic";
import { startGamepad, xinputToPad, type XInputPad } from "./input/gamepad";
import { detectPadKind, usePadKind } from "./input/padKind";
import { steam } from "./lib/steam";
import { withTimeout } from "./lib/timeout";
import { useHltb } from "./store/hltb";
import { useHome } from "./store/home";
import { useIntro } from "./store/intro";
import { useLibrary } from "./store/library";
import { useLibraryConfig } from "./store/libraryConfig";
import { startSystemSync } from "./store/system";
import { useUI } from "./store/ui";
import { startDownloadsMonitor, useDownloads } from "./store/downloads";
import { useUpdate } from "./store/update";
import { useUserData } from "./store/userData";
import { applyTheme, useTheme } from "./theme/themeStore";
import { startSettingsPublisher, startSettingsReceiver } from "./lib/settingsSync";
import "./styles/global.css";
import "./styles/perf.css";
import "./styles/setup.css";

// Só em desenvolvimento: expõe as stores no console para testar estados difíceis de reproduzir.
if (import.meta.env.DEV) Object.assign(window, { __launcher: { epic: useEpic, library: useLibrary, home: useHome, ui: useUI, userData: useUserData, steam, libraryConfig: useLibraryConfig, hltb: useHltb, language: useLanguage, i18n: { t, te }, theme: useTheme, music: useMusic, musicDebug, downloads: useDownloads, update: useUpdate } });

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
  // A abertura em vídeo aparece primeiro; a música de fundo espera por ela.
  useIntro.setState({ playing: true });
  startMenuMusic();
  // Mede os downloads e cuida do desligamento programado, mesmo com a página de downloads fechada.
  startDownloadsMonitor();
  let rustPad: ReturnType<typeof xinputToPad> | null = null;
  // Quando foi a última leitura do controle. Enquanto o Windows está ocupado (criando uma janela, por exemplo) a leitura
  // atrasa e o último estado continua "apertado": sem este cuidado o direcional se repetia sozinho e o A valia duas vezes.
  let rustPadAt = 0;
  // O bloqueio do launcher vale também para o fallback da Gamepad API.
  let launcherActive = !steam.available;
  // No app, a leitura do controle vem do Rust junto com "o launcher está à frente" (a janela em primeiro plano no Windows). O
  // foco da página não conta: no modo console ela podia abrir sem ele, e o controle não movia nada.
  startGamepad(() => (rustPad ? [rustPad] : navigator.getGamepads()), () => launcherActive && (!rustPad || performance.now() - rustPadAt < PAD_STALE_MS), () => steam.available || document.hasFocus());
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
    void import("@tauri-apps/api/event").then(({ listen }) => listen("guide-open-perf", () => {
      const ui = useUI.getState();
      if (ui.screen.name !== "perf-settings") ui.navigate({ name: "perf-settings" });
    })).catch((error) => console.error("Falha ao ligar o atalho do contador", error)); // i18n-ignore
    // O jogo não terminou de fechar (ficou rodando sem janela).
    void import("@tauri-apps/api/event").then(({ listen }) => listen<string>("game-close-stuck", (event) => {
      useUI.getState().askForceClose(event.payload);
    })).catch((error) => console.error("Falha ao ligar o aviso de jogo travado", error)); // i18n-ignore
    let reading = false;
    let focusVersion = 0;
    window.addEventListener("blur", () => {
      launcherActive = false;
      focusVersion++;
    });
    let skipped = 0;
    let focusAskedAt = 0;
    setInterval(() => {
      // Sem o foco da página (um jogo na frente, em geral) basta conferir quatro vezes por segundo.
      if (reading || (!document.hasFocus() && !launcherActive && ++skipped % 16 !== 0)) return;
      reading = true;
      const requestedVersion = focusVersion;
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => withTimeout(invoke<{ pads: boolean; launcher: XInputPad; launcherActive: boolean }>("guide_poll"), 1000))
        .then((p) => {
          if (requestedVersion !== focusVersion) return;
          launcherActive = p.launcherActive;
          // À frente, mas a página sem o foco (teclado, música e cliques dependem dele): pede de volta.
          if (p.launcherActive && !document.hasFocus() && performance.now() - focusAskedAt > 1000) {
            focusAskedAt = performance.now();
            void import("@tauri-apps/api/core").then(({ invoke }) => invoke("focus_launcher_view")).catch(() => {});
          }
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
  <StrictMode>{isPerf ? <PerfRoot /> : isGuide ? <GuideRoot /> : <><App /><Intro /></>}</StrictMode>,
);
