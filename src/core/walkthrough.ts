import { hintBoardOf, type FillHint, type GameState, type StepHint } from './game';
import { TECHNIQUE_ORDER, harderTechnique, nextStep, type TechniqueTrace } from './grader';
import { BOX, COL, PEERS, POPCOUNT, ROW, bit, digitsOf, lowestDigit, unitCells } from './grid';
import { isStepValid, reliance, stepOn } from './patterns';
import { seedFromString } from './rng';
import { cloneBoard, eliminate, place, type SolveStep, type SolverBoard } from './techniques';
import type { Digit, Hint, SingleTechniqueId, TechniqueId, Unit, Values } from './types';

/*
 * "Show me": the steps that solve one cell, from the board as it stands.
 *
 * A hint names the cell a logical solve fills next and the hardest technique
 * it took to get there — but the solve may wander all over the board first,
 * and the technique it names may sit half a board away from the cell. The
 * walkthrough keeps only what the cell actually depends on:
 *
 * 1. Solve easiest-first, as the grader does, until the cell itself can be
 *    filled by a single — checking the cell before every step, so it is
 *    filled the moment it can be, however the scan would have gone on.
 * 2. Slice: walk back from that single, keeping a step only if something a
 *    kept step relies on (see `reliance`) was ruled out by it — a candidate
 *    it removed, or a cell it filled (and with it the candidates it struck
 *    from its peers). Each candidate is removed by exactly one step, so the
 *    step to keep is never in doubt.
 * 3. Replay what is left from the board itself, reading each step afresh on
 *    the board the kept steps leave (see `stepOn`) and holding it to
 *    `isStepValid`. The slice keeps everything a step relies on, and the
 *    board only ever keeps more candidates than the full solve had, so the
 *    replay holds by construction (see `reliance`); should it ever fail, the
 *    whole solve is replayed instead, and if even that fails there is no
 *    walkthrough. A chain that does not hold is never shown.
 * 4. Prune: drop, last to first, every step the others can do without. The
 *    slice is not enough on its own: read afresh on a board that kept more
 *    candidates, a later step can strike more than it did in the solve —
 *    the very candidate an earlier kept step was only there to remove. Each
 *    step is dropped only if the rest still replay, so what is left holds
 *    too; and none of what is left can then go. Dropping a step only leaves
 *    later boards with more candidates, which can only make a later step
 *    harder to hold, so a step kept when it was tried is still needed once
 *    earlier ones have gone.
 *
 * What is left always has a step of the hardest technique the solve used,
 * so it agrees with the hint that named it: the solve goes easiest-first,
 * so when that technique was first needed nothing easier would do, and no
 * chain of easier steps gets the board past that point.
 *
 * Every candidate is one the board it starts from has, less what earlier
 * steps of the walkthrough removed. That board is the candidates the player
 * has (see `hintBoardOf`), so a step they have taken already finds nothing
 * left to do and is not shown, and a step can rest on a candidate they ruled
 * out themselves. That is sound while every cell's answer is among them —
 * which `explainCell` holds the board to when it is given the solution.
 */

/** The steps that solve one cell. */
export interface Walkthrough {
  /** The cell they solve, 0–80. */
  target: number;
  /** The digit it takes. */
  digit: Digit;
  /**
   * The steps, in order, each the board just before it — the placed digits
   * and the candidates as the earlier steps here leave them — and the step
   * itself, as it stands on that board. The last places `digit` at `target`.
   */
  steps: TechniqueTrace[];
}

/** The solve that leads to a cell, as far as the point where a single can fill it. */
export interface CellSolve {
  /** Every step taken, in order. */
  steps: SolveStep[];
  /** The candidates just before each step. */
  before: Uint16Array[];
  /**
   * The singles that fill the cell on the board the steps leave — each
   * kind and house that does, in the order the grader tries them. Never empty.
   */
  finals: SolveStep[];
}

/** A slice of a `CellSolve`: the single that ends it, and the steps it needs. */
export interface SolveSlice {
  /** The single that fills the cell. */
  final: SolveStep;
  /** The indexes, ascending, of the solve's steps the single depends on. */
  kept: number[];
}

/** The houses of a cell — row, column, box — in the order the techniques scan units. */
function housesOf(index: number): Unit[] {
  return [
    { kind: 'row', index: ROW[index] },
    { kind: 'column', index: COL[index] },
    { kind: 'box', index: BOX[index] },
  ];
}

/** A single filling `index` with `digit`, described as the technique would. */
function singleStep(
  technique: SingleTechniqueId,
  index: number,
  digit: Digit,
  unit: Unit | null,
): SolveStep {
  return {
    technique,
    placement: { index, digit },
    eliminations: [],
    unit,
    pattern: [{ index, mask: bit(digit) }],
    houses: unit ? [unit] : [],
    digit,
  };
}

/**
 * Every single that fills `target` on `board` right now, without changing
 * it: each full house, hidden single (box, then row and column) and naked
 * single, in the order the grader tries them.
 */
function singlesAt(board: SolverBoard, target: number): SolveStep[] {
  const mask = board.candidates[target];
  const houses = housesOf(target);
  const singles: SolveStep[] = [];
  const isOnly = (unit: Unit, digit: number) =>
    unitCells(unit).every((i) => i === target || (board.candidates[i] & bit(digit)) === 0);
  if (POPCOUNT[mask] === 1) {
    for (const unit of houses) {
      if (unitCells(unit).every((i) => i === target || board.values[i] !== 0)) {
        singles.push(singleStep('fullHouse', target, lowestDigit(mask), unit));
      }
    }
  }
  const lines = houses.slice(0, 2);
  for (const [technique, units] of [
    ['hiddenSingleBox', [houses[2]]],
    ['hiddenSingleLine', lines],
  ] as const) {
    for (const unit of units) {
      for (const digit of digitsOf(mask)) {
        if (isOnly(unit, digit)) singles.push(singleStep(technique, target, digit, unit));
      }
    }
  }
  if (POPCOUNT[mask] === 1) {
    singles.push(singleStep('nakedSingle', target, lowestDigit(mask), null));
  }
  return singles;
}

/**
 * Solve easiest-first from `start` until `target` can be filled by a single
 * (step 1 above). Null when the techniques stall first, or the cell is not
 * an empty cell of the grid. Pure; does not mutate input.
 */
export function solveToCell(start: SolverBoard, target: number): CellSolve | null {
  if (!Number.isInteger(target) || target < 0 || target > 80 || start.values[target] !== 0) {
    return null;
  }
  const board = cloneBoard(start);
  const steps: SolveStep[] = [];
  const before: Uint16Array[] = [];
  for (;;) {
    const finals = singlesAt(board, target);
    if (finals.length > 0) return { steps, before, finals };
    const candidates = board.candidates.slice();
    // Every single that could fill the target was looked for above, so
    // this step never fills it; each step changes the board, so the loop
    // ends.
    const step = nextStep(board, TECHNIQUE_ORDER);
    if (step === null) return null;
    steps.push(step);
    before.push(candidates);
  }
}

/**
 * Whether a step ruled out anything in `absent` (needed gone, per cell) or
 * filled a cell in `filled`. A placement rules out every candidate its cell
 * still had, and its digit from every peer that still had it.
 */
function rulesOut(
  step: SolveStep,
  before: Uint16Array,
  absent: Uint16Array,
  filled: Uint8Array,
): boolean {
  if (step.placement === null) {
    return step.eliminations.some(({ index, mask }) => (absent[index] & mask) !== 0);
  }
  const { index, digit } = step.placement;
  if (filled[index] === 1 || (absent[index] & before[index]) !== 0) return true;
  const d = bit(digit);
  return PEERS[index].some((peer) => (absent[peer] & before[peer] & d) !== 0);
}

/** The steps of `solve` that `final` depends on, directly or through other kept steps (step 2 above). */
function sliceFor(solve: CellSolve, final: SolveStep): number[] {
  const absent = new Uint16Array(81);
  const filled = new Uint8Array(81);
  const need = (step: SolveStep) => {
    const { absent: gone, filled: full } = reliance(step);
    for (const { index, mask } of gone) absent[index] |= mask;
    for (const index of full) filled[index] = 1;
  };
  need(final);
  const kept: number[] = [];
  for (let k = solve.steps.length - 1; k >= 0; k--) {
    if (rulesOut(solve.steps[k], solve.before[k], absent, filled)) {
      kept.push(k);
      need(solve.steps[k]);
    }
  }
  return kept.reverse();
}

/**
 * The shortest slice of a solve: of the singles that can fill the cell at
 * its end, the one that needs the fewest of its steps — the first the grader
 * would try, among equals.
 */
export function sliceSolve(solve: CellSolve): SolveSlice {
  let best: SolveSlice | null = null;
  for (const final of solve.finals) {
    const kept = sliceFor(solve, final);
    if (best === null || kept.length < best.kept.length) best = { final, kept };
  }
  return best!;
}

/** Replay steps on `board`, which it changes: see `replaySteps`. */
function replayOn(board: SolverBoard, steps: readonly SolveStep[]): TechniqueTrace[] | null {
  const traces: TechniqueTrace[] = [];
  for (const recorded of steps) {
    const step = stepOn(board, recorded);
    if (!isStepValid(board, step)) return null;
    traces.push({ values: board.values.slice(), candidates: board.candidates.slice(), step });
    if (step.placement !== null) place(board, step.placement.index, step.placement.digit);
    for (const { index, mask } of step.eliminations) eliminate(board, index, mask);
  }
  return traces;
}

/**
 * Replay steps from `start`, each read afresh on the board the earlier ones
 * leave (step 3 above): the trace of every step, or null as soon as one does
 * not hold there. Pure; `start` is left as it was.
 */
export function replaySteps(
  start: SolverBoard,
  steps: readonly SolveStep[],
): TechniqueTrace[] | null {
  return replayOn(cloneBoard(start), steps);
}

/**
 * Replay steps from `start` without any the rest can do without (step 4
 * above): each is tried, last to first but for the single that ends them,
 * by replaying the others without it. The traces of what is left, or null
 * when the steps do not hold to begin with.
 *
 * Trying them last to first means the steps before the one being tried are
 * still as they were replayed at first, so each try starts from the board
 * they leave, and stops at the first step that no longer holds.
 */
function prune(start: SolverBoard, steps: readonly SolveStep[]): TechniqueTrace[] | null {
  const traces = replaySteps(start, steps);
  if (traces === null) return null;
  let rest = steps.slice(-1);
  for (let k = steps.length - 2; k >= 0; k--) {
    const { values: placed, candidates } = traces[k];
    const board: SolverBoard = { values: placed.slice(), candidates: candidates.slice() };
    if (replayOn(board, rest) === null) rest = [steps[k], ...rest];
  }
  // The steps left held when the last of them was tried, or are all of them.
  return replaySteps(start, rest)!;
}

/**
 * The steps that solve `target` from `board`, as few as the solve allows:
 * only the ones the cell depends on — none of which it could do without —
 * ending with the single that fills it. For a cell that is a single
 * already, that is the single alone.
 *
 * Null when there is none to show: the cell is not an empty cell of the
 * grid, the techniques stall before reaching it, or — when `solution` is
 * given — a placed digit disagrees with it, or an empty cell's answer is
 * missing from its candidates (no sound walkthrough starts from a mistake,
 * and one built on it could end in the wrong digit). Pure; `board` is left
 * as it was.
 *
 * Fast enough to call on a click or a selection change: it is one partial
 * solve, like `findHint`'s.
 */
export function explainCell(
  board: SolverBoard,
  target: number,
  solution?: Values,
): Walkthrough | null {
  if (solution !== undefined) {
    const { values, candidates } = board;
    for (let i = 0; i < 81; i++) {
      if (values[i] === 0 ? (candidates[i] & bit(solution[i])) === 0 : values[i] !== solution[i]) {
        return null;
      }
    }
  }
  const solve = solveToCell(board, target);
  if (solve === null) return null;
  const { final, kept } = sliceSolve(solve);
  const steps =
    prune(board, [...kept.map((k) => solve.steps[k]), final]) ??
    prune(board, [...solve.steps, final]);
  if (steps === null) return null;
  return { target, digit: final.placement!.digit, steps };
}

/**
 * The walkthrough for a hint's cell, if it has one: a single, a deduction or
 * a step can be shown; a mistake, a missing candidate (whose Show me is a
 * page of its own) or "nothing to suggest" cannot. See `explainCell`.
 */
export function explainHint(board: SolverBoard, hint: Hint, solution?: Values): Walkthrough | null {
  return hint.kind === 'single' || hint.kind === 'deduction' || hint.kind === 'step'
    ? explainCell(board, hint.index, solution)
    : null;
}

/**
 * What a walkthrough says of its cell, put as the hints were before they
 * named the next step: the single that fills it when that is the only step,
 * and otherwise a deduction naming the hardest technique among the steps.
 * For the cell `findHint` points at, that is its own hint (see above). The
 * hint bar puts a hint afresh as the next step instead (see `stepHint`).
 */
export function walkthroughHint(walkthrough: Walkthrough): FillHint {
  const { target: index, steps } = walkthrough;
  if (steps.length === 1) {
    const { technique, unit } = steps[0].step;
    // The last step fills the cell, so a step alone is a single.
    return { kind: 'single', index, technique: technique as SingleTechniqueId, unit };
  }
  let technique: TechniqueId | null = null;
  for (const { step } of steps) technique = harderTechnique(technique, step.technique);
  return { kind: 'deduction', index, technique };
}

/** The bits of a step's id (see `stepId`): four characters of a move log. */
export const STEP_ID_BITS = 24;

/**
 * The steps whose deduction is one digit's place in a few houses — locked
 * candidates and fish — told apart by those houses and that digit alone.
 */
const HOUSE_STEPS: ReadonlySet<TechniqueId> = new Set([
  'pointing',
  'claiming',
  'xWing',
  'swordfish',
]);

/** The subsets, told apart by their house, their cells and their digits. */
const SUBSETS: ReadonlySet<TechniqueId> = new Set([
  'nakedPair',
  'hiddenPair',
  'nakedTriple',
  'hiddenTriple',
]);

/**
 * What defines a step's deduction, beyond its technique, houses and digit:
 * the parts of its pattern a player can lose a candidate from without the
 * step becoming another (see `stepId`).
 *
 * - Locked candidates and fish: nothing more. Their houses and digit are the
 *   deduction; a cell of the pattern losing the digit, while the rest still
 *   lock it, leaves the same step.
 * - Subsets: their cells and the digits between them — not each cell's own,
 *   which shrink as the player strikes a subset digit a cell can't be
 *   (r4c4 losing its 9 leaves the same hidden triple in row 4).
 * - Singles, wings and chains: the pattern itself, cell by cell. A single's
 *   is its cell and digit; a wing's or chain's holds only candidates it
 *   can't lose and stay the same step (a pincer's two, a link's one), so
 *   any loss there makes it another step, or none.
 */
function patternKey({ technique, pattern }: SolveStep): string {
  if (HOUSE_STEPS.has(technique)) return '';
  if (SUBSETS.has(technique)) {
    const cells = pattern.map(({ index }) => index).sort((a, b) => a - b);
    let digits = 0;
    for (const { mask } of pattern) digits |= mask;
    return `${cells.join(',')}:${digits}`;
  }
  return pattern.map(({ index, mask }) => `${index}:${mask}`).join(',');
}

/**
 * What a step is, as a number: its technique, its houses, its digit and what
 * defines its pattern (see `patternKey`). Not the eliminations it makes,
 * which shrink as the player makes it a candidate at a time — a step half
 * taken is still that step — nor a candidate struck from its pattern that
 * leaves the deduction as it was, nor where it falls on a route, which moves
 * as the route is planned again. Read on any board that still holds the
 * deduction, the same step has the same id, so it is counted once however
 * the route round it changes; another step has another, bar a
 * one-in-16.7-million chance — the cost of fitting a log in four characters.
 */
export function stepId(step: SolveStep): number {
  const houses = step.houses.map(({ kind, index }) => `${kind}${index}`).join(',');
  const key = `${step.technique}|${houses}|${step.digit ?? ''}|${patternKey(step)}`;
  return seedFromString(key) & (2 ** STEP_ID_BITS - 1);
}

/** Where a step falls on a cell's route: step `step` of `of` (see `stepNumbering`). */
export interface StepNumber {
  step: number;
  of: number;
}

/**
 * Where a route of `length` steps to `index` stands — the steps behind it
 * counted against the route as first shown for the cell, which `previous`,
 * the cell's last step hint, numbers: so a hint asked for again once a step
 * is taken moves on, "Step 2 of 7", and Show me's pages go on from there.
 *
 * The steps left, `of - step + 1`, are always the route's own length; only
 * those behind are counted against the first plan, which a route planned
 * again may have outrun (a step taken a shorter way: "Step 4 of 7"). A route
 * longer than the first plan — a step undone, say, or a candidate put back —
 * can't be numbered against it, and starts afresh: "Step 1 of 8".
 */
export function stepNumbering(
  previous: Hint | null | undefined,
  index: number,
  length: number,
): StepNumber {
  if (previous?.kind !== 'step' || previous.index !== index || length > previous.of) {
    return { step: 1, of: length };
  }
  return { step: previous.of - length + 1, of: previous.of };
}

/** Show me's route to a cell, and how it is numbered: see `showMeRoute`. */
export interface ShowMeRoute {
  walkthrough: Walkthrough;
  /** Where its first page falls (see `stepNumbering`); each page after it is one on. */
  numbering: StepNumber;
}

/**
 * The route Show me walks to `index` in `state`, and its numbering: from
 * the board Hint reasons from, held to the solution, numbered on from the
 * cell's last step hint. Null when there is none to show (see
 * `explainCell`). The one place this is worked out, for Show me as it opens
 * and for playback, which numbers a logged page from the board before it:
 * the two must never tell a page's number differently.
 */
export function showMeRoute(state: GameState, index: number, solution: Values): ShowMeRoute | null {
  const walkthrough = explainCell(hintBoardOf(state), index, solution);
  if (walkthrough === null) return null;
  const previous = state.cellHints.get(index)?.fill;
  return { walkthrough, numbering: stepNumbering(previous, index, walkthrough.steps.length) };
}

/**
 * A walkthrough put as a step hint: its first step — the next to take, the
 * single that fills the cell when that is all there is — numbered against
 * `previous`, the cell's last step hint (see `stepNumbering`), with the
 * hardest technique among its steps.
 *
 * Its unit is the step's own; but a naked single that fills another cell
 * on the way, which has none, takes that cell's box, so the hint can say
 * where on the board it is rather than seem to be about the hinted cell.
 */
export function stepHint(walkthrough: Walkthrough, previous: Hint | null = null): StepHint {
  const { target: index, steps } = walkthrough;
  const { step: next } = steps[0];
  let hardest = next.technique;
  for (const { step } of steps) hardest = harderTechnique(hardest, step.technique);
  const { placement } = next;
  const isElsewhere = placement !== null && placement.index !== index;
  return {
    kind: 'step',
    index,
    technique: next.technique,
    unit: next.unit ?? (isElsewhere ? { kind: 'box', index: BOX[placement.index] } : null),
    ...stepNumbering(previous, index, steps.length),
    hardest,
    id: stepId(next),
  };
}
