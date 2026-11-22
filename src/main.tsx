import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initInput } from "./input/actions";
import { startGamepad } from "./input/gamepad";
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

initInput();
startGamepad();

applyTheme(useTheme.getState());
useTheme.subscribe((s) => applyTheme(s));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
