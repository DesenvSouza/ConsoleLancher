import { useEffect, useState } from "react";
import { locale, t, te } from "../i18n";
import { api } from "../lib/api";
import { useDownloads } from "../store/downloads";
import { useEpic } from "../store/epic";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";
import { updateBlocker, useUpdate } from "../store/update";
import { ActionRow, Setting } from "./Setting";

/** As opções de atualização (Configurações › Sistema e energia e a etapa Sistema do assistente). */
export function UpdateSettings({ onFocus }: { onFocus: (focusKey: string) => () => void }) {
  const auto = useUpdate((s) => s.auto);
  const setAuto = useUpdate((s) => s.setAuto);
  const status = useUpdate((s) => s.status);
  const available = useUpdate((s) => s.available);
  const phase = useUpdate((s) => s.phase);
  const lastCheckAt = useUpdate((s) => s.lastCheckAt);
  const lastError = useUpdate((s) => s.lastError);
  // O motivo para esperar muda com o que está acontecendo: estas leituras refazem a tela quando muda.
  useLibrary((s) => s.runningAppId);
  useLibrary((s) => s.launching);
  useEpic((s) => s.installs);
  useDownloads((s) => s.countdownEndsAt);
  /** Modo console ligado, mas este launcher está fora dele: falta reiniciar. */
  const [consoleWaiting, setConsoleWaiting] = useState(false);
  useEffect(() => {
    api.startupStatus().then((s) => setConsoleWaiting(!!s?.console && !s.consoleActive)).catch(() => {});
  }, []);

  // Sem a chave pública não há o que procurar. Isso só acontece em versões de desenvolvimento: o jogador não vê o aviso.
  const unconfigured = status?.support === "unconfigured";
  const current = status?.current ?? "";
  const percent = status && status.total > 0 ? Math.round((status.received / status.total) * 100) : 0;
  const checked = lastCheckAt ? new Date(lastCheckAt).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : "";
  const blocker = available ? updateBlocker() : null;
  const checkHint = unconfigured
    ? (import.meta.env.DEV ? "Atualizações sem chave pública: veja docs/PUBLICAR.md (aviso só em desenvolvimento)" : undefined) // i18n-ignore
    : lastError ? t("A última procura falhou: {error}", { error: te(lastError) })
    : !checked ? t("Ainda não verificado. Selecione para verificar agora.")
    : available ? t("Última verificação: {when}.", { when: checked })
    : t("Última verificação: {when}. Você está na versão mais recente.", { when: checked });

  return (
    <>
      {!unconfigured && (
        <Setting
          cycle
          id="update-auto"
          label={t("Procurar atualizações automaticamente")}
          hint={t("Ao abrir e de tempos em tempos. Nada é instalado sem você confirmar")}
          value={auto ? t("Ligado") : t("Desligado")}
          onFocus={onFocus("set-update-auto")}
          onStep={() => setAuto(!auto)}
        />
      )}
      <ActionRow
        id="update-version"
        label={t("Verificar agora")}
        hint={checkHint}
        value={phase === "checking" ? t("Procurando…") : t("Instalada: {version}", { version: current })}
        onFocus={onFocus("set-update-version")}
        onPress={() => {
          if (!unconfigured) void useUpdate.getState().check(true);
        }}
      />
      {available && (
        <ActionRow
          arrow
          id="update-available"
          label={t("Disponível: {version}", { version: available.version })}
          hint={blocker ? t(blocker) : status?.ready === available.version ? t("Baixada e conferida, pronta para instalar.") : t("Selecione para ver o que mudou.")}
          value={phase === "downloading" ? t("Baixando… {pct}%", { pct: percent }) : blocker ? t("Aguardando") : ""}
          onFocus={onFocus("set-update-available")}
          onPress={() => useUpdate.getState().open()}
        />
      )}
      {consoleWaiting && (
        <ActionRow
          arrow
          id="update-console-restart"
          label={t("Reiniciar para voltar ao modo console")}
          hint={t("O modo console está ligado, mas só volta a valer depois de reiniciar o PC.")}
          onFocus={onFocus("set-update-console-restart")}
          onPress={() => useUI.getState().navigate({ name: "startup" })}
        />
      )}
    </>
  );
}
