import { useEffect } from "react";
import { steam } from "../lib/steam";
import { useEpic } from "../store/epic";
import { useLibrary } from "../store/library";
import { useUserData } from "../store/userData";

/**
 * Mantém a biblioteca em dia com a Steam (só no app): lê a instalação ao abrir e depois
 * acompanha downloads/instalações a cada 3 s e o jogo em execução a cada 500 ms.
 * A lista de jogos da conta (com a conta configurada) se atualiza sozinha a cada 5 minutos, só sem jogo aberto, e também
 * logo após fechar um jogo ou ao aparecer um jogo instalado que a lista não conhece. Em Configurações › Conta Steam o
 * jogador ainda pode pedir "Sincronizar biblioteca agora".
 */
export function useSteamSync() {
  useEffect(() => {
    const lib = useLibrary.getState();
    if (lib.mode !== "steam") return;

    void lib.init().then(() => lib.autoSync());
    // Epic: situação da conta e jogos instalados ao abrir; a lista da conta se atualiza sozinha (de hora em hora, sem jogo aberto).
    void useEpic.getState().watchLogin();
    void useEpic.getState().refreshStatus().then(async () => {
      await useEpic.getState().refreshInstalled();
      void useEpic.getState().autoSync();
    });
    // Também recupera instalações do Legendary que continuaram enquanto a interface recarregava.
    void useEpic.getState().refreshInstalls();
    const epicInstalls = setInterval(() => void useEpic.getState().refreshInstalls(), 1000);
    const epicSync = setInterval(() => {
      if (useLibrary.getState().runningAppId === null) void useEpic.getState().autoSync();
    }, 60_000);
    // A lista de jogos da conta se atualiza sozinha (compras novas aparecem sem ir às Configurações). A verificação
    // roda a cada 30 s, mas `autoSync` só sincroniza se a lista tem mais de 5 min e não há jogo aberto.
    const owned = setInterval(() => void useLibrary.getState().autoSync(), 30_000);
    const installed = setInterval(() => void useLibrary.getState().refreshInstalled(), 3000);
    const running = setInterval(() => void useLibrary.getState().pollRunning(), 500);
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
      clearInterval(owned);
      clearInterval(epicSync);
      clearInterval(epicInstalls);
      unsubscribe();
    };
  }, []);
}
