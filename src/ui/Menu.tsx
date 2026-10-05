import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { CheckIcon } from './icons';
import { focusQuietly, keepFocus } from './keepFocus';

/** One entry in a menu. */
export interface MenuItem {
  /** Unique within the menu. */
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /**
   * Marks the item that stands for what is current — the tier on show, in
   * New game — with a check, and "(current)" in its name. It is still a
   * command, not a radio button: choosing it does what choosing any other
   * item does.
   */
  isCurrent?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  /** The accessible name of the button, and of the menu it opens. */
  label: string;
  /** What the button shows — usually an icon, as the label names it. */
  children: ReactNode;
  items: readonly MenuItem[];
  /** A visible heading at the top of the menu. */
  heading?: string;
  /** Disabled: the button cannot be pressed, and an open menu closes. */
  disabled?: boolean;
  /** Which way the menu opens: below the button (the header), or above it (the bottom of a phone screen). */
  placement?: 'below' | 'above';
  /** Extra classes for the wrapper (positioning) and the button (look). */
  className?: string;
  buttonClassName?: string;
}

/** The item to focus first: the first enabled one, or the last when opened with ArrowUp. */
type OpenFocus = 'first' | 'last';

/** Where focus goes as the menu closes: its button, or back to where it was before it opened. */
type CloseFocus = 'button' | 'back';

/**
 * Where a click sends focus as it closes the menu — or, opening it, where
 * Escape will. A click from Enter or Space has no click count, and goes to
 * the button; a mouse press or a tap has one, and goes back.
 */
function closeFocusFor(event: React.MouseEvent): CloseFocus {
  return event.detail === 0 ? 'button' : 'back';
}

/**
 * A menu button, as the WAI-ARIA authoring practices describe it: the button
 * says it has a popup and whether it is expanded; opening moves focus into
 * the menu; the arrow keys (and Home/End) move between the enabled items;
 * Escape closes and hands focus back; Tab and Shift+Tab close as focus moves
 * on; pressing anywhere outside closes. So does focus leaving the menu any
 * other way — the Paused card taking it as the tab hides, another window —
 * as a menu left open where its keys no longer reach would linger over
 * whatever took focus, with Escape unable to close it.
 *
 * Closed by an item, its button or Escape, the menu hands focus on itself,
 * before it goes, so focus never drops to the page with it — and before an
 * item runs, so a dialog the item opens finds somewhere live to send focus
 * back to. Opened or chosen from the keyboard, that is the button, as the
 * practices have it. With a pointer, it is wherever focus was before the menu
 * opened (the selected cell, usually): a mouse press on the button or an
 * item never takes focus (`keepFocus`), so a mouse player's Space keeps
 * switching the mode rather than opening the menu again. (Closed by a press
 * outside, focus is left to the press, and to `guardFocus` if it falls to
 * the page.)
 */
export function Menu({
  label,
  children,
  items,
  heading,
  disabled = false,
  placement = 'below',
  className,
  buttonClassName,
}: MenuProps) {
  const [openWith, setOpenWith] = useState<OpenFocus | null>(null);
  // A menu whose button is disabled closes, and stays closed: left open
  // underneath, it would spring back the moment the button was enabled again.
  // Adjusted while rendering, as React suggests for state that follows a prop.
  if (disabled && openWith !== null) setOpenWith(null);
  const isOpen = openWith !== null && !disabled;
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // What had focus as the menu opened, for a pointer's choice to return to.
  const backRef = useRef<Element | null>(null);
  // Where Escape sends focus: back for a menu a pointer opened, else the button.
  const escapeRef = useRef<CloseFocus>('button');
  // Tab or Shift+Tab was pressed in the menu: it closes as focus moves on,
  // even onto its own button.
  const isTabbingRef = useRef(false);

  const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]));

  const focusItem = (index: number | undefined): void => {
    if (index !== undefined) focusQuietly(itemRefs.current[index]);
  };

  const open = (where: OpenFocus, escapeTo: CloseFocus): void => {
    backRef.current = document.activeElement;
    escapeRef.current = escapeTo;
    isTabbingRef.current = false;
    setOpenWith(where);
  };

  const focusOnOpen = useEffectEvent((where: OpenFocus) => {
    focusItem(where === 'first' ? enabled[0] : enabled.at(-1));
  });

  useEffect(() => {
    if (openWith === null || disabled) return undefined;
    focusOnOpen(openWith);
    // `pointerdown`, not `mousedown`: iOS only synthesises compatibility
    // mouse events for elements it deems clickable, so tapping the plain
    // background would leave the menu stuck open.
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenWith(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openWith, disabled]);

  const close = (focus: CloseFocus): void => {
    const back = backRef.current;
    // Somewhere still on the page, and somewhere in particular.
    const isBackUsable = back instanceof HTMLElement && back.isConnected && back !== document.body;
    focusQuietly(focus === 'back' && isBackUsable ? back : buttonRef.current);
    setOpenWith(null);
  };

  const choose = (item: MenuItem, event: React.MouseEvent): void => {
    close(closeFocusFor(event));
    item.onSelect();
  };

  const handleButtonKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open(event.key === 'ArrowUp' ? 'last' : 'first', 'button');
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    const at = enabled.indexOf(
      itemRefs.current.indexOf(document.activeElement as HTMLButtonElement),
    );
    let target: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = enabled[(at + 1) % enabled.length];
        break;
      case 'ArrowUp':
        target = enabled[(at - 1 + enabled.length) % enabled.length];
        break;
      case 'Home':
        target = enabled[0];
        break;
      case 'End':
        target = enabled.at(-1);
        break;
      case 'Escape':
        // Claimed, so nothing else listening on the document acts on it too.
        event.preventDefault();
        close(escapeRef.current);
        return;
      case 'Tab':
        // Focus moves on by itself, and the menu closes as it goes (see
        // `handleBlur`). Not before: taken out from under the focus, the menu
        // would leave the browser nowhere to move on from, and Safari drops
        // focus to the page instead.
        isTabbingRef.current = true;
        return;
      default:
        return;
    }
    // Claimed, so the game's document-level arrow keys leave the board alone.
    event.preventDefault();
    focusItem(target);
  };

  // A focus event, not a key or a press: whatever moved focus out of the
  // menu, the menu goes with it.
  const handleBlur = (event: React.FocusEvent) => {
    if (!isOpen) return;
    const isLeaving = !rootRef.current?.contains(event.relatedTarget as Node | null);
    if (isLeaving || isTabbingRef.current) setOpenWith(null);
  };

  return (
    <div
      className={className === undefined ? 'menu' : `menu ${className}`}
      ref={rootRef}
      onBlur={handleBlur}
    >
      <button
        type="button"
        className={buttonClassName}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        disabled={disabled}
        ref={buttonRef}
        onMouseDown={keepFocus}
        onClick={(event) =>
          isOpen ? close(closeFocusFor(event)) : open('first', closeFocusFor(event))
        }
        onKeyDown={handleButtonKeyDown}
      >
        {children}
      </button>
      {isOpen && (
        <div
          className={`menu__popup menu__popup--${placement}`}
          role="menu"
          id={menuId}
          aria-label={label}
          // Focusable (though never a tab stop) as a menu must be; focus
          // itself sits on the items.
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
        >
          {heading !== undefined && (
            <div className="menu__heading" aria-hidden="true">
              {heading}
            </div>
          )}
          {items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              className="menu__item"
              role="menuitem"
              // The visible label, then what the check beside it means.
              aria-label={item.isCurrent === true ? `${item.label} (current)` : undefined}
              tabIndex={-1}
              disabled={item.disabled}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              onMouseDown={keepFocus}
              onClick={(event) => choose(item, event)}
            >
              {item.icon !== undefined && <span className="menu__icon">{item.icon}</span>}
              <span className="menu__label">{item.label}</span>
              {item.isCurrent === true && <CheckIcon className="menu__check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
