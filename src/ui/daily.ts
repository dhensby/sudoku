import { addDays, daysBetween, type DateKey, type Difficulty } from '../core';
import { findDailyAttempts, type GameRecord } from '../storage/history';
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
import { DIFFICULTY_LABEL, formatDay, formatLongDay, joinList } from './format';

/*
 * The English the UI speaks about the daily puzzles — their names, how each
 * stands, and what a solve did for a streak — and the small reckonings from
 * the history behind it. The rules themselves (what counts towards a streak,
 * which attempt says how a daily stands) are `src/storage/streaks.ts`'s; this
 * only puts them into words for the menu, the calendar and the dialogs.
 */

/**
 * How each standing reads on its own, as the calendar's key and its day
 * panel say it. "Solved on another day" is nearly always a day caught up on
 * afterwards — or, now and then, one begun early from a friend's link sent
 * from a time zone ahead — which shows in the calendar but never in a
 * streak.
 */
export const STATUS_TEXT: Readonly<Record<DailyStatus, string>> = {
  'solved-on-the-day': 'Solved on the day',
  'solved-later': 'Solved on another day',
  'in-progress': 'In progress',
  'not-started': 'Not started',
};

/**
 * How each mark reads in the calendar's key, and Help's: as `STATUS_TEXT`,
 * but the hatched mark is any solve that does not count towards a streak —
 * one on another day, or one after watching a friend's solve of the daily
 * (see `GameRecord.watched`), whichever day it was on.
 */
export const KEY_TEXT: Readonly<Record<DailyStatus, string>> = {
  ...STATUS_TEXT,
  'solved-later': 'Solved on another day, or after watching a solve',
};

/** The same, mid-sentence, as an accessible name has it: "Hard solved on the day". */
const STATUS_WORDS: Readonly<Record<DailyStatus, string>> = {
  'solved-on-the-day': 'solved on the day',
  'solved-later': 'solved on another day',
  'in-progress': 'in progress',
  'not-started': 'not started',
};

/** A solve after watching a friend's solve of the daily, mid-sentence, as a day's name says it. */
const WATCHED_WORDS = 'solved after watching a solve';

/** The order a day's standings are told in: the order of the tiers. */
const STATUS_ORDER: readonly DailyStatus[] = [
  'solved-on-the-day',
  'solved-later',
  'in-progress',
  'not-started',
];

/** A daily's name, as the completion dialog and History give it: "Daily · 13 Oct · Hard". */
export function dailyName(date: DateKey, tier: Difficulty, today: DateKey): string {
  return `Daily · ${formatDay(date, today)} · ${DIFFICULTY_LABEL[tier]}`;
}

/**
 * A daily, mid-sentence: "today's Hard puzzle" on its own day, else "the
 * Hard daily for 12 Oct". Lower case, to sit after "Generating" or "solved".
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
 * A calendar day's accessible name: the date, then how each tier stands,
 * tiers in the same state told together — "Tuesday 13 October: Easy solved
 * on the day, Medium in progress, Hard and Expert not started". A tier with
 * no standing given has not been started. A tier in `watched` (see
 * `watchedDailies`), solved but not counted, says why: "Easy solved after
 * watching a solve" — so the name is as true as the day panel's row.
 */
export function describeDay(
  date: DateKey,
  statuses: Partial<Record<Difficulty, DailyStatus>>,
  watched: ReadonlySet<Difficulty> = new Set(),
): string {
  const wordsOf = (tier: Difficulty): string => {
    const status = statuses[tier] ?? 'not-started';
    return status === 'solved-later' && watched.has(tier) ? WATCHED_WORDS : STATUS_WORDS[status];
  };
  const groups = [...STATUS_ORDER.map((status) => STATUS_WORDS[status]), WATCHED_WORDS];
  const parts = groups
    .flatMap((words) => {
      const tiers = DIFFICULTIES.filter((tier) => wordsOf(tier) === words);
      return tiers.length === 0 ? [] : [{ words, first: DIFFICULTIES.indexOf(tiers[0]), tiers }];
    })
    .sort((a, b) => a.first - b.first)
    .map(({ words, tiers }) => `${joinList(tiers.map((tier) => DIFFICULTY_LABEL[tier]))} ${words}`);
  return `${formatLongDay(date)}: ${parts.join(', ')}`;
}

/**
 * The dailies whose day panel shows a solve after watching a friend's solve
 * (see `GameRecord.watched`), by date: those whose standing is solved but not
 * counted, and whose solve shown for it (`summariseDaily`) is a watched one.
 * A day known only from the ledger, its records pruned, cannot say why it was
 * not counted, and is told as solved on another day.
 */
export function watchedDailies(
  records: readonly GameRecord[],
  ledger: DailyLedger = EMPTY_LEDGER,
): Map<DateKey, Set<Difficulty>> {
  const byDate = new Map<DateKey, Set<Difficulty>>();
  for (const record of records) {
    const { daily, difficulty } = record;
    if (daily === undefined || record.status !== 'solved' || record.watched !== true) continue;
    if (byDate.get(daily)?.has(difficulty) === true) continue;
    const summary = summariseDaily(records, daily, difficulty, ledger);
    if (summary.status !== 'solved-later' || summary.record?.watched !== true) continue;
    byDate.set(daily, (byDate.get(daily) ?? new Set<Difficulty>()).add(difficulty));
  }
  return byDate;
}

/** A daily as its day panel shows it: how it stands, and the attempt whose time goes with that. */
export interface DailySummary {
  status: DailyStatus;
  /**
   * For a solved daily, its first solve of the best kind (on the day, if
   * any was) — the time it is remembered by; for one in progress, the
   * unfinished attempt played most recently; null for one not started, and
   * for one whose solve is known only from the ledger, its record pruned.
   */
  record: GameRecord | null;
}

/** How a daily stands, and the attempt to show with it (see `DailySummary`). */
export function summariseDaily(
  records: readonly GameRecord[],
  date: DateKey,
  tier: Difficulty,
  ledger: DailyLedger = EMPTY_LEDGER,
): DailySummary {
  const status = dailyStatus(records, date, tier, ledger);
  const attempts = findDailyAttempts(records, date, tier);
  if (status === 'not-started') return { status, record: null };
  if (status === 'in-progress') {
    // Newest first already; the one most recently played is the one to resume.
    const unfinished = attempts.filter((attempt) => attempt.status === 'playing');
    unfinished.sort((a, b) => b.updatedAt - a.updatedAt);
    return { status, record: unfinished[0] };
  }
  const wanted = status === 'solved-on-the-day';
  const solves = attempts.filter(
    (attempt) => attempt.status === 'solved' && countsTowardsStreak(attempt) === wanted,
  );
  // The oldest solve of that kind: a later one is a replay, whose time is no record.
  const first = solves.reduce<GameRecord | null>(
    (a, b) => (a === null || b.createdAt < a.createdAt ? b : a),
    null,
  );
  return { status, record: first };
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
 *     friend's link sent from a time zone ahead), so it never counts either;
 *   - `watched`: solved after watching a friend's solve of it (see
 *     `GameRecord.watched`), so it never counts, whatever day it was begun.
 */
export type StreakNote =
  | { kind: 'streak'; days: number }
  | { kind: 'started' }
  | { kind: 'counted' }
  | { kind: 'later' }
  | { kind: 'early' }
  | { kind: 'watched' };

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
  if (record.watched === true) return { kind: 'watched' };
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
