import { createContext, useContext } from "react";

/** true dentro de uma prévia ao vivo: o que é interativo na tela real (botões focáveis) vira só desenho. */
export const PreviewContext = createContext(false);

export function useInPreview(): boolean {
  return useContext(PreviewContext);
}
