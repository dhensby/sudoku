import { formatDuration, type Assists } from '../../core';
import { assistPartText, assistParts, describeAssists } from '../format';

/*
 * Small pieces of English the dialogs share. The general vocabulary (tier
 * labels, counts, the assists list, dates) lives in `../format`; these are
 * the dialog-specific turns of phrase built on it.
 */

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
