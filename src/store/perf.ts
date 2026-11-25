import { create } from "zustand";
import { isTauri } from "../lib/api";
import { t } from "../i18n";
import { DEFAULT_PERF, mergeConfig, perf, withOrderedLimits, type PerfConfig } from "../lib/perf";
import { useUI } from "./ui";

/** Partes da configuração: qualquer campo, inclusive dentro de `items` e `colors`. */
export type PerfPatch = { [K in keyof PerfConfig]?: PerfConfig[K] extends object ? Partial<PerfConfig[K]> : PerfConfig[K] };

interface PerfStore {
  config: PerfConfig;
  /** A configuração já foi lida do Rust. */
  loaded: boolean;
  load: () => Promise<void>;
  /** Muda só os campos enviados: a tela responde na hora e o Rust grava e aplica. */
  set: (patch: PerfPatch) => void;
  toggle: () => void;
  reset: () => void;
}

/**
 * Espelho da configuração do contador de FPS. A fonte da verdade é o Rust (arquivo perf.json): é ele que liga a janela e a
 * captura mesmo com o launcher em segundo plano, e o menu Guia (outra janela, com os próprios dados) muda a mesma
 * configuração pelos mesmos comandos.
 */
/** Intervalo mínimo entre ligar e desligar o contador: a janela dele leva um instante para abrir. */
const TOGGLE_GUARD_MS = 700;
let toggledAt = -TOGGLE_GUARD_MS;
/** Número do último pedido de gravação: respostas de pedidos antigos não sobrescrevem a escolha mais nova. */
let latest = 0;

export const usePerf = create<PerfStore>((set, get) => ({
  config: DEFAULT_PERF,
  loaded: !isTauri,
  load: async () => {
    try {
      set({ config: await perf.getConfig(), loaded: true });
    } catch (e) {
      console.error("perf_get_config falhou", e); // i18n-ignore
    }
  },
  set: (patch) => {
    if (patch.enabled !== undefined && patch.enabled !== get().config.enabled) {
      const now = performance.now();
      if (now - toggledAt < TOGGLE_GUARD_MS) return;
      toggledAt = now;
    }
    const before = get().config;
    // Faixas sempre em ordem ("aceitável" abaixo de "bom", "atenção" abaixo de "crítica"): ajusta a vizinha junto.
    const full = withOrderedLimits(before, patch) as PerfPatch;
    set({ config: mergeConfig(before, full) });
    const mine = ++latest;
    void perf
      .setConfig(full)
      .then((config) => {
        if (mine === latest) set({ config });
      })
      .catch(async (e) => {
        console.error("perf_set_config falhou", e); // i18n-ignore
        if (mine !== latest) return;
        // Falhou: volta ao que está realmente valendo e avisa.
        set({ config: await perf.getConfig().catch(() => before) });
        toggledAt = -TOGGLE_GUARD_MS;
        useUI.getState().showToast(t("Não foi possível salvar o contador de FPS. A mudança foi desfeita."), "warning");
      });
  },
  toggle: () => get().set({ enabled: !get().config.enabled }),
  // Volta ao padrão, mas não liga nem desliga o contador (isso é uma escolha à parte).
  reset: () => get().set({ ...DEFAULT_PERF, enabled: get().config.enabled }),
}));
