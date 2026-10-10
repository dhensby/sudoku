// @vitest-environment node
import { isDeepStrictEqual } from 'node:util';
import { TECHNIQUE_ORDER, grade, harderTechnique, nextStep, type TechniqueTrace } from './grader';
import {
  BOX,
  COL,
  POPCOUNT,
  ROW,
  bit,
  computeCandidates,
  digitsOf,
  formatGrid,
  lowestDigit,
  unitCells,
} from './grid';
import { findHint } from './hint';
import { isStepValid, stepOn } from './patterns';
import { mulberry32, shuffle, type RandomFn } from './rng';
import {
  TECHNIQUES,
  createBoard,
  eliminate,
  place,
  type SolveStep,
  type SolverBoard,
} from './techniques';
import type { Digit, Hint, SingleTechniqueId, TechniqueId, Unit, Values } from './types';
import {
  explainCell,
  explainHint,
  replaySteps,
  sliceSolve,
  solveToCell,
  type CellSolve,
  type Walkthrough,
} from './walkthrough';
import {
  BEYOND_THE_SET,
  EXPERT_SAMPLE,
  minimalPuzzles,
  solvedPuzzle,
  tierPuzzles,
} from '../test/logic-fixtures';

/*
 * The hint and the walkthrough used to start from the placed digits; now they
 * start from a solver board, so that one day they can be handed the player's
 * own candidates. Handed `createBoard` of the placed digits, they must do
 * exactly what they did before, to the last candidate of the last trace.
 *
 * `legacy` below is the old code, frozen as it stood before the change (bar
 * the names), and the sweep holds the new code to it over random positions
 * part way through generated puzzles: right digits dropped into a random
 * choice of empty cells — not the order any solve would fill them in — and,
 * now and then, a wrong one too.
 */

/* ---- The old code, frozen ------------------------------------------------ */

const legacy = (() => {
  const SINGLES: readonly SingleTechniqueId[] = [
    'fullHouse',
    'hiddenSingleBox',
    'hiddenSingleLine',
    'nakedSingle',
  ];

  function findHintFromValues(values: Values, solution: Values): Hint {
    let isFull = true;
    for (let i = 0; i < 81; i++) {
      if (values[i] === 0) isFull = false;
      else if (values[i] !== solution[i]) return { kind: 'mistake', index: i };
    }
    if (isFull) return { kind: 'none' };
    for (const technique of SINGLES) {
      const step = TECHNIQUES[technique](createBoard(values));
      if (step) return { kind: 'single', index: step.placement!.index, technique, unit: step.unit };
    }
    const { steps } = grade(values);
    let hardest: TechniqueId | null = null;
    for (const step of steps) {
      hardest = harderTechnique(hardest, step.technique);
      if (step.placement) {
        return { kind: 'deduction', index: step.placement.index, technique: hardest };
      }
    }
    const candidates = computeCandidates(values);
    let index = -1;
    for (let i = 0; i < 81; i++) {
      if (values[i] !== 0) continue;
      if (index === -1 || POPCOUNT[candidates[i]] < POPCOUNT[candidates[index]]) index = i;
    }
    return { kind: 'deduction', index, technique: null };
  }

  function housesOf(index: number): Unit[] {
    return [
      { kind: 'row', index: ROW[index] },
      { kind: 'column', index: COL[index] },
      { kind: 'box', index: BOX[index] },
    ];
  }

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

  function solveToCellFromValues(values: Values, target: number): CellSolve | null {
    if (!Number.isInteger(target) || target < 0 || target > 80 || values[target] !== 0) {
      return null;
    }
    const board = createBoard(values);
    const steps: SolveStep[] = [];
    const before: Uint16Array[] = [];
    for (;;) {
      const finals = singlesAt(board, target);
      if (finals.length > 0) return { steps, before, finals };
      const candidates = board.candidates.slice();
      const step = nextStep(board, TECHNIQUE_ORDER);
      if (step === null) return null;
      steps.push(step);
      before.push(candidates);
    }
  }

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

  function replayStepsFromValues(
    values: Values,
    steps: readonly SolveStep[],
  ): TechniqueTrace[] | null {
    return replayOn(createBoard(values), steps);
  }

  function prune(values: Values, steps: readonly SolveStep[]): TechniqueTrace[] | null {
    const traces = replayStepsFromValues(values, steps);
    if (traces === null) return null;
    let rest = steps.slice(-1);
    for (let k = steps.length - 2; k >= 0; k--) {
      const { values: placed, candidates } = traces[k];
      const board: SolverBoard = { values: placed.slice(), candidates: candidates.slice() };
      if (replayOn(board, rest) === null) rest = [steps[k], ...rest];
    }
    return replayStepsFromValues(values, rest)!;
  }

  function explainCellFromValues(
    values: Values,
    target: number,
    solution?: Values,
  ): Walkthrough | null {
    if (solution !== undefined) {
      for (let i = 0; i < 81; i++) if (values[i] !== 0 && values[i] !== solution[i]) return null;
    }
    const solve = solveToCellFromValues(values, target);
    if (solve === null) return null;
    const { final, kept } = sliceSolve(solve);
    const steps =
      prune(values, [...kept.map((k) => solve.steps[k]), final]) ??
      prune(values, [...solve.steps, final]);
    if (steps === null) return null;
    return { target, digit: final.placement!.digit, steps };
  }

  function explainHintFromValues(values: Values, hint: Hint, solution?: Values) {
    return hint.kind === 'single' || hint.kind === 'deduction'
      ? explainCellFromValues(values, hint.index, solution)
      : null;
  }

  return {
    findHint: findHintFromValues,
    solveToCell: solveToCellFromValues,
    replaySteps: replayStepsFromValues,
    explainCell: explainCellFromValues,
    explainHint: explainHintFromValues,
  };
})();

/* ---- The positions -------------------------------------------------------- */

/** A position part way through a puzzle, and the puzzle's solution. */
interface Position {
  label: string;
  values: Uint8Array;
  solution: Uint8Array;
}

/**
 * Positions from one puzzle, of two sorts:
 *
 * - `count` at random: a random share of its empty cells filled with their
 *   answers, and one in four with a wrong digit too — one the placed digits
 *   still allow, as a player's slip would be;
 * - every point along the grader's solve where it next needs an elimination
 *   rather than a single, which is where a hint names a deduction, and the
 *   point where it stalls, if it does.
 */
function positionsOf(
  name: string,
  givens: Uint8Array,
  solution: Uint8Array,
  rng: RandomFn,
  count: number,
): Position[] {
  const positions: Position[] = [];
  const at = (label: string, values: Uint8Array) =>
    positions.push({ label: `${name}, ${label}: ${formatGrid(values)}`, values, solution });
  const empty = Array.from({ length: 81 }, (_, i) => i).filter((i) => givens[i] === 0);
  for (let k = 0; k < count; k++) {
    const values = givens.slice();
    const order = shuffle(empty.slice(), rng);
    const filled = Math.floor(rng() * order.length);
    for (const i of order.slice(0, filled)) values[i] = solution[i];
    const cell = order[filled];
    if (rng() < 0.25 && cell !== undefined) {
      const wrong = digitsOf(computeCandidates(values)[cell]).filter((d) => d !== solution[cell]);
      if (wrong.length > 0) {
        values[cell] = wrong[Math.floor(rng() * wrong.length)];
        at(`random position ${k}, with a wrong digit`, values);
        continue;
      }
    }
    at(`random position ${k}`, values);
  }
  const values = givens.slice();
  let wasPlacement = true;
  for (const [k, { placement }] of grade(givens).steps.entries()) {
    if (placement === null && wasPlacement) at(`before solve step ${k}`, values.slice());
    wasPlacement = placement !== null;
    if (placement !== null) values[placement.index] = placement.digit;
  }
  if (values.includes(0)) at('where the grader stalls', values);
  return positions;
}

/** Up to `count` empty cells of `values`, picked at random, and the hint's cell. */
function targetsOf(values: Uint8Array, hint: Hint, rng: RandomFn, count: number): number[] {
  const empty = Array.from({ length: 81 }, (_, i) => i).filter((i) => values[i] === 0);
  const targets = shuffle(empty, rng).slice(0, count);
  if ('index' in hint && !targets.includes(hint.index)) targets.push(hint.index);
  return targets;
}

describe('hints and walkthroughs from a solver board', () => {
  it('do exactly what they did from the placed digits, from hundreds of random positions', () => {
    const rng = mulberry32(2026_10_10);
    const puzzles = [
      ...minimalPuzzles(48, 4_200).map((puzzle, k) => ({ name: `minimal ${k}`, ...puzzle })),
      ...tierPuzzles('hard', 4, 4_300).map((puzzle, k) => ({ name: `hard ${k}`, ...puzzle })),
      ...EXPERT_SAMPLE.map((fixture, k) => ({ name: `expert ${k}`, ...solvedPuzzle(fixture) })),
      { name: 'beyond the set', ...solvedPuzzle(BEYOND_THE_SET) },
    ];
    const problems: string[] = [];
    const seen = {
      positions: 0,
      mistakes: 0,
      deductions: 0,
      unnamed: 0,
      walkthroughs: 0,
      stalls: 0,
    };
    for (const { name, givens, solution } of puzzles) {
      for (const { label, values, solution: answer } of positionsOf(
        name,
        givens,
        solution,
        rng,
        10,
      )) {
        seen.positions++;
        const board = () => createBoard(values);
        const hint = legacy.findHint(values, answer);
        if (hint.kind === 'mistake') seen.mistakes++;
        if (hint.kind === 'deduction') seen[hint.technique === null ? 'unnamed' : 'deductions']++;
        if (!isDeepStrictEqual(findHint(board(), answer), hint)) {
          problems.push(`${label}: findHint differs`);
        }
        for (const solutionGiven of [answer, undefined]) {
          if (
            !isDeepStrictEqual(
              explainHint(board(), hint, solutionGiven),
              legacy.explainHint(values, hint, solutionGiven),
            )
          ) {
            problems.push(`${label}: explainHint differs`);
          }
        }
        for (const target of targetsOf(values, hint, rng, 3)) {
          const at = `${label}, cell ${target}`;
          const solve = legacy.solveToCell(values, target);
          if (!isDeepStrictEqual(solveToCell(board(), target), solve)) {
            problems.push(`${at}: solveToCell differs`);
          }
          if (solve === null) seen.stalls++;
          else {
            const { final, kept } = sliceSolve(solve);
            const slice = [...kept.map((k) => solve.steps[k]), final];
            if (
              !isDeepStrictEqual(replaySteps(board(), slice), legacy.replaySteps(values, slice))
            ) {
              problems.push(`${at}: replaySteps differs`);
            }
          }
          for (const solutionGiven of [answer, undefined]) {
            const walkthrough = legacy.explainCell(values, target, solutionGiven);
            if (walkthrough !== null) seen.walkthroughs++;
            if (!isDeepStrictEqual(explainCell(board(), target, solutionGiven), walkthrough)) {
              problems.push(`${at}: explainCell differs`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
    // Enough of each kind of answer to mean something: every kind of hint,
    // walkthroughs by the thousand, and solves that stall.
    expect(seen.positions).toBe(647);
    expect(seen.mistakes).toBeGreaterThan(50);
    expect(seen.deductions).toBeGreaterThan(40);
    expect(seen.unnamed).toBeGreaterThan(0);
    expect(seen.stalls).toBeGreaterThan(50);
    expect(seen.walkthroughs).toBeGreaterThan(4000);
  }, 120_000);

  it('leave the board they are handed as it was', () => {
    const [{ givens, solution }] = minimalPuzzles(1, 4_200);
    const board = createBoard(givens);
    const copy = { values: board.values.slice(), candidates: board.candidates.slice() };
    const hint = findHint(board, solution);
    explainHint(board, hint, solution);
    const target = givens.indexOf(0);
    const solve = solveToCell(board, target)!;
    replaySteps(board, solve.steps);
    expect(board).toEqual(copy);
  });
});
