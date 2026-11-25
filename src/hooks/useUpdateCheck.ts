import { useEffect } from "react";
import { isTauri } from "../lib/api";
import { useLibrary } from "../store/library";
import { useSystem } from "../store/system";
import { updateBlocker, useUpdate } from "../store/update";
import { useUI } from "../store/ui";

/** Espera depois de abrir, para não disputar a rede e o disco com a leitura das bibliotecas. */
const FIRST_CHECK_MS = 12_000;
const TICK_MS = 15_000;
/** De quanto em quanto tempo procurar de novo com o launcher aberto. */
const CHECK_EVERY_MS = 6 * 60 * 60_000;
/** Depois de uma procura que falhou (sem internet, por exemplo). */
const RETRY_AFTER_MS = 10 * 60_000;

/**
 * Procura versões novas em segundo plano e mostra o aviso uma vez por versão, quando o jogador está no Início sem nada
 * aberto por cima. Com um jogo aberto não procura nem avisa.
 */
export function useUpdateCheck() {
  useEffect(() => {
    let attemptedAt = 0;

    /** Mostra o aviso da versão nova, se este for um bom momento. */
    const announce = () => {
      const update = useUpdate.getState();
      const ui = useUI.getState();
      const { available } = update;
      if (!available || update.notified === available.version || update.dialog) return;
      if (ui.screen.name !== "home" || ui.modalOpen || useSystem.getState().panelOpen || updateBlocker()) return;
      if (isTauri && !document.hasFocus()) return;
      useUpdate.setState({ notified: available.version });
      update.open();
    };

    const tick = async () => {
      const update = useUpdate.getState();
      if (!update.auto || useLibrary.getState().runningAppId !== null) return;
      const now = Date.now();
      const due = update.checkedAt === null || now - update.checkedAt >= CHECK_EVERY_MS;
      if (due && now - attemptedAt >= RETRY_AFTER_MS && update.status?.support !== "unconfigured") {
        attemptedAt = now;
        await update.check(false);
      }
      announce();
    };

    // A versão instalada aparece nas Configurações mesmo sem procurar nada.
    void useUpdate.getState().refresh();
    const first = window.setTimeout(() => void tick(), FIRST_CHECK_MS);
    const timer = window.setInterval(() => void tick(), TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
}
