import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useState } from "react";
import { playSound } from "../audio/sounds";
import { useModal } from "../hooks/useModal";
import { t, te } from "../i18n";
import { onAction } from "../input/actions";
import { api } from "../lib/api";
import { formatBytes } from "../lib/downloads";
import { useDownloads } from "../store/downloads";
import { useEpic } from "../store/epic";
import { useLibrary } from "../store/library";
import { updateBlocker, useUpdate } from "../store/update";
import { Hints } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";

/**
 * Aviso de versão nova: o que mudou, o andamento do download e a confirmação. O foco começa em "Depois", para um A apertado
 * sem querer não fechar o launcher.
 */
export function UpdateDialog() {
  const available = useUpdate((s) => s.available);
  const status = useUpdate((s) => s.status);
  const phase = useUpdate((s) => s.phase);
  const error = useUpdate((s) => s.error);
  // O motivo para esperar muda com o que está acontecendo: estas leituras refazem a tela quando muda.
  useLibrary((s) => s.runningAppId);
  useLibrary((s) => s.launching);
  useEpic((s) => s.installs);
  useEpic((s) => s.legendaryDownloading);
  useDownloads((s) => s.shutdownArmed);
  useDownloads((s) => s.countdownEndsAt);
  const blocker = updateBlocker();
  const [consoleMode, setConsoleMode] = useState(false);
  const downloading = phase === "downloading";
  const applying = phase === "applying";
  const ready = !!available && status?.ready === available.version;
  useModal("update-later");

  useEffect(() => {
    api.startupStatus().then((s) => setConsoleMode(!!s?.consoleActive)).catch(() => {});
  }, []);

  // Andamento do download.
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void useUpdate.getState().refresh(), 400);
    return () => clearInterval(timer);
  }, [downloading]);

  // Se o botão de instalar some (jogo aberto, download) ou os botões voltam (a instalação falhou), o foco vai para "Depois".
  const canInstall = !downloading && !applying && !blocker;
  useEffect(() => {
    if (!canInstall) setFocus("update-later");
  }, [canInstall]);
  useEffect(() => {
    if (!applying) setFocus("update-later");
  }, [applying]);

  const close = () => {
    if (useUpdate.getState().phase === "applying") return;
    playSound("back");
    useUpdate.getState().close();
  };
  useEffect(
    () =>
      onAction((a) => {
        if (a === "back") close();
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!available) return null;
  const total = status?.total ?? 0;
  const received = status?.received ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="update-title">
      <FocusGroup focusKey="update" className="dialog legendary-dialog update-dialog" boundary preferredChildFocusKey="update-later">
        <h2 id="update-title">{t("Atualização disponível")}</h2>
        <p>{t("Versão {version}. Você está na {current}.", { version: available.version, current: status?.current ?? "" })}</p>
        {available.notes && <p className="update-notes">{available.notes}</p>}
        {!downloading && !applying && (
          <p>
            {t("O launcher fecha, instala e abre de novo sozinho. Suas configurações são mantidas.")}
            {consoleMode && ` ${t("No modo console, a área de trabalho do Windows aparece durante a atualização.")}`}
          </p>
        )}
        {downloading && (
          <div className="legendary-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar">
              <div style={{ width: `${percent}%` }} />
            </div>
            <span>{total > 0 ? t("Baixando… {pct}% de {size}", { pct: percent, size: formatBytes(total) }) : t("Baixando…")}</span>
          </div>
        )}
        {applying && <p role="status">{t("Instalando… o launcher vai fechar e abrir de novo.")}</p>}
        {blocker && !applying && <p className="legendary-error" role="status">{t(blocker)}</p>}
        {error && phase === "idle" && <p className="legendary-error" role="alert">{te(error)}</p>}
        {/* Instalando, não há o que escolher: o launcher vai fechar. */}
        {!applying && (
          <div className="dialog-actions">
            <Focusable focusKey="update-later" className="btn" scroll={false} onPress={close}>
              {downloading ? t("Continuar em segundo plano") : blocker ? t("Fechar") : t("Depois")}
            </Focusable>
            {canInstall && (
              <Focusable focusKey="update-install" className="btn btn-primary" scroll={false} onPress={() => void useUpdate.getState().install()}>
                {error ? t("Tentar de novo") : ready ? t("Instalar agora") : t("Atualizar agora")}
              </Focusable>
            )}
          </div>
        )}
      </FocusGroup>
      {!applying && <Hints modal items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Fechar" }]} />}
    </div>
  );
}
