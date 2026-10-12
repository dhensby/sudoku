import { memo, useRef, type CSSProperties, type ReactNode } from 'react';
import { COL, ROW, hasDigit, type CellMark, type Digit } from '../core';
import { cellLabel } from './announce';

/**
 * How a cell is tinted: relative to the selection, or — `step` — in a house
 * of the step a hint names.
 */
export type Highlight = 'selected' | 'same' | 'step' | 'peer' | 'none';

const DIGITS: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * A read-only cell drawn its own way rather than from the game's state: on
 * the board that overlays two solves (see `CompareDialog`), what each player
 * had in it. It replaces what the cell would draw, and its name.
 */
export interface CellOverlay {
  /** What the cell draws in place of its digit or candidates. */
  content: ReactNode;
  /** The cell's accessible name in place of the one its state gives it. */
  label: string;
  /** A class for the stylesheet, on the cell. */
  className?: string;
}

export interface CellProps {
  index: number;
  /** Placed digit, 0 when empty. */
  value: number;
  given: boolean;
  mark: CellMark;
  /** The candidates on show (a mask); only an empty cell has any. */
  candidates: number;
  /**
   * The candidate on show that is the selected cell's number, when same
   * numbers are highlighted; 0 for none. It is marked for the stylesheet,
   * which lights it in High contrast only. Given only to a cell that has
   * it, so a new selection repaints just those.
   */
  sameCandidate?: number;
  highlight: Highlight;
  /** Clashes with a peer — and conflicts are being shown. */
  conflict: boolean;
  /**
   * The candidates a mouse hovering the cell is offered (a mask), as faint
   * digits in their spots that a click toggles; 0 for none. Only the
   * selected cell, empty and editable, mid-game, offers any — every digit
   * normally, but in Auto Candidate Mode only the computed candidates, the
   * ones that can be toggled there.
   */
  ghosts: number;
  /**
   * The id of text that describes the cell — the hint it has had, re-shown
   * as it is selected again — read after its name.
   */
  describedBy?: string;
  onSelect: (index: number) => void;
  onToggleCandidate: (index: number, digit: Digit) => void;
  registerRef: (index: number, element: HTMLButtonElement | null) => void;
  /**
   * A cell of a board that is only looked at — a solve played back — rather
   * than played: a plain table cell, with no focus, no press and nothing to
   * toggle (see Board's `isReadOnly`).
   */
  isReadOnly?: boolean;
  /**
   * The cell the move on show acted on, in a playback, or the next move's
   * while it is cued: outlined.
   */
  isCurrent?: boolean;
  /** On a read-only board, what to draw in place of the cell's own state (see `CellOverlay`). */
  overlay?: CellOverlay;
}

function className({
  value,
  given,
  mark,
  highlight,
  conflict,
  isCurrent,
  overlay,
}: CellProps): string {
  const classes = ['cell'];
  if (overlay?.className !== undefined) classes.push(overlay.className);
  if (given) classes.push('cell--given');
  else if (value !== 0) classes.push('cell--player');
  if (highlight !== 'none') classes.push(`cell--${highlight}`);
  if (mark !== 'none') classes.push(`cell--${mark}`);
  if (conflict) classes.push('cell--conflict');
  if (isCurrent) classes.push('cell--current');
  return classes.join(' ');
}

/**
 * What a cell draws: its digit, or its candidates in their 3×3 spots. Each
 * is keyed by what it shows, so a digit or a candidate that changes is drawn
 * afresh: on a board played back, what a move adds fades in (see
 * dialogs.css).
 */
function cellContent(value: number, candidates: number, sameCandidate: number) {
  return value !== 0 ? (
    <span className="cell__value" aria-hidden="true" key={value}>
      {value}
    </span>
  ) : (
    candidates !== 0 && (
      <span className="cell__candidates" aria-hidden="true">
        {DIGITS.map((digit) => {
          const isShown = hasDigit(candidates, digit);
          return (
            <span
              className={
                digit === sameCandidate
                  ? 'cell__candidate cell__candidate--same'
                  : 'cell__candidate'
              }
              key={isShown ? digit : -digit}
            >
              {isShown ? digit : ''}
            </span>
          );
        })}
      </span>
    )
  );
}

/**
 * One square of the grid: a button with the gridcell role, named for its
 * state alone ("7", "empty, candidates 1 4") — its position is the grid's
 * business (see Board). What it draws is hidden from assistive technology:
 * the name already says it all, and the faint ghost digits are not there at
 * all for a reader. Memoised on primitive props, so a move repaints only the
 * cells it changed.
 */
function CellComponent(props: CellProps) {
  const {
    index,
    value,
    given,
    mark,
    candidates,
    sameCandidate = 0,
    highlight,
    conflict,
    ghosts,
    describedBy,
    onSelect,
    onToggleCandidate,
    registerRef,
    isReadOnly = false,
    overlay,
  } = props;
  // How the press that led to the coming click began: only a mouse toggles a
  // candidate by its spot. A finger cannot see the ghosts before it lands,
  // and a key's click (Enter on a focused cell) has no spot at all.
  const pointerType = useRef<string | null>(null);
  const isSelected = highlight === 'selected';
  const label = cellLabel({ value, given, candidates, conflict, mark });
  const marks = (
    <>
      {/* A tick for a checked-correct digit, whose ink differs from the
          player's own by hue alone. Decorative: the name says "correct". */}
      {mark === 'correct' && <span className="cell__tick" aria-hidden="true" />}
      {conflict && <span className="cell__conflict" />}
    </>
  );

  if (isReadOnly) {
    // Named for its state alone, as a playing cell is: the table says where.
    return (
      <div
        role="cell"
        className={className(props)}
        aria-rowindex={ROW[index] + 1}
        aria-colindex={COL[index] + 1}
        aria-label={overlay?.label ?? label}
        data-index={index}
      >
        {overlay === undefined ? cellContent(value, candidates, sameCandidate) : overlay.content}
        {marks}
      </div>
    );
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const isMouse = pointerType.current === 'mouse';
    pointerType.current = null;
    // Safari does not focus a button on click; the keyboard should carry on
    // from the cell just chosen all the same.
    event.currentTarget.focus();
    if (ghosts !== 0 && isMouse) {
      // The ghost layer only exists while this cell was already selected, so
      // the first click on a cell selects it and only a second can toggle.
      const spot = (event.target as Element).closest<HTMLElement>('[data-digit]');
      if (spot !== null) {
        onToggleCandidate(index, Number(spot.dataset.digit) as Digit);
        return;
      }
    }
    onSelect(index);
  };

  return (
    <button
      type="button"
      role="gridcell"
      className={className(props)}
      aria-rowindex={ROW[index] + 1}
      aria-colindex={COL[index] + 1}
      aria-selected={isSelected}
      aria-label={label}
      aria-describedby={describedBy}
      // Roving tabindex: Tab enters the grid at the selection and leaves it
      // in one step; the arrow keys move within it.
      tabIndex={isSelected ? 0 : -1}
      data-index={index}
      ref={(element) => registerRef(index, element)}
      // The solve wave's delay: cells ripple out from the top-left corner.
      style={{ '--wave': ROW[index] + COL[index] } as CSSProperties}
      onPointerDown={(event) => {
        pointerType.current = event.pointerType;
      }}
      onClick={handleClick}
      // Focus arriving by other means (a screen reader's cursor) selects too,
      // so the board and the reader never disagree about where they are.
      onFocus={() => {
        if (!isSelected) onSelect(index);
      }}
    >
      {cellContent(value, candidates, sameCandidate)}
      {ghosts !== 0 && (
        <span className="cell__ghosts" aria-hidden="true">
          {DIGITS.map((digit) =>
            hasDigit(ghosts, digit) ? (
              <span
                key={digit}
                className={
                  hasDigit(candidates, digit) ? 'cell__ghost cell__ghost--shown' : 'cell__ghost'
                }
                data-digit={digit}
              >
                {digit}
              </span>
            ) : (
              // Holds the digit's spot in the 3×3, offering nothing.
              <span key={digit} />
            ),
          )}
        </span>
      )}
      {marks}
    </button>
  );
}

export const Cell = memo(CellComponent);
