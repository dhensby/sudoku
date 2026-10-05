import {
  STOPPED_CLOCK,
  checkGivens,
  createGame,
  deserialiseGame,
  elapsedMs,
  gridValues,
  isRunning,
  pauseClock,
  rate,
  serialiseGame,
  startClock,
  toSeconds,
  type Assists,
  type Clock,
  type Difficulty,
  type GameState,
  type GridString,
  type Puzzle,
} from '../core';
import {
  createGameId,
  findAttempts,
  hasSeen,
  loadCurrentId,
  loadGameBlob,
  loadHistory,
  saveGameBlob,
  upsertRecord,
  type Challenge,
  type GameRecord,
  type GameSource,
} from '../storage/history';
import type { StorageLike } from '../storage/storage';
import { readSharedLink } from './url';

/*
 * The game on screen as the app holds it — the board, its clock and its
 * history record travelling together — and the pure steps the main hook
 * takes with it: starting one, pausing it, saving it, reopening it, and
 * working out at startup what a visit (or a shared link) should open.
 *
 * Kept apart from the hook so each step can be tested on its own, with plain
 * storage and no React in the way.
 */

/**
 * A moment read from both of the game's clocks. Play is timed by `clock`, a
 * monotonic reading (`performance.timeOrigin + performance.now()` in the
 * browser), so setting the system clock back can neither freeze the timer
 * nor bank a shorter time. Records are dated by `wall`, epoch milliseconds
 * from `Date.now`, as dates should be. Clock readings never outlive the page
 * — a game always reopens paused, from its banked total — so the two never
 * need reconciling.
 */
export interface Moment {
  wall: number;
  clock: number;
}

/**
 * Why the clock is stopped while a game is unsolved:
 *   - `ready`: a game waiting for its Start button — a shared puzzle, one
 *     that arrived while the tab was hidden, or one reopened before it was
 *     ever started;
 *   - `user`: the pause button or P;
 *   - `hidden`: the tab was hidden;
 *   - `dialog`: a modal dialog is open — the one pause that lifts by itself;
 *   - `restored`: reopened after a reload or from a link.
 */
export type PauseReason = 'ready' | 'user' | 'hidden' | 'dialog' | 'restored';

/**
 * What the board area shows and what input does:
 *   - `loading`: a puzzle is being generated (spinner, no board);
 *   - `ready`: a shared puzzle before Start (card, no board);
 *   - `playing`: the clock runs and the board takes input;
 *   - `paused`: the clock is stopped and the board is hidden;
 *   - `solved`: the board is on show, frozen.
 */
export type Phase = 'loading' | 'ready' | 'playing' | 'paused' | 'solved';

/** The game on screen. */
export interface Session {
  /**
   * The game's history record. Its fixed fields (id, givens, source, dates,
   * challenge) are authoritative here; the status, time and assists are
   * refreshed from the game and the clock whenever it is saved.
   */
  record: GameRecord;
  game: GameState;
  clock: Clock;
  /** Why the clock is stopped, while the game is unsolved; null while it runs (and once solved). */
  pause: PauseReason | null;
  /** Solved during this visit, so the board plays its wave. A game reopened solved does not. */
  isCelebrating: boolean;
  /**
   * Whether the game has been put in front of the player — its board, or its
   * Start card. One made behind a dialog has not, and is not saved (nor
   * listed in History) until it is: a game the player never saw is not one
   * they played.
   */
  isSeen: boolean;
}

/** What saving a session did. */
export interface SaveResult {
  /** The history as it now stands. */
  records: GameRecord[];
  /** Whether the board itself was saved, and can be reopened after a reload. */
  isBoardSaved: boolean;
}

/** How a new game should begin. */
export type SessionStart =
  /** At once, clock running: a generated puzzle, a replay. */
  | 'running'
  /**
   * Behind a Start button: a shared puzzle, so both players start from the
   * same moment, or a puzzle that arrived while the tab was hidden.
   */
  | 'ready'
  /** Paused behind a dialog that is still open, resuming (and first seen) when it closes. */
  | 'dialog';

/**
 * What a share link or history entry offers to share: a puzzle, and a time to
 * beat once solved — unless the solve was a replay, whose time was set on a
 * board seen before and is no fair one to race.
 */
export interface ShareTarget {
  givens: GridString;
  difficulty: Difficulty;
  result: { seconds: number; assists: Assists } | null;
}

/** A link to a puzzle already solved: the earlier solve, and the link's result to compare. */
export interface ChallengeOffer {
  puzzle: Puzzle;
  previous: GameRecord;
  challenge: Challenge | null;
}

/** What a visit opens with. */
export interface Startup {
  /** The history as it stood at startup. */
  records: GameRecord[];
  /** The game to show, or null to generate one. */
  session: Session | null;
  /** A link to a puzzle already solved, offering a fresh attempt. */
  offer: ChallengeOffer | null;
  /** Set when a link was opened but could not be played. */
  isBadLink: boolean;
  /** Whether the address carried share parameters, which should now be tidied away. */
  isLinkConsumed: boolean;
  /** Whether `session` is new to storage (or newly current), and must be saved and made current. */
  isNewCurrent: boolean;
  /**
   * The game that was on screen, when a link's game takes its place: left
   * behind as a New game leaves one (see `isGlimpse`). Null otherwise.
   */
  left: Session | null;
}

/** The phase a session is in. `isGenerating` wins: a new puzzle is on its way. */
export function phaseOf(session: Session | null, isGenerating: boolean): Phase {
  if (session === null || isGenerating) return 'loading';
  if (session.game.status === 'solved') return 'solved';
  if (isRunning(session.clock)) return 'playing';
  return session.pause === 'ready' ? 'ready' : 'paused';
}

/**
 * Where a new attempt at `givens` comes from. A puzzle the player has seen —
 * one in the history, or whose board was on show in an attempt since deleted
 * (see `hasSeen`) — is a replay, whatever brought it back: a link, the
 * generator, Play again. They may have studied its board, so its time must
 * not count as a record (see `computeStats`).
 */
export function attemptSource(
  storage: StorageLike,
  records: readonly GameRecord[],
  givens: GridString,
  source: Exclude<GameSource, 'replay'>,
): GameSource {
  return hasSeen(storage, records, givens) ? 'replay' : source;
}

/** A fresh record for a game of `puzzle` begun at `now` (epoch ms). */
export function createRecord(
  puzzle: Puzzle,
  source: GameSource,
  now: number,
  challenge: Challenge | null,
  assists: Assists,
): GameRecord {
  return {
    id: createGameId(now),
    givens: puzzle.givens,
    difficulty: puzzle.difficulty,
    source,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    status: 'playing',
    elapsedMs: 0,
    assists: { ...assists },
    challenge,
  };
}

/** A new game of `puzzle`, with a record of its own. */
export function newSession(
  puzzle: Puzzle,
  options: {
    source: GameSource;
    challenge: Challenge | null;
    now: Moment;
    /** The "Start new games in auto candidate mode" setting. */
    autoCandidates: boolean;
    start: SessionStart;
  },
): Session {
  const { source, challenge, now, autoCandidates, start } = options;
  const game = createGame(puzzle, { autoCandidates });
  return {
    record: createRecord(puzzle, source, now.wall, challenge, game.assists),
    game,
    clock: start === 'running' ? startClock(STOPPED_CLOCK, now.clock) : STOPPED_CLOCK,
    pause: start === 'running' ? null : start,
    isCelebrating: false,
    isSeen: start !== 'dialog',
  };
}

/**
 * Stop the clock for `reason`, at the play clock's reading `clock`. A session
 * that is not running (paused already, solved, waiting to start) comes back
 * unchanged — the same object.
 */
export function pauseSession(session: Session, reason: PauseReason, clock: number): Session {
  if (!isRunning(session.clock)) return session;
  return { ...session, clock: pauseClock(session.clock, clock), pause: reason };
}

/** Start the clock again (or for the first time) at the play clock's reading `clock`: the game is on show. */
export function resumeSession(session: Session, clock: number): Session {
  return { ...session, clock: startClock(session.clock, clock), pause: null, isSeen: true };
}

/**
 * Whether the game's board has been on show, which makes its puzzle seen (see
 * `markSeen`): any later attempt at it is a replay. A game behind its Start
 * button has shown only its card, and one made behind a dialog nothing at
 * all; every other game has had its clock running, board in view.
 */
export function hasBoardShown(session: Session): boolean {
  return session.isSeen && session.pause !== 'ready';
}

/**
 * Whether a game was only glimpsed: a generated puzzle the player has done
 * nothing with — no number entered, no candidate pencilled in or struck out,
 * no help taken, nothing to undo. Leaving one for another game discards it
 * rather than keeping it, so browsing the tiers neither fills History with
 * games nobody played nor counts them as played. Its puzzle stays seen
 * (`hasBoardShown`), so seeing it again is still a replay. A shared puzzle is
 * always kept: a friend sent it, and its link may carry a time to race.
 *
 * Auto candidates are the one assist a glimpse may carry: with "Start new
 * games in auto candidate mode" on, every game begins with it, and a game the
 * player never touched is no less a glimpse for that. Switching the mode by
 * hand leaves an entry to undo (or, once undone, to redo), so that still
 * counts as doing something.
 */
export function isGlimpse(session: Session): boolean {
  const { record, game } = session;
  const { hints, checks, reveals } = game.assists;
  return (
    record.source === 'generated' &&
    game.status === 'playing' &&
    hints === 0 &&
    checks === 0 &&
    reveals === 0 &&
    game.undoStack.length === 0 &&
    game.redoStack.length === 0 &&
    game.cells.every(
      (cell) => cell.given || (cell.value === 0 && cell.notes === 0 && cell.autoRemoved === 0),
    )
  );
}

/**
 * The session's record as it should be stored at `now`: status, time and help
 * taken brought up to date. The time is stored in whole milliseconds — the
 * monotonic clock reads in fractions of one, which nothing needs.
 */
export function recordOf(session: Session, now: Moment): GameRecord {
  return {
    ...session.record,
    status: session.game.status,
    elapsedMs: Math.floor(elapsedMs(session.clock, now.clock)),
    assists: { ...session.game.assists },
    updatedAt: Math.max(now.wall, session.record.createdAt),
  };
}

/**
 * Save a session: the game itself (so it can be resumed) and its record.
 * Best-effort, like every write; the result says how far it got.
 */
export function saveSession(storage: StorageLike, session: Session, now: Moment): SaveResult {
  const isBoardSaved = saveGameBlob(storage, session.record.id, serialiseGame(session.game));
  return { records: upsertRecord(storage, recordOf(session, now)), isBoardSaved };
}

/**
 * Whether a saved game was never started: no time on its clock and nothing
 * entered on its board. It reopens behind its Start button, as it was left,
 * rather than as a game paused at 0:00.
 */
function isUnstarted(record: GameRecord, game: GameState): boolean {
  return (
    record.elapsedMs === 0 &&
    game.cells.every(
      (cell) => cell.given || (cell.value === 0 && cell.notes === 0 && cell.autoRemoved === 0),
    )
  );
}

/**
 * A record for a saved game whose record has gone missing (pruned, or lost
 * to a failed write). Its time is lost with it, but the board is not.
 */
function orphanRecord(id: string, game: GameState, now: number): GameRecord {
  return {
    id,
    givens: game.puzzle.givens,
    difficulty: game.puzzle.difficulty,
    source: 'generated',
    createdAt: now,
    updatedAt: now,
    completedAt: game.status === 'solved' ? now : null,
    status: game.status,
    elapsedMs: 0,
    assists: { ...game.assists },
    challenge: null,
  };
}

/**
 * Reopen a saved game, paused for `reason` — or behind its Start button if it
 * was never started, or, if it was solved, on show and stopped. Null when
 * there is no saved game under `id`, it does not validate, or its record
 * names a different puzzle (one of the two is corrupt, and guessing which
 * would be worse than starting afresh). `now` is the wall clock (epoch ms).
 */
export function restoreSession(
  storage: StorageLike,
  records: readonly GameRecord[],
  id: string,
  now: number,
  reason: PauseReason = 'restored',
): Session | null {
  const game = deserialiseGame(loadGameBlob(storage, id));
  if (game === null) return null;
  const found = records.find((record) => record.id === id);
  if (found !== undefined && found.givens !== game.puzzle.givens) return null;
  const record = found ?? orphanRecord(id, game, now);
  const isSolved = game.status === 'solved';
  let pause: PauseReason | null = null;
  if (!isSolved) pause = isUnstarted(record, game) ? 'ready' : reason;
  return {
    record: {
      ...record,
      status: game.status,
      assists: { ...game.assists },
      completedAt: isSolved ? (record.completedAt ?? now) : null,
    },
    game,
    clock: { bankedMs: record.elapsedMs, runningSince: null },
    pause,
    isCelebrating: false,
    // It was saved, so it was seen.
    isSeen: true,
  };
}

/** A history entry's puzzle, solved afresh from its givens; null if they no longer make a puzzle. */
export function puzzleOf(record: GameRecord): Puzzle | null {
  const check = checkGivens(record.givens);
  if (!check.ok) return null;
  return { givens: record.givens, solution: check.solution, difficulty: record.difficulty };
}

/**
 * What sharing the game on screen shares: the puzzle, plus the time once it
 * is solved — unless it was a replay, which shares the puzzle alone (see
 * `ShareTarget`).
 */
export function shareTargetOf(session: Session): ShareTarget {
  const { game, record, clock } = session;
  return {
    givens: record.givens,
    difficulty: record.difficulty,
    result:
      game.status === 'solved' && record.source !== 'replay'
        ? { seconds: toSeconds(clock.bankedMs), assists: { ...game.assists } }
        : null,
  };
}

/** What sharing a history entry shares, by the same rules. */
export function shareTargetOfRecord(record: GameRecord): ShareTarget {
  return {
    givens: record.givens,
    difficulty: record.difficulty,
    result:
      record.status === 'solved' && record.source !== 'replay'
        ? { seconds: toSeconds(record.elapsedMs), assists: { ...record.assists } }
        : null,
  };
}

/**
 * Work out what a visit opens, without writing anything (the hook makes the
 * writes once mounted, so a render React throws away leaves no trace).
 *
 * Without a link: the game that was on screen last time, paused — or shown
 * solved, or behind its Start button if it was never started — else nothing,
 * and the hook generates one.
 *
 * With a link (`?p=`), the givens are checked and the puzzle re-graded:
 * nothing in a link is trusted, not even its difficulty. Then, in order:
 *   1. an unfinished attempt at the puzzle is reopened, paused, and takes the
 *      link's challenge if it carries one;
 *   2. a solved attempt is offered as a fresh one (the ChallengeDialog),
 *      leaving the game on screen where it was. The solve it compares with
 *      is the newest that counted towards the records; a replay's, only if
 *      there is nothing else, as it was set on a board seen before;
 *   3. otherwise it becomes a new game waiting behind a Start button — a
 *      replay if the puzzle has been seen at all (an attempt whose board has
 *      been pruned, or one deleted from History).
 * A link that does not decode, or decodes to something that is not a proper
 * puzzle, is reported and otherwise ignored.
 */
export function planStartup(
  storage: StorageLike,
  search: string,
  now: Moment,
  autoCandidates: boolean,
): Startup {
  const records = loadHistory(storage);
  const currentId = loadCurrentId(storage);
  const restored =
    currentId === null ? null : restoreSession(storage, records, currentId, now.wall);
  const plain: Startup = {
    records,
    session: restored,
    offer: null,
    isBadLink: false,
    isLinkConsumed: false,
    isNewCurrent: false,
    left: null,
  };

  const link = readSharedLink(search);
  if (link === null) return plain;
  const opened: Startup = { ...plain, isLinkConsumed: true };
  const check = link.givens === null ? null : checkGivens(link.givens);
  if (link.givens === null || check === null || !check.ok) return { ...opened, isBadLink: true };

  const puzzle: Puzzle = {
    givens: link.givens,
    solution: check.solution,
    difficulty: rate(gridValues(link.givens)),
  };
  const attempts = findAttempts(records, puzzle.givens);

  for (const attempt of attempts) {
    if (attempt.status !== 'playing') continue;
    const session =
      attempt.id === restored?.record.id
        ? restored
        : restoreSession(storage, records, attempt.id, now.wall);
    // An attempt whose saved state has been pruned can only be replayed, so
    // it does not count as one to reopen.
    if (session === null || session.game.status !== 'playing') continue;
    const challenge = link.challenge ?? session.record.challenge;
    return {
      ...opened,
      session: { ...session, record: { ...session.record, challenge } },
      isNewCurrent: true,
      left: session === restored ? null : restored,
    };
  }

  const solves = attempts.filter((attempt) => attempt.status === 'solved');
  const previous = solves.find((attempt) => attempt.source !== 'replay') ?? solves[0];
  if (previous !== undefined) {
    return { ...opened, offer: { puzzle, previous, challenge: link.challenge } };
  }

  return {
    ...opened,
    session: newSession(puzzle, {
      source: attemptSource(storage, records, puzzle.givens, 'shared'),
      challenge: link.challenge,
      now,
      autoCandidates,
      start: 'ready',
    }),
    isNewCurrent: true,
    left: restored,
  };
}
