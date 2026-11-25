import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { HomePreview } from "../components/preview/Previews";
import { ActionRow, Setting } from "../components/Setting";
import { t } from "../i18n";
import { BLOCK_TITLES, describeBlock, useHome } from "../store/home";
import { useUI } from "../store/ui";

/** Linha de onde se abriu o editor de uma fileira (só vale na volta dele). */
let returnFocus: string | null = null;

/** Lista dos blocos da página inicial: A abre as opções do bloco; também liga/desliga o destaque. */
export function HomeLayout() {
  const { blocks, showHero, setShowHero, rowMode, setRowMode, reset } = useHome();
  const { back, navigate } = useUI.getState();

  // Voltando do editor de uma fileira, o foco volta à linha que o abriu.
  // (Lido na renderização: o modo de desenvolvimento do React roda os efeitos duas vezes e o primeiro "desmontar" apagaria o valor.)
  const [restore] = useState(() => returnFocus);
  useEffect(() => {
    setFocus(restore && doesFocusableExist(restore) ? restore : "set-hero");
    return () => {
      returnFocus = useUI.getState().screen.name === "home-block" ? getCurrentFocusKey() ?? null : null;
    };
  }, []);

  return (
    <div className="screen settings">
      <TopBar title={t("Configurações › Início")} />
      <div className="settings-split">
      <FocusGroup focusKey="layout-list" className="settings-list settings-page" preferredChildFocusKey="set-hero">
        <h3 className="settings-title">{t("Destaque")}</h3>
        <Setting cycle id="hero" label={t("Destaque do jogo no topo")} hint={t("Título e descrição do jogo selecionado")} value={showHero ? t("Mostrar") : t("Ocultar")} onStep={() => setShowHero(!showHero)} />

        <Setting cycle id="rowmode" label={t("Fileiras na tela")} hint={t("Uma por vez mostra só a fileira selecionada; Todas deixa a tela rolar")} value={rowMode === "one" ? t("Uma por vez") : t("Todas")} onStep={() => setRowMode(rowMode === "one" ? "all" : "one")} />

        <h3 className="settings-title">{t("Fileiras (na ordem em que aparecem)")}</h3>
        {blocks.map((b) => (
          <Focusable key={b.id} focusKey={`block-${b.id}`} className={`setting ${b.enabled ? "" : "setting-off"}`} onPress={() => navigate({ name: "home-block", blockId: b.id })}>
            <span>{t(BLOCK_TITLES[b.kind])}</span>
            <span className="setting-value">{describeBlock(b)}  ›</span>
          </Focusable>
        ))}

        <div className="settings-sep" />
        <ActionRow id="reset" onPress={reset}>{t("Restaurar padrão")}</ActionRow>
        <ActionRow id="back" onPress={back}>{t("Voltar")}</ActionRow>
      </FocusGroup>
      <aside className="settings-preview" aria-label={t("Prévia ao vivo")}>
        <HomePreview />
      </aside>
      </div>
      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />
    </div>
  );
}
