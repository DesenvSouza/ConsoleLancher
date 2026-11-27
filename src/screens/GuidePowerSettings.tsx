import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { FocusGroup } from "../components/Focusable";
import { ActionRow, Setting } from "../components/Setting";
import { t } from "../i18n";
import { POWER_OPTIONS, readPowerOptions, setPowerOption, type GuideOption, type GuideOptions } from "../guide/preferences";
import { withTimeout } from "../lib/timeout";
import { useUI } from "../store/ui";

const first = "set-guide-pause-game";
/** Prazo para ler ou gravar as opções: sem ele a página podia ficar em "Carregando…" para sempre. */
const LIMIT_MS = 4000;

export function GuidePowerSettings() {
  const [options, setOptions] = useState<GuideOptions | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** A opção que está sendo gravada. */
  const [saving, setSaving] = useState<GuideOption | null>(null);
  const savingRef = useRef(false);
  const attempt = useRef(0);
  const loaded = options !== null;

  const load = useCallback(() => {
    const request = ++attempt.current;
    setLoadFailed(false);
    void withTimeout(readPowerOptions(), LIMIT_MS).then((saved) => {
      if (attempt.current === request) setOptions(saved);
    }).catch(() => {
      if (attempt.current === request) setLoadFailed(true);
    });
  }, []);

  useEffect(() => {
    load();
    return () => { attempt.current++; };
  }, [load]);

  useEffect(() => {
    if (loaded) setFocus(first);
    else if (loadFailed) setFocus("set-guide-retry");
  }, [loaded, loadFailed]);

  async function update(option: GuideOption, enabled: boolean) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(option);
    try {
      setOptions(await withTimeout(setPowerOption(option, enabled), LIMIT_MS));
    } catch {
      // Fica o valor anterior; se a gravação só demorou, a releitura mostra o que valeu.
      useUI.getState().showToast(t("Não foi possível salvar as opções do menu Guia."), "warning");
      void withTimeout(readPowerOptions(), LIMIT_MS).then(setOptions).catch(() => undefined);
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  }

  const value = (option: GuideOption, on: string, off: string) => (saving === option ? t("Salvando…") : options?.[option] ? on : off);

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Menu Guia")} />
      <FocusGroup focusKey="guide-power-settings" className="settings-list settings-page" preferredChildFocusKey={first} disabled={!loaded && !loadFailed}>
        {options ? (
          <>
            <h3 className="settings-title">{t("Com o jogo aberto")}</h3>
            <Setting
              cycle
              id="guide-pause-game"
              label={t("Pausar o jogo com o Guia aberto")}
              hint={t("Congela o programa do jogo inteiro (não é a pausa do próprio jogo). Ajuda quando o controle mexe no jogo, mas pode causar tela preta em tela cheia e derrubar jogos online. Em janela sem bordas o controle já fica separado. Vale para todos os jogos.")}
              value={value("pauseGame", t("Ligado"), t("Desligado (padrão)"))}
              onStep={() => { void update("pauseGame", !options.pauseGame); }}
            />
            <h3 className="settings-title">{t("Energia do PC no Guia")}</h3>
            {POWER_OPTIONS.map(({ id, label }) => (
              <Setting
                key={id}
                cycle
                id={`guide-power-${id}`}
                label={t(label)}
                value={value(id, t("Exibir"), t("Ocultar"))}
                onStep={() => { void update(id, !options[id]); }}
              />
            ))}
          </>
        ) : loadFailed ? (
          <>
            <p role="alert">{t("Não foi possível ler as opções do menu Guia.")}</p>
            <ActionRow id="guide-retry" label={t("Tentar de novo")} onPress={load} />
          </>
        ) : <p role="status">{t("Carregando opções…")}</p>}
      </FocusGroup>
      <Hints items={loaded ? [{ btn: "A", label: "Selecionar" }, { btn: "LR", label: "Ajustar" }, { btn: "B", label: "Voltar" }] : loadFailed ? [{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }] : [{ btn: "B", label: "Voltar" }]} />
    </div>
  );
}
