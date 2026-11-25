import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { playSound } from "../audio/sounds";
import { useModal } from "../hooks/useModal";
import { t, te } from "../i18n";
import { onAction } from "../input/actions";
import { formatBytes } from "../lib/downloads";
import { useEpic } from "../store/epic";
import { Hints } from "./Chrome";
import { FocusGroup, Focusable } from "./Focusable";

/** O endereço do projeto, mostrado ao jogador (crédito e para quem quiser ver o código). */
export const LEGENDARY_PROJECT = "github.com/Heroic-Games-Launcher/legendary"; // i18n-ignore

/**
 * Pede para baixar o Legendary antes de instalar um jogo da Epic pelo launcher: diz o que é, de onde vem e o tamanho, mostra o
 * andamento e, se o jogador preferir, deixa a instalação com a Epic Games Launcher. Fechar durante o download não o interrompe.
 */
export function LegendaryDialog() {
  const prompt = useEpic((s) => s.legendaryPrompt);
  const status = useEpic((s) => s.legendary);
  const downloading = useEpic((s) => s.legendaryDownloading);
  const error = useEpic((s) => s.legendaryError);
  const launcherInstalled = useEpic((s) => !!s.status?.launcherInstalled);
  const game = prompt?.game ?? null;
  const first = downloading ? "legendary-cancel" : "legendary-download";
  useModal("legendary-cancel");

  useEffect(() => {
    setFocus(first);
  }, [first]);

  // Andamento do download (o tamanho do arquivo que está chegando).
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void useEpic.getState().refreshLegendary(), 400);
    return () => clearInterval(timer);
  }, [downloading]);

  const close = () => {
    playSound("back");
    useEpic.getState().closeLegendaryPrompt();
  };
  useEffect(
    () =>
      onAction((a) => {
        if (a === "back") close();
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const total = status?.total ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round(((status?.received ?? 0) / total) * 100)) : 0;

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="legendary-title">
      <FocusGroup focusKey="legendary" className="dialog legendary-dialog" boundary preferredChildFocusKey={first}>
        <h2 id="legendary-title">{t("Instalar jogos da Epic pelo launcher")}</h2>
        <p>{t("Para isso o launcher usa o Legendary, um programa gratuito e de código aberto (GPL-3.0), feito por outras pessoas. Ele é baixado do projeto oficial ({size}) e conferido antes de ser usado.", { size: total > 0 ? formatBytes(total) : "16 MB" })}</p>
        <p className="legendary-link">{LEGENDARY_PROJECT}</p>
        {downloading && (
          <div className="legendary-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar">
              <div style={{ width: `${percent}%` }} />
            </div>
            <span>{t("Baixando… {pct}%", { pct: percent })}</span>
          </div>
        )}
        {error && !downloading && <p className="legendary-error" role="alert">{te(error)}</p>}
        <div className="dialog-actions">
          <Focusable focusKey="legendary-cancel" className="btn" scroll={false} onPress={close}>
            {downloading ? t("Continuar em segundo plano") : t("Cancelar")}
          </Focusable>
          {!downloading && game && launcherInstalled && (
            <Focusable focusKey="legendary-egl" className="btn" scroll={false} onPress={() => void useEpic.getState().installWithEpicLauncher(game)}>
              {t("Usar a Epic Games Launcher")}
            </Focusable>
          )}
          {!downloading && (
            <Focusable focusKey="legendary-download" className="btn btn-primary" scroll={false} onPress={() => void useEpic.getState().downloadLegendary(game)}>
              {error ? t("Tentar de novo") : game ? t("Baixar e instalar") : t("Baixar")}
            </Focusable>
          )}
        </div>
      </FocusGroup>
      <Hints modal items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Fechar" }]} />
    </div>
  );
}
