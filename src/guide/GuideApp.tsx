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
  /** Há uma instalação em andamento que desligar ou reiniciar interromperia. */
  installing?: boolean;
  power: PowerOptions;
}

/** O que o Rust responde a cada pergunta: menu aberto?, qual abertura, e como está o controle. */
interface Poll {
  open: boolean;
  generation: number;
  pad: XInputState;
}

type Action = "resume" | "close" | "home" | "library" | "close_game" | "force_close" | "desktop" | "perf" | "perf_settings" | PowerOption;

/** Estado do contador de FPS (ele mesmo vive no Rust; o Guia só o liga e desliga). */
interface PerfState {
  enabled: boolean;
  /** A medição de quadros não tem permissão do Windows. */
  denied: boolean;
  /** A captura de quadros parou com erro. */
  failed?: boolean;
  /** A captura ainda está começando. */
  starting?: boolean;
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
/** Uma ação sem resposta libera o menu depois deste tempo (o fechamento forçado espera o Windows por até 5 s). */
const ACTION_LIMIT_MS = 7000;
const DESKTOP_LIMIT_MS = 20_000;
/** O aviso de andamento só aparece se a ação demorar. */
const PENDING_AFTER_MS = 300;

const POWER_CONFIRMATIONS: Record<PowerOption, NonNullable<Item["confirm"]>> = {
  suspend: { title: "Suspender o PC?", message: "O Windows entrará em suspensão.", button: "Suspender" },
  restart: { title: "Reiniciar o PC?", message: "O Windows será reiniciado agora. Salve o que estiver aberto.", button: "Reiniciar" },
  shutdown: { title: "Desligar o PC?", message: "O Windows será desligado agora. Salve o que estiver aberto.", button: "Desligar" },
};

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** O que dizer enquanto uma ação ainda não respondeu. */
function pendingText(action: Action): string {
  if (action === "library") return t("Abrindo a Biblioteca…");
  if (action === "home") return t("Abrindo o Início…");
  if (action === "resume") return t("Voltando ao jogo…");
  if (action === "desktop") return t("Abrindo a área de trabalho…");
  return t("Aguarde…");
}

function buildSections(ctx: GuideContext, perf: PerfState): Section[] {
  const sections: Section[] = [];
  if (ctx.gameId) {
    // As confirmações dizem qual é o jogo.
    const title = ctx.name || t("o jogo");
    const close: Item = ctx.forceClose
      ? { id: "force_close", gameId: ctx.gameId, label: t("Forçar o fechamento"), danger: true, confirm: { title: t("Forçar o fechamento de {title}?", { title }), message: t("O jogo não está respondendo. Ele será encerrado na hora e o que não foi salvo será perdido."), button: t("Forçar o fechamento") } }
      : { id: "close_game", gameId: ctx.gameId, label: t("Fechar o jogo"), danger: true, confirm: { title: t("Fechar {title}?", { title }), message: t("O jogo será fechado. O progresso que não foi salvo será perdido."), button: t("Fechar o jogo") } };
    // Sem janela não há para onde voltar.
    sections.push({ id: "game", title: t("Jogo"), items: ctx.window === false ? [close] : [{ id: "resume", label: t("Voltar ao jogo") }, close] });
  }
  sections.push({ id: "launcher", title: t("Navegação"), items: [
    { id: "home", label: t("Início") },
    { id: "library", label: t("Biblioteca") },
  ] });
  const name = ctx.name || t("o jogo");
  const perfLabel = !perf.enabled ? t("Desligado") : perf.denied ? t("Ligado · sem permissão") : perf.failed ? t("Ligado · com falha") : perf.starting ? t("Ligado · preparando") : t("Ligado");
  sections.push({
    id: "perf",
    title: t("Desempenho"),
    items: [
      { id: "perf", label: t("Contador de FPS: {state}", { state: perfLabel }) },
      // Sem permissão ou com falha, o caminho para o diagnóstico fica aqui mesmo.
      ...(perf.enabled && (perf.denied || perf.failed) ? [{ id: "perf_settings" as const, label: t("Ver o problema do contador") }] : []),
    ],
  });
  const desktop: Item = {
    id: "desktop", label: t("Fechar o launcher e ir à área de trabalho"),
    confirm: {
      title: t("Ir para a área de trabalho?"),
      message: ctx.running ? t("O launcher será fechado. {title} continua aberto, minimizado.", { title: name }) : t("O launcher será fechado e a área de trabalho será exibida."),
      button: t("Fechar o launcher"),
    },
  };

  const power = POWER_OPTIONS.filter(({ id }) => ctx.power[id]).map(({ id, label }) => ({
    id, label: t(label), danger: id !== "suspend",
    confirm: {
      title: t(POWER_CONFIRMATIONS[id].title),
      // Antes de confirmar, o que está em risco: o jogo aberto e uma instalação em andamento.
      message: [
        t(POWER_CONFIRMATIONS[id].message),
        id !== "suspend" && ctx.running ? t("{title} está aberto: o que não foi salvo pode ser perdido.", { title: name }) : "",
        id !== "suspend" && ctx.installing ? t("Há uma instalação em andamento, que será interrompida.") : "",
      ].filter(Boolean).join(" "),
      button: t(POWER_CONFIRMATIONS[id].button),
    },
  }));
  // Sair do launcher e a energia do PC no mesmo bloco, no fim: são as opções raras.
  sections.push({ id: "power", title: t("Sessão e energia"), items: [desktop, ...power] });
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
  /** Linha da seção "Sistema" que está com o foco (Volume, Saída de áudio): essas linhas não são itens de `sections`. */
  const systemRow = useRef<string | null>(null);
  /** A ação em andamento (um número por pedido: a resposta de um pedido abandonado não mexe no menu). */
  const acting = useRef<number | null>(null);
  const actionCount = useRef(0);
  const [pending, setPending] = useState<Action | null>(null);
  /** A lista tem itens abaixo do que está à vista. */
  const [more, setMore] = useState(false);
  const list = useRef<HTMLDivElement>(null);
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
        .then((status) => open.current && requestedGeneration === generation.current && setPerf({ enabled: status.enabled, denied: status.capture.state === "denied", failed: status.capture.state === "failed", starting: status.capture.state === "starting" }))
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
    // Fechar o menu nunca fica preso atrás de outra ação.
    if (action === "close") {
      acting.current = null;
      setPending(null);
      await call("guide_action", { action }).catch((e) => console.error("guide_action falhou", e));
      return;
    }
    if (acting.current !== null) return;
    const request = ++actionCount.current;
    acting.current = request;
    setError("");
    const slow = setTimeout(() => acting.current === request && setPending(action), PENDING_AFTER_MS);
    try {
      // Abrir o Explorer no modo console pode levar até 15 s.
      await withTimeout(call("guide_action", { action, gameId, generation: generation.current }), action === "desktop" ? DESKTOP_LIMIT_MS : ACTION_LIMIT_MS);
    } catch (e) {
      if (acting.current !== request) return;
      playSound("warning");
      const late = e instanceof Error && e.message === "timeout";
      setError(late ? t("O comando está demorando. Tente de novo ou feche o menu com B.") : te(e));
      // Antes de oferecer de novo uma ação que encerra algo, confere como o jogo está agora.
      if (late) void refresh();
    } finally {
      clearTimeout(slow);
      if (acting.current === request) {
        acting.current = null;
        setPending(null);
      }
    }
  }, [refresh]);

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
          acting.current = null;
          setPending(null);
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

  // "Mais opções abaixo": relido a cada mudança do menu e a cada rolagem.
  const updateMore = useCallback(() => {
    const element = list.current?.firstElementChild;
    setMore(!!element && element.scrollHeight - element.scrollTop - element.clientHeight > 8);
  }, []);
  useEffect(() => {
    if (shown) requestAnimationFrame(updateMore);
  });

  if (!shown) return <div className="guide-idle" />;

  const scrollToTop = () => list.current?.firstElementChild?.scrollTo({ top: 0, behavior: "instant" });
  /** Há o que selecionar com A? */
  const selectable = !!confirm || !!ctx || loadFailed;
  const status = pending ? pendingText(pending)
    : !ctx ? (loadFailed ? t("Não foi possível carregar o menu.") : t("Carregando menu…"))
    : !ctx.running ? t("Nenhum jogo em execução")
    : ctx.window === false ? t("Sem janela no momento")
    : ctx.paused ? t("Pausado enquanto o menu está aberto") : t("Em execução");

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
        <div className="guide-body">
        {/* O nome do jogo e o estado ficam sempre à vista; só a lista rola. */}
        <header className="menu-head guide-header">
          <div>
            <h2>{ctx?.running ? ctx.name || t("Jogo em execução") : t("Guia")}</h2>
            <p role="status">{status}</p>
          </div>
        </header>
        <div ref={list} className={`guide-scroll ${more ? "has-more" : ""}`} onScrollCapture={updateMore}>
        <FocusGroup focusKey="guide-menu" className="menu guide-menu" boundary preferredChildFocusKey={initial && `guide-${initial}`} disabled={!ctx && !loadFailed}>
          {!ctx && loadFailed && (
            <section className="guide-section">
              <Focusable focusKey="guide-retry" className="menu-item" onPress={() => { setLoadFailed(false); void refresh(); }}>{t("Tentar de novo")}</Focusable>
              <Focusable focusKey="guide-close-error" className="menu-item" onPress={() => void run("close")}>{t("Fechar o Guia")}</Focusable>
            </section>
          )}
          {sections.map(({ id, title, items }) => (
            <Fragment key={id}>
              {/* Volume e saída de áudio antes das opções raras. */}
              {id === "perf" && systemSection}
              <section className="guide-section" aria-labelledby={`guide-section-${id}`}>
              <h3 id={`guide-section-${id}`}>{title}</h3>
              {id === "game" && ctx?.window === false && <p className="guide-note">{t("O jogo pode estar abrindo, trocando o modo de vídeo ou fechando. Aguarde alguns segundos.")}</p>}
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
        </FocusGroup>
        </div>
        {more && <p className="guide-more" aria-hidden>▾ {t("Mais opções abaixo")}</p>}
        {error && <p className="guide-error" role="alert">{error}</p>}
        </div>
      )}
      {ctx?.sharedInput && <p className="guide-shared" role="status"><strong>{t("Controle compartilhado")}</strong> {t("O jogo também recebe os botões. Use “janela sem bordas” no vídeo do jogo para separar.")}</p>}
      <Hints modal items={[...(selectable ? [{ btn: "A" as const, label: "Selecionar" }] : []), { btn: "B", label: confirm ? "Cancelar" : selectable ? "Voltar" : "Fechar o Guia" }]} />
    </div>
  );
}
