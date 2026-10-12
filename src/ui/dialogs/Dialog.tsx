import { use, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CloseIcon } from '../icons';
import { FocusHomeContext, focusQuietly, isUsingKeyboard } from '../keepFocus';

export interface DialogProps {
  /**
   * The heading, which also names the dialog for assistive technology. Words,
   * or words with a name from a link kept apart in a <bdi>.
   */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /**
   * Actions pinned below the body, primary first. They stay in view while a
   * long body scrolls, so "Share your time" is never below the fold of a phone.
   */
  footer?: ReactNode;
  /** Extra classes for the card, such as the `dialog--wide` modifier. */
  className?: string;
  /**
   * The id (or space-separated ids) of the text that explains the dialog. A
   * screen reader reads it with the dialog's name as focus moves in, so the
   * point of the dialog is not skipped when focus lands on a button below it.
   */
  describedBy?: string;
}

/**
 * Everything focusable we put inside a dialog. `[tabindex="-1"]` is excluded
 * deliberately: that is how the dialog container itself is made focusable, and
 * it must not become a tab stop.
 */
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * The dialog's tab stops in document order, as the browser decides them —
 * which is narrower than matching FOCUSABLE. Getting this wrong breaks the
 * trap at its ends: if the "last stop" is one the browser skips, Tab from the
 * real last stop is not intercepted and walks out of the modal.
 */
function tabStops(node: HTMLElement): HTMLElement[] {
  const candidates = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
  return candidates.filter((element) => {
    // A roving tabindex (the History filter tabs) parks inactive items at -1.
    if (element.tabIndex < 0 || element.hasAttribute('disabled')) return false;
    // The History import's file input is `hidden`, and clicked through a button.
    if (element.closest('[hidden]') !== null) return false;
    // Nor does the browser stop on what a stylesheet hides: the guide's list
    // on a phone, its picker on a desktop. (Where checkVisibility is missing,
    // as in jsdom, nothing is taken to be hidden this way.)
    if (element.checkVisibility?.() === false) return false;
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio') return true;
    // Tab visits a radio group once — at its checked radio, or at the first
    // one while none is checked — never at each option.
    const group = candidates.filter(
      (other): other is HTMLInputElement =>
        other instanceof HTMLInputElement && other.type === 'radio' && other.name === element.name,
    );
    return element === (group.find((radio) => radio.checked) ?? group[0]);
  });
}

/** Whether focus can go back to `element`: something in particular, still on the page. */
function isUsable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && element !== document.body;
}

/**
 * The modal every dialog is built on: a card on a translucent scrim, with a
 * title, a close button, a scrolling body and optional pinned actions. Under
 * 500px wide it becomes a bottom sheet (see dialogs.css).
 *
 * Behaviour is minesweeper's: focus moves in on open (to the element marked
 * `data-autofocus`, else the first focusable one), Tab and Shift+Tab wrap
 * inside, Escape closes, pressing the scrim closes, and focus goes back to
 * whatever opened the dialog when it unmounts. The App decides whether it is
 * open by rendering it or not.
 *
 * Where focus goes back to bends in two cases. A dialog opened with a
 * pointer gives it to the game's focus home (the selected cell) if there is
 * one: a mouse player's next Space should switch the mode, not press the
 * button that opened the dialog again. And an opener that has left the page
 * — a cell under a board the dialog hid, the <body> a dialog opened by
 * itself found focused — is no place to go back to, so focus goes home
 * instead (see `FocusHomeContext`).
 *
 * A body too long for the card becomes a tab stop, labelled by the title,
 * so the keyboard can scroll it: with nothing focusable inside (Help), it
 * would otherwise be out of reach.
 */
export function Dialog({ title, onClose, children, footer, className, describedBy }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const focusHome = use(FocusHomeContext);
  const homeRef = useRef(focusHome);
  const [isScrollable, setScrollable] = useState(false);

  useLayoutEffect(() => {
    homeRef.current = focusHome;
  });

  /*
   * Focus management.
   *
   * `aria-modal` hides the rest of the document from assistive technology, so
   * a dialog that does not also take focus leaves a screen reader user with
   * nothing to read — and Tab walks the board behind it.
   */
  useEffect(() => {
    const opener = document.activeElement;
    const isOpenedByPointer = !isUsingKeyboard();
    // Always attached by now: the card renders unconditionally.
    const node = dialogRef.current!;
    // A dialog says which control it opens on, because document order is a bad
    // default: it would always be the close button, when a confirmation wants
    // Enter on its safe choice and the solved dialog on "Share your time".
    // Failing a nominee, the first stop — there is always one, the close button.
    const first = node.querySelector<HTMLElement>('[data-autofocus]') ?? tabStops(node)[0];
    focusQuietly(first);
    // Selected, not just focused: typing should replace the old text rather
    // than append to it.
    if (first instanceof HTMLInputElement) first.select();

    // Run as the dialog unmounts, by when whatever replaces it is on the page.
    return () => {
      if (isOpenedByPointer && homeRef.current()) return;
      if (isUsable(opener)) focusQuietly(opener);
      else homeRef.current();
    };
  }, []);

  // Whether the body overflows, kept up to date as the card or its content
  // changes size (rotating a phone, zooming, a list growing).
  useLayoutEffect(() => {
    const body = bodyRef.current!;
    // A pixel's slack: fractional layout can round scrollHeight up by one.
    const measure = () => setScrollable(body.scrollHeight - body.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    for (const child of body.children) observer.observe(child);
    return () => observer.disconnect();
  });

  useEffect(() => {
    const node = dialogRef.current!;
    const handleKey = (event: KeyboardEvent) => {
      // Something inside claimed the key first — the History list uses Escape
      // to back out of an inline delete confirmation without closing.
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Never empty: the close button is always a stop.
      const stops = tabStops(node);
      const first = stops[0];
      const last = stops[stops.length - 1];
      // Position among the stops, not merely "inside the dialog". The container
      // is inside itself and is focusable, so clicking the title or any body
      // text lands focus on it — and treating that as "already contained" let
      // Shift+Tab walk straight out of an open modal onto the board.
      const active = document.activeElement;
      const at = stops.indexOf(active as HTMLElement);
      // Focus resting inside on something only a script can focus — the
      // guide's entry heading — has a place in the order all the same: Tab
      // goes on to the stop after it, Shift+Tab back to the one before, as
      // the browser does by itself. Only from the far end does it wrap.
      if (at === -1 && active instanceof HTMLElement && active !== node && node.contains(active)) {
        const isAfter = (stop: HTMLElement) =>
          (active.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        if (event.shiftKey ? !stops.every(isAfter) : stops.some(isAfter)) return;
      }
      if (event.shiftKey && at <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (at === -1 || at === stops.length - 1)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // `pointerdown` rather than `mousedown`: the scrim is a plain div, and iOS
  // only synthesises compatibility mouse events for elements it considers
  // clickable — so tap-outside-to-close would silently do nothing on iPad.
  const handleOverlayPointerDown = (event: React.PointerEvent) => {
    // Close only when the scrim itself is pressed, not the card on it.
    if (event.target !== event.currentTarget) return;
    // Without this the browser's own focus-on-press runs after the dialog has
    // unmounted and restored focus, and lands on <body> because the scrim is
    // not focusable — so closing this way lost the keyboard's place.
    event.preventDefault();
    onClose();
  };

  return (
    <div className="dialog-overlay" role="presentation" onPointerDown={handleOverlayPointerDown}>
      <div
        className={className ? `dialog ${className}` : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="dialog__header">
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="dialog__close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div
          className={isScrollable ? 'dialog__body dialog__body--scrollable' : 'dialog__body'}
          ref={bodyRef}
          {...(isScrollable && { tabIndex: 0, role: 'region', 'aria-labelledby': titleId })}
        >
          {children}
        </div>
        {footer !== undefined && <div className="dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}
