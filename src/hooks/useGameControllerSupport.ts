import { useMemo } from "react";
import { fromSteamVersion, gameControllerSupport, steamTwinIndex } from "../lib/controllerSupport";
import { epicCatalogKey } from "../lib/epic";
import type { Game } from "../lib/types";
import { useEpic } from "../store/epic";
import { useLibrary } from "../store/library";
import { useUserData } from "../store/userData";

export function useGameControllerSupport(game: Game) {
  const meta = useLibrary((state) => state.appMeta[game.appId ?? game.id]);
  const epicSupported = useEpic((state) => game.epic ? state.controllerSupport[epicCatalogKey(game.epic)]?.supported : undefined);
  const override = useUserData((state) => state.controllerOverrides[game.id]);
  const games = useLibrary((state) => game.source === "epic" ? state.games : null);
  const appMeta = useLibrary((state) => game.source === "epic" ? state.appMeta : null);
  const lookup = useEpic((state) => game.source === "epic" ? state.steamLookup : undefined);
  const twins = useMemo(() => (games && appMeta ? steamTwinIndex(games, appMeta) : undefined), [games, appMeta]);
  const support = gameControllerSupport(game, meta, epicSupported, override, twins, lookup);
  return { support, override, steamVersion: fromSteamVersion(game, support, epicSupported, override) };
}
