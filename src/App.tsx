import { getCurrentFocusKey } from "@noriginmedia/norigin-spatial-navigation";
import { Fragment, useEffect } from "react";
import { playSound } from "./audio/sounds";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContextMenu } from "./components/ContextMenu";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LaunchWatcher } from "./components/LaunchOverlay";
import { LegendaryDialog } from "./components/LegendaryDialog";
import { RestartCountdown } from "./components/RestartCountdown";
import { ShutdownCountdown } from "./components/ShutdownCountdown";
import { UpdateDialog } from "./components/UpdateDialog";
import { t, te, useLanguage } from "./i18n";
import { formatSize } from "./components/Chrome";
import { useSteamSync } from "./hooks/useSteamSync";
import { useSharedFavorites } from "./hooks/useUniqueGames";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { onAction } from "./input/actions";
import { api } from "./lib/api";
import { GameDetail } from "./screens/GameDetail";
import { Home } from "./screens/Home";
import { Library } from "./screens/Library";
import { LibrarySettings } from "./screens/LibrarySettings";
import { LibraryTabEdit } from "./screens/LibraryTabEdit";
import { NotInstalledSettings } from "./screens/NotInstalledSettings";
import { HomeBlockEdit } from "./screens/HomeBlockEdit";
import { HomeLayout } from "./screens/HomeLayout";
import { SteamAccount } from "./screens/SteamAccount";
import { EpicAccount } from "./screens/EpicAccount";
import { PerfSettings } from "./screens/PerfSettings";
import { Downloads, openDownloadsQueue } from "./screens/Downloads";
import { GamepadTest } from "./screens/GamepadTest";
import { GuidePowerSettings } from "./screens/GuidePowerSettings";
import { StartupSettings } from "./screens/StartupSettings";
import { Settings, openSettingsAt } from "./screens/Settings";
import { SetupWizard } from "./screens/SetupWizard";
import { SystemPanels } from "./components/System";
import { useEpic } from "./store/epic";
import { useSystem } from "./store/system";
import { useLibrary } from "./store/library";
import { useLibraryView } from "./store/libraryView";
import { useUpdate } from "./store/update";
import { useUI } from "./store/ui";

export default function App() {
  useSteamSync();
  useSharedFavorites();
  useUpdateCheck();
  const updateOpen = useUpdate((s) => s.dialog && !!s.available);
  const lang = useLanguage((s) => s.lang);
  const toast = useUI((s) => s.toast);
  const screen = useUI((s) => s.screen);
  const contextGameId = useUI((s) => s.contextGameId);
  const systemPanelOpen = useSystem((s) => s.panelOpen);
  const legendaryPrompt = useEpic((s) => s.legendaryPrompt);
  const confirmUninstallId = useUI((s) => s.confirmUninstallId);
  const confirmCloseGameId = useUI((s) => s.confirmCloseGameId);
  const confirmCancelInstallId = useUI((s) => s.confirmCancelInstallId);
  const contextGame = useLibrary((s) => s.games.find((g) => g.id === contextGameId));
  const uninstallGame = useLibrary((s) => s.games.find((g) =>
    g.id === confirmUninstallId && g.state === "installed" && !s.pendingUninstall[g.id]
      && !s.launching[g.id] && g.appId !== s.runningAppId,
  ));
  // Só instalações novas: cancelar uma atualização de jogo instalado apagaria o jogo (a Steam trata "cancelar" como remover).
  const cancelInstallGame = useLibrary((s) => s.games.find((g) => g.id === confirmCancelInstallId && g.state === "installing" && !g.update));
  const closeGame = useLibrary((s) => s.games.find((g) =>
    g.id === confirmCloseGameId && g.appId === s.runningAppId,
  ));

  useEffect(() => {
    const ui = useUI.getState();
    if (contextGameId && !contextGame && ui.contextGameId === contextGameId) ui.closeContext();
    if (confirmUninstallId && !uninstallGame && ui.confirmUninstallId === confirmUninstallId) ui.clearUninstall();
    if (confirmCloseGameId && !closeGame && ui.confirmCloseGameId === confirmCloseGameId) ui.clearCloseGame();
    if (confirmCancelInstallId && !cancelInstallGame && ui.confirmCancelInstallId === confirmCancelInstallId) ui.clearCancelInstall();
  }, [contextGameId, contextGame, confirmUninstallId, uninstallGame, confirmCloseGameId, closeGame, confirmCancelInstallId, cancelInstallGame]);

  // Botões globais. Menus e diálogos tratam o próprio B/Start e marcam modalOpen.
  useEffect(
    () =>
      onAction((a) => {
        const ui = useUI.getState();
        if (ui.modalOpen) return;
        const name = ui.screen.name;
        // O assistente de configuração trata os próprios botões (B volta uma etapa, não sai da tela).
        if (name === "setup") return;

        if (a === "back") {
          // Na Biblioteca com uma busca ativa, o B limpa a busca (rápido); com a busca limpa, volta ao Início.
          const view = useLibraryView.getState();
          if (name === "library" && view.query.trim()) {
            playSound("back");
            view.clearQuery();
          }
          else ui.back();
        }
        // X na Home: biblioteca completa (dentro dela, o X é a busca).
        else if (a === "x" && name === "home") {
          playSound("open");
          ui.navigate({ name: "library" });
        }
        // Y na Home: downloads e jogos instalados (dentro dessa tela, o Y troca a ordem).
        else if (a === "y" && name === "home") {
          playSound("open");
          openDownloadsQueue();
          ui.navigate({ name: "downloads" });
        }
        // Select: configurações (a partir da Home, da Biblioteca ou da tela de um jogo).
        else if (a === "select" && (name === "home" || name === "library" || name === "detail")) {
          playSound("open");
          // Da Biblioteca, o Select abre as Configurações já na linha das configurações da própria Biblioteca.
          if (name === "library") openSettingsAt("games", "set-library");
          ui.navigate({ name: "settings" });
        }
        // Select de novo, com o menu de configurações aberto: fecha e volta de onde veio.
        else if (a === "select" && name === "settings") ui.back();
        // Start: opções rápidas do jogo em foco, só na Home e na Biblioteca (na tela do jogo o Start não faz nada).
        else if (a === "start" && (name === "home" || name === "library")) {
          // O jogo "em foco" é o último cartão que recebeu o foco: se o foco saiu dos cartões (barra, cabeçalho), o Start não
          // abre as opções de um jogo que a pessoa nem está vendo selecionado.
          const key = getCurrentFocusKey() ?? "";
          const id = ui.focusedGameId;
          if (id && (key.startsWith("card-") || key.startsWith("lib-"))) ui.openContext(id);
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
      case "not-installed":
        return <NotInstalledSettings />;
      case "library-tab":
        return <LibraryTabEdit tabId={screen.tabId} />;
      case "settings":
        return <Settings />;
      case "steam-account":
        return <SteamAccount />;
      case "epic-account":
        return <EpicAccount />;
      case "perf-settings":
        return <PerfSettings />;
      case "gamepad-test":
        return <GamepadTest />;
      case "guide-power":
        return <GuidePowerSettings />;
      case "startup":
        return <StartupSettings />;
      case "downloads":
        return <Downloads />;
      case "home-layout":
        return <HomeLayout />;
      case "home-block":
        return <HomeBlockEdit blockId={screen.blockId} />;
      case "setup":
        return <SetupWizard />;
      default:
        return <Home />;
    }
  })();

  return (
    // Trocar o idioma refaz toda a interface (a chave muda), então nenhum texto fica no idioma antigo.
    <Fragment key={lang}>
      {/* A chave recria a proteção a cada tela: depois de um erro, navegar volta ao normal. */}
      <ErrorBoundary key={`${screen.name}:${"gameId" in screen ? screen.gameId : ""}`}>{view}</ErrorBoundary>
      <ShutdownCountdown />
      <RestartCountdown />
      <LaunchWatcher />
      {contextGame && <ContextMenu game={contextGame} />}
      {systemPanelOpen && <SystemPanels />}
      {legendaryPrompt && <LegendaryDialog />}
      {updateOpen && <UpdateDialog />}
      {toast && <div className="toast" role="status" key={toast.id}>{toast.text}</div>}
      {closeGame && (
        <ConfirmDialog
          title={t("Fechar {title}?", { title: closeGame.title })}
          message={t("Salve o progresso antes de fechar o jogo.")}
          confirmLabel={t("Fechar o jogo")}
          danger
          onCancel={() => {
            playSound("back");
            useUI.getState().clearCloseGame();
          }}
          onConfirm={() => {
            const ui = useUI.getState();
            if (ui.confirmCloseGameId !== closeGame.id) return;
            ui.clearCloseGame();
            void api.closeGame(closeGame).catch((error) => ui.showToast(te(error), "warning"));
          }}
        />
      )}
      {cancelInstallGame && (
        <ConfirmDialog
          title={t("Cancelar o download de {title}?", { title: cancelInstallGame.title })}
          message={t("O que já foi baixado deste jogo será apagado.")}
          confirmLabel={t("Cancelar o download")}
          cancelLabel={t("Continuar baixando")}
          danger
          onCancel={() => {
            playSound("back");
            useUI.getState().clearCancelInstall();
          }}
          onConfirm={() => {
            const ui = useUI.getState();
            if (ui.confirmCancelInstallId !== cancelInstallGame.id) return;
            ui.clearCancelInstall();
            useLibrary.getState().cancelInstall(cancelInstallGame.id);
          }}
        />
      )}
      {uninstallGame && (
        <ConfirmDialog
          title={t("Desinstalar {title}?", { title: uninstallGame.title })}
          message={uninstallGame.sizeGB > 0
            ? t("Os arquivos locais do jogo serão removidos. Isso libera cerca de {size} no disco.", { size: formatSize(uninstallGame.sizeGB) })
            : t("Os arquivos locais do jogo serão removidos.")}
          confirmLabel={t("Desinstalar")}
          danger
          onCancel={() => {
            playSound("back");
            useUI.getState().clearUninstall();
          }}
          onConfirm={() => {
            const ui = useUI.getState();
            if (ui.confirmUninstallId !== uninstallGame.id) return;
            ui.clearUninstall();
            void useLibrary.getState().uninstall(uninstallGame.id);
          }}
        />
      )}
    </Fragment>
  );
}
