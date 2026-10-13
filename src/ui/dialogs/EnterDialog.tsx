import { useCallback, useId, useMemo, useState } from 'react';
import { COL, ROW, assessGivens, type Direction, type GridString, type Puzzle } from '../../core';
import { GivensGrid, type GivensGridSettings } from '../GivensGrid';
import { EraseIcon } from '../icons';
import { keepFocus } from '../keepFocus';
import { commandForKey, type KeyInput } from '../keyboard';
import { NumberPad } from '../NumberPad';
import { BLANK_GRID } from '../puzzles';
import { Dialog } from './Dialog';
import { describeGivens } from './text';

export interface EnterDialogProps {
  /** How the grid is tinted around the selection, as the board is. */
  settings: GivensGridSettings;
  /** The grid it opens with: blank for a new puzzle, or one kept in Your puzzles. Read once. */
  initialCells: GridString;
  /**
   * The cell selected as it opens: the first, or the one after the last
   * number of a grid kept, or, back from Share, the one selected as Share…
   * was pressed.
   */
  initialSelected: number;
  /**
   * The grid as kept in Your puzzles — the one it opened with, or what Save
   * last kept — or null while nothing is: Save says Saved for as long as the
   * grid matches it.
   */
  savedCells: GridString | null;
  /** Play the puzzle typed in: checked, with one solution, and labelled (see `assessGivens`). */
  onPlay: (puzzle: Puzzle) => void;
  /**
   * Share the puzzle typed in alone, checked and labelled as Play has it,
   * without a game of it: `selected` is the cell selected, for the editor to
   * open on again as Share closes.
   */
  onShare: (puzzle: Puzzle, selected: number) => void;
  /** Keep the grid as it is in Your puzzles, staying in the editor. Never called with no number in. */
  onSave: (cells: GridString) => void;
  /** Closed, any way — the close button, Escape, the scrim: with the grid as it was left. */
  onClose: (cells: GridString) => void;
  /** Back from sharing the puzzle: focus goes back to Share…, not to the selected cell. */
  isBackFromShare?: boolean;
}

/** What has been typed in so far, and the cell the next number goes in. */
interface Draft {
  cells: GridString;
  selected: number;
}

/** `digit` (0 for none) in the cell at `index`, and the selection on `next`. */
function put({ cells }: Draft, index: number, digit: number, next = index): Draft {
  return { cells: cells.slice(0, index) + digit + cells.slice(index + 1), selected: next };
}

/** The cell after the selection, in reading order: on to the next row, and no further than the last. */
function onward({ selected }: Draft): number {
  return Math.min(selected + 1, 80);
}

/**
 * The selection a step `direction`. Left and right go in reading order, as
 * typing does — from the end of a row to the start of the next, and back —
 * so a row whose last cells are blank is left by the arrow, not by a trip
 * down and back along the row; they stop at the first cell and the last. Up
 * and down stop at the edges.
 */
function moved(draft: Draft, direction: Direction): Draft {
  if (direction === 'right') return { ...draft, selected: onward(draft) };
  if (direction === 'left') return { ...draft, selected: Math.max(draft.selected - 1, 0) };
  const row = ROW[draft.selected] + (direction === 'down' ? 1 : -1);
  if (row < 0 || row > 8) return draft;
  return { ...draft, selected: row * 9 + COL[draft.selected] };
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

/** How many of each number are in, index 1–9, for the pad's "5, all placed". */
function countsOf(cells: GridString): number[] {
  const counts = new Array<number>(10).fill(0);
  for (const ch of cells) counts[Number(ch)]++;
  return counts;
}

interface Status {
  text: string;
  id: number;
}

/**
 * Enter a puzzle: one from elsewhere — a newspaper's, a book's — typed into
 * an empty grid, or one kept in Your puzzles opened again, to play as any
 * other. The keyboard copies a puzzle out row by row (see `typed`); a finger
 * taps a cell, then a number on the pad, which goes in where it is, so a
 * correction lands in the same cell. Clashes are dotted as they go in, and
 * the status line says what the numbers make so far (see `assessGivens`):
 * Play and Share… wait for one solution. The hint under the buttons warns
 * that the checks cannot catch everything — a number mistyped can still
 * make a puzzle, just not the one in the paper.
 *
 * What is typed is the dialog's own, from the grid it opened with. Save
 * hands it up to be kept in Your puzzles, finished or not, and says Saved
 * for as long as the grid is as saved; Play hands the puzzle on as checked
 * and labelled here, which is how its link will be (see `puzzleFromGivens`),
 * to be kept as it is played; Share… hands it on the same way, to be kept
 * and shared without a game of it, the editor opening again as Share closes;
 * and closing hands the grid up, to be kept if it has changed (see
 * `closeEditor`). No footer: the board needs its height on a phone, so the
 * buttons sit last in the body, the hint on a line under them.
 */
export function EnterDialog({
  settings,
  initialCells,
  initialSelected,
  savedCells,
  onPlay,
  onShare,
  onSave,
  onClose,
  isBackFromShare,
}: EnterDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => ({
    cells: initialCells,
    selected: initialSelected,
  }));
  const [status, setStatus] = useState<Status | null>(null);
  const statusId = useId();
  const hintId = useId();
  const { cells, selected } = draft;
  const assessment = useMemo(() => assessGivens(cells), [cells]);
  const counts = useMemo(() => countsOf(cells), [cells]);
  // Nothing to keep: no number in, or the grid as it was saved.
  const isSaved = cells === savedCells;
  const canSave = cells !== BLANK_GRID && !isSaved;

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

  const save = () => {
    if (!canSave) return;
    onSave(cells);
    setStatus((previous) => ({ text: 'Saved to Your puzzles.', id: (previous?.id ?? 0) + 1 }));
  };

  return (
    <Dialog
      title="Enter a puzzle"
      onClose={() => onClose(cells)}
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
              isAutofocus={!isBackFromShare}
            />
          </div>
        </div>

        <div className="enter__panel">
          <p className="enter__status" role="status" id={statusId}>
            {describeGivens(assessment)}
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
          {/* Equal shares of the row, so it keeps still as Save's word
              changes. Unavailable rather than disabled when there is nothing
              to do: a disabled button drops the focus it holds to the page.
              Focused, Play and Share… say why they are unavailable; pressed,
              any of them does nothing. */}
          <div className="enter__actions">
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
            <button
              type="button"
              className="button enter__share"
              aria-disabled={assessment.kind === 'ok' ? undefined : true}
              aria-describedby={statusId}
              data-autofocus={isBackFromShare || undefined}
              onClick={() => {
                if (assessment.kind === 'ok') onShare(assessment.puzzle, selected);
              }}
            >
              Share…
            </button>
            {/* Staying in the editor, so a mouse leaves focus on the grid. */}
            <button
              type="button"
              className="button enter__save"
              aria-disabled={canSave ? undefined : true}
              onMouseDown={keepFocus}
              onClick={save}
            >
              {isSaved ? 'Saved' : 'Save'}
            </button>
          </div>
          <p className="enter__hint" id={hintId}>
            Check every number against your copy.
          </p>
          {/* Mounted from the start, so its first message is a change it
              announces; keyed, so saving twice is announced twice. Not on
              show: Save's own word says it. */}
          <p className="visually-hidden" role="status">
            {status && <span key={status.id}>{status.text}</span>}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
