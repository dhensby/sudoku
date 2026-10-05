import type { CSSProperties } from 'react';
import type { Digit, InputMode } from '../core';
import { keepFocus } from './keepFocus';

export interface NumberPadProps {
  /** The effective mode: candidate mode draws each digit small (and in its spot, on a 3×3 pad). */
  mode: InputMode;
  /** How many of each digit are placed (index 1–9), from `digitCounts`. */
  counts: readonly number[];
  isDisabled: boolean;
  onDigit: (digit: Digit) => void;
}

const DIGITS: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * The nine digit keys. A fragment, not a wrapper: each key is placed by the
 * controls grid itself (3×3 on a desktop, two rows of five on a phone, with
 * Erase as the tenth key), which a wrapper would get in the way of.
 *
 * In candidate mode each digit is drawn small and light. On a 3×3 pad (a
 * desktop, or a phone on its side) it also sits in its spot of a cell's
 * mini-grid — where it would appear in a cell — as NYT draws it; in a phone's
 * two rows of five the spots would only scatter the digits, so they stay
 * centred. A digit placed nine times is muted and ticked, but still works:
 * it may be the one that is wrong.
 */
export function NumberPad({ mode, counts, isDisabled, onDigit }: NumberPadProps) {
  return (
    <>
      {DIGITS.map((digit) => {
        const isDone = counts[digit] >= 9;
        const classes = ['numpad__key', `numpad__key--${digit}`];
        if (mode === 'candidate') classes.push('numpad__key--candidate');
        if (isDone) classes.push('numpad__key--done');
        return (
          <button
            key={digit}
            type="button"
            className={classes.join(' ')}
            aria-label={isDone ? `${digit}, all placed` : String(digit)}
            disabled={isDisabled}
            // The digit's spot in a cell's mini-grid, for candidate mode on a
            // 3×3 pad (the stylesheet decides where that applies).
            style={
              {
                '--spot-row': Math.ceil(digit / 3),
                '--spot-col': ((digit - 1) % 3) + 1,
              } as CSSProperties
            }
            onMouseDown={keepFocus}
            onClick={() => onDigit(digit)}
          >
            <span className="numpad__digit">{digit}</span>
          </button>
        );
      })}
    </>
  );
}
