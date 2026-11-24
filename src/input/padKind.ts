import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Família do controle: define só o que aparece na tela (ícones dos botões). A navegação é a mesma, pela posição dos botões. */
export type PadKind = "xbox" | "playstation";
export type PadIcons = "auto" | PadKind;

export const PAD_ICON_CHOICES: { id: PadIcons; name: string }[] = [
  { id: "auto", name: "Automático" },
  { id: "xbox", name: "Xbox" },
  { id: "playstation", name: "PlayStation" },
];

interface PadKindStore {
  /** Escolha do jogador: "auto" segue o controle que estiver em uso. */
  icons: PadIcons;
  /** O que o último controle usado parece ser (não é salvo: refeito a cada abertura). */
  detected: PadKind;
  setIcons: (icons: PadIcons) => void;
  setDetected: (kind: PadKind) => void;
}

export const usePadKind = create<PadKindStore>()(
  persist(
    (set, get) => ({
      icons: "auto",
      detected: "xbox",
      setIcons: (icons) => set({ icons }),
      setDetected: (kind) => {
        if (get().detected !== kind) set({ detected: kind });
      },
    }),
    { name: "launcher-pad-icons", partialize: (s) => ({ icons: s.icons }) },
  ),
);

/** Qual família de ícones desenhar agora. */
export function useGlyphKind(): PadKind {
  return usePadKind((s) => (s.icons === "auto" ? s.detected : s.icons));
}

/** Descobre a família pelo identificador que o navegador dá ao controle (ex.: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"). */
export function kindFromGamepadId(id: string): PadKind {
  const s = id.toLowerCase();
  if (/vendor:\s*054c|^054c-|dualsense|dualshock|playstation|wireless controller/.test(s)) return "playstation";
  return "xbox";
}

/** Escolhe, entre os controles que o navegador enxerga, o que está em uso (o com algum botão apertado; senão o primeiro conectado). */
export function detectPadKind(pads: ArrayLike<Gamepad | null>): PadKind | null {
  let first: Gamepad | null = null;
  for (const p of Array.from(pads)) {
    if (!p || !p.connected) continue;
    if (p.buttons.some((b) => b.pressed)) return kindFromGamepadId(p.id);
    first ??= p;
  }
  return first ? kindFromGamepadId(first.id) : null;
}

/** Texto do botão em cada família. A posição é a mesma: A = ✕ (embaixo), B = ○ (direita), X = □ (esquerda), Y = △ (em cima). */
const PLAYSTATION: Record<string, string> = {
  A: "✕", B: "○", X: "□", Y: "△",
  LB: "L1", RB: "R1", LT: "L2", RT: "R2",
  Start: "Options", Select: "Create",
};

export function glyphText(btn: string, kind: PadKind): string {
  if (btn === "LR") return "◀ ▶";
  return kind === "playstation" ? PLAYSTATION[btn] ?? btn : btn;
}
