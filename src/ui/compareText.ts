import {
  formatDuration,
  type HelpOp,
  type MistakeKind,
  type OverlayCell,
  type ProgressMark,
} from '../core';
import { count } from './format';

/*
 * The words of "Compare solves" (see `src/core/compare.ts` and
 * `CompareDialog`): its heading, the readout at the chart's cursor, the
 * names of the marks on the lines, and each cell of the overlaid board as a
 * screen reader hears it. The engine speaks no English, so they are here.
 *
 * A friend's name comes from a link a stranger can write, so where it is set
 * in plain text — an SVG label, an accessible name — it is wrapped in Unicode
 * isolates (`isolate`), which do there what <bdi> does in HTML: a
 * right-to-left name cannot pull the time or the words beside it into its own
 * direction.
 */

/** The button that opens the comparison, beside "Watch Dan's solve". */
export const COMPARE_LABEL = 'Compare solves';

/** A name set in plain text, isolated from the words around it (see above). */
export function isolate(name: string): string {
  return `⁨${name}⁩`;
}

/** The friend as the comparison names them mid-sentence: "Alice", or "your friend". */
export function friendName(name: string | null): string {
  return name === null ? 'your friend' : isolate(name);
}

/** The dialog's heading, as words: "You vs Alice", "You vs your friend". */
export function compareTitle(name: string | null): string {
  return `You vs ${name ?? 'your friend'}`;
}

/** A count of cells: "1 cell", "34 cells". */
export function cellsText(n: number): string {
  return count(n, 'cell');
}

/**
 * What the chart says at its cursor — on screen, and as the slider's value
 * for a screen reader: "2:15 — You 34 cells, Alice 28 cells".
 */
export function readoutText(
  second: number,
  mine: number,
  theirs: number,
  name: string | null,
): string {
  return `${formatDuration(second * 1000)} — You ${cellsText(mine)}, ${friendName(name)} ${cellsText(theirs)}`;
}

/** Help, by the name the "…" menu and Show me give it. */
export const HELP_NAME: Readonly<Record<HelpOp, string>> = {
  hint: 'Hint',
  walkthrough: 'Show me',
  page: 'Show me, another page',
  checkCell: 'Check cell',
  checkPuzzle: 'Check puzzle',
  reveal: 'Reveal cell',
};

/** A mistake, by the name the Solved dialog gives it. */
export const MISTAKE_NAME: Readonly<Record<MistakeKind, string>> = {
  value: 'Mistake',
  candidate: 'Candidate mistake',
};

/** What a mark on a line was: "Mistake", "Candidate mistake", "Hint", "Show me"… */
export function markName(mark: ProgressMark): string {
  return mark.kind === 'mistake' ? MISTAKE_NAME[mark.what] : HELP_NAME[mark.what];
}

/** The time a line ends, as its label gives it: the player's time, or none recorded. */
export function endLabelText(who: string, seconds: number | null): string {
  return seconds === null ? who : `${who} ${formatDuration(seconds * 1000)}`;
}

/**
 * How long a name may run in a line's end label before it is cut short with
 * an ellipsis: the label shares a narrow chart with the other line's. The
 * whole name is in the heading and the legend.
 */
const LABEL_NAME_LENGTH = 12;

/** A name cut to fit a line's end label (see `LABEL_NAME_LENGTH`). */
export function shortName(name: string): string {
  const characters = [...name];
  return characters.length <= LABEL_NAME_LENGTH
    ? name
    : `${characters.slice(0, LABEL_NAME_LENGTH - 1).join('')}…`;
}

/**
 * A cell of the overlaid board as a screen reader hears it — its state,
 * whose and what: "7, both of you", "7, yours", "7, Alice's", "yours 3,
 * Alice's 7", "empty". A given is named by the board as any given is.
 */
export function overlayCellLabel(
  cell: Exclude<OverlayCell, { kind: 'given' }>,
  name: string | null,
): string {
  const theirs = name === null ? "your friend's" : `${isolate(name)}'s`;
  switch (cell.kind) {
    case 'empty':
      return 'empty';
    case 'both':
      return `${cell.digit}, both of you`;
    case 'mine':
      return `${cell.digit}, yours`;
    case 'theirs':
      return `${cell.digit}, ${theirs}`;
    case 'different':
      return `yours ${cell.mine}, ${theirs} ${cell.theirs}`;
  }
}
