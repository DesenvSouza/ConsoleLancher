import { useEffect, useState } from "react";
import { playSound } from "../audio/sounds";
import { t } from "../i18n";
import { api } from "../lib/api";
import { useIntro } from "../store/intro";
import { useLibrary } from "../store/library";
import { restartBlocker, useRestart } from "../store/restart";
import { useUI } from "../store/ui";
import { useUpdate } from "../store/update";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Depois de uma atualização do launcher, sugere reiniciar o PC. Espera a abertura em vídeo acabar e o jogador estar no
 * Início, sem nada aberto por cima e sem jogo. O foco começa em "Depois": um A sem querer não reinicia o PC.
 */
export function UpdateRestartDialog() {
  const version = useUpdate((s) => s.restartSuggestion);
  const intro = useIntro((s) => s.playing);
  const home = useUI((s) => s.screen.name === "home");
  const modalOpen = useUI((s) => s.modalOpen);
  const busy = useLibrary((s) => s.runningAppId !== null || Object.keys(s.launching).length > 0);
  const [open, setOpen] = useState(false);
  /** Modo console ligado, mas este launcher abriu fora dele (o instalador da atualização abre a área de trabalho). */
  const [consoleWaiting, setConsoleWaiting] = useState(false);

  useEffect(() => {
    if (version && !intro && home && !modalOpen && !busy) setOpen(true);
  }, [version, intro, home, modalOpen, busy]);

  useEffect(() => {
    if (!version) return;
    api.startupStatus().then((s) => setConsoleWaiting(!!s?.console && !s.consoleActive)).catch(() => {});
  }, [version]);

  if (!open || !version) return null;
  const answer = () => {
    setOpen(false);
    useUpdate.getState().answerRestartSuggestion();
  };
  return (
    <ConfirmDialog
      prefix="update-restart"
      title={t("Launcher atualizado")}
      message={`${t("A versão {version} foi instalada. Reiniciar o PC é recomendado para concluir a atualização. Salve o que estiver aberto antes de continuar.", { version })}${consoleWaiting ? ` ${t("O modo console só volta a valer depois de reiniciar.")}` : ""}`}
      confirmLabel={t("Reiniciar agora")}
      cancelLabel={t("Agora não")}
      onCancel={() => {
        playSound("back");
        answer();
      }}
      onConfirm={() => {
        const blocker = restartBlocker();
        answer();
        if (blocker) useUI.getState().showToast(t(blocker), "warning");
        else void useRestart.getState().start("update");
      }}
    />
  );
}
