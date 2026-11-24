import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { playSound } from "../audio/sounds";
import { ButtonGlyph, Hints, TopBar, type Hint } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { GameCard } from "../components/GameCard";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { useModal } from "../hooks/useModal";
import { t } from "../i18n";
import { onAction } from "../input/actions";
import { applyHidden, emptyRule, makeContext, matchesRule } from "../lib/libraryRules";
import { cycle, indexOf, normalizeText } from "../lib/util";
import { useLibrary } from "../store/library";
import { tabName, useLibraryConfig, visibleTabs, type LibraryTab } from "../store/libraryConfig";
import { useNotInstalled } from "../store/notInstalled";
import { SORTS, sortGames, useLibraryView } from "../store/libraryView";
import { useUI } from "../store/ui";

/** Escopo especial "todos os jogos": ignora as abas (útil quando a aba atual não mostra o jogo que se procura). */
const ALL_SCOPE: LibraryTab = { id: "*", name: "Todos os jogos", enabled: true, rule: emptyRule() };

/** Cards desenhados de cada vez. Uma conta pode ter milhares de jogos: desenhar tudo deixaria a tela pesada. */
const PAGE = 60;
/** Quando o foco chega a este número de cards do fim do que está desenhado, desenha mais uma página. */
const LOOKAHEAD = 18;

/**
 * Biblioteca completa: todos os jogos da conta (instalados ou não), em grade, com filtro (LB/RB),
 * ordenação (Y) e busca (X). A Home mostra só os blocos escolhidos; aqui está tudo.
 */
export function Library() {
  const games = useLibrary((s) => s.games);
  const mode = useLibrary((s) => s.mode);
  const keyConfigured = useLibrary((s) => !!s.keyStatus?.configured);
  const collections = useLibrary((s) => s.collections);
  const appMeta = useLibrary((s) => s.appMeta);
  const { tabId, sort, query, scopeAll, set } = useLibraryView();
  const config = useLibraryConfig();
  const navigate = useUI((s) => s.navigate);
  const libraryFocusKey = useUI((s) => s.libraryFocusKey);
  const modalOpen = useUI((s) => s.modalOpen);
  const [searching, setSearching] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Abas configuradas em Configurações › Biblioteca. A aba escolhida pode ter sido apagada ou escondida: usa a primeira.
  const tabs = useMemo(() => visibleTabs(config.tabs), [config.tabs]);
  const everything = scopeAll;
  const active = everything ? ALL_SCOPE : tabs.find((t) => t.id === tabId) ?? tabs[0];
  const activeName = everything ? t("Todos os jogos") : tabName(active);
  const filter = active.id;

  // Jogos considerados pela biblioteca (depois da opção "jogos ocultos na Steam") e quantos cada aba tem.
  const ctx = useMemo(() => makeContext(collections, Date.now(), games, appMeta), [collections, games, appMeta]);
  const pool = useMemo(() => applyHidden(games, config.hidden, ctx), [games, config.hidden, ctx]);
  const counts = useMemo(
    () => Object.fromEntries(tabs.map((t) => [t.id, pool.filter((g) => matchesRule(g, t.rule, ctx)).length])) as Record<string, number>, // i18n-ignore
    [tabs, pool, ctx],
  );

  const installedFirst = useNotInstalled((n) => n.installedFirst);
  const list = useMemo(() => {
    const q = normalizeText(query.trim());
    const filtered = pool.filter((g) => matchesRule(g, active.rule, ctx) && (!q || normalizeText(g.title).includes(q)));
    const sorted = sortGames(filtered, sort);
    // Opção "instalados primeiro": mantém a ordem escolhida dentro de cada grupo.
    return installedFirst ? [...sorted.filter((g) => g.state !== "not_installed"), ...sorted.filter((g) => g.state === "not_installed")] : sorted;
  }, [pool, active, ctx, sort, query, installedFirst]);

  // Quantos cards estão desenhados. Ao voltar de um jogo, já inclui o card em que estávamos.
  const [visible, setVisible] = useState(() => {
    const at = libraryFocusKey ? list.findIndex((g) => `lib-${g.id}` === libraryFocusKey) : -1;
    return Math.max(PAGE, at + 1 + LOOKAHEAD);
  });

  // Mudou filtro, ordem ou busca: recomeça do primeiro jogo. Compara com os valores anteriores (e não com
  // "primeira execução"): o modo de desenvolvimento do React roda os efeitos duas vezes ao abrir e isso
  // apagaria o ponto onde o jogador estava ao voltar de outra tela.
  const lastView = useRef({ filter, sort, query, size: config.cardSize });
  useEffect(() => {
    const prev = lastView.current;
    if (prev.filter === filter && prev.sort === sort && prev.query === query && prev.size === config.cardSize) return;
    lastView.current = { filter, sort, query, size: config.cardSize };
    useUI.setState({ libraryFocusKey: null });
    setVisible(PAGE);
    document.querySelector(".library-grid")?.scrollTo({ top: 0, behavior: "instant" });
  }, [filter, sort, query, config.cardSize]);

  // Ao abrir a biblioteca, relê as coleções da Steam (o jogador pode ter mudado alguma no cliente da Steam).
  useEffect(() => {
    void useLibrary.getState().refreshCollections();
  }, []);

  // Ao voltar de outra tela a grade é desenhada do zero e o foco volta ao jogo anterior: a rolagem inicial é
  // instantânea (animada, pareceria uma corrida desde o topo). Depois dos primeiros instantes, volta a ser suave.
  const settled = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => (settled.current = true), 700);
    return () => clearTimeout(t);
  }, []);
  const isSmooth = () => settled.current;

  // Garante que algo tenha o foco (ao abrir, e quando a lista muda): um card da grade ou, sem jogos, o primeiro botão do
  // estado vazio. O foco na barra (abas, busca, ordem) é válido: não é puxado de volta.
  const emptyFirst = query.trim() && !everything ? "empty-all" : query.trim() ? "empty-edit" : !everything && pool.length > 0 ? "empty-all" : "bar-search";
  useEffect(() => {
    if (modalOpen) return;
    const current: string | null | undefined = getCurrentFocusKey();
    const valid = !!current && doesFocusableExist(current) && (current.startsWith("lib-") || current.startsWith("bar-") || current.startsWith("empty-"));
    if (valid) return;
    setFocus(list.length > 0 ? "LIB" : emptyFirst);
  }, [list, visible, query, modalOpen, emptyFirst]);

  // Botões desta tela: LB/RB trocam o filtro, Y a ordem, X abre a busca.
  useEffect(
    () =>
      onAction((a) => {
        if (useUI.getState().modalOpen) return;
        const view = useLibraryView.getState();
        if (a === "lb" || a === "rb") {
          // LB/RB passam pelas abas visíveis (as configuradas), na ordem em que aparecem.
          const list = visibleTabs(useLibraryConfig.getState().tabs);
          const i = indexOf(list.map((t) => t.id), view.tabId);
          const tabId = cycle(list, i, a === "lb" ? -1 : 1).id;
          if (tabId !== view.tabId || view.scopeAll) playSound("move");
          view.set({ tabId, scopeAll: false, widenedBySearch: false });
        } else if (a === "y") {
          // O mesmo seletor do botão "Ordem": a grade só muda depois de escolher.
          playSound("open");
          setSortOpen(true);
        } else if (a === "x") {
          playSound("open");
          setSearching(true);
        }
      }),
    [],
  );

  const shown = list.slice(0, visible);
  const preferred = libraryFocusKey && shown.some((g) => `lib-${g.id}` === libraryFocusKey) ? libraryFocusKey : undefined;
  const sortEntry = SORTS.find((s) => s.id === sort);
  const sortLabel = sortEntry ? t(sortEntry.label) : "";
  const countText = query.trim()
    ? t("{n} de {total} jogos · busca em {tab}", { n: list.length, total: pool.length, tab: activeName })
    : everything ? t("{n} jogos", { n: list.length })
    : list.length !== pool.length ? t("{n} de {total} jogos · {tab}", { n: list.length, total: pool.length, tab: activeName }) : list.length === 1 ? t("1 jogo") : t("{n} jogos", { n: list.length });
  /** Há jogos fora do escopo atual: oferece ampliar para todos. */
  const canWiden = !everything && list.length < pool.length;
  const widen = () => {
    playSound("open");
    set({ scopeAll: true, widenedBySearch: !!query.trim() });
  };

  const hints: Hint[] = [
    // Só mostra o que tem ação: sem jogos e sem busca ativa não há nada para selecionar.
    ...(list.length > 0 || query.trim() ? [{ btn: "A", label: "Selecionar" } as Hint] : []),
    ...(list.length > 0 ? [{ btn: "Start", label: "Opções do jogo" } as Hint] : []),
    // Buscar e Ordenar já são botões na barra (X e Y continuam sendo os atalhos): não se repetem aqui.
    { btn: "Select", label: "Configurações" },
    // Com busca ativa, o B limpa a busca primeiro (o App trata isso); só depois volta ao Início.
    { btn: "B", label: query.trim() ? "Limpar busca" : "Voltar" },
  ];

  return (
    <div className="screen library">
      <TopBar title={t("Biblioteca")} current="library" />

      {/* Barra: as abas, a busca, o escopo e a ordem são botões (direcional + A); LB/RB, X e Y continuam sendo os atalhos. */}
      <FocusGroup focusKey="LIB-BAR" className="library-bar">
        <div className="tabs">
          {/* LB/RB só fazem sentido (e só aparecem) quando há mais de uma aba para alternar. */}
          {tabs.length > 1 && <ButtonGlyph btn="LB" />}
          {tabs.map((tab) => (
            <Focusable
              key={tab.id}
              focusKey={`bar-tab-${tab.id}`}
              className={`tab ${tab.id === filter ? "is-active" : ""}`}
              scroll={false}
              onPress={() => {
                if (tab.id === tabId && !scopeAll) return;
                playSound("move");
                set({ tabId: tab.id, scopeAll: false, widenedBySearch: false });
              }}
            >
              {tabName(tab)}
              {config.showCounts && <em> {counts[tab.id]}</em>}
            </Focusable>
          ))}
          {/* Em "todos os jogos" nenhuma aba vale: esta etiqueta mostra o escopo atual (escolher uma aba volta a ela). */}
          {everything && <span className="tab is-active">{t("Todos os jogos")}</span>}
          {tabs.length > 1 && <ButtonGlyph btn="RB" />}
        </div>
        <div className="library-meta">
          <Focusable focusKey="bar-search" className="chip chip-btn" scroll={false} onPress={() => { playSound("open"); setSearching(true); }}>
            <ButtonGlyph btn="X" />{query.trim() ? t("Editar busca") : t("Buscar")}
          </Focusable>
          {/* Só com uma busca ativa. Mais rápido: o B, em qualquer lugar da tela, também limpa a busca. */}
          {query.trim() && (
            <Focusable focusKey="bar-clear" className="chip chip-btn chip-clear" scroll={false} onPress={() => useLibraryView.getState().clearQuery()}>
              {t("✕ Limpar busca “{query}”", { query: query.trim() })}
            </Focusable>
          )}
          {/* Quantidade, escopo e ordem ficam à direita; só as abas (acima) ficam centralizadas. */}
          <div className="library-meta-right">
            <span>{countText}</span>
            {canWiden && (
              <Focusable focusKey="bar-scope" className="chip chip-btn" scroll={false} onPress={widen}>
                {query.trim() ? t("Buscar em todos os jogos") : t("Ver todos os jogos")}
              </Focusable>
            )}
            <Focusable focusKey="bar-sort" className="chip chip-btn" scroll={false} onPress={() => { playSound("open"); setSortOpen(true); }}>
              <ButtonGlyph btn="Y" />{t("Ordem: {sort}", { sort: sortLabel })} ▾
            </Focusable>
          </div>
        </div>
      </FocusGroup>

      {list.length === 0 ? (
        <div className="library-grid library-empty">
          <div className="empty-state">
            <h2>{games.length === 0 ? t("Nenhum jogo por aqui ainda") : t("Nenhum jogo encontrado")}</h2>
            <p>
              {games.length === 0
                ? mode === "steam" && !keyConfigured
                  ? t("Configure a sua conta Steam para listar toda a biblioteca, inclusive os jogos não instalados.")
                  : t("Sincronize a biblioteca em Configurações › Conta Steam.")
                : pool.length === 0
                  ? t("Os jogos ocultos na Steam estão sendo escondidos. Mude isso em Configurações › Biblioteca.")
                  : query.trim()
                    ? everything ? t("Nenhum jogo combina com “{query}”.", { query: query.trim() }) : t("Nenhum jogo de {tab} combina com “{query}”.", { tab: activeName, query: query.trim() })
                    : t("Nenhum jogo combina com o filtro atual. Troque a aba ou veja todos os jogos.")}
            </p>
            {pool.length > 0 && (
              <FocusGroup focusKey="LIB-EMPTY" className="empty-actions">
                {!everything && (
                  <Focusable focusKey="empty-all" className="btn btn-primary" scroll={false} onPress={widen}>{t("Buscar em todos os jogos")}</Focusable>
                )}
                {query.trim() && (
                  <Focusable focusKey="empty-edit" className="btn" scroll={false} onPress={() => setSearching(true)}>{t("Editar busca")}</Focusable>
                )}
                {query.trim() && (
                  <Focusable focusKey="empty-clear" className="btn" scroll={false} onPress={() => useLibraryView.getState().clearQuery()}>{t("Limpar busca")}</Focusable>
                )}
              </FocusGroup>
            )}
          </div>
        </div>
      ) : (
      <FocusGroup focusKey="LIB" className={`library-grid size-${config.cardSize}`} preferredChildFocusKey={preferred}>
        {(
          shown.map((g, i) => {
            const key = `lib-${g.id}`;
            return (
              <GameCard
                key={key}
                game={g}
                focusKey={key}
                size={config.cardSize}
                smooth={isSmooth}
                onFocus={() => {
                  const ui = useUI.getState();
                  ui.setFocusedGame(g.id);
                  ui.setLibraryFocusKey(key);
                  if (i >= shown.length - LOOKAHEAD) setVisible((v) => v + PAGE);
                }}
                onPress={() => navigate({ name: "detail", gameId: g.id })}
              />
            );
          })
        )}
      </FocusGroup>
      )}

      <Hints items={hints} />

      {sortOpen && <SortMenu onClose={() => setSortOpen(false)} />}

      {searching && (
        <OnScreenKeyboard
          title={t("Buscar na biblioteca")}
          hint={t("Digite parte do nome do jogo. Deixe em branco para ver todos.")}
          placeholder={t("Nome do jogo")}
          initial={query}
          maxLength={40}
          confirmLabel={t("Buscar")}
          onCancel={() => setSearching(false)}
          onSubmit={(value) => {
            setSearching(false);
            if (value) set({ query: value });
            else useLibraryView.getState().clearQuery();
          }}
        />
      )}
    </div>
  );
}

/** Escolha da ordem da biblioteca: lista as opções, marca a ativa e mostra o agrupamento "instalados primeiro". */
function SortMenu({ onClose }: { onClose: () => void }) {
  const sort = useLibraryView((v) => v.sort);
  const set = useLibraryView((v) => v.set);
  const installedFirst = useNotInstalled((n) => n.installedFirst);
  const setNotInstalled = useNotInstalled((n) => n.set);
  useModal(`sort-${sort}`);
  useEffect(() => onAction((a) => {
    if (a !== "back") return;
    playSound("back");
    onClose();
  }), [onClose]);

  return (
    <div className="overlay">
      <FocusGroup focusKey="sort-menu" className="menu" boundary preferredChildFocusKey={`sort-${sort}`}>
        <div className="menu-head">
          <div>
            <h2>{t("Ordenar a biblioteca")}</h2>
          </div>
        </div>
        {SORTS.map((entry) => (
          <Focusable
            key={entry.id}
            focusKey={`sort-${entry.id}`}
            className="menu-item"
            scroll={false}
            onPress={() => {
              set({ sort: entry.id });
              onClose();
            }}
          >
            {entry.id === sort ? "✓ " : ""}{t(entry.label)}
          </Focusable>
        ))}
        <Focusable focusKey="sort-installed-first" className="menu-item" scroll={false} onPress={() => setNotInstalled({ installedFirst: !installedFirst })}>
          {t("Instalados primeiro: {state}", { state: installedFirst ? t("Ligado") : t("Desligado") })}
        </Focusable>
      </FocusGroup>
      <Hints modal items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: "Fechar" }]} />
    </div>
  );
}
