/*
 * Calendar dates for the daily puzzles.
 *
 * A daily belongs to a calendar date, not to a stretch of 24 hours: each
 * player's day starts at their own local midnight, like Wordle's. So dates
 * travel as plain `YYYY-MM-DD` keys, and a timestamp becomes one only through
 * `dateKeyOf`, which reads the local calendar fields.
 *
 * All arithmetic on keys happens on the calendar fields themselves, through
 * the UTC calendar: a key's day is placed at UTC midnight, moved by whole
 * days or months with the `setUTC*` field setters (which carry overflow into
 * the month and year), and read back from the UTC fields. UTC has no daylight
 * saving, so a local day of 23 or 25 hours never enters into it — unlike
 * adding 86,400,000 ms to a local timestamp, which lands on the wrong date
 * when the clocks change.
 */

/** A calendar date as `YYYY-MM-DD` — always a real date (see `isDateKey`). */
export type DateKey = string;

/** A calendar month as `YYYY-MM`. */
export type MonthKey = string;

/** One cell of a month grid. */
export interface MonthGridDay {
  date: DateKey;
  /** False for the days of the months either side that fill out the first and last weeks. */
  inMonth: boolean;
}

/** The date of Daily #1. */
export const DAILY_EPOCH: DateKey = '2026-10-01';

/** Milliseconds in a UTC day, which is always exactly 24 hours long. */
const UTC_DAY_MS = 86_400_000;

/**
 * How far ahead of UTC the furthest-ahead clocks on Earth run: UTC+14, in
 * Kiribati's Line Islands. No zone is further ahead, so no date begins
 * anywhere before it begins there.
 */
const MAX_UTC_OFFSET_MS = 14 * 3_600_000;

/**
 * How far behind UTC the furthest-behind clocks run: UTC−12, on Baker and
 * Howland Islands. No date ends anywhere later than it ends there.
 */
const MIN_UTC_OFFSET_MS = -12 * 3_600_000;

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

/**
 * UTC midnight of a calendar date, in milliseconds.
 *
 * `setUTCFullYear` rather than `Date.UTC`, whose two-digit years mean 19xx;
 * out-of-range months and days carry over, which is what `addDays` relies on.
 */
function utcMidnight(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** The key of the UTC calendar date that a UTC timestamp falls on. */
function keyOfUtc(ms: number): DateKey {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** A key's year, month (1–12) and day. Only for keys already known to be valid. */
function fieldsOf(key: DateKey): [number, number, number] {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))];
}

/** Whether a value is a `YYYY-MM-DD` string naming a real calendar date (no 31 April, no 29 February 2027). */
export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string') return false;
  const match = DATE_KEY_PATTERN.exec(value);
  if (match === null) return false;
  // A date that does not exist carries over into the next month, so it fails
  // to come back as itself.
  return keyOfUtc(utcMidnight(Number(match[1]), Number(match[2]), Number(match[3]))) === value;
}

/** Whether a value is a `YYYY-MM` string naming a real month. */
export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && MONTH_KEY_PATTERN.test(value) && isDateKey(`${value}-01`);
}

/** The local calendar date a timestamp falls on: the player's own date, by their own clock. */
export function dateKeyOf(timestamp: number): DateKey {
  const date = new Date(timestamp);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * The latest calendar date it is anywhere on Earth at a moment: the date in
 * UTC+14 — the player's own date, or the day after it (for a few hours, two
 * days after, on the far side of the Pacific). A date after it has not begun
 * for anyone yet, so nobody can have played its daily; a date up to it can
 * have begun for a friend ahead of the player, so their link to "tomorrow's"
 * daily is no forgery.
 */
export function latestDateAnywhere(timestamp: number): DateKey {
  return keyOfUtc(timestamp + MAX_UTC_OFFSET_MS);
}

/**
 * The earliest calendar date it is anywhere on Earth at a moment: the date in
 * UTC−12 — the player's own date, or the day before it (for a few hours, two
 * days before, in Kiribati's Line Islands). Whatever a device's
 * time zone, its own date at that moment lies between this and
 * `latestDateAnywhere`, which is how a date the device wrote down can be
 * checked against the moment it wrote it.
 */
export function earliestDateAnywhere(timestamp: number): DateKey {
  return keyOfUtc(timestamp + MIN_UTC_OFFSET_MS);
}

/** The date `days` calendar days after `key` (before it, for a negative count). */
export function addDays(key: DateKey, days: number): DateKey {
  const [year, month, day] = fieldsOf(key);
  return keyOfUtc(utcMidnight(year, month, day + days));
}

/**
 * Calendar days from `from` to `to`: 1 from one day to the next, negative when
 * `to` comes first. Exact, because both are UTC midnights and every UTC day
 * has 24 hours.
 */
export function daysBetween(from: DateKey, to: DateKey): number {
  const [y1, m1, d1] = fieldsOf(from);
  const [y2, m2, d2] = fieldsOf(to);
  return Math.round((utcMidnight(y2, m2, d2) - utcMidnight(y1, m1, d1)) / UTC_DAY_MS);
}

/** The day of the week, counted from Monday (0) to Sunday (6), as an en-GB calendar sets out its weeks. */
export function weekdayOf(key: DateKey): number {
  const [year, month, day] = fieldsOf(key);
  return (new Date(utcMidnight(year, month, day)).getUTCDay() + 6) % 7;
}

/**
 * A local `Date` for a calendar date, at noon — for handing to `Intl` to
 * format. Noon, because a few time zones skip local midnight when their
 * clocks go forward, and no zone's clocks change at midday.
 */
export function localDateOf(key: DateKey): Date {
  const [year, month, day] = fieldsOf(key);
  return new Date(year, month - 1, day, 12);
}

/** The daily number of a date: 1 for `DAILY_EPOCH`, counting up a day at a time (and below 1 before it). */
export function dailyNumber(key: DateKey): number {
  return daysBetween(DAILY_EPOCH, key) + 1;
}

/** The date of a daily number — the inverse of `dailyNumber`. */
export function dateOfDaily(number: number): DateKey {
  return addDays(DAILY_EPOCH, number - 1);
}

/** The month a date falls in. */
export function monthOf(key: DateKey): MonthKey {
  return key.slice(0, 7);
}

/** The month `months` calendar months after `month` (before it, for a negative count). */
export function addMonths(month: MonthKey, months: number): MonthKey {
  const [year, monthNumber] = fieldsOf(`${month}-01`);
  return monthOf(keyOfUtc(utcMidnight(year, monthNumber + months, 1)));
}

/** The number of days in a month. */
export function daysInMonth(month: MonthKey): number {
  return daysBetween(`${month}-01`, `${addMonths(month, 1)}-01`);
}

/**
 * A month laid out as calendar weeks, Monday first: every week has seven
 * days, and the first and last are filled out with the days of the months
 * either side (marked `inMonth: false`), so a month takes four to six weeks.
 */
export function monthGrid(month: MonthKey): MonthGridDay[][] {
  const first = `${month}-01`;
  const start = addDays(first, -weekdayOf(first));
  const last = addDays(first, daysInMonth(month) - 1);
  const weekCount = (daysBetween(start, last) + 1 + (6 - weekdayOf(last))) / 7;
  return Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = addDays(start, week * 7 + weekday);
      return { date, inMonth: monthOf(date) === month };
    }),
  );
}
