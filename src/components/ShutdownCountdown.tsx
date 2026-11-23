import { useEffect, useState } from "react";
import { t } from "../i18n";
import { useDownloads } from "../store/downloads";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Aviso final do desligamento programado ao concluir os downloads: mostra a contagem e deixa cancelar.
 * O "Cancelar" já vem selecionado: um aperto de A sem querer não desliga o PC.
 */
export function ShutdownCountdown() {
  const endsAt = useDownloads((s) => s.countdownEndsAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [endsAt]);

  if (endsAt === null) return null;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));

  return (
    <ConfirmDialog
      title={t("Downloads concluídos")}
      message={t("O PC será desligado em {n} s. Salve o que estiver aberto, ou cancele para continuar usando.", { n: left })}
      confirmLabel={t("Desligar agora")}
      danger
      cancelLabel={t("Cancelar desligamento")}
      onCancel={() => void useDownloads.getState().cancelShutdown()}
      onConfirm={() => void useDownloads.getState().shutdownNow()}
    />
  );
}
