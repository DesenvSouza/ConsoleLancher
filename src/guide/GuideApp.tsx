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
import { POWER_OPTIONS, type PowerOption, type PowerOptions } from "./preferences";
import { createXInputBridge, type XInputState } from "./xinputBridge";

interface GuideContext {
  running: boolean;
  appId: number;
  name: string;
  power: PowerOptions;
}

/** O que o Rust responde a cada pergunta: menu aberto?, qual abertura, e como está o controle. */
interface Poll {
  open: boolean;
  generation: number;
  pad: XInputState;
}

type Action = "resume" | "close" | "home" | "library" | "close_game" | "desktop" | PowerOption;

interface Item {
  id: Action;
  label: string;
  /** Se existe, pede confirmação antes. */
  confirm?: { title: string; message: string; button: string };
  danger?: boolean;
}

interface Section {
  id: string;
  title: string;
  items: Item[];
}

const POWER_CONFIRMATIONS: Record<PowerOption, NonNullable<Item["confirm"]>> = {
  suspend: { title: "Suspender o PC?", message: "O Windows entrará em suspensão.", button: "Suspender" },
  restart: { title: "Reiniciar o PC?", message: "O Windows será reiniciado agora. Salve o que estiver aberto.", button: "Reiniciar" },
  shutdown: { title: "Desligar o PC?", message: "O Windows será desligado agora. Salve o que estiver aberto.", button: "Desligar" },
};

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function buildSections(ctx: GuideContext): Section[] {
  const sections: Section[] = [];
  if (ctx.running) {
    sections.push({ id: "game", title: t("Jogo"), items: [
      { id: "resume", label: t("Voltar ao jogo") },
      { id: "close_game", label: t("Fechar o jogo"), danger: true, confirm: { title: t("Fechar o jogo?"), message: t("O jogo será fechado. O progresso que não foi salvo será perdido."), button: t("Fechar o jogo") } },
    ] });
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
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const wasRunning = useRef(false);
  const open = useRef(false);
  const generation = useRef(-1);
  const selected = useRef<Action | null>(null);
  /** Linha da seção "Sistema" que está com o foco (Volume, Saída de áudio): essas linhas não são itens de `sections`. */
  const systemRow = useRef<string | null>(null);
  const acting = useRef(false);

  const refresh = useCallback(async () => {
    const requestedGeneration = generation.current;
    try {
      const next = await call<GuideContext>("guide_context");
      if (!open.current || requestedGeneration !== generation.current) return;
      // O jogo terminou com o menu aberto: não há mais a quem voltar, vai para a biblioteca.
      const gameEnded = wasRunning.current && !next.running;
      wasRunning.current = next.running;
      setCtx(next);
      setLoadFailed(false);
      if (gameEnded) await call("guide_action", { action: "library" });
    } catch (e) {
      console.error("guide_context falhou", e);
      if (open.current) setLoadFailed(true);
    }
  }, []);

  const run = useCallback(async (action: Action) => {
    if (acting.current) return;
    acting.current = true;
    setError("");
    try {
      await call("guide_action", { action });
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
        const poll = await call<Poll>("guide_poll");
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
          wasRunning.current = false;
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

  const sections = ctx ? buildSections(ctx) : [];
  const systemSection = ctx && (
    <section className="guide-section" aria-labelledby="guide-section-system">
      <h3 id="guide-section-system">{t("Sistema")}</h3>
      <SystemControls prefix="guide-sys" compact onFocusRow={(key) => { systemRow.current = key; }} />
    </section>
  );
  const first = sections[0]?.items[0]?.id;
  const target = sections.some(({ items }) => items.some((item) => item.id === selected.current)) ? selected.current : first;
  // Sem lembrar a linha do Sistema, cada atualização do menu (a cada segundo) puxava o foco de volta para o último item da
  // lista de cima ("Sair para a área de trabalho") e as setas do volume viravam um movimento para cima.
  const focusKey = confirm ? "guide-cancel" : !ctx && loadFailed ? "guide-retry" : systemRow.current ?? (target && `guide-${target}`);
  useEffect(() => {
    if (shown && focusKey) setFocus(focusKey);
  }, [shown, focusKey]);

  if (!shown) return <div className="guide-idle" />;

  return (
    <div className="overlay guide-overlay">
      {confirm?.confirm ? (
        <FocusGroup focusKey="guide-confirm" className="dialog" boundary preferredChildFocusKey="guide-cancel">
          <h2>{confirm.confirm.title}</h2>
          <p>{confirm.confirm.message}</p>
          <div className="dialog-actions">
            <Focusable focusKey="guide-cancel" className="btn" scroll={false} onPress={() => {
              playSound("back");
              setConfirm(null);
            }}>{t("Cancelar")}</Focusable>
            <Focusable focusKey="guide-ok" className={`btn ${confirm.danger ? "btn-danger" : "btn-primary"}`} onPress={() => void run(confirm.id)}>{confirm.confirm.button}</Focusable>
          </div>
          {error && <p className="guide-error" role="alert">{error}</p>}
        </FocusGroup>
      ) : (
        <FocusGroup focusKey="guide-menu" className="menu guide-menu" boundary preferredChildFocusKey={first && `guide-${first}`} disabled={!ctx && !loadFailed}>
          <header className="menu-head guide-header">
            <div>
              <h2>{ctx?.running ? ctx.name || t("Jogo em execução") : t("Guia")}</h2>
              <p>{ctx ? (ctx.running ? t("Em execução") : t("Nenhum jogo em execução")) : loadFailed ? t("Não foi possível carregar o menu.") : t("Carregando menu…")}</p>
            </div>
          </header>
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
                  onFocus={() => { selected.current = it.id; systemRow.current = null; }}
                  onPress={() => {
                    selected.current = it.id;
                    systemRow.current = null;
                    if (it.confirm) {
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
