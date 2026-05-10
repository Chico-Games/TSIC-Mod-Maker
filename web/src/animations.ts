// Lightweight DOM-based "flying clone" animations. Used for slot swaps and
// recipe-to-station moves.
//
// Pattern: clone a source element, position it absolutely at the source's
// current rect, then animate to a target rect. The actual data swap happens
// in between so the static layout settles to its new state while the clones
// fly on top.

const DURATION_SWAP = 320;
const DURATION_MOVE = 380;
const EASING = 'cubic-bezier(0.2, 0.85, 0.2, 1)';

interface FlyOpts {
  duration?: number;
  fade?: boolean;
  scale?: number;
}

function makeClone(el: HTMLElement, rect: DOMRect): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('input, button, select, textarea').forEach((n) => {
    (n as HTMLElement).style.pointerEvents = 'none';
  });
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    zIndex: '9000',
    pointerEvents: 'none',
    transformOrigin: 'top left',
    transition: 'none',
  });
  return clone;
}

export function flyClone(
  sourceEl: HTMLElement,
  fromRect: DOMRect,
  toRect: DOMRect,
  opts: FlyOpts = {},
): Promise<void> {
  const duration = opts.duration ?? DURATION_SWAP;
  const clone = makeClone(sourceEl, fromRect);
  document.body.appendChild(clone);

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clone.style.transition = `left ${duration}ms ${EASING}, top ${duration}ms ${EASING}, width ${duration}ms ${EASING}, height ${duration}ms ${EASING}, transform ${duration}ms ${EASING}, opacity ${duration}ms ${EASING}`;
        clone.style.left = `${toRect.left}px`;
        clone.style.top = `${toRect.top}px`;
        clone.style.width = `${toRect.width}px`;
        clone.style.height = `${toRect.height}px`;
        if (opts.scale !== undefined) clone.style.transform = `scale(${opts.scale})`;
        if (opts.fade) clone.style.opacity = '0';
      });
    });
    setTimeout(() => {
      clone.remove();
      resolve();
    }, duration + 60);
  });
}

/**
 * Animate a swap: BOTH the dragged item and the displaced item visually fly
 * to their new positions. Source stays visible during drag (caller decides),
 * so when the swap fires we have honest "before" rects for both items, and
 * we render two clones swapping in mid-air.
 */
export async function animateSlotSwap(
  sourceSlotEl: HTMLElement | null,
  targetSlotEl: HTMLElement | null,
  swapFn: () => Promise<void>,
): Promise<void> {
  if (!sourceSlotEl || !targetSlotEl) {
    await swapFn();
    return;
  }

  // Capture both contents + rects BEFORE the swap so the clones reflect what
  // the user just saw on screen.
  const aContent = sourceSlotEl.querySelector<HTMLElement>('.grid-slot-content');
  const bContent = targetSlotEl.querySelector<HTMLElement>('.grid-slot-content');
  const aRect = aContent?.getBoundingClientRect() ?? null;
  const bRect = bContent?.getBoundingClientRect() ?? null;
  const aClone = aContent && aRect ? makeClone(aContent, aRect) : null;
  const bClone = bContent && bRect ? makeClone(bContent, bRect) : null;
  if (aClone) document.body.appendChild(aClone);
  if (bClone) document.body.appendChild(bClone);

  await swapFn();

  // After swap, the items have crossed: A now holds old B; B now holds old A.
  // Hide the settled DOM content while the clones fly, then unhide.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const newAContent = sourceSlotEl.querySelector<HTMLElement>('.grid-slot-content');
  const newBContent = targetSlotEl.querySelector<HTMLElement>('.grid-slot-content');
  const newARect = newAContent?.getBoundingClientRect() ?? null;
  const newBRect = newBContent?.getBoundingClientRect() ?? null;
  if (newAContent) newAContent.style.opacity = '0';
  if (newBContent) newBContent.style.opacity = '0';

  // Animate both clones to their counterpart slots simultaneously.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      const transition = `left ${DURATION_SWAP}ms ${EASING}, top ${DURATION_SWAP}ms ${EASING}, width ${DURATION_SWAP}ms ${EASING}, height ${DURATION_SWAP}ms ${EASING}`;
      if (aClone && newBRect) {
        aClone.style.transition = transition;
        aClone.style.left = `${newBRect.left}px`;
        aClone.style.top = `${newBRect.top}px`;
        aClone.style.width = `${newBRect.width}px`;
        aClone.style.height = `${newBRect.height}px`;
      }
      if (bClone && newARect) {
        bClone.style.transition = transition;
        bClone.style.left = `${newARect.left}px`;
        bClone.style.top = `${newARect.top}px`;
        bClone.style.width = `${newARect.width}px`;
        bClone.style.height = `${newARect.height}px`;
      }
      setTimeout(resolve, DURATION_SWAP + 50);
    });
  });

  if (aClone) aClone.remove();
  if (bClone) bClone.remove();
  if (newAContent) newAContent.style.opacity = '';
  if (newBContent) newBContent.style.opacity = '';
}

/**
 * Animate recipe move-to-station. The source card is NOT pre-emptively hidden;
 * the move state update removes it from the list naturally. We capture the
 * card's pre-update rect and fly a clone to the destination station row.
 */
export async function animateRecipeMove(
  cardEl: HTMLElement | null,
  stationRowEl: HTMLElement | null,
  moveFn: () => Promise<void>,
): Promise<void> {
  if (!cardEl || !stationRowEl) {
    await moveFn();
    return;
  }
  const fromRect = cardEl.getBoundingClientRect();
  const toRect = stationRowEl.getBoundingClientRect();

  // Build the clone BEFORE moveFn so we capture the live, fully-rendered state
  // of the card (with all its child styling intact).
  const clone = makeClone(cardEl, fromRect);
  document.body.appendChild(clone);

  await moveFn();

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clone.style.transition = `left ${DURATION_MOVE}ms ${EASING}, top ${DURATION_MOVE}ms ${EASING}, width ${DURATION_MOVE}ms ${EASING}, height ${DURATION_MOVE}ms ${EASING}, transform ${DURATION_MOVE}ms ${EASING}, opacity ${DURATION_MOVE}ms ${EASING}`;
        clone.style.left = `${toRect.left}px`;
        clone.style.top = `${toRect.top}px`;
        clone.style.width = `${toRect.width}px`;
        clone.style.height = `${toRect.height}px`;
        clone.style.transform = 'scale(0.5)';
        clone.style.opacity = '0';
      });
      setTimeout(resolve, DURATION_MOVE + 50);
    });
  });

  clone.remove();
}

/**
 * Quick highlight pulse for any element (uses a CSS animation class added briefly).
 */
export function pulse(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove('flash-pulse');
  void el.offsetWidth;
  el.classList.add('flash-pulse');
  setTimeout(() => el.classList.remove('flash-pulse'), 700);
}
