import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { playSound } from "../audio/sounds";
import { scrollContainer, scrollElementIntoView } from "../lib/smoothScroll";
import type { VerticalDirection } from "../input/actions";

interface Props {
  focusKey?: string;
  className?: string;
  /** Disparado pelo botão A (ou Enter). */
  onPress?: () => void;
  onFocus?: () => void;
  /** Devolve true quando a tela trata o direcional vertical. */
  onVerticalPress?: (direction: VerticalDirection) => boolean;
  /**
   * Item ajustável (valores numéricos, listas): ← diminui (-1) e → aumenta (+1)
   * sem mover o foco. Vale para controle e teclado.
   */
  onAdjust?: (step: 1 | -1) => void;
  /** Nome acessível (leitor de tela) quando o conteúdo visível não diz tudo (ex.: capa de jogo só com imagem). */
  label?: string;
  /**
   * Rola o elemento para a vista ao receber foco. true = nos dois eixos; "x" = só na horizontal,
   * centralizando-o dentro do pai (usado quando a tela controla a rolagem vertical sozinha).
   */
  scroll?: boolean | "x";
  /** Quando devolve false, a rolagem ao receber o foco é instantânea (restaurar a posição ao voltar de outra tela). */
  smooth?: () => boolean;
  children: ReactNode | ((focused: boolean) => ReactNode);
}

/** Item navegável pelo controle. Marca data-focused para o CSS e para o botão A. */
export function Focusable({ focusKey, className = "", onPress, onFocus, onVerticalPress, onAdjust, label, scroll = true, smooth, children }: Props) {
  const adjustRef = useRef(onAdjust);
  adjustRef.current = onAdjust;
  const adjust = useCallback((step: 1 | -1) => {
    playSound("move");
    adjustRef.current?.(step);
  }, []);

  const { ref, focused, focusKey: registeredFocusKey } = useFocusable({
    focusKey,
    onFocus: (_, __, details) => {
      if (details.viaDirection || details.event?.type === "keydown") playSound("move");
      const el = ref.current as HTMLElement | null;
      // Leva também o foco do documento ao item: é o que um leitor de tela anuncia. Sem rolar (a rolagem é feita abaixo) e sem
      // tirar o foco de um campo de texto.
      if (el && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement)) el.focus({ preventScroll: true });
      const reduced = document.documentElement.classList.contains("reduce-motion");
      // Rolagem contínua (lib/smoothScroll): com a seta segurada o destino muda a cada passo e a rolagem não trava nem recomeça.
      const animate = !((smooth && !smooth()) || reduced);
      if (el && scroll === "x") {
        // O pai (fileira) precisa ser o offsetParent (position: relative) para o cálculo bater.
        const parent = el.parentElement;
        if (parent) scrollContainer(parent, { left: el.offsetLeft - (parent.clientWidth - el.offsetWidth) / 2 }, animate);
      } else if (el && scroll) {
        scrollElementIntoView(el, { inline: "center", smooth: animate });
      }
      onFocus?.();
    },
    // Setas do teclado (o controle usa o evento "adjust" abaixo, disparado em input/actions.ts).
    onArrowPress: (direction) => {
      if ((direction === "up" || direction === "down") && onVerticalPress?.(direction)) {
        return false;
      }
      if (adjustRef.current && (direction === "left" || direction === "right")) {
        adjust(direction === "left" ? -1 : 1);
        return false;
      }
      return true;
    },
  });

  useEffect(() => {
    const el = ref.current as HTMLElement | null;
    if (!el || !onAdjust) return;
    const handler = (ev: Event) => adjust((ev as CustomEvent<1 | -1>).detail); // i18n-ignore
    el.addEventListener("adjust", handler);
    return () => el.removeEventListener("adjust", handler);
  }, [ref, adjust, !!onAdjust]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onVerticalPress) return;
    const route = (ev: Event) => {
      if (onVerticalPress((ev as CustomEvent<VerticalDirection>).detail)) ev.preventDefault();
    };
    el.addEventListener("vertical-nav", route);
    return () => el.removeEventListener("vertical-nav", route);
  }, [ref, onVerticalPress]);

  return (
    <div
      ref={ref}
      className={`${className} ${focused ? "is-focused" : ""}`}
      data-focused={focused}
      data-focus-key={registeredFocusKey}
      data-adjustable={onAdjust ? "true" : undefined}
      data-vertical-nav={onVerticalPress ? "true" : undefined}
      role={onPress || onAdjust ? "button" : undefined}
      tabIndex={-1}
      aria-label={label}
      onClick={onPress && (() => {
        playSound("select");
        onPress();
      })}
    >
      {typeof children === "function" ? children(focused) : children}
    </div>
  );
}

interface GroupProps {
  focusKey: string;
  className?: string;
  /** Mantém o foco preso dentro do grupo (diálogos). */
  boundary?: boolean;
  preferredChildFocusKey?: string;
  onBlur?: () => void;
  /**
   * Grupo sem nada selecionável dentro. A biblioteca de navegação trata um grupo vazio como um item e o direcional
   * "caía" nele, tirando o foco de onde estava; desativado, o grupo deixa de ser alvo do foco.
   */
  disabled?: boolean;
  children: ReactNode;
}

/** Agrupa itens (uma fileira, uma tela, um diálogo) e lembra o último filho focado. */
export function FocusGroup({ focusKey, className, boundary, preferredChildFocusKey, onBlur, disabled, children }: GroupProps) {
  const { ref, focusKey: key } = useFocusable({
    focusKey,
    focusable: !disabled,
    saveLastFocusedChild: true,
    trackChildren: true,
    isFocusBoundary: boundary,
    preferredChildFocusKey,
    onBlur,
  });
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}
