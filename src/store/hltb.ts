import { create } from "zustand";
import { persist } from "zustand/middleware";
import { hltb, type HltbInfo } from "../lib/hltb";

interface Entry {
  at: number;
  /** null = o site não conhece o jogo (ou não tem tempo registrado). */
  info: HltbInfo | null;
}

/** Quanto tempo uma resposta vale: a duração de um jogo quase não muda; "não achei" vale menos, pois o site cresce. */
const HIT_TTL_MS = 30 * 24 * 60 * 60_000;
const MISS_TTL_MS = 7 * 24 * 60 * 60_000;
/** Depois de uma falha (site fora do ar, bloqueio), não insiste neste jogo por um tempo; e com falhas seguidas, em nenhum. */
const RETRY_MS = 10 * 60_000;
const PAUSE_AFTER_FAILURES = 3;
const PAUSE_MS = 30 * 60_000;

interface HltbStore {
  entries: Record<string, Entry>;
  /** Pede a duração do jogo (se não houver uma resposta recente guardada). Nunca lança erro. */
  load: (appId: string, title: string) => Promise<void>;
}

// Controle em memória (não precisa sobreviver ao fechar o app).
const loading = new Set<string>();
const failedAt = new Map<string, number>();
let consecutiveFailures = 0;
let pausedUntil = 0;

export const useHltb = create<HltbStore>()(
  persist(
    (set, get) => ({
      entries: {},
      load: async (appId, title) => {
        if (!hltb.available || loading.has(appId)) return;
        const now = Date.now();
        const entry = get().entries[appId];
        if (entry && now - entry.at < (entry.info ? HIT_TTL_MS : MISS_TTL_MS)) return;
        if (now < pausedUntil || now - (failedAt.get(appId) ?? 0) < RETRY_MS) return;

        loading.add(appId);
        try {
          const info = await hltb.lookup(title, appId);
          consecutiveFailures = 0;
          failedAt.delete(appId);
          set({ entries: { ...get().entries, [appId]: { at: Date.now(), info } } });
        } catch (e) {
          // É um extra: falha em silêncio (nada de aviso na tela), só registra para não insistir.
          console.error("hltb_lookup falhou", e);
          failedAt.set(appId, Date.now());
          if (++consecutiveFailures >= PAUSE_AFTER_FAILURES) {
            pausedUntil = Date.now() + PAUSE_MS;
            consecutiveFailures = 0;
          }
        } finally {
          loading.delete(appId);
        }
      },
    }),
    { name: "launcher-hltb", version: 1 },
  ),
);
