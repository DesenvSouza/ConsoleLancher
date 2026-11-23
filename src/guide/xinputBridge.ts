import { emit, type Action } from "../input/actions";

/** Estado do controle vindo do Rust (XInput). */
export interface XInputState {
  buttons: number;
  lt: number;
  rt: number;
  lx: number;
  ly: number;
}

const BUTTON_ACTIONS: Array<[number, Action]> = [
  [0x1000, "confirm"], // A
  [0x2000, "back"], // B
  [0x4000, "x"],
  [0x8000, "y"],
  [0x0100, "lb"],
  [0x0200, "rb"],
  [0x0020, "select"], // Voltar
  [0x0010, "start"],
];

const DIRECTIONS: Array<[number, Action]> = [
  [0x0001, "up"],
  [0x0002, "down"],
  [0x0004, "left"],
  [0x0008, "right"],
];

const STICK_DEADZONE = 0.55 * 32768;
const FIRST_REPEAT_MS = 330;
const REPEAT_MS = 100;

/**
 * Converte o estado do controle (recebido do Rust) em ações do menu, por eventos: cada aperto novo vira uma ação
 * na hora, sem depender de um laço de quadros. A janela do menu pode ficar "escondida" para o navegador
 * (por trás de um jogo em tela cheia) e o requestAnimationFrame para quando isso acontece; um aperto curto se
 * perderia. Os direcionais repetem enquanto seguram.
 */
export function createXInputBridge() {
  /** Depois de abrir o menu, o primeiro estado recebido só serve de ponto de partida (não gera ações). */
  let adopt = true;
  /** Botões e direções que já estavam apertados: só o que muda para "apertado" gera ação. */
  let down = new Set<Action>();
  let repeatTimer: ReturnType<typeof setTimeout> | undefined;
  let heldDirection: Action | null = null;

  const active = (s: XInputState): Set<Action> => {
    const out = new Set<Action>();
    for (const [mask, action] of BUTTON_ACTIONS) if (s.buttons & mask) out.add(action);
    for (const [mask, action] of DIRECTIONS) if (s.buttons & mask) out.add(action);
    // O direcional analógico também navega (o Y do XInput cresce para cima).
    if (Math.abs(s.lx) > STICK_DEADZONE && Math.abs(s.lx) >= Math.abs(s.ly)) out.add(s.lx < 0 ? "left" : "right");
    else if (Math.abs(s.ly) > STICK_DEADZONE) out.add(s.ly > 0 ? "up" : "down");
    return out;
  };

  const stopRepeat = () => {
    if (repeatTimer) clearTimeout(repeatTimer);
    repeatTimer = undefined;
    heldDirection = null;
  };

  const startRepeat = (direction: Action) => {
    stopRepeat();
    heldDirection = direction;
    const tick = (delay: number) => {
      repeatTimer = setTimeout(() => {
        if (heldDirection !== direction) return;
        emit(direction);
        tick(REPEAT_MS);
      }, delay);
    };
    tick(FIRST_REPEAT_MS);
  };

  return {
    /** Novo estado do controle. */
    handle(state: XInputState) {
      const now = active(state);
      if (adopt) {
        adopt = false;
        down = now;
        return;
      }
      for (const action of now) {
        if (down.has(action)) continue;
        emit(action);
        if (DIRECTIONS.some(([, d]) => d === action)) startRepeat(action);
      }
      if (heldDirection && !now.has(heldDirection)) stopRepeat();
      down = now;
    },
    /**
     * O menu abriu. O que estava apertado nesse instante não conta como aperto novo, e o que sobrou do uso
     * anterior (por exemplo o B que fechou o menu: o aviso de "solto" não chega com a janela fechada) é descartado.
     */
    reset() {
      stopRepeat();
      down = new Set();
      adopt = true;
    },
    stop: stopRepeat,
  };
}
