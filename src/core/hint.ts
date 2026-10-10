import { TECHNIQUE_ORDER, harderTechnique, nextStep } from './grader';
import { POPCOUNT } from './grid';
import { TECHNIQUES, cloneBoard, type SolverBoard } from './techniques';
import type { Hint, SingleTechniqueId, TechniqueId, Values } from './types';

/*
 * What the Hint button points at. Better than NYT's in one way: it names the
 * technique, so the player learns something rather than just being shown a
 * cell.
 *
 * It never fills anything in; it only says where to look and why.
 */

/** The singles a hint can point straight at, in the order the grader tries them. */
const SINGLES: readonly SingleTechniqueId[] = [
  'fullHouse',
  'hiddenSingleBox',
  'hiddenSingleLine',
  'nakedSingle',
];

/**
 * What the Hint button should point at, given the board to reason from and
 * the solution:
 *
 * 1. the first cell (reading order) whose value disagrees with the solution —
 *    every later deduction would be built on sand;
 * 2. nothing, if the board is full;
 * 3. a single the player can see on the board, in technique order;
 * 4. otherwise, the next cell a logical solve from the board fills, with the
 *    hardest technique it took to get there — or, when the techniques stall
 *    before filling anything, the first empty cell with the fewest of the
 *    board's candidates, with no technique to name.
 *
 * The board is today always `createBoard` of the placed digits — their naked
 * candidates, never the player's notes; taking a board rather than the digits
 * is what lets it one day be the candidates the player sees. Pure: the board
 * is left as it was.
 */
export function findHint(board: SolverBoard, solution: Values): Hint {
  const { values } = board;
  let isFull = true;
  for (let i = 0; i < 81; i++) {
    if (values[i] === 0) isFull = false;
    else if (values[i] !== solution[i]) return { kind: 'mistake', index: i };
  }
  if (isFull) return { kind: 'none' };

  // Each attempt gets a fresh board: a technique that finds its single
  // places it, and the hint must not leave the board in a different state
  // from the one the player sees.
  for (const technique of SINGLES) {
    const step = TECHNIQUES[technique](cloneBoard(board));
    if (step) return { kind: 'single', index: step.placement!.index, technique, unit: step.unit };
  }

  // No single in sight, so the first step of the grader's solve is an
  // elimination one. Solve as the grader would, from this board rather than
  // from the digits alone, as far as the first placement.
  const solve = cloneBoard(board);
  let hardest: TechniqueId | null = null;
  for (let step = nextStep(solve, TECHNIQUE_ORDER); step; step = nextStep(solve, TECHNIQUE_ORDER)) {
    hardest = harderTechnique(hardest, step.technique);
    if (step.placement) {
      return { kind: 'deduction', index: step.placement.index, technique: hardest };
    }
  }

  // Stalled before placing anything. Count the board's own candidates — what
  // auto-candidate mode shows — rather than what is left after the solve's
  // eliminations: with no technique named to explain those, a cell picked by
  // them can look less constrained than its neighbours, and the hint arbitrary.
  const { candidates } = board;
  let index = -1;
  for (let i = 0; i < 81; i++) {
    if (values[i] !== 0) continue;
    if (index === -1 || POPCOUNT[candidates[i]] < POPCOUNT[candidates[index]]) index = i;
  }
  return { kind: 'deduction', index, technique: null };
}
