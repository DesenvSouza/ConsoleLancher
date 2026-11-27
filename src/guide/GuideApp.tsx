import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { playSound } from "../audio/sounds";
import { Hints } from "../components/Chrome";
import { SystemControls } from "../components/System";
import { useSystemPolling } from "../store/system";
import { pullSyncedSettings } from "../lib/settingsSync";
import { FocusGroup, Focusable } from "../components/Focusable";
import { t, te } from "../i18n";
import { onAction } from "../input/actions";
import { withTimeout } from "../lib/timeout";
import { POWER_OPTIONS, type PowerOption, type PowerOptions } from "./preferences";
import { createXInputBridge, type XInputState } from "./xinputBridge";

interface GuideContext {
  running: boolean;
  gameId: string | null;
  name: string;
  /** O jogo tem janela para onde voltar. */
  window?: boolean;
  /** O jogo não respondeu ao pedido de fechar. */
  forceClose: boolean;
  /** O jogo está parado enquanto o menu está aberto. */
  paused?: boolean;
  /** Tela cheia exclusiva: o jogo continua com o foco e também recebe o controle. */
  sharedInput?: boolean;
  power: PowerOptions;
}

/** O que o Rust responde a cada pergunta: menu aberto?, qual abertura, e como está o controle. */
interface Poll {
  open: boolean;
  generation: number;
  pad: XInputState;
}

type Action = "resume" | "close" | "home" | "library" | "close_game" | "force_close" | "desktop" | "perf" | PowerOption;

/** Estado do contador de FPS (ele mesmo vive no Rust; o Guia só o liga e desliga). */
interface PerfState {
  enabled: boolean;
  /** A medição de quadros não tem permissão do Windows. */
  denied: boolean;
  /** A captura de quadros parou com erro. */
  failed?: boolean;
}

interface Item {
  id: Action;
  label: string;
  /** Se existe, pede confirmação antes. */
  confirm?: { title: string; message: string; button: string };
  danger?: boolean;
  gameId?: string;
}

interface Section {
  id: string;
  title: string;
  items: Item[];
}

/** Prazos das perguntas ao Rust: sem eles, uma resposta perdida deixava o menu parado. */
const POLL_LIMIT_MS = 1000;
const CONTEXT_LIMIT_MS = 4000;

const POWER_CONFIRMATIONS: Record<PowerOption, NonNullable<Item["confirm"]>> = {
  suspend: { title: "Suspender o PC?", message: "O Windows entrará em suspensão.", button: "Suspender" },
  restart: { title: "Reiniciar o PC?", message: "O Windows será reiniciado agora. Salve o que estiver aberto.", button: "Reiniciar" },
  shutdown: { title: "Desligar o PC?", message: "O Windows será desligado agora. Salve o que estiver aberto.", button: "Desligar" },
};

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function buildSections(ctx: GuideContext, perf: PerfState): Section[] {
  const sections: Section[] = [];
  if (ctx.gameId) {
    const close: Item = ctx.forceClose
      ? { id: "force_close", gameId: ctx.gameId, label: t("Forçar o fechamento"), danger: true, confirm: { title: t("Forçar o fechamento?"), message: t("O jogo não está respondendo. Ele será encerrado na hora e o que não foi salvo será perdido."), button: t("Forçar o fechamento") } }
      : { id: "close_game", gameId: ctx.gameId, label: t("Fechar o jogo"), danger: true, confirm: { title: t("Fechar o jogo?"), message: t("O jogo será fechado. O progresso que não foi salvo será perdido."), button: t("Fechar o jogo") } };
    // Sem janela não há para onde voltar.
    sections.push({ id: "game", title: t("Jogo"), items: ctx.window === false ? [close] : [{ id: "resume", label: t("Voltar ao jogo") }, close] });
  }
  const launcher: Item[] = [
    { id: "home", label: t("Início") },
    { id: "library", label: t("Biblioteca") },
    {
      id: "desktop", label: t("Sair para a área de trabalho"),
      confirm: {
        title: t("Sair para a área de trabalho?"),
        message: ctx.running ? t("O launcher será fechado e a área de trabalho será exibida. O jogo continuará aberto.") : t("O launcher será fechado e a área de trabalho será exibida."),
        button: t("Sair do launcher"),
      },
    },
  ];
  sections.push({ id: "launcher", title: t("Launcher"), items: launcher });
  sections.push({
    id: "perf",
    title: t("Desempenho"),
    items: [{ id: "perf", label: t("Contador de FPS: {state}", { state: perf.enabled ? (perf.denied ? t("Ligado · sem permissão") : perf.failed ? t("Ligado · com falha") : t("Ligado")) : t("Desligado") }) }],
  });

  const power = POWER_OPTIONS.filter(({ id }) => ctx.power[id]).map(({ id, label }) => ({
    id, label: t(label), danger: id !== "suspend",
    confirm: { title: t(POWER_CONFIRMATIONS[id].title), message: t(POWER_CONFIRMATIONS[id].message), button: t(POWER_CONFIRMATIONS[id].button) },
  }));
  if (power.length) sections.push({ id: "power", title: t("Energia do PC"), items: power });
  return sections;
}

/**
 * Menu do botão Guia. Roda num painel lateral sobre a janela do jogo e recebe o estado do
 * controle pelo XInput.
 */
export function GuideApp() {
  const [ctx, setCtx] = useState<GuideContext | null>(null);
  const [confirm, setConfirm] = useState<Item | null>(null);
  const [error, setError] = useState("");
  /** A leitura do contexto do menu falhou: mostra o erro com "Tentar de novo" em vez de ficar em "Carregando…" para sempre. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** A janela preparada fora da tela só desenha os controles do menu quando ele está aberto. */
  const [shown, setShown] = useState(false);
  const [perf, setPerf] = useState<PerfState>({ enabled: false, denied: false });
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const perfRef = useRef(perf);
  perfRef.current = perf;
  const open = useRef(false);
  const generation = useRef(-1);
  const selected = useRef<Action | null>(null);
  const menuHeader = useRef<HTMLElement>(null);
  /** Linha da seção "Sistema" que está com o foco (Volume, Saída de áudio): essas linhas não são itens de `sections`. */
  const systemRow = useRef<string | null>(null);
  const acting = useRef(false);
  /** Abertura cujo contexto está sendo lido: uma leitura por vez. */
  const loading = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const requestedGeneration = generation.current;
    if (loading.current === requestedGeneration) return;
    loading.current = requestedGeneration;
    try {
      const next = await withTimeout(call<GuideContext>("guide_context"), CONTEXT_LIMIT_MS);
      if (!open.current || requestedGeneration !== generation.current) return;
      setCtx(next);
      setLoadFailed(false);
      // O contador de FPS: o estado vem do Rust (a escolha é a mesma das Configurações).
      void call<{ enabled: boolean; capture: { state: string } }>("perf_status")
        .then((status) => open.current && setPerf({ enabled: status.enabled, denied: status.capture.state === "denied", failed: status.capture.state === "failed" }))
        .catch(() => undefined);
    } catch (e) {
      console.error("guide_context falhou", e);
      if (open.current && requestedGeneration === generation.current) setLoadFailed(true);
    } finally {
      if (loading.current === requestedGeneration) loading.current = null;
    }
  }, []);

  const togglePerf = useCallback(async () => {
    const enabled = !perfRef.current.enabled;
    setPerf((state) => ({ ...state, enabled }));
    playSound(enabled ? "select" : "back");
    try {
      await call("perf_set_config", { patch: { enabled } });
    } catch (e) {
      setPerf((state) => ({ ...state, enabled: !enabled }));
      setError(te(e));
    }
  }, []);

  const run = useCallback(async (action: Action, gameId?: string) => {
    if (acting.current) return;
    acting.current = true;
    setError("");
    try {
      await call("guide_action", { action, gameId });
    } catch (e) {
      playSound("warning");
      setError(te(e));
    } finally {
      acting.current = false;
    }
  }, []);

  // Pergunta ao Rust, a cada 30 ms, se o menu está aberto e como está o controle.
  useEffect(() => {
    const bridge = createXInputBridge();
    let busy = false;
    let alive = true;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const poll = await withTimeout(call<Poll>("guide_poll"), POLL_LIMIT_MS);
        if (!alive) return;
        if (open.current !== poll.open) {
          if (!poll.open) bridge.stop();
          playSound(poll.open ? "open" : "back");
          // Garante o tema e o idioma atuais a cada abertura (o aviso pode ter se perdido com o menu escondido).
          if (poll.open) pullSyncedSettings();
        }
        open.current = poll.open;
        setShown(poll.open);
        if (poll.generation !== generation.current) {
          // Abertura nova: começa do zero; o que estiver apertado agora vale só como ponto de partida.
          generation.current = poll.generation;
          bridge.reset();
          selected.current = null;
          systemRow.current = null;
          setCtx(null);
          setLoadFailed(false);
          setConfirm(null);
          setError("");
          if (poll.open) void refresh();
        }
        if (poll.open) bridge.handle(poll.pad);
      } catch (e) {
        console.error("guide_poll falhou", e);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), 30);
    return () => {
      alive = false;
      clearInterval(timer);
      bridge.stop();
    };
  }, [refresh]);

  // Enquanto o menu está aberto, confere o jogo a cada segundo (ele pode fechar sozinho).
  useEffect(() => {
    const t = setInterval(() => open.current && void refresh(), 1000);
    return () => clearInterval(t);
  }, [refresh]);

  // B: cancela a confirmação ou fecha o menu.
  useEffect(
    () =>
      onAction((a) => {
        if (a !== "back") return;
        if (confirmRef.current) {
          playSound("back");
          setConfirm(null);
        } else void run("close");
      }),
    [run],
  );

  // Volume e saída de áudio no menu: só consulta o Windows enquanto o menu está aberto.
  useSystemPolling(shown ? 2000 : 3_600_000);

  const sections = ctx ? buildSections(ctx, perf) : [];
  const systemSection = ctx && (
    <section className="guide-section" aria-labelledby="guide-section-system">
      <h3 id="guide-section-system">{t("Sistema")}</h3>
      <SystemControls prefix="guide-sys" compact onFocusRow={(key) => { systemRow.current = key; }} />
    </section>
  );
  const first = sections[0]?.items[0]?.id;
  // O foco nunca começa (nem cai) numa ação que encerra algo: sem "Voltar ao jogo", começa no Início.
  const everyItem = sections.flatMap(({ items }) => items);
  const initial = (everyItem.find((item) => !item.danger) ?? everyItem[0])?.id;
  const target = everyItem.some((item) => item.id === selected.current) ? selected.current : initial;
  // Sem lembrar a linha do Sistema, cada atualização do menu (a cada segundo) puxava o foco de volta para o último item da
  // lista de cima ("Sair para a área de trabalho") e as setas do volume viravam um movimento para cima.
  const focusKey = confirm ? "guide-cancel" : !ctx && loadFailed ? "guide-retry" : systemRow.current ?? (target && `guide-${target}`);
  useEffect(() => {
    if (shown && focusKey) setFocus(focusKey);
  }, [shown, focusKey]);

  if (!shown) return <div className="guide-idle" />;

  // O cabeçalho vem antes do primeiro botão e não faz parte da navegação por foco.
  const scrollToTop = () => menuHeader.current?.parentElement?.scrollTo({ top: 0, behavior: "instant" });

  return (
    <div className="overlay guide-overlay">
      {confirm?.confirm ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby="guide-confirm-title" aria-describedby="guide-confirm-message">
        <FocusGroup focusKey="guide-confirm" className="dialog" boundary preferredChildFocusKey="guide-cancel">
          <h2 id="guide-confirm-title">{confirm.confirm.title}</h2>
          <p id="guide-confirm-message">{confirm.confirm.message}</p>
          <div className="dialog-actions">
            <Focusable focusKey="guide-cancel" className="btn" scroll={false} onPress={() => {
              playSound("back");
              setConfirm(null);
            }}>{t("Cancelar")}</Focusable>
            <Focusable focusKey="guide-ok" className={`btn ${confirm.danger ? "btn-danger" : "btn-primary"}`} onPress={() => void run(confirm.id, confirm.gameId)}>{confirm.confirm.button}</Focusable>
          </div>
          {error && <p className="guide-error" role="alert">{error}</p>}
        </FocusGroup>
        </div>
      ) : (
        <FocusGroup focusKey="guide-menu" className="menu guide-menu" boundary preferredChildFocusKey={initial && `guide-${initial}`} disabled={!ctx && !loadFailed}>
          <header ref={menuHeader} className="menu-head guide-header">
            <div>
              <h2>{ctx?.running ? ctx.name || t("Jogo em execução") : t("Guia")}</h2>
              <p>{ctx ? (ctx.running ? (ctx.paused ? t("Pausado enquanto o menu está aberto") : t("Em execução")) : t("Nenhum jogo em execução")) : loadFailed ? t("Não foi possível carregar o menu.") : t("Carregando menu…")}</p>
            </div>
          </header>
          {ctx?.sharedInput && <p className="guide-note">{t("O jogo também recebe o controle. Para evitar isso, use “janela sem bordas” no vídeo do jogo.")}</p>}
          {!ctx && loadFailed && (
            <section className="guide-section">
              <Focusable focusKey="guide-retry" className="menu-item" onPress={() => { setLoadFailed(false); void refresh(); }}>{t("Tentar de novo")}</Focusable>
              <Focusable focusKey="guide-close-error" className="menu-item" onPress={() => void run("close")}>{t("Fechar o Guia")}</Focusable>
            </section>
          )}
          {sections.map(({ id, title, items }) => (
            <Fragment key={id}>
              {id === "power" && systemSection}
              <section className="guide-section" aria-labelledby={`guide-section-${id}`}>
              <h3 id={`guide-section-${id}`}>{title}</h3>
              {items.map((it) => (
                <Focusable
                  key={it.id}
                  focusKey={`guide-${it.id}`}
                  className={`menu-item ${it.danger ? "menu-danger" : ""}`}
                  scroll={it.id !== first}
                  onFocus={() => {
                    selected.current = it.id;
                    systemRow.current = null;
                    if (it.id === first) scrollToTop();
                  }}
                  onVerticalPress={it.id === first ? (direction) => {
                    if (direction !== "up") return false;
                    scrollToTop();
                    return true;
                  } : undefined}
                  onPress={() => {
                    selected.current = it.id;
                    systemRow.current = null;
                    if (it.id === "perf") {
                      // Liga e desliga sem fechar o menu: dá para ver o contador aparecer atrás dele.
                      void togglePerf();
                    } else if (it.confirm) {
                      playSound("open");
                      setConfirm(it);
                    } else {
                      void run(it.id);
                    }
                  }}
                >
                  {it.label}
                </Focusable>
              ))}
              </section>
            </Fragment>
          ))}
          {/* Sem opções de energia ligadas, o Sistema fica no fim; com elas, a energia do PC é sempre a última seção. */}
          {!sections.some(({ id }) => id === "power") && systemSection}
          {error && <p className="guide-error" role="alert">{error}</p>}
        </FocusGroup>
      )}
      <Hints modal items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: confirm ? "Cancelar" : "Voltar" }]} />
    </div>
  );
}
