import { TECHNIQUE_ORDER, harderTechnique, nextStep } from './grader';
import { POPCOUNT, bit } from './grid';
import { TECHNIQUES, cloneBoard, createBoard, type SolverBoard } from './techniques';
import type { Hint, SingleTechniqueId, TechniqueId, Values } from './types';
import { explainCell, explainHint, stepHint, type Walkthrough } from './walkthrough';

/*
 * What the Hint button points at. Better than NYT's in one way: it names the
 * technique, so the player learns something rather than just being shown a
 * cell — and, where the cell takes several steps, the next of them, so that
 * asking again after each step pages through them to the answer.
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

/** What `findStepHint` takes besides the board: see there. */
export interface StepHintOptions {
  /**
   * The cell the last hint was about, to stay on while the board still
   * reaches it as near as it was (see `findStepHint`); -1 (the default) for
   * none.
   */
  prefer?: number;
  /**
   * A cell's last step hint, which a route to it is numbered against (see
   * `stepNumbering`) and the cell to `prefer` is held to; none by default.
   */
  previous?: (index: number) => Hint | null;
}

/**
 * What the Hint button points at now, put as the next step on the way to a
 * cell (see `explainCell`): "Step 2 of 7: a hidden triple in
 * row 4." The route is the one Show me walks, from the same board, so a step
 * the player has taken already is not on it, and the last step is the single
 * that fills the cell.
 *
 * The cell is `findHint`'s — or the cell the last hint was about
 * (`prefer`), while it is empty and its route is no longer than the steps it
 * had left when last hinted: so the hint doesn't hop to another cell, and
 * lose the player's place on the way to this one, as they fill in cells
 * elsewhere. A route grown longer than that — a digit placed elsewhere can
 * make the easiest way there a long one — means the cell is no longer the
 * nearest thing to do, and the hint goes where `findHint` points.
 *
 * A mistake, a missing candidate or a full board is `findHint`'s to say, as
 * is a cell whose route the techniques can't find, which they stall short
 * of (the deduction with no technique, or the placed digits' own hint).
 * Pure.
 */
export function findStepHint(
  board: SolverBoard,
  solution: Values,
  options: StepHintOptions = {},
): Hint {
  return findStepRoute(board, solution, options).hint;
}

/** What `findStepRoute` finds: the hint, and the route a step hint is the next step on. */
export interface StepRoute {
  hint: Hint;
  /** The walkthrough a step hint is read from (its first step the one named); null for any other hint. */
  route: Walkthrough | null;
}

/**
 * `findStepHint`, with the route its step hint names the next step on — for
 * saying where on the board that step is, which the hint itself carries
 * only as one house (see `Hint`).
 */
export function findStepRoute(
  board: SolverBoard,
  solution: Values,
  options: StepHintOptions = {},
): StepRoute {
  const hint = findHint(board, solution);
  if (hint.kind !== 'single' && hint.kind !== 'deduction') return { hint, route: null };
  const { prefer = -1, previous = () => null } = options;
  // findHint has held the board to the solution: every route on it is sound.
  const before = isEmptyCell(board, prefer) ? previous(prefer) : null;
  const left = before?.kind === 'step' ? before.of - before.step + 1 : 0;
  const sticky = left > 0 ? explainCell(board, prefer) : null;
  const route = sticky !== null && sticky.steps.length <= left ? sticky : explainHint(board, hint);
  return route === null
    ? { hint, route }
    : { hint: stepHint(route, previous(route.target)), route };
}

/** Whether `index` is a cell of the grid with no digit placed. */
function isEmptyCell(board: SolverBoard, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < 81 && board.values[index] === 0;
}
