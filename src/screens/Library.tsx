import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonGlyph, Hints, TopBar, type Hint } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { GameCard } from "../components/GameCard";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { onAction } from "../input/actions";
import { applyHidden, makeContext, matchesRule } from "../lib/libraryRules";
import { cycle, indexOf, normalizeText } from "../lib/util";
import { useLibrary } from "../store/library";
import { useLibraryConfig, visibleTabs } from "../store/libraryConfig";
import { SORTS, sortGames, useLibraryView } from "../store/libraryView";
import { useUI } from "../store/ui";

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
  const { tabId, sort, query, set } = useLibraryView();
  const config = useLibraryConfig();
  const navigate = useUI((s) => s.navigate);
  const libraryFocusKey = useUI((s) => s.libraryFocusKey);
  const [searching, setSearching] = useState(false);

  // Abas configuradas em Configurações › Biblioteca. A aba escolhida pode ter sido apagada ou escondida: usa a primeira.
  const tabs = useMemo(() => visibleTabs(config.tabs), [config.tabs]);
  const active = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const filter = active.id;

  // Jogos considerados pela biblioteca (depois da opção "jogos ocultos na Steam") e quantos cada aba tem.
  const ctx = useMemo(() => makeContext(collections, Date.now(), games, appMeta), [collections, games, appMeta]);
  const pool = useMemo(() => applyHidden(games, config.hidden, ctx), [games, config.hidden, ctx]);
  const counts = useMemo(
    () => Object.fromEntries(tabs.map((t) => [t.id, pool.filter((g) => matchesRule(g, t.rule, ctx)).length])) as Record<string, number>,
    [tabs, pool, ctx],
  );

  const list = useMemo(() => {
    const q = normalizeText(query.trim());
    const filtered = pool.filter((g) => matchesRule(g, active.rule, ctx) && (!q || normalizeText(g.title).includes(q)));
    return sortGames(filtered, sort);
  }, [pool, active, ctx, sort, query]);

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

  // Garante que algo tenha o foco (ao abrir, e quando a lista muda): um card da grade ou, se não há jogos
  // com uma busca ativa, o botão "Limpar busca". O foco nesse botão ("bar-clear") é válido: não é puxado de volta.
  // Sem jogos e sem busca (só o filtro sem resultado) não há nada a focar: LB/RB trocam o filtro.
  useEffect(() => {
    if (useUI.getState().modalOpen) return;
    const current: string | null | undefined = getCurrentFocusKey();
    const valid = !!current && doesFocusableExist(current) && (current.startsWith("lib-") || current === "bar-clear");
    if (valid) return;
    if (list.length > 0) setFocus("LIB");
    else if (query.trim()) setFocus("bar-clear");
  }, [list, visible, query]);

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
          view.set({ tabId: cycle(list, i, a === "lb" ? -1 : 1).id });
        } else if (a === "y") {
          const i = indexOf(SORTS.map((s) => s.id), view.sort);
          view.set({ sort: cycle(SORTS, i, 1).id });
        } else if (a === "x") {
          setSearching(true);
        }
      }),
    [],
  );

  const shown = list.slice(0, visible);
  const preferred = libraryFocusKey && shown.some((g) => `lib-${g.id}` === libraryFocusKey) ? libraryFocusKey : undefined;
  const sortLabel = SORTS.find((s) => s.id === sort)?.label;

  const hints: Hint[] = [
    // Só mostra o que tem ação: sem jogos e sem busca ativa não há nada para selecionar.
    ...(list.length > 0 || query.trim() ? [{ btn: "A", label: "Selecionar" } as Hint] : []),
    ...(list.length > 0 ? [{ btn: "Start", label: "Opções do jogo" } as Hint] : []),
    { btn: "X", label: "Buscar" },
    { btn: "Y", label: "Ordenar" },
    // Com busca ativa, o B limpa a busca primeiro (o App trata isso); só depois volta ao Início.
    { btn: "B", label: query.trim() ? "Limpar busca" : "Voltar" },
  ];

  return (
    <div className="screen library">
      <TopBar title="Biblioteca" />

      {/* Barra de filtros: só visual. Filtro = LB/RB, ordem = Y, busca = X. O direcional NÃO entra aqui:
          o único item selecionável da barra é o "✕ Limpar busca", e só existe com uma busca ativa. */}
      <FocusGroup focusKey="LIB-BAR" className="library-bar" preferredChildFocusKey="bar-clear" disabled={!query.trim()}>
        <div className="tabs">
          {/* LB/RB só fazem sentido (e só aparecem) quando há mais de uma aba para alternar. */}
          {tabs.length > 1 && <ButtonGlyph btn="LB" />}
          {tabs.map((t) => (
            <span key={t.id} className={`tab ${t.id === filter ? "is-active" : ""}`}>
              {t.name}
              {config.showCounts && <em> {counts[t.id]}</em>}
            </span>
          ))}
          {tabs.length > 1 && <ButtonGlyph btn="RB" />}
        </div>
        <div className="library-meta">
          {/* Só aparece com uma busca ativa. É o PRIMEIRO item da linha, logo acima do primeiro jogo: ↑ + A limpam a
              busca. Mais rápido ainda: o B, em qualquer lugar da tela, também limpa a busca. */}
          {query.trim() && (
            <Focusable focusKey="bar-clear" className="chip chip-btn chip-clear" scroll={false} onPress={() => set({ query: "" })}>
              ✕ Limpar busca “{query.trim()}”
            </Focusable>
          )}
          {/* Quantidade e ordem ficam sempre à direita; só as abas (acima) ficam centralizadas. */}
          <div className="library-meta-right">
            <span>
              {list.length}
              {list.length !== pool.length ? ` de ${pool.length}` : ""} jogos
            </span>
            <span className="chip">Ordem: {sortLabel}</span>
          </div>
        </div>
      </FocusGroup>

      <FocusGroup focusKey="LIB" className={`library-grid size-${config.cardSize} ${list.length === 0 ? "library-empty" : ""}`} preferredChildFocusKey={preferred} disabled={list.length === 0}>
        {list.length === 0 ? (
          <div className="empty-state">
            <h2>{games.length === 0 ? "Nenhum jogo por aqui ainda" : "Nenhum jogo encontrado"}</h2>
            <p>
              {games.length === 0
                ? mode === "steam" && !keyConfigured
                  ? "Configure a sua conta Steam para listar toda a biblioteca, inclusive os jogos não instalados."
                  : "Sincronize a biblioteca em Configurações › Conta Steam."
                : pool.length === 0
                  ? "Os jogos ocultos na Steam estão sendo escondidos. Mude isso em Configurações › Biblioteca."
                  : query.trim()
                    ? "Nenhum jogo combina com a busca e o filtro atuais. Aperte B para limpar a busca ou X para alterá-la."
                    : "Nenhum jogo combina com o filtro atual. Troque o filtro com LB/RB."}
            </p>
          </div>
        ) : (
          shown.map((g, i) => {
            const key = `lib-${g.id}`;
            return (
              <GameCard
                key={key}
                game={g}
                focusKey={key}
                size={config.cardSize}
                showBadge={config.showBadges}
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

      <Hints items={hints} />

      {searching && (
        <OnScreenKeyboard
          title="Buscar na biblioteca"
          hint="Digite parte do nome do jogo. Deixe em branco para ver todos."
          placeholder="Nome do jogo"
          initial={query}
          maxLength={40}
          confirmLabel="Buscar"
          onCancel={() => setSearching(false)}
          onSubmit={(value) => {
            setSearching(false);
            set({ query: value });
          }}
        />
      )}
    </div>
  );
}
