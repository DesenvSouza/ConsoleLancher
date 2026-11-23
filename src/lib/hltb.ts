import { isTauri } from "./api";

/** Espelha `HltbInfo` de src-tauri/src/hltb.rs: duração do jogo em minutos (null = o site não tem esse tempo). */
export interface HltbInfo {
  gameId: number;
  name: string;
  /** Só a história principal. */
  mainMin: number | null;
  /** História principal e extras. */
  extrasMin: number | null;
  /** Completista (100%). */
  completionistMin: number | null;
  url: string;
}

/**
 * Duração do jogo na HowLongToBeat (site sem API oficial: pode falhar). Só existe dentro do app.
 * Devolve null se o site não conhece o jogo.
 */
export const hltb = {
  available: isTauri,
  lookup: async (name: string, appId?: string): Promise<HltbInfo | null> => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<HltbInfo | null>("hltb_lookup", { name, appId: appId ?? null });
  },
};
