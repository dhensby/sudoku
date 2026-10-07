import { addDays, daysBetween, type DateKey, type Difficulty } from '../core';
import type { GameRecord } from '../storage/history';
import { DIFFICULTIES } from '../storage/storage';
import {
  EMPTY_LEDGER,
  computeStreak,
  countsTowardsStreak,
  dailyStatus,
  isCounted,
  isStartedEarly,
  type DailyLedger,
  type DailyStatus,
} from '../storage/streaks';
import { DIFFICULTY_LABEL, formatDay } from './format';

/*
 * The English the UI speaks about the daily puzzles — their names, how each
 * stands, and what a solve did for a streak — and the small reckonings from
 * the history behind it. The rules themselves (what counts towards a streak,
 * which attempt says how a daily stands) are `src/storage/streaks.ts`'s; this
 * only puts them into words for the menu and the dialogs.
 */

/** A daily's name, as the completion dialog and History give it: "Daily · 6 Oct · Hard". */
export function dailyName(date: DateKey, tier: Difficulty, today: DateKey): string {
  return `Daily · ${formatDay(date, today)} · ${DIFFICULTY_LABEL[tier]}`;
}

/**
 * A daily, mid-sentence: "today's Hard puzzle" on its own day, else "the
 * Hard daily for 5 Oct". Lower case, to sit after "Generating" or "solved".
 */
export function dailyPhrase(date: DateKey, tier: Difficulty, today: DateKey): string {
  const label = DIFFICULTY_LABEL[tier];
  return date === today
    ? `today's ${label} puzzle`
    : `the ${label} daily for ${formatDay(date, today)}`;
}

/**
 * How each of a day's dailies stands, whether or not it has an attempt: the
 * history's `dailyStatus` for every tier.
 */
export function statusesOn(
  records: readonly GameRecord[],
  date: DateKey,
  ledger: DailyLedger = EMPTY_LEDGER,
): Record<Difficulty, DailyStatus> {
  return Object.fromEntries(
    DIFFICULTIES.map((tier) => [tier, dailyStatus(records, date, tier, ledger)]),
  ) as Record<Difficulty, DailyStatus>;
}

/**
 * What a solved daily did for its tier's streak, as the completion dialog
 * says it:
 *   - `streak`: it counts, and the streak now runs `days` days — "Hard
 *     streak: 5 days";
 *   - `started`: it counts, and starts a streak that was not running before
 *     — "That starts a Hard streak";
 *   - `counted`: it counts, but for a day the current streak does not reach
 *     (begun on its day, finished days later) — so no count of days fits;
 *   - `later`: begun after its day, so it never counts;
 *   - `early`: begun before its day had begun for the player (from a
 *     friend's link sent from a time zone ahead), so it never counts either.
 */
export type StreakNote =
  | { kind: 'streak'; days: number }
  | { kind: 'started' }
  | { kind: 'counted' }
  | { kind: 'later' }
  | { kind: 'early' };

/**
 * The streak note for `record`, a daily just solved (see `StreakNote`).
 * `records` is the history with the solve in it, `ledger` what pruned
 * dailies said, and `today` the player's date at the moment of solving.
 */
export function streakNote(
  record: GameRecord,
  records: readonly GameRecord[],
  today: DateKey,
  ledger: DailyLedger = EMPTY_LEDGER,
): StreakNote {
  const date = record.daily;
  if (date === undefined) return { kind: 'later' };
  if (!countsTowardsStreak(record)) return { kind: isStartedEarly(record) ? 'early' : 'later' };
  const tier = record.difficulty;
  const { current } = computeStreak(records, tier, today, ledger);
  // The current streak runs back from today — or from yesterday, while
  // today's is still to play — for `current` days.
  const end = isCounted(records, today, tier, ledger) ? today : addDays(today, -1);
  const back = daysBetween(date, end);
  if (back < 0 || back >= current) return { kind: 'counted' };
  const others = records.filter((other) => other.id !== record.id);
  const isRepeat = isCounted(others, date, tier, ledger);
  return current === 1 && !isRepeat ? { kind: 'started' } : { kind: 'streak', days: current };
}
