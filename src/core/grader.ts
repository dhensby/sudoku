import { countFilled } from './grid';
import {
  TECHNIQUES,
  cloneBoard,
  createBoard,
  type SolveStep,
  type SolverBoard,
} from './techniques';
import type { Difficulty, TechniqueId, Values } from './types';

export type { Elimination, PatternCell, SolveStep } from './techniques';

/*
 * The grader: a human-style solve that always reaches for the easiest
 * technique that does something, and goes back to the easiest after every
 * step. A puzzle's tier is the tier of the hardest technique it could not do
 * without.
 *
 * Restarting from the top matters: carrying on with whatever worked last
 * would credit a puzzle with pairs it never needed. And because "solvable
 * with techniques up to k" doesn't depend on the order steps are found in,
 * the hardest technique — and so the tier — is stable under any relabelling
 * or reflection of the grid. The summed score is not (it follows the scan
 * order), which is why it only ever breaks ties.
 */

/**
 * Every technique, easiest first: the order the grader tries them in. Chains
 * come after the fish and wings, as the newest idea a player meets — which
 * also leaves every puzzle the earlier techniques can finish graded exactly
 * as it was before they were added.
 */
export const TECHNIQUE_ORDER: readonly TechniqueId[] = [
  'fullHouse',
  'hiddenSingleBox',
  'hiddenSingleLine',
  'nakedSingle',
  'pointing',
  'claiming',
  'nakedPair',
  'hiddenPair',
  'nakedTriple',
  'hiddenTriple',
  'xWing',
  'swordfish',
  'xyWing',
  'xyzWing',
  'skyscraper',
  'twoStringKite',
];

/**
 * The tier each technique belongs to, calibrated against NYT: Easy puzzles
 * need nothing beyond box hidden singles, Medium ones locked candidates, Hard
 * ones pairs and triples. Expert (fish, wings and chains) goes past anything
 * NYT publishes.
 */
export const TECHNIQUE_TIER: Readonly<Record<TechniqueId, Difficulty>> = {
  fullHouse: 'easy',
  hiddenSingleBox: 'easy',
  hiddenSingleLine: 'medium',
  nakedSingle: 'medium',
  pointing: 'medium',
  claiming: 'medium',
  nakedPair: 'hard',
  hiddenPair: 'hard',
  nakedTriple: 'hard',
  hiddenTriple: 'hard',
  xWing: 'expert',
  swordfish: 'expert',
  xyWing: 'expert',
  xyzWing: 'expert',
  skyscraper: 'expert',
  twoStringKite: 'expert',
};

/** HoDoKu's default score for each technique; a grade's score is their sum over its steps. */
export const TECHNIQUE_SCORE: Readonly<Record<TechniqueId, number>> = {
  fullHouse: 4,
  hiddenSingleBox: 14,
  hiddenSingleLine: 14,
  nakedSingle: 4,
  pointing: 50,
  claiming: 50,
  nakedPair: 60,
  hiddenPair: 70,
  nakedTriple: 80,
  hiddenTriple: 100,
  xWing: 140,
  swordfish: 150,
  xyWing: 160,
  xyzWing: 180,
  skyscraper: 130,
  twoStringKite: 150,
};

const TECHNIQUE_RANK = Object.fromEntries(TECHNIQUE_ORDER.map((id, rank) => [id, rank])) as Record<
  TechniqueId,
  number
>;

/** Whichever of two techniques comes later in `TECHNIQUE_ORDER`; `a` may be null for "none yet". */
export function harderTechnique(a: TechniqueId | null, b: TechniqueId): TechniqueId {
  return a !== null && TECHNIQUE_RANK[a] >= TECHNIQUE_RANK[b] ? a : b;
}

/** The outcome of a logical solve. */
export interface Grade {
  /** Whether the technique set filled the whole grid. */
  solved: boolean;
  /**
   * Hardest technique used (by TECHNIQUE_ORDER position); null if no step was
   * needed or none applied.
   */
  hardest: TechniqueId | null;
  /**
   * Tier of `hardest` when solved ('easy' for a grid that needed no step at
   * all); null when not solved by the set.
   */
  difficulty: Difficulty | null;
  /** Sum of TECHNIQUE_SCORE over steps (approximate: depends on scan order). */
  score: number;
  /** Every step taken, in order. */
  steps: SolveStep[];
  /** Cells in the order the logical solve filled them. */
  solveOrder: number[];
}

/**
 * Apply the easiest of `techniques` that does something, or return null if
 * none does: one step of the grader's solve.
 */
export function nextStep(board: SolverBoard, techniques: readonly TechniqueId[]): SolveStep | null {
  for (const id of techniques) {
    const step = TECHNIQUES[id](board);
    if (step) return step;
  }
  return null;
}

/**
 * Grade from the given values (givens, or givens + correct player values).
 * Pure; does not mutate input. Assumes a consistent grid — one that agrees
 * with a solution — as every puzzle from the generator or `checkGivens` is.
 *
 * `techniques` narrows the set (keep it easiest first); the generator uses it
 * to ask whether a puzzle falls to Easy techniques alone.
 */
export function grade(values: Values, techniques: readonly TechniqueId[] = TECHNIQUE_ORDER): Grade {
  const board = createBoard(values);
  const steps: SolveStep[] = [];
  const solveOrder: number[] = [];
  let hardest: TechniqueId | null = null;
  let score = 0;
  let filled = countFilled(board.values);

  while (filled < 81) {
    const step = nextStep(board, techniques);
    if (!step) break;
    steps.push(step);
    score += TECHNIQUE_SCORE[step.technique];
    hardest = harderTechnique(hardest, step.technique);
    if (step.placement) {
      solveOrder.push(step.placement.index);
      filled++;
    }
  }

  const solved = filled === 81;
  const difficulty = solved ? (hardest === null ? 'easy' : TECHNIQUE_TIER[hardest]) : null;
  return { solved, hardest, difficulty, score, steps, solveOrder };
}

/**
 * The tier a puzzle belongs to for labelling: tier of hardest technique;
 * 'expert' if the set cannot solve it; 'easy' if already complete.
 */
export function rate(values: Values): Difficulty {
  return grade(values).difficulty ?? 'expert';
}

/** A technique caught at work: the board just before one of its steps, and the step. */
export interface TechniqueTrace {
  /** The placed digits at that moment: the givens and every earlier placement. */
  values: Uint8Array;
  /**
   * The candidates as the solver had them at that moment: naked candidates
   * less every earlier elimination. 0 for a filled cell.
   */
  candidates: Uint16Array;
  /** The step, found on exactly that board. */
  step: SolveStep;
}

/**
 * Run the grader's solve from `values` — every technique, easiest first — and
 * stop just before the first step made by one of `techniques`. Null if the
 * solve finishes, or stalls, without one. Pure; does not mutate input.
 *
 * The trace shows a technique where a player following the easiest-first
 * route would meet it, so every easier technique is exhausted on that board.
 */
export function traceTechnique(
  values: Values,
  techniques: readonly TechniqueId[],
): TechniqueTrace | null {
  const board = createBoard(values);
  let filled = countFilled(board.values);
  while (filled < 81) {
    const before = cloneBoard(board);
    const step = nextStep(board, TECHNIQUE_ORDER);
    if (!step) return null;
    if (techniques.includes(step.technique)) {
      return { values: before.values, candidates: before.candidates, step };
    }
    if (step.placement) filled++;
  }
  return null;
}
