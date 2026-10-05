import { formatDuration, type Assists } from '../../core';
import { count, describeAssists } from '../format';

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
 * "2 hints", "1 check", "1 reveal" — the words the rest of the game uses for
 * them, so a chip never needs decoding. Empty for an unaided game.
 */
export function assistChips(assists: Assists): string[] {
  const chips: string[] = [];
  if (assists.autoCandidates) chips.push('Auto candidates');
  if (assists.hints > 0) chips.push(count(assists.hints, 'hint'));
  if (assists.checks > 0) chips.push(count(assists.checks, 'check'));
  if (assists.reveals > 0) chips.push(count(assists.reveals, 'reveal'));
  return chips;
}
