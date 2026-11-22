import { useEffect } from "react";
import { useModal } from "../hooks/useModal";
import { onAction } from "../input/actions";
import { api } from "../lib/api";
import type { Game } from "../lib/types";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
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

  useModal("ctx");
  useEffect(() => onAction((a) => (a === "back" || a === "start") && useUI.getState().closeContext()), []);

  const { play, install, toggleFavorite, cancelInstall } = useLibrary.getState();
  const ui = useUI.getState();
  const availableState = uninstalling ? undefined : game.state;

  const items: Item[] = [];
  if (availableState === "installed") items.push({ id: "play", label: launching ? "Abrindo…" : "Jogar", run: () => play(game.id) });
  if (availableState === "not_installed") items.push({ id: "install", label: "Instalar", run: () => install(game.id) });
  if (availableState === "installing") items.push({ id: "cancel", label: "Cancelar download", danger: true, run: () => cancelInstall(game.id) });
  items.push({ id: "fav", label: game.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos", run: () => toggleFavorite(game.id) });
  if (game.source === "steam") {
    if (availableState === "installed") items.push({ id: "verify", label: "Verificar arquivos do jogo", run: () => void api.verifyGame(game) });
  }
  if (availableState === "installed" && !running) items.push({ id: "uninstall", label: "Desinstalar", danger: true, run: () => ui.askUninstall(game.id) });

  return (
    <div className="overlay">
      <FocusGroup focusKey="ctx" className="menu" boundary preferredChildFocusKey={`ctx-${items[0].id}`}>
        <div className="menu-head">
          <div>
            <h2>{game.title}</h2>
            <p>{uninstalling ? "Desinstalando…" : game.state === "installed" ? "Instalado" : game.state === "installing" ? "Baixando…" : "Não instalado"}</p>
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
