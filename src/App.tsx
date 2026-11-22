import { useEffect } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContextMenu } from "./components/ContextMenu";
import { useSteamSync } from "./hooks/useSteamSync";
import { onAction } from "./input/actions";
import { GameDetail } from "./screens/GameDetail";
import { Home } from "./screens/Home";
import { Library } from "./screens/Library";
import { LibrarySettings } from "./screens/LibrarySettings";
import { LibraryTabEdit } from "./screens/LibraryTabEdit";
import { HomeBlockEdit } from "./screens/HomeBlockEdit";
import { HomeLayout } from "./screens/HomeLayout";
import { Account } from "./screens/Account";
import { GamepadTest } from "./screens/GamepadTest";
import { Settings } from "./screens/Settings";
import { useLibrary } from "./store/library";
import { useLibraryView } from "./store/libraryView";
import { useUI } from "./store/ui";

export default function App() {
  useSteamSync();
  const toast = useUI((s) => s.toast);
  const screen = useUI((s) => s.screen);
  const contextGameId = useUI((s) => s.contextGameId);
  const confirmUninstallId = useUI((s) => s.confirmUninstallId);
  const uninstallGame = useLibrary((s) => s.games.find((g) => g.id === confirmUninstallId));

  // Botões globais. Menus e diálogos tratam o próprio B/Start e marcam modalOpen.
  useEffect(
    () =>
      onAction((a) => {
        const ui = useUI.getState();
        if (ui.modalOpen) return;
        const name = ui.screen.name;

        if (a === "back") {
          // Na Biblioteca com uma busca ativa, o B limpa a busca (rápido); com a busca limpa, volta ao Início.
          const view = useLibraryView.getState();
          if (name === "library" && view.query.trim()) view.set({ query: "" });
          else ui.back();
        }
        // X na Home: biblioteca completa (dentro dela, o X é a busca).
        else if (a === "x" && name === "home") ui.navigate({ name: "library" });
        // Select: configurações (a partir da Home, da Biblioteca ou da tela de um jogo).
        else if (a === "select" && (name === "home" || name === "library" || name === "detail")) ui.navigate({ name: "settings" });
        // Select de novo, com o menu de configurações aberto: fecha e volta de onde veio.
        else if (a === "select" && name === "settings") ui.back();
        // Start: opções rápidas do jogo em foco, só na Home e na Biblioteca (na tela do jogo o Start não faz nada).
        else if (a === "start" && (name === "home" || name === "library")) {
          const id = ui.focusedGameId;
          if (id) ui.openContext(id);
        }
      }),
    [],
  );

  const view = (() => {
    switch (screen.name) {
      case "detail":
        return <GameDetail gameId={screen.gameId} />;
      case "library":
        return <Library />;
      case "library-settings":
        return <LibrarySettings />;
      case "library-tab":
        return <LibraryTabEdit tabId={screen.tabId} />;
      case "settings":
        return <Settings />;
      case "account":
        return <Account />;
      case "gamepad-test":
        return <GamepadTest />;
      case "home-layout":
        return <HomeLayout />;
      case "home-block":
        return <HomeBlockEdit blockId={screen.blockId} />;
      default:
        return <Home />;
    }
  })();

  return (
    <>
      {view}
      {contextGameId && <ContextMenu gameId={contextGameId} />}
      {toast && <div className="toast" key={toast.id}>{toast.text}</div>}
      {uninstallGame && (
        <ConfirmDialog
          title={`Desinstalar ${uninstallGame.title}?`}
          message={`Isso libera cerca de ${uninstallGame.sizeGB} GB. Seus saves na nuvem continuam salvos e você pode instalar de novo quando quiser.`}
          confirmLabel="Desinstalar"
          danger
          onCancel={() => useUI.getState().clearUninstall()}
          onConfirm={() => {
            useLibrary.getState().uninstall(uninstallGame.id);
            useUI.getState().clearUninstall();
          }}
        />
      )}
    </>
  );
}
