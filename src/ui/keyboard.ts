import type { Digit, Direction } from '../core';

/*
 * What a key press means to the game. A pure mapping, so every chord can be
 * tested from a table; the document-level handler that uses it decides when
 * keys count at all (not with a dialog open, not while typing in a field) and
 * calls preventDefault for anything that maps to a command.
 */

/** A game command a key can give. */
export type KeyCommand =
  | { type: 'digit'; digit: Digit }
  | { type: 'erase' }
  | { type: 'move'; direction: Direction }
  | { type: 'toggleMode' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'pause' };

/** The parts of a KeyboardEvent the mapping reads. */
export type KeyInput = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>;

/** The top-row and numpad keys, by physical position. */
const DIGIT_CODE = /^(?:Digit|Numpad)(\d)$/;

const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * The digit a key stands for, from its physical position first.
 *
 * `event.key` is no use while Shift or Alt is held — and holding one is how
 * a player flips into candidate mode for a single entry. Shift+5 is '%',
 * Option+5 on a Mac is '∞', and on an AZERTY keyboard the unshifted top row
 * is punctuation anyway. The code says which key it was regardless (NYT
 * reads the key code for the same reason).
 *
 * The numpad counts whatever Num Lock says: in a number game that is what
 * the numpad is for, and with Num Lock on, Windows reports Shift+Numpad8 as
 * ArrowUp — reading the key there would turn Shift-for-candidate into a move.
 *
 * Only a key with no digit code falls back to `event.key`: some on-screen
 * keyboards report an empty or "Unidentified" code. Zero is never a digit
 * here; Sudoku has no use for it.
 */
function digitOf(event: KeyInput): Digit | null {
  const match = DIGIT_CODE.exec(event.code);
  const digit = match === null ? event.key : match[1];
  return /^[1-9]$/.test(digit) ? (Number(digit) as Digit) : null;
}

/**
 * The letter a key stands for: the character it types when that is a Latin
 * letter — so Ctrl+Z is undo where Z is printed on an AZERTY keyboard — else
 * the physical key, so the shortcut still works on a Cyrillic or Greek layout,
 * where Z's key types another letter entirely (as the browser's own Ctrl+Z
 * does).
 */
function letterOf(event: KeyInput): string | null {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  const match = /^Key([A-Z])$/.exec(event.code);
  return match === null ? null : match[1].toLowerCase();
}

/**
 * The command a key press gives, or null if it gives none (and should be left
 * to the browser).
 *
 * - **1–9** (top row or numpad): a digit, read by position (see `digitOf`).
 *   Allowed with Shift or Alt — those flip the entry mode while held — but
 *   not with Ctrl or Cmd, which belong to the browser (Cmd+1 switches tab).
 * - **Backspace / Delete**: erase. **Arrows**: move. Both work with Shift or
 *   Alt held, since a player flipping modes still moves and erases — and
 *   claiming Alt+Left also keeps it from sending a Windows browser back a
 *   page mid-game.
 * - **Space**, with no modifier: toggle the latched mode.
 * - **Ctrl/Cmd+Z**: undo. **Ctrl/Cmd+Shift+Z** or **Ctrl+Y**: redo (not
 *   Cmd+Y, which is History in Mac browsers).
 * - **P**, without Ctrl, Cmd or Alt: pause or resume.
 *
 * Key repeat is not considered here; see `isRepeatable`.
 */
export function commandForKey(event: KeyInput): KeyCommand | null {
  const isCommand = event.ctrlKey || event.metaKey;

  const digit = digitOf(event);
  if (digit !== null) return isCommand ? null : { type: 'digit', digit };

  if (isCommand) {
    if (event.altKey) return null;
    const letter = letterOf(event);
    if (letter === 'z') return { type: event.shiftKey ? 'redo' : 'undo' };
    if (letter === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) {
      return { type: 'redo' };
    }
    return null;
  }

  if (event.key === 'Backspace' || event.key === 'Delete') return { type: 'erase' };
  if (Object.hasOwn(ARROWS, event.key)) return { type: 'move', direction: ARROWS[event.key] };
  if (event.code === 'Space' || event.key === ' ') {
    return event.shiftKey || event.altKey ? null : { type: 'toggleMode' };
  }
  if (letterOf(event) === 'p' && !event.altKey) return { type: 'pause' };
  return null;
}

/**
 * Whether a command should repeat while its key is held. Moving, erasing and
 * undoing are things a player holds a key down to do several of. The rest
 * would flicker: a held digit in candidate mode would toggle its candidate on
 * and off with every repeat, a held Space would flip the mode back and forth,
 * and a held P would pause and resume. The handler should still call
 * preventDefault for a repeat it ignores, or a held Space scrolls the page.
 */
export function isRepeatable(command: KeyCommand): boolean {
  return (
    command.type === 'move' ||
    command.type === 'erase' ||
    command.type === 'undo' ||
    command.type === 'redo'
  );
}

/**
 * Whether a key is one of the mode modifiers — Shift or Alt (Option) — which
 * flip the entry mode for as long as they are held, as on NYT.
 */
export function isModeModifierKey(key: string): boolean {
  return key === 'Shift' || key === 'Alt';
}
