import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup, Focusable } from "../components/Focusable";
import { LibraryPreview } from "../components/preview/Previews";
import { ActionRow, Setting } from "../components/Setting";
import { HIDDEN_LABELS, describeRule, type HiddenMode } from "../lib/libraryRules";
import { t } from "../i18n";
import { cycle, indexOf } from "../lib/util";
import { useLibrary } from "../store/library";
import { CARD_SIZES, CARD_SIZE_LABELS, tabName, useLibraryConfig } from "../store/libraryConfig";
import { useUI } from "../store/ui";

const HIDDEN_MODES: HiddenMode[] = ["show", "hide", "only"];

/** Configurações › Biblioteca: o que aparece na biblioteca completa e quais abas existem. */
/** Linha de onde se abriu o editor de uma aba (só vale na volta dele). */
let returnFocus: string | null = null;

export function LibrarySettings() {
  const config = useLibraryConfig();
  const collections = useLibrary((s) => s.collections);
  const { back, navigate } = useUI.getState();
  const [confirmReset, setConfirmReset] = useState(false);

  // Voltando do editor de uma aba, o foco volta à linha que o abriu (e não ao começo da lista).
  // (Lido na renderização: o modo de desenvolvimento do React roda os efeitos duas vezes e o primeiro "desmontar" apagaria o valor.)
  const [restore] = useState(() => returnFocus);
  useEffect(() => {
    setFocus(restore && doesFocusableExist(restore) ? restore : "set-hidden");
    return () => {
      returnFocus = useUI.getState().screen.name === "library-tab" ? getCurrentFocusKey() ?? null : null;
    };
  }, []);

  const hiddenCount = useMemo(() => collections.find((c) => c.id === "hidden")?.appIds.length ?? 0, [collections]);

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Biblioteca")} />
      <div className="settings-split">
      <FocusGroup focusKey="libset-list" className="settings-list settings-page" preferredChildFocusKey="set-hidden">
        <h3 className="settings-title">{t("Exibição")}</h3>
        <Setting
          cycle
          id="hidden"
          label={t("Jogos ocultos na Steam ({n})", { n: hiddenCount })}
          hint={t("Jogos que você escondeu no cliente da Steam: mostrar, esconder ou ver só eles")}
          value={t(HIDDEN_LABELS[config.hidden])}
          onStep={(d) => config.setOptions({ hidden: cycle(HIDDEN_MODES, indexOf(HIDDEN_MODES, config.hidden), d) })}
        />
        <Setting
          cycle
          id="cardsize"
          label={t("Tamanho das capas")}
          hint={t("Quantas capas cabem por linha na biblioteca")}
          value={t(CARD_SIZE_LABELS[config.cardSize])}
          onStep={(d) => config.setOptions({ cardSize: cycle(CARD_SIZES, indexOf(CARD_SIZES, config.cardSize), d) })}
        />
        <Setting cycle id="counts" label={t("Contagem nas abas")} hint={t("Mostra quantos jogos cada aba tem")} value={config.showCounts ? t("Mostrar") : t("Ocultar")} onStep={() => config.setOptions({ showCounts: !config.showCounts })} />

        <p className="account-note">{t("Para ver só jogos com suporte a controle, crie uma aba com esse filtro. No filtro da Biblioteca (botão RT) ficam a loja e o escopo. Os ícones das lojas e o selo dos jogos não instalados valem também para o Início e ficam em Configurações › Jogos e biblioteca.")}</p>

        <h3 className="settings-title">{t("Abas (na ordem em que aparecem)")}</h3>
        {config.tabs.map((tab) => (
          <Focusable key={tab.id} focusKey={`settab-${tab.id}`} className={`setting ${tab.enabled ? "" : "setting-off"}`} onPress={() => navigate({ name: "library-tab", tabId: tab.id })}>
            <span>{tabName(tab)}</span>
            <span className="setting-value">{tab.enabled ? describeRule(tab.rule, collections) : t("Oculta")}  ›</span>
          </Focusable>
        ))}
        <ActionRow
          id="newtab"
          onPress={() => {
            const id = config.addTab();
            navigate({ name: "library-tab", tabId: id });
          }}
        >
          {t("＋ Criar nova aba")}
        </ActionRow>

        <div className="settings-sep" />
        <ActionRow id="resetlib" onPress={() => setConfirmReset(true)}>{t("Restaurar abas e opções padrão")}</ActionRow>
        <ActionRow id="back" onPress={back}>{t("Voltar")}</ActionRow>
      </FocusGroup>
      <aside className="settings-preview" aria-label={t("Prévia ao vivo")}>
        <LibraryPreview />
      </aside>
      </div>
      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />

      {confirmReset && (
        <ConfirmDialog
          title={t("Restaurar a biblioteca?")}
          message={t("As abas voltam às quatro originais e as opções voltam ao padrão. As abas que você criou serão apagadas.")}
          confirmLabel={t("Restaurar")}
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
