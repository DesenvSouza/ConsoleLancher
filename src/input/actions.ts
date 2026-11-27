import { getCurrentFocusKey, init, navigateByDirection } from "@noriginmedia/norigin-spatial-navigation";
import { api } from "../lib/api";
import { useUI } from "../store/ui";

/** Ações abstratas do controle. Teclado e gamepad geram as mesmas ações. */
export type Action =
  | "up" | "down" | "left" | "right"
  | "confirm" | "back"
  | "x" | "y" | "lb" | "rb" | "lt" | "rt"
  | "start" | "select";

type Listener = (a: Action) => void;
const listeners = new Set<Listener>();
export type VerticalDirection = "up" | "down";

/** Assina as ações (retorna a função para cancelar). */
export function onAction(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Algo na frente de tudo (a abertura em vídeo, a reinicialização) fica com os botões: nada chega ao launcher. */
let held: ((action: Action) => void) | null = null;
/** Passa os botões para `onPress` até a função devolvida ser chamada. */
export function holdInput(onPress: (action: Action) => void): () => void {
  held = onPress;
  return () => {
    if (held === onPress) held = null;
  };
}

export function emit(a: Action) {
  if (held) {
    held(a);
    return;
  }
  switch (a) {
    case "left":
    case "right": {
      // Em itens ajustáveis (configurações), ←/→ mudam o valor em vez de mover o foco.
      const adjustable = document.querySelector<HTMLElement>('[data-focused="true"][data-adjustable="true"]');
      if (adjustable) {
        adjustable.dispatchEvent(new CustomEvent("adjust", { detail: a === "left" ? -1 : 1 }));
        break;
      }
      void navigateByDirection(a, { viaDirection: true });
      break;
    }
    case "up":
    case "down": {
      const key = getCurrentFocusKey();
      const target = key && document.querySelector(`[data-focus-key="${CSS.escape(key)}"][data-vertical-nav]`);
      const handled = target && !target.dispatchEvent(new CustomEvent("vertical-nav", { detail: a, cancelable: true }));
      if (!handled) void navigateByDirection(a, { viaDirection: true });
      break;
    }
    case "confirm": {
      const key = getCurrentFocusKey();
      const target = key && document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
      if (target && (!useUI.getState().modalOpen || target.closest(".overlay"))) target.click();
      break;
    }
  }
  listeners.forEach((fn) => fn(a));
}

// Teclado só para desenvolver sem controle. As setas já são tratadas pela
// biblioteca de navegação, então aqui entram apenas as demais ações.
const KEYS: Record<string, Action> = {
  Enter: "confirm",
  Escape: "back",
  Backspace: "back",
  x: "x",
  c: "y",
  q: "lb",
  e: "rb",
  f: "rt",
  Tab: "start",
  F1: "select",
};

// Enquanto há um campo de texto na tela (teclado virtual), as teclas do teclado físico são
// letras de verdade e não podem virar botões do controle (x, c, q, e, Backspace, Enter, Esc...).
let textCapture = false;
export function setTextCapture(active: boolean) {
  textCapture = active;
}

let started = false;
export function initInput() {
  if (started) return;
  started = true;
  init({ debug: false, visualDebug: false });

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "F11") {
      ev.preventDefault();
      void api.toggleFullscreen();
      return;
    }
    if (textCapture) return;
    const a = KEYS[ev.key];
    if (!a) return;
    ev.preventDefault();
    emit(a);
  });
}
