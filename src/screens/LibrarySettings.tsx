import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup, Focusable } from "../components/Focusable";
import { ActionRow, Setting } from "../components/Setting";
import { HIDDEN_LABELS, describeRule, type HiddenMode } from "../lib/libraryRules";
import { cycle, indexOf } from "../lib/util";
import { useLibrary } from "../store/library";
import { CARD_SIZES, CARD_SIZE_LABELS, useLibraryConfig } from "../store/libraryConfig";
import { useUI } from "../store/ui";

const HIDDEN_MODES: HiddenMode[] = ["show", "hide", "only"];

/** Configurações › Biblioteca: o que aparece na biblioteca completa e quais abas existem. */
export function LibrarySettings() {
  const config = useLibraryConfig();
  const collections = useLibrary((s) => s.collections);
  const { back, navigate } = useUI.getState();
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setFocus("set-hidden");
  }, []);

  const hiddenCount = useMemo(() => collections.find((c) => c.id === "hidden")?.appIds.length ?? 0, [collections]);

  return (
    <div className="screen settings">
      <TopBar title="Configurações › Biblioteca" />
      <FocusGroup focusKey="libset-list" className="settings-list" preferredChildFocusKey="set-hidden">
        <Setting
          cycle
          id="hidden"
          label={`Jogos ocultos na Steam (${hiddenCount})`}
          value={HIDDEN_LABELS[config.hidden]}
          onStep={(d) => config.setOptions({ hidden: cycle(HIDDEN_MODES, indexOf(HIDDEN_MODES, config.hidden), d) })}
        />
        <Setting
          cycle
          id="cardsize"
          label="Tamanho dos cards"
          value={CARD_SIZE_LABELS[config.cardSize]}
          onStep={(d) => config.setOptions({ cardSize: cycle(CARD_SIZES, indexOf(CARD_SIZES, config.cardSize), d) })}
        />
        <Setting cycle id="counts" label="Mostrar a contagem nas abas" value={config.showCounts ? "Sim" : "Não"} onStep={() => config.setOptions({ showCounts: !config.showCounts })} />
        <ActionRow arrow id="notinstalled" onPress={() => navigate({ name: "not-installed" })}>Jogos não instalados (selo, capa e ordem)</ActionRow>

        <h3 className="settings-title">Abas da biblioteca (na ordem em que aparecem)</h3>
        {config.tabs.map((t) => (
          <Focusable key={t.id} focusKey={`settab-${t.id}`} className={`setting ${t.enabled ? "" : "setting-off"}`} onPress={() => navigate({ name: "library-tab", tabId: t.id })}>
            <span>{t.name}</span>
            <span className="setting-value">{t.enabled ? describeRule(t.rule, collections) : "Oculta"}  ›</span>
          </Focusable>
        ))}
        <ActionRow
          id="newtab"
          onPress={() => {
            const id = config.addTab();
            navigate({ name: "library-tab", tabId: id });
          }}
        >
          ＋ Criar nova aba
        </ActionRow>

        <div className="settings-sep" />
        <ActionRow id="resetlib" onPress={() => setConfirmReset(true)}>Restaurar abas e opções padrão</ActionRow>
        <ActionRow id="back" onPress={back}>Voltar</ActionRow>
      </FocusGroup>
      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />

      {confirmReset && (
        <ConfirmDialog
          title="Restaurar a biblioteca?"
          message="As abas voltam às quatro originais e as opções voltam ao padrão. As abas que você criou serão apagadas."
          confirmLabel="Restaurar"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            config.reset();
          }}
        />
      )}
    </div>
  );
}
