import { createContext } from 'react';

/*
 * Focus as the game moves it. The keyboard is handled on the whole document
 * (see App), so focus is less about where keys go than about where a
 * keyboard or screen-reader user is: wherever the game moves it, it should
 * land on something that makes sense — the selected cell, usually — never on
 * <body>, and without drawing a keyboard focus ring for a player using a
 * mouse or a finger.
 */

/** How the player last drove the page: a key, or a pointer (mouse, pen or touch). */
type InputModality = 'key' | 'pointer';

/** Null until the first input: a page just loaded has had none, and draws no ring. */
let lastInput: InputModality | null = null;

/**
 * A `mousedown` handler that keeps a mouse press from taking focus, for the
 * on-screen controls (the pad, the mode toggle, Erase, Undo, Redo, the
 * timer, the menus).
 *
 * Focus stays where it was — usually a grid cell — so the keyboard carries
 * on from there, and Space still flips the mode instead of pressing the last
 * control clicked a second time (Space on a focused button is the button's).
 * Keyboard users who Tab to a control still focus it as usual, and a touch
 * never focused a button in the first place.
 */
export function keepFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

/**
 * Follow how the player is driving the page, for `focusQuietly`: any key
 * makes it the keyboard, any pointer press a pointer. Listens in the capture
 * phase, so nothing that stops an event's propagation hides it. Returns a
 * function that stops listening and forgets what it saw.
 */
export function trackInputModality(target: Document = document): () => void {
  const onKeyDown = (): void => {
    lastInput = 'key';
  };
  const onPointerDown = (): void => {
    lastInput = 'pointer';
  };
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('pointerdown', onPointerDown, true);
    lastInput = null;
  };
}

/** Whether the player's last input was a key (see `trackInputModality`). */
export function isUsingKeyboard(): boolean {
  return lastInput === 'key';
}

/**
 * Move focus to `element` from a script. After a key it is focused as usual,
 * and the browser draws its focus ring; after a pointer press, or before any
 * input at all, it is focused without one (`focusVisible: false`) — a ring
 * that appears around Start as the page loads, or follows a tap onto a cell,
 * is noise to a player who is not using the keyboard. Browsers that do not
 * know the option ignore it, and decide for themselves.
 */
export function focusQuietly(element: HTMLElement | null | undefined): void {
  element?.focus(lastInput === 'key' ? undefined : { focusVisible: false });
}

/**
 * Moves focus to the game's home — the selected cell, or whatever stands in
 * the board's place — and says whether it found one.
 */
export type FocusHome = () => boolean;

/** The focus the guard last saw land, and whether a dialog holds it (dialogs look after their own). */
interface LastFocus {
  element: Element;
  isInDialog: boolean;
}

/**
 * Keep focus from dropping to <body> when the control holding it goes —
 * removed from the page or disabled: Undo emptying its stack, the pad as the
 * last digit solves the puzzle, the timer turning into the final time, a
 * notice's Dismiss, a menu's item as the menu closes. Tab would start again
 * from the top of the page, and a screen reader lose its place, so focus goes
 * home instead (`focusHome`).
 *
 * Driven by the page's own events, not by whichever component happens to
 * re-render: a focus loss to nowhere (`focusout` with no `relatedTarget`),
 * and any removal or disabling in the page (a MutationObserver) — Safari
 * fires no `focusout` for a focused element that is removed, and jsdom
 * neither. Either is only a reason to look: the check runs a frame later,
 * once whatever caused it has finished moving focus itself. A press on a
 * blank part of the page moves focus to nothing as part of the press, after
 * the menu it closed has already gone, and going home any sooner would be
 * undone by it.
 *
 * It never takes focus that went somewhere on purpose: focus that moved to
 * another element, focus in or behind a modal dialog (which keeps its own),
 * or focus the player sent to nothing themselves, by pressing a blank part of
 * the page with nothing taken away — that is forgotten, so nothing removed
 * later pulls focus back to the board. Returns a function that stops
 * watching.
 */
export function guardFocus(focusHome: FocusHome, target: Document = document): () => void {
  let last: LastFocus | null = null;
  let frame = 0;

  const isNowhere = (element: Element | null): boolean =>
    element === null || element === target.body || element === target.documentElement;
  const isGone = (element: Element): boolean =>
    !element.isConnected || element.matches(':disabled');

  const check = (): void => {
    frame = 0;
    if (last === null || last.isInDialog) return;
    if (target.querySelector('[aria-modal="true"]') !== null) return;
    const active = target.activeElement;
    if (!isNowhere(active)) {
      // Some browsers leave focus on a control that has just been disabled.
      if (active?.matches(':disabled')) focusHome();
      return;
    }
    if (isGone(last.element)) focusHome();
    else last = null;
  };

  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(check);
  };

  const onFocusIn = (event: FocusEvent): void => {
    const element = event.target as Element;
    last = { element, isInDialog: element.closest('[role="dialog"]') !== null };
  };
  const onFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget === null) schedule();
  };
  const observer = new MutationObserver(() => {
    if (last !== null && isGone(last.element)) schedule();
  });

  target.addEventListener('focusin', onFocusIn);
  target.addEventListener('focusout', onFocusOut);
  observer.observe(target.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled'],
  });
  return () => {
    target.removeEventListener('focusin', onFocusIn);
    target.removeEventListener('focusout', onFocusOut);
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

/**
 * The game's focus home, for components that give focus back when they go:
 * a dialog whose opener has left the page (or was <body>, for one that
 * opened by itself) sends focus here rather than letting it drop to the
 * page. The App provides it; without one there is no home to go to.
 */
export const FocusHomeContext = createContext<FocusHome>(() => false);
