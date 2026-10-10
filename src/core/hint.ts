import { TECHNIQUE_ORDER, harderTechnique, nextStep } from './grader';
import { POPCOUNT, bit } from './grid';
import { TECHNIQUES, cloneBoard, createBoard, type SolverBoard } from './techniques';
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
 * What the Hint button should point at, given the board to reason from — the
 * placed digits and the candidates the player has (see `hintBoardOf`) — and
 * the solution:
 *
 * 1. the first cell (reading order) whose value disagrees with the solution —
 *    every later deduction would be built on sand;
 * 2. the first empty cell whose answer is missing from its candidates,
 *    without saying which digit — a deduction from those candidates could
 *    lead anywhere, even to a single for the wrong digit;
 * 3. nothing, if the board is full;
 * 4. a single the player can see on the board, in technique order;
 * 5. otherwise, the next cell a logical solve from the board fills, with the
 *    hardest technique it took to get there — so a step the player has taken
 *    already is not the one it leads with again;
 * 6. should the techniques stall on the board before filling anything, the
 *    hint the placed digits and their naked candidates alone give, as hints
 *    were worked out before they read the player's candidates — and, should
 *    they stall there too, the first empty cell with the fewest of those
 *    candidates, with no technique to name.
 *
 * With every answer among the candidates, every technique is sound on them,
 * so the hint never leads away from the solution. Pure: the board is left as
 * it was.
 */
export function findHint(board: SolverBoard, solution: Values): Hint {
  const { values, candidates } = board;
  let isFull = true;
  for (let i = 0; i < 81; i++) {
    if (values[i] === 0) isFull = false;
    else if (values[i] !== solution[i]) return { kind: 'mistake', index: i };
  }
  for (let i = 0; i < 81; i++) {
    if (values[i] === 0 && (candidates[i] & bit(solution[i])) === 0) {
      return { kind: 'struck', index: i };
    }
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
  // from the digits alone, as far as the first placement — and, should that
  // stall, give the hint the digits alone give, unless that is this board.
  const deduction = deductionFrom(board);
  if (deduction !== null) return deduction;
  if (!isPlacedBoard(board)) return findHint(createBoard(values), solution);

  // Stalled before placing anything. Count the board's own candidates — what
  // auto candidate mode shows — rather than what is left after the solve's
  // eliminations: with no technique named to explain those, a cell picked by
  // them can look less constrained than its neighbours, and the hint arbitrary.
  let index = -1;
  for (let i = 0; i < 81; i++) {
    if (values[i] !== 0) continue;
    if (index === -1 || POPCOUNT[candidates[i]] < POPCOUNT[candidates[index]]) index = i;
  }
  return { kind: 'deduction', index, technique: null };
}

/**
 * The next cell a logical solve from `start` fills, with the hardest
 * technique it took to get there; null if the techniques stall before
 * filling anything. Pure.
 */
function deductionFrom(start: SolverBoard): Hint | null {
  const solve = cloneBoard(start);
  let hardest: TechniqueId | null = null;
  for (let step = nextStep(solve, TECHNIQUE_ORDER); step; step = nextStep(solve, TECHNIQUE_ORDER)) {
    hardest = harderTechnique(hardest, step.technique);
    if (step.placement) {
      return { kind: 'deduction', index: step.placement.index, technique: hardest };
    }
  }
  return null;
}

/** Whether a board's candidates are its placed digits' naked candidates, and nothing else. */
function isPlacedBoard(board: SolverBoard): boolean {
  const naked = createBoard(board.values).candidates;
  return naked.every((mask, i) => mask === board.candidates[i]);
}
