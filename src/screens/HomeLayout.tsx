import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { ActionRow, Setting } from "../components/Setting";
import { BLOCK_TITLES, describeBlock, useHome } from "../store/home";
import { useUI } from "../store/ui";

/** Lista dos blocos da página inicial: A abre as opções do bloco; também liga/desliga o destaque. */
export function HomeLayout() {
  const { blocks, showHero, setShowHero, rowMode, setRowMode, reset } = useHome();
  const { back, navigate } = useUI.getState();

  useEffect(() => {
    setFocus("set-hero");
  }, []);

  return (
    <div className="screen settings">
      <TopBar title="Personalizar página inicial" />
      <FocusGroup focusKey="layout-list" className="settings-list" preferredChildFocusKey="set-hero">
        <Setting cycle id="hero" label="Destaque do jogo no topo" value={showHero ? "Mostrar" : "Ocultar"} onStep={() => setShowHero(!showHero)} />

        <Setting cycle id="rowmode" label="Fileiras na tela" value={rowMode === "one" ? "Uma por vez" : "Todas"} onStep={() => setRowMode(rowMode === "one" ? "all" : "one")} />

        <h3 className="settings-title">Blocos (na ordem em que aparecem)</h3>
        {blocks.map((b) => (
          <Focusable key={b.id} focusKey={`block-${b.id}`} className={`setting ${b.enabled ? "" : "setting-off"}`} onPress={() => navigate({ name: "home-block", blockId: b.id })}>
            <span>{BLOCK_TITLES[b.kind]}</span>
            <span className="setting-value">{describeBlock(b)}  ›</span>
          </Focusable>
        ))}

        <div className="settings-sep" />
        <ActionRow id="reset" onPress={reset}>Restaurar padrão</ActionRow>
        <ActionRow id="back" onPress={back}>Voltar</ActionRow>
      </FocusGroup>
      <Hints items={[{ btn: "A", label: "Editar bloco" }, { btn: "B", label: "Voltar" }]} />
    </div>
  );
}
