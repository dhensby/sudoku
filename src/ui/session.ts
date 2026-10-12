import {
  STOPPED_CLOCK,
  analyseMistakes,
  appendMove,
  checkGivens,
  createGame,
  createMoveLog,
  dateKeyOf,
  encodeMoveLog,
  deserialiseGame,
  elapsedMs,
  gridValues,
  isRunning,
  moveFor,
  pauseClock,
  rate,
  reduce,
  serialiseGame,
  sharedSolveRefusal,
  startClock,
  tallyMistakes,
  toSeconds,
  verifiedMoveCount,
  type Assists,
  type Clock,
  type DateKey,
  type Difficulty,
  type GameAction,
  type GameState,
  type GridString,
  type MistakeTally,
  type MoveLog,
  type Puzzle,
} from '../core';
import {
  createGameId,
  findAttempts,
  hasRecordedTime,
  hasSeen,
  hasWatched,
  loadCurrentId,
  loadGameBlob,
  loadHistory,
  recordedMistakes,
  saveGameBlob,
  saveGameMoves,
  upsertRecord,
  type Challenge,
  type GameRecord,
  type GameSource,
  type RecordedMistakes,
} from '../storage/history';
import { loadMoveLog } from '../storage/moveLogs';
import type { StorageLike } from '../storage/storage';
import { readSharedLink } from './url';

/*
 * The game on screen as the app holds it — the board, its clock, its move log
 * and its history record travelling together — and the pure steps the main
 * hook takes with it: starting one, making a move in it, pausing it, saving
 * it, reopening it, and working out at startup what a visit (or a shared
 * link) should open.
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
  /**
   * Every move made in the game, with its time on the play clock (see
   * `src/core/moves.ts`), kept up by `advance`; null when the game is not
   * being recorded. A game is recorded from its first moment or not at all —
   * never from part-way, which would make a partial log that reads as a
   * whole one — so this is null for a game begun before logs were kept, one
   * whose saved log no longer matches its board (a tab still on an older
   * version played on without logging), one whose saved log this version
   * cannot read (a newer version's, left in storage for it), and one past
   * `MAX_MOVES`.
   */
  moves: MoveLog | null;
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
 * board seen before and is no fair one to race, or a solve after watching a
 * friend's, which has no time at all — and with the time, the solve itself,
 * for the sharer to include if they choose.
 */
export interface ShareTarget {
  givens: GridString;
  difficulty: Difficulty;
  /**
   * The time to beat, with its help and its mistakes — the mistakes only as
   * the solved record has them (`recordedMistakes`), and null when it has
   * none to tell, which a link then says nothing of.
   */
  result: { seconds: number; assists: Assists; mistakes: MistakeTally | null } | null;
  /** The date of the daily the puzzle is, if it was played as one: the link and message name it. */
  daily: DateKey | null;
  /**
   * The solve that goes with the result, as its encoded move log, which the
   * sharer may put in the link for a friend to watch: only one this build
   * plays back to the solve at the result's time (see `sharedSolveRefusal`),
   * and null without a result, or without such a log.
   */
  solve: string | null;
}

/**
 * A puzzle already solved, offered again: the earlier solve, and a link's
 * result to compare (from a link), or the daily it is (a solved daily chosen
 * from the New game menu, or a link to one).
 */
export interface ChallengeOffer {
  puzzle: Puzzle;
  previous: GameRecord;
  challenge: Challenge | null;
  /** The date of the daily the puzzle is, if it is one; a fresh attempt is recorded as that daily. */
  daily?: DateKey;
}

/**
 * A link's claim that its puzzle is a date's daily (`&d=`), still to be
 * checked against that date's dailies (which is asynchronous: a daily may
 * have to be dealt first). `tier` is the tier the puzzle grades as, the
 * daily most worth checking first.
 */
export interface DailyHint {
  date: DateKey;
  givens: GridString;
  tier: Difficulty;
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
  /** A link's claim to be a daily, for the hook to check once mounted; null without one. */
  dailyHint: DailyHint | null;
  /**
   * The link carried a solve that a newer version of the game recorded, which
   * this one cannot play back: the player is told, rather than left
   * wondering why there is nothing to watch.
   */
  isSolveTooNew: boolean;
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

/**
 * A fresh record for a game of `puzzle` created at `now` (epoch ms) — an
 * attempt at the daily of date `daily`, if one is given, `isStarted` (its
 * clock running from now) or not yet.
 */
export function createRecord(
  puzzle: Puzzle,
  source: GameSource,
  now: number,
  challenge: Challenge | null,
  assists: Assists,
  daily?: DateKey,
  isStarted = true,
  isWatched = false,
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
    // Left off for every other game, as the history stores it (see `GameRecord.daily`).
    ...(daily === undefined ? {} : { daily }),
    ...(daily !== undefined && isStarted ? { startedOn: dateKeyOf(now) } : {}),
    ...(isWatched ? { watched: true as const } : {}),
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
    /**
     * The "Check guesses when entered" setting: on, a game that starts at
     * once has it from its first moment, and its log says so. Default off. A
     * game that starts later than it is made — behind Start or a dialog —
     * takes it up only as its clock first starts (see `resumeSession`), so a
     * player who switches it off before then plays, and is recorded, without
     * it: the help is sticky, and none was given.
     */
    checkGuesses?: boolean;
    start: SessionStart;
    /** The date of the daily this is an attempt at, if it is one; `puzzle` carries its tier. */
    daily?: DateKey;
    /**
     * A shared solve of the puzzle was watched before the player solved it
     * (see `hasWatched`): this attempt is recorded without a time. The
     * history flags it as it is written anyway; this has the game on screen
     * know it from the start.
     */
    isWatched?: boolean;
  },
): Session {
  const {
    source,
    challenge,
    now,
    autoCandidates,
    checkGuesses = false,
    start,
    daily,
    isWatched = false,
  } = options;
  const game = createGame(puzzle, { autoCandidates });
  const session: Session = {
    record: createRecord(
      puzzle,
      source,
      now.wall,
      challenge,
      game.assists,
      daily,
      start === 'running',
      isWatched,
    ),
    game,
    clock: start === 'running' ? startClock(STOPPED_CLOCK, now.clock) : STOPPED_CLOCK,
    moves: createMoveLog({ autoCandidates: game.autoCandidates }),
    pause: start === 'running' ? null : start,
    isCelebrating: false,
    isSeen: start !== 'dialog',
  };
  if (!checkGuesses || start !== 'running') return session;
  // At 0:00 on the play clock, which starts now.
  const checked = followCheckGuesses(session, true, now.clock);
  return { ...checked, record: { ...checked.record, assists: { ...checked.game.assists } } };
}

/**
 * A record as an attempt at the daily of `date` and `tier` — see `asDaily`.
 * One already `isStarted` is dated as started on the day it was created, by
 * this device's clock, as near as anything now knows (an attempt is tagged
 * within moments of being opened); one not yet started is dated when it is
 * (see `resumeSession`).
 */
export function tagDaily(
  record: GameRecord,
  date: DateKey,
  tier: Difficulty,
  isStarted: boolean,
): GameRecord {
  const startedOn = record.startedOn ?? (isStarted ? dateKeyOf(record.createdAt) : undefined);
  return {
    ...record,
    daily: date,
    difficulty: tier,
    ...(startedOn === undefined ? {} : { startedOn }),
  };
}

/**
 * The session as an attempt at the daily of `date` and `tier`: a game whose
 * puzzle turns out to be that daily — a link's, once its date hint checks
 * out, or an attempt at the puzzle begun before it was opened as the daily.
 * The tier is the daily's own, which an archived daily's puzzle may not
 * grade as today.
 */
export function asDaily(session: Session, date: DateKey, tier: Difficulty): Session {
  if (session.record.daily === date && session.record.difficulty === tier) return session;
  return { ...session, record: tagDaily(session.record, date, tier, hasBoardShown(session)) };
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

/**
 * Make a move: `action` through the reducer, and the move it makes (see
 * `moveFor`) added to the log at the time on the play clock at `clock`, its
 * monotonic reading now. The one way the game on screen changes, so that the
 * log can never miss a move — and the reading is required, so that no move is
 * ever logged at a time made up for it.
 *
 * Comes back unchanged — the same object — when the action changed nothing
 * and logged nothing. A log that reaches `MAX_MOVES` stops being kept (see
 * `moves`): cut off, it would no longer reach the game.
 */
export function advance(session: Session, action: GameAction, clock: number): Session {
  const game = reduce(session.game, action);
  const log = session.moves;
  const move = log === null ? null : moveFor(session.game, action, game);
  if (log === null || move === null) return game === session.game ? session : { ...session, game };
  const moves = appendMove(log, move, elapsedMs(session.clock, clock));
  return { ...session, game, moves: moves.truncated ? null : moves };
}

/**
 * The session with "Check guesses when entered" switched to `enabled` — the
 * setting as it now stands — logged at the play clock's reading `clock`. The
 * same session when the game already has it so, or is solved (switching it
 * then changes nothing).
 *
 * The setting is the player's, and follows them from game to game: switched
 * in Settings, it takes effect in the game on screen as Settings closes; a
 * game reopened takes it up as it starts again. Switching it on records the
 * help from that moment, and never judges the numbers already entered.
 */
export function followCheckGuesses(session: Session, enabled: boolean, clock: number): Session {
  return advance(session, { type: 'setCheckGuesses', enabled }, clock);
}

/**
 * Start the clock again (or for the first time) at `now`: the game is on
 * show. A daily attempt started for the first time is dated now, by the
 * player's own clock — the date its streak is judged by (see
 * `GameRecord.startedOn`), so one opened from a link the evening before its
 * day, and started on the day, counts like any other.
 *
 * Every way back into play comes through here, so here the game takes up the
 * "Check guesses when entered" setting as it now stands (`checkGuesses`, see
 * `followCheckGuesses`) — at the time on the clock before it starts again,
 * while no move can have been made.
 */
export function resumeSession(session: Session, now: Moment, checkGuesses: boolean): Session {
  const synced = followCheckGuesses(session, checkGuesses, now.clock);
  const { record } = synced;
  const isUndated = record.daily !== undefined && record.startedOn === undefined;
  // One that has run before without its date written down (saved by an
  // earlier version of the game) is dated as tagging dates it.
  const startedOn = hasBoardShown(synced) ? dateKeyOf(record.createdAt) : dateKeyOf(now.wall);
  return {
    ...synced,
    record: isUndated ? { ...record, startedOn } : record,
    clock: startClock(synced.clock, now.clock),
    pause: null,
    isSeen: true,
  };
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
 * Auto candidates and Check guesses are the assists a glimpse may carry:
 * with "Start new games in auto candidate mode" or "Check guesses when
 * entered" on, every game begins with it, and a game the player never
 * touched is no less a glimpse for that — with nothing entered, no guess was
 * checked. Switching auto candidates by hand leaves an entry to undo (or,
 * once undone, to redo), so that still counts as doing something.
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
 * The session's record as it should be stored at `now`: status, time, help
 * taken and mistakes brought up to date (see `mistakesOf`). The time is
 * stored in whole milliseconds — the monotonic clock reads in fractions of
 * one, which nothing needs.
 */
export function recordOf(session: Session, now: Moment): GameRecord {
  return recordAt(session, Math.floor(elapsedMs(session.clock, now.clock)), now.wall);
}

/** `recordOf`, at a time on the play clock already read (whole ms) and a wall time. */
function recordAt(session: Session, elapsed: number, wall: number): GameRecord {
  const mistakes = mistakesOf(session, elapsed);
  const record: GameRecord = {
    ...session.record,
    status: session.game.status,
    elapsedMs: elapsed,
    assists: { ...session.game.assists },
    updatedAt: Math.max(wall, session.record.createdAt),
  };
  if (mistakes === null) delete record.mistakes;
  else record.mistakes = mistakes;
  return record;
}

/**
 * The game's mistakes at play time `elapsed`, stamped with it (see
 * `RecordedMistakes`), or null when they are not known.
 *
 * Counted from the move log, so they are known only for a game recorded move
 * by move (see `Session.moves`) — a count for any other would leave out
 * whatever happened before or beyond its log. Never lower than the count the
 * record came with, and frozen at the solve: a game reopened solved keeps the
 * count it was solved with, whatever a later version would make of its log.
 * Counted at every save, though only a solved game's count is ever shown; the
 * analysis behind it is worked out once per log (see `analyseMistakes`).
 */
function mistakesOf(session: Session, elapsed: number): RecordedMistakes | null {
  const { record, game, moves } = session;
  const stored = record.mistakes;
  const isFrozen =
    record.status === 'solved' &&
    stored !== undefined &&
    stored.atMs === record.elapsedMs &&
    elapsed === record.elapsedMs;
  if (isFrozen) return stored;
  if (moves === null) return null;
  const tally = tallyMistakes(analyseMistakes(game.puzzle, moves), elapsed);
  return {
    values: Math.max(tally.values, stored?.values ?? 0),
    candidates: Math.max(tally.candidates, stored?.candidates ?? 0),
    atMs: elapsed,
  };
}

/**
 * The game's mistakes so far, as the error counter shows them: those that
 * have settled by play time `elapsed` (see `tallyMistakes`) — or by the last
 * move, if the time on show is behind it (the display reads the clock once a
 * second, and a mistake that counts the moment it is made, with Check
 * guesses on, must show with the move). With Check guesses off a mistake
 * waits out its window first, so the counter never moves while a slip can
 * still be put right: a count that moved at once would be a free Check.
 *
 * Null when they are not known: a game not recorded move by move (see
 * `Session.moves`), unless it was solved with a count recorded.
 */
export function mistakesSoFar(session: Session, elapsed: number): MistakeTally | null {
  const { game, moves, record } = session;
  if (moves === null) return game.status === 'solved' ? recordedMistakes(record) : null;
  const at = Math.max(elapsed, moves.moves.at(-1)?.at ?? 0);
  return tallyMistakes(analyseMistakes(game.puzzle, moves), at);
}

/**
 * Save a session: its move log, the game itself (so it can be resumed), then
 * its record. Best-effort, like every write; the result says how far it got.
 *
 * The log goes first, and is written only when it has changed since it was
 * last saved (see `saveMoveLog`). First, so that it is never behind the board
 * saved beside it: a board refused for space, or lost to a crash before it is
 * written, leaves the log a few moves ahead, which reopening the game trims
 * back to the board (see `restoreSession`); a log behind the board could only
 * be thrown away. A log that cannot be written takes its old one with it, for
 * the same reason. A game not being recorded has any log it had deleted, as
 * one that no longer matches the game (bar a newer build's, which that build
 * judges).
 *
 * Only a new game's very first save writes its log before its record exists,
 * which the sweep for logs without a record allows for (see `sweepMoveLogs`).
 */
export function saveSession(storage: StorageLike, session: Session, now: Moment): SaveResult {
  const { id } = session.record;
  saveGameMoves(storage, id, session.moves);
  const isBoardSaved = saveGameBlob(storage, id, serialiseGame(session.game));
  return { records: upsertRecord(storage, recordOf(session, now)), isBoardSaved };
}

/**
 * Whether a saved game was never started: no time on its clock (`elapsed`)
 * and nothing entered on its board. It reopens behind its Start button, as it
 * was left, rather than as a game paused at 0:00.
 */
function isUnstarted(elapsed: number, game: GameState): boolean {
  return (
    elapsed === 0 &&
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
 *
 * Its move log is kept only if it replays to exactly the board saved — the
 * whole log, or, when the board was saved a few moves behind it (see
 * `saveSession`), the moves up to that board, which make the whole log of the
 * game as saved (see `verifiedMoveCount`). Otherwise — none saved, as for a
 * game begun before logs were kept, or one that does not decode, or one a tab
 * still on an older version left behind as it played on — the game is not
 * recorded from here on (see `Session.moves`). The clock takes up from the
 * record's time, or from the log's last move kept if that is later: the log
 * is written before the record, and a crash or a refused write between the
 * two must not lose the player time they played — nor give them time to
 * think for free.
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
  const log = loadMoveLog(storage, id);
  const count = log === null ? null : verifiedMoveCount(game.puzzle, log, game);
  let moves: MoveLog | null = null;
  if (log !== null && count !== null) {
    moves = count === log.moves.length ? log : { ...log, moves: log.moves.slice(0, count) };
  }
  const bankedMs = Math.max(record.elapsedMs, moves?.moves.at(-1)?.at ?? 0);
  const isSolved = game.status === 'solved';
  let pause: PauseReason | null = null;
  if (!isSolved) pause = isUnstarted(bankedMs, game) ? 'ready' : reason;
  return {
    record: {
      ...record,
      status: game.status,
      assists: { ...game.assists },
      completedAt: isSolved ? (record.completedAt ?? now) : null,
    },
    game,
    clock: { bankedMs, runningSince: null },
    moves,
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
 * The solve that may go in a link with a result of `seconds`: the encoded log,
 * if it plays back to the solve of `givens` at that time — what the friend
 * who opens the link will check it against (see `sharedSolveRefusal`), so a
 * solve is never sent that would be ignored — else null.
 */
function sharedSolveOf(givens: GridString, encoded: string | null, seconds: number): string | null {
  if (encoded === null) return null;
  // As the link will carry the time (see `buildShareUrl`).
  return sharedSolveRefusal(givens, encoded, Math.max(1, seconds)) === null ? encoded : null;
}

/**
 * What sharing the game on screen shares: the puzzle, plus the time once it
 * is solved — unless it was a replay, or solved after watching a shared
 * solve, which share the puzzle alone (see `ShareTarget`) — and its solve,
 * from its own log, for the player to include if they like.
 *
 * Its mistakes are the record's as saving it would leave it (see
 * `recordOf`): the session's own record is not kept up with them between
 * saves, and a solved game's clock has stopped, so the record saved at the
 * solve and this one agree.
 */
export function shareTargetOf(session: Session): ShareTarget {
  const { game, record, clock, moves } = session;
  const isRaceable =
    game.status === 'solved' && record.source !== 'replay' && record.watched !== true;
  const seconds = toSeconds(clock.bankedMs);
  return {
    givens: record.givens,
    difficulty: record.difficulty,
    result: isRaceable
      ? {
          seconds,
          assists: { ...game.assists },
          mistakes: recordedMistakes(
            recordAt(session, Math.floor(clock.bankedMs), record.updatedAt),
          ),
        }
      : null,
    daily: record.daily ?? null,
    solve:
      isRaceable && moves !== null
        ? sharedSolveOf(record.givens, encodeMoveLog(moves), seconds)
        : null,
  };
}

/**
 * What sharing a history entry shares, by the same rules — its mistakes as
 * `recordedMistakes` reads them, so only a count stamped at the solve goes in
 * a link — with its solve from `encoded`, its stored log, if it has one.
 */
export function shareTargetOfRecord(record: GameRecord, encoded: string | null): ShareTarget {
  const isRaceable = hasRecordedTime(record) && record.source !== 'replay';
  const seconds = toSeconds(record.elapsedMs);
  return {
    givens: record.givens,
    difficulty: record.difficulty,
    result: isRaceable
      ? {
          seconds,
          assists: { ...record.assists },
          mistakes: recordedMistakes(record),
        }
      : null,
    daily: record.daily ?? null,
    solve: isRaceable ? sharedSolveOf(record.givens, encoded, seconds) : null,
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
 *
 * A link's daily date (`&d=`) is passed on as a hint for the hook to check
 * (`dailyHint`): until it has, the puzzle is opened as any shared puzzle is.
 *
 * A link's solve (`&s=`) goes with its challenge only if it plays back to the
 * solve of this puzzle at the time the link claims (see
 * `sharedSolveRefusal`). Any other is dropped without a word — the link
 * opens as it would have without it — but for one a newer version recorded,
 * which `isSolveTooNew` has the player told of.
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
    dailyHint: null,
    isSolveTooNew: false,
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
  // `readSharedLink` only reads a solve alongside a challenge.
  const refusal =
    link.solve === null
      ? 'none'
      : sharedSolveRefusal(puzzle.givens, link.solve, link.challenge!.seconds);
  const challenge: Challenge | null =
    refusal === null ? { ...link.challenge!, log: link.solve! } : link.challenge;
  const linked: Startup = {
    ...opened,
    dailyHint:
      link.daily === null
        ? null
        : { date: link.daily, givens: puzzle.givens, tier: puzzle.difficulty },
    isSolveTooNew: refusal === 'newer',
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
    const racing = challenge ?? session.record.challenge;
    return {
      ...linked,
      session: { ...session, record: { ...session.record, challenge: racing } },
      isNewCurrent: true,
      left: session === restored ? null : restored,
    };
  }

  const solves = attempts.filter((attempt) => attempt.status === 'solved');
  const previous =
    solves.find((attempt) => attempt.source !== 'replay' && hasRecordedTime(attempt)) ?? solves[0];
  if (previous !== undefined) {
    return { ...linked, offer: { puzzle, previous, challenge } };
  }

  return {
    ...linked,
    session: newSession(puzzle, {
      source: attemptSource(storage, records, puzzle.givens, 'shared'),
      challenge,
      now,
      autoCandidates,
      start: 'ready',
      isWatched: hasWatched(storage, puzzle.givens),
    }),
    isNewCurrent: true,
    left: restored,
  };
}
