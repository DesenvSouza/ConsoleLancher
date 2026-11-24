import { getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonGlyph, Hints, TopBar, formatLastPlayed } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup, Focusable } from "../components/Focusable";
import { Setting } from "../components/Setting";
import { compareText, t } from "../i18n";
import { onAction, type VerticalDirection } from "../input/actions";
import { formatBytes, formatClock, formatDuration, formatSpeed, MIN_SPEED, type QueueItem } from "../lib/downloads";
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
  }, [installed.length]);

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
        return { appId: a.appId, title: game?.title ?? a.name, size: a.sizeOnDisk, lastPlayedAt: game?.lastPlayedAt, libraryPath: a.libraryPath };
      });
    for (const a of epicInstalled) {
      const id = `epic:${a.appName}`;
      if (a.incomplete || queued.has(id)) continue;
      const game = games.find((g) => g.id === id);
      list.push({ appId: id, title: game?.title ?? a.title, size: a.sizeBytes, lastPlayedAt: game?.lastPlayedAt, libraryPath: "" });
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

  // Foco: o primeiro item da página. Na fila vazia é uma ação neutra ("Abrir a Biblioteca"): o desligamento programado nunca
  // fica selecionado de saída (um A distraído o ligaria).
  useEffect(() => {
    if (useUI.getState().modalOpen) return;
    if (fromTab.current) {
      fromTab.current = false;
      return;
    }
    setFocus(page === "queue" ? (items.length > 0 ? `dl-item-${items[0].appId}` : "dl-open-library") : firstInstalled ?? "dl-none");
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelItem = items.find((i) => i.appId === cancelId);
  const hasEpicDownloads = items.some((it) => it.epicClient);
  const hasDownloadSizes = items.length > 0 && items.every((it) => it.total > 0);

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
        <FocusGroup key="queue" focusKey="dl-queue" className="settings-list settings-page dl-page" preferredChildFocusKey={items.length > 0 ? `dl-item-${items[0].appId}` : "dl-open-library"}>
          <dl className="dl-summary" aria-label={t("Resumo")}>
            <div>
              <dt>{t("Velocidade")}</dt>
              <dd>{hasEpicDownloads ? "—" : formatSpeed(speed)}</dd>
            </div>
            <div>
              <dt>{t("Falta baixar")}</dt>
              <dd>{hasDownloadSizes ? formatBytes(remaining) : "—"}</dd>
            </div>
            <div>
              <dt>{t("Termina em")}</dt>
              <dd>{hasEpicDownloads ? "—" : etaSec !== null ? formatDuration(etaSec) : items.length > 0 && speed < MIN_SPEED ? t("calculando…") : "—"}</dd>
            </div>
            <div>
              <dt>{t("Horário previsto")}</dt>
              <dd>{!hasEpicDownloads && finishAt !== null ? formatClock(finishAt) : "—"}</dd>
            </div>
          </dl>

          <Setting
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
          />

          <h3 className="settings-title">{t("Fila")}</h3>
          {items.length === 0 ? (
            <>
              <p className="dl-empty">{t("Nenhum download na fila. Quando você instalar ou atualizar um jogo, ele aparece aqui.")}</p>
              <Focusable focusKey="dl-open-library" className="btn dl-empty-action" scroll={false} onPress={() => useUI.getState().goTo("library")}>{t("Abrir a Biblioteca")}</Focusable>
            </>
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
                </Focusable>
              );
            })
          )}
        </FocusGroup>
      ) : (
        <FocusGroup key="installed" focusKey="dl-installed" className="settings-list settings-page dl-page" preferredChildFocusKey={firstInstalled} onBlur={restoreInstalledTop} disabled={rows.length === 0}>
          {disks.length > 0 && (
            <section className="dl-disks" aria-label={t("Discos")}>
              {disks.map((d) => {
                const mine = rows.filter((r) => r.libraryPath === d.path).reduce((sum, r) => sum + r.size, 0);
                const other = Math.max(0, d.total - d.free - mine);
                const pct = (n: number) => `${d.total > 0 ? (n / d.total) * 100 : 0}%`;
                return (
                  <div key={d.path} className="dl-disk">
                    <div className="dl-disk-head">
                      <span>{d.path}</span>
                      <span>
                        {t("{free} livres de {total}", { free: formatBytes(d.free), total: formatBytes(d.total) })}
                      </span>
                    </div>
                    <div className="dl-disk-bar" aria-hidden>
                      <div className="dl-disk-games" style={{ width: pct(mine) }} />
                      <div className="dl-disk-other" style={{ width: pct(other) }} />
                    </div>
                    <div className="dl-disk-legend">
                      <span><i className="dl-dot dl-dot-games" /> {t("Jogos da Steam:")} {formatBytes(mine)}</span>
                      <span><i className="dl-dot dl-dot-other" /> {t("Outros arquivos:")} {formatBytes(other)}</span>
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
                    <span className="dl-title">{r.title}</span>
                    <span className="dl-size">{r.size > 0 ? formatBytes(r.size) : "—"}</span>
                  </div>
                  {installedSizesKnown && (
                    <div className="dl-bar dl-bar-thin" aria-hidden>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <div className="dl-item-foot">
                    <span>{r.lastPlayedAt ? t("Jogado {when}", { when: formatLastPlayed(r.lastPlayedAt).toLowerCase() }) : t("Nunca jogado")}</span>
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
