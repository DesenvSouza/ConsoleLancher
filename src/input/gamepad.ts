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
const FIRST_REPEAT_MS = 380;
const REPEAT_MS = 120;
const DIRECTIONS = new Set<Action>(["up", "down", "left", "right"]);

interface Held {
  next: number;
}

/**
 * Lê o controle a cada frame e converte em ações. Direcionais repetem enquanto
 * seguram; os demais botões disparam uma vez por aperto.
 *
 * Observação: a Gamepad API só entrega eventos com a janela em foco. Para
 * detectar o controle com um jogo aberto (atalho do menu rápido) o backend Rust
 * vai ler o XInput diretamente (marco M4).
 */
export function startGamepad(): () => void {
  const held = new Map<Action, Held>();
  let raf = 0;

  const loop = (now: number) => {
    const active = new Set<Action>();

    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;

      pad.buttons.forEach((b, i) => {
        const a = BUTTONS[i];
        if (a && b.pressed) active.add(a);
      });

      const [lx = 0, ly = 0] = pad.axes;
      if (Math.abs(lx) > DEADZONE && Math.abs(lx) >= Math.abs(ly)) active.add(lx < 0 ? "left" : "right");
      else if (Math.abs(ly) > DEADZONE) active.add(ly < 0 ? "up" : "down");
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

    raf = requestAnimationFrame(loop);
  };

  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
