import { useCallback, useId, useMemo, useState } from 'react';
import {
  COL,
  MIN_GIVENS,
  ROW,
  assessGivens,
  type Direction,
  type GivensAssessment,
  type GridString,
  type Puzzle,
} from '../../core';
import { describeUnit } from '../announce';
import { DIFFICULTY_LABEL, NUMBER_WORD, capitalise, withArticle } from '../format';
import { GivensGrid, type GivensGridSettings } from '../GivensGrid';
import { EraseIcon } from '../icons';
import { keepFocus } from '../keepFocus';
import { commandForKey, type KeyInput } from '../keyboard';
import { NumberPad } from '../NumberPad';
import { Dialog } from './Dialog';

export interface EnterDialogProps {
  /** How the grid is tinted around the selection, as the board is. */
  settings: GivensGridSettings;
  /** Play the puzzle typed in: checked, with one solution, and labelled (see `assessGivens`). */
  onPlay: (puzzle: Puzzle) => void;
  onClose: () => void;
}

/** What has been typed in so far, and the cell the next number goes in. */
interface Draft {
  cells: GridString;
  selected: number;
}

const BLANK: Draft = { cells: '0'.repeat(81), selected: 0 };

/** A step each way, as the board's arrow keys take it. */
const STEP: Readonly<Record<Direction, readonly [rows: number, cols: number]>> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

/** `digit` (0 for none) in the cell at `index`, and the selection on `next`. */
function put({ cells }: Draft, index: number, digit: number, next = index): Draft {
  return { cells: cells.slice(0, index) + digit + cells.slice(index + 1), selected: next };
}

/** The cell after the selection, in reading order: on to the next row, and no further than the last. */
function onward({ selected }: Draft): number {
  return Math.min(selected + 1, 80);
}

/** The selection a step `direction`, stopping at the edges. */
function moved(draft: Draft, direction: Direction): Draft {
  const [rows, cols] = STEP[direction];
  const row = ROW[draft.selected] + rows;
  const col = COL[draft.selected] + cols;
  if (row < 0 || row > 8 || col < 0 || col > 8) return draft;
  return { ...draft, selected: row * 9 + col };
}

/** A caret's Backspace: the number in the selection, or else the one before it, stepping back. */
function backspace(draft: Draft): Draft {
  const { cells, selected } = draft;
  if (cells[selected] !== '0' || selected === 0) return put(draft, selected, 0);
  return put(draft, selected - 1, 0);
}

/** A key that leaves a cell blank as a puzzle prints one: 0 (top row or numpad), or a dot. */
function isBlankKey({ key, code }: KeyInput): boolean {
  return /^(?:Digit|Numpad)0$/.test(code) || code === 'NumpadDecimal' || key === '0' || key === '.';
}

/**
 * The draft a key makes, and whether holding the key down goes on making
 * drafts — or null for a key that is not the editor's, left to the browser
 * and the dialog: Tab, Enter, Escape, P and every Ctrl or Cmd chord (Cmd+V
 * and Ctrl+0 among them). The keys are a typist's, for copying a puzzle out
 * row by row: a number fills the selection and moves on, a blank (Space, 0
 * or a dot) moves on past it, Backspace takes back the last, Delete erases
 * where it is and the arrows move. Only Backspace, Delete and the arrows
 * repeat: a held 5 would fill a row with 5s.
 */
function typed(event: KeyInput, draft: Draft): { next: Draft; repeats: boolean } | null {
  if (event.ctrlKey || event.metaKey) return null;
  const { selected } = draft;
  const command = commandForKey(event);
  // Space switches the board's mode; here there is no mode, and it leaves a
  // blank. The blanks come before Delete: with Num Lock off, the numpad's
  // dot calls itself Delete.
  if (command?.type === 'toggleMode' || isBlankKey(event)) {
    return { next: put(draft, selected, 0, onward(draft)), repeats: false };
  }
  // Both erase on the board: here Delete always erases in place, and
  // Backspace steps back from an empty cell, as a caret does.
  if (event.key === 'Backspace') return { next: backspace(draft), repeats: true };
  if (event.key === 'Delete') return { next: put(draft, selected, 0), repeats: true };
  if (command?.type === 'digit') {
    return { next: put(draft, selected, command.digit, onward(draft)), repeats: false };
  }
  if (command?.type === 'move') return { next: moved(draft, command.direction), repeats: true };
  return null;
}

/**
 * The status line: what the numbers make so far, one thing at a time —
 * the same words for as long as the same thing is true, so a screen reader
 * speaks only as it changes, not at every number. Each fits a 320px phone's
 * line. A puzzle with one solution is named by its tier alone.
 */
function statusOf(assessment: GivensAssessment): string {
  switch (assessment.kind) {
    case 'empty':
      return 'Type in the numbers from your puzzle.';
    case 'clash': {
      const { count, digit, unit } = assessment;
      return `${capitalise(NUMBER_WORD[count])} ${digit}s in ${describeUnit(unit)}.`;
    }
    case 'too-few':
      return `A puzzle needs at least ${MIN_GIVENS} numbers.`;
    case 'full':
      return 'Every cell is filled: nothing to solve.';
    case 'multiple':
      return 'More than one solution so far.';
    case 'none':
      return 'No solution: a number must be wrong.';
    case 'too-complex':
      return 'Too complex to check.';
    case 'ok':
      return `One solution: ${withArticle(DIFFICULTY_LABEL[assessment.puzzle.difficulty])} puzzle.`;
  }
}

/** How many of each number are in, index 1–9, for the pad's "5, all placed". */
function countsOf(cells: GridString): number[] {
  const counts = new Array<number>(10).fill(0);
  for (const ch of cells) counts[Number(ch)]++;
  return counts;
}

/**
 * Enter a puzzle: one from elsewhere — a newspaper's, a book's — typed into
 * an empty grid, to play as any other. The keyboard copies a puzzle out row
 * by row (see `typed`); a finger taps a cell, then a number on the pad,
 * which goes in where it is, so a correction lands in the same cell. Clashes
 * are dotted as they go in, and the status line says what the numbers make
 * so far (see `assessGivens`): Play waits for one solution. The hint beside
 * Play warns that the checks cannot catch everything — a number mistyped
 * can still make a puzzle, just not the one in the paper.
 *
 * What has been typed is the dialog's alone, and goes as it closes. Play
 * hands the puzzle on as checked and labelled here, which is how its link
 * will be (see `puzzleFromGivens`). No footer: the board needs its height
 * on a phone, so Play sits last in the body, beside the hint.
 */
export function EnterDialog({ settings, onPlay, onClose }: EnterDialogProps) {
  const [draft, setDraft] = useState(BLANK);
  const statusId = useId();
  const hintId = useId();
  const { cells, selected } = draft;
  const assessment = useMemo(() => assessGivens(cells), [cells]);
  const counts = useMemo(() => countsOf(cells), [cells]);

  const select = useCallback(
    (index: number) => setDraft((previous) => ({ ...previous, selected: index })),
    [],
  );

  const handleKey = (event: React.KeyboardEvent) => {
    const key = typed(event, draft);
    if (key === null) return;
    // Even a repeat ignored is ours: a held Space must not scroll the dialog.
    event.preventDefault();
    if (event.repeat && !key.repeats) return;
    setDraft(key.next);
  };

  return (
    <Dialog
      title="Enter a puzzle"
      onClose={onClose}
      className="dialog--enter"
      describedBy={`${statusId} ${hintId}`}
    >
      <div className="enter">
        <div className="enter__board">
          <div className="board-area">
            <GivensGrid
              cells={cells}
              selected={selected}
              settings={settings}
              onSelect={select}
              onKeyDown={handleKey}
            />
          </div>
        </div>

        <div className="enter__panel">
          <p className="enter__status" role="status" id={statusId}>
            {statusOf(assessment)}
          </p>
          <div className="enter__pad">
            <NumberPad
              mode="normal"
              counts={counts}
              isDisabled={false}
              onDigit={(digit) => setDraft(put(draft, selected, digit))}
            />
            <button
              type="button"
              className="control control--erase"
              onMouseDown={keepFocus}
              onClick={() => setDraft(put(draft, selected, 0))}
            >
              <EraseIcon />
              <span className="control__label">Erase</span>
            </button>
          </div>
          <div className="enter__actions">
            <p className="enter__hint" id={hintId}>
              Check every number against your copy.
            </p>
            {/* Unavailable rather than disabled until the numbers make a
                puzzle: a disabled button drops the focus it holds to the
                page. Focused, it says why it is unavailable; pressed, it
                does nothing. */}
            <button
              type="button"
              className="button button--primary enter__play"
              aria-disabled={assessment.kind === 'ok' ? undefined : true}
              aria-describedby={statusId}
              onClick={() => {
                if (assessment.kind === 'ok') onPlay(assessment.puzzle);
              }}
            >
              Play
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
