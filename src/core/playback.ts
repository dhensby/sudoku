import { checkGivens } from './codec';
import type { GameState } from './game';
import { bit } from './grid';
import { analyseMistakes, type MistakeEvent } from './mistakes';
import {
  MOVE_LOG_FORMAT,
  MOVES_VERSION,
  decodeMoveLog,
  readMoveLogHeader,
  replayMoveSteps,
  type LoggedMove,
  type MoveLog,
} from './moves';
import type { Difficulty, Digit, Puzzle } from './types';

/*
 * Playback: a solved game shown again move by move, from nothing but its
 * givens and its move log (see `moves.ts`) — never the player's record or
 * saved board, which a friend watching a shared solve would not have, and
 * which a finished game loses once it is off screen anyway.
 *
 * Everything a player sees while watching is worked out here, once, as the
 * playback is prepared: the game after every move (the reducer replays the
 * log, so the candidates, marks and help are exactly as they were), the cell
 * each move acted on, what a candidate move did (pencilled, struck, a value cleared), the
 * mistakes each move made and how they came out (`mistakes.ts`), and the
 * marks along the scrubber. The words are the UI's (`src/ui/playbackText.ts`):
 * the engine speaks no English.
 *
 * Positions run from 0, the givens before any move, to the number of moves,
 * the solve: position k shows the game after the k-th move, with that move as
 * the one on show.
 *
 * Time. Each move is shown after the pause the player took before it, so a
 * playback has the rhythm of the solve — but a long think would leave the
 * viewer watching a board that does nothing, so a pause is shortened to at
 * most `LONGEST_PAUSE_MS` (at 1×), and a burst of moves within one tick of
 * the log is spread to `SHORTEST_PAUSE_MS` apart, so that each still shows.
 * The play clock shown beside the board is always the real one: the time the
 * player had taken when they made the move on show.
 *
 * Offered only for a log this build can replay — its own format and rules
 * version — and only one that replays to the solve and ends there: a playback
 * is of a solved game, whose board shows nothing a viewer can still use to
 * their advantage in that game, and a game ends at its solve, so moves logged
 * after it (which play never logs, but a log from a link could hold) would
 * only be captioned as moves that changed nothing. A log it refuses says why (`PlaybackRefusal`), so that one
 * from an older or a newer build can be told from one that is broken.
 *
 * The cursor (where the playback is, whether it is playing and how fast) is a
 * plain value moved by `steer`, so that the UI's hook only has to keep it and
 * wait out `pauseBefore`.
 */

/** The speeds a playback can run at, as multiples of the solve's own pace. */
export const PLAYBACK_SPEEDS = [1, 2, 4, 8] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** The longest a playback waits before a move at 1×: a long think, shortened. */
export const LONGEST_PAUSE_MS = 1500;

/** The shortest it waits at 1×, so that moves made within one tick each still show. */
export const SHORTEST_PAUSE_MS = 150;

/**
 * Why a log cannot be played back:
 *   - `puzzle`: the givens make no puzzle with one solution;
 *   - `older`: recorded under an older version's rules, which this build no
 *     longer replays;
 *   - `newer`: written by a newer build, in a format, rules version or kind
 *     of move this one does not know;
 *   - `broken`: not a move log at all, one cut short or garbled, or one
 *     that goes on after the solve;
 *   - `unsolved`: a log this build reads, which does not end in the solve
 *     (or was cut off at `MAX_MOVES`, so never reaches it).
 */
export type PlaybackRefusal = 'puzzle' | 'older' | 'newer' | 'broken' | 'unsolved';

/**
 * What a candidate move did to its digit among the cell's candidates — the
 * player's notes, or in auto mode the computed candidates they struck out:
 * pencilled it in (or brought it back), struck it out, or left it as it was
 * (in auto mode a digit a peer rules out is not on show to strike, so an
 * entry on a filled cell only clears its value).
 */
export type CandidateEffect = 'pencilled' | 'struck' | 'unchanged';

/** A candidate move, with what the log leaves implicit (see `MoveChange`). */
export type CandidateChange = Extract<LoggedMove, { readonly op: 'candidate' }> & {
  readonly effect: CandidateEffect;
  /** The value the entry cleared first, on a filled cell; null on an empty one. */
  readonly cleared: Digit | null;
};

/**
 * What a move did, for its caption: its move — and, for a candidate move,
 * what the log leaves implicit: what it did to the digit's candidate and the
 * value it cleared, worked out from the game before and after it (as
 * `mistakes.ts` judges a struck answer), not from what was on show, which a
 * filled cell has none of.
 */
export type MoveChange = Exclude<LoggedMove, { readonly op: 'candidate' }> | CandidateChange;

/** One move of a playback, and the game after it. */
export interface PlaybackFrame {
  /** The move's position in the log, from 0 (so it is shown at position `index + 1`). */
  readonly index: number;
  /** The move, with what it did to a candidate (see `MoveChange`). */
  readonly change: MoveChange;
  /** The game just after the move. */
  readonly state: GameState;
  /**
   * The cell the move acted on, outlined while it is on show: where a digit
   * or note went, the cell erased, checked, revealed or hinted at, the cell
   * Show me solved, the cell an Undo or Redo changed. Null for a move about
   * no one cell — checking the puzzle, switching a setting or auto
   * candidates (which change every cell), Reset, a hint off the grid, an
   * Undo of a change to every cell.
   */
  readonly cell: number | null;
  /** The mistakes this move made (see `mistakes.ts`), each as it came out by the solve. */
  readonly mistakes: readonly MistakeEvent[];
}

/** A mark along the scrubber: a counted mistake, a slip forgiven, or help taken. */
export type PlaybackTickKind = 'mistake' | 'slip' | 'help';

export interface PlaybackTick {
  /** The position the mark is at: the move that made it is on show there. */
  readonly position: number;
  readonly kind: PlaybackTickKind;
}

/** A game ready to play back. */
export interface Playback {
  readonly puzzle: Puzzle;
  readonly log: MoveLog;
  /** The game before any move: the givens (and auto candidates, if the game began with them). */
  readonly start: GameState;
  /** Every move, in order: position k shows `frames[k - 1]`. */
  readonly frames: readonly PlaybackFrame[];
  /** The marks along the scrubber, in order of position, at most one of each kind per position. */
  readonly ticks: readonly PlaybackTick[];
}

export type PreparedPlayback =
  | { readonly ok: true; readonly playback: Playback }
  | { readonly ok: false; readonly reason: PlaybackRefusal };

/** The moves that are help: each puts a mark on the scrubber. */
const HELP_OPS: ReadonlySet<LoggedMove['op']> = new Set([
  'hint',
  'walkthrough',
  'checkCell',
  'checkPuzzle',
  'reveal',
]);

/**
 * Why `decodeMoveLog` refused a log, read from its header (see
 * `readMoveLogHeader`). A log in this build's own versions whose check holds
 * but which still does not decode holds a kind of move added since (a new
 * move takes an unused code, with no new version), so it is a newer build's.
 */
function refusalOf(encoded: unknown): PlaybackRefusal {
  const header = readMoveLogHeader(encoded);
  if (header === null) return 'broken';
  if (header.format > MOVE_LOG_FORMAT || header.rules === null) return 'newer';
  return header.rules < MOVES_VERSION ? 'older' : 'newer';
}

/**
 * The cell an Undo or Redo changes: the one the change it takes back or puts
 * back was made in (its `focus`), or null for a change to every cell — auto
 * candidates switched — or for nothing to take back.
 */
function undoneCell(before: GameState, op: 'undo' | 'redo'): number | null {
  const entry = (op === 'undo' ? before.undoStack : before.redoStack).at(-1);
  if (entry === undefined || entry.autoCandidates !== undefined) return null;
  return entry.focus;
}

/** The cell a move acted on, as `PlaybackFrame.cell` describes it. */
function cellOf(move: LoggedMove, before: GameState): number | null {
  switch (move.op) {
    case 'place':
    case 'candidate':
    case 'erase':
    case 'walkthrough':
    case 'checkCell':
    case 'reveal':
      return move.cell;
    case 'hint':
      return move.hint.index >= 0 ? move.hint.index : null;
    case 'undo':
    case 'redo':
      return undoneCell(before, move.op);
    default:
      // Check the puzzle, Reset, auto candidates and Check guesses switched.
      return null;
  }
}

/**
 * The move with what it did (see `MoveChange`): for a candidate move, whether
 * the digit left the cell's candidates (a note turned off, or a computed
 * candidate struck out) or joined them, and the value it cleared.
 */
function changeOf(move: LoggedMove, before: GameState, after: GameState): MoveChange {
  if (move.op !== 'candidate') return move;
  const mask = bit(move.digit);
  const was = before.cells[move.cell];
  const now = after.cells[move.cell];
  const gone = (was.notes & ~now.notes) | (now.autoRemoved & ~was.autoRemoved);
  const joined = (now.notes & ~was.notes) | (was.autoRemoved & ~now.autoRemoved);
  const effect: CandidateEffect =
    (gone & mask) !== 0 ? 'struck' : (joined & mask) !== 0 ? 'pencilled' : 'unchanged';
  const cleared = was.value !== 0 && now.value === 0 ? (was.value as Digit) : null;
  return { ...move, effect, cleared };
}

/** The scrubber's marks: each counted mistake and forgiven slip, and each move of help. */
function ticksOf(frames: readonly PlaybackFrame[]): PlaybackTick[] {
  const ticks: PlaybackTick[] = [];
  for (const frame of frames) {
    const position = frame.index + 1;
    const kinds = new Set<PlaybackTickKind>();
    for (const mistake of frame.mistakes) {
      // Solved, every window has settled: nothing is still pending.
      kinds.add(mistake.outcome === 'counted' ? 'mistake' : 'slip');
    }
    if (HELP_OPS.has(frame.change.op)) kinds.add('help');
    for (const kind of ['mistake', 'slip', 'help'] as const) {
      if (kinds.has(kind)) ticks.push({ position, kind });
    }
  }
  return ticks;
}

/**
 * A game ready to play back from its givens and its encoded move log — or
 * why it cannot be (see `PlaybackRefusal`). Needs nothing the player has
 * stored: the solution is worked out from the givens, so a log that came in a
 * link plays back just as one from the player's own history does. The
 * difficulty is only carried, as the puzzle's.
 */
export function preparePlayback(
  givens: string,
  difficulty: Difficulty,
  encoded: unknown,
): PreparedPlayback {
  const check = checkGivens(givens);
  if (!check.ok) return { ok: false, reason: 'puzzle' };
  const log = decodeMoveLog(encoded);
  if (log === null) return { ok: false, reason: refusalOf(encoded) };
  if (log.truncated || log.moves.length === 0) return { ok: false, reason: 'unsolved' };
  const puzzle: Puzzle = { givens, solution: check.solution, difficulty };

  const { events } = analyseMistakes(puzzle, log);
  const byMove = new Map<number, MistakeEvent[]>();
  for (const event of events) byMove.set(event.move, [...(byMove.get(event.move) ?? []), event]);
  let start: GameState | null = null;
  const frames: PlaybackFrame[] = [];
  for (const { index, move, before, after } of replayMoveSteps(puzzle, log)) {
    start ??= before;
    frames.push({
      index,
      change: changeOf(move, before, after),
      state: after,
      cell: cellOf(move, before),
      mistakes: byMove.get(index) ?? [],
    });
  }
  const solvedAt = frames.findIndex((frame) => frame.state.status === 'solved');
  if (solvedAt === -1) return { ok: false, reason: 'unsolved' };
  if (solvedAt !== frames.length - 1) return { ok: false, reason: 'broken' };
  // A log of one or more moves has a first step, and so a start.
  return { ok: true, playback: { puzzle, log, start: start!, frames, ticks: ticksOf(frames) } };
}

/**
 * Whether a log would play back (`preparePlayback` succeeds) — answered for
 * less: it replays the log without keeping each step or judging its
 * mistakes, as it is asked for every solved game a list shows, stopping at
 * the solve, which must be its last move.
 */
export function isPlayable(givens: string, encoded: unknown): boolean {
  return playableLog(givens, encoded).ok;
}

/**
 * The log, decoded, if it would play back (as `isPlayable` asks) — or why
 * not, as `preparePlayback` would say it, but for one that goes on after the
 * solve, which reads here as one that does not end in it (`unsolved`).
 */
function playableLog(
  givens: string,
  encoded: unknown,
): { ok: true; log: MoveLog } | { ok: false; reason: PlaybackRefusal } {
  const check = checkGivens(givens);
  if (!check.ok) return { ok: false, reason: 'puzzle' };
  const log = decodeMoveLog(encoded);
  if (log === null) return { ok: false, reason: refusalOf(encoded) };
  if (log.truncated || log.moves.length === 0) return { ok: false, reason: 'unsolved' };
  // The tier decides nothing a replay does.
  const puzzle: Puzzle = { givens, solution: check.solution, difficulty: 'easy' };
  for (const { index, after } of replayMoveSteps(puzzle, log)) {
    if (after.status !== 'solved') continue;
    return index === log.moves.length - 1 ? { ok: true, log } : { ok: false, reason: 'unsolved' };
  }
  return { ok: false, reason: 'unsolved' };
}

/**
 * The longest log a share link carries (see `sharedSolveRefusal`): some
 * 4,000 characters, three or four times a solve that pencils in every
 * candidate. Past that a link is long enough for a chat app to cut it short,
 * and a link cut short opens nothing at all — so a solve that long is not
 * offered, and one in a link is not taken.
 */
export const MAX_SHARED_LOG_LENGTH = 4000;

/**
 * How far the play time at a shared solve's last move may be from the time
 * its link claims, in ms. A link's time is the solve's in whole seconds,
 * rounded down, and the solving move is logged a moment before the clock
 * stops, rounded down to a tenth: so the two are always within a second.
 */
export const SHARED_TIME_SLACK_MS = 1000;

/**
 * Why a solve that came in a link is not offered to watch: any reason a
 * playback is refused (see `PlaybackRefusal`); `long`, a log longer than any
 * link is sent with (`MAX_SHARED_LOG_LENGTH`); or `time`, a log whose solve
 * came at another time from the one the link claims.
 */
export type SharedSolveRefusal = PlaybackRefusal | 'long' | 'time';

/**
 * Whether a solve from a link (or about to go in one) can be watched with the
 * time it comes with, `seconds` (as a link carries it: whole seconds, at
 * least 1) — null if so, or why not (see `SharedSolveRefusal`).
 *
 * Its log must play back to the solve of these givens, exactly as one of the
 * player's own must (see `isPlayable`): a log of some other puzzle, or one
 * from an older or a newer build, is no solve of this one to show. And the
 * time at its last move must agree with the link's (see
 * `SHARED_TIME_SLACK_MS`), so a link cannot pair one solve with another's
 * time — a fast time, say, and the log of someone's slow but clean solve.
 */
export function sharedSolveRefusal(
  givens: string,
  encoded: unknown,
  seconds: number,
): SharedSolveRefusal | null {
  if (typeof encoded === 'string' && encoded.length > MAX_SHARED_LOG_LENGTH) return 'long';
  const playable = playableLog(givens, encoded);
  if (!playable.ok) return playable.reason;
  // A playable log has a last move: the solve.
  const solvedAt = playable.log.moves.at(-1)!.at;
  return Math.abs(solvedAt - seconds * 1000) <= SHARED_TIME_SLACK_MS ? null : 'time';
}

/** The number of moves: the last position, the solve. */
export function lengthOf(playback: Playback): number {
  return playback.frames.length;
}

/** `position` brought within the playback: from 0 to its length, a whole number. */
export function clampPosition(playback: Playback, position: number): number {
  if (Number.isNaN(position)) return 0;
  return Math.min(Math.max(Math.round(position), 0), lengthOf(playback));
}

/** The game on show at `position`: the givens at 0, else the game after that many moves. */
export function stateAt(playback: Playback, position: number): GameState {
  const at = clampPosition(playback, position);
  return at === 0 ? playback.start : playback.frames[at - 1].state;
}

/** The move on show at `position`: null at 0, before any move. */
export function frameAt(playback: Playback, position: number): PlaybackFrame | null {
  const at = clampPosition(playback, position);
  return at === 0 ? null : playback.frames[at - 1];
}

/**
 * The real play time at `position`, in ms: when the player made the move on
 * show, by the play clock (which stops while paused); 0 at the start.
 */
export function playTimeAt(playback: Playback, position: number): number {
  return frameAt(playback, position)?.change.at ?? 0;
}

/**
 * How long a playback at `speed` waits before showing `position` (the move
 * after the one on show), in ms: the player's own pause before that move,
 * kept between `SHORTEST_PAUSE_MS` and `LONGEST_PAUSE_MS`, divided by the
 * speed. Infinity past the end: there is nothing more to show.
 */
export function pauseBefore(playback: Playback, position: number, speed: PlaybackSpeed): number {
  if (position < 1 || position > lengthOf(playback)) return Number.POSITIVE_INFINITY;
  const gap = playTimeAt(playback, position) - playTimeAt(playback, position - 1);
  return Math.min(Math.max(gap, SHORTEST_PAUSE_MS), LONGEST_PAUSE_MS) / speed;
}

/** Where a tick sits along the scrubber, from 0 (the start) to 1 (the solve). */
export function tickFraction(playback: Playback, tick: PlaybackTick): number {
  return tick.position / lengthOf(playback);
}

/** Where a playback is, whether it is playing, and how fast. */
export interface PlaybackCursor {
  readonly position: number;
  readonly isPlaying: boolean;
  readonly speed: PlaybackSpeed;
}

/**
 * What moves the cursor:
 *   - `play`, `pause` and `toggle`; playing from the solve starts again;
 *   - `step` a move back or forward, and `start` and `end`, all of which
 *     pause, as the viewer has taken over;
 *   - `seek` to a position (the scrubber), which keeps playing if it was,
 *     unless it lands on the solve;
 *   - `speed`;
 *   - `advance`: the pause before the next move is over, so show it — and
 *     stop at the solve.
 */
export type PlaybackCommand =
  | { readonly type: 'play' | 'pause' | 'toggle' | 'start' | 'end' | 'advance' }
  | { readonly type: 'step'; readonly by: -1 | 1 }
  | { readonly type: 'seek'; readonly position: number }
  | { readonly type: 'speed'; readonly speed: PlaybackSpeed };

/** The cursor a playback opens with: at the start, paused, at 1×. */
export const INITIAL_CURSOR: PlaybackCursor = Object.freeze({
  position: 0,
  isPlaying: false,
  speed: 1,
});

/** The cursor after `command`, within `playback`. */
export function steer(
  playback: Playback,
  cursor: PlaybackCursor,
  command: PlaybackCommand,
): PlaybackCursor {
  const length = lengthOf(playback);
  const at = (position: number, isPlaying: boolean): PlaybackCursor => {
    const clamped = clampPosition(playback, position);
    return { ...cursor, position: clamped, isPlaying: isPlaying && clamped < length };
  };
  switch (command.type) {
    case 'play':
      return at(cursor.position >= length ? 0 : cursor.position, true);
    case 'pause':
      return { ...cursor, isPlaying: false };
    case 'toggle':
      return steer(playback, cursor, { type: cursor.isPlaying ? 'pause' : 'play' });
    case 'step':
      return at(cursor.position + command.by, false);
    case 'start':
      return at(0, false);
    case 'end':
      return at(length, false);
    case 'seek':
      return at(command.position, cursor.isPlaying);
    case 'advance':
      return cursor.isPlaying ? at(cursor.position + 1, true) : cursor;
    case 'speed':
      return { ...cursor, speed: command.speed };
  }
}
