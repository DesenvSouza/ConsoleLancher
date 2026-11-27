import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { playSound } from "../audio/sounds";
import { ButtonGlyph, Hints, TopBar, type Hint, formatLastPlayed } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { GameCard } from "../components/GameCard";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { Setting } from "../components/Setting";
import { useControllerSupportOf, useRuleContext } from "../hooks/useRuleContext";
import { useUniqueGames } from "../hooks/useUniqueGames";
import { useModal } from "../hooks/useModal";
import { t } from "../i18n";
import { onAction } from "../input/actions";
import { applyHidden, matchesRule } from "../lib/libraryRules";
import { GAME_SOURCES, STORE_ORDER } from "../lib/stores";
import type { Game } from "../lib/types";
import { scrollContainer } from "../lib/smoothScroll";
import { openSettingsAt } from "./Settings";
import { cycle, indexOf, normalizeText } from "../lib/util";
import { useEpic } from "../store/epic";
import { useLibrary } from "../store/library";
import { tabName, useLibraryConfig, visibleTabs } from "../store/libraryConfig";
import { useNotInstalled } from "../store/notInstalled";
import { SORTS, sortGames, useLibraryView, type StoreFilter } from "../store/libraryView";
import { useUI } from "../store/ui";
import { useUserData } from "../store/userData";


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
  const { tabId, sort, store, query, set } = useLibraryView();
  const config = useLibraryConfig();
  const checkingControllers = useEpic((s) => s.checkingControllers);
  const navigate = useUI((s) => s.navigate);
  const libraryFocusKey = useUI((s) => s.libraryFocusKey);
  const modalOpen = useUI((s) => s.modalOpen);
  const [searching, setSearching] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const tabStrip = useRef<HTMLDivElement>(null);

  // Abas configuradas em Configurações › Biblioteca. A aba escolhida pode ter sido apagada ou escondida: usa a primeira.
  const tabs = useMemo(() => visibleTabs(config.tabs), [config.tabs]);
  const active = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const activeName = tabName(active);
  const filter = active.id;

  // Primeiro os filtros globais, depois a aba, a busca e as contagens.
  const ctx = useRuleContext();
  const supportOf = useControllerSupportOf();
  const visibleGames = useMemo(() => applyHidden(games, config.hidden, ctx), [games, config.hidden, ctx]);
  // Filtro por loja: só aparece com jogos de mais de uma loja; a escolha some sozinha se a loja já não tem jogos.
  const sources = useMemo(() => STORE_ORDER.filter((s) => visibleGames.some((g) => g.source === s)), [visibleGames]);
  const storeFilter: StoreFilter = store !== "all" && sources.includes(store) ? store : "all";
  // Os repetidos entre lojas só somem na visão de todas as lojas: filtrando uma loja, aparece tudo o que ela tem.
  const unique = useUniqueGames(visibleGames);
  const pool = useMemo(() => (storeFilter === "all" ? unique : visibleGames.filter((g) => g.source === storeFilter)), [visibleGames, unique, storeFilter]);
  const noStoreGames = storeFilter !== "all" && pool.length === 0;
  const activeFilters = storeFilter !== "all" ? 1 : 0;
  const syncedAt = useUserData((u) => u.ownedFetchedAt);
  const counts = useMemo(
    () => Object.fromEntries(tabs.map((t) => [t.id, pool.filter((g) => matchesRule(g, t.rule, ctx)).length])) as Record<string, number>, // i18n-ignore
    [tabs, pool, ctx],
  );

  /** Numa aba de jogos com controle: quantos ainda não têm a resposta (não é o mesmo que não ter suporte). */
  const unverified = useMemo(() => (active.rule.controller ? pool.filter((g) => supportOf(g) === "unknown").length : 0), [active, pool, supportOf]);

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
  const lastView = useRef({ filter, sort, query, size: config.cardSize, store: storeFilter });
  useEffect(() => {
    const prev = lastView.current;
    if (prev.filter === filter && prev.sort === sort && prev.query === query && prev.size === config.cardSize && prev.store === storeFilter) return;
    lastView.current = { filter, sort, query, size: config.cardSize, store: storeFilter };
    useUI.setState({ libraryFocusKey: null });
    setVisible(PAGE);
    document.querySelector(".library-grid")?.scrollTo({ top: 0, behavior: "instant" });
  }, [filter, sort, query, config.cardSize, storeFilter]);

  // A aba escolhida (por LB/RB, por exemplo) fica à vista no meio da faixa de abas.
  useEffect(() => {
    const strip = tabStrip.current;
    const tab = strip?.querySelector<HTMLElement>(".tab.is-active");
    if (strip && tab) scrollContainer(strip, { left: tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2 }, true);
  }, [filter, tabs.length]);

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
  const emptyFirst = games.length === 0 ? "empty-account" : noStoreGames ? "empty-store" : query.trim() ? (storeFilter !== "all" ? "empty-all-stores" : "empty-edit") : "bar-search";
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
          if (tabId !== view.tabId) playSound("move");
          view.set({ tabId });
        } else if (a === "y") {
          // O mesmo seletor do botão "Ordem": a grade só muda depois de escolher.
          playSound("open");
          setSortOpen(true);
        } else if (a === "x") {
          playSound("open");
          setSearching(true);
        } else if (a === "rt" && hasFiltersRef.current) {
          // O painel de filtros (loja e escopo).
          playSound("open");
          setFiltersOpen(true);
        }
      }),
    [],
  );

  const shown = list.slice(0, visible);
  const preferred = libraryFocusKey && shown.some((g) => `lib-${g.id}` === libraryFocusKey) ? libraryFocusKey : undefined;
  const sortEntry = SORTS.find((s) => s.id === sort);
  const sortLabel = sortEntry ? t(sortEntry.label) : "";
  // O total é o da aba (a aba é uma definição, não um filtro): sem "x de y".
  const countText = list.length === 1 ? t("1 jogo") : t("{n} jogos", { n: list.length });

  /** O painel de filtros só existe quando há o que filtrar (mais de uma loja): sem isso ele só teria "Fechar". */
  const hasFilters = sources.length > 1 || storeFilter !== "all";
  const hasFiltersRef = useRef(hasFilters);
  hasFiltersRef.current = hasFilters;

  const hints: Hint[] = [
    // Só mostra o que tem ação: sem jogos e sem busca ativa não há nada para selecionar.
    ...(list.length > 0 || query.trim() ? [{ btn: "A", label: "Selecionar" } as Hint] : []),
    ...(list.length > 0 ? [{ btn: "Start", label: "Opções do jogo" } as Hint] : []),
    // Buscar e Ordenar já são botões na barra (X e Y continuam sendo os atalhos): não se repetem aqui.
    ...(hasFilters ? [{ btn: "RT", label: "Filtros" } as Hint] : []),
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
          {/* As abas rolam na horizontal quando não cabem (muitas abas ou interface ampliada): LB e RB ficam fixos nas pontas. */}
          <div className="tabs-scroll" ref={tabStrip}>
          {tabs.map((tab) => (
            <Focusable
              key={tab.id}
              focusKey={`bar-tab-${tab.id}`}
              className={`tab ${tab.id === filter ? "is-active" : ""}`}
              scroll="x"
              onPress={() => {
                if (tab.id === tabId) return;
                playSound("move");
                set({ tabId: tab.id });
              }}
            >
              {tabName(tab)}
              {config.showCounts && <em> {counts[tab.id]}</em>}
            </Focusable>
          ))}
          </div>
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
            {active.rule.controller && checkingControllers && <span role="status">{t("Verificando jogos da Epic…")}</span>}
            {unverified > 0 && <span className="library-unverified">{unverified === 1 ? t("1 sem confirmação de controle") : t("{n} sem confirmação de controle", { n: unverified })}</span>}
            {storeFilter !== "all" && <span>{t("Só {store}", { store: t(GAME_SOURCES[storeFilter].label) })}</span>}
            {syncedAt > 0 && <span className="library-synced">{t("Steam sincronizada {when}", { when: formatLastPlayed(syncedAt).toLowerCase() })}</span>}
            <span>{countText}</span>
            {hasFilters && (
              <Focusable focusKey="bar-filters" className={`chip chip-btn ${activeFilters > 0 ? "chip-active" : ""}`} scroll={false} onPress={() => { playSound("open"); setFiltersOpen(true); }}>
                <ButtonGlyph btn="RT" />
                {t("Filtros")}
                {activeFilters > 0 && <em className="chip-count">{activeFilters}</em>}
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
                  ? t("Conecte a Steam ou a Epic Games para ver a sua biblioteca, inclusive os jogos não instalados.")
                  : t("Sincronize a biblioteca em Configurações › Contas.")
                : active.rule.controller && checkingControllers && pool.length > 0
                  ? t("Verificando jogos da Epic…")
                  : noStoreGames
                  ? t("Nenhum jogo da loja {store} combina com o filtro atual.", { store: t(GAME_SOURCES[storeFilter as Game["source"]].label) })
                  : visibleGames.length === 0
                  ? t("Os jogos ocultos na Steam estão sendo escondidos. Mude isso em Configurações › Biblioteca.")
                  : query.trim()
                    ? storeFilter !== "all"
                      ? t("Nenhum resultado para “{query}” em {store} · {tab}.", { query: query.trim(), store: t(GAME_SOURCES[storeFilter as Game["source"]].label), tab: activeName })
                      : t("Nenhum jogo de {tab} combina com “{query}”.", { tab: activeName, query: query.trim() })
                    : unverified > 0
                      ? t("{n} jogos ainda sem confirmação de suporte a controle. Se você sabe que um deles tem, marque-o na aba Todos com o botão Start.", { n: unverified })
                      : t("Nenhum jogo nesta aba. Troque de aba ou ajuste a aba em Configurações › Biblioteca.")}
            </p>
            {games.length === 0 && (
              <FocusGroup focusKey="LIB-ACCOUNT" className="empty-actions">
                <Focusable
                  focusKey="empty-account"
                  className="btn btn-primary"
                  scroll={false}
                  onPress={() => {
                    openSettingsAt("accounts", "set-store-steam");
                    navigate({ name: "settings" });
                  }}
                >
                  {t("Conectar uma loja")}
                </Focusable>
              </FocusGroup>
            )}
            {noStoreGames && (
              <FocusGroup focusKey="LIB-EMPTY" className="empty-actions">
                <Focusable focusKey="empty-store" className="btn btn-primary" scroll={false} onPress={() => set({ store: "all" })}>
                  {t("Mostrar todas as lojas")}
                </Focusable>
              </FocusGroup>
            )}
            {pool.length > 0 && query.trim() && (
              <FocusGroup focusKey="LIB-EMPTY" className="empty-actions">
                {storeFilter !== "all" && (
                  <Focusable focusKey="empty-all-stores" className="btn btn-primary" scroll={false} onPress={() => set({ store: "all" })}>{t("Buscar em todas as lojas")}</Focusable>
                )}
                <Focusable focusKey="empty-edit" className={`btn ${storeFilter !== "all" ? "" : "btn-primary"}`} scroll={false} onPress={() => setSearching(true)}>{t("Editar busca")}</Focusable>
                <Focusable focusKey="empty-clear" className="btn" scroll={false} onPress={() => useLibraryView.getState().clearQuery()}>{t("Limpar busca")}</Focusable>
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
                showSource={config.showStoreIcons}
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
      {filtersOpen && <FilterMenu sources={sources} storeFilter={storeFilter} onClose={() => setFiltersOpen(false)} />}

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

/** Painel de filtros da Biblioteca: só a loja de origem (o que a aba mostra é definido na própria aba). O RT abre, o B fecha. */
function FilterMenu({ sources, storeFilter, onClose }: { sources: Game["source"][]; storeFilter: StoreFilter; onClose: () => void }) {
  const set = useLibraryView((v) => v.set);
  const stores: StoreFilter[] = ["all", ...sources];
  const active = storeFilter !== "all" ? 1 : 0;
  useModal("set-filter-store");
  useEffect(() => onAction((a) => {
    if (a !== "back" && a !== "rt") return;
    playSound("back");
    onClose();
  }), [onClose]);

  return (
    <div className="overlay">
      <FocusGroup focusKey="filter-menu" className="menu" boundary preferredChildFocusKey="set-filter-store">
        <div className="menu-head">
          <div>
            <h2>{t("Filtros")}</h2>
            <p>{active > 0 ? t("{n} ativo(s)", { n: active }) : t("Nenhum filtro ativo")}</p>
          </div>
        </div>
        {sources.length > 1 && (
          <Setting
            cycle
            id="filter-store"
            label={t("Loja")}
            hint={t("De onde vêm os jogos")}
            value={storeFilter === "all" ? t("Todas") : t(GAME_SOURCES[storeFilter].label)}
            onStep={(d) => {
              playSound("move");
              set({ store: cycle(stores, Math.max(0, stores.indexOf(storeFilter)), d) });
            }}
          />
        )}
        <Focusable
          focusKey="filter-clear"
          className="menu-item"
          scroll={false}
          onPress={() => {
            playSound("back");
            set({ store: "all" });
          }}
        >
          {t("Limpar filtros")}
        </Focusable>
        <Focusable focusKey="filter-close" className="menu-item" scroll={false} onPress={() => { playSound("back"); onClose(); }}>
          {t("Fechar")}
        </Focusable>
      </FocusGroup>
      <Hints modal items={[{ btn: "A", label: "Alterar" }, { btn: "LR", label: "Ajustar" }, { btn: "B", label: "Fechar" }]} />
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
