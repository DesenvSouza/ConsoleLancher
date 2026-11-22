import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { FocusGroup } from "../components/Focusable";
import { ActionRow, Setting } from "../components/Setting";
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
      <TopBar title={BLOCK_TITLES[block.kind]} />
      <FocusGroup focusKey="block-list" className="settings-list" preferredChildFocusKey="set-visible">
        <Setting cycle id="visible" label="Mostrar na página inicial" value={block.enabled ? "Sim" : "Não"} onStep={() => update(block.id, { enabled: !block.enabled })} />
        <Setting cycle id="style" label="Como aparece" value={STYLE_LABELS[block.style]} onStep={(d) => update(block.id, { style: cycle(STYLES, indexOf(STYLES, block.style), d) })} />
        <Setting cycle id="size" label="Tamanho dos itens" value={SIZE_LABELS[block.size]} onStep={(d) => update(block.id, { size: cycle(SIZES, indexOf(SIZES, block.size), d) })} />
        <Setting cycle id="limit" label="Quantidade de jogos" value={block.limit === 0 ? "Todos" : `até ${block.limit}`} onStep={(d) => update(block.id, { limit: cycle(LIMITS, indexOf(LIMITS, block.limit), d) })} />

        <div className="settings-sep" />
        {position > 0 && <ActionRow id="up" onPress={() => shift(-1)}>Mover para cima</ActionRow>}
        {position < blocks.length - 1 && <ActionRow id="down" onPress={() => shift(1)}>Mover para baixo</ActionRow>}
        <ActionRow id="back" onPress={back}>Voltar</ActionRow>
      </FocusGroup>
      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />
    </div>
  );
}
