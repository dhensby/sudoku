import {
  createGame,
  reduce,
  type FillHint,
  type GameAction,
  type GameState,
  type NewGameOptions,
  type RememberedHints,
} from './game';
import { seedFromString } from './rng';
import type {
  Assists,
  Digit,
  Hint,
  Puzzle,
  SingleTechniqueId,
  TechniqueId,
  UnitKind,
} from './types';

/*
 * The move log: every move that changed a game, and all help seen, in order,
 * with the play-clock time it was made at — enough to rebuild the game
 * exactly, step by step, from nothing but the puzzle.
 *
 * It sits beside the reducer rather than inside it. The reducer is pure and
 * returns the very same state for a no-op, so logging only the actions that
 * changed something, and replaying them through `reduce`, rebuilds the game:
 * board, help taken, remembered hints, and the undo and redo stacks too. The
 * undo stack itself can't serve: it holds inverse diffs only, drops whatever
 * is undone once a new move forks the timeline, and is not saved.
 *
 * What is logged (see `moveFor`): placing and pencilling a digit, erasing,
 * hints, Show me, Check (a cell or the puzzle), Reveal, auto candidates on
 * and off, Undo, Redo and Reset. Not logged: selecting and moving the
 * selection, the input mode, pauses, and a hint that has nothing to say (the
 * board is full). One move is logged that changes nothing: Show me opened
 * again for a cell already charged for it, which is still help seen (it ends a
 * slip's grace, as any help does). A move fills in what its replay needs and
 * the action left to the state — the cell an entry or erase went to, the mode
 * a digit went in, and the selected cell for the moves that act on it — so a
 * replay never depends on selections it was not told about.
 *
 * The encoded form is meant to go anywhere a string can, a share link
 * included, and to be read back with nothing but the puzzle: base64url only
 * (A–Z a–z 0–9 - _), and self-describing.
 *
 *   header  3 chars: the format version, the rules version (`MOVES_VERSION`)
 *           and a flags char: bit 0 the game began in auto candidate mode,
 *           bit 1 the log was cut off at `MAX_MOVES`; bits 2–5 are free and
 *           must be 0 for now.
 *   move    2 chars, a 12-bit code, most significant char first:
 *             op × 81 + cell for the ops with a cell (codes 0–2753):
 *               0–8 place 1–9, 9–17 place 1–9 and clear it from the peers'
 *               notes, 18–26 pencil 1–9, 27 erase, 28 hint, 29 Show me,
 *               30 check the cell, 31 reveal, 32 auto candidates on,
 *               33 auto candidates off;
 *             the ops without one above them: 2754 undo, 2755 redo,
 *             2756 check the puzzle, 2757 reset, 2758 a hint off the grid
 *             (which the reducer counts but cannot point at). 2759 and 2760
 *             are reserved for turning "Check guesses when entered" on and
 *             off; this rules version has no such move, so they are refused.
 *           A hint adds 2 chars: its kind, technique and unit, from the fixed
 *           table below (`describeHint`).
 *           Then the time since the previous move (or the start), in 100 ms
 *           units, as a base-32 varint: 5 bits a char, least significant
 *           first, with the char's sixth bit set while more follow.
 *   check   3 chars: 18 bits of an FNV-1a hash of everything before it.
 *           Moves carry no count, so without it a log cut short between two
 *           moves — a link clipped by a chat app — would read as a shorter
 *           game; and a char mistyped could spell a different one. With it,
 *           either is refused bar a one-in-262,144 chance.
 *
 * That is 3–4 chars a move: about 160–250 for a solve that only places
 * digits, 190–370 with auto candidates and 500–1,100 for one that pencils in
 * every candidate (README, "The move log"). A later format version can
 * compress the body if real logs show it pays; the format char is what would
 * say so.
 *
 * Decoding is strict: anything malformed, cut short, padded, written
 * non-canonically, or written by a format or rules version this build does not
 * know, is refused whole — never a partial or misread log. `readMoveLogHeader`
 * says which of those a refused log was, so that one from an older or a newer
 * version can be told from one that is broken.
 *
 * A log is only ever replayed under the rules it was recorded by. A new kind
 * of move, hint or flag needs no new rules version: it takes a code that is
 * unused today, which older builds already refuse, and the logs written before
 * it never hold it. What does need one is a change to what `reduce` does with
 * a move an existing log can already hold — then `MOVES_VERSION` must go up.
 * The golden logs (`fixtures/moveLogs.json`) hold the reducer to that: between
 * them they walk a named checklist of every situation in which `reduce`
 * treats a move differently (`GOLDEN_SITUATIONS`, `src/test/goldenMoveLogs.ts`),
 * and replaying any of them differently fails the build until the version is
 * bumped. A new rule needs a situation in that checklist, or it is not guarded.
 */

/**
 * The version of the reducer's rules a log is replayed by. Bump it whenever
 * `reduce` would do something different with a move that a log written today
 * could already hold — anything that changes what such a replay rebuilds — and
 * regenerate the golden logs with `npm run moves:golden`. A move of a new kind
 * takes an unused code instead, with no bump (see the module comment). Logs
 * recorded under another version are refused rather than replayed into a
 * different game.
 */
export const MOVES_VERSION = 1;

/** The version of the encoding itself (the first char of an encoded log). */
export const MOVE_LOG_FORMAT = 1;

/**
 * The most moves a log keeps. A solve takes some 50–400; past this the log
 * stops growing and is marked `truncated`, which bounds what a runaway game
 * can cost in storage (about 50K chars at worst).
 */
export const MAX_MOVES = 5000;

/** Log times are play-clock milliseconds rounded down to this. */
export const MOVE_TICK_MS = 100;

/** A hint that is logged: everything but "nothing to suggest". */
export type LoggedHint = Exclude<Hint, { kind: 'none' }>;

/** The moves about one cell that need nothing more than the cell. */
export type CellOp = 'erase' | 'walkthrough' | 'checkCell' | 'reveal' | 'autoOn' | 'autoOff';

/** The moves that need no cell at all. */
export type BareOp = 'undo' | 'redo' | 'checkPuzzle' | 'reset';

/**
 * One move logged: one that changed the game, or help seen again (see
 * `moveFor`). `cell` is where it happened — for Check, Reveal and the auto
 * candidate switch, the cell that was selected, which their replay selects
 * first.
 */
export type Move =
  /**
   * A digit placed in Normal mode; `clearPeerNotes` is the setting that also
   * strips it from the peers' notes.
   */
  | {
      readonly op: 'place';
      readonly cell: number;
      readonly digit: Digit;
      readonly clearPeerNotes: boolean;
    }
  /** A digit in Candidate mode: a note toggled, or in auto mode a candidate struck or restored. */
  | { readonly op: 'candidate'; readonly cell: number; readonly digit: Digit }
  | { readonly op: CellOp; readonly cell: number }
  /** A hint shown. An index off the grid is logged as -1. */
  | { readonly op: 'hint'; readonly hint: LoggedHint }
  | { readonly op: BareOp };

/**
 * A move as logged, with the play-clock time it was made at: ms, rounded down
 * to a multiple of `MOVE_TICK_MS`.
 */
export type LoggedMove = Move & { readonly at: number };

/** A game's moves, from the start. */
export interface MoveLog {
  /** Whether the game began in auto candidate mode (the setting at the time). */
  readonly autoCandidates: boolean;
  /** Every move logged (see `moveFor`), oldest first, at times that never go backwards. */
  readonly moves: readonly LoggedMove[];
  /** Whether logging stopped at `MAX_MOVES`, so the log no longer reaches the game as it stands. */
  readonly truncated: boolean;
}

/** One move replayed: the game just before it and just after. */
export interface ReplayStep {
  /** The move's position in the log, from 0. */
  readonly index: number;
  readonly move: LoggedMove;
  readonly before: GameState;
  readonly after: GameState;
}

// ---------------------------------------------------------------------------
// The fixed tables
// ---------------------------------------------------------------------------

/*
 * Every number below is part of the format: written into logs that may sit in
 * storage or a link for years. Never renumber one; add new ones in unused
 * codes. Positions in `TECHNIQUE_ORDER` are deliberately not used, so that the
 * grader may reorder or add techniques without changing what old logs say.
 * The `Record` types make the compiler insist that every technique has a code.
 */

/** A hint's descriptor: a mistake. */
const MISTAKE_HINT = 0;

/** A hint's descriptor: a deduction with no technique to name. */
const UNNAMED_DEDUCTION = 1;

/** A deduction hint's descriptor, by the hardest technique it took. */
const DEDUCTION_CODE: Readonly<Record<TechniqueId, number>> = {
  fullHouse: 2,
  hiddenSingleBox: 3,
  hiddenSingleLine: 4,
  nakedSingle: 5,
  pointing: 6,
  claiming: 7,
  nakedPair: 8,
  hiddenPair: 9,
  nakedTriple: 10,
  hiddenTriple: 11,
  xWing: 12,
  swordfish: 13,
  xyWing: 14,
  xyzWing: 15,
  skyscraper: 16,
  twoStringKite: 17,
  xyChain: 18,
  wWing: 19,
  alternatingChain: 20,
};

/** Single hints take descriptors from here: `SINGLE_BASE + technique × 28 + unit`. */
const SINGLE_BASE = 64;

/** A single's technique code. */
const SINGLE_CODE: Readonly<Record<SingleTechniqueId, number>> = {
  fullHouse: 0,
  hiddenSingleBox: 1,
  hiddenSingleLine: 2,
  nakedSingle: 3,
};

/** A single's unit code is 0 for none, else `1 + kind × 9 + index`. */
const UNIT_KIND_CODE: Readonly<Record<UnitKind, number>> = { row: 0, column: 1, box: 2 };

/** The unit codes per single technique: none, then 9 rows, 9 columns and 9 boxes. */
const UNITS_PER_SINGLE = 28;

/** The op codes (see the module comment) of the ops with a cell. */
const PLACE = 0;
const PLACE_CLEARING = 9;
const CANDIDATE = 18;
const CELL_OP_CODE: Readonly<Record<CellOp | 'hint', number>> = {
  erase: 27,
  hint: 28,
  walkthrough: 29,
  checkCell: 30,
  reveal: 31,
  autoOn: 32,
  autoOff: 33,
};

/** Where the ops without a cell begin: just above every op × 81 + cell. */
const BARE_BASE = 34 * 81;

const BARE_CODE: Readonly<Record<BareOp, number>> = {
  undo: BARE_BASE,
  redo: BARE_BASE + 1,
  checkPuzzle: BARE_BASE + 2,
  reset: BARE_BASE + 3,
};

/** A hint whose index is off the grid (no cell to put in the code). */
const OFF_GRID_HINT = BARE_BASE + 4;

/**
 * The first code this build does not use. The next two are reserved for
 * "Check guesses when entered" on and off. Moves new to the log, they need no
 * new rules version: no log written before them holds their codes, and builds
 * from before them refuse those codes.
 */
const UNUSED_CODES = BARE_BASE + 5;

const FLAG_AUTO_CANDIDATES = 1;
const FLAG_TRUNCATED = 2;
const KNOWN_FLAGS = FLAG_AUTO_CANDIDATES | FLAG_TRUNCATED;

/** The chars of the check at the end. */
const CHECK_CHARS = 3;

/** The varint's chars carry 5 bits each; the sixth says another char follows. */
const VARINT_MORE = 32;

/** The most chars a time gap may take: 30 bits, a gap of some three and a half years. */
const MAX_GAP_CHARS = 6;

/** The longest gap a log can hold, in ticks. `appendMove` caps a longer one here. */
const MAX_GAP_TICKS = 32 ** MAX_GAP_CHARS - 1;

/** The longest a well-formed log can be: `MAX_MOVES` hints with the longest gaps, header and check. */
const MAX_ENCODED_LENGTH = 3 + MAX_MOVES * (2 + 2 + MAX_GAP_CHARS) + CHECK_CHARS;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const ENCODED_PATTERN = /^[A-Za-z0-9_-]+$/;

const OPS_BY_CODE = new Map<number, CellOp>(
  Object.entries(CELL_OP_CODE)
    .filter(([op]) => op !== 'hint')
    .map(([op, code]) => [code, op as CellOp]),
);

const BARE_OPS_BY_CODE = new Map<number, BareOp>(
  Object.entries(BARE_CODE).map(([op, code]) => [code, op as BareOp]),
);

const DEDUCTIONS_BY_CODE = new Map<number, TechniqueId>(
  Object.entries(DEDUCTION_CODE).map(([technique, code]) => [code, technique as TechniqueId]),
);

// Read back from the codes themselves, not the order the names are written in,
// so that reordering a table's lines changes nothing.
const SINGLES_BY_CODE = new Map<number, SingleTechniqueId>(
  Object.entries(SINGLE_CODE).map(([technique, code]) => [code, technique as SingleTechniqueId]),
);

const UNIT_KINDS_BY_CODE = new Map<number, UnitKind>(
  Object.entries(UNIT_KIND_CODE).map(([kind, code]) => [code, kind as UnitKind]),
);

/** A Map rather than property lookups, so that a stray name such as `toString` finds nothing. */
const DEDUCTION_CODES = new Map(Object.entries(DEDUCTION_CODE));
const SINGLE_CODES = new Map(Object.entries(SINGLE_CODE));
const UNIT_KIND_CODES = new Map(Object.entries(UNIT_KIND_CODE));

function isCellIndex(index: unknown): index is number {
  return Number.isInteger(index) && (index as number) >= 0 && (index as number) < 81;
}

function isDigit(digit: unknown): digit is Digit {
  return Number.isInteger(digit) && (digit as number) >= 1 && (digit as number) <= 9;
}

/**
 * A logged hint's descriptor: its kind, technique and unit, from the fixed
 * table. Null if the table has no code for it.
 */
function describeHint(hint: LoggedHint): number | null {
  if (hint.kind === 'mistake') return MISTAKE_HINT;
  if (hint.kind === 'deduction') {
    if (hint.technique === null) return UNNAMED_DEDUCTION;
    return DEDUCTION_CODES.get(hint.technique) ?? null;
  }
  const technique = SINGLE_CODES.get(hint.technique);
  if (technique === undefined) return null;
  let unit = 0;
  if (hint.unit !== null) {
    const kind = UNIT_KIND_CODES.get(hint.unit.kind);
    const { index } = hint.unit;
    if (kind === undefined || !Number.isInteger(index) || index < 0 || index > 8) return null;
    unit = 1 + kind * 9 + index;
  }
  return SINGLE_BASE + technique * UNITS_PER_SINGLE + unit;
}

/** The hint a descriptor stands for, about cell `index`; null for one the table doesn't have. */
function hintFor(descriptor: number, index: number): LoggedHint | null {
  if (descriptor === MISTAKE_HINT) return { kind: 'mistake', index };
  if (descriptor === UNNAMED_DEDUCTION) return { kind: 'deduction', index, technique: null };
  const deduction = DEDUCTIONS_BY_CODE.get(descriptor);
  if (deduction !== undefined) return { kind: 'deduction', index, technique: deduction };
  // Below the singles' base this is negative, and so is the technique code.
  const single = descriptor - SINGLE_BASE;
  const technique = SINGLES_BY_CODE.get(Math.floor(single / UNITS_PER_SINGLE));
  if (technique === undefined) return null;
  const unit = (single % UNITS_PER_SINGLE) - 1;
  if (unit === -1) return { kind: 'single', index, technique, unit: null };
  // Every unit code from 1 to 27 is a kind (0–2) and an index (0–8).
  const kind = UNIT_KINDS_BY_CODE.get(Math.floor(unit / 9))!;
  return { kind: 'single', index, technique, unit: { kind, index: unit % 9 } };
}

/**
 * A hint as the log keeps it: exactly what decoding it gives back, so a log
 * replays the same before and after a round trip. Throws for a hint the table
 * has no code for — which only a hint `findHint` could never make can be.
 */
function loggedHint(hint: LoggedHint): LoggedHint {
  const descriptor = describeHint(hint);
  if (descriptor === null) {
    throw new RangeError(`No move log code for the hint ${JSON.stringify(hint)}`);
  }
  return hintFor(descriptor, isCellIndex(hint.index) ? hint.index : -1)!;
}

// ---------------------------------------------------------------------------
// Building a log
// ---------------------------------------------------------------------------

/**
 * Whether "Show me" for `index` opens — charged or not — as `openWalkthrough`
 * in the reducer decides: an empty cell with a fill hint remembered. (A solved
 * game, where the reducer allows no Show me, has no empty cell.)
 */
function opensWalkthrough(state: GameState, index: number): boolean {
  if (!isCellIndex(index) || state.cells[index].value !== 0) return false;
  return (state.cellHints.get(index)?.fill ?? null) !== null;
}

/** An empty log for a game created with `options` (see `createGame`). */
export function createMoveLog(options: NewGameOptions = {}): MoveLog {
  return { autoCandidates: options.autoCandidates ?? false, moves: [], truncated: false };
}

/**
 * The move to log for `action` on `previous`, or null when there is nothing
 * to log: the action changed nothing (`next` is `previous` — the reducer's
 * no-op), it only moved the selection or switched the input mode, or it was a
 * hint with nothing to suggest. Pass `next` when it is already to hand, to
 * save reducing twice.
 *
 * The one move logged that changes nothing is Show me opened again for a cell
 * already charged for it. It is free, so the reducer does nothing; but the
 * walkthrough is on show again, and help seen ends a slip's grace (PLAN,
 * "Mistakes"), so the log must hold it. It replays as the no-op it was.
 *
 * The move carries what its replay needs from `previous`: the cell an entry or
 * erase defaulted to, the mode a digit defaulted to (as `place` or
 * `candidate`), the setting for clearing peers' notes, and the selected cell
 * for Check cell, Reveal and the auto candidate switch.
 *
 * Throws a RangeError for a hint whose technique or unit the log's table has
 * no code for, which no hint from `findHint` can be.
 */
export function moveFor(
  previous: GameState,
  action: GameAction,
  next: GameState = reduce(previous, action),
): Move | null {
  if (action.type === 'walkthrough') {
    return opensWalkthrough(previous, action.index)
      ? { op: 'walkthrough', cell: action.index }
      : null;
  }
  if (next === previous) return null;
  switch (action.type) {
    case 'select':
    case 'move':
    case 'setMode':
    case 'toggleMode':
      return null;
    case 'enter': {
      const cell = action.index ?? previous.selected;
      const { digit } = action;
      if ((action.mode ?? previous.mode) === 'candidate') return { op: 'candidate', cell, digit };
      return { op: 'place', cell, digit, clearPeerNotes: action.clearPeerNotes ?? false };
    }
    case 'erase':
      return { op: 'erase', cell: action.index ?? previous.selected };
    case 'setAutoCandidates':
      return { op: action.enabled ? 'autoOn' : 'autoOff', cell: previous.selected };
    case 'hint':
      return action.hint.kind === 'none' ? null : { op: 'hint', hint: loggedHint(action.hint) };
    case 'check':
      return action.scope === 'cell'
        ? { op: 'checkCell', cell: previous.selected }
        : { op: 'checkPuzzle' };
    case 'reveal':
      return { op: 'reveal', cell: previous.selected };
    case 'undo':
    case 'redo':
    case 'reset':
      return { op: action.type };
  }
}

/**
 * The log with `move` added at play-clock time `atMs`, rounded down to a whole
 * `MOVE_TICK_MS` — down, so a move's logged time is never later than the clock
 * read when it was made, and a clock restored from the log never gains time
 * nobody played. Time never goes backwards in a log: a time before the last
 * move's (or one that is not a number at all) is taken as the last move's, and
 * a gap too long to encode (years) is shortened to the longest that is. Once
 * the log holds `MAX_MOVES` it stops growing and is marked truncated; a
 * truncated log is returned as it is.
 */
export function appendMove(log: MoveLog, move: Move, atMs: number): MoveLog {
  if (log.truncated) return log;
  if (log.moves.length >= MAX_MOVES) return { ...log, truncated: true };
  const last = log.moves.at(-1)?.at ?? 0;
  const rounded = Math.floor(atMs / MOVE_TICK_MS) * MOVE_TICK_MS;
  const at = Number.isNaN(rounded)
    ? last
    : Math.min(Math.max(rounded, last), last + MAX_GAP_TICKS * MOVE_TICK_MS);
  return { ...log, moves: [...log.moves, { ...move, at }] };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function isBareMove(move: Move): move is Extract<Move, { op: BareOp }> {
  return Object.hasOwn(BARE_CODE, move.op);
}

/** A move's code and, for a hint, its descriptor. Throws for a move no log could hold. */
function codeOf(move: Move): readonly [code: number, descriptor: number | null] {
  if (isBareMove(move)) return [BARE_CODE[move.op], null];
  if (move.op === 'hint') {
    const descriptor = describeHint(move.hint);
    if (descriptor === null) throw new RangeError(`No move log code for ${JSON.stringify(move)}`);
    const { index } = move.hint;
    return [isCellIndex(index) ? CELL_OP_CODE.hint * 81 + index : OFF_GRID_HINT, descriptor];
  }
  const isDigitMove = move.op === 'place' || move.op === 'candidate';
  if (!isCellIndex(move.cell) || (isDigitMove && !isDigit(move.digit))) {
    throw new RangeError(`No move log code for ${JSON.stringify(move)}`);
  }
  let op: number;
  if (move.op === 'place') op = (move.clearPeerNotes ? PLACE_CLEARING : PLACE) + move.digit - 1;
  else if (move.op === 'candidate') op = CANDIDATE + move.digit - 1;
  else op = CELL_OP_CODE[move.op];
  return [op * 81 + move.cell, null];
}

/** The check written after a log's body: the low 18 bits of its FNV-1a hash, in 3 chars. */
function checkOf(body: string): string {
  const hash = seedFromString(body);
  return ALPHABET[(hash >> 12) & 63] + ALPHABET[(hash >> 6) & 63] + ALPHABET[hash & 63];
}

/** Two chars for a 12-bit number, most significant first. */
function pair(value: number): string {
  return ALPHABET[value >> 6] + ALPHABET[value & 63];
}

/** A whole number of ticks as a varint, least significant 5 bits first. */
function varint(value: number): string {
  let text = '';
  let rest = value;
  do {
    const low = rest % 32;
    rest = Math.floor(rest / 32);
    text += ALPHABET[rest > 0 ? low | VARINT_MORE : low];
  } while (rest > 0);
  return text;
}

/**
 * The log as a compact base64url string (see the module comment), under this
 * build's format and rules versions. Throws a RangeError for a log that
 * `createMoveLog` and `appendMove` could not have built — more than
 * `MAX_MOVES` moves, marked truncated short of them, a move off the grid, a
 * digit or hint with no code, or times that are not whole ticks, go backwards
 * or leap further than a varint holds — so that whatever it writes,
 * `decodeMoveLog` reads back.
 */
export function encodeMoveLog(log: MoveLog): string {
  const count = log.moves.length;
  if (count > MAX_MOVES || (log.truncated && count !== MAX_MOVES)) {
    const truncation = log.truncated ? 'marked truncated' : 'not marked truncated';
    throw new RangeError(`No move log holds ${count} moves ${truncation}`);
  }
  const flags =
    (log.autoCandidates ? FLAG_AUTO_CANDIDATES : 0) | (log.truncated ? FLAG_TRUNCATED : 0);
  const parts = [ALPHABET[MOVE_LOG_FORMAT], ALPHABET[MOVES_VERSION], ALPHABET[flags]];
  let previous = 0;
  for (const move of log.moves) {
    const [code, descriptor] = codeOf(move);
    const ticks = (move.at - previous) / MOVE_TICK_MS;
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_GAP_TICKS) {
      throw new RangeError(`No move log code for ${JSON.stringify(move)} after ${previous} ms`);
    }
    parts.push(pair(code));
    if (descriptor !== null) parts.push(pair(descriptor));
    parts.push(varint(ticks));
    previous = move.at;
  }
  const body = parts.join('');
  return body + checkOf(body);
}

/** Reads base64url digits off the front of an encoded log. */
class Reader {
  constructor(
    private readonly text: string,
    private position: number,
  ) {}

  get isDone(): boolean {
    return this.position === this.text.length;
  }

  /** The next char's value, or null at the end. Every char has passed `ENCODED_PATTERN`. */
  digit(): number | null {
    if (this.isDone) return null;
    return ALPHABET.indexOf(this.text[this.position++]);
  }

  /** The next two chars as a 12-bit number, or null if they run out. */
  pair(): number | null {
    const high = this.digit();
    const low = this.digit();
    return high === null || low === null ? null : high * 64 + low;
  }

  /**
   * A varint, or null if it runs out, runs past `MAX_GAP_CHARS`, or is not
   * written as `varint` writes it (a needless last char of 0).
   */
  varint(): number | null {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < MAX_GAP_CHARS; i++) {
      const digit = this.digit();
      if (digit === null) return null;
      value += (digit % VARINT_MORE) * scale;
      if (digit < VARINT_MORE) return i > 0 && digit === 0 ? null : value;
      scale *= 32;
    }
    return null;
  }
}

/** The move a code stands for, reading a hint's descriptor from `reader`; null if there is none. */
function readMove(code: number, reader: Reader): Move | null {
  if (code === OFF_GRID_HINT || Math.floor(code / 81) === CELL_OP_CODE.hint) {
    const descriptor = reader.pair();
    const index = code === OFF_GRID_HINT ? -1 : code % 81;
    const hint = descriptor === null ? null : hintFor(descriptor, index);
    return hint === null ? null : { op: 'hint', hint };
  }
  // Codes from here up to `UNUSED_CODES` (refused before this) are bare ops,
  // the hint off the grid having been read above.
  if (code >= BARE_BASE) return { op: BARE_OPS_BY_CODE.get(code)! };
  const op = Math.floor(code / 81);
  const cell = code % 81;
  if (op < CANDIDATE) {
    const digit = ((op % 9) + 1) as Digit;
    return { op: 'place', cell, digit, clearPeerNotes: op >= PLACE_CLEARING };
  }
  if (op < CELL_OP_CODE.erase)
    return { op: 'candidate', cell, digit: (op - CANDIDATE + 1) as Digit };
  // Every op code from erase up to the bare ops is one of the cell ops.
  return { op: OPS_BY_CODE.get(op)!, cell };
}

/**
 * A log read back from `encodeMoveLog`'s string, or null unless it is exactly
 * such a string, written by this format and rules version: no partial log and
 * no guessing. Needs nothing but the string — not the puzzle, nor anything
 * the player has stored or set.
 */
export function decodeMoveLog(text: unknown): MoveLog | null {
  if (typeof text !== 'string' || text.length > MAX_ENCODED_LENGTH) return null;
  if (!ENCODED_PATTERN.test(text)) return null;
  const body = text.slice(0, -CHECK_CHARS);
  if (text.length < 3 + CHECK_CHARS || checkOf(body) !== text.slice(-CHECK_CHARS)) return null;
  // The header, which the length check above guarantees is all there.
  const [format, rules, flags] = [...body.slice(0, 3)].map((ch) => ALPHABET.indexOf(ch));
  if (format !== MOVE_LOG_FORMAT || rules !== MOVES_VERSION) return null;
  if ((flags & ~KNOWN_FLAGS) !== 0) return null;
  const reader = new Reader(body, 3);

  const moves: LoggedMove[] = [];
  let at = 0;
  while (!reader.isDone) {
    if (moves.length === MAX_MOVES) return null;
    const code = reader.pair();
    if (code === null || code >= UNUSED_CODES) return null;
    const move = readMove(code, reader);
    const ticks = move === null ? null : reader.varint();
    if (move === null || ticks === null) return null;
    at += ticks * MOVE_TICK_MS;
    moves.push({ ...move, at });
  }
  // `appendMove` only marks a full log truncated.
  const truncated = (flags & FLAG_TRUNCATED) !== 0;
  if (truncated && moves.length !== MAX_MOVES) return null;
  return { autoCandidates: (flags & FLAG_AUTO_CANDIDATES) !== 0, moves, truncated };
}

/** The versions an encoded log was written by: see `readMoveLogHeader`. */
export interface MoveLogHeader {
  /** The format version. Above `MOVE_LOG_FORMAT`, an encoding from a later build. */
  readonly format: number;
  /**
   * The rules version it was recorded under (compare `MOVES_VERSION`). Null
   * for a format this build cannot read, which need not keep it in the same
   * place.
   */
  readonly rules: number | null;
}

/**
 * The versions a log says it was written by — enough to say why
 * `decodeMoveLog` refused it: a log from an older rules version, one that
 * needs a newer build (a later format or rules version), or, when the
 * versions are this build's own, a broken one. Null for a string that is not a
 * log at all, which includes a log in this build's format whose check fails:
 * its versions may be the very chars that were garbled. Of a later format only
 * the first char is read, the one part of the layout every format keeps.
 */
export function readMoveLogHeader(text: unknown): MoveLogHeader | null {
  if (typeof text !== 'string' || !ENCODED_PATTERN.test(text)) return null;
  const format = ALPHABET.indexOf(text[0]);
  if (format > MOVE_LOG_FORMAT) return { format, rules: null };
  // There was no format 0, nor anything before this one.
  if (format !== MOVE_LOG_FORMAT || text.length < 3 + CHECK_CHARS) return null;
  const body = text.slice(0, -CHECK_CHARS);
  if (checkOf(body) !== text.slice(-CHECK_CHARS)) return null;
  return { format, rules: ALPHABET.indexOf(text[1]) };
}

// ---------------------------------------------------------------------------
// Replaying
// ---------------------------------------------------------------------------

const SELECT = (index: number): GameAction => ({ type: 'select', index });

/**
 * The reducer actions that replay a move. A move that acts on the selected
 * cell selects it first: selections are not logged, so the replay has its own.
 */
function actionsOf(move: Move): GameAction[] {
  switch (move.op) {
    case 'place':
      return [
        {
          type: 'enter',
          digit: move.digit,
          index: move.cell,
          mode: 'normal',
          clearPeerNotes: move.clearPeerNotes,
        },
      ];
    case 'candidate':
      return [{ type: 'enter', digit: move.digit, index: move.cell, mode: 'candidate' }];
    case 'erase':
      return [{ type: 'erase', index: move.cell }];
    case 'hint':
      return [{ type: 'hint', hint: move.hint }];
    case 'walkthrough':
      return [{ type: 'walkthrough', index: move.cell }];
    case 'checkCell':
      return [SELECT(move.cell), { type: 'check', scope: 'cell' }];
    case 'reveal':
      return [SELECT(move.cell), { type: 'reveal' }];
    case 'autoOn':
    case 'autoOff':
      return [SELECT(move.cell), { type: 'setAutoCandidates', enabled: move.op === 'autoOn' }];
    case 'checkPuzzle':
      return [{ type: 'check', scope: 'puzzle' }];
    case 'undo':
    case 'redo':
    case 'reset':
      return [{ type: move.op }];
  }
}

function applyMove(state: GameState, move: Move): GameState {
  return actionsOf(move).reduce(reduce, state);
}

/** The game a log starts from. */
function startOf(puzzle: Puzzle, log: MoveLog): GameState {
  return createGame(puzzle, { autoCandidates: log.autoCandidates });
}

/**
 * The game after the first `upTo` moves of the log (all of them by default),
 * replayed from a new game of `puzzle`. The selection, the input mode and the
 * hint on show are the replay's own: they are not logged, and decide nothing a
 * replay needs.
 */
export function replayMoves(
  puzzle: Puzzle,
  log: MoveLog,
  upTo: number = log.moves.length,
): GameState {
  return log.moves.slice(0, Math.max(0, upTo)).reduce(applyMove, startOf(puzzle, log));
}

/**
 * The log replayed a move at a time, each step with the game just before and
 * just after its move — what playing a game back, and judging each move, step
 * through.
 */
export function* replayMoveSteps(
  puzzle: Puzzle,
  log: MoveLog,
): Generator<ReplayStep, void, undefined> {
  let state = startOf(puzzle, log);
  for (const [index, move] of log.moves.entries()) {
    const after = applyMove(state, move);
    yield { index, move, before: state, after };
    state = after;
  }
}

function isSameAssists(a: Assists, b: Assists): boolean {
  // Every field, those added after this was written included.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const [first, second] = [a, b] as unknown as Record<string, unknown>[];
  return [...keys].every((key) => first[key] === second[key]);
}

function fillKey(hint: FillHint | null): string {
  if (hint === null) return '';
  const unit =
    hint.kind === 'single' && hint.unit !== null ? `${hint.unit.kind}${hint.unit.index}` : '';
  return `${hint.kind}/${hint.index}/${hint.technique}/${unit}`;
}

function isSameHints(a: RememberedHints, b: RememberedHints | undefined): boolean {
  return (
    b !== undefined &&
    a.walkthrough === b.walkthrough &&
    (a.mistake?.value ?? 0) === (b.mistake?.value ?? 0) &&
    fillKey(a.fill) === fillKey(b.fill)
  );
}

/** Whether two games of the same puzzle are the same game, as saved: see `verifyMoveLog`. */
function isSameGame(a: GameState, b: GameState): boolean {
  if (a.autoCandidates !== b.autoCandidates || a.status !== b.status) return false;
  if (!isSameAssists(a.assists, b.assists) || a.cellHints.size !== b.cellHints.size) return false;
  for (const [index, hints] of a.cellHints)
    if (!isSameHints(hints, b.cellHints.get(index))) return false;
  return a.cells.every((cell, i) => {
    const other = b.cells[i];
    return (
      cell.value === other.value &&
      cell.notes === other.notes &&
      cell.autoRemoved === other.autoRemoved &&
      cell.mark === other.mark
    );
  });
}

/**
 * Whether replaying the log rebuilds `state` — a game of `puzzle`, such as one
 * just loaded from storage — as a save records it: every cell's value, notes,
 * auto candidate eliminations and mark, the help taken, the hints remembered,
 * the status and whether auto candidate mode is on. Selection and input mode
 * are not compared (they are not logged), nor are the undo and redo stacks (a
 * saved game has none). A truncated log stops short of the game, so it never
 * vouches for one.
 */
export function verifyMoveLog(puzzle: Puzzle, log: MoveLog, state: GameState): boolean {
  if (log.truncated) return false;
  if (state.puzzle.givens !== puzzle.givens || state.puzzle.solution !== puzzle.solution) {
    return false;
  }
  return isSameGame(replayMoves(puzzle, log), state);
}
