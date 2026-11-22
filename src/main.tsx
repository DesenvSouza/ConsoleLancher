import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { GuideApp } from "./guide/GuideApp";
import { initInput } from "./input/actions";
import { startGamepad, xinputToPad, type XInputPad } from "./input/gamepad";
import { steam } from "./lib/steam";
import { useHome } from "./store/home";
import { useLibrary } from "./store/library";
import { useLibraryConfig } from "./store/libraryConfig";
import { useUI } from "./store/ui";
import { useUserData } from "./store/userData";
import { applyTheme, useTheme } from "./theme/themeStore";
import "./styles/global.css";

// Só em desenvolvimento: expõe as stores no console para testar estados difíceis de reproduzir.
if (import.meta.env.DEV) Object.assign(window, { __launcher: { library: useLibrary, home: useHome, ui: useUI, userData: useUserData, steam, libraryConfig: useLibraryConfig } });

// A mesma página serve a duas janelas: o launcher e o menu do botão Guia (aberto com ?guide=1).
const isGuide = new URLSearchParams(location.search).has("guide");

initInput();
// O launcher lê o controle pelo app (XInput, no Rust), que já entrega o estado zerado enquanto o menu do Guia está
// aberto e um instante depois: por isso o launcher não reage ao que se aperta no menu. Sem controle XInput (ou no
// navegador), cai na Gamepad API.
let rustPad: ReturnType<typeof xinputToPad> | null = null;
if (!isGuide) {
  startGamepad(() => (rustPad ? [rustPad] : navigator.getGamepads()));
  if (steam.available) {
    setInterval(() => {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<{ pads: boolean; launcher: XInputPad }>("guide_poll"))
        .then((p) => {
          rustPad = p.pads ? xinputToPad(p.launcher) : null;
        })
        .catch(() => {
          rustPad = null;
        });
    }, 16);
  }
}

applyTheme(useTheme.getState());
useTheme.subscribe((s) => applyTheme(s));
if (isGuide) document.documentElement.classList.add("guide-window");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isGuide ? <GuideApp /> : <App />}</StrictMode>,
);
