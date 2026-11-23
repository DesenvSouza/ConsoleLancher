import { emit, type Action } from "./actions";

// Mapeamento "standard" do navegador (controle Xbox / XInput).
const BUTTONS: Record<number, Action> = {
  0: "confirm", // A
  1: "back", // B
  2: "x",
  3: "y",
  4: "lb",
  5: "rb",
  6: "lt",
  7: "rt",
  8: "select",
  9: "start",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};

const DEADZONE = 0.55;
const FIRST_REPEAT_MS = 330;
const REPEAT_MS = 100;
const DIRECTIONS = new Set<Action>(["up", "down", "left", "right"]);

interface Held {
  next: number;
}

/** O que o laço precisa de um controle: o suficiente para o menu do Guia fornecer um controle "de mentira" (XInput). */
export interface PadLike {
  connected: boolean;
  buttons: ReadonlyArray<{ pressed: boolean }>;
  axes: ReadonlyArray<number>;
}

/** Estado do controle como o app (Rust, via XInput) o entrega. */
export interface XInputPad {
  buttons: number;
  lt: number;
  rt: number;
  lx: number;
  ly: number;
}

/** Converte o controle do XInput no formato da Gamepad API, que o laço abaixo já entende. */
export function xinputToPad(p: XInputPad): PadLike {
  const bit = (mask: number) => ({ pressed: (p.buttons & mask) !== 0 });
  return {
    connected: true,
    buttons: [
      bit(0x1000), bit(0x2000), bit(0x4000), bit(0x8000), // A B X Y
      bit(0x0100), bit(0x0200), { pressed: p.lt > 40 }, { pressed: p.rt > 40 }, // LB RB LT RT
      bit(0x0020), bit(0x0010), bit(0x0040), bit(0x0080), // Voltar, Start, L3, R3
      bit(0x0001), bit(0x0002), bit(0x0004), bit(0x0008), // cima, baixo, esquerda, direita
    ],
    axes: [p.lx / 32768, -p.ly / 32768],
  };
}

export function startGamepad(source: () => ArrayLike<PadLike | null>, inputAllowed: () => boolean): () => void {
  const held = new Map<Action, Held>();
  let needsBaseline = true;
  const requireBaseline = () => { needsBaseline = true; };
  window.addEventListener("blur", requireBaseline);

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (!document.hasFocus() || !inputAllowed()) {
      requireBaseline();
      return;
    }

    const active = new Set<Action>();

    for (const pad of Array.from(source())) {
      if (!pad || !pad.connected) continue;

      pad.buttons.forEach((b, i) => {
        const a = BUTTONS[i];
        if (a && b.pressed) active.add(a);
      });

      const [lx = 0, ly = 0] = pad.axes;
      if (Math.abs(lx) > DEADZONE && Math.abs(lx) >= Math.abs(ly)) active.add(lx < 0 ? "left" : "right");
      else if (Math.abs(ly) > DEADZONE) active.add(ly < 0 ? "up" : "down");
    }

    if (needsBaseline) {
      // Ao voltar, cada botão ou direção que já estiver pressionado precisa ser solto antes de gerar uma ação.
      held.clear();
      for (const a of active) held.set(a, { next: Infinity });
      needsBaseline = false;
      return;
    }

    for (const a of active) {
      const h = held.get(a);
      if (!h) {
        emit(a);
        held.set(a, { next: now + FIRST_REPEAT_MS });
      } else if (DIRECTIONS.has(a) && now >= h.next) {
        emit(a);
        h.next = now + REPEAT_MS;
      }
    }
    for (const a of held.keys()) if (!active.has(a)) held.delete(a);
  };

  let raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("blur", requireBaseline);
  };
}
