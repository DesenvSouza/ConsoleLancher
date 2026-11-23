import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useMemo, useState } from "react";
import { ButtonGlyph, Hints, TopBar, formatLastPlayed } from "../components/Chrome";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FocusGroup, Focusable } from "../components/Focusable";
import { Setting } from "../components/Setting";
import { compareText, t } from "../i18n";
import { onAction } from "../input/actions";
import { formatBytes, formatClock, formatDuration, formatSpeed, MIN_SPEED, type QueueItem } from "../lib/downloads";
import { cycle, indexOf } from "../lib/util";
import { useDownloads, SHUTDOWN_DELAY_SEC } from "../store/downloads";
import { useLibrary } from "../store/library";
import { useUI } from "../store/ui";

const PAGES = [
  { id: "queue", name: "Downloads" },
  { id: "installed", name: "Instalados" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

const SORTS = [
  { id: "size", label: "Maior primeiro" },
  { id: "unplayed", label: "Menos jogados primeiro" },
  { id: "name", label: "Nome (A–Z)" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

// A página e a ordenação em que o jogador estava (ao voltar da tela de um jogo, continua ali).
let lastPage: PageId = "queue";
let lastSort: SortId = "size";

const STATE_LABEL: Record<QueueItem["state"], string> = { active: "Baixando", queued: "Na fila", paused: "Pausado" };

/** Downloads em andamento (fila, velocidade, estimativa) e jogos instalados (espaço ocupado, desinstalar). */
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
  const games = useLibrary((s) => s.games);
  const runningAppId = useLibrary((s) => s.runningAppId);
  const [page, setPage] = useState<PageId>(lastPage);
  const [sort, setSort] = useState<SortId>(lastSort);
  const [cancelId, setCancelId] = useState<string | null>(null);

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
    switch (sort) {
      case "name":
        return list.sort((a, b) => compareText(a.title, b.title));
      case "unplayed":
        // Quem nunca foi jogado (ou foi há mais tempo) vem primeiro: são os melhores candidatos a liberar espaço.
        return list.sort((a, b) => (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0) || b.size - a.size);
      default:
        return list.sort((a, b) => b.size - a.size);
    }
  }, [installed, games, items, sort]);
  const totalInstalled = rows.reduce((sum, r) => sum + r.size, 0);

  // Foco: o primeiro item da página (na fila vazia, a opção de desligamento).
  useEffect(() => {
    if (useUI.getState().modalOpen) return;
    setFocus(page === "queue" ? "set-dl-shutdown" : rows.length > 0 ? `dl-game-${rows[0].appId}` : "dl-none");
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const askUninstall = (appId: string) => {
    const ui = useUI.getState();
    if (runningAppId === appId) return ui.showToast(t("Feche o jogo antes de desinstalar."), "warning");
    ui.askUninstall(appId);
  };

  const cancelTitle = items.find((i) => i.appId === cancelId)?.title ?? "";

  return (
    <div className="screen settings downloads">
      <TopBar title={t("Downloads e jogos instalados")} />

      <nav className="tabs settings-tabs" aria-label={t("Seções")}>
        <ButtonGlyph btn="LB" />
        {PAGES.map((p) => (
          <span key={p.id} className={`tab ${p.id === page ? "is-active" : ""}`}>
            {t(p.name)}
            <em> {p.id === "queue" ? items.length : rows.length}</em>
          </span>
        ))}
        <ButtonGlyph btn="RB" />
      </nav>

      {page === "queue" ? (
        <FocusGroup key="queue" focusKey="dl-queue" className="settings-list settings-page dl-page" preferredChildFocusKey="set-dl-shutdown">
          <dl className="dl-summary" aria-label={t("Resumo")}>
            <div>
              <dt>{t("Velocidade")}</dt>
              <dd>{items.length > 0 ? formatSpeed(speed) : "—"}</dd>
            </div>
            <div>
              <dt>{t("Falta baixar")}</dt>
              <dd>{items.length > 0 ? formatBytes(remaining) : "—"}</dd>
            </div>
            <div>
              <dt>{t("Termina em")}</dt>
              <dd>{etaSec !== null ? formatDuration(etaSec) : items.length > 0 ? (speed < MIN_SPEED ? t("calculando…") : "—") : "—"}</dd>
            </div>
            <div>
              <dt>{t("Horário previsto")}</dt>
              <dd>{finishAt !== null ? formatClock(finishAt) : "—"}</dd>
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
            onStep={() => useDownloads.getState().setShutdownArmed(!armed)}
          />

          <h3 className="settings-title">{t("Fila")}</h3>
          {items.length === 0 ? (
            <p className="dl-empty">{t("Nenhum download na fila. Quando você instalar ou atualizar um jogo, ele aparece aqui.")}</p>
          ) : (
            items.map((it) => {
              const pct = it.total > 0 ? Math.min(100, Math.round((it.done / it.total) * 100)) : 0;
              return (
                <Focusable key={it.appId} focusKey={`dl-item-${it.appId}`} className="setting dl-item" onPress={() => setCancelId(it.appId)}>
                  <div className="dl-item-head">
                    <span className="dl-title">{it.title}</span>
                    <span className={`chip dl-state dl-${it.state}`}>{t(STATE_LABEL[it.state])}</span>
                  </div>
                  <div className="dl-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  <div className="dl-item-foot">
                    <span>{it.total > 0 ? t("{done} de {total} · {pct}%", { done: formatBytes(it.done), total: formatBytes(it.total), pct }) : t("Preparando…")}</span>
                    <span>{it.etaSec !== null && it.finishAt !== null ? t("{eta} · conclui {time}", { eta: formatDuration(it.etaSec), time: formatClock(it.finishAt) }) : ""}</span>
                  </div>
                </Focusable>
              );
            })
          )}
        </FocusGroup>
      ) : (
        <FocusGroup key="installed" focusKey="dl-installed" className="settings-list settings-page dl-page" preferredChildFocusKey={rows[0] ? `dl-game-${rows[0].appId}` : undefined} disabled={rows.length === 0}>
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
              {rows.length === 1 ? t("1 jogo instalado") : t("{n} jogos instalados", { n: rows.length })} · {formatBytes(totalInstalled)}
            </h3>
            <span className="chip">{t("Ordem: {sort}", { sort: t(SORTS.find((s) => s.id === sort)?.label ?? "") })}</span>
          </div>

          {rows.length === 0 ? (
            <Focusable focusKey="dl-none" className="setting" onPress={() => {}}>
              <span>{t("Nenhum jogo instalado.")}</span>
            </Focusable>
          ) : (
            rows.map((r) => {
              const pct = totalInstalled > 0 ? Math.max(1, Math.round((r.size / totalInstalled) * 100)) : 0;
              return (
                <Focusable key={r.appId} focusKey={`dl-game-${r.appId}`} className="setting dl-item dl-game" onPress={() => askUninstall(r.appId)}>
                  <div className="dl-item-head">
                    <span className="dl-title">{r.title}</span>
                    <span className="dl-size">{formatBytes(r.size)}</span>
                  </div>
                  <div className="dl-bar dl-bar-thin" aria-hidden>
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  <div className="dl-item-foot">
                    <span>{r.lastPlayedAt ? t("Jogado {when}", { when: formatLastPlayed(r.lastPlayedAt).toLowerCase() }) : t("Nunca jogado")}</span>
                    <span>{t("{pct}% do espaço dos jogos", { pct })}</span>
                  </div>
                </Focusable>
              );
            })
          )}
        </FocusGroup>
      )}

      <Hints
        items={[
          ...(page === "queue" || rows.length > 0 ? [{ btn: "A", label: page === "queue" ? "Selecionar" : "Desinstalar" } as const] : []),
          { btn: "LB", label: "Seção anterior" },
          { btn: "RB", label: "Próxima seção" },
          ...(page === "installed" ? [{ btn: "Y", label: "Ordenar" } as const] : []),
          { btn: "B", label: "Voltar" },
        ]}
      />

      {cancelId && (
        <ConfirmDialog
          title={t("Cancelar o download de {title}?", { title: cancelTitle })}
          message={t("O que já foi baixado deste jogo será apagado.")}
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
