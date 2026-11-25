import { create } from "zustand";

/** A abertura em vídeo está na frente do launcher (a música de fundo espera por ela). */
export const useIntro = create<{ playing: boolean }>(() => ({ playing: false }));
