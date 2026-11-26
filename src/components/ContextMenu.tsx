import { useEffect } from "react";
import { playSound } from "../audio/sounds";
import { useGameControllerSupport } from "../hooks/useGameControllerSupport";
import { useModal } from "../hooks/useModal";
import { t } from "../i18n";
import { onAction } from "../input/actions";
import { api } from "../lib/api";
import { askCloseGame, resumeGame } from "../lib/closeGame";
import { hasControllerSupport } from "../lib/controllerSupport";
import type { Game } from "../lib/types";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { useUserData } from "../store/userData";
import { Hints } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";

interface Item {
  id: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

/**
 * Menu de opções do jogo (botão Start). Mostra só o que faz sentido para o estado do jogo:
 * instalado, não instalado ou baixando. Start ou B fecham.
 */
export function ContextMenu({ game }: { game: Game }) {
  const uninstalling = useLibrary((s) => !!s.pendingUninstall[game.id]);
  const launching = useLibrary((s) => !!s.launching[game.id]);
  const running = useLibrary((s) => s.runningAppId !== null && s.runningAppId === game.appId);
  const { support, override } = useGameControllerSupport(game);

  useModal("ctx");
  useEffect(() => onAction((a) => {
    if (a !== "back" && a !== "start") return;
    playSound("back");
    useUI.getState().closeContext();
  }), []);

  const { play, install, toggleFavorite } = useLibrary.getState();
  const ui = useUI.getState();
  const availableState = uninstalling ? undefined : game.state;

  const items: Item[] = [];
  if (running) {
    items.push({ id: "resume", label: t("Voltar ao jogo"), run: () => void resumeGame(game) });
    items.push({ id: "close-game", label: t("Fechar o jogo"), danger: true, run: () => void askCloseGame(game) });
  }
  else if (availableState === "installed" && !launching) items.push({ id: "play", label: t("Jogar"), run: () => play(game.id) });
  if (availableState === "not_installed") items.push({ id: "install", label: t("Instalar"), run: () => install(game.id) });
  // Cancelar um download é remover o jogo: numa atualização isso apagaria um jogo já instalado, então não se oferece.
  if (availableState === "installing" && !game.update) items.push({ id: "cancel", label: t("Cancelar download"), danger: true, run: () => ui.askCancelInstall(game.id) });
  items.push({ id: "fav", label: game.favorite ? t("Remover dos favoritos") : t("Adicionar aos favoritos"), run: () => toggleFavorite(game.id) });
  const compatible = hasControllerSupport(support);
  items.push({
    id: "controller",
    label: override !== undefined ? t("Restaurar detecção de controle") : compatible ? t("Marcar como incompatível com controle") : t("Marcar como compatível com controle"),
    run: () => {
      useUserData.getState().setControllerOverride(game.id, override === undefined ? !compatible : undefined);
      ui.showToast(t("Suporte a controle atualizado."), "success");
    },
  });
  if (availableState === "installed" && !running && !launching) {
    if (game.source === "steam") items.push({ id: "verify", label: t("Verificar arquivos do jogo"), run: () => void api.verifyGame(game) });
    items.push({ id: "uninstall", label: t("Desinstalar"), danger: true, run: () => ui.askUninstall(game.id) });
  }

  const status = uninstalling ? t("Desinstalando…") : running ? t("Em execução") : launching ? t("Abrindo…")
    : game.state === "installed" ? (game.update === "pending" ? t("Instalado · atualização disponível") : t("Instalado"))
    : game.state === "installing" ? (game.update ? t("Atualizando…") : t("Baixando…")) : t("Não instalado");

  return (
    <div className="overlay">
      <FocusGroup focusKey="ctx" className="menu" boundary preferredChildFocusKey={`ctx-${items[0].id}`}>
        <div className="menu-head">
          <div>
            <h2>{game.title}</h2>
            <p>{status}</p>
          </div>
        </div>
        {items.map((it) => (
          <Focusable
            key={it.id}
            focusKey={`ctx-${it.id}`}
            className={`menu-item ${it.danger ? "menu-danger" : ""}`}
            scroll={false}
            onPress={() => {
              ui.closeContext();
              it.run();
            }}
          >
            {it.label}
          </Focusable>
        ))}
      </FocusGroup>
      <Hints modal items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Fechar" }]} />
    </div>
  );
}
