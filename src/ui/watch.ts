import {
  formatDuration,
  isPlayable,
  type DateKey,
  type Difficulty,
  type GridString,
} from '../core';
import type { Challenge } from '../storage/history';
import { dailyName } from './daily';
import type { PlaybackSource } from './dialogs/PlaybackDialog';
import { DIFFICULTY_LABEL } from './format';

/*
 * "Watch your solve", and a friend's: which solves can be watched, and what
 * the playback is given (see `PlaybackDialog`) — the givens and the encoded
 * log, and words to head it, never the record itself.
 */

/** The heading of a player's own solve played back. */
export const OWN_SOLVE_TITLE = 'Your solve';

/**
 * What the Solved dialog says of a solve after watching a friend's (see
 * `GameRecord.watched`), in place of its time — and the status region with a
 * full stop. Says why, so the missing time never reads as a fault.
 */
export const WATCHED_SOLVE_TEXT =
  'Solved — no time recorded: you watched a solve of this puzzle first';

/** What History says of such a solve, where it would give the time. */
export const WATCHED_RECORD_TEXT = 'Solved after watching a solve';

/** Whose solve a friend's is, as a possessive: "Dan's", or "Your friend's" for a link with no name. */
export function friendsSolve(name: string | null): string {
  return name === null ? "Your friend's solve" : `${name}'s solve`;
}

/** The button that plays a friend's solve: "Watch Dan's solve", "Watch your friend's solve". */
export function watchFriendLabel(name: string | null): string {
  return `Watch ${name === null ? "your friend's solve" : `${name}'s solve`}`;
}

/**
 * The most answers `isWatchable` keeps. Each is a log's worth of key (some
 * 200–1,100 characters), so a full history's worth is a megabyte at worst;
 * past this it starts again rather than growing.
 */
const MAX_REMEMBERED = 1200;

/**
 * Whether each log was found to play back, by givens and log. History asks
 * for every solved row it builds, each time it opens, and the answer for a
 * given log never changes: replaying it once a visit is enough.
 */
const remembered = new Map<string, boolean>();

/**
 * Whether a solved game's log can be watched: it decodes under this build's
 * format and rules, and replays to the solve (`isPlayable`). Remembered by
 * givens and log, so asking again — each time History opens — costs nothing.
 */
export function isWatchable(givens: string, encoded: string | null): boolean {
  if (encoded === null) return false;
  const key = `${givens}:${encoded}`;
  const known = remembered.get(key);
  if (known !== undefined) return known;
  if (remembered.size >= MAX_REMEMBERED) remembered.clear();
  const answer = isPlayable(givens, encoded);
  remembered.set(key, answer);
  return answer;
}

/** A solved game, as its playback is headed: a history record, or the game just solved. */
export interface SolvedGame {
  givens: string;
  difficulty: Difficulty;
  /** The daily it was, if it was one. */
  daily?: DateKey | null;
  /** Its time. */
  elapsedMs: number;
  /**
   * Whether it was solved after watching a friend's solve (see
   * `GameRecord.watched`): recorded without a time, so none is shown.
   */
  watched?: boolean;
}

/** A friend's solve to watch, from the link their challenge came in (see `Challenge.log`). */
export interface FriendSolve {
  givens: GridString;
  difficulty: Difficulty;
  /** The daily the puzzle is, if it is one. */
  daily: DateKey | null;
  /** Their challenge: the name, and the time the solve agrees with. */
  challenge: Challenge;
  /** Their solve, as its encoded move log — the challenge's own, known to be there. */
  log: string;
}

/**
 * What a friend's solve's playback is given: their log, headed with whose it
 * is ("Dan's solve", the name to be isolated as it is drawn) over the
 * puzzle's tier, or its daily, and their time.
 */
export function friendSolveSource(solve: FriendSolve, today: DateKey): PlaybackSource {
  const { givens, difficulty, daily, challenge, log } = solve;
  const name = daily === null ? DIFFICULTY_LABEL[difficulty] : dailyName(daily, difficulty, today);
  return {
    givens,
    difficulty,
    log,
    title: friendsSolve(challenge.name),
    ...(challenge.name === null ? {} : { name: challenge.name }),
    subtitle: `${name} · ${formatDuration(challenge.seconds * 1000)}`,
  };
}

/**
 * What a solved game's playback is given: its givens and log, headed "Your
 * solve" over its tier — or the daily it was ("Daily · 13 Oct · Hard", the
 * date written from `today`) — and its time. A solve after watching a
 * friend's has no recorded time, and its heading gives none either, as the
 * Solved dialog and History give none.
 */
export function ownSolveSource(game: SolvedGame, encoded: string, today: DateKey): PlaybackSource {
  const { givens, difficulty, daily, elapsedMs, watched = false } = game;
  const name =
    daily === undefined || daily === null
      ? DIFFICULTY_LABEL[difficulty]
      : dailyName(daily, difficulty, today);
  return {
    givens,
    difficulty,
    log: encoded,
    title: OWN_SOLVE_TITLE,
    subtitle: watched ? name : `${name} · ${formatDuration(elapsedMs)}`,
  };
}
