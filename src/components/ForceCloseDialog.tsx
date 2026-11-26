import { useEffect } from "react";
import { playSound } from "../audio/sounds";
import { t, te } from "../i18n";
import { api } from "../lib/api";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { ConfirmDialog } from "./ConfirmDialog";

/** O jogo não respondeu ao pedido de fechar: oferece encerrar os processos dele. Some sozinho se o jogo sair. */
export function ForceCloseDialog() {
  const appId = useUI((s) => s.forceCloseAppId);
  const title = useLibrary((s) => s.games.find((g) => g.appId === appId)?.title);

  useEffect(() => {
    if (!appId) return;
    const timer = setInterval(() => {
      void api.gameCloseState(appId).then((state) => {
        const ui = useUI.getState();
        if (!state.running && ui.forceCloseAppId === appId) ui.clearForceClose();
      }).catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [appId]);

  if (!appId) return null;
  return (
    <ConfirmDialog
      prefix="force-close"
      title={title ? t("{title} não terminou de fechar", { title }) : t("O jogo não terminou de fechar")}
      message={t("O jogo não está respondendo. Ele será encerrado na hora e o que não foi salvo será perdido.")}
      confirmLabel={t("Forçar o fechamento")}
      cancelLabel={t("Esperar")}
      danger
      onCancel={() => {
        playSound("back");
        useUI.getState().clearForceClose();
      }}
      onConfirm={() => {
        const ui = useUI.getState();
        if (ui.forceCloseAppId !== appId) return;
        ui.clearForceClose();
        void api.forceCloseGame(appId)
          .then(() => useLibrary.getState().pollRunning())
          .catch((error) => useUI.getState().showToast(te(error), "warning"));
      }}
    />
  );
}
