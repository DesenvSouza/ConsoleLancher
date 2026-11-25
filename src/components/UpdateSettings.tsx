import { t } from "../i18n";
import { useUpdate } from "../store/update";
import { ActionRow, Setting } from "./Setting";

/** As opções de atualização (Configurações › Sistema e energia e a etapa Sistema do assistente). */
export function UpdateSettings({ onFocus }: { onFocus: (focusKey: string) => () => void }) {
  const auto = useUpdate((s) => s.auto);
  const setAuto = useUpdate((s) => s.setAuto);
  const status = useUpdate((s) => s.status);
  const available = useUpdate((s) => s.available);
  const phase = useUpdate((s) => s.phase);
  // Sem a chave pública não há o que procurar. Isso só acontece em versões de desenvolvimento: o jogador não vê o aviso.
  const unconfigured = status?.support === "unconfigured";
  const percent = status && status.total > 0 ? Math.round((status.received / status.total) * 100) : 0;
  const value = phase === "checking" ? t("Procurando…")
    : phase === "downloading" ? t("Baixando… {pct}%", { pct: percent })
    : available ? t("Nova: {version}", { version: available.version })
    : (status?.current ?? "");
  const hint = unconfigured
    ? (import.meta.env.DEV ? "Atualizações sem chave pública: veja docs/PUBLICAR.md (aviso só em desenvolvimento)" : undefined) // i18n-ignore
    : available ? t("Há uma versão nova. Selecione para ver o que mudou.") : t("Selecione para procurar uma versão nova agora");

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
        arrow={!unconfigured}
        id="update-version"
        label={t("Versão do launcher")}
        hint={hint}
        value={value}
        onFocus={onFocus("set-update-version")}
        onPress={() => {
          if (unconfigured) return;
          if (available) useUpdate.getState().open();
          else void useUpdate.getState().check(true);
        }}
      />
    </>
  );
}
