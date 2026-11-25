import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { FocusGroup } from "../components/Focusable";
import { HomePreview } from "../components/preview/Previews";
import { ActionRow, Setting } from "../components/Setting";
import { t } from "../i18n";
import { cycle, indexOf } from "../lib/util";
import { BLOCK_TITLES, LIMITS, SIZES, SIZE_LABELS, STYLES, STYLE_LABELS, useHome } from "../store/home";
import { useUI } from "../store/ui";

/** Opções de um bloco: visibilidade, estilo, tamanho, quantidade e posição. */
export function HomeBlockEdit({ blockId }: { blockId: string }) {
  const blocks = useHome((s) => s.blocks);
  const { update, move } = useHome.getState();
  const back = useUI((s) => s.back);
  const block = blocks.find((b) => b.id === blockId);
  const position = blocks.findIndex((b) => b.id === blockId);

  useEffect(() => {
    setFocus("set-visible");
  }, []);

  if (!block) return null;

  // Move o bloco e, se o botão usado sumir (chegou ao topo/fim), leva o foco ao botão oposto.
  const shift = (dir: -1 | 1) => {
    move(block.id, dir);
    const next = position + dir;
    if (next <= 0 || next >= blocks.length - 1) setTimeout(() => setFocus(dir < 0 ? "set-down" : "set-up"), 0);
  };

  return (
    <div className="screen settings">
      <TopBar title={t("Início › {name}", { name: t(BLOCK_TITLES[block.kind]) })} />
      <div className="settings-split">
      <FocusGroup focusKey="block-list" className="settings-list settings-page" preferredChildFocusKey="set-visible">
        <Setting cycle id="visible" label={t("Mostrar no Início")} hint={t("Desligue para esconder esta fileira")} value={block.enabled ? t("Sim") : t("Não")} onStep={() => update(block.id, { enabled: !block.enabled })} />
        <Setting cycle id="style" label={t("Como aparece")} hint={t("Cartaz (capa vertical), panorâmico (capa larga) ou grade (várias linhas)")} value={t(STYLE_LABELS[block.style])} onStep={(d) => update(block.id, { style: cycle(STYLES, indexOf(STYLES, block.style), d) })} />
        <Setting cycle id="size" label={t("Tamanho dos itens")} value={t(SIZE_LABELS[block.size])} onStep={(d) => update(block.id, { size: cycle(SIZES, indexOf(SIZES, block.size), d) })} />
        <Setting cycle id="limit" label={t("Quantidade de jogos")} hint={t("Máximo de jogos mostrados nesta fileira")} value={block.limit === 0 ? t("Todos") : t("até {n}", { n: block.limit })} onStep={(d) => update(block.id, { limit: cycle(LIMITS, indexOf(LIMITS, block.limit), d) })} />

        <div className="settings-sep" />
        {position > 0 && <ActionRow id="up" onPress={() => shift(-1)}>{t("Mover para cima")}</ActionRow>}
        {position < blocks.length - 1 && <ActionRow id="down" onPress={() => shift(1)}>{t("Mover para baixo")}</ActionRow>}
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
