import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { useUI } from "../store/ui";

// Foco de onde o primeiro modal foi aberto. Fica guardado entre modais encadeados (menu → confirmação)
// e entre as montagens duplas do StrictMode, e só é devolvido quando o último modal fecha.
let savedFocus: string | null = null;
let restoreTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Para diálogos e menus: marca "modal aberto" (o B global fica de fora), leva o foco para
 * `initialFocusKey` e, ao fechar, devolve o foco ao item que o abriu (se ele ainda existir).
 */
export function useModal(initialFocusKey: string) {
  useEffect(() => {
    clearTimeout(restoreTimer);
    if (savedFocus === null) savedFocus = getCurrentFocusKey();
    useUI.getState().setModalOpen(true);
    setFocus(initialFocusKey);

    return () => {
      useUI.getState().setModalOpen(false);
      restoreTimer = setTimeout(() => {
        const target = savedFocus;
        savedFocus = null;
        if (target && doesFocusableExist(target)) setFocus(target);
      }, 0);
    };
  }, [initialFocusKey]);
}
