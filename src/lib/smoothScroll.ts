/**
 * Rolagem suave que aguenta o direcional apertado e segurado.
 *
 * `scrollIntoView({ behavior: "smooth" })` e `scrollTo({ behavior: "smooth" })` começam uma animação nova a cada chamada, e o
 * navegador descarta a anterior. Com a seta segurada o foco anda a cada ~100 ms, então a rolagem recomeçava o tempo todo:
 * parecia travada, e ao soltar pulava de uma vez para o fim. Aqui cada container tem UMA animação contínua que só troca de
 * destino: a rolagem persegue o destino mais recente com um amortecimento exponencial, sem parar nem recomeçar.
 */

interface Motion {
  /** Destino atual. */
  left: number;
  top: number;
  frame: number;
  last: number;
}

const motions = new WeakMap<Element, Motion>();
/** Constante de tempo do amortecimento (ms): menor = mais seco, maior = mais "deslizante". */
const TAU = 75;
const EPSILON = 0.4;

const maxLeft = (el: Element) => Math.max(0, el.scrollWidth - el.clientWidth);
const maxTop = (el: Element) => Math.max(0, el.scrollHeight - el.clientHeight);
const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

/** Rola `el` até (left, top). Sem `smooth`, vai direto e cancela qualquer animação em curso. */
export function scrollContainer(el: Element, target: { left?: number; top?: number }, smooth: boolean) {
  const left = clamp(target.left ?? el.scrollLeft, maxLeft(el));
  const top = clamp(target.top ?? el.scrollTop, maxTop(el));
  const motion = motions.get(el);
  if (!smooth) {
    if (motion) {
      cancelAnimationFrame(motion.frame);
      motions.delete(el);
    }
    el.scrollTo({ left, top, behavior: "instant" });
    return;
  }
  if (motion) {
    // Já está rolando para cá: só troca o destino (o que está no meio do caminho continua de onde estava).
    motion.left = target.left === undefined ? motion.left : left;
    motion.top = target.top === undefined ? motion.top : top;
    return;
  }
  const next: Motion = { left, top, frame: 0, last: performance.now() };
  motions.set(el, next);
  const step = (now: number) => {
    const dt = Math.min(64, Math.max(1, now - next.last));
    next.last = now;
    const k = 1 - Math.exp(-dt / TAU);
    const dx = next.left - el.scrollLeft;
    const dy = next.top - el.scrollTop;
    if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) {
      el.scrollTo({ left: next.left, top: next.top, behavior: "instant" });
      motions.delete(el);
      return;
    }
    el.scrollTo({ left: el.scrollLeft + dx * k, top: el.scrollTop + dy * k, behavior: "instant" });
    next.frame = requestAnimationFrame(step);
  };
  next.frame = requestAnimationFrame(step);
}

const px = (value: string) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Traz `el` para a vista, como `scrollIntoView({ block: "nearest", inline })`, em cada container rolável acima dele, mas com
 * a rolagem contínua de `scrollContainer`. Respeita `scroll-padding` do container e `scroll-margin` do elemento.
 */
export function scrollElementIntoView(el: HTMLElement, options: { inline: "center" | "nearest" | "none"; smooth: boolean }) {
  // Quanto o elemento vai se mover na tela por causa das rolagens já decididas nos containers de dentro.
  let shiftX = 0;
  let shiftY = 0;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.body || parent === document.documentElement) break;
    const style = getComputedStyle(parent);
    const canY = /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1;
    const canX = /(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1;
    if (!canX && !canY) continue;

    const box = parent.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const target: { left?: number; top?: number } = {};
    // Com `zoom` no CSS (interface ampliada), as posições na tela vêm em pixels ampliados e a rolagem é medida nos do
    // próprio container: sem converter, o item em foco ficava parte fora da vista.
    const zoom = (parent as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;

    if (canY) {
      const viewTop = box.top + (parent.clientTop + px(style.scrollPaddingTop)) * zoom;
      const viewBottom = box.top + (parent.clientTop + parent.clientHeight - px(style.scrollPaddingBottom)) * zoom;
      const marginTop = px(getComputedStyle(el).scrollMarginTop) * zoom;
      const marginBottom = px(getComputedStyle(el).scrollMarginBottom) * zoom;
      const top = rect.top - shiftY - marginTop;
      const bottom = rect.bottom - shiftY + marginBottom;
      let delta = 0;
      if (bottom - top > viewBottom - viewTop || top < viewTop) delta = top - viewTop;
      else if (bottom > viewBottom) delta = bottom - viewBottom;
      if (delta !== 0) target.top = clamp(parent.scrollTop + delta / zoom, maxTop(parent));
    }
    if (canX && options.inline !== "none") {
      const viewLeft = box.left + parent.clientLeft * zoom;
      const viewRight = viewLeft + parent.clientWidth * zoom;
      const left = rect.left - shiftX;
      const right = rect.right - shiftX;
      let delta = 0;
      if (options.inline === "center") delta = left + rect.width / 2 - (viewLeft + (parent.clientWidth * zoom) / 2);
      else if (left < viewLeft) delta = left - viewLeft;
      else if (right > viewRight) delta = right - viewRight;
      if (delta !== 0) target.left = clamp(parent.scrollLeft + delta / zoom, maxLeft(parent));
    }

    // O elemento já está à vista de onde a rolagem está agora: se ela ainda estava indo para um destino antigo (seta segurada
    // e depois solta, ou invertida), para aqui em vez de passar do ponto.
    if (motions.has(parent)) {
      if (canY && target.top === undefined) target.top = parent.scrollTop;
      if (canX && options.inline !== "none" && target.left === undefined) target.left = parent.scrollLeft;
    }

    if (target.left !== undefined || target.top !== undefined) {
      scrollContainer(parent, target, options.smooth);
      shiftX += ((target.left ?? parent.scrollLeft) - parent.scrollLeft) * zoom;
      shiftY += ((target.top ?? parent.scrollTop) - parent.scrollTop) * zoom;
    }
  }
}
