import { useEffect } from "react";
import { useModal } from "../hooks/useModal";
import { onAction } from "../input/actions";
import { api } from "../lib/api";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { FocusGroup, Focusable } from "./Focusable";
import { coverStyle } from "./GameCard";

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
export function ContextMenu({ gameId }: { gameId: string }) {
  const game = useLibrary((s) => s.games.find((g) => g.id === gameId));
  const screen = useUI((s) => s.screen);

  useModal("ctx-0");
  useEffect(() => onAction((a) => (a === "back" || a === "start") && useUI.getState().closeContext()), []);

  if (!game) return null;

  const { play, install, toggleFavorite, cancelInstall } = useLibrary.getState();
  const ui = useUI.getState();
  const onDetail = screen.name === "detail" && screen.gameId === game.id;

  const items: Item[] = [];
  if (game.state === "installed") items.push({ id: "play", label: "Jogar", run: () => play(game.id) });
  if (game.state === "not_installed") items.push({ id: "install", label: "Instalar", run: () => install(game.id) });
  if (game.state === "installing") items.push({ id: "cancel", label: "Cancelar download", danger: true, run: () => cancelInstall(game.id) });
  if (!onDetail) items.push({ id: "details", label: "Ver detalhes", run: () => ui.navigate({ name: "detail", gameId: game.id }) });
  items.push({ id: "fav", label: game.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos", run: () => toggleFavorite(game.id) });
  if (game.source === "steam") {
    if (game.state === "installed") items.push({ id: "verify", label: "Verificar arquivos do jogo", run: () => void api.verifyGame(game) });
    items.push({ id: "store", label: "Abrir página na loja Steam", run: () => void api.openStorePage(game) });
  }
  if (game.state === "installed") items.push({ id: "uninstall", label: "Desinstalar", danger: true, run: () => ui.askUninstall(game.id) });
  items.push({ id: "close", label: "Fechar", run: () => {} });

  return (
    <div className="overlay">
      <FocusGroup focusKey="ctx" className="menu" boundary preferredChildFocusKey="ctx-0">
        <div className="menu-head">
          <div className="menu-cover" style={coverStyle(game.hue)} />
          <div>
            <h2>{game.title}</h2>
            <p>{game.state === "installed" ? "Instalado" : game.state === "installing" ? "Baixando…" : "Não instalado"}</p>
          </div>
        </div>
        {items.map((it, i) => (
          <Focusable
            key={it.id}
            focusKey={`ctx-${i}`}
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
    </div>
  );
}
