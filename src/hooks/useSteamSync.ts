import { useEffect } from "react";
import { steam } from "../lib/steam";
import { useLibrary } from "../store/library";
import { useUserData } from "../store/userData";

/**
 * Mantém a biblioteca em dia com a Steam (só no app): lê a instalação ao abrir e depois
 * acompanha downloads/instalações a cada 3 s e o jogo em execução a cada 2 s.
 * A lista de jogos da conta NÃO é baixada sozinha: o jogador pede em Configurações › Sincronizar.
 */
export function useSteamSync() {
  useEffect(() => {
    const lib = useLibrary.getState();
    if (lib.mode !== "steam") return;

    void lib.init();
    const installed = setInterval(() => void useLibrary.getState().refreshInstalled(), 3000);
    const running = setInterval(() => void useLibrary.getState().pollRunning(), 2000);
    // Progresso ao vivo: só faz algo enquanto houver uma instalação em andamento.
    const progress = setInterval(() => void useLibrary.getState().pollProgress(), 500);
    // As coleções da Steam mudam pouco: relê o arquivo a cada minuto (um arquivo pequeno, só leitura).
    const collections = setInterval(() => void useLibrary.getState().refreshCollections(), 60_000);
    // Os dados dos jogos (appinfo) mudam menos ainda: a cada 5 minutos.
    const meta = setInterval(() => void useLibrary.getState().refreshAppMeta(), 300_000);

    // Notificações da Steam: a escolha do jogador é repassada ao backend ao abrir e a cada mudança.
    const applyToasts = (hide: boolean) => void steam.setHideToasts(hide).catch(() => {});
    applyToasts(useUserData.getState().hideSteamToasts);
    const unsubscribe = useUserData.subscribe((s, prev) => {
      if (s.hideSteamToasts !== prev.hideSteamToasts) applyToasts(s.hideSteamToasts);
    });

    return () => {
      clearInterval(installed);
      clearInterval(running);
      clearInterval(progress);
      clearInterval(collections);
      clearInterval(meta);
      unsubscribe();
    };
  }, []);
}
