import {
  localDateOf,
  type Assists,
  type DateKey,
  type Difficulty,
  type MistakeTally,
  type MonthKey,
  type TechniqueId,
} from '../core';

/*
 * The English the UI speaks about puzzles: labels, assists and dates. Kept out
 * of `src/core` on purpose — the engine is language-free, and this is where
 * its ids become words.
 */

/** Display names for the tiers. */
export const DIFFICULTY_LABEL: Readonly<Record<Difficulty, string>> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

/** "hidden single" → "Hidden single": the first letter only, so "X-Wing" keeps its own capitals. */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a", "a and b", "a, b and c" — no Oxford comma, in British style. */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * "an Easy", "a Hard", "an XY-Wing": the article follows the label's sound,
 * so a vowel takes "an" and so does a leading X, which is said "ex".
 */
export function withArticle(label: string): string {
  return `${/^[aeiou]|^x/i.test(label) ? 'an' : 'a'} ${label}`;
}

/**
 * Plain-English names for the grader's techniques, as a player would search
 * for them. The two hidden singles share a name: the row/box distinction
 * matters to the grader, not to someone reading a hint. Pointing names both
 * of its shapes, as the grader finds either: two or three candidates in a box
 * that all sit on one line.
 */
export const TECHNIQUE_LABEL: Readonly<Record<TechniqueId, string>> = {
  fullHouse: 'full house',
  hiddenSingleBox: 'hidden single',
  hiddenSingleLine: 'hidden single',
  nakedSingle: 'naked single',
  pointing: 'pointing pair or triple',
  claiming: 'box/line reduction',
  nakedPair: 'naked pair',
  hiddenPair: 'hidden pair',
  nakedTriple: 'naked triple',
  hiddenTriple: 'hidden triple',
  xWing: 'X-Wing',
  swordfish: 'Swordfish',
  xyWing: 'XY-Wing',
  xyzWing: 'XYZ-Wing',
  skyscraper: 'Skyscraper',
  twoStringKite: '2-String Kite',
  xyChain: 'XY-Chain',
  wWing: 'W-Wing',
  alternatingChain: 'alternating chain',
};

/** Whether any help was taken. */
export function hasAssists(assists: Assists): boolean {
  return (
    assists.autoCandidates ||
    assists.checkGuesses === true ||
    assists.hints > 0 ||
    assists.checks > 0 ||
    assists.reveals > 0
  );
}

/**
 * The words for "Check guesses when entered" having been on, wherever help is
 * listed: "guesses checked as entered" in a list of help ("With guesses
 * checked as entered, 2 hints"), "Checked as entered" on its own (a History
 * chip, the head-to-head's row). The setting's own name stays NYT's.
 */
export const CHECK_GUESSES_WORDS = 'guesses checked as entered';
export const CHECK_GUESSES_LABEL = 'Checked as entered';

/** "1 hint", "3 hints": a number and its noun, plural unless it is one. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * The help a time came with, as a list — "auto candidates, guesses checked as
 * entered, 2 hints, 1 reveal" — or null for a time earned unaided. The two
 * kinds of help that stay on for a game come first, then the counts.
 */
export function describeAssists(assists: Assists): string | null {
  const parts: string[] = [];
  if (assists.autoCandidates) parts.push('auto candidates');
  if (assists.checkGuesses === true) parts.push(CHECK_GUESSES_WORDS);
  if (assists.hints > 0) parts.push(count(assists.hints, 'hint'));
  if (assists.checks > 0) parts.push(count(assists.checks, 'check'));
  if (assists.reveals > 0) parts.push(count(assists.reveals, 'reveal'));
  return parts.length === 0 ? null : parts.join(', ');
}

/**
 * A solve's mistakes in a few words, the two kinds kept apart — "No
 * mistakes", "1 mistake", "2 mistakes · 1 candidate mistake", "1 candidate
 * mistake". A "mistake" is a wrong number entered; a "candidate mistake" is
 * the answer struck out of a cell's candidates: the words the rest of the
 * game uses for them, the head-to-head's rows included. Only a kind that
 * happened is named, so a line naming one kind says there were none of the
 * other; with neither, it says so.
 */
export function describeMistakes(mistakes: MistakeTally): string {
  const parts: string[] = [];
  if (mistakes.values > 0) parts.push(count(mistakes.values, 'mistake'));
  if (mistakes.candidates > 0) parts.push(count(mistakes.candidates, 'candidate mistake'));
  return parts.length === 0 ? 'No mistakes' : parts.join(' · ');
}

/**
 * How a time was earned, in one line to sit under it: its mistakes when they
 * are known, then the help it took — "No mistakes · with 2 hints", "1 mistake
 * · 1 candidate mistake", "No mistakes", or, with the mistakes not known,
 * "With auto candidates, 2 hints" — or null for an unaided time whose
 * mistakes are not known, which leaves nothing to say. Not known says
 * nothing of mistakes rather than "No mistakes", which is a claim.
 *
 * The share text, a friend's Ready card and History's line about a friend's
 * time all use it, so a result reads the same wherever it turns up.
 */
export function describeResult(assists: Assists, mistakes: MistakeTally | null): string | null {
  const help = describeAssists(assists);
  if (mistakes === null) return help === null ? null : `With ${help}`;
  const clean = describeMistakes(mistakes);
  return help === null ? clean : `${clean} · with ${help}`;
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const WEEKDAY_DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const WEEKDAY_DAY_MONTH_SHORT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const MONTH_YEAR = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

function startOfDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * When a game was played, as short as is still unambiguous: "Today 14:05",
 * "Yesterday 09:12", "3 Oct" this year, "3 Oct 2025" before that. Calendar
 * days in local time, so a game at 23:59 is not "today" a minute later.
 */
export function formatDate(epochMs: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(epochMs)) / 86_400_000);
  if (days === 0) return `Today ${TIME.format(epochMs)}`;
  if (days === 1) return `Yesterday ${TIME.format(epochMs)}`;
  const sameYear = new Date(epochMs).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(epochMs);
}

/*
 * Calendar dates — a daily's `YYYY-MM-DD` key, rather than a moment — set out
 * for reading. Each is formatted at its local noon (`localDateOf`), so the
 * date shown is the date named, whatever the time zone.
 */

/**
 * A date in a few characters: "6 Oct" in `today`'s year, "6 Oct 2025" in
 * another, as `formatDate` has it for a moment.
 */
export function formatDay(date: DateKey, today: DateKey): string {
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return (sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(localDateOf(date));
}

/** A date with its year, for text that may be read in another year: "6 Oct 2026". */
export function formatDayWithYear(date: DateKey): string {
  return DAY_MONTH_YEAR.format(localDateOf(date));
}

/** A date in full, as a calendar day is named: "Tuesday 6 October". */
export function formatLongDay(date: DateKey): string {
  return WEEKDAY_DAY_MONTH.format(localDateOf(date));
}

/** A date in short, with its weekday, for a heading with little room: "Tue 6 Oct". */
export function formatShortDay(date: DateKey): string {
  return WEEKDAY_DAY_MONTH_SHORT.format(localDateOf(date));
}

/** A month and its year, as a calendar's heading: "October 2026". */
export function formatMonth(month: MonthKey): string {
  return MONTH_YEAR.format(localDateOf(`${month}-01`));
}
