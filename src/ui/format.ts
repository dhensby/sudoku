import type { Assists, Difficulty, TechniqueId } from '../core';

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
};

/** Whether any help was taken. */
export function hasAssists(assists: Assists): boolean {
  return assists.autoCandidates || assists.hints > 0 || assists.checks > 0 || assists.reveals > 0;
}

/** "1 hint", "3 hints": a number and its noun, plural unless it is one. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * The help a time came with, as a list — "auto candidates, 2 hints, 1 reveal"
 * — or null for a time earned unaided.
 */
export function describeAssists(assists: Assists): string | null {
  const parts: string[] = [];
  if (assists.autoCandidates) parts.push('auto candidates');
  if (assists.hints > 0) parts.push(count(assists.hints, 'hint'));
  if (assists.checks > 0) parts.push(count(assists.checks, 'check'));
  if (assists.reveals > 0) parts.push(count(assists.reveals, 'reveal'));
  return parts.length === 0 ? null : parts.join(', ');
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

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
