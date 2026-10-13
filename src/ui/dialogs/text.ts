import { MIN_GIVENS, formatDuration, type Assists, type GivensAssessment } from '../../core';
import { friendLabel, lastLinkAt, type Friend } from '../../storage/friends';
import { describeUnit } from '../announce';
import {
  DIFFICULTY_LABEL,
  NUMBER_WORD,
  assistPartText,
  assistParts,
  capitalise,
  describeAssists,
  formatDate,
  withArticle,
} from '../format';

/*
 * Small pieces of English the dialogs share. The general vocabulary (tier
 * labels, counts, the assists list, dates) lives in `../format`; these are
 * the dialog-specific turns of phrase built on it.
 */

/**
 * How much a name field takes while typing — the player's own in Share, and
 * a friend's in Friends. Generous on purpose: the name is tidied and, past 24
 * characters, cut short with an ellipsis on the way out (`normaliseName`), and a
 * field that stops accepting keys mid-emoji, or mid-paste of a name with
 * stray spaces, feels broken. This matches the tidier's own UTF-16 ceiling.
 */
export const NAME_INPUT_MAX = 64;

/**
 * How much a puzzle's name field takes while typing, in Your puzzles: as
 * generous as a person's, for the same reasons, and matching the puzzle
 * names' own UTF-16 ceiling (see `normaliseTitle`).
 */
export const TITLE_INPUT_MAX = 80;

/**
 * What a grid typed in makes, one thing at a time (see `assessGivens`): the
 * editor's line above its pad, and each of Your puzzles' rows — the same
 * words for as long as the same thing is true, so a screen reader speaks
 * only as it changes, not at every number. Each fits a 320px phone's line. A
 * puzzle with one solution is named by its tier alone.
 */
export function describeGivens(assessment: GivensAssessment): string {
  switch (assessment.kind) {
    case 'empty':
      return 'Type in the numbers from your puzzle.';
    case 'clash': {
      const { count, digit, unit } = assessment;
      return `${capitalise(NUMBER_WORD[count])} ${digit}s in ${describeUnit(unit)}.`;
    }
    case 'too-few':
      return `A puzzle needs at least ${MIN_GIVENS} numbers.`;
    case 'full':
      return 'Every cell is filled: nothing to solve.';
    case 'multiple':
      return 'More than one solution so far.';
    case 'none':
      return 'No solution: a number must be wrong.';
    case 'too-complex':
      return 'Too complex to check.';
    case 'ok':
      return `One solution: ${withArticle(DIFFICULTY_LABEL[assessment.puzzle.difficulty])} puzzle.`;
  }
}

/**
 * A friend as an option in a picker of friends — "Who sent this?"'s, and a
 * merge's in Friends — names them: "Ally · Today 14:05", "No name · 3 Oct".
 * What they go by, and when their latest link came, which tells two of one
 * name apart. Plain text, as an option holds no markup, so no <bdi>: names
 * are tidied of direction controls (see `normaliseName`), so at worst a
 * right-to-left one sits the other side of its date.
 */
export function friendOption(friend: Friend, now: number): string {
  return `${friendLabel(friend) ?? 'No name'} · ${formatDate(lastLinkAt(friend), now)}`;
}

/** "With auto candidates, 2 hints" — or null for a time earned unaided. */
export function assistsSentence(assists: Assists): string | null {
  const list = describeAssists(assists);
  return list === null ? null : `With ${list}`;
}

/**
 * A stat that may not exist yet — no solve without reveals — as a dash, never
 * as 0:00, which would read as an impossible record.
 */
export function formatStat(ms: number | null): string {
  return ms === null ? '—' : formatDuration(ms);
}

/**
 * The help a game took as short chips for a list row: "Auto candidates",
 * "Checked as entered", "2 hints", "1 check", "1 reveal" — the words the rest
 * of the game uses for them, so a chip never needs decoding. Empty for an
 * unaided game. The help taken beside the timer reads the same, from the
 * same parts.
 */
export function assistChips(assists: Assists): string[] {
  return assistParts(assists).map(assistPartText);
}

/**
 * The line "Show me" opens with: what the small numbers on its boards are —
 * the player's own candidates, less what its earlier steps strike out — so
 * that a candidate missing from a step's board, with no digit to rule it
 * out, is accounted for. In Auto Candidate Mode those are the automatic
 * ones less the player's strikes; otherwise their notes, where a cell with
 * none counts as having every candidate, which a player taking notes on a
 * few cells would otherwise find drawn where they wrote nothing.
 */
export function walkthroughIntro(autoCandidates: boolean): string {
  return autoCandidates
    ? "The small numbers are your own candidates, without any you've crossed out, less what earlier steps rule out."
    : 'The small numbers are your own notes, less what earlier steps rule out. A cell where you have noted none counts as having every number the filled-in digits allow.';
}
