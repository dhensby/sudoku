import { isBoardFull, type GameState, type UndoEntry } from './game';
import { ALL_DIGITS, BOX, COL, PEERS, ROW, UNITS, bit } from './grid';
import { replayMoveSteps, type LoggedMove, type MoveLog } from './moves';
import type { Digit, Puzzle } from './types';

/*
 * Mistakes: the wrong numbers a game entered, and the answers it struck out
 * of its candidates — judged against the puzzle's solution, from the move log
 * alone, so that the count is the same live, saved and reloaded, and can be
 * worked out again from a log long after the board has gone.
 *
 * Nothing here is shown while a game is played (a count that moved as you
 * played would work as a free Check), and nothing here touches times, best
 * times or who wins a race: a mistake is told next to the time, never taken
 * off it.
 *
 * Two kinds, counted apart:
 *
 *   - A VALUE mistake is a wrong digit coming to stand in a cell: placed,
 *     typed over another digit, or brought back by Undo or Redo. Each cell and
 *     digit counts once a game, however often it comes back.
 *   - A CANDIDATE mistake is striking a cell's answer out of its candidates:
 *     a note of the player's own switched off, or, in auto candidate mode, the
 *     answer struck while it is on show — by a candidate-mode entry, or a Redo
 *     of one. Each cell counts once a game. Pencilling a wrong note, never
 *     pencilling the answer at all, the second Erase wiping a cell's notes,
 *     "clear it from the peers' notes" stripping them, auto candidates hidden
 *     by a wrong number nearby, and Undo of a note added are none of them a
 *     candidate mistake: none is a candidate-mode act of striking the answer.
 *
 * A finger slips, so not every wrong entry counts. Each one — every wrong
 * digit coming to stand, and every strike, the same one made again included —
 * opens a WINDOW of its own, which settles at the first of:
 *
 *   - `GRACE_MS` of play time after it went in (the log's time, so a pause
 *     never uses up the window, nor stretches it);
 *   - any change to another cell: a move whose own cell is another — never
 *     what one move does to cells beside its own, such as clearing a digit
 *     from the peers' notes. Undo or Redo acts on the cell of the change it
 *     takes back or puts back, so undoing the slip itself is not "elsewhere".
 *     Switching auto candidates (or undoing that) changes every cell's
 *     candidates, so it is elsewhere for every cell;
 *   - any help: Check (a cell or the puzzle), Hint, Show me (opened again for
 *     free included — it is help seen) and Reveal;
 *   - Reset;
 *   - the board becoming full (or solved): a move that fills its last empty
 *     cell. "The board is full, but something isn't right" is news about the
 *     numbers on it, so a slip must not wait for it: that would let a player
 *     fill the last cell wrongly, read the notice and undo in time. A board
 *     that was full already tells nothing new — the notice came when it
 *     filled — so a slip on it, while the player hunts for what is wrong,
 *     has its window like any other.
 *
 * As it settles it is COUNTED unless FORGIVEN. With "Check guesses when
 * entered" on (`MistakeOptions.checkGuesses` — a later version's setting,
 * which marks a wrong number the moment it goes in) nothing waits: every
 * mistake counts at once. With it off, a value mistake is forgiven only if
 *
 *   (a) the cell's answer was OBVIOUS when the wrong digit went in: the cell
 *       held its answer just before (a solved cell overwritten by tapping the
 *       wrong square), or the answer was a single on the placed numbers — the
 *       only digit left for the cell, or the only place left for it in the
 *       cell's row, column or box (see `isObviousAnswer`); never judged from
 *       notes, which may be wrong; and
 *   (b) the cell held its answer again before the window settled — typed
 *       over, Undo to it, or Erase or Undo and then typed — and nothing else
 *       changed in between, which the window's closing on any other change
 *       already sees to.
 *
 * A wrong digit in a cell whose answer was not obvious is counted however
 * fast it is put right: that was no slip of the finger. A candidate mistake
 * needs no obvious answer: it is forgiven when the answer is back (the note
 * pencilled in again, the strike taken back, or the answer placed) before its
 * window settles.
 *
 * Put right is for good: a digit typed over the answer afterwards is a mistake
 * of its own, with a window of its own and judged afresh — the very digit the
 * first window was about included, whose first window has then been decided
 * (and settles at once, `again`). The same digit back BEFORE it was put right
 * shares the earlier window, which closes first and so decides for both:
 * forgiven only if put right in time and obvious both times it went in. Reset
 * never forgives: it empties the cell, which is not putting it right (a slip
 * put right before the Reset is still forgiven). At the solve every window still open settles:
 * a solved board has put every slip right.
 *
 * Counts only ever go up: a mistake counted stays counted, and a tally at a
 * later play time is never lower (`tallyMistakes`).
 */

/** How long a slip has to be put right, in ms of play time. */
export const GRACE_MS = 3000;

/** A wrong digit entered (`value`), or an answer struck from the candidates (`candidate`). */
export type MistakeKind = 'value' | 'candidate';

/** Whether a mistake counts: not yet known, counted, or forgiven as a slip put right. */
export type MistakeOutcome = 'pending' | 'counted' | 'forgiven';

/**
 * What settled a mistake's window (see the module comment): its time running
 * out, a change to another cell, help, a Reset, the board becoming full or
 * solved, the same mistake made again after this one was put right (`again`:
 * put right is for good, so its outcome was already decided, and the new one
 * needs a window of its own) — or nothing, for one counted the moment it went
 * in because "Check guesses when entered" was on.
 */
export type MistakeCloser =
  'time' | 'elsewhere' | 'help' | 'reset' | 'full' | 'solved' | 'again' | 'entered';

/**
 * Why a mistake came out as it did: counted because Check guesses was on, or
 * because the answer was not obvious (a value mistake only), or because it was
 * not put right in time; forgiven because it was; or still waiting.
 */
export type MistakeReason = 'checkGuesses' | 'notObvious' | 'notPutRight' | 'putRight' | 'waiting';

/** One mistake: a wrong digit, or an answer struck, and how it came out. */
export interface MistakeEvent {
  readonly kind: MistakeKind;
  /** The cell, 0–80. */
  readonly cell: number;
  /** For a value mistake, the wrong digit; for a candidate mistake, the answer struck. */
  readonly digit: Digit;
  /** The move that made it: its position in the log, from 0. */
  readonly move: number;
  /** When it was made, on the play clock (ms). */
  readonly at: number;
  /** When its window runs out if nothing settles it sooner: `at + GRACE_MS`. */
  readonly deadline: number;
  /**
   * For a value mistake, whether the cell's answer was obvious as it went in
   * (see `isObviousAnswer`) — every time it went in while the window was open,
   * if it came back before it was put right; null for a candidate mistake,
   * which needs none.
   */
  readonly isObvious: boolean | null;
  /** Whether it had been put right by the end of the log (or by the time it settled). */
  readonly isPutRight: boolean;
  /** As of the end of the log; a pending one settles at `deadline` if the log goes no further. */
  readonly outcome: MistakeOutcome;
  /** When it settled, on the play clock; null while pending. */
  readonly settledAt: number | null;
  readonly settledBy: MistakeCloser | null;
  readonly why: MistakeReason;
}

/** Every mistake a log holds, in the order they were made. */
export interface MistakeAnalysis {
  readonly events: readonly MistakeEvent[];
}

/** How many mistakes of each kind count. */
export interface MistakeTally {
  /** Wrong numbers ("mistakes"). */
  readonly values: number;
  /** Answers struck from the candidates ("candidate mistakes"). */
  readonly candidates: number;
}

export interface MistakeOptions {
  /**
   * "Check guesses when entered" — a later version's setting, which marks a
   * wrong number as it goes in. With it on, every mistake counts at once and
   * nothing is forgiven. Default false.
   */
  readonly checkGuesses?: boolean;
}

/** A tally of nothing. */
export const NO_MISTAKES: MistakeTally = Object.freeze({ values: 0, candidates: 0 });

/** A mistake still being worked out: a `MistakeEvent` while its window is open. */
interface Draft {
  kind: MistakeKind;
  cell: number;
  digit: Digit;
  move: number;
  at: number;
  deadline: number;
  isObvious: boolean | null;
  isPutRight: boolean;
  outcome: MistakeOutcome;
  settledAt: number | null;
  settledBy: MistakeCloser | null;
  why: MistakeReason;
}

/**
 * What a move acts on, for deciding which windows it closes: help, a Reset,
 * the whole board (auto candidates switched), one cell — or nothing, for an
 * Undo or Redo with nothing to take back or put back. Play never logs one
 * (only moves that changed something are logged), but a log read from
 * storage or a link may hold one, and judging it must not fail.
 */
type Scope =
  | { readonly kind: 'help' | 'reset' | 'board' | 'none' }
  | { readonly kind: 'cell'; readonly cell: number };

const HELP: Scope = { kind: 'help' };
const RESET: Scope = { kind: 'reset' };
const BOARD: Scope = { kind: 'board' };
const NONE: Scope = { kind: 'none' };

/** The closer each kind of scope is, to a window it closes (one acting on nothing closes none). */
const CLOSER_OF: Readonly<Record<Exclude<Scope['kind'], 'none'>, MistakeCloser>> = {
  help: 'help',
  reset: 'reset',
  board: 'elsewhere',
  cell: 'elsewhere',
};

function answerOf(puzzle: Puzzle, cell: number): Digit {
  return (puzzle.solution.charCodeAt(cell) - 48) as Digit;
}

/** The digits no placed peer rules out, from `values`. */
function candidatesAt(values: Uint8Array, cell: number): number {
  let seen = 0;
  for (const peer of PEERS[cell]) if (values[peer] !== 0) seen |= bit(values[peer]);
  return ALL_DIGITS & ~seen;
}

/**
 * Whether the answer to `cell` is obvious on `state`'s board — what a
 * forgiven slip needs (see the module comment): the cell already holds its
 * answer, or the answer is a single on the placed numbers, the cell itself
 * taken as empty. A single is a naked one (the only digit no placed peer
 * rules out) or a hidden one (the only place left for the digit in the cell's
 * row, column or box). Notes are never consulted: they are the player's, and
 * may be wrong.
 */
export function isObviousAnswer(state: GameState, cell: number): boolean {
  const answer = answerOf(state.puzzle, cell);
  if (state.cells[cell].value === answer) return true;
  const values = new Uint8Array(81);
  for (let i = 0; i < 81; i++) values[i] = state.cells[i].value;
  values[cell] = 0;
  const mask = bit(answer);
  const candidates = candidatesAt(values, cell);
  // A wrong number among the peers can rule the answer out; then nothing on
  // the board points at it.
  if ((candidates & mask) === 0) return false;
  if (candidates === mask) return true;
  // Every cell of the cell's houses is its peer, so none holds the answer:
  // the answer's places are the empty cells it is still a candidate of.
  return [UNITS[ROW[cell]], UNITS[9 + COL[cell]], UNITS[18 + BOX[cell]]].some((unit) =>
    unit.every(
      (other) =>
        other === cell || values[other] !== 0 || (candidatesAt(values, other) & mask) === 0,
    ),
  );
}

/** The undo entry an Undo took back or a Redo put back: none if there was nothing to. */
function entryOf(move: LoggedMove, before: GameState): UndoEntry | undefined {
  return (move.op === 'undo' ? before.undoStack : before.redoStack).at(-1);
}

/** What a move acts on (see `Scope`). */
function scopeOf(move: LoggedMove, before: GameState): Scope {
  switch (move.op) {
    case 'place':
    case 'candidate':
    case 'erase':
      return { kind: 'cell', cell: move.cell };
    case 'undo':
    case 'redo': {
      const entry = entryOf(move, before);
      if (entry === undefined) return NONE;
      return entry.autoCandidates === undefined ? { kind: 'cell', cell: entry.focus } : BOARD;
    }
    case 'autoOn':
    case 'autoOff':
      return BOARD;
    case 'reset':
      return RESET;
    case 'hint':
    case 'walkthrough':
    case 'checkCell':
    case 'checkPuzzle':
    case 'reveal':
      return HELP;
  }
}

/**
 * Whether the move struck `cell`'s answer from its candidates: a note of the
 * player's own on → off, or the answer struck in auto candidate mode
 * (`autoRemoved` off → on). Asked only of a candidate-mode entry, or a Redo
 * of one; the reducer only ever strikes a candidate that is on show, and a
 * Redo of a strike runs in the mode the strike was made in (switching the
 * mode clears the Redo history), so the auto strike is always one on show.
 */
function isAnswerStruck(before: GameState, after: GameState, cell: number, answer: Digit): boolean {
  const mask = bit(answer);
  const was = before.cells[cell];
  const now = after.cells[cell];
  const isNoteStruck = (was.notes & mask) !== 0 && (now.notes & mask) === 0;
  const isAutoStruck = (was.autoRemoved & mask) === 0 && (now.autoRemoved & mask) !== 0;
  return isNoteStruck || isAutoStruck;
}

/** Whether a struck answer is back in `cell`'s candidates (or placed), on `state`. */
function isAnswerBack(state: GameState, cell: number, answer: Digit): boolean {
  const { value, notes, autoRemoved } = state.cells[cell];
  if (value === answer) return true;
  const mask = bit(answer);
  return state.autoCandidates ? (autoRemoved & mask) === 0 : (notes & mask) !== 0;
}

function keyOf(kind: MistakeKind, cell: number, digit: number): string {
  return kind === 'value' ? `v${cell}/${digit}` : `c${cell}`;
}

/** Whether a mistake can be forgiven at all once put right: a value mistake needs an obvious answer. */
function isForgivable(event: Pick<MistakeEvent, 'isObvious'>): boolean {
  return event.isObvious !== false;
}

const analyses = new WeakMap<
  MoveLog,
  { solution: string; checkGuesses: boolean; analysis: MistakeAnalysis }
>();

/**
 * Every mistake in a game's log (see the module comment), each with how it
 * came out by the end of the log. Memoised per log object — a log is never
 * changed in place, only replaced by a longer one — so the many saves and
 * renders of one moment cost one replay.
 */
export function analyseMistakes(
  puzzle: Puzzle,
  log: MoveLog,
  options: MistakeOptions = {},
): MistakeAnalysis {
  const checkGuesses = options.checkGuesses ?? false;
  const cached = analyses.get(log);
  if (cached?.solution === puzzle.solution && cached.checkGuesses === checkGuesses) {
    return cached.analysis;
  }
  const analysis = analyse(puzzle, log, checkGuesses);
  analyses.set(log, { solution: puzzle.solution, checkGuesses, analysis });
  return analysis;
}

function analyse(puzzle: Puzzle, log: MoveLog, checkGuesses: boolean): MistakeAnalysis {
  const drafts: Draft[] = [];
  let open: Draft[] = [];
  // Mistakes counted, by cell and digit (value) or cell (candidate): each
  // counts once a game. One forgiven never took its place, so the same slip
  // made again later is judged afresh.
  const counted = new Set<string>();
  // The undo entries of candidate-mode moves, followed through Undo and Redo
  // by identity (the reducer keeps it as entries move between the stacks), so
  // that a Redo of a strike is a strike again — and nothing else is.
  const candidateEntries = new Set<UndoEntry>();

  const settle = (draft: Draft, at: number, closer: MistakeCloser): void => {
    const isForgiven = draft.isPutRight && isForgivable(draft);
    draft.outcome = isForgiven ? 'forgiven' : 'counted';
    draft.settledAt = at;
    draft.settledBy = closer;
    if (isForgiven) draft.why = 'putRight';
    else draft.why = isForgivable(draft) ? 'notPutRight' : 'notObvious';
    if (!isForgiven) counted.add(keyOf(draft.kind, draft.cell, draft.digit));
  };

  const settleOpen = (
    shouldSettle: (draft: Draft) => boolean,
    at: number | null,
    closer: MistakeCloser,
  ) => {
    open = open.filter((draft) => {
      if (!shouldSettle(draft)) return true;
      settle(draft, at ?? draft.deadline, closer);
      return false;
    });
  };

  /**
   * Open a window for a mistake just made — unless it has counted already, or
   * it is back before an open window for it was put right.
   */
  const make = (
    draft: Omit<Draft, 'deadline' | 'isPutRight' | 'outcome' | 'settledAt' | 'settledBy' | 'why'>,
  ) => {
    const key = keyOf(draft.kind, draft.cell, draft.digit);
    if (counted.has(key)) return;
    const already = open.find((other) => keyOf(other.kind, other.cell, other.digit) === key);
    if (already !== undefined) {
      if (!already.isPutRight) {
        // Back before it was put right: both windows now need the same fix,
        // and the earlier one closes first, so it decides for both — forgiven
        // only if the answer was obvious each time the digit went in. (Only a
        // value mistake can be back unfixed: a struck answer must be back in
        // the candidates, which puts it right, before it can be struck again.)
        if (draft.isObvious === false) already.isObvious = false;
        return;
      }
      // Put right is for good, so the earlier window is decided: settle it
      // now, and give this one a window (and an obviousness) of its own —
      // unless the earlier one has just counted for the cell and digit.
      open = open.filter((other) => other !== already);
      settle(already, draft.at, 'again');
      if (counted.has(key)) return;
    }
    const made: Draft = {
      ...draft,
      deadline: draft.at + GRACE_MS,
      isPutRight: false,
      outcome: 'pending',
      settledAt: null,
      settledBy: null,
      why: 'waiting',
    };
    drafts.push(made);
    if (checkGuesses) {
      made.outcome = 'counted';
      made.settledAt = made.at;
      made.settledBy = 'entered';
      made.why = 'checkGuesses';
      counted.add(key);
    } else {
      open.push(made);
    }
  };

  for (const { index, move, before, after } of replayMoveSteps(puzzle, log)) {
    const { at } = move;
    // Windows that ran out before this move, settled as they stood.
    settleOpen((draft) => at >= draft.deadline, null, 'time');
    // Windows this move closes: help, Reset, and any change to another cell.
    const scope = scopeOf(move, before);
    if (scope.kind !== 'none') {
      settleOpen(
        (draft) => scope.kind !== 'cell' || scope.cell !== draft.cell,
        at,
        CLOSER_OF[scope.kind],
      );
    }

    // Wrong digits come to stand.
    if (after.cells !== before.cells) {
      for (let cell = 0; cell < 81; cell++) {
        const value = after.cells[cell].value;
        if (value === before.cells[cell].value || value === 0) continue;
        if (value === answerOf(puzzle, cell)) continue;
        make({
          kind: 'value',
          cell,
          digit: value as Digit,
          move: index,
          at,
          isObvious: isObviousAnswer(before, cell),
        });
      }
    }

    // An answer struck from the candidates, by a candidate-mode entry or a
    // Redo of one.
    let struck: number | null = null;
    if (move.op === 'candidate') {
      // The entry it made — if it made one: a log from elsewhere may hold an
      // entry that changed nothing, which the reducer leaves as it was.
      if (after.undoStack !== before.undoStack) candidateEntries.add(after.undoStack.at(-1)!);
      struck = move.cell;
    } else if (move.op === 'undo' || move.op === 'redo') {
      const entry = entryOf(move, before);
      if (entry !== undefined && candidateEntries.has(entry)) {
        const moved = (move.op === 'undo' ? after.redoStack : after.undoStack).at(-1)!;
        candidateEntries.add(moved);
        if (move.op === 'redo') struck = entry.focus;
      }
    }
    if (struck !== null && isAnswerStruck(before, after, struck, answerOf(puzzle, struck))) {
      make({
        kind: 'candidate',
        cell: struck,
        digit: answerOf(puzzle, struck),
        move: index,
        at,
        isObvious: null,
      });
    }

    // Put right, for good: the answer in the cell, or back in its candidates.
    // (The same mistake made again afterwards is a new one — see `make`.)
    for (const draft of open) {
      const answer = answerOf(puzzle, draft.cell);
      const isRight =
        draft.kind === 'value'
          ? after.cells[draft.cell].value === answer
          : isAnswerBack(after, draft.cell, answer);
      if (isRight) draft.isPutRight = true;
    }

    // The board becoming full (or solved) settles everything still open, as
    // it is after the move. One full already says nothing new.
    if (after.status === 'solved' || (isBoardFull(after) && !isBoardFull(before))) {
      settleOpen(() => true, at, after.status === 'solved' ? 'solved' : 'full');
    }
  }

  return { events: drafts.map((draft): MistakeEvent => ({ ...draft })) };
}

/**
 * How a mistake stood at play time `atMs`: null if it had not been made yet,
 * pending while its window was open, else counted or forgiven. One still
 * pending at the end of its log settles at its deadline as it then stood.
 */
export function mistakeOutcomeAt(event: MistakeEvent, atMs: number): MistakeOutcome | null {
  if (event.at > atMs) return null;
  if (event.settledAt !== null) return event.settledAt <= atMs ? event.outcome : 'pending';
  if (event.deadline > atMs) return 'pending';
  return event.isPutRight && isForgivable(event) ? 'forgiven' : 'counted';
}

/**
 * The mistakes that count at play time `atMs` (ms), by kind. Never lower at a
 * later time, nor for a longer log of the same game: a window closes at its
 * deadline, not after it, and a move is logged at its time rounded down to a
 * whole tick, as every deadline is — so a move made after this tally was
 * taken can never be logged in time to change what it counted.
 */
export function tallyMistakes(analysis: MistakeAnalysis, atMs: number): MistakeTally {
  let values = 0;
  let candidates = 0;
  for (const event of analysis.events) {
    if (mistakeOutcomeAt(event, atMs) !== 'counted') continue;
    if (event.kind === 'value') values++;
    else candidates++;
  }
  return { values, candidates };
}
