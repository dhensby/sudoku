import type { FillHint } from './game';
import { TECHNIQUE_ORDER, harderTechnique, nextStep, type TechniqueTrace } from './grader';
import { BOX, COL, PEERS, POPCOUNT, ROW, bit, digitsOf, lowestDigit, unitCells } from './grid';
import { isStepValid, reliance, stepOn } from './patterns';
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
 * The walkthrough for a hint's cell, if it has one: a single or a deduction
 * can be shown; a mistake, a missing candidate (whose Show me is a page of
 * its own) or "nothing to suggest" cannot. See `explainCell`.
 */
export function explainHint(board: SolverBoard, hint: Hint, solution?: Values): Walkthrough | null {
  return hint.kind === 'single' || hint.kind === 'deduction'
    ? explainCell(board, hint.index, solution)
    : null;
}

/**
 * What a walkthrough says of its cell, put as a hint: the single that fills
 * it when that is the only step, and otherwise a deduction naming the
 * hardest technique among the steps. For the cell Hint points at, that is
 * Hint's own hint (see above), so a hint given a while ago can be put
 * afresh for the board as it now stands — it may have moved on, so that
 * what took a hidden pair then takes a single now.
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
