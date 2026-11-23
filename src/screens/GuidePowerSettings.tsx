import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useRef, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { FocusGroup } from "../components/Focusable";
import { Setting } from "../components/Setting";
import { t } from "../i18n";
import { POWER_OPTIONS, readPowerOptions, setPowerOption, type PowerOption, type PowerOptions } from "../guide/preferences";
import { useUI } from "../store/ui";

const first = `set-guide-power-${POWER_OPTIONS[0].id}`;

export function GuidePowerSettings() {
  const [options, setOptions] = useState<PowerOptions | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const saving = useRef(false);
  const loaded = options !== null;

  useEffect(() => {
    let active = true;
    void readPowerOptions().then((saved) => {
      if (active) setOptions(saved);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loaded) setFocus(first);
  }, [loaded]);

  async function update(option: PowerOption, enabled: boolean) {
    if (saving.current) return;
    saving.current = true;
    try {
      setOptions(await setPowerOption(option, enabled));
    } catch {
      useUI.getState().showToast(t("Não foi possível salvar as opções de energia do Guia."), "warning");
    } finally {
      saving.current = false;
    }
  }

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Menu Guia › Opções de energia")} />
      <FocusGroup focusKey="guide-power-settings" className="settings-list settings-page" preferredChildFocusKey={first} disabled={!loaded}>
        <h3 className="settings-title">{t("Botões no Guia")}</h3>
        {options ? POWER_OPTIONS.map(({ id, label }) => (
          <Setting
            key={id}
            cycle
            id={`guide-power-${id}`}
            label={t(label)}
            value={options[id] ? t("Exibir") : t("Ocultar")}
            onStep={() => { void update(id, !options[id]); }}
          />
        )) : <p role="status">{loadFailed ? t("Não foi possível ler as opções de energia do Guia.") : t("Carregando opções…")}</p>}
      </FocusGroup>
      <Hints items={[{ btn: "A", label: "Alternar" }, { btn: "B", label: "Voltar" }]} />
    </div>
  );
}
