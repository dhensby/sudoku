import type { GameState } from './game';
import type { MistakeKind } from './mistakes';
import type { LoggedMove } from './moves';
import { stateAt, type Playback } from './playback';
import type { Digit } from './types';

/*
 * Compare solves: the player's solve of a puzzle against a friend's, both
 * played back from their move logs (see `playback.ts`), as a chart of the
 * cells each had solved over play time — with their counted mistakes and the
 * help they took marked on their lines — and one board showing, at any
 * moment the viewer picks, who had filled which cell and with what.
 *
 * Time here is counted in whole seconds of play, the unit times are shown
 * in: second s stands for the end of that second, so a move made at 5:23.4
 * is in place at 5:23, as the solve the player was told took 5:23 is
 * finished there. Every lookup — the cells solved, the board, the marks — is
 * made at that same moment, so the chart's line, its cursor and the board
 * under it always agree.
 *
 * "Solved" means a cell the puzzle left empty holding its answer: a given is
 * never counted, and a wrong number is not a cell solved, though the board
 * shows it. A count can fall — an Erase, an Undo, a Reset — and the line
 * falls with it.
 *
 * Nothing here is English, and nothing here is drawn: the chart's scales,
 * ticks and the places of its end labels are numbers for the UI to draw
 * with (see `src/ui/dialogs/CompareDialog.tsx`).
 */

/** A step of a player's progress: the cells solved at the end of a second of play. */
export interface ProgressPoint {
  readonly second: number;
  readonly solved: number;
}

/** The moves that are help, marked on a player's line. */
export type HelpOp = Extract<
  LoggedMove['op'],
  'hint' | 'walkthrough' | 'page' | 'checkCell' | 'checkPuzzle' | 'reveal'
>;

const HELP_OPS: ReadonlySet<LoggedMove['op']> = new Set<HelpOp>([
  'hint',
  'walkthrough',
  // A page of Show me revealed: charged as help when it is new (see `moves.ts`).
  'page',
  'checkCell',
  'checkPuzzle',
  'reveal',
]);

/**
 * A mark on a player's line: a mistake that counted (of either kind — see
 * `mistakes.ts`), or a move of help. Slips forgiven are left off: they never
 * counted, and the chart is about how the solve went, not every finger slip.
 */
export type ProgressMark =
  | {
      readonly kind: 'mistake';
      readonly what: MistakeKind;
      readonly second: number;
      readonly solved: number;
    }
  | {
      readonly kind: 'help';
      readonly what: HelpOp;
      readonly second: number;
      readonly solved: number;
    };

/** One player's solve, as the chart draws it. */
export interface SolveProgress {
  /**
   * The line: the cells solved from second 0, with a point wherever the
   * count changed, in order of second, at most one a second. The last is the
   * solve.
   */
  readonly points: readonly ProgressPoint[];
  /** The second the solve came in: where the line ends. */
  readonly end: number;
  /** How many cells the puzzle left to solve: the top of the chart. */
  readonly total: number;
  /** The mistakes that counted and the help taken, in order, each where it sits on the line. */
  readonly marks: readonly ProgressMark[];
}

/** The second of play a time in ms falls in. */
export function secondOf(ms: number): number {
  return Math.floor(ms / 1000);
}

/** How many cells a puzzle leaves to solve: its empty cells. */
export function emptyCellCount(givens: string): number {
  let count = 0;
  for (const ch of givens) if (ch === '0') count++;
  return count;
}

/** How many of a game's empty cells hold their answer. */
export function solvedCells(state: GameState): number {
  const { solution } = state.puzzle;
  let count = 0;
  state.cells.forEach((cell, index) => {
    if (!cell.given && cell.value !== 0 && cell.value === solution.charCodeAt(index) - 48) count++;
  });
  return count;
}

/**
 * The index of the last item of `items` (sorted by `keyOf`, ascending) whose
 * key is at most `key`, or -1 if none is: a binary search, as a long solve
 * has thousands of moves and the cursor is moved a second at a time.
 */
function lastAtOrBefore<T>(items: readonly T[], key: number, keyOf: (item: T) => number): number {
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (keyOf(items[middle]) <= key) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * The position of a playback at the end of `second` (see `playback.ts`):
 * how many of its moves had been made by then — 0 before any, the length of
 * the log from the solve on.
 */
export function positionAtSecond(playback: Playback, second: number): number {
  return lastAtOrBefore(playback.frames, second, (frame) => secondOf(frame.change.at)) + 1;
}

/** The game as it stood at the end of `second`. */
export function stateAtSecond(playback: Playback, second: number): GameState {
  return stateAt(playback, positionAtSecond(playback, second));
}

/** The cells solved at the end of `second`, read off a progress line. */
export function solvedAt(progress: SolveProgress, second: number): number {
  const index = lastAtOrBefore(progress.points, second, (point) => point.second);
  // The line starts at second 0, so only a time before the start finds nothing.
  return index === -1 ? progress.points[0].solved : progress.points[index].solved;
}

/**
 * A player's solve as the chart draws it, from its playback: the cells
 * solved after every move, kept as of the end of each second, and the marks.
 */
export function progressOf(playback: Playback): SolveProgress {
  const points: ProgressPoint[] = [{ second: 0, solved: solvedCells(playback.start) }];
  const marked: { kind: 'mistake' | 'help'; what: MistakeKind | HelpOp; second: number }[] = [];
  for (const frame of playback.frames) {
    const second = secondOf(frame.change.at);
    const solved = solvedCells(frame.state);
    const last = points[points.length - 1];
    // Within one second only where it ended counts.
    if (last.second === second) points[points.length - 1] = { second, solved };
    else if (last.solved !== solved) points.push({ second, solved });
    for (const mistake of frame.mistakes) {
      // A playback is of a solve, so every window has settled.
      if (mistake.outcome === 'counted')
        marked.push({ kind: 'mistake', what: mistake.kind, second });
    }
    if (HELP_OPS.has(frame.change.op)) {
      marked.push({ kind: 'help', what: frame.change.op as HelpOp, second });
    }
  }
  // A second whose moves ended where the one before ended adds nothing.
  const line = points.filter((point, i) => i === 0 || point.solved !== points[i - 1].solved);
  const progress: SolveProgress = {
    points: line,
    // A playback has a solving move, its last.
    end: secondOf(playback.frames[playback.frames.length - 1].change.at),
    total: emptyCellCount(playback.puzzle.givens),
    marks: [],
  };
  return {
    ...progress,
    marks: marked.map(
      (mark) => ({ ...mark, solved: solvedAt(progress, mark.second) }) as ProgressMark,
    ),
  };
}

/**
 * What one cell of the overlaid board shows at a moment: a given; nothing
 * from either player; the same digit from both; a digit from one of them
 * only; or a different digit from each (so one of them, at least, was wrong
 * then).
 */
export type OverlayCell =
  | { readonly kind: 'given'; readonly digit: Digit }
  | { readonly kind: 'empty' }
  | { readonly kind: 'both'; readonly digit: Digit }
  | { readonly kind: 'mine'; readonly digit: Digit }
  | { readonly kind: 'theirs'; readonly digit: Digit }
  | { readonly kind: 'different'; readonly mine: Digit; readonly theirs: Digit };

/**
 * The overlaid board at the end of `second`: each cell as both players' games
 * stood then. The two playbacks are of the same puzzle (the friend's link
 * carried its givens), so their givens agree; candidates are left out, as
 * the board is about the numbers placed.
 */
export function overlayAt(mine: Playback, theirs: Playback, second: number): OverlayCell[] {
  const a = stateAtSecond(mine, second).cells;
  const b = stateAtSecond(theirs, second).cells;
  return a.map((cell, index): OverlayCell => {
    if (cell.given) return { kind: 'given', digit: cell.value as Digit };
    const ours = cell.value as Digit | 0;
    const others = b[index].value as Digit | 0;
    if (ours === 0 && others === 0) return { kind: 'empty' };
    if (ours === others) return { kind: 'both', digit: ours as Digit };
    if (others === 0) return { kind: 'mine', digit: ours as Digit };
    if (ours === 0) return { kind: 'theirs', digit: others };
    return { kind: 'different', mine: ours, theirs: others };
  });
}

/**
 * The steps the time axis ticks at, in seconds: round times on a clock, so a
 * tick reads 0:30, 1:00, 5:00 or 1:00:00 rather than 0:47. Past the last,
 * whole hours doubling.
 */
const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600] as const;

/** The steps the cell-count axis ticks at. */
const COUNT_STEPS = [1, 2, 5, 10, 20, 25, 50] as const;

/** The smallest step from `steps` (doubling past its last) that ticks 0 to `max` in `count` ticks or fewer. */
function stepFor(steps: readonly number[], max: number, count: number): number {
  const fits = (step: number) => Math.floor(max / step) + 1 <= count;
  const step = steps.find(fits);
  if (step !== undefined) return step;
  let doubled = steps[steps.length - 1] * 2;
  while (!fits(doubled)) doubled *= 2;
  return doubled;
}

/** The step after `step` in `steps`, doubling past the last. */
function nextStep(steps: readonly number[], step: number): number {
  return steps.find((next) => next > step) ?? step * 2;
}

/** The multiples of `step` from 0 to `max`. */
function multiples(step: number, max: number): number[] {
  const ticks: number[] = [];
  for (let at = 0; at <= max; at += step) ticks.push(at);
  return ticks;
}

/**
 * Where the time axis ticks, in seconds: from 0, at a round step, no more
 * than `count` ticks (at least 2) up to `maxSecond`.
 */
export function timeTicks(maxSecond: number, count: number): number[] {
  return multiples(stepFor(TIME_STEPS, maxSecond, Math.max(count, 2)), maxSecond);
}

/**
 * Where the cell-count axis ticks: from 0 at a round step, and at `total`
 * too, the top of the chart — all of the puzzle solved — in place of a round
 * tick too close beneath it to read apart (half a step or less). No more
 * than `count` ticks in all (at least 2), the top among them: the smallest
 * round step that keeps to that.
 */
export function countTicks(total: number, count: number): number[] {
  const most = Math.max(count, 2);
  const ticksAt = (step: number): number[] => {
    const ticks = multiples(step, total).filter((tick) => tick === 0 || total - tick > step / 2);
    if (ticks[ticks.length - 1] !== total) ticks.push(total);
    return ticks;
  };
  // The round step for `most` ticks before the top is added always keeps to
  // `most` once it is, or to one more: a step up from it always keeps to it.
  let step = stepFor(COUNT_STEPS, total, most);
  let ticks = ticksAt(step);
  while (ticks.length > most) {
    step = nextStep(COUNT_STEPS, step);
    ticks = ticksAt(step);
  }
  return ticks;
}

/**
 * The times a table of progress lists, in seconds: the time axis's ticks
 * (`rows` of them at most) and the end, so the table finishes where the
 * longer solve does.
 */
export function sampleSeconds(maxSecond: number, rows: number): number[] {
  const ticks = timeTicks(maxSecond, rows);
  return ticks[ticks.length - 1] === maxSecond ? ticks : [...ticks, maxSecond];
}

/** A linear scale from a domain to a range; a domain of no width maps to the range's start. */
export function scaleLinear(
  [d0, d1]: readonly [number, number],
  [r0, r1]: readonly [number, number],
): (value: number) => number {
  const span = d1 - d0;
  return (value) => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0));
}

/** The inverse of `scaleLinear`: from the range back to the domain. */
export function invertLinear(
  domain: readonly [number, number],
  [r0, r1]: readonly [number, number],
): (position: number) => number {
  return scaleLinear([r0, r1], domain);
}

/** A label at the end of a line: where the line ends, and how wide the label is. */
export interface EndLabel {
  readonly x: number;
  readonly width: number;
}

/**
 * Where a line's end label goes: in the band above the chart, set ending at
 * `right`; or beside the dot the line ends at, inside the chart, set ending
 * at `x` to the dot's left or starting there to its right.
 */
export type LabelPlace =
  | { readonly at: 'above'; readonly right: number }
  | { readonly at: 'beside'; readonly side: 'left' | 'right'; readonly x: number };

/**
 * Where each line's end label goes, in the order given (see `LabelPlace`).
 *
 * A label sits in the band above the chart ending where its line does, so it
 * reads as that line's — kept on the chart (its left edge no further left
 * than `left`). Where that would run it into the label of a line ending
 * further right (within `gap`), it moves down beside its own line's end dot
 * instead, `inset` from the dot: to the dot's left, which both lines leave
 * empty as they climb from the bottom left, or to its right where the left
 * has no room. Each label stays by its own line's end, so no label is
 * stacked over another or over the other line's end, and none needs a
 * leader. Made for the chart's two lines: with more, labels moved beside
 * dots close together could meet.
 */
export function placeEndLabels(
  labels: readonly EndLabel[],
  left: number,
  gap: number,
  inset: number,
): LabelPlace[] {
  const order = labels.map((_, i) => i).sort((a, b) => labels[b].x - labels[a].x || a - b);
  const places = new Array<LabelPlace>(labels.length);
  let bound = Number.POSITIVE_INFINITY;
  for (const i of order) {
    const { x, width } = labels[i];
    const right = Math.max(x, left + width);
    if (right <= bound) {
      places[i] = { at: 'above', right };
      bound = right - width - gap;
    } else if (x - inset - width >= left) {
      places[i] = { at: 'beside', side: 'left', x: x - inset };
    } else {
      places[i] = { at: 'beside', side: 'right', x: x + inset };
    }
  }
  return places;
}
