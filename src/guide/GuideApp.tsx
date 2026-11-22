import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Hints } from "../components/Chrome";
import { FocusGroup, Focusable } from "../components/Focusable";
import { onAction } from "../input/actions";
import { createXInputBridge, type XInputState } from "./xinputBridge";

interface GuideContext {
  running: boolean;
  appId: number;
  name: string;
}

/** O que o Rust responde a cada pergunta: menu aberto?, qual abertura, e como está o controle. */
interface Poll {
  open: boolean;
  generation: number;
  pad: XInputState;
}

type Action = "resume" | "close" | "library" | "close_game" | "suspend" | "restart" | "shutdown" | "desktop";

interface Item {
  id: Action;
  label: string;
  /** Se existe, pede confirmação antes. */
  confirm?: { title: string; message: string; button: string };
  danger?: boolean;
  /** Espaço antes do item, separando grupos. */
  gap?: boolean;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function buildItems(ctx: GuideContext): Item[] {
  const items: Item[] = ctx.running
    ? [
        { id: "resume", label: "Voltar ao jogo" },
        { id: "library", label: "Ir para a biblioteca" },
        { id: "close_game", label: "Fechar o jogo", danger: true, confirm: { title: "Fechar o jogo?", message: "O jogo será fechado. O progresso que não foi salvo será perdido.", button: "Fechar o jogo" } },
      ]
    : [{ id: "close", label: "Fechar o menu" }];
  items.push(
    { id: "suspend", label: "Suspender o PC", gap: true },
    { id: "restart", label: "Reiniciar o PC", danger: true, confirm: { title: "Reiniciar o PC?", message: "O Windows será reiniciado agora. Salve o que estiver aberto.", button: "Reiniciar" } },
    { id: "shutdown", label: "Desligar o PC", danger: true, confirm: { title: "Desligar o PC?", message: "O Windows será desligado agora. Salve o que estiver aberto.", button: "Desligar" } },
  );
  if (!ctx.running) {
    items.push({ id: "desktop", label: "Sair para a área de trabalho", danger: true, confirm: { title: "Sair do launcher?", message: "O launcher fecha e a área de trabalho do Windows abre.", button: "Sair" } });
  }
  return items;
}

/**
 * Menu do botão Guia. Roda numa janela própria, transparente e por cima de tudo (inclusive do jogo): o fundo
 * escurece o que estiver atrás. O controle vem do XInput, lido pelo Rust; esta janela pergunta o estado dele a
 * cada instante (30 ms), então responde mesmo quando o Windows não deu o foco a ela.
 */
export function GuideApp() {
  const [ctx, setCtx] = useState<GuideContext>({ running: false, appId: 0, name: "" });
  const [confirm, setConfirm] = useState<Item | null>(null);
  const [error, setError] = useState("");
  /** O menu está aberto: fechado, a janela (sempre do tamanho da tela) não desenha nada. */
  const [shown, setShown] = useState(false);
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const wasRunning = useRef(false);
  const open = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await call<GuideContext>("guide_context");
      setCtx(next);
      // O jogo terminou com o menu aberto: não há mais a quem voltar, vai para a biblioteca.
      if (open.current && wasRunning.current && !next.running) await call("guide_action", { action: "library" });
      wasRunning.current = next.running;
    } catch (e) {
      console.error("guide_context falhou", e);
    }
  }, []);

  const run = useCallback(async (action: Action) => {
    setError("");
    try {
      await call("guide_action", { action });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Pergunta ao Rust, a cada 30 ms, se o menu está aberto e como está o controle.
  useEffect(() => {
    const bridge = createXInputBridge();
    let generation = -1;
    let busy = false;
    let alive = true;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const poll = await call<Poll>("guide_poll");
        if (!alive) return;
        open.current = poll.open;
        setShown(poll.open);
        if (poll.generation !== generation) {
          // Abertura nova: começa do zero; o que estiver apertado agora vale só como ponto de partida.
          generation = poll.generation;
          bridge.reset();
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
        if (confirmRef.current) setConfirm(null);
        else void run("close");
      }),
    [run],
  );

  const items = buildItems(ctx);

  // Foco no primeiro item quando o menu abre ou a confirmação fecha; na confirmação, em "Cancelar".
  useEffect(() => {
    if (shown) setFocus(confirm ? "guide-cancel" : `guide-${items[0].id}`);
  }, [confirm, ctx.running, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return <div className="guide-idle" />;

  return (
    <div className="overlay guide-overlay">
      {confirm?.confirm ? (
        <FocusGroup focusKey="guide-confirm" className="dialog" boundary preferredChildFocusKey="guide-cancel">
          <h2>{confirm.confirm.title}</h2>
          <p>{confirm.confirm.message}</p>
          <div className="dialog-actions">
            <Focusable focusKey="guide-cancel" className="btn" scroll={false} onPress={() => setConfirm(null)}>Cancelar</Focusable>
            <Focusable focusKey="guide-ok" className="btn btn-danger" scroll={false} onPress={() => void run(confirm.id)}>{confirm.confirm.button}</Focusable>
          </div>
        </FocusGroup>
      ) : (
        <FocusGroup focusKey="guide-menu" className="menu guide-menu" boundary preferredChildFocusKey={`guide-${items[0].id}`}>
          <div className="menu-head">
            <div>
              <h2>{ctx.running ? ctx.name || "Jogo em execução" : "Menu"}</h2>
              <p>{ctx.running ? "Em execução" : "Nenhum jogo em execução"}</p>
            </div>
          </div>
          {items.map((it) => (
            <div key={it.id} className="guide-entry">
              {it.gap && <div className="guide-gap" />}
              <Focusable
                focusKey={`guide-${it.id}`}
                className={`menu-item ${it.danger ? "menu-danger" : ""}`}
                scroll={false}
                onPress={() => (it.confirm ? setConfirm(it) : void run(it.id))}
              >
                {it.label}
              </Focusable>
            </div>
          ))}
          {error && <p className="guide-error">{error}</p>}
        </FocusGroup>
      )}
      <Hints modal items={[{ btn: "A", label: "Selecionar" }, { btn: "B", label: confirm ? "Cancelar" : "Voltar" }]} />
    </div>
  );
}
