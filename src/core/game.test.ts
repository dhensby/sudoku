import {
  createGame,
  conflictsOf,
  deserialiseGame,
  digitCounts,
  hintBoardOf,
  isBoardFull,
  isEditable,
  reduce,
  rememberedHint,
  serialiseGame,
  shownHint,
  SERIALISED_GAME_FIELDS,
  valuesOf,
  visibleCandidates,
  type Direction,
  type GameAction,
  type GameState,
  type RememberedHints,
  type SerialisedCellHints,
  type SerialisedGame,
} from './game';
import { computeCandidates, formatGrid, maskOf, parseGrid } from './grid';
import type { Assists, Difficulty, Digit, Hint, Puzzle } from './types';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';

// The Wikipedia puzzle. Landmarks used below:
//   cell 0 is a given 5, cell 1 a given 3 — both in row 0 and box 0;
//   cell 2 (r0c2) is the first empty cell: solution 4, candidates 1 2 4;
//   cell 3 (r0c3) is empty: solution 6, candidates 2 6;
//   cell 40 (the centre) is empty: solution 5, and not a peer of cells 2 or 3.
const PUZZLE: Puzzle = {
  givens: formatGrid(parseGrid(WIKIPEDIA_PUZZLE)),
  solution: formatGrid(parseGrid(WIKIPEDIA_SOLUTION)),
  difficulty: 'easy',
};
const SOLUTION = parseGrid(WIKIPEDIA_SOLUTION);
/** The cells the player has to fill, in reading order. */
const BLANKS = Array.from({ length: 81 }, (_, i) => i).filter((i) => PUZZLE.givens[i] === '0');

const HINT: Hint = { kind: 'single', index: 40, technique: 'nakedSingle', unit: null };
/** Another hint for cell 40, as if asked for again once the board had moved on. */
const NEWER_HINT: Hint = {
  kind: 'single',
  index: 40,
  technique: 'hiddenSingleBox',
  unit: { kind: 'box', index: 4 },
};
/** A deduction hint for cell 3 (solution 6). */
const DEDUCTION: Hint = { kind: 'deduction', index: 3, technique: 'pointing' };
/** "Nothing to suggest" — shown, but not counted as help. */
const NONE: GameAction = { type: 'hint', hint: { kind: 'none' } };
const NO_ASSISTS: Assists = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
const UNDO: GameAction = { type: 'undo' };
const REDO: GameAction = { type: 'redo' };
const RESET: GameAction = { type: 'reset' };
const REVEAL: GameAction = { type: 'reveal' };
const CHECK_CELL: GameAction = { type: 'check', scope: 'cell' };
const CHECK_PUZZLE: GameAction = { type: 'check', scope: 'puzzle' };
const AUTO_ON: GameAction = { type: 'setAutoCandidates', enabled: true };
const AUTO_OFF: GameAction = { type: 'setAutoCandidates', enabled: false };
const CHECK_GUESSES_ON: GameAction = { type: 'setCheckGuesses', enabled: true };
const CHECK_GUESSES_OFF: GameAction = { type: 'setCheckGuesses', enabled: false };

function newGame(autoCandidates?: boolean): GameState {
  return createGame(PUZZLE, autoCandidates === undefined ? undefined : { autoCandidates });
}

/** Normal-mode entry at a cell. */
function place(index: number, digit: number, clearPeerNotes?: boolean): GameAction {
  return { type: 'enter', index, digit: digit as Digit, mode: 'normal', clearPeerNotes };
}

/** Candidate-mode entry at a cell. */
function note(index: number, digit: number): GameAction {
  return { type: 'enter', index, digit: digit as Digit, mode: 'candidate' };
}

function erase(index?: number): GameAction {
  return { type: 'erase', index };
}

function select(index: number): GameAction {
  return { type: 'select', index };
}

function play(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce(reduce, state);
}

/** Fill every empty cell with its solution digit, except the ones listed. */
function fillAllBut(state: GameState, ...skip: number[]): GameState {
  const cells = BLANKS.filter((i) => !skip.includes(i));
  return play(state, ...cells.map((i) => place(i, SOLUTION[i])));
}

/** A board solved by placing cell 2 last. Cell 2 stays selected throughout. */
function solvedGame(): GameState {
  return play(fillAllBut(newGame(), 2), place(2, 4));
}

/** The indexes whose cell objects differ between two states. */
function changedCells(a: GameState, b: GameState): number[] {
  return a.cells.flatMap((cell, i) => (cell === b.cells[i] ? [] : [i]));
}

describe('createGame', () => {
  it('starts from the givens with the first empty cell selected', () => {
    const state = newGame();
    expect(state.puzzle).toBe(PUZZLE);
    expect(state.cells).toHaveLength(81);
    expect(state.cells[0]).toEqual({
      value: 5,
      given: true,
      notes: 0,
      autoRemoved: 0,
      mark: 'none',
    });
    expect(state.cells[2]).toEqual({
      value: 0,
      given: false,
      notes: 0,
      autoRemoved: 0,
      mark: 'none',
    });
    expect(formatGrid(valuesOf(state))).toBe(PUZZLE.givens);
    expect(state.cells.filter((cell) => cell.given)).toHaveLength(30);
    expect(state.selected).toBe(2);
    expect(state.mode).toBe('normal');
    expect(state.autoCandidates).toBe(false);
    expect(state.status).toBe('playing');
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.assists).toEqual({ autoCandidates: false, hints: 0, checks: 0, reveals: 0 });
    expect(state.hint).toBeNull();
  });

  it('starts in auto-candidate mode when asked, and puts that on the record', () => {
    const state = newGame(true);
    expect(state.autoCandidates).toBe(true);
    expect(state.assists.autoCandidates).toBe(true);
    expect(newGame(false).autoCandidates).toBe(false);
  });

  it('selects the top-left cell of a grid with nothing left to fill', () => {
    // Degenerate, but a link can carry all 81 givens; it must not select cell -1.
    const state = createGame({ ...PUZZLE, givens: PUZZLE.solution });
    expect(state.selected).toBe(0);
    expect(state.status).toBe('solved');
  });
});

describe('no-ops', () => {
  // Each case is applied to a fresh game (cell 2 selected, manual mode).
  it.each<[string, GameAction[], GameAction]>([
    ['selecting the selected cell', [], select(2)],
    ['selecting below the grid', [], select(-1)],
    ['selecting past the grid', [], select(81)],
    ['selecting a fractional index', [], select(1.5)],
    ['selecting NaN', [], select(Number.NaN)],
    ['moving up from the top row', [], { type: 'move', direction: 'up' }],
    ['entering on a given', [], place(0, 4)],
    ['entering the digit already there', [place(2, 4)], place(2, 4)],
    ['entering at an index off the grid', [], place(81, 4)],
    ['entering digit 0', [], place(2, 0)],
    ['entering digit 10', [], place(2, 10)],
    ['entering a fractional digit', [], place(2, 1.5)],
    ['entering a candidate on a given', [], note(0, 4)],
    ['entering a non-computed candidate in auto mode', [AUTO_ON], note(2, 5)],
    ['erasing a given', [], erase(0)],
    ['erasing an empty cell with no notes', [], erase(2)],
    ['erasing an empty cell in auto mode, even with notes', [note(2, 1), AUTO_ON], erase(2)],
    ['erasing off the grid', [], erase(-1)],
    ['setting the current mode', [], { type: 'setMode', mode: 'normal' }],
    ['setting the current auto-candidate flag', [], AUTO_OFF],
    ['undoing with nothing to undo', [], UNDO],
    ['redoing with nothing to redo', [], REDO],
    ['checking an empty cell', [], CHECK_CELL],
    ['checking a given', [select(0)], CHECK_CELL],
    ['checking a board with nothing placed', [], CHECK_PUZZLE],
    ['checking a cell already checked correct', [place(2, 4), CHECK_CELL], CHECK_CELL],
    ['revealing a given', [select(0)], REVEAL],
    ['revealing a revealed cell', [REVEAL], REVEAL],
    ['revealing a cell checked correct', [place(2, 4), CHECK_CELL], REVEAL],
    [
      'showing "nothing to suggest" while it is on show',
      [NONE],
      { type: 'hint', hint: { kind: 'none' } },
    ],
    ['resetting an untouched board', [], RESET],
  ])('returns the same state for %s', (_name, setup, action) => {
    const state = play(newGame(), ...setup);
    expect(reduce(state, action)).toBe(state);
  });
});

describe('the hint on show', () => {
  // A board with a value at the hinted cell 40, notes, undo and redo history.
  const base = play(newGame(), place(40, 1), place(2, 4), note(3, 2), place(10, 7), UNDO);
  const hinted = reduce(base, { type: 'hint', hint: HINT });

  it.each<[string, GameAction]>([
    ['select', select(0)],
    ['move', { type: 'move', direction: 'up' }],
    ['enter', { type: 'enter', digit: 5 }],
    ['erase', erase()],
    ['setMode', { type: 'setMode', mode: 'candidate' }],
    ['toggleMode', { type: 'toggleMode' }],
    ['setAutoCandidates', AUTO_ON],
    ['undo', UNDO],
    ['redo', REDO],
    ['check', CHECK_CELL],
    ['reveal', REVEAL],
    ['reset', RESET],
  ])('is retired by %s', (_name, action) => {
    expect(hinted.hint).toBe(HINT);
    const next = reduce(hinted, action);
    expect(next).not.toBe(hinted);
    expect(next.hint).toBeNull();
  });

  it('survives a no-op, which changes nothing at all', () => {
    expect(reduce(hinted, select(40))).toBe(hinted);
  });

  it('survives opening "Show me", which leaves the board as it was', () => {
    // Cell 40 holds a value in `base`, so the hint is asked for afresh on an empty one.
    const state = play(newGame(), { type: 'hint', hint: HINT }, { type: 'walkthrough', index: 40 });
    expect(state.hint).toBe(HINT);
  });

  it('is replaced by the next hint', () => {
    const next: Hint = { kind: 'mistake', index: 40 };
    expect(reduce(hinted, { type: 'hint', hint: next }).hint).toBe(next);
  });
});

describe('a solved game', () => {
  const solved = solvedGame();

  it('is solved by the last correct digit', () => {
    expect(solved.status).toBe('solved');
  });

  it.each<[string, GameAction]>([
    ['enter', place(2, 1)],
    ['enter a candidate', note(2, 1)],
    ['erase', erase(2)],
    ['setAutoCandidates', AUTO_ON],
    ['undo', UNDO],
    ['redo', REDO],
    ['hint', { type: 'hint', hint: HINT }],
    ['check', CHECK_PUZZLE],
    ['reveal', REVEAL],
    ['reset', RESET],
  ])('ignores %s', (_name, action) => {
    expect(reduce(solved, action)).toBe(solved);
  });

  it.each<[string, GameAction, Partial<GameState>]>([
    ['select', select(0), { selected: 0 }],
    ['move', { type: 'move', direction: 'left' }, { selected: 1 }],
    ['setMode', { type: 'setMode', mode: 'candidate' }, { mode: 'candidate' }],
    ['toggleMode', { type: 'toggleMode' }, { mode: 'candidate' }],
  ])('still lets the player %s', (_name, action, expected) => {
    const next = reduce(solved, action);
    expect(next).toMatchObject({ ...expected, status: 'solved' });
    expect(next.cells).toBe(solved.cells);
  });

  it('stops every cell being editable', () => {
    expect(BLANKS.some((i) => isEditable(solved, i))).toBe(false);
  });
});

describe('select', () => {
  it('selects any cell, givens included', () => {
    expect(reduce(newGame(), select(0)).selected).toBe(0);
    expect(reduce(newGame(), select(80)).selected).toBe(80);
  });
});

describe('move', () => {
  it.each<{ direction: Direction; to: number }>([
    { direction: 'up', to: 31 },
    { direction: 'down', to: 49 },
    { direction: 'left', to: 39 },
    { direction: 'right', to: 41 },
  ])('moves $direction one cell', ({ direction, to }) => {
    expect(play(newGame(), select(40), { type: 'move', direction }).selected).toBe(to);
  });

  it.each<{ direction: Direction; from: number }>([
    { direction: 'up', from: 4 },
    { direction: 'down', from: 76 },
    { direction: 'left', from: 36 },
    { direction: 'right', from: 44 },
  ])('stops at the edge rather than wrapping when moving $direction', ({ direction, from }) => {
    const state = reduce(newGame(), select(from));
    expect(reduce(state, { type: 'move', direction })).toBe(state);
  });
});

describe('enter, normal mode', () => {
  it('places a digit in the selected cell as one undoable step', () => {
    const state = newGame();
    const next = reduce(state, { type: 'enter', digit: 4 });
    expect(next.cells[2]).toEqual({ ...state.cells[2], value: 4 });
    expect(next.undoStack).toEqual([{ cells: [[2, state.cells[2]]], focus: 2 }]);
    // The previous state is untouched.
    expect(state.cells[2].value).toBe(0);
    expect(state.undoStack).toHaveLength(0);
  });

  it('replaces a different digit', () => {
    const next = play(newGame(), place(2, 1), place(2, 4));
    expect(next.cells[2].value).toBe(4);
    expect(next.undoStack).toHaveLength(2);
  });

  it('keeps the notes underneath a placed digit, hidden until it is erased', () => {
    const noted = play(newGame(), note(2, 1), note(2, 2));
    const placed = reduce(noted, place(2, 4));
    expect(placed.cells[2].notes).toBe(maskOf([1, 2]));
    expect(visibleCandidates(placed)[2]).toBe(0);
    expect(visibleCandidates(reduce(placed, erase(2)))[2]).toBe(maskOf([1, 2]));
  });

  it('leaves the peers’ notes alone by default, as NYT does', () => {
    const next = play(newGame(), note(3, 4), place(2, 4));
    expect(next.cells[3].notes).toBe(maskOf([4]));
  });

  it('enters at the given index without moving the selection', () => {
    const next = reduce(newGame(), place(40, 5));
    expect(next.cells[40].value).toBe(5);
    expect(next.selected).toBe(2);
    expect(next.undoStack[0].focus).toBe(40);
  });

  it('follows the mode in the action over the latched mode', () => {
    const candidate = reduce(newGame(), { type: 'setMode', mode: 'candidate' });
    const placed = reduce(candidate, { type: 'enter', digit: 4, mode: 'normal' });
    expect(placed.cells[2]).toMatchObject({ value: 4, notes: 0 });
    const noted = reduce(candidate, { type: 'enter', digit: 4 });
    expect(noted.cells[2]).toMatchObject({ value: 0, notes: maskOf([4]) });
  });

  it('clears a wrong mark when the value changes', () => {
    const wrong = play(newGame(), place(2, 1), CHECK_CELL);
    expect(wrong.cells[2].mark).toBe('wrong');
    expect(reduce(wrong, place(2, 2)).cells[2].mark).toBe('none');
  });

  it('cannot change a cell locked by a check or a reveal', () => {
    const checked = play(newGame(), place(2, 4), CHECK_CELL);
    expect(reduce(checked, place(2, 1))).toBe(checked);
    const revealed = reduce(newGame(), REVEAL);
    expect(reduce(revealed, place(2, 1))).toBe(revealed);
  });

  it('does not solve a full board with a mistake in it', () => {
    const full = play(fillAllBut(newGame(), 2), place(2, 1));
    expect(isBoardFull(full)).toBe(true);
    expect(full.status).toBe('playing');
    // Fixing the mistake solves it.
    expect(reduce(full, place(2, 4)).status).toBe('solved');
  });

  it('keeps every untouched cell’s identity', () => {
    const state = play(newGame(), note(40, 1));
    const next = reduce(state, place(2, 4));
    expect(next.cells).not.toBe(state.cells);
    expect(changedCells(state, next)).toEqual([2]);
  });
});

describe('enter with clearPeerNotes', () => {
  // Notes for 4 in a row peer (3), a column peer (11), a box peer (18) and a
  // non-peer (40); a different digit in another row peer (5).
  const noted = play(newGame(), note(3, 4), note(3, 6), note(11, 4), note(18, 4));
  const withOthers = play(noted, note(40, 4), note(5, 8));

  it('removes the digit from every peer’s manual notes, and only that digit', () => {
    const next = reduce(withOthers, place(2, 4, true));
    expect(next.cells[3].notes).toBe(maskOf([6]));
    expect(next.cells[11].notes).toBe(0);
    expect(next.cells[18].notes).toBe(0);
    expect(next.cells[40].notes).toBe(maskOf([4]));
    expect(next.cells[5].notes).toBe(maskOf([8]));
    expect(changedCells(withOthers, next)).toEqual([2, 3, 11, 18]);
  });

  it('records the cell and the peers it cleared as one undo step', () => {
    const next = reduce(withOthers, place(2, 4, true));
    expect(next.undoStack).toHaveLength(withOthers.undoStack.length + 1);
    expect(next.undoStack.at(-1)?.cells.map(([index]) => index)).toEqual([2, 3, 11, 18]);
    const undone = reduce(next, UNDO);
    expect(changedCells(withOthers, undone)).toEqual([]);
  });

  it('clears notes from a filled peer’s hidden layer too, so erasing it cannot bring them back', () => {
    const state = play(newGame(), note(3, 4), place(3, 6));
    const next = reduce(state, place(2, 4, true));
    expect(next.cells[3]).toMatchObject({ value: 6, notes: 0 });
  });

  it('leaves the auto-candidate eliminations alone', () => {
    // Cell 3 has 2 both struck out (auto layer) and noted (manual layer).
    const state = play(newGame(true), note(3, 2), AUTO_OFF, note(3, 2));
    expect(state.cells[3]).toMatchObject({ notes: maskOf([2]), autoRemoved: maskOf([2]) });
    const next = reduce(state, place(2, 2, true));
    expect(next.cells[3]).toMatchObject({ notes: 0, autoRemoved: maskOf([2]) });
  });

  it('leaves a locked peer alone', () => {
    // Cell 3 holds a note for 4 underneath its checked-correct 6.
    const state = play(newGame(), note(3, 4), place(3, 6), select(3), CHECK_CELL);
    expect(state.cells[3].mark).toBe('correct');
    const next = reduce(state, place(2, 4, true));
    expect(next.cells[3]).toBe(state.cells[3]);
  });
});

describe('enter, candidate mode', () => {
  it('toggles a manual note on and off', () => {
    const on = reduce(newGame(), note(2, 7));
    expect(on.cells[2].notes).toBe(maskOf([7]));
    const both = reduce(on, note(2, 1));
    expect(both.cells[2].notes).toBe(maskOf([1, 7]));
    expect(reduce(both, note(2, 7)).cells[2].notes).toBe(maskOf([1]));
    expect(both.undoStack).toHaveLength(2);
  });

  it('allows any note in manual mode, even one a peer rules out', () => {
    expect(reduce(newGame(), note(2, 5)).cells[2].notes).toBe(maskOf([5]));
  });

  it('clears a placed value first, in the same undo step', () => {
    const placed = play(newGame(), place(2, 1), CHECK_CELL);
    expect(placed.cells[2].mark).toBe('wrong');
    const next = reduce(placed, note(2, 2));
    expect(next.cells[2]).toMatchObject({ value: 0, mark: 'none', notes: maskOf([2]) });
    expect(next.undoStack).toHaveLength(placed.undoStack.length + 1);
    expect(reduce(next, UNDO).cells[2]).toBe(placed.cells[2]);
  });

  describe('in auto-candidate mode', () => {
    it('strikes out and restores a computed candidate, leaving the notes alone', () => {
      const state = play(newGame(), note(2, 1), AUTO_ON);
      const struck = reduce(state, note(2, 2));
      expect(struck.cells[2]).toMatchObject({ notes: maskOf([1]), autoRemoved: maskOf([2]) });
      expect(visibleCandidates(struck)[2]).toBe(maskOf([1, 4]));
      const restored = reduce(struck, note(2, 2));
      expect(restored.cells[2].autoRemoved).toBe(0);
      expect(visibleCandidates(restored)[2]).toBe(maskOf([1, 2, 4]));
    });

    it('only clears the value when the digit is not a computed candidate', () => {
      const state = play(newGame(true), place(2, 1));
      const next = reduce(state, note(2, 5));
      expect(next.cells[2]).toMatchObject({ value: 0, autoRemoved: 0 });
      expect(next.undoStack).toHaveLength(state.undoStack.length + 1);
    });

    it('works out the computed candidates after clearing the value', () => {
      // Cell 2's own 1 does not rule 1 out of cell 2: once cleared, 1 is a candidate.
      const state = play(newGame(true), place(2, 1));
      expect(reduce(state, note(2, 1)).cells[2]).toMatchObject({
        value: 0,
        autoRemoved: maskOf([1]),
      });
    });

    it('treats a digit placed in a peer as not computed, even a wrong one', () => {
      const state = play(newGame(true), place(3, 2));
      expect(reduce(state, note(2, 2))).toBe(state);
    });
  });
});

describe('erase', () => {
  it('clears the value and its mark first, bringing the notes back', () => {
    const state = play(newGame(), note(2, 1), place(2, 3), CHECK_CELL);
    expect(state.cells[2].mark).toBe('wrong');
    const next = reduce(state, erase());
    expect(next.cells[2]).toMatchObject({ value: 0, mark: 'none', notes: maskOf([1]) });
    expect(next.undoStack).toHaveLength(state.undoStack.length + 1);
  });

  it('clears the notes on a second press', () => {
    const state = play(newGame(), note(2, 1), place(2, 3), erase());
    const next = reduce(state, erase());
    expect(next.cells[2].notes).toBe(0);
    expect(next.undoStack).toHaveLength(state.undoStack.length + 1);
  });

  it('leaves the auto-candidate eliminations alone', () => {
    const state = play(newGame(true), note(2, 1), AUTO_OFF, note(2, 4));
    const next = reduce(state, erase(2));
    expect(next.cells[2]).toMatchObject({ notes: 0, autoRemoved: maskOf([1]) });
  });

  it('erases at the given index', () => {
    const state = play(newGame(), place(40, 5));
    expect(reduce(state, erase(40)).cells[40].value).toBe(0);
  });

  it('clears a value in auto mode just as in manual mode', () => {
    const state = play(newGame(true), place(2, 4));
    expect(reduce(state, erase()).cells[2].value).toBe(0);
  });

  it('cannot erase a locked cell', () => {
    const state = play(newGame(), place(2, 4), CHECK_CELL);
    expect(reduce(state, erase())).toBe(state);
  });
});

describe('setMode / toggleMode', () => {
  it('switches the input mode without making an undo step', () => {
    const state = newGame();
    const candidate = reduce(state, { type: 'setMode', mode: 'candidate' });
    expect(candidate.mode).toBe('candidate');
    expect(candidate.undoStack).toBe(state.undoStack);
    const toggled = reduce(candidate, { type: 'toggleMode' });
    expect(toggled.mode).toBe('normal');
    expect(reduce(toggled, { type: 'toggleMode' }).mode).toBe('candidate');
  });
});

describe('setAutoCandidates', () => {
  it('switches auto mode on as an undo step, and puts it on the record', () => {
    const state = play(newGame(), select(40));
    const next = reduce(state, AUTO_ON);
    expect(next.autoCandidates).toBe(true);
    expect(next.assists.autoCandidates).toBe(true);
    expect(next.undoStack).toEqual([{ cells: [], autoCandidates: false, focus: 40 }]);
    expect(next.cells).toBe(state.cells);
  });

  it('keeps it on the record after switching off again', () => {
    const next = play(newGame(), AUTO_ON, AUTO_OFF);
    expect(next.autoCandidates).toBe(false);
    expect(next.assists.autoCandidates).toBe(true);
    expect(next.undoStack.at(-1)).toEqual({ cells: [], autoCandidates: true, focus: 2 });
  });

  it('does not touch the record again once it is there', () => {
    const once = play(newGame(), AUTO_ON, AUTO_OFF);
    expect(reduce(once, AUTO_ON).assists).toBe(once.assists);
  });

  it('shows the manual notes exactly as they were after switching off', () => {
    const state = play(newGame(), note(2, 7), note(3, 2));
    const auto = reduce(state, AUTO_ON);
    expect(visibleCandidates(auto)[2]).toBe(maskOf([1, 2, 4]));
    const back = play(auto, note(2, 1), AUTO_OFF);
    expect(visibleCandidates(back)[2]).toBe(maskOf([7]));
    expect(visibleCandidates(back)[3]).toBe(maskOf([2]));
  });

  it('restores the eliminations after switching back on', () => {
    const state = play(newGame(true), note(2, 1), AUTO_OFF, note(2, 9), AUTO_ON);
    expect(visibleCandidates(state)[2]).toBe(maskOf([2, 4]));
    expect(state.cells[2]).toMatchObject({ notes: maskOf([9]), autoRemoved: maskOf([1]) });
  });

  it('is undone and redone like any other change', () => {
    const on = play(newGame(), AUTO_ON, select(40));
    const undone = reduce(on, UNDO);
    expect(undone.autoCandidates).toBe(false);
    expect(undone.selected).toBe(2);
    expect(undone.cells).toBe(on.cells);
    expect(undone.redoStack).toEqual([{ cells: [], autoCandidates: true, focus: 2 }]);
    // Help already taken stays on the record.
    expect(undone.assists.autoCandidates).toBe(true);
    const redone = reduce(undone, REDO);
    expect(redone.autoCandidates).toBe(true);
    expect(redone.undoStack).toEqual([{ cells: [], autoCandidates: false, focus: 2 }]);
  });
});

describe('undo / redo', () => {
  it('undoes the last change, putting back the very same cell and selecting it', () => {
    const state = newGame();
    const placed = reduce(state, place(40, 5));
    const undone = reduce(placed, UNDO);
    expect(undone.cells[40]).toBe(state.cells[40]);
    expect(changedCells(state, undone)).toEqual([]);
    expect(undone.selected).toBe(40);
    expect(undone.undoStack).toHaveLength(0);
    expect(undone.redoStack).toEqual([{ cells: [[40, placed.cells[40]]], focus: 40 }]);
  });

  it('redoes what was undone', () => {
    const placed = reduce(newGame(), place(40, 5));
    const redone = play(placed, UNDO, select(0), REDO);
    expect(redone.cells[40]).toBe(placed.cells[40]);
    expect(redone.selected).toBe(40);
    expect(redone.undoStack).toHaveLength(1);
    expect(redone.redoStack).toHaveLength(0);
  });

  it('has no depth limit', () => {
    const state = newGame();
    const filled = fillAllBut(state, 2, 3);
    expect(filled.undoStack).toHaveLength(BLANKS.length - 2);
    const undone = play(filled, ...filled.undoStack.map(() => UNDO));
    expect(changedCells(state, undone)).toEqual([]);
    expect(reduce(undone, UNDO)).toBe(undone);
    const redone = play(undone, ...undone.redoStack.map(() => REDO));
    expect(changedCells(filled, redone)).toEqual([]);
  });

  it.each<[string, GameAction]>([
    ['a placed digit', place(3, 6)],
    ['a candidate', note(3, 6)],
    ['an erase', erase(40)],
    ['switching auto mode', AUTO_ON],
  ])('loses the redo history to %s', (_name, action) => {
    const state = play(newGame(), place(40, 5), place(2, 4), UNDO);
    expect(state.redoStack).toHaveLength(1);
    const next = reduce(state, action);
    expect(next.redoStack).toHaveLength(0);
    expect(reduce(next, REDO)).toBe(next);
  });

  it.each<[string, GameAction]>([
    ['hint', { type: 'hint', hint: HINT }],
    ['check', CHECK_PUZZLE],
    ['reveal', REVEAL],
    ['setMode', { type: 'setMode', mode: 'candidate' }],
  ])('keeps the undo and redo history through a %s, which is not undoable', (_name, action) => {
    // The check finds 40 wrong and the reveal fills 2: neither locks a cell the
    // history touches, so no entry is spent.
    const state = play(newGame(), place(40, 1), place(3, 6), UNDO, select(2));
    const next = reduce(state, action);
    expect(next).not.toBe(state);
    expect(next.undoStack).toBe(state.undoStack);
    expect(next.redoStack).toBe(state.redoStack);
  });

  describe('and locked cells', () => {
    // Locked cells never change, not even back. An entry that only touched
    // locked cells could do nothing, so it goes as the cells lock: an Undo
    // button driven by the stack greys out rather than doing nothing.
    it('drops undo history that only touched a cell a check has locked', () => {
      const state = play(newGame(), place(2, 4), CHECK_CELL);
      expect(state.undoStack).toHaveLength(0);
      expect(reduce(state, UNDO)).toBe(state);
    });

    it('drops redo history that only touched a cell revealed since', () => {
      const state = play(newGame(), place(2, 1), UNDO, REVEAL);
      expect(state.cells[2]).toMatchObject({ value: 4, mark: 'revealed' });
      expect(state.redoStack).toHaveLength(0);
      expect(reduce(state, REDO)).toBe(state);
    });

    it('keeps the live entries around the spent ones, and undoes them in turn', () => {
      const state = play(newGame(), place(3, 1), place(2, 4), place(40, 1), CHECK_CELL);
      // Only the entry for cell 2, the selected cell, went.
      expect(state.undoStack.map((entry) => entry.focus)).toEqual([3, 40]);
      const undone = play(state, UNDO, UNDO);
      expect(undone.cells[2]).toBe(state.cells[2]);
      expect(undone.cells[3].value).toBe(0);
      expect(undone.cells[40].value).toBe(0);
      expect(undone.selected).toBe(3);
      expect(undone.undoStack).toHaveLength(0);
      expect(undone.redoStack.map((entry) => entry.focus)).toEqual([40, 3]);
    });

    it('keeps a switch of auto mode, which touches no cell', () => {
      const state = play(newGame(), AUTO_ON, place(2, 4), CHECK_CELL);
      expect(state.undoStack).toEqual([{ cells: [], autoCandidates: false, focus: 2 }]);
      expect(reduce(state, UNDO).autoCandidates).toBe(false);
    });

    it('keeps the history as it was when a check locks nothing', () => {
      const state = play(newGame(), place(2, 1), place(3, 6), UNDO);
      const next = reduce(state, CHECK_PUZZLE);
      expect(next.cells[2].mark).toBe('wrong');
      expect(next.undoStack).toBe(state.undoStack);
      expect(next.redoStack).toBe(state.redoStack);
    });

    it('restores the unlocked part of an entry', () => {
      const state = play(newGame(), note(3, 4), note(3, 6), place(2, 4, true), CHECK_CELL);
      expect(state.cells[3].notes).toBe(maskOf([6]));
      const undone = reduce(state, UNDO);
      expect(undone.cells[2]).toBe(state.cells[2]);
      expect(undone.cells[3].notes).toBe(maskOf([4, 6]));
      expect(undone.redoStack).toEqual([{ cells: [[3, state.cells[3]]], focus: 2 }]);
    });

    it('keeps a check’s verdict on a cell whose value the undo leaves alone', () => {
      // Placing 4 at cell 2 stripped the 4 from the notes under cell 3's wrong
      // 1; a check since locked cell 2 and marked cell 3 wrong. Undoing gives
      // cell 3 its note back, but its value never changed, so the red slash
      // (help already taken) must stay.
      const state = play(newGame(), note(3, 4), place(3, 1), place(2, 4, true), CHECK_PUZZLE);
      expect(state.cells[3]).toMatchObject({ value: 1, notes: 0, mark: 'wrong' });
      const undone = reduce(state, UNDO);
      expect(undone.cells[3]).toEqual({ ...state.cells[3], notes: maskOf([4]) });
      const redone = reduce(undone, REDO);
      expect(redone.cells[3]).toBe(state.cells[3]);
    });

    it('brings a value back with the mark it had', () => {
      // Cell 2's wrong 1 was checked, then replaced: undoing restores both.
      const state = play(newGame(), place(2, 1), CHECK_CELL, place(2, 2));
      expect(reduce(state, UNDO).cells[2]).toMatchObject({ value: 1, mark: 'wrong' });
    });

    it('solves the game when undoing completes the grid', () => {
      // Every cell right except 3 (a wrong 2 over a right 6) and 2 (revealed since).
      const state = play(fillAllBut(newGame(), 2), place(3, 2), REVEAL);
      expect(state.status).toBe('playing');
      expect(reduce(state, UNDO).status).toBe('solved');
    });

    it('solves the game when redoing completes the grid', () => {
      // Undoing selected cell 3, so cell 2 is selected again for the reveal.
      const state = play(fillAllBut(newGame(), 2, 3), place(3, 6), UNDO, select(2), REVEAL);
      expect(state.status).toBe('playing');
      expect(reduce(state, REDO).status).toBe('solved');
    });
  });
});

describe('hint', () => {
  it('shows the hint, selects its cell and counts it', () => {
    const state = newGame();
    const next = reduce(state, { type: 'hint', hint: HINT });
    expect(next.hint).toBe(HINT);
    expect(next.selected).toBe(40);
    expect(next.assists.hints).toBe(1);
    expect(next.cells).toBe(state.cells);
    expect(next.undoStack).toBe(state.undoStack);
  });

  it('counts every hint shown', () => {
    const deduction: Hint = { kind: 'deduction', index: 3, technique: null };
    const next = play(newGame(), { type: 'hint', hint: HINT }, { type: 'hint', hint: deduction });
    expect(next.assists.hints).toBe(2);
    expect(next.selected).toBe(3);
  });

  it('shows "nothing to suggest" without counting it or moving the selection', () => {
    const hint: Hint = { kind: 'none' };
    const state = newGame();
    const next = reduce(state, { type: 'hint', hint });
    expect(next.hint).toBe(hint);
    expect(next.selected).toBe(2);
    expect(next.assists).toBe(state.assists);
  });

  it('keeps the selection when the hint points off the grid', () => {
    const next = reduce(newGame(), { type: 'hint', hint: { kind: 'mistake', index: 81 } });
    expect(next.selected).toBe(2);
    expect(next.assists.hints).toBe(1);
  });

  describe('pointing at a mistake', () => {
    const MISTAKE: GameAction = { type: 'hint', hint: { kind: 'mistake', index: 3 } };

    it('marks the wrong value wrong, as a check would, without counting a check', () => {
      const state = play(newGame(), place(3, 1), select(40));
      const next = reduce(state, MISTAKE);
      expect(next.selected).toBe(3);
      expect(next.cells[3]).toMatchObject({ value: 1, mark: 'wrong' });
      expect(next.assists).toEqual({ ...NO_ASSISTS, hints: 1 });
      // Only that cell changes, and there is nothing to undo about it.
      expect(changedCells(state, next)).toEqual([3]);
      expect(next.undoStack).toBe(state.undoStack);
    });

    it('keeps the mark after the hint itself has gone, until the value changes', () => {
      const marked = play(newGame(), place(3, 1), MISTAKE, select(40));
      expect(marked.hint).toBeNull();
      expect(marked.cells[3].mark).toBe('wrong');
      expect(reduce(marked, place(3, 2)).cells[3].mark).toBe('none');
    });

    it('leaves a cell already marked wrong as it was', () => {
      const state = play(newGame(), place(3, 1), select(3), CHECK_CELL);
      expect(state.cells[3].mark).toBe('wrong');
      expect(reduce(state, MISTAKE).cells).toBe(state.cells);
    });

    it('marks nothing a mistake hint got wrong: a right value, a given or an empty cell', () => {
      for (const [index, setup] of [
        [3, [place(3, 6)]],
        [0, []],
        [40, []],
      ] as const) {
        const state = play(newGame(), ...setup);
        const next = reduce(state, { type: 'hint', hint: { kind: 'mistake', index } });
        expect(next.cells).toBe(state.cells);
      }
    });
  });
});

describe('remembered hints', () => {
  const showHint = (hint: Hint): GameAction => ({ type: 'hint', hint });
  const MISTAKE_AT_3: Hint = { kind: 'mistake', index: 3 };
  const SHOW_ME_40: GameAction = { type: 'walkthrough', index: 40 };

  describe('a fill hint', () => {
    it('is remembered for its cell, and shown again whenever the cell is selected', () => {
      const state = play(newGame(), showHint(HINT), select(2));
      expect(state.hint).toBeNull();
      expect(shownHint(state)).toBeNull();
      expect(rememberedHint(state, 40)).toBe(HINT);
      const back = reduce(state, select(40));
      expect(shownHint(back)).toBe(HINT);
      expect(back.assists.hints).toBe(1);
    });

    it('is shown again for free when asked for again, and remembered as the newest', () => {
      const state = play(newGame(), showHint(HINT), select(2), showHint(NEWER_HINT));
      expect(state.assists.hints).toBe(1);
      expect(state.selected).toBe(40);
      expect(state.hint).toBe(NEWER_HINT);
      expect(rememberedHint(state, 40)).toBe(NEWER_HINT);
    });

    it('is counted once per cell', () => {
      const state = play(newGame(), showHint(HINT), showHint(DEDUCTION), showHint(HINT));
      expect(state.assists.hints).toBe(2);
      expect([...state.cellHints.keys()].sort()).toEqual([3, 40]);
    });

    it('is hidden while its cell holds a wrong value, and back when it is erased', () => {
      const state = play(newGame(), showHint(HINT), place(40, 1), select(2));
      expect(rememberedHint(state, 40)).toBeNull();
      expect(rememberedHint(reduce(state, erase(40)), 40)).toBe(HINT);
    });

    it('is forgotten once its cell holds its solution digit, and stays forgotten through undo', () => {
      const solved = play(newGame(), showHint(HINT), place(40, 5));
      expect(solved.cellHints.has(40)).toBe(false);
      const undone = reduce(solved, UNDO);
      expect(undone.cells[40].value).toBe(0);
      expect(rememberedHint(undone, 40)).toBeNull();
      // So asking for it again is a new hint.
      expect(reduce(undone, showHint(HINT)).assists.hints).toBe(2);
    });

    it('is forgotten when its cell is revealed', () => {
      expect(play(newGame(), showHint(HINT), REVEAL).cellHints.size).toBe(0);
    });

    it('outlives a mistake made in its cell, which gets a mistake hint of its own', () => {
      const state = play(newGame(), showHint(DEDUCTION), place(3, 1), showHint(MISTAKE_AT_3));
      // A different kind of hint about the cell: new, so counted.
      expect(state.assists.hints).toBe(2);
      expect(rememberedHint(state, 3)).toBe(MISTAKE_AT_3);
      expect(rememberedHint(reduce(state, erase(3)), 3)).toBe(DEDUCTION);
    });

    it('is not remembered for a cell that already holds its solution digit', () => {
      const state = play(newGame(), place(40, 5), showHint(HINT));
      expect(state.assists.hints).toBe(1);
      expect(state.cellHints.size).toBe(0);
    });
  });

  describe('a mistake hint', () => {
    it('is remembered while its cell holds the wrong value, and shown again for free', () => {
      const state = play(newGame(), place(3, 1), showHint(MISTAKE_AT_3), select(40));
      expect(shownHint(state)).toBeNull();
      expect(shownHint(reduce(state, select(3)))).toBe(MISTAKE_AT_3);
      const again = reduce(state, showHint({ kind: 'mistake', index: 3 }));
      expect(again.assists.hints).toBe(1);
      expect(again.selected).toBe(3);
    });

    it('is forgotten the moment the value changes, and not brought back by undo', () => {
      const changed = play(newGame(), place(3, 1), showHint(MISTAKE_AT_3), place(3, 2));
      expect(changed.cellHints.size).toBe(0);
      const undone = reduce(changed, UNDO);
      expect(undone.cells[3].value).toBe(1);
      expect(rememberedHint(undone, 3)).toBeNull();
      expect(reduce(undone, showHint(MISTAKE_AT_3)).assists.hints).toBe(2);
    });

    it('is not remembered when it got its cell wrong: an empty cell, a right value or a given', () => {
      for (const [index, setup] of [
        [40, []],
        [3, [place(3, 6)]],
        [0, []],
      ] as const) {
        const state = play(newGame(), ...setup, showHint({ kind: 'mistake', index }));
        expect(state.assists.hints).toBe(1);
        expect(state.cellHints.size).toBe(0);
      }
    });
  });

  it('is never made for a hint off the grid', () => {
    const state = reduce(newGame(), showHint({ kind: 'mistake', index: 81 }));
    expect(state.cellHints.size).toBe(0);
  });

  it('is kept by changes elsewhere on the board, map and all', () => {
    const state = play(newGame(), showHint(HINT), place(3, 1));
    const next = reduce(state, place(2, 4));
    expect(next.cellHints).toBe(state.cellHints);
  });

  it('is all forgotten by a reset, which keeps the hints on the record', () => {
    const state = play(newGame(), showHint(HINT), SHOW_ME_40, place(3, 1), showHint(MISTAKE_AT_3));
    const next = reduce(state, RESET);
    expect(next.cellHints.size).toBe(0);
    expect(next.assists.hints).toBe(3);
  });

  it('makes a reset do something on a board otherwise as it started', () => {
    // Hinted at the first empty cell, then the hint retired by moving away and back.
    const state = play(newGame(), showHint(DEDUCTION), select(2));
    expect(state.hint).toBeNull();
    expect(state.cellHints.size).toBe(1);
    const next = reduce(state, RESET);
    expect(next).not.toBe(state);
    expect(next.cellHints.size).toBe(0);
  });

  describe('"Show me"', () => {
    it('is counted the first time for a cell, and free after that', () => {
      const hinted = reduce(newGame(), showHint(HINT));
      const opened = reduce(hinted, SHOW_ME_40);
      expect(opened.assists.hints).toBe(2);
      expect(opened.cellHints.get(40)).toEqual<RememberedHints>({
        fill: HINT,
        mistake: null,
        walkthrough: true,
      });
      expect(reduce(opened, SHOW_ME_40)).toBe(opened);
    });

    it('stays free when the cell’s hint is asked for again', () => {
      const state = play(newGame(), showHint(HINT), SHOW_ME_40, select(2), showHint(NEWER_HINT));
      expect(state.cellHints.get(40)?.walkthrough).toBe(true);
      expect(reduce(state, SHOW_ME_40)).toBe(state);
      expect(state.assists.hints).toBe(2);
    });

    it('is forgotten with the fill hint', () => {
      const state = play(newGame(), showHint(HINT), SHOW_ME_40, place(40, 5), UNDO);
      expect(state.cellHints.size).toBe(0);
      expect(reduce(state, SHOW_ME_40)).toBe(state);
    });

    it.each<[string, GameAction[], number]>([
      ['a cell with no hint', [], 40],
      ['a cell with only a mistake hint', [place(3, 1), showHint(MISTAKE_AT_3)], 3],
      ['a cell whose fill hint is hidden by a value', [showHint(HINT), place(40, 1)], 40],
      ['an index off the grid', [showHint(HINT)], 81],
    ])('is ignored for %s', (_name, setup, index) => {
      const state = play(newGame(), ...setup);
      expect(reduce(state, { type: 'walkthrough', index })).toBe(state);
    });
  });
});

describe('check', () => {
  it('marks a right value correct, which locks it, and counts the check', () => {
    const state = play(newGame(), place(40, 1), place(2, 4));
    const next = reduce(state, CHECK_CELL);
    expect(next.cells[2].mark).toBe('correct');
    expect(isEditable(next, 2)).toBe(false);
    expect(next.assists.checks).toBe(1);
    // No undo step of its own, and placing the locked digit can no longer be undone.
    expect(next.undoStack).toEqual([state.undoStack[0]]);
  });

  it('marks a wrong value wrong, which leaves it editable', () => {
    const next = play(newGame(), place(2, 1), CHECK_CELL);
    expect(next.cells[2].mark).toBe('wrong');
    expect(isEditable(next, 2)).toBe(true);
    expect(next.assists.checks).toBe(1);
  });

  it('checks only the selected cell for scope "cell"', () => {
    const next = play(newGame(), place(2, 4), place(3, 1), CHECK_CELL);
    expect(next.cells[3].mark).toBe('none');
  });

  it('checks every placed value for scope "puzzle", counting one check', () => {
    const state = play(newGame(), place(2, 4), place(3, 1), place(40, 5), note(10, 7));
    const next = reduce(state, CHECK_PUZZLE);
    expect(next.cells[2].mark).toBe('correct');
    expect(next.cells[3].mark).toBe('wrong');
    expect(next.cells[40].mark).toBe('correct');
    expect(next.assists.checks).toBe(1);
    // Givens, empty cells and everything else keep their identity.
    expect(changedCells(state, next)).toEqual([2, 3, 40]);
  });

  it('skips cells already locked', () => {
    const state = play(newGame(), place(2, 4), CHECK_CELL, place(3, 1));
    const next = reduce(state, CHECK_PUZZLE);
    expect(next.cells[2]).toBe(state.cells[2]);
    expect(next.cells[3].mark).toBe('wrong');
  });

  it('counts re-checking a wrong value but leaves the cell as it was', () => {
    const state = play(newGame(), place(2, 1), CHECK_CELL);
    const next = reduce(state, CHECK_CELL);
    expect(next.assists.checks).toBe(2);
    expect(next.cells).toBe(state.cells);
  });
});

describe('reveal', () => {
  it('fills in the selected cell’s solution and locks it, as help taken', () => {
    const state = play(newGame(), note(40, 5), note(2, 1));
    const next = reduce(state, REVEAL);
    expect(next.cells[2]).toEqual({ ...state.cells[2], value: 4, mark: 'revealed' });
    expect(isEditable(next, 2)).toBe(false);
    expect(next.assists.reveals).toBe(1);
    // No undo step of its own, and the note under the locked digit can no longer be undone.
    expect(next.undoStack).toEqual([state.undoStack[0]]);
    expect(changedCells(state, next)).toEqual([2]);
  });

  it('replaces a wrong value', () => {
    const next = play(newGame(), place(2, 1), CHECK_CELL, REVEAL);
    expect(next.cells[2]).toMatchObject({ value: 4, mark: 'revealed' });
  });

  it('solves the game when it fills the last cell', () => {
    const next = reduce(fillAllBut(newGame(), 2), REVEAL);
    expect(next.status).toBe('solved');
  });
});

describe('reset', () => {
  // Values, notes, eliminations, marks, history, a hint, a moved selection,
  // candidate mode and auto mode — everything a reset might have to deal with.
  const messy = play(
    newGame(),
    place(2, 4),
    CHECK_CELL,
    place(3, 1),
    note(10, 7),
    AUTO_ON,
    note(11, 2),
    { type: 'setMode', mode: 'candidate' },
    select(5),
    REVEAL,
    place(40, 5),
    UNDO,
    { type: 'hint', hint: HINT },
  );

  it('puts the board back to the givens and forgets the history', () => {
    const fresh = newGame(true);
    const next = reduce(messy, RESET);
    expect(next.cells).toEqual(fresh.cells);
    expect(next.status).toBe('playing');
    expect(next.selected).toBe(2);
    expect(next.undoStack).toHaveLength(0);
    expect(next.redoStack).toHaveLength(0);
    expect(next.hint).toBeNull();
  });

  it('keeps the help already taken, the auto-candidate flag and the input mode', () => {
    const next = reduce(messy, RESET);
    expect(next.assists).toBe(messy.assists);
    expect(next.assists).toEqual({ autoCandidates: true, hints: 1, checks: 1, reveals: 1 });
    expect(next.autoCandidates).toBe(true);
    expect(next.mode).toBe('candidate');
  });

  it('keeps the identity of every cell that was already as it started', () => {
    const next = reduce(messy, RESET);
    expect(changedCells(messy, next)).toEqual([2, 3, 5, 10, 11]);
  });

  it('clears a hint from an untouched board', () => {
    // "Nothing to suggest" leaves the selection alone: only the hint differs.
    const state = reduce(newGame(), { type: 'hint', hint: { kind: 'none' } });
    const next = reduce(state, RESET);
    expect(next.hint).toBeNull();
    expect(next.selected).toBe(2);
    expect(next.cells).toBe(state.cells);
  });

  it('reselects the first empty cell on an untouched board', () => {
    expect(play(newGame(), select(40), RESET).selected).toBe(2);
  });

  // Boards that look untouched but have history: a reset that kept it would let
  // Undo replay the game from before the reset.
  it.each<[string, GameAction[], 'undoStack' | 'redoStack']>([
    ['undone back to the start', [place(2, 4), UNDO, select(2)], 'redoStack'],
    ['erased back to the start', [place(2, 4), erase()], 'undoStack'],
    ['with auto mode switched on', [AUTO_ON], 'undoStack'],
  ])('forgets the history of a board %s', (_name, setup, stack) => {
    const state = play(newGame(), ...setup);
    expect(state[stack]).not.toHaveLength(0);
    const next = reduce(state, RESET);
    expect(next).not.toBe(state);
    expect(next.cells).toBe(state.cells);
    expect(next.undoStack).toHaveLength(0);
    expect(next.redoStack).toHaveLength(0);
  });
});

describe('selectors', () => {
  it('reads the values', () => {
    const state = play(newGame(), place(2, 4));
    const values = valuesOf(state);
    expect(values).toBeInstanceOf(Uint8Array);
    expect(values[0]).toBe(5);
    expect(values[2]).toBe(4);
    expect(values[3]).toBe(0);
  });

  it('shows the manual notes of empty cells in manual mode', () => {
    const state = play(newGame(), note(2, 1), note(3, 9), note(40, 5), place(40, 5));
    const candidates = visibleCandidates(state);
    expect(candidates[2]).toBe(maskOf([1]));
    expect(candidates[3]).toBe(maskOf([9]));
    expect(candidates[40]).toBe(0);
    expect(candidates[0]).toBe(0);
  });

  it('shows the computed candidates minus the eliminations in auto mode', () => {
    const state = play(newGame(true), note(2, 1), place(40, 5));
    const candidates = visibleCandidates(state);
    const computed = computeCandidates(valuesOf(state));
    expect(candidates[2]).toBe(maskOf([2, 4]));
    expect(candidates[3]).toBe(computed[3]);
    expect(candidates[40]).toBe(0);
    expect(candidates[0]).toBe(0);
  });

  it('gives Hint and Show me the placed digits and their naked candidates, not the notes or strikes', () => {
    for (const state of [
      play(newGame(), note(2, 1), place(40, 5)),
      play(newGame(true), note(2, 1), place(40, 5)),
    ]) {
      const board = hintBoardOf(state);
      expect(board.values).toEqual(valuesOf(state));
      expect(board.candidates).toEqual(computeCandidates(valuesOf(state)));
      expect(board.candidates[2]).toBe(maskOf([1, 2, 4]));
    }
  });

  it('flags both cells of a clash', () => {
    const conflicts = conflictsOf(reduce(newGame(), place(2, 5)));
    expect(conflicts[0]).toBe(true);
    expect(conflicts[2]).toBe(true);
    expect(conflicts.filter(Boolean)).toHaveLength(2);
    expect(conflictsOf(newGame()).some(Boolean)).toBe(false);
  });

  it('counts each digit placed', () => {
    const counts = digitCounts(newGame());
    expect(counts).toHaveLength(10);
    expect(counts[0]).toBe(0);
    // The Wikipedia givens hold three 5s and four 9s.
    expect(counts[5]).toBe(3);
    expect(counts[9]).toBe(4);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(30);
    expect(digitCounts(solvedGame())).toEqual([0, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
  });

  it('tells a full board from one with gaps', () => {
    expect(isBoardFull(newGame())).toBe(false);
    expect(isBoardFull(fillAllBut(newGame(), 2))).toBe(false);
    expect(isBoardFull(solvedGame())).toBe(true);
  });

  it('says which cells can be edited', () => {
    const state = play(newGame(), place(2, 4), CHECK_CELL, select(3), REVEAL, place(40, 1));
    expect(isEditable(state, 0)).toBe(false); // given
    expect(isEditable(state, 2)).toBe(false); // checked correct
    expect(isEditable(state, 3)).toBe(false); // revealed
    expect(isEditable(state, 40)).toBe(true); // a player's value
    expect(isEditable(state, 5)).toBe(true); // empty
    expect(isEditable(state, -1)).toBe(false);
    expect(isEditable(state, 81)).toBe(false);
    expect(isEditable(state, 0.5)).toBe(false);
  });
});

describe('Check guesses when entered', () => {
  it('starts off, and switching it on records the help for good', () => {
    expect(newGame().checkGuesses).toBe(false);
    const on = play(newGame(), CHECK_GUESSES_ON);
    expect(on.checkGuesses).toBe(true);
    expect(on.assists).toEqual({ ...NO_ASSISTS, checkGuesses: true });
    const off = play(on, CHECK_GUESSES_OFF);
    expect(off.checkGuesses).toBe(false);
    expect(off.assists).toEqual({ ...NO_ASSISTS, checkGuesses: true });
    // And on again: the help is already on the record.
    expect(play(off, CHECK_GUESSES_ON).assists).toBe(off.assists);
  });

  it('is no move to undo, and leaves the board, the history and the hint on show alone', () => {
    const before = play(newGame(), place(2, 1), place(3, 6), UNDO, { type: 'hint', hint: HINT });
    const after = play(before, CHECK_GUESSES_ON);
    expect(after.cells).toBe(before.cells);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.redoStack).toBe(before.redoStack);
    expect(after.hint).toBe(HINT);
  });

  it('changes nothing when it is already so, or the game is solved', () => {
    const game = newGame();
    expect(reduce(game, CHECK_GUESSES_OFF)).toBe(game);
    const on = play(game, CHECK_GUESSES_ON);
    expect(reduce(on, CHECK_GUESSES_ON)).toBe(on);
    const solved = solvedGame();
    expect(reduce(solved, CHECK_GUESSES_ON)).toBe(solved);
  });

  it('never judges a number already on the board as it comes on', () => {
    const on = play(newGame(), place(2, 1), CHECK_GUESSES_ON);
    expect(on.cells[2]).toMatchObject({ value: 1, mark: 'none' });
  });

  it('marks a wrong number wrong the moment it is entered, and a right one not at all', () => {
    const on = play(newGame(), CHECK_GUESSES_ON, place(2, 1), place(3, 6));
    expect(on.cells[2]).toMatchObject({ value: 1, mark: 'wrong' });
    expect(on.cells[3]).toMatchObject({ value: 6, mark: 'none' });
  });

  it('marks a wrong number typed over another, and clears the mark for the answer', () => {
    const wrongAgain = play(newGame(), CHECK_GUESSES_ON, place(2, 1), place(2, 2));
    expect(wrongAgain.cells[2]).toMatchObject({ value: 2, mark: 'wrong' });
    expect(play(wrongAgain, place(2, 4)).cells[2]).toMatchObject({ value: 4, mark: 'none' });
  });

  it('never judges a number entered before it came on that Undo or Redo brings back', () => {
    const before = play(newGame(), place(2, 1), place(2, 4), CHECK_GUESSES_ON);
    const undone = play(before, UNDO);
    expect(undone.cells[2]).toMatchObject({ value: 1, mark: 'none' });
    const redone = play(newGame(), place(2, 1), UNDO, CHECK_GUESSES_ON, REDO);
    expect(redone.cells[2]).toMatchObject({ value: 1, mark: 'none' });
  });

  it('gives no free Check of the board by Undo all the way back then Redo all the way', () => {
    const before = play(newGame(), place(3, 6), place(2, 1), place(5, 2), CHECK_GUESSES_ON);
    const replayed = play(before, UNDO, UNDO, UNDO, REDO, REDO, REDO);
    expect(replayed.cells.map((cell) => cell.mark)).toEqual(before.cells.map((cell) => cell.mark));
    expect(replayed.cells[2]).toMatchObject({ value: 1, mark: 'none' });
    expect(replayed.assists).toEqual({ ...NO_ASSISTS, checkGuesses: true });
  });

  it('brings back a number it marked with its mark, by Undo of an erase', () => {
    const erased = play(newGame(), CHECK_GUESSES_ON, place(2, 1), erase(2), CHECK_GUESSES_OFF);
    expect(play(erased, UNDO).cells[2]).toMatchObject({ value: 1, mark: 'wrong' });
  });

  it('keeps its mark out of the history: Undo takes the number, Redo brings it back marked', () => {
    const on = play(newGame(), CHECK_GUESSES_ON, place(2, 1));
    expect(on.undoStack.at(-1)?.cells).toEqual([[2, expect.objectContaining({ mark: 'none' })]]);
    const undone = play(on, UNDO);
    expect(undone.cells[2]).toMatchObject({ value: 0, mark: 'none' });
    expect(play(undone, CHECK_GUESSES_OFF, REDO).cells[2]).toMatchObject({
      value: 1,
      mark: 'wrong',
    });
  });

  it('stops marking once off, and leaves the marks it gave', () => {
    const off = play(newGame(), CHECK_GUESSES_ON, place(2, 1), CHECK_GUESSES_OFF, place(3, 2));
    expect(off.cells[2]).toMatchObject({ value: 1, mark: 'wrong' });
    expect(off.cells[3]).toMatchObject({ value: 2, mark: 'none' });
  });

  it('marks nothing that a candidate entry, an erase or a peer’s cleared notes change', () => {
    const on = play(newGame(), note(3, 1), CHECK_GUESSES_ON, place(2, 1), note(2, 7));
    expect(on.cells[2]).toMatchObject({ value: 0, mark: 'none' });
    // Cell 5 is in cell 3's row: the 1 placed there clears cell 3's note.
    const cleared = play(on, place(5, 1, true), erase(5));
    expect(cleared.cells[3]).toMatchObject({ value: 0, notes: 0, mark: 'none' });
    expect(cleared.cells[5]).toMatchObject({ value: 0, mark: 'none' });
  });

  it('leaves a revealed cell its own mark', () => {
    const revealed = play(newGame(), CHECK_GUESSES_ON, select(2), REVEAL);
    expect(revealed.cells[2]).toMatchObject({ value: 4, mark: 'revealed' });
  });

  it('is no Check: a Check of a cell it marked still counts as one', () => {
    const checked = play(newGame(), CHECK_GUESSES_ON, place(2, 1), select(2), CHECK_CELL);
    expect(checked.assists).toEqual({ ...NO_ASSISTS, checks: 1, checkGuesses: true });
  });

  describe('saved and loaded', () => {
    it('is saved only while on, and loads as it was saved', () => {
      expect(serialiseGame(newGame())).not.toHaveProperty('checkGuesses');
      const on = play(newGame(), CHECK_GUESSES_ON, place(2, 1));
      const data = serialiseGame(on);
      expect(data.checkGuesses).toBe(true);
      expect(data.assists).toEqual({ ...NO_ASSISTS, checkGuesses: true });
      const loaded = deserialiseGame(JSON.parse(JSON.stringify(data)))!;
      expect(loaded.checkGuesses).toBe(true);
      expect(loaded.cells[2].mark).toBe('wrong');
      expect(loaded.assists).toEqual({ ...NO_ASSISTS, checkGuesses: true });
    });

    it('loads as off from a save without it, or with anything but on', () => {
      const data = serialiseGame(newGame());
      for (const checkGuesses of [undefined, false, 1, 'true']) {
        expect(deserialiseGame({ ...data, checkGuesses })?.checkGuesses).toBe(false);
      }
    });

    it('records the help for a game saved with it on but not in its assists', () => {
      const data = serialiseGame(play(newGame(), CHECK_GUESSES_ON));
      const loaded = deserialiseGame({ ...data, assists: NO_ASSISTS });
      expect(loaded?.assists).toEqual({ ...NO_ASSISTS, checkGuesses: true });
    });

    it('does not take a wrong mark for a Check while it was on', () => {
      // A wrong guess is marked as it goes in, with no Check taken.
      const wrong = serialiseGame(play(newGame(), place(2, 1), CHECK_CELL));
      const assists = { ...NO_ASSISTS, checkGuesses: true };
      const restored = deserialiseGame({ ...wrong, assists });
      expect(restored?.cells[2].mark).toBe('wrong');
      expect(restored?.assists).toEqual(assists);
    });

    it('takes a wrong mark for a Check, and drops the help, when it is anything but on', () => {
      const wrong = serialiseGame(play(newGame(), place(2, 1), CHECK_CELL));
      for (const checkGuesses of [false, 1, 'true']) {
        const restored = deserialiseGame({ ...wrong, assists: { ...NO_ASSISTS, checkGuesses } });
        expect(restored?.assists).toEqual({ ...NO_ASSISTS, checks: 1 });
      }
    });

    it('still takes a mark of correct for a Check while it was on', () => {
      // Only a Check says a digit is right; checking guesses marks wrong ones alone.
      const right = serialiseGame(play(newGame(), place(2, 4), CHECK_CELL));
      const assists = { ...NO_ASSISTS, checkGuesses: true };
      expect(deserialiseGame({ ...right, assists })?.assists).toEqual({ ...assists, checks: 1 });
    });
  });
});

describe('serialiseGame / deserialiseGame', () => {
  // A game with something in every field worth saving: notes (5), a checked
  // right value (2), a checked wrong one (3), an elimination (6), a reveal (7),
  // an unchecked wrong value (10), auto mode, a moved selection and a hint.
  const rich = play(
    newGame(),
    note(5, 1),
    note(5, 8),
    place(2, 4),
    place(3, 1),
    CHECK_PUZZLE,
    AUTO_ON,
    note(6, 9),
    select(7),
    REVEAL,
    place(10, 7),
    place(10, 9),
    select(40),
    { type: 'hint', hint: HINT },
  );
  const data = serialiseGame(rich);

  function replaceAt<T>(list: readonly T[], index: number, value: unknown): unknown[] {
    return list.map((item, i) => (i === index ? value : item));
  }

  function editMarks(marks: string, edits: Record<number, string>): string {
    return marks.replace(/./g, (code, index: number) => edits[index] ?? code);
  }

  it('saves the board as plain data', () => {
    expect(data.v).toBe(1);
    expect(data.puzzle).toEqual(PUZZLE);
    expect(data.puzzle).not.toBe(PUZZLE);
    expect(data.values.slice(0, 11)).toBe('53417001069');
    expect(data.notes[5]).toBe(maskOf([1, 8]));
    expect(data.autoRemoved[6]).toBe(maskOf([9]));
    expect(data.marks).toHaveLength(81);
    expect(data.marks.slice(0, 11)).toBe('..cw...r...');
    expect(data.selected).toBe(40);
    expect(data.autoCandidates).toBe(true);
    expect(data.status).toBe('playing');
    expect(data.assists).toEqual({ autoCandidates: true, hints: 1, checks: 1, reveals: 1 });
    expect(data.assists).not.toBe(rich.assists);
  });

  it('round-trips through JSON, without the history, the mode or the hint just asked for', () => {
    const restored = deserialiseGame(JSON.parse(JSON.stringify(data)));
    expect(restored).toEqual({
      ...rich,
      mode: 'normal',
      undoStack: [],
      redoStack: [],
      hint: null,
    });
  });

  it('round-trips a fresh game and a solved one', () => {
    expect(deserialiseGame(serialiseGame(newGame()))).toEqual(newGame());
    const solved = solvedGame();
    expect(deserialiseGame(serialiseGame(solved))).toMatchObject({
      status: 'solved',
      cells: solved.cells,
    });
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'game'],
    ['an array', []],
    ['an empty object', {}],
  ])('rejects %s', (_name, value) => {
    expect(deserialiseGame(value)).toBeNull();
  });

  // A valid solution grid that disagrees with the givens: every 1 and 2 swapped.
  const relabelled = PUZZLE.solution.replace(/[12]/g, (d) => (d === '1' ? '2' : '1'));

  // Broken solutions that still agree with every given, so nothing but the
  // completeness and validity checks can catch them. Cells 2 and 3 are blanks.
  it.each<[string, string]>([
    ['incomplete', `${PUZZLE.solution.slice(0, 2)}0${PUZZLE.solution.slice(3)}`],
    // Cells 2 and 3 swapped: row 0 stays whole, but columns 2 and 3 clash.
    [
      'not a valid grid',
      `${PUZZLE.solution.slice(0, 2)}${PUZZLE.solution[3]}${PUZZLE.solution[2]}${PUZZLE.solution.slice(4)}`,
    ],
  ])('rejects a solution that agrees with the givens but is %s', (_name, solution) => {
    expect([...PUZZLE.givens].every((given, i) => given === '0' || given === solution[i])).toBe(
      true,
    );
    expect(deserialiseGame({ ...data, puzzle: { ...data.puzzle, solution } })).toBeNull();
  });

  it.each<Difficulty>(['easy', 'medium', 'hard', 'expert'])(
    'round-trips a game of every difficulty: %s',
    (difficulty) => {
      const state = createGame({ ...PUZZLE, difficulty });
      expect(deserialiseGame(serialiseGame(state))?.puzzle.difficulty).toBe(difficulty);
    },
  );

  it.each<[string, (d: SerialisedGame) => unknown]>([
    ['another version', (d) => ({ ...d, v: 2 })],
    ['no version', ({ v: _v, ...d }) => d],
    ['no puzzle', ({ puzzle: _puzzle, ...d }) => d],
    ['a puzzle that is not an object', (d) => ({ ...d, puzzle: 'puzzle' })],
    ['malformed givens', (d) => ({ ...d, puzzle: { ...d.puzzle, givens: d.values.slice(1) } })],
    [
      'a malformed solution',
      (d) => ({ ...d, puzzle: { ...d.puzzle, solution: PUZZLE.solution.replace('5', '.') } }),
    ],
    ['an unknown difficulty', (d) => ({ ...d, puzzle: { ...d.puzzle, difficulty: 'fiendish' } })],
    [
      'a missing difficulty',
      (d) => ({ ...d, puzzle: { givens: d.puzzle.givens, solution: d.puzzle.solution } }),
    ],
    [
      'a solution disagreeing with the givens',
      (d) => ({ ...d, puzzle: { ...d.puzzle, solution: relabelled } }),
    ],
    ['values of the wrong length', (d) => ({ ...d, values: d.values.slice(1) })],
    ['values with stray characters', (d) => ({ ...d, values: d.values.replace('0', '.') })],
    ['values that are not a string', (d) => ({ ...d, values: 0 })],
    ['a given changed', (d) => ({ ...d, values: `1${d.values.slice(1)}` })],
    ['a given removed', (d) => ({ ...d, values: `0${d.values.slice(1)}` })],
    ['notes that are not an array', (d) => ({ ...d, notes: {} })],
    ['too few notes', (d) => ({ ...d, notes: d.notes.slice(1) })],
    ['a note mask beyond 9 bits', (d) => ({ ...d, notes: replaceAt(d.notes, 5, 512) })],
    ['a negative note mask', (d) => ({ ...d, notes: replaceAt(d.notes, 5, -1) })],
    ['a fractional note mask', (d) => ({ ...d, notes: replaceAt(d.notes, 5, 1.5) })],
    ['a note mask as a string', (d) => ({ ...d, notes: replaceAt(d.notes, 5, '3') })],
    // JSON cannot make holes, but anything can be handed in: a hole would load
    // as a cell with no notes at all, then save as null and never load again.
    ['notes with holes', (d) => ({ ...d, notes: new Array(81) })],
    ['eliminations with holes', (d) => ({ ...d, autoRemoved: new Array(81) })],
    ['missing eliminations', ({ autoRemoved: _autoRemoved, ...d }) => d],
    ['too many eliminations', (d) => ({ ...d, autoRemoved: [...d.autoRemoved, 0] })],
    [
      'an elimination mask beyond 9 bits',
      (d) => ({ ...d, autoRemoved: replaceAt(d.autoRemoved, 6, 1024) }),
    ],
    ['marks of the wrong length', (d) => ({ ...d, marks: d.marks.slice(1) })],
    ['an unknown mark', (d) => ({ ...d, marks: `x${d.marks.slice(1)}` })],
    ['marks that are not a string', (d) => ({ ...d, marks: [] })],
    ['no assists', ({ assists: _assists, ...d }) => d],
    ['assists that are not an object', (d) => ({ ...d, assists: 3 })],
    [
      'a non-boolean auto-candidate assist',
      (d) => ({ ...d, assists: { ...d.assists, autoCandidates: 1 } }),
    ],
    ['a negative hint count', (d) => ({ ...d, assists: { ...d.assists, hints: -1 } })],
    ['a fractional check count', (d) => ({ ...d, assists: { ...d.assists, checks: 1.5 } })],
    ['a reveal count as a string', (d) => ({ ...d, assists: { ...d.assists, reveals: '1' } })],
    [
      'a missing reveal count',
      (d) => {
        const { reveals: _reveals, ...assists } = d.assists;
        return { ...d, assists };
      },
    ],
  ])('rejects %s', (_name, patch) => {
    expect(deserialiseGame(patch(data))).toBeNull();
  });

  describe('remembered hints', () => {
    // A fill hint with "Show me" opened (cell 40), and a fill hint hidden by
    // a wrong value that has a mistake hint of its own (cell 3, holding 1).
    const hinted = play(
      newGame(),
      { type: 'hint', hint: HINT },
      { type: 'walkthrough', index: 40 },
      { type: 'hint', hint: DEDUCTION },
      place(3, 1),
      { type: 'hint', hint: { kind: 'mistake', index: 3 } },
    );
    const saved = serialiseGame(hinted);
    const [AT_40, AT_3] = saved.cellHints!;

    /** The remembered hints `saved` loads with, given these stored ones. */
    function loadHints(cellHints: unknown, base: SerialisedGame = saved) {
      return deserialiseGame({ ...base, cellHints })!.cellHints;
    }

    it('saves them as plain data', () => {
      expect(saved.cellHints).toEqual<SerialisedCellHints[]>([
        { index: 40, fill: HINT, mistake: 0, walkthrough: true },
        { index: 3, fill: DEDUCTION, mistake: 1, walkthrough: false },
      ]);
    });

    it('round-trips them through JSON', () => {
      const restored = deserialiseGame(JSON.parse(JSON.stringify(saved)))!;
      expect(restored.cellHints).toEqual(hinted.cellHints);
      expect(restored.assists).toEqual(hinted.assists);
      expect(rememberedHint(restored, 3)).toEqual({ kind: 'mistake', index: 3 });
      expect(rememberedHint(reduce(restored, erase(3)), 3)).toEqual(DEDUCTION);
    });

    it('loads a save from before hints were remembered with none', () => {
      const { cellHints: _cellHints, ...old } = saved;
      const restored = deserialiseGame(old)!;
      expect(restored.cellHints.size).toBe(0);
      expect(restored.assists).toEqual(hinted.assists);
    });

    it.each<[string, unknown]>([
      ['not a list', { 40: AT_40 }],
      ['a list with holes', new Array(2)],
      ['a list of things that are not entries', [null, 'hint', 40]],
      [
        'entries for cells off the grid',
        [
          { ...AT_40, index: 81 },
          { ...AT_3, index: -1 },
        ],
      ],
      [
        'entries for no cell at all',
        [
          { ...AT_40, index: 4.5 },
          { ...AT_3, index: '3' },
        ],
      ],
    ])('forgets them all when they are %s', (_name, cellHints) => {
      expect(loadHints(cellHints).size).toBe(0);
    });

    it('keeps the first entry for a cell listed twice', () => {
      const cellHints = loadHints([AT_40, { ...AT_40, walkthrough: false }]);
      expect(cellHints.get(40)?.walkthrough).toBe(true);
    });

    it.each<[string, unknown]>([
      ['not an object', 'single'],
      ['for another cell', { ...HINT, index: 41 }],
      ['of an unknown kind', { ...HINT, kind: 'guess' }],
      ['a single by a technique that places nothing', { ...HINT, technique: 'pointing' }],
      ['a single by no technique at all', { ...HINT, technique: 5 }],
      ['a single with its unit missing', { ...NEWER_HINT, unit: undefined }],
      ['a single in a unit that is not an object', { ...NEWER_HINT, unit: 'box' }],
      ['a single in an unknown kind of unit', { ...NEWER_HINT, unit: { kind: 'cage', index: 4 } }],
      ['a single in a unit past the grid', { ...NEWER_HINT, unit: { kind: 'box', index: 9 } }],
      ['a single in a unit before the grid', { ...NEWER_HINT, unit: { kind: 'row', index: -1 } }],
      ['a single in a fractional unit', { ...NEWER_HINT, unit: { kind: 'row', index: 1.5 } }],
      ['a deduction by an unknown technique', { ...DEDUCTION, index: 40, technique: 'guess' }],
      ['a deduction missing its technique', { kind: 'deduction', index: 40 }],
    ])('forgets a fill hint that is %s', (_name, fill) => {
      // Cell 40 has nothing else remembered, so nothing is left of it.
      expect(loadHints([{ ...AT_40, fill }]).has(40)).toBe(false);
    });

    it.each<[string, unknown, Hint]>([
      ['a single with no unit', HINT, HINT],
      ['a single in a unit', NEWER_HINT, NEWER_HINT],
      [
        'a single in a unit with extra fields, which it leaves behind',
        { ...NEWER_HINT, unit: { kind: 'box', index: 4, extra: true } },
        NEWER_HINT,
      ],
      [
        'a deduction by no known technique',
        { kind: 'deduction', index: 40, technique: null },
        { kind: 'deduction', index: 40, technique: null },
      ],
      [
        'a deduction by a technique',
        { ...DEDUCTION, index: 40, extra: true },
        { ...DEDUCTION, index: 40 },
      ],
    ])('keeps a fill hint that is %s', (_name, fill, expected) => {
      expect(loadHints([{ ...AT_40, fill }]).get(40)?.fill).toEqual(expected);
    });

    it('forgets a mistake hint about a value the cell no longer holds', () => {
      const entry = loadHints([{ ...AT_3, mistake: 2 }]).get(3);
      expect(entry).toEqual<RememberedHints>({
        fill: DEDUCTION,
        mistake: null,
        walkthrough: false,
      });
    });

    it.each<[string, GameAction[], SerialisedCellHints]>([
      [
        'a mistake hint on an empty cell',
        [],
        { index: 5, fill: null, mistake: 0, walkthrough: false },
      ],
      [
        'a mistake hint on a wrong digit it is not about',
        [],
        { index: 5, fill: null, mistake: 3, walkthrough: false },
      ],
      [
        'a mistake hint on a right value',
        [place(2, 4)],
        { index: 2, fill: null, mistake: 4, walkthrough: false },
      ],
      ['a mistake hint on a given', [], { index: 0, fill: null, mistake: 5, walkthrough: false }],
      ['a fill hint for a cell holding its solution digit', [place(40, 5)], { ...AT_40 }],
    ])('forgets %s', (_name, actions, entry) => {
      const base = serialiseGame(play(newGame(), ...actions));
      expect(loadHints([entry], base).size).toBe(0);
    });

    it('takes anything but true as "Show me" not opened', () => {
      expect(loadHints([{ ...AT_40, walkthrough: 'yes' }]).get(40)?.walkthrough).toBe(false);
    });

    it('forgets "Show me" for a cell with no fill hint', () => {
      const entry = loadHints([{ ...AT_3, fill: null, walkthrough: true }]).get(3);
      expect(entry).toEqual<RememberedHints>({
        fill: null,
        mistake: { hint: { kind: 'mistake', index: 3 }, value: 1 },
        walkthrough: false,
      });
    });

    it('raises the hints taken to cover every hint remembered and every "Show me" opened', () => {
      // Two fill hints, a mistake hint and a "Show me": and the wrong mark at
      // cell 3 is then down to a hint, not a check.
      const restored = deserialiseGame({ ...saved, assists: NO_ASSISTS });
      expect(restored?.assists).toEqual({ ...NO_ASSISTS, hints: 4 });
    });

    it('keeps a hint count that already covers them', () => {
      const assists: Assists = { ...NO_ASSISTS, hints: 9 };
      expect(deserialiseGame({ ...saved, assists })?.assists).toEqual(assists);
    });
  });

  describe('coerces what can be fixed without changing the board', () => {
    it.each<[string, unknown]>([
      ['below the grid', -1],
      ['past the grid', 81],
      ['fractional', 2.5],
      ['not a number', '40'],
      ['missing', undefined],
    ])('selects the first empty cell when the selection is %s', (_name, selected) => {
      // Cells 2 and 3 are filled in `rich`, and 4 is a given: 5 is the first empty cell.
      expect(deserialiseGame({ ...data, selected })?.selected).toBe(5);
    });

    it('selects the top-left cell when the board is full', () => {
      expect(deserialiseGame({ ...serialiseGame(solvedGame()), selected: -1 })?.selected).toBe(0);
    });

    it.each<[string, unknown]>([
      ['a string', 'yes'],
      ['a number', 1],
      ['missing', undefined],
    ])('switches auto mode off when the flag is %s', (_name, autoCandidates) => {
      // Auto mode on, but no eliminations: only the stored record says it was used.
      const saved = serialiseGame(play(newGame(), AUTO_ON));
      const restored = deserialiseGame({ ...saved, autoCandidates });
      expect(restored?.autoCandidates).toBe(false);
      // What was used stays on the record.
      expect(restored?.assists.autoCandidates).toBe(true);
    });

    it('puts auto mode on the record when it is on', () => {
      // No eliminations either: the flag alone must put it there.
      const restored = deserialiseGame({ ...serialiseGame(newGame(true)), assists: NO_ASSISTS });
      expect(restored?.assists.autoCandidates).toBe(true);
    });

    // Assists that contradict the board would let a revealed game count as
    // unassisted — and set a best time.
    it.each<[string, GameAction[], Partial<Assists>]>([
      ['a revealed cell is a reveal', [REVEAL, select(3), REVEAL], { reveals: 2 }],
      ['a cell checked correct is a check', [place(2, 4), CHECK_CELL], { checks: 1 }],
      ['a cell checked wrong is a check', [place(2, 1), CHECK_CELL], { checks: 1 }],
      [
        'an elimination means auto mode was used',
        [AUTO_ON, note(2, 1), AUTO_OFF],
        { autoCandidates: true },
      ],
    ])('raises the assists to cover the board: %s', (_name, actions, expected) => {
      const saved = serialiseGame(play(newGame(), ...actions));
      const restored = deserialiseGame({ ...saved, assists: NO_ASSISTS });
      expect(restored?.assists).toEqual({ ...NO_ASSISTS, ...expected });
    });

    it('puts a wrong mark down to the hints taken, when there were any', () => {
      // A hint marks the mistake it points at, as a check would.
      const hinted = play(newGame(), place(2, 1), {
        type: 'hint',
        hint: { kind: 'mistake', index: 2 },
      });
      const restored = deserialiseGame(serialiseGame(hinted));
      expect(restored?.cells[2].mark).toBe('wrong');
      expect(restored?.assists).toEqual({ ...NO_ASSISTS, hints: 1 });
    });

    it('keeps assists that already cover the board', () => {
      // `rich` shows two checked cells, one revealed and an elimination.
      const assists: Assists = { autoCandidates: true, hints: 3, checks: 4, reveals: 5 };
      expect(deserialiseGame({ ...data, assists })?.assists).toEqual(assists);
    });

    it('works the status out from the values rather than trusting it', () => {
      expect(deserialiseGame({ ...data, status: 'solved' })?.status).toBe('playing');
      expect(deserialiseGame({ ...data, status: 'won' })?.status).toBe('playing');
      const solved = { ...serialiseGame(solvedGame()), status: 'playing' };
      expect(deserialiseGame(solved)?.status).toBe('solved');
    });

    it('drops marks no check could have made', () => {
      // Cell 0 is a given; 2 holds a right 4, 3 a wrong 1, 5 nothing, 10 a wrong 9.
      const marks = editMarks(data.marks, { 0: 'c', 2: 'w', 3: 'c', 5: 'w', 10: 'r' });
      const restored = deserialiseGame({ ...data, marks });
      for (const index of [0, 2, 3, 5, 10]) expect(restored?.cells[index].mark).toBe('none');
    });

    it('keeps the marks a check could have made', () => {
      const marks = editMarks(data.marks, { 2: 'r', 3: 'w', 7: 'c' });
      const restored = deserialiseGame({ ...data, marks });
      expect(restored?.cells[2].mark).toBe('revealed');
      expect(restored?.cells[3].mark).toBe('wrong');
      expect(restored?.cells[7].mark).toBe('correct');
    });

    it('drops notes and eliminations on givens', () => {
      const restored = deserialiseGame({
        ...data,
        notes: replaceAt(data.notes, 0, 3),
        autoRemoved: replaceAt(data.autoRemoved, 0, 5),
      });
      expect(restored?.cells[0]).toEqual(rich.cells[0]);
    });

    it('loads a save with top-level fields it does not know, leaving them to the store', () => {
      // `saveGameBlob` carries them over; the board here is the same either way.
      expect(deserialiseGame({ ...data, extra: true, moves: 'x'.repeat(500) })).toEqual(
        deserialiseGame(data),
      );
    });
  });

  it('lists every top-level field a save has as one this version knows', () => {
    // `saveGameBlob` carries over only fields not on this list, so one this
    // version writes but leaves off it could have a stale value brought back.
    const everything = serialiseGame(play(rich, CHECK_GUESSES_ON));
    expect(Object.keys(everything).sort()).toEqual([...SERIALISED_GAME_FIELDS].sort());
  });

  describe('assists a newer version added', () => {
    // As a later version might save them: a new kind of help, counted.
    const newer = { ...data, assists: { ...data.assists, peeks: 2 } };

    it('loads the save, keeping the new field', () => {
      expect(deserialiseGame(newer)?.assists).toEqual({ ...data.assists, peeks: 2 });
    });

    it('carries the field through play and into the next save', () => {
      const restored = deserialiseGame(JSON.parse(JSON.stringify(newer)))!;
      const played = play(restored, select(3), CHECK_CELL, AUTO_OFF, AUTO_ON, RESET, {
        type: 'hint',
        hint: HINT,
      });
      expect(serialiseGame(played).assists).toMatchObject({ peeks: 2 });
    });

    it('keeps the field when the assists are raised to cover the board', () => {
      const restored = deserialiseGame({ ...newer, assists: { ...NO_ASSISTS, peeks: 1 } });
      expect(restored?.assists).toEqual({
        autoCandidates: true,
        hints: 1,
        checks: 1,
        reveals: 1,
        peeks: 1,
      });
    });

    it('drops new fields too big or odd to keep, and still loads', () => {
      const assists = { ...data.assists, Junk: 1, log: 'x'.repeat(300) };
      expect(deserialiseGame({ ...data, assists })?.assists).toEqual(data.assists);
    });

    it('still rejects assists missing a count it knows, whatever else they carry', () => {
      const { reveals: _reveals, ...rest } = newer.assists;
      expect(deserialiseGame({ ...newer, assists: rest })).toBeNull();
      const odd = { ...newer.assists, hints: -1 };
      expect(deserialiseGame({ ...newer, assists: odd })).toBeNull();
    });
  });
});
