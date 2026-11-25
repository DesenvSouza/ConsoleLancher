import { useEffect, useMemo } from "react";
import { duplicateGroups, hideDuplicates } from "../lib/duplicates";
import type { Game } from "../lib/types";
import { useLibrary } from "../store/library";
import { useLibraryConfig } from "../store/libraryConfig";

/** A lista como o Início e a Biblioteca a mostram: sem as cópias repetidas entre lojas, se o jogador pediu. */
export function useUniqueGames(games: Game[]): Game[] {
  const mode = useLibraryConfig((c) => c.duplicates);
  const preferred = useLibraryConfig((c) => c.preferredStore);
  const preferInstalled = useLibraryConfig((c) => c.preferInstalled);
  const runningAppId = useLibrary((s) => s.runningAppId);
  return useMemo(() => (mode === "hide" ? hideDuplicates(games, { preferred, preferInstalled, runningAppId }) : games), [games, mode, preferred, preferInstalled, runningAppId]);
}

/**
 * Com as cópias escondidas, o favorito é do jogo e não de uma loja: se qualquer cópia é favorita, todas passam a ser (a que
 * aparece não pode "perder" o favorito marcado na outra). Chamar uma vez, na raiz do app.
 */
export function useSharedFavorites(): void {
  const games = useLibrary((s) => s.games);
  const hide = useLibraryConfig((c) => c.duplicates === "hide");
  useEffect(() => {
    if (!hide) return;
    const missing = duplicateGroups(games)
      .filter((group) => group.some((g) => g.favorite))
      .flatMap((group) => group.filter((g) => !g.favorite).map((g) => g.id));
    if (missing.length > 0) useLibrary.getState().setFavorites(missing, true);
  }, [games, hide]);
}
