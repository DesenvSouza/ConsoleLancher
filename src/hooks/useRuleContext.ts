import { useMemo } from "react";
import { gameControllerSupport, hasControllerSupport, steamTwinIndex } from "../lib/controllerSupport";
import { epicCatalogKey } from "../lib/epic";
import { makeContext, type RuleContext } from "../lib/libraryRules";
import { useEpic } from "../store/epic";
import { useLibrary } from "../store/library";
import { useUserData } from "../store/userData";

/**
 * O contexto das regras de aba (coleções da Steam, jogos que cada aba aceita...), já com a resposta para "este jogo tem suporte
 * a controle?". A resposta junta tudo o que o launcher sabe: o que a Steam guarda do jogo, a etiqueta da Epic, a cópia do
 * mesmo jogo na Steam, a busca na loja da Steam por nome e a correção manual do jogador.
 */
export function useRuleContext(): RuleContext {
  const games = useLibrary((s) => s.games);
  const collections = useLibrary((s) => s.collections);
  const appMeta = useLibrary((s) => s.appMeta);
  const epicSupport = useEpic((s) => s.controllerSupport);
  const lookup = useEpic((s) => s.steamLookup);
  const overrides = useUserData((u) => u.controllerOverrides);

  return useMemo(() => {
    const twins = steamTwinIndex(games, appMeta);
    const controllerOf = (game: (typeof games)[number]) =>
      hasControllerSupport(
        gameControllerSupport(game, appMeta[game.appId ?? game.id], game.epic ? epicSupport[epicCatalogKey(game.epic)]?.supported : undefined, overrides[game.id], twins, lookup),
      );
    return makeContext(collections, Date.now(), games, appMeta, controllerOf);
  }, [games, collections, appMeta, epicSupport, lookup, overrides]);
}
