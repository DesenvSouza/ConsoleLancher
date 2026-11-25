import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Assistente de primeira configuração: abre sozinho na primeira vez em que o launcher é usado e pode ser aberto de novo em
 * Configurações › Sistema e energia.
 */
interface SetupStore {
  /** O assistente já foi concluído (ou pulado): não abre mais sozinho. */
  completed: boolean;
  /** Etapa em que o jogador está: ao voltar de uma subtela (contas, inicialização), ou depois de trocar o idioma, continua nela. */
  step: number;
  setStep: (step: number) => void;
  /** Marca como concluído e volta ao começo para a próxima vez. */
  finish: () => void;
  /** Abre o assistente do início (Configurações › Sistema e energia). */
  restart: () => void;
}

/**
 * Uma instalação que já era usada antes do assistente existir (qualquer outra configuração guardada) não deve ser interrompida
 * por ele: só instalações novas, sem nada guardado, começam por ele.
 */
function alreadyConfigured(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      if (key.startsWith("launcher-") && key !== "launcher-setup" && key !== "launcher-language" && key !== "launcher-downloads") return true;
    }
  } catch {
    // Sem armazenamento (modo de teste): trata como instalação nova.
  }
  return false;
}

export const useSetup = create<SetupStore>()(
  persist(
    (set) => ({
      completed: alreadyConfigured(),
      step: 0,
      setStep: (step) => set({ step }),
      finish: () => set({ completed: true, step: 0 }),
      restart: () => set({ step: 0 }),
    }),
    { name: "launcher-setup", version: 1 },
  ),
);

/** O assistente deve abrir agora (primeira utilização)? */
export function needsSetup(): boolean {
  return !useSetup.getState().completed;
}
