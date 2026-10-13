import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BOX, COL, ROW, findConflicts, gridValues, type GridString } from '../core';
import type { Settings } from '../storage/prefs';
import { Cell, type Highlight } from './Cell';
import { focusQuietly } from './keepFocus';

/** The settings that change how the grid is tinted: the selection's row and column, and its box. */
export type GivensGridSettings = Pick<Settings, 'highlightRowColumn' | 'highlightBox'>;

export interface GivensGridProps {
  /** The numbers typed in so far, in reading order, '0' for an empty cell. */
  cells: GridString;
  selected: number;
  settings: GivensGridSettings;
  /** Stable, please: every cell is memoised on it. */
  onSelect: (index: number) => void;
  /** A key pressed on the grid (on a cell of it, usually): the editor's to act on. */
  onKeyDown: (event: React.KeyboardEvent) => void;
  /** A paste on the grid — Ctrl or Cmd+V on a cell of it, usually: the editor's to read. */
  onPaste: (event: React.ClipboardEvent) => void;
  /**
   * Whether the selected cell is where the dialog's focus lands as it opens:
   * it is, unless the dialog marks another control (back from Share, its
   * Share…). True if left out.
   */
  isAutofocus?: boolean;
}

const LINES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** Never called: a number typed in has no candidates to toggle. */
const ignore = () => {};

/**
 * The grid a puzzle is typed into (see EnterDialog): the board's own cells
 * in the board's own markup, so it is drawn as the board is, box lines and
 * all, and read as a grid of nine rows of nine. Every number in it is set as
 * a given — they will be the puzzle's givens — and every clash is dotted,
 * whatever the player's setting for the board, for a clash is a typing
 * mistake here, never a step of the solve. The selection's row, column and
 * box are tinted as the player's settings tint the board's, to keep their
 * place as they copy a row out.
 *
 * Keys go to `onKeyDown`, on the grid itself, so they only count while a
 * cell has focus: Space and Enter on the pad's keys, Play, Share…, Save or
 * Paste keep their meaning. A paste goes to `onPaste` the same way, from
 * Ctrl or Cmd+V — a chord the keys leave to the browser, which fires the
 * paste on the focused cell. As on the board, focus follows the selection
 * while the grid has it, and the selected cell is where the dialog's focus
 * lands as it opens (see `isAutofocus`).
 */
export function GivensGrid({
  cells,
  selected,
  settings,
  onSelect,
  onKeyDown,
  onPaste,
  isAutofocus = true,
}: GivensGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const values = useMemo(() => gridValues(cells), [cells]);
  const conflicts = useMemo(() => findConflicts(values), [values]);

  const registerRef = useCallback((index: number, element: HTMLButtonElement | null) => {
    cellRefs.current[index] = element;
  }, []);

  useEffect(() => {
    if (gridRef.current?.contains(document.activeElement)) {
      focusQuietly(cellRefs.current[selected]);
    }
  }, [selected]);

  const highlightOf = (index: number): Highlight => {
    if (index === selected) return 'selected';
    const isLinePeer = ROW[index] === ROW[selected] || COL[index] === COL[selected];
    if (settings.highlightRowColumn && isLinePeer) return 'peer';
    if (settings.highlightBox && BOX[index] === BOX[selected]) return 'peer';
    return 'none';
  };

  return (
    <div
      className="board"
      role="grid"
      aria-label="Your puzzle"
      aria-rowcount={9}
      aria-colcount={9}
      // Focusable from a press between two cells, so the keys still reach
      // the grid from there (and focus goes on to the selection as it moves).
      tabIndex={-1}
      ref={gridRef}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      {LINES.map((row) => (
        <div className="board__row" role="row" aria-rowindex={row + 1} key={row}>
          {LINES.map((col) => {
            const index = row * 9 + col;
            const value = values[index];
            return (
              <Cell
                key={col}
                index={index}
                value={value}
                given={value !== 0}
                mark="none"
                candidates={0}
                highlight={highlightOf(index)}
                conflict={conflicts[index]}
                ghosts={0}
                onSelect={onSelect}
                onToggleCandidate={ignore}
                registerRef={registerRef}
                isAutofocus={isAutofocus && index === selected}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
