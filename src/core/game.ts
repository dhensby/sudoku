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
import { TECHNIQUE_ORDER } from './grader';
import { fieldsOf, newerFields } from './newerFields';
import type { SolverBoard } from './techniques';
import type {
  Assists,
  Difficulty,
  Digit,
  GridString,
  Hint,
  Puzzle,
  SingleTechniqueId,
  TechniqueId,
  Unit,
} from './types';

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
 *
 * Every hint about a cell is remembered with the cell (see
 * `RememberedHints`): selecting the cell again shows it again, and asking
 * for it again costs nothing, until the cell no longer needs it.
 *
 * Hint and Show me reason from the candidates the player has (see
 * `hintBoardOf`): the automatic ones less their strikes, or their own notes,
 * a cell with none counting as having every candidate. A cell whose answer
 * is missing from those gets a hint of its own (`struck`), remembered while
 * the player's marks on the cell stay as they were. Nothing the hint bar
 * shows unasked may turn on candidates the solution has not been held to
 * since they changed — that would say, for free, whether the answer is
 * among them — so a remembered hint is put afresh from the candidates as
 * they stood at the last fill hint (`checkedCandidates`, see
 * `checkedBoardOf`), never from the player's latest.
 *
 * "Check guesses when entered" (`checkGuesses`) marks a wrong number wrong
 * the moment it is typed, with the mark a Check gives, but no Check taken
 * (see `markWrongGuesses`). It is a setting rather than a move, so it is
 * never undone, and it never judges what was entered before it came on —
 * not even brought back by Undo or Redo, which put a number back with the
 * mark it had: judging those would make Undo then Redo a free Check of the
 * whole board.
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

/** A hint about filling a cell: a single, or the deduction that leads to one. */
export type FillHint = Extract<Hint, { kind: 'single' | 'deduction' }>;

/** A hint that a placed value is wrong. */
export type MistakeHint = Extract<Hint, { kind: 'mistake' }>;

/** A hint that an empty cell's answer is missing from the player's candidates. */
export type StruckHint = Extract<Hint, { kind: 'struck' }>;

/** A cell's remembered wrong-marks hint (see `RememberedHints.struck`). */
export interface RememberedStruck {
  hint: StruckHint;
  /** Whether its "Show me" — which names the missing digit — has been opened, so that opening it again is free. */
  walkthrough: boolean;
}

/**
 * What the game remembers of the hints one cell has had, so that selecting
 * the cell shows them again rather than the player having to ask — and be
 * counted — again. At most one is on show at a time: the mistake hint needs
 * a value in the cell, the wrong-marks and fill hints an empty cell, the
 * wrong-marks hint first (see `rememberedHint`).
 */
export interface RememberedHints {
  /**
   * The newest single or deduction hint for the cell. On show while the cell
   * is empty — it says nothing about a value there — and forgotten once the
   * cell holds its solution digit.
   */
  fill: FillHint | null;
  /**
   * The newest mistake hint for the cell, with the value it was about. On
   * show while the cell holds that value, and forgotten the moment it holds
   * any other.
   */
  mistake: { hint: MistakeHint; value: number } | null;
  /**
   * Whether "Show me" has been opened for the fill hint, so that opening it
   * again is free. It goes with the fill hint.
   */
  walkthrough: boolean;
  /**
   * The newest wrong-marks hint for the cell — its answer missing from the
   * player's candidates — and its Show me. On show while the cell is empty,
   * before the fill hint. Kept, so that asking again is free, only while the
   * player's marks on the cell — its notes and its struck-out automatic
   * candidates — and the switch between the two stay as they were when it
   * was given: forgotten at any change to them, whatever the change. Were it
   * kept while the answer stayed missing, a free Hint after putting back one
   * digit would say whether that digit was the answer — so each such probe
   * is counted, as a new mistake hint is for each value tried in a cell.
   */
  struck: RememberedStruck | null;
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
  /**
   * Whether "Check guesses when entered" is on: each wrong number is marked
   * wrong as it is typed. Switched by `setCheckGuesses`, never by Undo.
   */
  checkGuesses: boolean;
  /** 'solved' once every cell holds its solution digit; the board is then frozen. */
  status: 'playing' | 'solved';
  /** Undoable changes, oldest first. */
  undoStack: readonly UndoEntry[];
  /** Undone changes, oldest first; cleared by any new undoable change. */
  redoStack: readonly UndoEntry[];
  /** Help taken during this game. Never reduced, not even by Reset. */
  assists: Assists;
  /** The hint just asked for, until the next change of any kind. */
  hint: Hint | null;
  /**
   * The hints remembered for each cell that has had one, by cell. A Reset
   * forgets them all, and Undo and Redo never bring back one that has been
   * forgotten: a hint is about the board as it was when it was given, and
   * replaying moves is not asking again.
   */
  cellHints: ReadonlyMap<number, RememberedHints>;
  /**
   * Each cell's candidates (see `hintBoardOf`; 0 for a filled cell) when a
   * fill hint was last given with every answer among them and every placed
   * digit right — which the player learns from being given one, as Hint
   * points at a wrong digit or a missing answer first. What the hint bar
   * puts a remembered hint afresh from (see `checkedBoardOf`). Null until
   * then, and after a Reset; Undo and Redo leave it, as they leave the
   * remembered hints.
   */
  checkedCandidates: Uint16Array | null;
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
  /**
   * Switch "Check guesses when entered". Switching it on records the help
   * (sticky, like auto candidates); neither way is undoable, nor changes the
   * board: it judges the numbers entered from now on, never those already
   * there.
   */
  | { type: 'setCheckGuesses'; enabled: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  /**
   * Show a hint. The hint is found outside the reducer (see `findHint`) so the
   * reducer stays a cheap state machine; it only records and points at it —
   * and marks a mistake it points at wrong, as Check would.
   */
  | { type: 'hint'; hint: Hint }
  /**
   * Open "Show me" for a cell's hint: the walkthrough of its fill hint, or,
   * while it has a wrong-marks hint, the page that names the missing digit.
   * Counted as a hint the first time for that hint, and free after that.
   * Ignored unless the cell is empty and has had one of them.
   */
  | { type: 'walkthrough'; index: number }
  | { type: 'check'; scope: 'cell' | 'puzzle' }
  /** Reveal the selected cell's solution digit. */
  | { type: 'reveal' }
  | { type: 'reset' };

type EnterAction = Extract<GameAction, { type: 'enter' }>;

/** A cell index paired with a cell state: an edit to make, or the state it replaced. */
type CellEdit = readonly [index: number, cell: CellState];

const NO_ENTRIES: readonly UndoEntry[] = [];

const NO_CELL_HINTS: ReadonlyMap<number, RememberedHints> = new Map();

/** A cell that has had no hint. Frozen, as `EMPTY_CELL` is. */
const NO_HINTS = Object.freeze<RememberedHints>({
  fill: null,
  mistake: null,
  walkthrough: false,
  struck: null,
});

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

/** The changes that leave a hint on show: asking for it, Show me, and switching Check guesses. */
const KEEPS_HINT: ReadonlySet<GameAction['type']> = new Set([
  'hint',
  'walkthrough',
  'setCheckGuesses',
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

const TECHNIQUES: readonly unknown[] = TECHNIQUE_ORDER;

const SINGLE_TECHNIQUES: readonly unknown[] = [
  'fullHouse',
  'hiddenSingleBox',
  'hiddenSingleLine',
  'nakedSingle',
] satisfies SingleTechniqueId[];

const UNIT_KINDS: readonly unknown[] = ['row', 'column', 'box'] satisfies Unit['kind'][];

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

/**
 * The candidates the player has in an empty cell, given its `computed` ones:
 * in auto candidate mode, the computed candidates less those struck out;
 * otherwise the player's own notes, taken as the cell's whole list of
 * candidates, less any a placed digit now rules out — and for a cell with no
 * notes at all, every computed candidate: a cell not yet looked at is not a
 * cell with nothing left. 0 for a filled cell.
 */
function playerCandidates(cell: CellState, computed: number, autoCandidates: boolean): number {
  if (cell.value !== 0) return 0;
  if (autoCandidates) return computed & ~cell.autoRemoved;
  return cell.notes === 0 ? computed : cell.notes & computed;
}

/** One cell's share of `hintBoardOf`'s candidates. */
function candidatesAt(cells: readonly CellState[], autoCandidates: boolean, index: number): number {
  return playerCandidates(cells[index], computedCandidates(cells, index), autoCandidates);
}

/** Whether an empty cell's answer is missing from the player's candidates (see `playerCandidates`). */
function isAnswerMissing(
  cells: readonly CellState[],
  autoCandidates: boolean,
  index: number,
  answer: number,
): boolean {
  return (
    cells[index].value === 0 && (candidatesAt(cells, autoCandidates, index) & bit(answer)) === 0
  );
}

function withAutoCandidates(assists: Assists): Assists {
  return assists.autoCandidates ? assists : { ...assists, autoCandidates: true };
}

function withHint(assists: Assists): Assists {
  return { ...assists, hints: assists.hints + 1 };
}

/**
 * `cellHints` with a cell's entry replaced (or, for null, removed). An entry
 * that is already there as it is keeps the map's identity.
 */
function setCellHints(
  cellHints: ReadonlyMap<number, RememberedHints>,
  index: number,
  entry: RememberedHints | null,
): ReadonlyMap<number, RememberedHints> {
  if ((cellHints.get(index) ?? null) === entry) return cellHints;
  const next = new Map(cellHints);
  if (entry === null) next.delete(index);
  else next.set(index, entry);
  return next;
}

/**
 * What is still worth remembering of a cell's hints now that it holds
 * `value`, its answer missing from the player's candidates or not
 * (`isMissing`, never for a filled cell): the fill hint until the cell holds
 * its solution digit, the mistake hint while it holds the value it was
 * about, "Show me" with the fill hint, and the wrong-marks hint, with its
 * own Show me, while the answer is missing. The entry itself when nothing has
 * gone; null when everything has.
 */
function liveHints(
  entry: RememberedHints,
  value: number,
  answer: number,
  isMissing: boolean,
): RememberedHints | null {
  const fill = value === answer ? null : entry.fill;
  const mistake = entry.mistake?.value === value ? entry.mistake : null;
  const struck = isMissing ? entry.struck : null;
  if (fill === null && mistake === null && struck === null) return null;
  const walkthrough = entry.walkthrough && fill !== null;
  const isUnchanged =
    fill === entry.fill &&
    mistake === entry.mistake &&
    walkthrough === entry.walkthrough &&
    struck === entry.struck;
  return isUnchanged ? entry : { fill, mistake, walkthrough, struck };
}

/**
 * Forget the remembered hints the cells no longer need (see `liveHints`),
 * after their values or marks change, or the candidates on show switch
 * between the automatic ones and the notes — a wrong-marks hint at any
 * change to its cell's marks, or that switch, whatever the change (see
 * `RememberedHints.struck`), so that whether it goes says nothing of the
 * answer.
 */
function forgetSpentHints(before: GameState, state: GameState): GameState {
  const isSwitched = before.autoCandidates !== state.autoCandidates;
  let cellHints = state.cellHints;
  for (const [index, entry] of state.cellHints) {
    const answer = solutionDigit(state.puzzle, index);
    const cell = state.cells[index];
    const was = before.cells[index];
    const isAsMarked =
      !isSwitched && cell.notes === was.notes && cell.autoRemoved === was.autoRemoved;
    const isMissing =
      isAsMarked && isAnswerMissing(state.cells, state.autoCandidates, index, answer);
    cellHints = setCellHints(cellHints, index, liveHints(entry, cell.value, answer, isMissing));
  }
  return cellHints === state.cellHints ? state : { ...state, cellHints };
}

/**
 * Whether the board, as the player has it, is one every hint and Show me is
 * sound on: every placed digit right, and every empty cell's answer among
 * its candidates (see `findHint`).
 */
function isSoundBoard(state: GameState): boolean {
  return state.cells.every((cell, index) => {
    const answer = solutionDigit(state.puzzle, index);
    if (cell.value !== 0) return cell.value === answer;
    return !isAnswerMissing(state.cells, state.autoCandidates, index, answer);
  });
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

function setCheckGuesses(state: GameState, enabled: boolean): GameState {
  if (enabled === state.checkGuesses) return state;
  // Switched off, the help it gave stays on the record, as all help does.
  const assists: Assists =
    enabled && state.assists.checkGuesses !== true
      ? { ...state.assists, checkGuesses: true }
      : state.assists;
  return { ...state, checkGuesses: enabled, assists };
}

/**
 * With "Check guesses when entered" on, the wrong number just typed (in an
 * empty cell or over another number) marked wrong, as Check would mark it.
 * Called for typing only: a number already standing is never judged, so
 * switching the setting on reveals nothing, and nor does Undo or Redo, which
 * bring a number back with the mark it had — marked if it was typed while
 * the setting was on, not if it was typed before. A right number gets no
 * mark, as NYT gives none. Not undoable, like any verdict on a value: the
 * mark goes when the value does.
 */
function markWrongGuesses(before: GameState, after: GameState): GameState {
  let cells: CellState[] | null = null;
  for (let i = 0; i < 81; i++) {
    const cell = after.cells[i];
    if (cell.value === before.cells[i].value || cell.mark === 'wrong') continue;
    if (cell.value === 0 || !canEdit(cell) || cell.value === solutionDigit(after.puzzle, i)) {
      continue;
    }
    cells ??= after.cells.slice();
    cells[i] = { ...cell, mark: 'wrong' };
  }
  return cells === null ? after : { ...after, cells };
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
  // Off the grid there is no cell to point at or remember it by, but it was asked for.
  if (!isCellIndex(hint.index)) return { ...state, hint, assists: withHint(state.assists) };
  const { index } = hint;
  const cell = state.cells[index];
  const entry = state.cellHints.get(index) ?? NO_HINTS;
  const answer = solutionDigit(state.puzzle, index);
  const isMissing = isAnswerMissing(state.cells, state.autoCandidates, index, answer);
  // A hint the cell has had already is shown again for free; only a new one
  // counts. A remembered mistake hint is always about the value the cell
  // holds now (it is forgotten when that changes), so another is no news;
  // nor is another wrong-marks hint while the answer is still missing.
  const isNew =
    hint.kind === 'mistake'
      ? entry.mistake === null
      : hint.kind === 'struck'
        ? entry.struck === null
        : entry.fill === null;
  let remembered = entry;
  if (hint.kind === 'struck') {
    if (entry.struck === null) remembered = { ...entry, struck: { hint, walkthrough: false } };
  } else if (hint.kind !== 'mistake') remembered = { ...entry, fill: hint };
  else if (isMistake(state, index)) remembered = { ...entry, mistake: { hint, value: cell.value } };
  const live = liveHints(remembered, cell.value, answer, isMissing);
  // A fill hint is given only on a sound board (see `findHint`), so being
  // given one tells the player their candidates hold every answer: the
  // remembered hints may be put afresh from these ones, not from later.
  const isFill = hint.kind === 'single' || hint.kind === 'deduction';
  const next: GameState = {
    ...state,
    hint,
    selected: index,
    cellHints: setCellHints(state.cellHints, index, live),
    assists: isNew ? withHint(state.assists) : state.assists,
    checkedCandidates:
      isFill && isSoundBoard(state) ? hintBoardOf(state).candidates : state.checkedCandidates,
  };
  // A mistake is marked as Check would mark it — NYT's slash — so the clue
  // outlives the hint bar, which goes with the next key press. Like a check's
  // verdict it is not undoable, and it goes when the value does.
  if (hint.kind !== 'mistake' || !isMistake(state, index) || cell.mark === 'wrong') return next;
  const cells = state.cells.slice();
  cells[index] = { ...cell, mark: 'wrong' };
  return { ...next, cells };
}

function openWalkthrough(state: GameState, index: number): GameState {
  const entry = isCellIndex(index) ? state.cellHints.get(index) : undefined;
  if (entry === undefined || state.cells[index].value !== 0) return state;
  // While the answer is missing from the cell's candidates, "Show me" is the
  // page that names it, counted once for as long as it stays missing.
  const { struck } = entry;
  if (struck !== null) {
    if (struck.walkthrough) return state;
    return {
      ...state,
      cellHints: setCellHints(state.cellHints, index, {
        ...entry,
        struck: { ...struck, walkthrough: true },
      }),
      assists: withHint(state.assists),
    };
  }
  // Otherwise it explains the fill hint, which needs an empty cell; it is
  // counted once per cell.
  if (entry.fill === null || entry.walkthrough) return state;
  return {
    ...state,
    cellHints: setCellHints(state.cellHints, index, { ...entry, walkthrough: true }),
    assists: withHint(state.assists),
  };
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
    state.hint === null &&
    state.cellHints.size === 0
  ) {
    return state;
  }
  // Assists and the auto-candidate flag stay: help already taken stays on
  // the record. The remembered hints go with the board they were about, and
  // so do the candidates they were put afresh from.
  return {
    ...state,
    cells: board,
    selected,
    undoStack: NO_ENTRIES,
    redoStack: NO_ENTRIES,
    cellHints: NO_CELL_HINTS,
    checkedCandidates: null,
  };
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
    case 'setCheckGuesses':
      return setCheckGuesses(state, action.enabled);
    case 'undo':
      return replay(state, 'undo');
    case 'redo':
      return replay(state, 'redo');
    case 'hint':
      return showHint(state, action.hint);
    case 'walkthrough':
      return openWalkthrough(state, action.index);
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
    // Switched on as a move (see `setCheckGuesses`), so that a game's log
    // says when it was on.
    checkGuesses: false,
    // Always 'playing' for a real puzzle; derived rather than assumed so that a
    // degenerate all-givens grid agrees with what `deserialiseGame` would say.
    status: statusOf(cells, puzzle),
    undoStack: NO_ENTRIES,
    redoStack: NO_ENTRIES,
    assists: { autoCandidates, hints: 0, checks: 0, reveals: 0 },
    hint: null,
    cellHints: NO_CELL_HINTS,
    checkedCandidates: null,
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
  let next = step(state, action);
  if (next === state) return next;
  if (next.cells !== state.cells && next.checkGuesses && action.type === 'enter') {
    next = markWrongGuesses(state, next);
  }
  // The candidates a wrong-marks hint is about change with the cells, and
  // with the switch between the automatic candidates and the notes.
  if (next.cells !== state.cells || next.autoCandidates !== state.autoCandidates) {
    next = forgetSpentHints(state, next);
  }
  // A hint describes the board it was asked about, so any change retires
  // it — bar opening "Show me" and switching Check guesses, which leave the
  // board as it was.
  if (next.hint === null || KEEPS_HINT.has(action.type)) return next;
  return { ...next, hint: null };
}

/** The placed digits, 0 for empty. */
export function valuesOf(state: GameState): Uint8Array {
  const values = new Uint8Array(81);
  for (let i = 0; i < 81; i++) values[i] = state.cells[i].value;
  return values;
}

/**
 * The board Hint and Show me reason from (see `findHint` and `explainCell`):
 * the placed digits, and the candidates the player has — so that a step
 * they have already taken is not the one a hint names again. In auto
 * candidate mode, the computed candidates less the ones struck out (what the
 * board draws); otherwise the player's own notes, taken as whole lists of
 * candidates, less any a placed digit rules out, with a cell that has no
 * notes counting as having every candidate the placed digits allow.
 */
export function hintBoardOf(state: GameState): SolverBoard {
  const values = valuesOf(state);
  const candidates = computeCandidates(values);
  for (let i = 0; i < 81; i++) {
    candidates[i] = playerCandidates(state.cells[i], candidates[i], state.autoCandidates);
  }
  return { values, candidates };
}

/**
 * The board the hint bar puts a remembered hint afresh from, and decides
 * whether to offer "Show me" by, without the solution: the placed digits,
 * and the candidates the player had when the last fill hint was given (see
 * `GameState.checkedCandidates`), less any a placed digit now rules out — or
 * every candidate the placed digits allow, before there has been one.
 *
 * Never the player's latest candidates: a change to those since nobody
 * checked them could take an answer out, and a bar that said something
 * different for the answer than for any other digit — a single where there
 * was a chain, Show me offered or not — would name it for free. Hint, which
 * is free again for a cell that has had it, brings their latest in. A cell
 * filled when they were taken counts as having every candidate.
 */
export function checkedBoardOf(state: GameState): SolverBoard {
  const values = valuesOf(state);
  const candidates = computeCandidates(values);
  const checked = state.checkedCandidates;
  if (checked !== null) {
    for (let i = 0; i < 81; i++) if (checked[i] !== 0) candidates[i] &= checked[i];
  }
  return { values, candidates };
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

/**
 * The remembered hint on show for a cell, which the hint bar shows whenever
 * the cell is selected: its mistake hint while it holds the value that was
 * wrong; while it is empty, its wrong-marks hint if it has one, and
 * otherwise its fill hint. Null when it has none of them.
 */
export function rememberedHint(state: GameState, index: number): Hint | null {
  const entry = state.cellHints.get(index);
  if (entry === undefined) return null;
  if (state.cells[index].value !== 0) return entry.mistake?.hint ?? null;
  return entry.struck?.hint ?? entry.fill;
}

/**
 * The hint for the hint bar: the one just asked for, until the next change,
 * and otherwise the selected cell's remembered hint.
 */
export function shownHint(state: GameState): Hint | null {
  return state.hint ?? rememberedHint(state, state.selected);
}

/** Whether a cell can be edited: not a given, not locked by a check/reveal, game not solved. */
export function isEditable(state: GameState, index: number): boolean {
  return isCellIndex(index) && state.status === 'playing' && canEdit(state.cells[index]);
}

/** One cell's remembered hints, as stored. */
export interface SerialisedCellHints {
  /** The cell, 0–80. */
  index: number;
  /** Its fill hint, or null. */
  fill: FillHint | null;
  /** The value its mistake hint was about; 0 when it has none. */
  mistake: number;
  /** Whether "Show me" has been opened for it. */
  walkthrough: boolean;
  /**
   * Its wrong-marks hint: whether its Show me has been opened. Written only
   * when it has one, so a save without one is just as it was before there
   * were any.
   */
  struck?: { walkthrough: boolean };
}

/**
 * A game as plain JSON for storage. No undo history is kept (NYT doesn't keep
 * it either) and neither is the input mode or the hint just asked for.
 *
 * A newer version may add fields, as long as it stays version 1 and keeps
 * these readable. Here they are ignored on load; the store carries them over
 * when it saves the game again (see `saveGameBlob` and
 * `SERIALISED_GAME_FIELDS`), so a tab still on this version does not wipe
 * them. Keeping these readable includes `marks`: a newer version must not
 * write a mark code other than `.wcr` (this version rejects the whole save).
 * "Check guesses when entered" marks a wrong number 'w' with no Check taken,
 * which is why it does so only once its assists carry `checkGuesses: true`:
 * a version from before the setting, which keeps that field as a newer
 * version's, then reads the mark as no Check (see `reconcileAssists`).
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
  /**
   * Help taken; on load, raised to cover any help the board shows (reveals,
   * checks, auto mode, hints). Small fields a newer version added here are
   * kept through a load and save (see `ASSIST_FIELDS`).
   */
  assists: Assists;
  /**
   * The hints remembered per cell. Absent from saves made before hints were
   * remembered, which load with none — still version 1, so either version of
   * the game can read the other's saves.
   */
  cellHints?: SerialisedCellHints[];
  /**
   * Whether "Check guesses when entered" is on for the game. Written only
   * when it is, so a save without it — every save from before the setting —
   * loads with it off.
   */
  checkGuesses?: true;
  /**
   * `GameState.checkedCandidates`: 81 masks. Written only when there are
   * some; a save without them — every save from before there were any —
   * loads with none, and the hint bar puts remembered hints afresh from the
   * placed digits alone until the next fill hint.
   */
  checkedCandidates?: number[];
}

/**
 * The fields of `Assists` this version knows. Anything else found on stored
 * assists is a newer version's, and kept as it is (see `newerFields`): the
 * reducer only ever spreads assists to change them, so such a field rides
 * along from load to save, and into the history record.
 */
export const ASSIST_FIELDS = fieldsOf<Assists>({
  autoCandidates: true,
  hints: true,
  checks: true,
  reveals: true,
  checkGuesses: true,
});

/**
 * The top-level fields of `SerialisedGame` this version knows. When the game
 * is saved again, a field of the previous save not in this list is a newer
 * version's and is carried over (see `saveGameBlob`); one in it is never
 * carried, even if this version leaves it out of a save.
 */
export const SERIALISED_GAME_FIELDS = fieldsOf<SerialisedGame>({
  v: true,
  puzzle: true,
  values: true,
  notes: true,
  autoRemoved: true,
  marks: true,
  selected: true,
  autoCandidates: true,
  status: true,
  assists: true,
  cellHints: true,
  checkGuesses: true,
  checkedCandidates: true,
});

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
    cellHints: [...state.cellHints].map(([index, entry]) => ({
      index,
      fill: entry.fill,
      mistake: entry.mistake?.value ?? 0,
      walkthrough: entry.walkthrough,
      ...(entry.struck === null ? {} : { struck: { walkthrough: entry.struck.walkthrough } }),
    })),
    ...(state.checkGuesses ? { checkGuesses: true as const } : {}),
    ...(state.checkedCandidates === null
      ? {}
      : { checkedCandidates: Array.from(state.checkedCandidates) }),
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

function isTechnique(value: unknown): value is TechniqueId {
  return TECHNIQUES.includes(value);
}

function isSingleTechnique(value: unknown): value is SingleTechniqueId {
  return SINGLE_TECHNIQUES.includes(value);
}

function readUnit(data: unknown): Unit | null {
  if (!isRecord(data)) return null;
  const { kind, index } = data;
  if (!UNIT_KINDS.includes(kind) || !Number.isInteger(index)) return null;
  if ((index as number) < 0 || (index as number) > 8) return null;
  return { kind: kind as Unit['kind'], index: index as number };
}

/** A stored fill hint for cell `index`, rebuilt from its parts; null if it is not one. */
function readFillHint(data: unknown, index: number): FillHint | null {
  if (!isRecord(data) || data.index !== index) return null;
  const { kind, technique, unit } = data;
  if (kind === 'deduction' && (technique === null || isTechnique(technique))) {
    return { kind, index, technique };
  }
  if (kind !== 'single' || !isSingleTechnique(technique)) return null;
  const house = readUnit(unit);
  return unit === null || house !== null ? { kind, index, technique, unit: house } : null;
}

/**
 * A stored wrong-marks hint for cell `index`, rebuilt from its parts; null if
 * there is none. Its Show me counts as opened only if stored as true.
 */
function readStruck(data: unknown, index: number): RememberedStruck | null {
  if (!isRecord(data)) return null;
  return { hint: { kind: 'struck', index }, walkthrough: data.walkthrough === true };
}

/**
 * Stored `checkedCandidates`, as far as they can be trusted: 81 masks, each
 * either 0 (a cell filled then) or holding its cell's answer — as every one
 * did when it was taken. Null otherwise, which costs only the hint bar's
 * putting remembered hints from the player's candidates until the next fill
 * hint.
 */
function readCheckedCandidates(data: unknown, puzzle: Puzzle): Uint16Array | null {
  if (!isMaskList(data)) return null;
  const isSound = data.every(
    (mask, i) => mask === 0 || (mask & bit(solutionDigit(puzzle, i))) !== 0,
  );
  return isSound ? Uint16Array.from(data) : null;
}

/**
 * The remembered hints, as far as they can be trusted. They decide nothing
 * about the board, so anything doubtful is dropped rather than the game
 * rejected — which costs only the chance to see that hint again for free.
 * A mistake hint is kept only for a cell that still holds that value, and it
 * wrong; a wrong-marks hint only for a cell whose answer is still missing
 * from its candidates; and nothing is kept that the cell no longer needs
 * (see `liveHints`).
 */
function readCellHints(
  data: unknown,
  cells: readonly CellState[],
  puzzle: Puzzle,
  autoCandidates: boolean,
): ReadonlyMap<number, RememberedHints> {
  if (!Array.isArray(data)) return NO_CELL_HINTS;
  let cellHints = NO_CELL_HINTS;
  // `Array.from` turns holes into undefined, which is then skipped like any non-record.
  for (const item of Array.from(data as unknown[])) {
    if (!isRecord(item) || !isCellIndex(item.index) || cellHints.has(item.index)) continue;
    const { index } = item;
    const cell = cells[index];
    const answer = solutionDigit(puzzle, index);
    // A given or a locked cell holds its answer, so this is a value of the player's.
    const isMistaken = item.mistake === cell.value && cell.value !== 0 && cell.value !== answer;
    const entry: RememberedHints = {
      fill: readFillHint(item.fill, index),
      mistake: isMistaken ? { hint: { kind: 'mistake', index }, value: cell.value } : null,
      walkthrough: item.walkthrough === true,
      struck: readStruck(item.struck, index),
    };
    const isMissing = isAnswerMissing(cells, autoCandidates, index, answer);
    cellHints = setCellHints(cellHints, index, liveHints(entry, cell.value, answer, isMissing));
  }
  return cellHints;
}

/**
 * Stored assists, or null if they are not well-formed. The four counts and
 * flags every version has written must be exactly right; `checkGuesses` is
 * kept only as `true` (saves from before it have none, and it is never
 * written as anything else); and any small field a newer version added — a
 * new kind of help — is kept alongside them (see `newerFields`), so that it
 * is neither a reason to reject the save nor lost when this version saves the
 * game again. Help taken must never be lost, whoever counted it.
 */
function readAssists(data: unknown): Assists | null {
  if (!isRecord(data)) return null;
  const { autoCandidates, hints, checks, reveals } = data;
  if (typeof autoCandidates !== 'boolean' || !isCount(hints) || !isCount(checks)) return null;
  if (!isCount(reveals)) return null;
  return {
    ...newerFields(data, ASSIST_FIELDS),
    autoCandidates,
    hints,
    checks,
    reveals,
    ...(data.checkGuesses === true ? { checkGuesses: true as const } : {}),
  };
}

/**
 * Stored assists, raised to cover the help the board itself shows was taken —
 * help taken must never be lost, and a revealed game that loads as unassisted
 * could set a best time. Every revealed cell is a reveal; every remembered
 * hint, and every "Show me" opened (a wrong-marks hint's included), was
 * counted once when it was first shown; a cell checked correct means at least one check, and so does one
 * marked wrong unless a hint accounts for it (a hint marks the mistake it
 * points at the same way) or "Check guesses when entered" was on (it marks a
 * wrong digit as it goes in, with no Check taken); Check guesses on now means
 * it was used; and auto mode on or any elimination (only ever recorded in
 * auto mode) means auto mode was used.
 */
function reconcileAssists(
  assists: Assists,
  cells: readonly CellState[],
  autoCandidates: boolean,
  checkGuesses: boolean,
  cellHints: ReadonlyMap<number, RememberedHints>,
): Assists {
  const reveals = cells.filter((cell) => cell.mark === 'revealed').length;
  let remembered = 0;
  for (const { fill, mistake, walkthrough, struck } of cellHints.values()) {
    remembered += Number(fill !== null) + Number(mistake !== null) + Number(walkthrough);
    remembered += Number(struck !== null) + Number(struck?.walkthrough === true);
  }
  const hints = Math.max(assists.hints, remembered);
  const isGuessChecked = assists.checkGuesses === true || checkGuesses;
  const isMarkedWrong = cells.some((cell) => cell.mark === 'wrong');
  const isChecked =
    cells.some((cell) => cell.mark === 'correct') ||
    (isMarkedWrong && hints === 0 && !isGuessChecked);
  const isAutoUsed = autoCandidates || cells.some((cell) => cell.autoRemoved !== 0);
  return {
    ...assists,
    autoCandidates: assists.autoCandidates || isAutoUsed,
    hints,
    checks: Math.max(assists.checks, isChecked ? 1 : 0),
    reveals: Math.max(assists.reveals, reveals),
    ...(isGuessChecked ? { checkGuesses: true as const } : {}),
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
 * invented; a newer version's extra kinds of help are kept, see
 * `readAssists`). What can be derived or defaulted without changing the board is
 * coerced instead: an out-of-range `selected` becomes the first empty cell, a
 * non-boolean `autoCandidates` or `checkGuesses` is off, `status` is
 * re-derived from the values,
 * marks a check could never have produced become 'none', notes on givens are
 * dropped, remembered hints that cannot be trusted are forgotten (see
 * `readCellHints`), and the assists are raised to cover any help the board
 * shows.
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
  const checkGuesses = data.checkGuesses === true;
  const cellHints = readCellHints(data.cellHints, cells, puzzle, autoCandidates);
  return {
    puzzle,
    cells,
    selected: isCellIndex(data.selected) ? data.selected : firstEmpty(cells),
    mode: 'normal',
    autoCandidates,
    checkGuesses,
    status: statusOf(cells, puzzle),
    undoStack: NO_ENTRIES,
    redoStack: NO_ENTRIES,
    assists: reconcileAssists(assists, cells, autoCandidates, checkGuesses, cellHints),
    hint: null,
    cellHints,
    checkedCandidates: readCheckedCandidates(data.checkedCandidates, puzzle),
  };
}
