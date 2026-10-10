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
 * the candidates the placed digits allow, less what its own earlier steps
 * strike out — which need not be the player's own notes. It says both, so a
 * candidate missing from a later step's board, with no digit to rule it
 * out, is accounted for.
 */
export const WALKTHROUGH_INTRO =
  'The small numbers are what the filled-in digits still allow, less what earlier steps rule out — not your own notes.';
