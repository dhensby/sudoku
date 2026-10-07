import { addDays, dateKeyOf, daysBetween, type DateKey, type Difficulty } from '../core';
import type { GameRecord } from './history';
import { DIFFICULTIES } from './storage';

/*
 * Daily streaks and how each daily stands, worked out from the history.
 *
 * A streak is kept per tier, and only by playing each day's daily on that
 * day: a date counts for a tier if a daily attempt at that date and tier was
 * solved and had been *started* on that date, by the player's own clock.
 * Started, not finished, so a daily begun at 23:50 and solved at 00:10 still
 * counts for the day it was begun; but catching up on a past day never does,
 * however soon after. It is still recorded — as solved on another day.
 *
 * The date an attempt was started is the one the device wrote down at the
 * time (`GameRecord.startedOn`), never worked out again later from the
 * moment it began: read in another time zone — after a flight east, or in a
 * browser a history was imported into — the same moment can fall on another
 * date, and a streak must not vanish, nor its days turn into catching up,
 * because the player travelled.
 *
 * The history keeps only its newest MAX_RECORDS games, so a daily's own
 * record can be pruned long before a best streak stops mattering. What a
 * pruned daily said is kept in the ledger (`DailyLedger`, stored by
 * `history.ts`), which every reckoning here reads with the records.
 *
 * "Today" is always passed in, never read from the clock here: the page works
 * it out when the menu opens, so a tab left open overnight moves on to the
 * new day, and the tests pin it.
 */

/** A tier's streak, in days. */
export interface Streak {
  /**
   * The run of counted days ending today — or ending yesterday while today's
   * daily is still unsolved, since the streak lives until the day is over.
   * 0 once a day has been missed.
   */
  current: number;
  /** The longest run there has ever been, the current one included. */
  best: number;
}

/**
 * How a daily stands, for its mark — best first: solved on its
 * own day, solved but begun on another (a later one, catching up; or, from a
 * friend's link a time zone ahead, an earlier one), begun but not solved, or
 * not begun.
 */
export type DailyStatus = 'solved-on-the-day' | 'solved-later' | 'in-progress' | 'not-started';

/** How a solved daily stands: what the ledger keeps of it. */
export type SolvedStatus = Extract<DailyStatus, 'solved-on-the-day' | 'solved-later'>;

/**
 * What the dailies of pruned records said, by date and tier: only solves, as
 * an unfinished game whose record is gone cannot be resumed anyway. Never
 * pruned itself — some 20 bytes a day — so streaks and the marks outlast the
 * records they came from.
 */
export type DailyLedger = ReadonlyMap<DateKey, Partial<Record<Difficulty, SolvedStatus>>>;

/** A ledger with nothing in it: no daily record has been pruned. */
export const EMPTY_LEDGER: DailyLedger = new Map();

const STATUS_RANK: Readonly<Record<DailyStatus, number>> = {
  'solved-on-the-day': 3,
  'solved-later': 2,
  'in-progress': 1,
  'not-started': 0,
};

/**
 * The player's own date when a daily attempt was started: the one written
 * down then (see the module comment). A record from before that was written
 * down falls back on the date its creation falls on here.
 */
export function startedOnOf(record: GameRecord): DateKey {
  return record.startedOn ?? dateKeyOf(record.createdAt);
}

/** Whether a record is a daily attempt begun on the daily's own date, by the player's clock. */
export function isStartedOnTheDay(record: GameRecord): boolean {
  return record.daily !== undefined && startedOnOf(record) === record.daily;
}

/**
 * Whether a record is a daily attempt begun before the daily's own date had
 * begun for the player — from a friend's link, sent from a time zone where it
 * already had. Like catching up, it never counts towards a streak.
 */
export function isStartedEarly(record: GameRecord): boolean {
  return record.daily !== undefined && daysBetween(startedOnOf(record), record.daily) > 0;
}

/** Whether a record makes its date count towards its tier's streak: a daily, begun on its date, and solved. */
export function countsTowardsStreak(record: GameRecord): boolean {
  return record.status === 'solved' && isStartedOnTheDay(record);
}

/** How one daily attempt stands on its own (see `DailyStatus`). */
function statusOf(record: GameRecord): DailyStatus {
  if (record.status !== 'solved') return 'in-progress';
  return isStartedOnTheDay(record) ? 'solved-on-the-day' : 'solved-later';
}

/** The better of two standings. */
function better<T extends DailyStatus>(a: T, b: T | undefined): T {
  return b !== undefined && STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

/** How a daily stands, from all its attempts and the ledger: the best any of them got to. */
export function dailyStatus(
  records: readonly GameRecord[],
  date: DateKey,
  tier: Difficulty,
  ledger: DailyLedger = EMPTY_LEDGER,
): DailyStatus {
  let best: DailyStatus = better('not-started', ledger.get(date)?.[tier]);
  for (const record of records) {
    if (record.daily === date && record.difficulty === tier) best = better(best, statusOf(record));
  }
  return best;
}

/**
 * The ledger with the solved dailies among `records` written into it, each
 * date and tier keeping the better standing — what `history.ts` does with
 * the records it prunes. A new ledger, or the same one if nothing changed.
 */
export function addToLedger(ledger: DailyLedger, records: readonly GameRecord[]): DailyLedger {
  let next: Map<DateKey, Partial<Record<Difficulty, SolvedStatus>>> | null = null;
  for (const record of records) {
    if (record.daily === undefined || record.status !== 'solved') continue;
    const status = statusOf(record) as SolvedStatus;
    const held = (next ?? ledger).get(record.daily);
    if (better(status, held?.[record.difficulty]) === held?.[record.difficulty]) continue;
    next ??= new Map(ledger);
    next.set(record.daily, { ...held, [record.difficulty]: status });
  }
  return next ?? ledger;
}

/** Two ledgers as one, each date and tier keeping the better standing (an import's, with this one). */
export function mergeLedgers(a: DailyLedger, b: DailyLedger): DailyLedger {
  let next: Map<DateKey, Partial<Record<Difficulty, SolvedStatus>>> | null = null;
  for (const [date, solved] of b) {
    for (const tier of DIFFICULTIES) {
      const status = solved[tier];
      const held = (next ?? a).get(date);
      if (status === undefined || better(status, held?.[tier]) === held?.[tier]) continue;
      next ??= new Map(a);
      next.set(date, { ...held, [tier]: status });
    }
  }
  return next ?? a;
}

/** Whether `date` counts towards `tier`'s streak: a counted solve in the records, or in the ledger. */
export function isCounted(
  records: readonly GameRecord[],
  date: DateKey,
  tier: Difficulty,
  ledger: DailyLedger = EMPTY_LEDGER,
): boolean {
  return (
    ledger.get(date)?.[tier] === 'solved-on-the-day' ||
    records.some(
      (record) =>
        record.daily === date && record.difficulty === tier && countsTowardsStreak(record),
    )
  );
}

/**
 * A tier's streak as of `today` (the player's local date; see the module
 * comment for what counts), from the records and the ledger. A day solved
 * more than once counts once, and so does a day with a counted solve and any
 * number of later replays. Days after `today` count for nothing — they can
 * only be there if the device's clock has been put back since — so neither
 * streak can run ahead of the calendar.
 */
export function computeStreak(
  records: readonly GameRecord[],
  tier: Difficulty,
  today: DateKey,
  ledger: DailyLedger = EMPTY_LEDGER,
): Streak {
  const counted = new Set<DateKey>();
  for (const [date, solved] of ledger) {
    if (solved[tier] === 'solved-on-the-day' && daysBetween(date, today) >= 0) counted.add(date);
  }
  for (const record of records) {
    if (
      record.difficulty === tier &&
      countsTowardsStreak(record) &&
      daysBetween(record.daily!, today) >= 0
    ) {
      counted.add(record.daily!);
    }
  }

  // Runs, from the dates in order: each date one day after the one before
  // carries the run on.
  let best = 0;
  let run = 0;
  let previous: DateKey | null = null;
  for (const date of [...counted].sort()) {
    run = previous !== null && daysBetween(previous, date) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }

  let current = 0;
  let day = counted.has(today) ? today : addDays(today, -1);
  while (counted.has(day)) {
    current++;
    day = addDays(day, -1);
  }
  return { current, best };
}
