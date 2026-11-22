import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup, Focusable } from "../components/Focusable";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { ActionRow, Setting } from "../components/Setting";
import {
  INSTALL_LABELS, PLAYED_LABELS, applyHidden, collectionLabel, describeRule, isSupportedSpec, makeContext, matchesRule,
  type InstallRule, type PlayedRule,
} from "../lib/libraryRules";
import { cycle, indexOf } from "../lib/util";
import { useLibrary } from "../store/library";
import { useLibraryConfig } from "../store/libraryConfig";
import { useUI } from "../store/ui";

const INSTALLS: InstallRule[] = ["any", "installed", "not_installed", "installing"];
const PLAYEDS: PlayedRule[] = ["any", "never", "played", "recent"];
const HOURS = [0, 1, 5, 10, 20, 50, 100, 200];
const GBS = [0, 1, 5, 10, 20, 50, 100];

/** Edita uma aba: nome, visibilidade, regras de filtro e posição. */
export function LibraryTabEdit({ tabId }: { tabId: string }) {
  const config = useLibraryConfig();
  const games = useLibrary((s) => s.games);
  const collections = useLibrary((s) => s.collections);
  const appMeta = useLibrary((s) => s.appMeta);
  const back = useUI((s) => s.back);
  const tab = config.tabs.find((t) => t.id === tabId);
  const position = config.tabs.findIndex((t) => t.id === tabId);

  const [typing, setTyping] = useState<null | "name" | "text">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setFocus("set-name");
  }, []);

  // Coleções que podem ser usadas como filtro: as comuns e as dinâmicas cujo filtro sei avaliar.
  const usable = useMemo(() => collections.filter((c) => !c.dynamic || (c.filter && isSupportedSpec(c.filter))), [collections]);
  const unsupportedCount = collections.length - usable.length;
  const collectionIds = useMemo(() => [null, ...usable.map((c) => c.id)] as (string | null)[], [usable]);

  const ctx = useMemo(() => makeContext(collections, Date.now(), games, appMeta), [collections, games, appMeta]);
  const matches = useMemo(() => {
    if (!tab) return 0;
    return applyHidden(games, config.hidden, ctx).filter((g) => matchesRule(g, tab.rule, ctx)).length;
  }, [games, tab, config.hidden, ctx]);

  if (!tab) return null;
  const r = tab.rule;
  const set = (patch: Partial<typeof r>) => config.updateRule(tab.id, patch);
  const chosen = r.collectionId ? collections.find((c) => c.id === r.collectionId) : undefined;
  const collectionName = r.collectionId ? (chosen ? collectionLabel(chosen) : "(removida)") : "Qualquer";

  return (
    <div className="screen settings">
      <TopBar title={`Aba: ${tab.name}`} />
      <p className="tab-note">
        Esta aba mostra <b>{matches}</b> {matches === 1 ? "jogo" : "jogos"} agora · {describeRule(r, collections)}
      </p>

      <FocusGroup focusKey="tabedit-list" className="settings-list" preferredChildFocusKey="set-name">
        <Focusable focusKey="set-name" className="setting" onPress={() => setTyping("name")}>
          <span>Nome da aba</span>
          <span className="setting-value">{tab.name}  ›</span>
        </Focusable>
        <Setting cycle id="enabled" label="Visível na biblioteca" value={tab.enabled ? "Sim" : "Não"} onStep={() => config.updateTab(tab.id, { enabled: !tab.enabled })} />

        <h3 className="settings-title">Filtros (todos precisam valer ao mesmo tempo)</h3>
        <Setting cycle id="install" label="Instalação" value={INSTALL_LABELS[r.install]} onStep={(d) => set({ install: cycle(INSTALLS, indexOf(INSTALLS, r.install), d) })} />
        <Setting cycle id="fav" label="Favoritos do launcher" value={r.favorite ? "Só favoritos" : "Qualquer"} onStep={() => set({ favorite: !r.favorite })} />
        <Setting cycle id="played" label="Jogados" value={PLAYED_LABELS[r.played]} onStep={(d) => set({ played: cycle(PLAYEDS, indexOf(PLAYEDS, r.played), d) })} />
        <Setting id="hours" label="Tempo de jogo mínimo" value={r.minHours ? `${r.minHours}+ h` : "Qualquer"} onStep={(d) => set({ minHours: cycle(HOURS, indexOf(HOURS, r.minHours), d) })} />
        <Setting id="gb" label="Tamanho mínimo (instalados)" value={r.minGB ? `${r.minGB}+ GB` : "Qualquer"} onStep={(d) => set({ minGB: cycle(GBS, indexOf(GBS, r.minGB), d) })} />
        <Setting
          cycle
          id="collection"
          label="Coleção da Steam"
          value={collectionName}
          onStep={(d) => set({ collectionId: cycle(collectionIds, Math.max(0, collectionIds.indexOf(r.collectionId)), d) })}
        />
        <Focusable focusKey="set-text" className="setting" onPress={() => setTyping("text")}>
          <span>Nome contém</span>
          <span className="setting-value">{r.text.trim() ? `“${r.text.trim()}”` : "Qualquer"}  ›</span>
        </Focusable>
        {unsupportedCount > 0 && (
          <p className="tab-note tab-note-small">{unsupportedCount} coleção(ões) dinâmica(s) da Steam usam filtros que ainda não consigo avaliar (amigos, idiomas ou assinatura) e não aparecem na lista.</p>
        )}

        <div className="settings-sep" />
        {position > 0 && <ActionRow id="up" onPress={() => config.moveTab(tab.id, -1)}>Mover para a esquerda</ActionRow>}
        {position < config.tabs.length - 1 && <ActionRow id="down" onPress={() => config.moveTab(tab.id, 1)}>Mover para a direita</ActionRow>}
        {config.tabs.length > 1 && <ActionRow danger id="delete" onPress={() => setConfirmDelete(true)}>Excluir esta aba</ActionRow>}
        <ActionRow id="back" onPress={back}>Voltar</ActionRow>
      </FocusGroup>
      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />

      {typing === "name" && (
        <OnScreenKeyboard
          title="Nome da aba"
          hint="Aparece na barra de abas da biblioteca."
          placeholder="Ex.: RPGs"
          initial={tab.name}
          maxLength={24}
          confirmLabel="Salvar"
          onCancel={() => setTyping(null)}
          onSubmit={(v) => {
            setTyping(null);
            if (v.trim()) config.updateTab(tab.id, { name: v.trim() });
          }}
        />
      )}
      {typing === "text" && (
        <OnScreenKeyboard
          title="O nome do jogo contém…"
          hint="Mostra só os jogos cujo nome tem este texto. Deixe em branco para não filtrar por nome."
          placeholder="Ex.: Dark"
          initial={r.text}
          maxLength={30}
          confirmLabel="Salvar"
          onCancel={() => setTyping(null)}
          onSubmit={(v) => {
            setTyping(null);
            set({ text: v });
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Excluir a aba “${tab.name}”?`}
          message="Os jogos não são afetados, só a aba some da biblioteca."
          confirmLabel="Excluir"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            config.deleteTab(tab.id);
            back();
          }}
        />
      )}
    </div>
  );
}
