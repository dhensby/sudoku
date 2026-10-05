import {
  ALL_DIGITS,
  COL,
  PEERS,
  ROW,
  bit,
  computeCandidates,
  findConflicts,
  formatGrid,
  gridValues,
  isGridString,
} from './grid';
import type { Assists, Difficulty, Digit, GridString, Hint, Puzzle } from './types';

/*
 * The game itself: a pure reducer over everything that can happen to a board
 * between a new game and the solve. It models NYT Sudoku — Normal and
 * Candidate entry, the two-step erase, Auto Candidate Mode, Check, Reveal and
 * unlimited Undo — and adds the Redo NYT lacks.
 *
 * Candidates live in three layers, exactly as NYT keeps them:
 *   - `notes`, the player's own pencil marks, drawn while auto mode is off;
 *   - the computed candidates (what no placed peer rules out), derived from
 *     the values whenever they are drawn and never stored;
 *   - `autoRemoved`, the computed candidates the player struck out while auto
 *     mode was on, subtracted from the computed layer when it is drawn.
 * Switching auto mode only changes which layer is drawn, so neither is lost.
 *
 * State is never mutated. A change copies the `cells` array and replaces only
 * the cells it touches, so every other cell keeps its object identity and a
 * memoised cell component can skip re-rendering. Undo entries hold the
 * replaced objects themselves, so undoing puts back the very same objects
 * (unless a Check has judged one since — see `replay`).
 */

/** How a digit key is read: as a value to place, or as a candidate to toggle. */
export type InputMode = 'normal' | 'candidate';

/** What Check or Reveal last said about a cell. */
export type CellMark = 'none' | 'wrong' | 'correct' | 'revealed';

/** An arrow-key move of the selection. */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface CellState {
  /** Placed digit, 0 when empty. */
  value: number;
  /** One of the puzzle's givens: never editable. */
  given: boolean;
  /** The player's own candidate notes (manual layer). Kept underneath a placed value: erasing the value brings them back. */
  notes: number;
  /** Auto-candidate eliminations: computed candidates the player removed while auto-candidate mode was on. */
  autoRemoved: number;
  /** Result of Check / Reveal. 'correct' and 'revealed' lock the cell. Reset to 'none' whenever the value changes. */
  mark: CellMark;
}

export interface UndoEntry {
  /** The previous state of every cell the change touched. */
  cells: readonly (readonly [index: number, previous: CellState])[];
  /** The previous auto-candidate flag, when the change switched it. */
  autoCandidates?: boolean;
  /** The cell to select after undoing (or redoing) this change. */
  focus: number;
}

export interface GameState {
  /** The puzzle being played. */
  puzzle: Puzzle;
  /** The 81 cells in reading order. */
  cells: readonly CellState[];
  /** The selected cell, 0–80. */
  selected: number;
  /** The latched input mode (the UI may flip it per entry while Shift is held). */
  mode: InputMode;
  /** Whether auto-candidate mode is on: computed candidates are drawn instead of notes. */
  autoCandidates: boolean;
  /** 'solved' once every cell holds its solution digit; the board is then frozen. */
  status: 'playing' | 'solved';
  /** Undoable changes, oldest first. */
  undoStack: readonly UndoEntry[];
  /** Undone changes, oldest first; cleared by any new undoable change. */
  redoStack: readonly UndoEntry[];
  /** Help taken during this game. Never reduced, not even by Reset. */
  assists: Assists;
  /** The hint on show, until the next change of any kind. */
  hint: Hint | null;
}

export interface NewGameOptions {
  /** Start in auto-candidate mode (the "Start in auto candidate mode" setting). Default false. */
  autoCandidates?: boolean;
}

export type GameAction =
  /** Select a cell. Out-of-range or non-integer indexes are ignored. */
  | { type: 'select'; index: number }
  /** Move the selection one cell; stops at the edges rather than wrapping (NYT). */
  | { type: 'move'; direction: Direction }
  /**
   * Enter a digit at `index` (default: the selected cell) in `mode` (default:
   * the latched mode — the UI passes the effective mode while Shift is held).
   * `clearPeerNotes` also strips the digit from the peers' manual notes, which
   * NYT never does but many players expect; it is a setting.
   */
  | { type: 'enter'; digit: Digit; index?: number; mode?: InputMode; clearPeerNotes?: boolean }
  /** Erase at `index` (default: the selected cell): the value first, then the notes. */
  | { type: 'erase'; index?: number }
  | { type: 'setMode'; mode: InputMode }
  | { type: 'toggleMode' }
  | { type: 'setAutoCandidates'; enabled: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  /**
   * Show a hint. The hint is found outside the reducer (see `findHint`) so the
   * reducer stays a cheap state machine; it only records and points at it —
   * and marks a mistake it points at wrong, as Check would.
   */
  | { type: 'hint'; hint: Hint }
  | { type: 'check'; scope: 'cell' | 'puzzle' }
  /** Reveal the selected cell's solution digit. */
  | { type: 'reveal' }
  | { type: 'reset' };

type EnterAction = Extract<GameAction, { type: 'enter' }>;

/** A cell index paired with a cell state: an edit to make, or the state it replaced. */
type CellEdit = readonly [index: number, cell: CellState];

const NO_ENTRIES: readonly UndoEntry[] = [];

/**
 * The state of every untouched empty cell. Shared, and frozen so that a stray
 * mutation fails loudly instead of changing all of them at once.
 */
const EMPTY_CELL = Object.freeze<CellState>({
  value: 0,
  given: false,
  notes: 0,
  autoRemoved: 0,
  mark: 'none',
});

/** What still works on a solved board: looking around, not changing it. */
const ALLOWED_WHEN_SOLVED: ReadonlySet<GameAction['type']> = new Set([
  'select',
  'move',
  'setMode',
  'toggleMode',
]);

const MOVES: Readonly<Record<Direction, readonly [rows: number, cols: number]>> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

const DIFFICULTIES: readonly string[] = ['easy', 'medium', 'hard', 'expert'];

const MARK_CODES: Readonly<Record<CellMark, string>> = {
  none: '.',
  wrong: 'w',
  correct: 'c',
  revealed: 'r',
};

const MARKS_BY_CODE: Readonly<Record<string, CellMark>> = {
  '.': 'none',
  w: 'wrong',
  c: 'correct',
  r: 'revealed',
};

const MARKS_PATTERN = /^[.wcr]{81}$/;

function isCellIndex(index: unknown): index is number {
  return Number.isInteger(index) && (index as number) >= 0 && (index as number) < 81;
}

/** Runtime guard: a bad digit would corrupt a mask, or make the board unsaveable. */
function isDigit(digit: unknown): digit is Digit {
  return Number.isInteger(digit) && (digit as number) >= 1 && (digit as number) <= 9;
}

/** Checked correct or revealed: the cell never changes again (short of a reset). */
function isLocked(cell: CellState): boolean {
  return cell.mark === 'correct' || cell.mark === 'revealed';
}

function canEdit(cell: CellState): boolean {
  return !cell.given && !isLocked(cell);
}

function isPristine(cell: CellState): boolean {
  return cell.value === 0 && cell.notes === 0 && cell.autoRemoved === 0 && cell.mark === 'none';
}

function givenCell(value: number): CellState {
  return { value, given: true, notes: 0, autoRemoved: 0, mark: 'none' };
}

function solutionDigit(puzzle: Puzzle, index: number): number {
  return puzzle.solution.charCodeAt(index) - 48;
}

/** NYT selects the first empty cell on load. A full board falls back to the top-left. */
function firstEmpty(cells: readonly CellState[]): number {
  const index = cells.findIndex((cell) => cell.value === 0);
  return index === -1 ? 0 : index;
}

/** Solved means every cell holds its solution digit — a full board with a mistake is not. */
function statusOf(cells: readonly CellState[], puzzle: Puzzle): GameState['status'] {
  for (let i = 0; i < 81; i++) if (cells[i].value !== solutionDigit(puzzle, i)) return 'playing';
  return 'solved';
}

/** The digits no placed peer rules out — one cell's share of `computeCandidates`. */
function computedCandidates(cells: readonly CellState[], index: number): number {
  let seen = 0;
  for (const peer of PEERS[index]) {
    const value = cells[peer].value;
    if (value !== 0) seen |= bit(value);
  }
  return ALL_DIGITS & ~seen;
}

function withAutoCandidates(assists: Assists): Assists {
  return assists.autoCandidates ? assists : { ...assists, autoCandidates: true };
}

/**
 * Write edits into a copy of `cells`, returning the copy and the cells the
 * edits replaced (which is exactly what undoing them needs). No edits, no copy.
 */
function applyEdits(
  cells: readonly CellState[],
  edits: readonly CellEdit[],
): { cells: readonly CellState[]; replaced: CellEdit[] } {
  if (edits.length === 0) return { cells, replaced: [] };
  const next = cells.slice();
  const replaced = edits.map(([index, cell]): CellEdit => {
    const previous = next[index];
    next[index] = cell;
    return [index, previous];
  });
  return { cells: next, replaced };
}

/**
 * Make an undoable change: one undo entry for all of `edits`, and the redo
 * history dropped (a new change forks the timeline). A placed digit may be
 * the last one, so the solve is checked here too.
 */
function commit(state: GameState, edits: readonly CellEdit[], focus: number): GameState {
  const { cells, replaced } = applyEdits(state.cells, edits);
  return {
    ...state,
    cells,
    status: statusOf(cells, state.puzzle),
    undoStack: [...state.undoStack, { cells: replaced, focus }],
    redoStack: NO_ENTRIES,
  };
}

/**
 * The entries of `stack` that can still change something on `cells`: those
 * touching a cell that is not locked, and every switch of auto mode. A stack
 * with nothing to drop keeps its identity.
 */
function liveEntries(
  stack: readonly UndoEntry[],
  cells: readonly CellState[],
): readonly UndoEntry[] {
  const live = stack.filter(
    (entry) =>
      entry.autoCandidates !== undefined || entry.cells.some(([index]) => !isLocked(cells[index])),
  );
  return live.length === stack.length ? stack : live;
}

/**
 * The history once `cells` has locked some cells. Locked cells never change,
 * not even back, so an entry that only touched locked cells is spent: it is
 * dropped now, as the cells lock, rather than left on the stack where Undo or
 * Redo would look available and then do nothing when pressed. This keeps
 * every entry on both stacks live, which `replay` relies on.
 */
function historyAfterLocking(
  state: GameState,
  cells: readonly CellState[],
): Pick<GameState, 'undoStack' | 'redoStack'> {
  return {
    undoStack: liveEntries(state.undoStack, cells),
    redoStack: liveEntries(state.redoStack, cells),
  };
}

function selectCell(state: GameState, index: number): GameState {
  return isCellIndex(index) && index !== state.selected ? { ...state, selected: index } : state;
}

function moveSelection(state: GameState, direction: Direction): GameState {
  const [rows, cols] = MOVES[direction];
  const row = ROW[state.selected] + rows;
  const col = COL[state.selected] + cols;
  if (row < 0 || row > 8 || col < 0 || col > 8) return state;
  return { ...state, selected: row * 9 + col };
}

function enterDigit(state: GameState, action: EnterAction): GameState {
  const { digit, index = state.selected, mode = state.mode, clearPeerNotes = false } = action;
  if (!isDigit(digit) || !isEditable(state, index)) return state;
  return mode === 'normal'
    ? placeValue(state, index, digit, clearPeerNotes)
    : toggleCandidate(state, index, digit);
}

function placeValue(
  state: GameState,
  index: number,
  digit: Digit,
  clearPeerNotes: boolean,
): GameState {
  const cell = state.cells[index];
  // NYT: entering the digit already there does nothing — it does not toggle off.
  if (cell.value === digit) return state;
  // The notes stay underneath the value, so erasing it brings them back.
  const edits: CellEdit[] = [[index, { ...cell, value: digit, mark: 'none' }]];
  if (clearPeerNotes) {
    const mask = bit(digit);
    for (const peer of PEERS[index]) {
      const other = state.cells[peer];
      // Locked cells never change, not even their hidden notes. (Givens never
      // have notes, so they need no test of their own.)
      if ((other.notes & mask) !== 0 && !isLocked(other)) {
        edits.push([peer, { ...other, notes: other.notes & ~mask }]);
      }
    }
  }
  return commit(state, edits, index);
}

function toggleCandidate(state: GameState, index: number, digit: Digit): GameState {
  const cell = state.cells[index];
  const mask = bit(digit);
  // Candidate entry on a filled cell clears the value first (NYT) — in the same
  // undo step, so one Undo brings the value back.
  let next: CellState = cell.value === 0 ? cell : { ...cell, value: 0, mark: 'none' };
  if (!state.autoCandidates) {
    next = { ...next, notes: next.notes ^ mask };
  } else if ((computedCandidates(state.cells, index) & mask) !== 0) {
    // Only a computed candidate can be struck out or brought back. A digit a
    // placed peer rules out is not on show, so there is nothing to strike; an
    // elimination recorded anyway would hide it, unasked, once that peer is
    // erased.
    next = { ...next, autoRemoved: next.autoRemoved ^ mask };
  }
  return next === cell ? state : commit(state, [[index, next]], index);
}

function eraseAt(state: GameState, index: number): GameState {
  if (!isEditable(state, index)) return state;
  const cell = state.cells[index];
  if (cell.value !== 0) return commit(state, [[index, { ...cell, value: 0, mark: 'none' }]], index);
  // The second press clears the notes. In auto mode the candidates on show are
  // computed, not the player's, so there is nothing to clear (NYT does nothing too).
  if (!state.autoCandidates && cell.notes !== 0) {
    return commit(state, [[index, { ...cell, notes: 0 }]], index);
  }
  return state;
}

function setAutoCandidates(state: GameState, enabled: boolean): GameState {
  if (enabled === state.autoCandidates) return state;
  // Neither candidate layer is touched: switching off shows the notes exactly as
  // they were, and switching back on restores the eliminations.
  return {
    ...state,
    autoCandidates: enabled,
    assists: enabled ? withAutoCandidates(state.assists) : state.assists,
    undoStack: [
      ...state.undoStack,
      { cells: [], autoCandidates: state.autoCandidates, focus: state.selected },
    ],
    redoStack: NO_ENTRIES,
  };
}

/**
 * The edits that put an entry's cells back. Locked cells never change — not
 * even back: checking or revealing is help already taken, and undoing past it
 * must not make it disappear. For the same reason a cell whose value the entry
 * leaves alone (a peer whose hidden notes `clearPeerNotes` stripped) keeps the
 * mark a Check has given it since: a verdict on a value goes only when the
 * value does.
 */
function restoreEdits(cells: readonly CellState[], entry: UndoEntry): CellEdit[] {
  return entry.cells.flatMap(([index, previous]): CellEdit[] => {
    const current = cells[index];
    if (isLocked(current)) return [];
    const isMarkStale = previous.value === current.value && previous.mark !== current.mark;
    return [[index, isMarkStale ? { ...previous, mark: current.mark } : previous]];
  });
}

/**
 * Undo or redo — the same operation run between opposite stacks. The top
 * entry's cells are put back and their current states become the opposite
 * entry. Every entry left on a stack still changes something (spent ones are
 * dropped as cells lock — see `historyAfterLocking`), so one press always does.
 */
function replay(state: GameState, direction: 'undo' | 'redo'): GameState {
  const source = direction === 'undo' ? state.undoStack : state.redoStack;
  const target = direction === 'undo' ? state.redoStack : state.undoStack;
  const entry = source.at(-1);
  if (entry === undefined) return state;
  const { cells, replaced } = applyEdits(state.cells, restoreEdits(state.cells, entry));
  const opposite: UndoEntry =
    entry.autoCandidates === undefined
      ? { cells: replaced, focus: entry.focus }
      : { cells: replaced, autoCandidates: state.autoCandidates, focus: entry.focus };
  const remaining = source.slice(0, -1);
  const pushed = [...target, opposite];
  return {
    ...state,
    cells,
    selected: entry.focus,
    autoCandidates: entry.autoCandidates ?? state.autoCandidates,
    // A reveal since the change can mean undoing or redoing it completes the
    // grid, so the solve is checked here as well.
    status: statusOf(cells, state.puzzle),
    undoStack: direction === 'undo' ? remaining : pushed,
    redoStack: direction === 'undo' ? pushed : remaining,
  };
}

/** Whether a cell holds a value of the player's that disagrees with the solution. */
function isMistake(state: GameState, index: number): boolean {
  const cell = state.cells[index];
  return cell.value !== 0 && canEdit(cell) && cell.value !== solutionDigit(state.puzzle, index);
}

function showHint(state: GameState, hint: Hint): GameState {
  // "The puzzle is complete" is shown, but it is not help — and showing it
  // again while it is on show changes nothing.
  if (hint.kind === 'none') return state.hint?.kind === 'none' ? state : { ...state, hint };
  const index = isCellIndex(hint.index) ? hint.index : null;
  const next: GameState = {
    ...state,
    hint,
    selected: index ?? state.selected,
    assists: { ...state.assists, hints: state.assists.hints + 1 },
  };
  // A mistake is marked as Check would mark it — NYT's slash — so the clue
  // outlives the hint bar, which goes with the next key press. Like a check's
  // verdict it is not undoable, and it goes when the value does.
  if (hint.kind !== 'mistake' || index === null || !isMistake(state, index)) return next;
  const cell = state.cells[index];
  if (cell.mark === 'wrong') return next;
  const cells = state.cells.slice();
  cells[index] = { ...cell, mark: 'wrong' };
  return { ...next, cells };
}

function check(state: GameState, scope: 'cell' | 'puzzle'): GameState {
  const [from, to] = scope === 'cell' ? [state.selected, state.selected + 1] : [0, 81];
  let cells: CellState[] | null = null;
  let isAnyChecked = false;
  for (let i = from; i < to; i++) {
    const cell = state.cells[i];
    if (cell.value === 0 || !canEdit(cell)) continue;
    isAnyChecked = true;
    const mark: CellMark = cell.value === solutionDigit(state.puzzle, i) ? 'correct' : 'wrong';
    // Re-checking a cell already marked wrong tells it nothing new: keep its identity.
    if (mark === cell.mark) continue;
    cells ??= state.cells.slice();
    cells[i] = { ...cell, mark };
  }
  // Checking nothing is not help taken.
  if (!isAnyChecked) return state;
  const board = cells ?? state.cells;
  return {
    ...state,
    cells: board,
    ...historyAfterLocking(state, board),
    assists: { ...state.assists, checks: state.assists.checks + 1 },
  };
}

function reveal(state: GameState): GameState {
  const index = state.selected;
  const cell = state.cells[index];
  if (!canEdit(cell)) return state;
  const cells = state.cells.slice();
  cells[index] = { ...cell, value: solutionDigit(state.puzzle, index), mark: 'revealed' };
  // Not undoable: the revealed cell is locked, and locked cells are immune to undo.
  return {
    ...state,
    cells,
    status: statusOf(cells, state.puzzle),
    ...historyAfterLocking(state, cells),
    assists: { ...state.assists, reveals: state.assists.reveals + 1 },
  };
}

function reset(state: GameState): GameState {
  let cells: CellState[] | null = null;
  for (let i = 0; i < 81; i++) {
    const cell = state.cells[i];
    if (cell.given || isPristine(cell)) continue;
    cells ??= state.cells.slice();
    cells[i] = EMPTY_CELL;
  }
  const board = cells ?? state.cells;
  const selected = firstEmpty(board);
  if (
    board === state.cells &&
    selected === state.selected &&
    state.undoStack.length === 0 &&
    state.redoStack.length === 0 &&
    state.hint === null
  ) {
    return state;
  }
  // Assists and the auto-candidate flag stay: help already taken stays on the record.
  return { ...state, cells: board, selected, undoStack: NO_ENTRIES, redoStack: NO_ENTRIES };
}

function step(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'select':
      return selectCell(state, action.index);
    case 'move':
      return moveSelection(state, action.direction);
    case 'enter':
      return enterDigit(state, action);
    case 'erase':
      return eraseAt(state, action.index ?? state.selected);
    case 'setMode':
      return action.mode === state.mode ? state : { ...state, mode: action.mode };
    case 'toggleMode':
      return { ...state, mode: state.mode === 'normal' ? 'candidate' : 'normal' };
    case 'setAutoCandidates':
      return setAutoCandidates(state, action.enabled);
    case 'undo':
      return replay(state, 'undo');
    case 'redo':
      return replay(state, 'redo');
    case 'hint':
      return showHint(state, action.hint);
    case 'check':
      return check(state, action.scope);
    case 'reveal':
      return reveal(state);
    case 'reset':
      return reset(state);
  }
}

/** A fresh game of `puzzle`: just the givens, the first empty cell selected (as NYT does). */
export function createGame(puzzle: Puzzle, options: NewGameOptions = {}): GameState {
  const { autoCandidates = false } = options;
  const cells = Array.from({ length: 81 }, (_, i): CellState => {
    const value = puzzle.givens.charCodeAt(i) - 48;
    return value === 0 ? EMPTY_CELL : givenCell(value);
  });
  return {
    puzzle,
    cells,
    selected: firstEmpty(cells),
    mode: 'normal',
    autoCandidates,
    // Always 'playing' for a real puzzle; derived rather than assumed so that a
    // degenerate all-givens grid agrees with what `deserialiseGame` would say.
    status: statusOf(cells, puzzle),
    undoStack: NO_ENTRIES,
    redoStack: NO_ENTRIES,
    assists: { autoCandidates, hints: 0, checks: 0, reveals: 0 },
    hint: null,
  };
}

/**
 * The pure game reducer. Nothing random or time-based happens in here — hints
 * arrive ready-made in the action — so the same (state, action) always yields
 * the same result: safe under React StrictMode and trivial to test.
 *
 * A no-op returns the very same state object, which is how the caller tells
 * that nothing happened.
 */
export function reduce(state: GameState, action: GameAction): GameState {
  if (state.status === 'solved' && !ALLOWED_WHEN_SOLVED.has(action.type)) return state;
  const next = step(state, action);
  // A hint describes the board it was asked about, so any change retires it.
  if (next === state || next.hint === null || action.type === 'hint') return next;
  return { ...next, hint: null };
}

/** The placed digits, 0 for empty. */
export function valuesOf(state: GameState): Uint8Array {
  const values = new Uint8Array(81);
  for (let i = 0; i < 81; i++) values[i] = state.cells[i].value;
  return values;
}

/** Candidates to draw per cell: auto mode → computeCandidates(values) & ~autoRemoved; manual → notes; 0 for filled cells. */
export function visibleCandidates(state: GameState): Uint16Array {
  const { cells } = state;
  if (state.autoCandidates) {
    // Already 0 for filled cells.
    const candidates = computeCandidates(valuesOf(state));
    for (let i = 0; i < 81; i++) candidates[i] &= ~cells[i].autoRemoved;
    return candidates;
  }
  const candidates = new Uint16Array(81);
  for (let i = 0; i < 81; i++) if (cells[i].value === 0) candidates[i] = cells[i].notes;
  return candidates;
}

/** Which cells hold a digit a peer also holds (givens included, both cells of each clash). */
export function conflictsOf(state: GameState): boolean[] {
  return findConflicts(valuesOf(state));
}

/** How many of each digit are placed (index 1–9; index 0 unused). Used to grey out a finished digit on the pad. */
export function digitCounts(state: GameState): number[] {
  const counts = new Array<number>(10).fill(0);
  for (const cell of state.cells) if (cell.value !== 0) counts[cell.value]++;
  return counts;
}

/** Every cell filled (not necessarily correctly). */
export function isBoardFull(state: GameState): boolean {
  return state.cells.every((cell) => cell.value !== 0);
}

/** Whether a cell can be edited: not a given, not locked by a check/reveal, game not solved. */
export function isEditable(state: GameState, index: number): boolean {
  return isCellIndex(index) && state.status === 'playing' && canEdit(state.cells[index]);
}

/**
 * A game as plain JSON for storage. No undo history is kept (NYT doesn't keep
 * it either) and neither is the input mode or the hint on show.
 */
export interface SerialisedGame {
  /** Format version; anything else is rejected on load. */
  v: 1;
  /** The puzzle being played: givens, solution and tier. */
  puzzle: Puzzle;
  /** The placed digits, givens included. */
  values: GridString;
  /** Each cell's manual notes mask. */
  notes: number[];
  /** Each cell's auto-candidate eliminations mask. */
  autoRemoved: number[];
  /** 81 chars: '.' none, 'w' wrong, 'c' correct, 'r' revealed. */
  marks: string;
  /** The selected cell; anything off the grid loads as the first empty cell. */
  selected: number;
  /** Whether auto-candidate mode is on; anything but `true` loads as off. */
  autoCandidates: boolean;
  /** Informational only: ignored on load and worked out again from the values. */
  status: 'playing' | 'solved';
  /** Help taken; on load, raised to cover any help the board shows (reveals, checks, auto mode). */
  assists: Assists;
}

/** The game as plain, JSON-safe data. */
export function serialiseGame(state: GameState): SerialisedGame {
  const { givens, solution, difficulty } = state.puzzle;
  return {
    v: 1,
    puzzle: { givens, solution, difficulty },
    values: formatGrid(valuesOf(state)),
    notes: state.cells.map((cell) => cell.notes),
    autoRemoved: state.cells.map((cell) => cell.autoRemoved),
    marks: state.cells.map((cell) => MARK_CODES[cell.mark]).join(''),
    selected: state.selected,
    autoCandidates: state.autoCandidates,
    status: state.status,
    assists: { ...state.assists },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && DIFFICULTIES.includes(value);
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isMask(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= ALL_DIGITS;
}

function isMaskList(value: unknown): value is number[] {
  // `Array.from` turns the holes of a sparse array into undefined, which
  // `every` would otherwise skip — letting a cell load with no mask at all.
  return Array.isArray(value) && value.length === 81 && Array.from(value).every(isMask);
}

/** A puzzle whose solution is a complete, valid grid that agrees with every given. */
function readPuzzle(data: unknown): Puzzle | null {
  if (!isRecord(data)) return null;
  const { givens, solution, difficulty } = data;
  if (!isGridString(givens) || !isGridString(solution) || !isDifficulty(difficulty)) return null;
  const answer = gridValues(solution);
  if (answer.includes(0) || findConflicts(answer).includes(true)) return null;
  for (let i = 0; i < 81; i++) if (givens[i] !== '0' && givens[i] !== solution[i]) return null;
  return { givens, solution, difficulty };
}

function readAssists(data: unknown): Assists | null {
  if (!isRecord(data)) return null;
  const { autoCandidates, hints, checks, reveals } = data;
  if (typeof autoCandidates !== 'boolean' || !isCount(hints) || !isCount(checks)) return null;
  if (!isCount(reveals)) return null;
  return { autoCandidates, hints, checks, reveals };
}

/**
 * Stored assists, raised to cover the help the board itself shows was taken —
 * help taken must never be lost, and a revealed game that loads as unassisted
 * could set a best time. Every revealed cell is a reveal; a cell checked
 * correct means at least one check, and so does one marked wrong unless a
 * hint accounts for it (a hint marks the mistake it points at the same way);
 * and auto mode on or any elimination (only ever recorded in auto mode) means
 * auto mode was used.
 */
function reconcileAssists(
  assists: Assists,
  cells: readonly CellState[],
  autoCandidates: boolean,
): Assists {
  const reveals = cells.filter((cell) => cell.mark === 'revealed').length;
  const isMarkedWrong = cells.some((cell) => cell.mark === 'wrong');
  const isChecked =
    cells.some((cell) => cell.mark === 'correct') || (isMarkedWrong && assists.hints === 0);
  const isAutoUsed = autoCandidates || cells.some((cell) => cell.autoRemoved !== 0);
  return {
    autoCandidates: assists.autoCandidates || isAutoUsed,
    hints: assists.hints,
    checks: Math.max(assists.checks, isChecked ? 1 : 0),
    reveals: Math.max(assists.reveals, reveals),
  };
}

/**
 * A stored mark, kept only if a real check could have said it: nothing on an
 * empty cell, no wrong mark on a right value, and no lock on a wrong value —
 * which would make the game impossible to finish.
 */
function readMark(code: string, value: number, answer: number): CellMark {
  const mark = MARKS_BY_CODE[code];
  if (mark === 'none' || value === 0) return 'none';
  if (mark === 'wrong') return value === answer ? 'none' : 'wrong';
  return value === answer ? mark : 'none';
}

/**
 * Validate anything read back from storage; null if it is not a coherent game.
 *
 * Anything that decides what the board is must be exactly right or the game is
 * rejected: the puzzle (its solution complete, valid and agreeing with the
 * givens), the values (givens in place), the note and elimination masks, the
 * marks string and the shape of the assists (help taken must never be lost or
 * invented). What can be derived or defaulted without changing the board is
 * coerced instead: an out-of-range `selected` becomes the first empty cell, a
 * non-boolean `autoCandidates` is off, `status` is re-derived from the values,
 * marks a check could never have produced become 'none', notes on givens are
 * dropped, and the assists are raised to cover any help the board shows.
 */
export function deserialiseGame(data: unknown): GameState | null {
  if (!isRecord(data) || data.v !== 1) return null;
  const puzzle = readPuzzle(data.puzzle);
  const assists = readAssists(data.assists);
  const { values, notes, autoRemoved, marks } = data;
  if (puzzle === null || assists === null || !isGridString(values)) return null;
  if (!isMaskList(notes) || !isMaskList(autoRemoved)) return null;
  if (typeof marks !== 'string' || !MARKS_PATTERN.test(marks)) return null;

  const cells: CellState[] = [];
  for (let i = 0; i < 81; i++) {
    const value = values.charCodeAt(i) - 48;
    if (puzzle.givens[i] !== '0') {
      // A given out of place means this is not the puzzle's board at all.
      if (values[i] !== puzzle.givens[i]) return null;
      cells.push(givenCell(value));
      continue;
    }
    const mark = readMark(marks[i], value, solutionDigit(puzzle, i));
    cells.push({ value, given: false, notes: notes[i], autoRemoved: autoRemoved[i], mark });
  }

  const autoCandidates = data.autoCandidates === true;
  return {
    puzzle,
    cells,
    selected: isCellIndex(data.selected) ? data.selected : firstEmpty(cells),
    mode: 'normal',
    autoCandidates,
    status: statusOf(cells, puzzle),
    undoStack: NO_ENTRIES,
    redoStack: NO_ENTRIES,
    assists: reconcileAssists(assists, cells, autoCandidates),
    hint: null,
  };
}
