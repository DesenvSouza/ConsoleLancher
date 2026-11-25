import { useMemo } from "react";
import { SAMPLE_FEATURED_APP_ID, sampleLibrary } from "../lib/sampleLibrary";
import type { Game } from "../lib/types";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";

/** Com menos jogos com imagem que isto, a biblioteca do jogador é pequena demais para uma prévia: usa a fictícia. */
const MIN_GAMES = 8;

/** O jogo tem imagem para mostrar (capa e fundo)? Os da Steam pelo número do jogo; os demais, pela arte que a loja informou. */
const hasArt = (g: Game) => (g.source === "steam" ? !!g.appId : !!(g.art?.tall || g.art?.wide));

/**
 * Os jogos que as prévias de configuração mostram, com o destaque na frente:
 * - no assistente de configuração (e nas telas abertas a partir dele), sempre a biblioteca fictícia: numa instalação nova o
 *   jogador ainda não tem nada, e todos veem o mesmo exemplo completo;
 * - nas Configurações, os jogos do próprio jogador que têm imagem; se forem poucos, a fictícia.
 */
export function usePreviewGames(): { games: Game[]; featured: Game; sample: boolean } {
  const own = useLibrary((s) => s.games);
  const inWizard = useUI((s) => s.screen.name === "setup" || s.history.some((screen) => screen.name === "setup"));

  return useMemo(() => {
    const withArt = own.filter(hasArt);
    const sample = inWizard || withArt.length < MIN_GAMES;
    const list = sample ? sampleLibrary() : withArt;
    const featured = list.find((g) => g.appId === SAMPLE_FEATURED_APP_ID) ?? sampleLibrary()[0];
    return { games: [featured, ...list.filter((g) => g.id !== featured.id && g.appId !== featured.appId)], featured, sample };
  }, [own, inWizard]);
}
