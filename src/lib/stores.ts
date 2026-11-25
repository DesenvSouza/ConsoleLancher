import epicIcon from "../assets/stores/epic.png";
import gogIcon from "../assets/stores/gog.png";
import steamIcon from "../assets/stores/steam.png";
import xboxIcon from "../assets/stores/xbox.png";
import type { Game, Screen } from "./types";

/**
 * As lojas (launchers) que o launcher conhece. Hoje Steam e Epic Games têm conta e biblioteca de verdade; GOG, Xbox e
 * "manual" já têm nome e ícone para quando entrarem. Para acrescentar uma loja: uma linha aqui, a tela da conta dela e uma
 * entrada em `useStoreAccounts` (resumo e sincronização).
 */
export type StoreId = Game["source"];

/** Nome e ícone de cada loja (ícones dos próprios sites, incluídos no app para funcionar também offline). */
export const GAME_SOURCES: Record<StoreId, { label: string; icon?: string }> = {
  steam: { label: "Steam", icon: steamIcon },
  epic: { label: "Epic Games", icon: epicIcon },
  gog: { label: "GOG", icon: gogIcon },
  xbox: { label: "Xbox", icon: xboxIcon },
  manual: { label: "Adicionado manualmente" },
};

/** Ordem das lojas nos filtros e nas listas. */
export const STORE_ORDER: StoreId[] = ["steam", "epic", "gog", "xbox", "manual"];

/** Pasta onde a loja guarda os jogos: a pasta de cima da instalação (`C:\\Users\\x\\Epic Games\\Jogo` → `C:\\Users\\x\\Epic Games`). */
export function parentFolder(installPath: string): string {
  const parts = installPath.replace(/\//g, "\\").replace(/\\+$/, "").split("\\");
  return parts.length > 1 ? parts.slice(0, -1).join("\\") : installPath;
}

/** Disco de um caminho ("C:", ou "\\\\servidor\\pasta" numa rede): pastas do mesmo disco dividem o mesmo espaço livre. */
export function driveOf(path: string): string {
  const letter = /^[a-z]:/i.exec(path);
  if (letter) return letter[0].toUpperCase();
  const share = /^\\\\[^\\]+\\[^\\]+/.exec(path.replace(/\//g, "\\"));
  return (share ? share[0] : path).toLowerCase();
}

/** As lojas com conta no launcher: a tela de cada uma em Configurações › Contas. */
export const STORE_ACCOUNTS: { id: StoreId; screen: Screen; hint: string }[] = [
  { id: "steam", screen: { name: "steam-account" }, hint: "Entrar com QR code (ou chave) para listar toda a biblioteca" },
  { id: "epic", screen: { name: "epic-account" }, hint: "Entrar na Epic para ver os jogos dela na biblioteca, inclusive os não instalados" },
];
