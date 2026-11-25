import { t } from "../i18n";
import { STORE_ACCOUNTS, GAME_SOURCES, type StoreId } from "../lib/stores";
import type { Screen } from "../lib/types";
import { useEpic } from "../store/epic";
import { useLibrary } from "../store/library";
import { useUserData } from "../store/userData";

/** Uma loja na lista de Configurações › Contas. */
export interface StoreAccount {
  id: StoreId;
  name: string;
  icon?: string;
  screen: Screen;
  /** Frase curta sobre o que a conta faz. */
  hint: string;
  /** Situação em poucas palavras ("Fulano · 230 jogos", "entrar"). */
  summary: string;
  /** A biblioteca completa (inclusive os não instalados) está disponível. */
  connected: boolean;
  /** O programa da loja foi encontrado neste PC com uma conta, mas ainda falta entrar nela no launcher. */
  detected?: boolean;
  syncing: boolean;
  /** Traz a lista de jogos da conta agora. */
  sync: () => void;
}

/** As lojas com conta, no mesmo formato, para a lista de Contas não precisar conhecer cada uma. */
export function useStoreAccounts(): StoreAccount[] {
  const library = useLibrary();
  const ownedCount = useUserData((u) => u.owned.length);
  const epic = useEpic();

  const steamSummary =
    library.mode === "mock"
      ? t("demonstração")
      : !library.steam?.found
        ? t("Steam não encontrada")
        : !library.steam.loggedIn
          ? t("abra a Steam")
          : library.keyStatus?.configured
            ? t("{name} · {n} jogos", { name: library.steam.personaName || library.steam.accountName || "", n: ownedCount })
            : t("Detectada neste PC: {name}", { name: library.steam.personaName || library.steam.accountName || "" });
  const epicSummary = epic.status?.signedIn ? t("{name} · {n} jogos", { name: epic.status.displayName || "Epic", n: epic.library.length }) : t("entrar");

  const states: Record<string, Pick<StoreAccount, "summary" | "connected" | "detected" | "syncing" | "sync">> = {
    steam: { summary: steamSummary, connected: !!library.keyStatus?.configured, detected: library.mode !== "mock" && !!library.steam?.loggedIn && !library.keyStatus?.configured, syncing: library.syncing, sync: () => void library.syncOwned() },
    epic: { summary: epicSummary, connected: !!epic.status?.signedIn, syncing: epic.syncing, sync: () => void epic.sync() },
  };
  return STORE_ACCOUNTS.map(({ id, screen, hint }) => ({ id, name: GAME_SOURCES[id].label, icon: GAME_SOURCES[id].icon, screen, hint, ...states[id] }));
}
