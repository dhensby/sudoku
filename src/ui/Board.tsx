import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import {
  ALL_DIGITS,
  BOX,
  COL,
  ROW,
  computeCandidates,
  conflictsOf,
  hasDigit,
  isEditable,
  valuesOf,
  visibleCandidates,
  type Digit,
  type GameState,
} from '../core';
import type { Settings } from '../storage/prefs';
import { Cell, type Highlight } from './Cell';
import { focusQuietly } from './keepFocus';

/** The settings that change how the board is drawn. */
export type BoardSettings = Pick<
  Settings,
  'highlightRowColumn' | 'highlightBox' | 'highlightIdentical' | 'highlightConflicts'
>;

export interface BoardProps {
  game: GameState;
  settings: BoardSettings;
  /** The game is being played (not solved): ghost candidates are offered. */
  isPlaying: boolean;
  /** Play the solved wave. */
  isCelebrating: boolean;
  /** Stable callbacks, please: every cell is memoised on them. */
  onSelect: (index: number) => void;
  onToggleCandidate: (index: number, digit: Digit) => void;
  /**
   * Asked once, on mount: whether to put focus on the selected cell. True
   * when the board replaces a card whose button had focus (Resume, Start),
   * so the keyboard carries on where play does instead of dropping to the
   * page.
   */
  takeFocusRequest?: () => boolean;
  /**
   * The id of text describing the selected cell: the hint it has had,
   * which the hint bar shows again whenever the cell is selected (see App).
   */
  describedBy?: string;
  /**
   * A board to look at, not to play: a solve played back. It is drawn as the
   * game's own board is — digits, candidates, marks and conflicts — but as a
   * table of plain cells rather than a grid of buttons: nothing on it takes
   * focus or a press, no cell is selected, and no highlight follows a
   * selection. `onSelect` and `onToggleCandidate` are never called.
   */
  isReadOnly?: boolean;
  /** On a read-only board, the cell to outline: the one the move on show acted on. */
  current?: number | null;
}

const LINES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/**
 * The grid: an ARIA grid of nine rows of nine cells. The grid declares its
 * shape and each cell its position, so a screen reader announces only the
 * axis that changed as the player arrows around, and each cell's name is
 * its state alone.
 *
 * Keys are handled at the document (NYT style, see App), so the board only
 * has to keep focus with the selection: when focus is on a cell and the
 * selection moves — by arrow key, undo or hint — focus follows it.
 */
export function Board({
  game,
  settings,
  isPlaying,
  isCelebrating,
  onSelect,
  onToggleCandidate,
  takeFocusRequest,
  describedBy,
  isReadOnly = false,
  current = null,
}: BoardProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { cells, selected } = game;

  const candidates = useMemo(() => visibleCandidates(game), [game]);
  const conflicts = useMemo(() => conflictsOf(game), [game]);
  // In Auto Candidate Mode only a computed candidate can be toggled (struck
  // out, or put back), so only those are offered as ghosts.
  const computed = useMemo(
    () => (game.autoCandidates ? computeCandidates(valuesOf(game)) : null),
    [game],
  );

  const registerRef = useCallback((index: number, element: HTMLButtonElement | null) => {
    cellRefs.current[index] = element;
  }, []);

  useEffect(() => {
    if (gridRef.current?.contains(document.activeElement)) {
      focusQuietly(cellRefs.current[selected]);
    }
  }, [selected]);

  const focusSelected = useEffectEvent(() => focusQuietly(cellRefs.current[selected]));
  useEffect(() => {
    if (takeFocusRequest?.()) focusSelected();
  }, [takeFocusRequest]);

  const selectedValue = cells[selected].value;
  // The selected number among a cell's candidates, marked along with the
  // same-number cells (lit in High contrast only).
  const sameCandidateOf = (index: number): number =>
    settings.highlightIdentical && selectedValue !== 0 && hasDigit(candidates[index], selectedValue)
      ? selectedValue
      : 0;
  const highlightOf = (index: number): Highlight => {
    // A board played back has no selection: the replay's own is no one's.
    if (isReadOnly) return 'none';
    if (index === selected) return 'selected';
    if (
      settings.highlightIdentical &&
      selectedValue !== 0 &&
      cells[index].value === selectedValue
    ) {
      return 'same';
    }
    const isLinePeer = ROW[index] === ROW[selected] || COL[index] === COL[selected];
    if (settings.highlightRowColumn && isLinePeer) return 'peer';
    if (settings.highlightBox && BOX[index] === BOX[selected]) return 'peer';
    return 'none';
  };

  const classes = ['board'];
  if (isCelebrating) classes.push('board--solved');
  if (isReadOnly) classes.push('board--read-only');

  return (
    <div
      className={classes.join(' ')}
      // A table when it is only to be looked at: a grid is a widget, which
      // promises cells to move between and act on.
      role={isReadOnly ? 'table' : 'grid'}
      aria-label="Sudoku board"
      aria-rowcount={9}
      aria-colcount={9}
      aria-readonly={(!isReadOnly && game.status === 'solved') || undefined}
      ref={gridRef}
    >
      {LINES.map((row) => (
        <div className="board__row" role="row" aria-rowindex={row + 1} key={row}>
          {LINES.map((col) => {
            const index = row * 9 + col;
            const cell = cells[index];
            return (
              <Cell
                key={col}
                index={index}
                value={cell.value}
                given={cell.given}
                mark={cell.mark}
                candidates={candidates[index]}
                sameCandidate={isReadOnly ? 0 : sameCandidateOf(index)}
                highlight={highlightOf(index)}
                conflict={settings.highlightConflicts && conflicts[index]}
                ghosts={
                  !isReadOnly &&
                  isPlaying &&
                  index === selected &&
                  cell.value === 0 &&
                  isEditable(game, index)
                    ? (computed?.[index] ?? ALL_DIGITS)
                    : 0
                }
                describedBy={index === selected ? describedBy : undefined}
                onSelect={onSelect}
                onToggleCandidate={onToggleCandidate}
                registerRef={registerRef}
                isReadOnly={isReadOnly}
                isCurrent={isReadOnly && index === current}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
