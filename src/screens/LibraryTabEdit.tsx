import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useState } from "react";
import { Hints, TopBar } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup, Focusable } from "../components/Focusable";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { ActionRow, Setting } from "../components/Setting";
import { useRuleContext } from "../hooks/useRuleContext";
import {
  INSTALL_LABELS, PLAYED_LABELS, applyHidden, collectionLabel, describeRule, isSupportedSpec, matchesRule,
  type InstallRule, type PlayedRule,
} from "../lib/libraryRules";
import { t } from "../i18n";
import { rich } from "../i18n/rich";
import { cycle, indexOf } from "../lib/util";
import { useLibrary } from "../store/library";
import { tabName, useLibraryConfig } from "../store/libraryConfig";
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

  const ctx = useRuleContext();
  const matches = useMemo(() => {
    if (!tab) return 0;
    return applyHidden(games, config.hidden, ctx).filter((g) => matchesRule(g, tab.rule, ctx)).length;
  }, [games, tab, config.hidden, ctx]);

  if (!tab) return null;
  const r = tab.rule;
  const set = (patch: Partial<typeof r>) => config.updateRule(tab.id, patch);
  const chosen = r.collectionId ? collections.find((c) => c.id === r.collectionId) : undefined;
  const collectionName = r.collectionId ? (chosen ? collectionLabel(chosen) : t("(removida)")) : t("Qualquer");

  return (
    <div className="screen settings">
      <TopBar title={t("Biblioteca › Aba: {name}", { name: tabName(tab) })} />
      <p className="tab-note">
        {rich(matches === 1 ? t("Esta aba mostra <b>1</b> jogo agora") : t("Esta aba mostra <b>{n}</b> jogos agora", { n: matches }))} · {describeRule(r, collections)}
      </p>

      <FocusGroup focusKey="tabedit-list" className="settings-list settings-page" preferredChildFocusKey="set-name">
        <Focusable focusKey="set-name" className="setting" onPress={() => setTyping("name")}>
          <span>{t("Nome da aba")}</span>
          <span className="setting-value">{tabName(tab)}  ›</span>
        </Focusable>
        <Setting cycle id="enabled" label={t("Visível na biblioteca")} value={tab.enabled ? t("Sim") : t("Não")} onStep={() => config.updateTab(tab.id, { enabled: !tab.enabled })} />

        <h3 className="settings-title">{t("Filtros (todos precisam valer ao mesmo tempo)")}</h3>
        <Setting cycle id="install" label={t("Instalação")} value={t(INSTALL_LABELS[r.install])} onStep={(d) => set({ install: cycle(INSTALLS, indexOf(INSTALLS, r.install), d) })} />
        <Setting cycle id="fav" label={t("Favoritos do launcher")} value={r.favorite ? t("Só favoritos") : t("Qualquer")} onStep={() => set({ favorite: !r.favorite })} />
        <Setting
          cycle
          id="controller"
          label={t("Suporte a controle")}
          hint={t("Só jogos com suporte parcial ou completo (Steam e Epic)")}
          value={r.controller ? t("Só com suporte") : t("Qualquer")}
          onStep={() => set({ controller: !r.controller })}
        />
        <Setting cycle id="played" label={t("Jogados")} value={t(PLAYED_LABELS[r.played])} onStep={(d) => set({ played: cycle(PLAYEDS, indexOf(PLAYEDS, r.played), d) })} />
        <Setting id="hours" label={t("Tempo de jogo mínimo")} value={r.minHours ? `${r.minHours}+ h` : t("Qualquer")} onStep={(d) => set({ minHours: cycle(HOURS, indexOf(HOURS, r.minHours), d) })} />
        <Setting id="gb" label={t("Tamanho mínimo (instalados)")} value={r.minGB ? `${r.minGB}+ GB` : t("Qualquer")} onStep={(d) => set({ minGB: cycle(GBS, indexOf(GBS, r.minGB), d) })} />
        <Setting
          cycle
          id="collection"
          label={t("Coleção da Steam")}
          value={collectionName}
          onStep={(d) => set({ collectionId: cycle(collectionIds, Math.max(0, collectionIds.indexOf(r.collectionId)), d) })}
        />
        <Focusable focusKey="set-text" className="setting" onPress={() => setTyping("text")}>
          <span>{t("Nome contém")}</span>
          <span className="setting-value">{r.text.trim() ? `“${r.text.trim()}”` : t("Qualquer")}  ›</span>
        </Focusable>
        {unsupportedCount > 0 && (
          <p className="tab-note tab-note-small">
            {unsupportedCount === 1
              ? t("1 coleção dinâmica da Steam não aparece na lista: ela usa filtros que o launcher ainda não avalia (amigos, idiomas ou assinatura).")
              : t("{n} coleções dinâmicas da Steam não aparecem na lista: elas usam filtros que o launcher ainda não avalia (amigos, idiomas ou assinatura).", { n: unsupportedCount })}
          </p>
        )}

        <div className="settings-sep" />
        {position > 0 && <ActionRow id="up" onPress={() => config.moveTab(tab.id, -1)}>{t("Mover para a esquerda")}</ActionRow>}
        {position < config.tabs.length - 1 && <ActionRow id="down" onPress={() => config.moveTab(tab.id, 1)}>{t("Mover para a direita")}</ActionRow>}
        {config.tabs.length > 1 && <ActionRow danger id="delete" onPress={() => setConfirmDelete(true)}>{t("Excluir esta aba")}</ActionRow>}
        <ActionRow id="back" onPress={back}>{t("Voltar")}</ActionRow>
      </FocusGroup>
      <Hints items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Voltar" }]} />

      {typing === "name" && (
        <OnScreenKeyboard
          title={t("Nome da aba")}
          hint={t("Aparece na barra de abas da biblioteca.")}
          placeholder={t("Ex.: RPGs")}
          initial={tabName(tab)}
          maxLength={24}
          confirmLabel={t("Salvar")}
          onCancel={() => setTyping(null)}
          onSubmit={(v) => {
            setTyping(null);
            if (v.trim()) config.updateTab(tab.id, { name: v.trim() });
          }}
        />
      )}
      {typing === "text" && (
        <OnScreenKeyboard
          title={t("O nome do jogo contém…")}
          hint={t("Mostra só os jogos cujo nome tem este texto. Deixe em branco para não filtrar por nome.")}
          placeholder={t("Ex.: Dark")}
          initial={r.text}
          maxLength={30}
          confirmLabel={t("Salvar")}
          onCancel={() => setTyping(null)}
          onSubmit={(v) => {
            setTyping(null);
            set({ text: v });
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t("Excluir a aba “{name}”?", { name: tabName(tab) })}
          message={t("Os jogos não são afetados, só a aba some da biblioteca.")}
          confirmLabel={t("Excluir")}
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
