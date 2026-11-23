import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonGlyph, Hints, TopBar, gameSubtitle, type Hint } from "../components/Chrome";
import { FocusGroup } from "../components/Focusable";
import { t } from "../i18n";
import { homeRows } from "../lib/homeRows";
import { GameCard } from "../components/GameCard";
import { ScreenBackground } from "../components/ScreenBackground";
import type { Game } from "../lib/types";
import { BLOCK_TITLES, useHome } from "../store/home";
import { useLibrary } from "../store/library";
import { useNotInstalled } from "../store/notInstalled";
import { useUI } from "../store/ui";

/** Cards desenhados de início em cada fileira (cobre a largura da tela com folga), quanto ganha a cada vez e a antecedência. */
const ROW_BASE = 16;
const ROW_STEP = 16;
const ROW_LOOK = 6;
/** Em blocos de grade (várias linhas) um passo é maior. */
const GRID_BASE = 36;

/** Rola a área das fileiras até a fileira indicada ficar no topo (título incluído). */
function alignRowToTop(blockId: string, smooth: boolean) {
  const area = document.querySelector<HTMLElement>(".rows");
  const row = document.getElementById(`sec-${blockId}`);
  if (!area || !row) return;
  const padTop = parseFloat(getComputedStyle(area).paddingTop) || 0;
  area.scrollTo({ top: Math.max(0, row.offsetTop - padTop), behavior: smooth ? "smooth" : "instant" });
}

export function Home() {
  const games = useLibrary((s) => s.games);
  const mode = useLibrary((s) => s.mode);
  const keyStatus = useLibrary((s) => s.keyStatus);
  const { blocks, showHero, rowMode } = useHome();
  const hideNotInstalled = useNotInstalled((n) => n.hideFromHome);
  const single = rowMode === "one";
  const navigate = useUI((s) => s.navigate);
  const homeFocusKey = useUI((s) => s.homeFocusKey);
  const modalOpen = useUI((s) => s.modalOpen);
  const setHomeFocusKey = useUI((s) => s.setHomeFocusKey);
  const setFocusedGame = useUI((s) => s.setFocusedGame);

  const rows = useMemo(() => homeRows(blocks, games, hideNotInstalled), [blocks, games, hideNotInstalled]);

  const [focusedId, setFocusedId] = useState<string>("");
  /** Fileira onde está o foco. No modo "uma por vez", só ela fica visível. */
  const [activeRow, setActiveRow] = useState<string>("");
  const hero = games.find((g) => g.id === focusedId) ?? rows[0]?.games[0];
  const currentRow = rows.some((r) => r.block.id === activeRow) ? activeRow : rows[0]?.block.id;

  // Ao voltar de outra tela (Configurações, detalhes) a Home é desenhada do zero, com as fileiras roladas para o
  // começo, e o foco volta ao jogo em que estávamos. Se essa rolagem fosse animada, pareceria uma "corrida" do
  // início até o jogo. Por isso, nos primeiros instantes, a rolagem é instantânea; depois, volta a ser suave.
  const settled = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => (settled.current = true), 700);
    return () => clearTimeout(t);
  }, []);
  const isSmooth = () => settled.current;

  // Quantos cards de cada fileira estão desenhados. Antes a Home desenhava TODOS os jogos de TODAS as fileiras (mais
  // de 300 cards, até os das fileiras escondidas), e montar isso levava ~200 ms: a animação de entrada da tela
  // já tinha passado quando o primeiro quadro aparecia, e ela ficava "seca". Agora cada fileira começa com
  // poucos cards e ganha mais conforme o foco chega perto do fim (como na Biblioteca).
  const [limits, setLimits] = useState<Record<string, number>>({});
  const limitFor = (blockId: string, style: string, list: Game[]) => {
    let limit = limits[blockId] ?? (style === "grid" ? GRID_BASE : ROW_BASE);
    // Ao voltar de outra tela, o card em que o jogador estava precisa estar desenhado.
    if (homeFocusKey?.startsWith(`card-${blockId}-`)) {
      const at = list.findIndex((g) => `card-${blockId}-${g.id}` === homeFocusKey);
      if (at >= 0) limit = Math.max(limit, at + 1 + ROW_LOOK);
    }
    return limit;
  };

  const empty = rows.length === 0;
  // O último card visitado só serve se ele ainda existe (a lista muda: sincronização, desinstalar...).
  // Apontar o grupo para uma chave que sumiu deixa a Home sem nenhum foco e as setas param de funcionar.
  const preferredCard =
    homeFocusKey && rows.some((r) => r.games.some((g) => `card-${r.block.id}-${g.id}` === homeFocusKey)) ? homeFocusKey : undefined;
  // Só mostra os botões que têm ação: sem jogos, abrir e "opções do jogo" não fazem nada.
  const hints: Hint[] = [
    ...(empty ? [] : [{ btn: "A", label: "Abrir" } as Hint, { btn: "Start", label: "Opções do jogo" } as Hint]),
    { btn: "X", label: "Biblioteca" },
    { btn: "Y", label: "Downloads" },
    { btn: "Select", label: "Configurações" },
  ];

  // Garante que um card tenha o foco. Ao abrir o app a biblioteca ainda está carregando (a Home nasce vazia) e,
  // quando os jogos chegam, ninguém tinha o foco. Também cobre o card focado sumir da lista (ex.: desinstalou).
  // O grupo restaura o último card visitado (preferredChildFocusKey).
  useEffect(() => {
    if (empty || modalOpen) return;
    // Atenção: no início nada tem foco e a biblioteca devolve null (apesar do tipo dizer string).
    const current: string | null | undefined = getCurrentFocusKey();
    if (!current || !current.startsWith("card-") || !doesFocusableExist(current)) setFocus("HOME");
  }, [empty, rows, modalOpen]);

  return (
    <div className="screen home">
      <ScreenBackground game={hero} />
      <TopBar title={t("Início")} />

      {showHero && hero && (
        <section className="hero">
          {hero && (
            <>
              <h1>{hero.title}</h1>
              <p className="hero-meta">{gameSubtitle(hero)}</p>
              {hero.description && <p className="hero-desc">{hero.description}</p>}
            </>
          )}
        </section>
      )}

      <FocusGroup
        focusKey="HOME"
        className={`rows ${empty ? "rows-empty" : single ? "rows-single" : ""}`}
        preferredChildFocusKey={preferredCard}
      >
        {empty && <EmptyState noGames={games.length === 0} steamMode={mode === "steam"} keyConfigured={!!keyStatus?.configured} />}
        {rows.map(({ block, games: list }) => (
          <section key={block.id} id={`sec-${block.id}`} className={`row ${block.id === currentRow ? "row-active" : ""}`}>
            <h2>{t(BLOCK_TITLES[block.kind])}</h2>
            <FocusGroup focusKey={`row-${block.id}`} className={`row-track ${block.style === "grid" ? "grid" : ""}`}>
              {list.slice(0, limitFor(block.id, block.style, list)).map((g, i, drawn) => {
                const key = `card-${block.id}-${g.id}`;
                return (
                  <GameCard
                    key={key}
                    game={g}
                    focusKey={key}
                    variant={block.style}
                    size={block.size}
                    // Uma fileira por vez: a tela alinha a fileira ao topo e o card só rola na horizontal.
                    // Grades (várias linhas) continuam com a rolagem normal para o card focado.
                    scroll={single && block.style !== "grid" ? "x" : true}
                    smooth={isSmooth}
                    onFocus={() => {
                      setFocusedId(g.id);
                      setFocusedGame(g.id);
                      setHomeFocusKey(key);
                      setActiveRow(block.id);
                      if (single && block.style !== "grid") alignRowToTop(block.id, isSmooth());
                      // Perto do fim do que está desenhado: desenha mais cards desta fileira.
                      if (i >= drawn.length - ROW_LOOK && drawn.length < list.length) {
                        setLimits((l) => ({ ...l, [block.id]: Math.max(l[block.id] ?? drawn.length, drawn.length) + (block.style === "grid" ? GRID_BASE : ROW_STEP) }));
                      }
                    }}
                    onPress={() => navigate({ name: "detail", gameId: g.id })}
                  />
                );
              })}
            </FocusGroup>
          </section>
        ))}
      </FocusGroup>

      <Hints items={hints} />
    </div>
  );
}

/** Home sem nenhum jogo: mensagem centralizada dizendo o que fazer. */
function EmptyState({ noGames, steamMode, keyConfigured }: { noGames: boolean; steamMode: boolean; keyConfigured: boolean }) {
  const steamEmpty = noGames && steamMode;
  const title = steamEmpty ? t("Nenhum jogo por aqui ainda") : t("Nenhum jogo para mostrar");
  const text = steamEmpty
    ? keyConfigured
      ? t("Sua conta está configurada, mas a biblioteca ainda não foi sincronizada. Abra Conta Steam e use \"Sincronizar biblioteca agora\".")
      : t("Nenhum jogo instalado foi encontrado. Para ver toda a sua biblioteca, inclusive os não instalados, entre na sua conta Steam.")
    : t("Todas as fileiras da página inicial estão ocultas ou vazias. Ative-as em Configurações › Página inicial.");

  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{text}</p>
      <p className="empty-hint">
        <ButtonGlyph btn="Select" />
        {steamEmpty ? t("Abra as Configurações › Conta Steam") : t("Abra as Configurações › Página inicial")}
      </p>
    </div>
  );
}
