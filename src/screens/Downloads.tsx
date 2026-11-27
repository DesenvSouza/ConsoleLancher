import { getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonGlyph, Hints, TopBar, noPlayLabel } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup, Focusable } from "../components/Focusable";
import { Setting } from "../components/Setting";
import { compareText, t } from "../i18n";
import { onAction, type VerticalDirection } from "../input/actions";
import { formatBytes, formatClock, formatDuration, formatSpeed, MIN_SPEED, type QueueItem } from "../lib/downloads";
import { GAME_SOURCES, driveOf, parentFolder, type StoreId } from "../lib/stores";
import { cycle, indexOf } from "../lib/util";
import { useDownloads, SHUTDOWN_DELAY_SEC } from "../store/downloads";
import { useEpic } from "../store/epic";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";

const PAGES = [
  { id: "queue", name: "Downloads" },
  { id: "installed", name: "Instalados" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

const SORTS = [
  { id: "size", label: "Maior primeiro" },
  { id: "unplayed", label: "Há mais tempo sem jogar" },
  { id: "name", label: "Nome (A–Z)" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

// A página e a ordenação em que o jogador estava (ao voltar da tela de um jogo, continua ali).
let lastPage: PageId = "queue";
let lastSort: SortId = "size";

const STATE_LABEL: Record<QueueItem["state"], string> = { active: "Baixando", queued: "Na fila", paused: "Pausado", preparing: "Preparando…", installing: "Instalando" };

/** O que dá para fazer com este download, dito no próprio item. */
function nextStep(item: QueueItem): string {
  if (item.isUpdate) return t("Atualização feita pela Steam: não dá para cancelar aqui.");
  if (item.epicClient === "egl") return t("Gerenciado pela Epic Games Launcher: A abre a Epic.");
  if (item.state === "paused") return t("Pausado: retome na loja. A cancela o download.");
  return t("A cancela o download.");
}

/** Downloads em andamento (fila, velocidade, estimativa) e jogos instalados (espaço ocupado, desinstalar). */
/** O atalho "Downloads" do Início sempre abre a fila (e não a última aba visitada, que podia ser "Instalados"). */
export function openDownloadsQueue() {
  lastPage = "queue";
}

export function Downloads() {
  const items = useDownloads((s) => s.items);
  const speed = useDownloads((s) => s.speed);
  const remaining = useDownloads((s) => s.remaining);
  const etaSec = useDownloads((s) => s.etaSec);
  const finishAt = useDownloads((s) => s.finishAt);
  const disks = useDownloads((s) => s.disks);
  const armed = useDownloads((s) => s.shutdownArmed);
  const countdownEndsAt = useDownloads((s) => s.countdownEndsAt);
  const installed = useLibrary((s) => s.installed);
  const epicInstalled = useEpic((s) => s.installed);
  const games = useLibrary((s) => s.games);
  const [page, setPage] = useState<PageId>(lastPage);
  const [sort, setSort] = useState<SortId>(lastSort);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [confirmArm, setConfirmArm] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  /** A página mudou por uma aba (o foco fica na aba, e não pula para a lista). */
  const fromTab = useRef(false);

  // O item saiu da fila (terminou ou mudou) com a confirmação de cancelar aberta: fecha e explica, em vez de ficar com um título vazio.
  useEffect(() => {
    if (cancelId && !items.some((i) => i.appId === cancelId)) {
      setCancelId(null);
      useUI.getState().showToast(t("Este download já mudou: confira a fila."));
    }
  }, [items, cancelId]);

  // Espaço dos discos: ao abrir a página e a cada 10 s.
  useEffect(() => {
    void useDownloads.getState().refreshDisks();
    const t = setInterval(() => void useDownloads.getState().refreshDisks(), 10_000);
    return () => clearInterval(t);
  }, [installed.length, epicInstalled.length]);

  // LB/RB trocam de página; Y troca a ordem dos instalados.
  useEffect(
    () =>
      onAction((a) => {
        if (useUI.getState().modalOpen) return;
        // Start numa linha de "Instalados": desinstalar (com confirmação), sem que o A comum arme uma remoção.
        if (a === "start" && lastPage === "installed") {
          const key = getCurrentFocusKey() ?? "";
          if (!key.startsWith("dl-game-")) return;
          const id = key.slice("dl-game-".length);
          if (useLibrary.getState().runningAppId === id) return useUI.getState().showToast(t("Feche o jogo antes de desinstalar."), "warning");
          useUI.getState().askUninstall(id);
          return;
        }
        if (a === "lb" || a === "rb") {
          setPage((current) => {
            const next = cycle(PAGES, indexOf(PAGES.map((p) => p.id), current), a === "lb" ? -1 : 1).id;
            lastPage = next;
            return next;
          });
        } else if (a === "y" && lastPage === "installed") {
          setSort((current) => {
            const next = cycle(SORTS, indexOf(SORTS.map((s) => s.id), current), 1).id;
            lastSort = next;
            return next;
          });
        }
      }),
    [],
  );

  // Instalados: só os jogos de verdade (nada em download), com o tamanho no disco.
  const rows = useMemo(() => {
    const queued = new Set(items.map((i) => i.appId));
    const list = installed
      .filter((a) => !queued.has(a.appId))
      .map((a) => {
        const game = games.find((g) => g.id === a.appId);
        return { appId: a.appId, store: "steam" as StoreId, title: game?.title ?? a.name, size: a.sizeOnDisk, lastPlayedAt: game?.lastPlayedAt, libraryPath: a.libraryPath };
      });
    for (const a of epicInstalled) {
      const id = `epic:${a.appName}`;
      if (a.incomplete || queued.has(id)) continue;
      const game = games.find((g) => g.id === id);
      list.push({ appId: id, store: "epic" as StoreId, title: game?.title ?? a.title, size: a.sizeBytes, lastPlayedAt: game?.lastPlayedAt, libraryPath: parentFolder(a.installLocation) });
    }
    switch (sort) {
      case "name":
        return list.sort((a, b) => compareText(a.title, b.title));
      case "unplayed":
        // Quem nunca foi jogado (ou foi há mais tempo) vem primeiro: são os melhores candidatos a liberar espaço.
        return list.sort((a, b) => (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0) || b.size - a.size);
      default:
        return list.sort((a, b) => b.size - a.size);
    }
  }, [installed, epicInstalled, games, items, sort]);
  const totalInstalled = rows.reduce((sum, r) => sum + r.size, 0);
  /** Um cartão por disco: as pastas de bibliotecas (Steam, Epic…) que dividem o mesmo disco aparecem juntas. */
  const driveCards = useMemo(() => {
    const cards = new Map<string, { drive: string; free: number; total: number; folders: string[] }>();
    for (const d of disks) {
      const drive = driveOf(d.path);
      const card = cards.get(drive) ?? { drive, free: d.free, total: d.total, folders: [] };
      card.folders.push(d.path);
      cards.set(drive, card);
    }
    return [...cards.values()];
  }, [disks]);
  /** Quanto cada loja ocupa (só mostra as lojas que têm jogo instalado). */
  const perStore = useMemo(() => {
    const totals = new Map<StoreId, { size: number; count: number }>();
    for (const r of rows) {
      const entry = totals.get(r.store) ?? { size: 0, count: 0 };
      totals.set(r.store, { size: entry.size + r.size, count: entry.count + 1 });
    }
    return [...totals.entries()];
  }, [rows]);
  const installedSizesKnown = rows.every((r) => r.size > 0);
  const firstInstalled = rows[0] ? `dl-game-${rows[0].appId}` : undefined;

  const restoreInstalledTop = () => {
    // O resumo de discos fica acima do primeiro item focável e só reaparece inteiro ao voltar ao cabeçalho.
    const focus = getCurrentFocusKey();
    if (focus?.startsWith("dl-tab-") || focus?.startsWith("nav-")) {
      screenRef.current?.querySelector(".dl-page")?.scrollTo({ top: 0, behavior: "instant" });
    }
  };
  const enterInstalled = (direction: VerticalDirection) => {
    if (direction !== "down" || !firstInstalled) return false;
    setFocus(firstInstalled, { viaDirection: true });
    return true;
  };
  const focusInstalledTab = (direction: VerticalDirection) => {
    if (direction !== "up") return false;
    setFocus("dl-tab-installed", { viaDirection: true });
    return true;
  };

  // Foco: o primeiro item da página. Na fila vazia fica na aba: o desligamento programado nunca fica selecionado de saída
  // (um A distraído o ligaria).
  useEffect(() => {
    if (useUI.getState().modalOpen) return;
    if (fromTab.current) {
      fromTab.current = false;
      return;
    }
    setFocus(page === "queue" ? (items.length > 0 ? `dl-item-${items[0].appId}` : "dl-tab-queue") : firstInstalled ?? "dl-none");
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelItem = items.find((i) => i.appId === cancelId);
  const hasEpicDownloads = items.some((it) => it.epicClient);
  // Fila mista: o que se sabe aparece, dizendo de onde vem (a Epic nem sempre informa tamanho, velocidade ou estimativa).
  const sized = items.filter((it) => it.total > 0);
  const partialSizes = sized.length > 0 && sized.length < items.length;
  const hasSteamDownloads = items.some((it) => !it.epicClient);
  const steamOnlyNumbers = hasEpicDownloads && hasSteamDownloads;
  const steamLast = [...items].reverse().find((it) => !it.epicClient && it.etaSec !== null && it.finishAt !== null);
  const shownEta = hasEpicDownloads ? steamLast?.etaSec ?? null : etaSec;
  const shownFinish = hasEpicDownloads ? steamLast?.finishAt ?? null : finishAt;
  const onlySteam = (label: string) => (steamOnlyNumbers ? t("{label} (Steam)", { label }) : label);

  return (
    <div ref={screenRef} className="screen settings downloads">
      <TopBar title={t("Downloads e jogos instalados")} current="downloads" />

      <FocusGroup focusKey="dl-tabs" className="tabs settings-tabs">
        <ButtonGlyph btn="LB" />
        {PAGES.map((p) => (
          <Focusable
            key={p.id}
            focusKey={`dl-tab-${p.id}`}
            className={`tab ${p.id === page ? "is-active" : ""}`}
            scroll={false}
            onVerticalPress={page === "installed" ? enterInstalled : undefined}
            onPress={() => {
              if (p.id === page) return;
              fromTab.current = true;
              lastPage = p.id;
              setPage(p.id);
            }}
          >
            {t(p.name)}
            <em> {p.id === "queue" ? items.length : rows.length}</em>
          </Focusable>
        ))}
        <ButtonGlyph btn="RB" />
      </FocusGroup>

      {page === "queue" ? (
        <FocusGroup key="queue" focusKey="dl-queue" className="settings-list settings-page dl-page" preferredChildFocusKey={items.length > 0 ? `dl-item-${items[0].appId}` : undefined}>
          {/* Com a fila vazia, a mensagem vem primeiro: números e desligamento só aparecem quando há o que medir. */}
          {items.length > 0 && <dl className="dl-summary" aria-label={t("Resumo")}>
            <div>
              <dt>{onlySteam(t("Velocidade"))}</dt>
              <dd>{hasEpicDownloads && !hasSteamDownloads ? "—" : formatSpeed(speed)}</dd>
            </div>
            <div>
              <dt>{partialSizes ? t("Falta baixar (parcial)") : t("Falta baixar")}</dt>
              <dd>{sized.length > 0 ? formatBytes(remaining) : "—"}</dd>
            </div>
            <div>
              <dt>{onlySteam(t("Termina em"))}</dt>
              <dd>{shownEta !== null ? formatDuration(shownEta) : !hasEpicDownloads && items.length > 0 && speed < MIN_SPEED ? t("calculando…") : "—"}</dd>
            </div>
            <div>
              <dt>{onlySteam(t("Horário previsto"))}</dt>
              <dd>{shownFinish !== null ? formatClock(shownFinish) : "—"}</dd>
            </div>
          </dl>}
          {items.length > 0 && (partialSizes || steamOnlyNumbers) && <p className="dl-note">{t("Números parciais: a Epic nem sempre informa tamanho, velocidade ou previsão.")}</p>}

          {(items.length > 0 || armed || countdownEndsAt !== null) && <Setting
            cycle
            id="dl-shutdown"
            label={t("Desligar o PC ao concluir os downloads")}
            hint={
              countdownEndsAt !== null
                ? t("Desligando: a contagem está rodando")
                : armed
                  ? items.length > 0
                    ? t("Quando a fila acabar, o PC desliga em {n} s (dá tempo de cancelar)", { n: SHUTDOWN_DELAY_SEC })
                    : t("Programado: vale a partir do próximo download")
                  : t("Desliga {n} s depois que toda a fila terminar", { n: SHUTDOWN_DELAY_SEC })
            }
            value={armed ? t("Ligado") : t("Desligado")}
            onStep={() => (armed ? useDownloads.getState().setShutdownArmed(false) : items.length > 0 ? setConfirmArm(true) : useDownloads.getState().setShutdownArmed(true))}
          />}

          <h3 className="settings-title">{t("Fila")}</h3>
          {items.length === 0 ? (
            <p className="dl-empty">{t("Nenhum download na fila. Quando você instalar ou atualizar um jogo, ele aparece aqui.")}</p>
          ) : (
            items.map((it) => {
              const fraction = it.total > 0 ? it.done / it.total : it.progress;
              const pct = fraction === undefined ? undefined : Math.min(100, Math.round(fraction * 100));
              const selectDownload = () => {
                if (it.isUpdate) {
                  useUI.getState().showToast(t("Atualizações são feitas pela Steam e não podem ser canceladas aqui."));
                } else if (it.epicClient === "egl") {
                  useLibrary.getState().cancelInstall(it.appId);
                } else {
                  setCancelId(it.appId);
                }
              };
              return (
                <Focusable key={it.appId} focusKey={`dl-item-${it.appId}`} className="setting dl-item" onPress={selectDownload}>
                  <div className="dl-item-head">
                    <span className="dl-title">{it.title}</span>
                    {it.isUpdate && <span className="chip dl-update">{t("Atualização")}</span>}
                    <span className={`chip dl-state dl-${it.state}`}>{t(STATE_LABEL[it.state])}</span>
                  </div>
                  {(!it.epicClient || pct !== undefined) && (
                    <>
                      <div className="dl-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div style={{ width: `${pct ?? 0}%` }} />
                      </div>
                      <div className="dl-item-foot">
                        <span>{it.total > 0 ? t("{done} de {total} · {pct}%", { done: formatBytes(it.done), total: formatBytes(it.total), pct: pct ?? 0 }) : pct !== undefined ? t("{pct}%", { pct }) : t("Preparando…")}</span>
                        <span>{it.etaSec !== null && it.finishAt !== null ? t("{eta} · conclui {time}", { eta: formatDuration(it.etaSec), time: formatClock(it.finishAt) }) : ""}</span>
                      </div>
                    </>
                  )}
                  <p className="dl-next">{nextStep(it)}</p>
                </Focusable>
              );
            })
          )}
        </FocusGroup>
      ) : (
        <FocusGroup key="installed" focusKey="dl-installed" className="settings-list settings-page dl-page" preferredChildFocusKey={firstInstalled} onBlur={restoreInstalledTop} disabled={rows.length === 0}>
          {driveCards.length > 0 && (
            <section className="dl-disks" aria-label={t("Discos")}>
              {driveCards.map((d) => {
                const here = rows.filter((r) => driveOf(r.libraryPath) === d.drive);
                const mine = here.reduce((sum, r) => sum + r.size, 0);
                const hereByStore = [...new Set(here.map((r) => r.store))].map((store) => [store, here.filter((r) => r.store === store).reduce((sum, r) => sum + r.size, 0)] as const);
                const other = Math.max(0, d.total - d.free - mine);
                // Jogos sem tamanho informado ocupam espaço que não dá para separar dos "outros arquivos".
                const unknownOf = (store: StoreId) => here.filter((r) => r.store === store && r.size <= 0).length;
                const unknownHere = here.some((r) => r.size <= 0);
                const pct = (n: number) => `${d.total > 0 ? (n / d.total) * 100 : 0}%`;
                return (
                  <div key={d.drive} className="dl-disk">
                    <div className="dl-disk-head">
                      <span>{d.folders.length === 1 ? d.folders[0] : `${d.drive}\\`}</span>
                      <span>
                        {t("{free} livres de {total}", { free: formatBytes(d.free), total: formatBytes(d.total) })}
                      </span>
                    </div>
                    <div className="dl-disk-bar" aria-hidden>
                      {hereByStore.map(([store, size]) => (
                        <div key={store} className={`dl-disk-games dl-store-${store}`} style={{ width: pct(size) }} />
                      ))}
                      <div className="dl-disk-other" style={{ width: pct(other) }} />
                    </div>
                    {d.folders.length > 1 && <div className="dl-disk-folders">{d.folders.join("   ·   ")}</div>}
                    <div className="dl-disk-legend">
                      {(hereByStore.length > 0 ? hereByStore : [["steam" as StoreId, 0] as const]).map(([store, size]) => (
                        <span key={store}><i className={`dl-dot dl-store-${store}`} /> {t("Jogos da {store}:", { store: t(GAME_SOURCES[store].label) })} {size > 0 || unknownOf(store) === 0 ? formatBytes(size) : t("tamanho não informado")}{size > 0 && unknownOf(store) > 0 ? ` + ${t("{n} sem tamanho", { n: unknownOf(store) })}` : ""}</span>
                      ))}
                      <span><i className="dl-dot dl-dot-other" /> {unknownHere ? t("Outros arquivos e jogos sem tamanho:") : t("Outros arquivos:")} {formatBytes(other)}</span>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          <div className="dl-list-head">
            <h3 className="settings-title">
              {rows.length === 1 ? t("1 jogo instalado") : t("{n} jogos instalados", { n: rows.length })}
              {installedSizesKnown && rows.length > 0 && ` · ${formatBytes(totalInstalled)}`}
            </h3>
            <span className="chip">{t("Ordem: {sort}", { sort: t(SORTS.find((s) => s.id === sort)?.label ?? "") })}</span>
          </div>
          {perStore.length > 1 && (
            <div className="dl-stores" aria-label={t("Por loja")}>
              {perStore.map(([store, total]) => (
                <span key={store} className="chip dl-store-chip">
                  {GAME_SOURCES[store].icon && <img src={GAME_SOURCES[store].icon} alt="" draggable={false} />}
                  {t(GAME_SOURCES[store].label)} · {total.count === 1 ? t("1 jogo") : t("{n} jogos", { n: total.count })}
                  {installedSizesKnown && ` · ${formatBytes(total.size)}`}
                </span>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <Focusable focusKey="dl-none" className="setting" onPress={() => {}}>
              <span>{t("Nenhum jogo instalado.")}</span>
            </Focusable>
          ) : (
            rows.map((r, index) => {
              const pct = totalInstalled > 0 ? Math.max(1, Math.round((r.size / totalInstalled) * 100)) : 0;
              return (
                <Focusable
                  key={r.appId}
                  focusKey={`dl-game-${r.appId}`}
                  className="setting dl-item dl-game"
                  onVerticalPress={index === 0 ? focusInstalledTab : undefined}
                  onPress={() => useUI.getState().navigate({ name: "detail", gameId: r.appId })}
                >
                  <div className="dl-item-head">
                    <span className="dl-title">
                      {perStore.length > 1 && GAME_SOURCES[r.store].icon && <img className="dl-store-icon" src={GAME_SOURCES[r.store].icon} alt={t(GAME_SOURCES[r.store].label)} title={t(GAME_SOURCES[r.store].label)} draggable={false} />}
                      {r.title}
                    </span>
                    <span className="dl-size">{r.size > 0 ? formatBytes(r.size) : t("Tamanho não informado")}</span>
                  </div>
                  {installedSizesKnown && (
                    <div className="dl-bar dl-bar-thin" aria-hidden>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <div className="dl-item-foot">
                    <span>{noPlayLabel({ source: r.store, lastPlayedAt: r.lastPlayedAt })}</span>
                    {installedSizesKnown && <span>{t("{pct}% do espaço dos jogos", { pct })}</span>}
                  </div>
                </Focusable>
              );
            })
          )}
        </FocusGroup>
      )}

      <Hints
        items={[
          ...(page === "queue" || rows.length > 0 ? [{ btn: "A", label: page === "queue" ? "Selecionar" : "Abrir" } as const] : []),
          ...(page === "installed" && rows.length > 0 ? [{ btn: "Start", label: "Desinstalar" } as const] : []),
          { btn: "LB", label: "Seção anterior" },
          { btn: "RB", label: "Próxima seção" },
          ...(page === "installed" ? [{ btn: "Y", label: "Ordenar" } as const] : []),
          { btn: "B", label: "Voltar" },
        ]}
      />

      {confirmArm && (
        <ConfirmDialog
          title={t("Desligar o PC ao concluir os downloads?")}
          message={t("Vale só para os downloads que estão na fila agora e só se todos terminarem bem; se algum for cancelado, nada é desligado. O PC desliga {n} s depois, e dá tempo de cancelar.", { n: SHUTDOWN_DELAY_SEC })}
          confirmLabel={t("Programar o desligamento")}
          cancelLabel={t("Não desligar")}
          onCancel={() => setConfirmArm(false)}
          onConfirm={() => {
            setConfirmArm(false);
            useDownloads.getState().setShutdownArmed(true);
          }}
        />
      )}

      {cancelItem && (
        <ConfirmDialog
          title={t("Cancelar o download de {title}?", { title: cancelItem.title })}
          message={cancelItem.epicClient === "legendary" ? t("Você poderá retomar o download ao instalar o jogo novamente.") : t("O que já foi baixado deste jogo será apagado.")}
          confirmLabel={t("Cancelar o download")}
          danger
          onCancel={() => setCancelId(null)}
          onConfirm={() => {
            const id = cancelId;
            setCancelId(null);
            if (id) useLibrary.getState().cancelInstall(id);
          }}
        />
      )}
    </div>
  );
}
