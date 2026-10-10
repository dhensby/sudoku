import { formatDuration, isPlayable, type DateKey, type Difficulty } from '../core';
import { dailyName } from './daily';
import type { PlaybackSource } from './dialogs/PlaybackDialog';
import { DIFFICULTY_LABEL } from './format';

/*
 * "Watch your solve": which solved games can be watched, and what the
 * playback is given (see `PlaybackDialog`) — the givens and the encoded log,
 * and words to head it, never the record itself.
 */

/** The heading of a player's own solve played back. */
export const OWN_SOLVE_TITLE = 'Your solve';

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
}

/**
 * What a solved game's playback is given: its givens and log, headed "Your
 * solve" over its tier — or the daily it was ("Daily · 13 Oct · Hard", the
 * date written from `today`) — and its time.
 */
export function ownSolveSource(game: SolvedGame, encoded: string, today: DateKey): PlaybackSource {
  const { givens, difficulty, daily, elapsedMs } = game;
  const name =
    daily === undefined || daily === null
      ? DIFFICULTY_LABEL[difficulty]
      : dailyName(daily, difficulty, today);
  return {
    givens,
    difficulty,
    log: encoded,
    title: OWN_SOLVE_TITLE,
    subtitle: `${name} · ${formatDuration(elapsedMs)}`,
  };
}
