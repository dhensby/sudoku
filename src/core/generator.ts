import { TECHNIQUE_TIER, grade, type Grade } from './grader';
import { ALL_DIGITS, BOX, COL, ROW, bit, countFilled, digitsOf, formatGrid } from './grid';
import { shuffle, type RandomFn } from './rng';
import { hasUniqueSolution } from './solver';
import type { Difficulty, Puzzle, TechniqueId, Values } from './types';

/*
 * Puzzle generation: fill a random grid, dig givens out of it in random order
 * until every remaining one is needed, then grade the result and keep it only
 * if it lands in the requested tier.
 *
 * The rules are calibrated against NYT's own puzzles: none are symmetric;
 * Easy always has exactly 38 givens and needs nothing beyond box hidden
 * singles; Medium and Hard are minimal (21–27 givens) and differ only in the
 * techniques they need. So the given count is never used as a difficulty
 * dial.
 *
 * Expert goes past NYT, so it has no puzzles to be calibrated against; what
 * it is held to instead is needing its fish, wing or chain while much of the
 * grid is still open (see `EXPERT_MIN_EMPTY`).
 *
 * Everything is a pure function of the random source: Fisher–Yates shuffles
 * only, no `Math.random`, no wall clock, and work is capped by attempt count
 * rather than time — a time budget would make the output depend on how fast
 * the device is.
 */

/**
 * Bump whenever the output for a given random source could change: the
 * shuffles or loop orders, the solver's search order, the technique set or
 * order, the tier rules or the attempt cap.
 */
export const GENERATOR_VERSION = 7;

/** Options for `generatePuzzle`. */
export interface GenerateOptions {
  /**
   * Attempts before falling back (default 1000). Rounded down, and at least
   * one attempt is always made; NaN counts as unset. Easy puzzles are built
   * directly and never need a second attempt.
   */
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 1000;

/** NYT's Easy puzzles have exactly this many givens, every time. */
const EASY_GIVENS = 38;

/** The techniques an Easy puzzle may need. */
const EASY_TECHNIQUES: readonly TechniqueId[] = ['fullHouse', 'hiddenSingleBox'];

/**
 * The cells an Expert puzzle must still have empty when everything easier
 * runs out. Left to chance, a minimal puzzle that needs a fish, a wing or a
 * chain typically gets by on easier techniques until the grid is nearly
 * two-thirds full, then needs one — late, where it is quick to spot or to
 * guess past — and plays like a Hard. Held to this, its first Expert step
 * comes with about as much of the grid open as when a Hard first needs its
 * pair.
 */
const EXPERT_MIN_EMPTY = 40;

/** Tiers in order, for measuring how far an attempt landed from its target. */
const TIER_RANK: Readonly<Record<Difficulty, number>> = { easy: 0, medium: 1, hard: 2, expert: 3 };

/** A random complete valid grid (randomised backtracking, Fisher–Yates digit order). */
export function randomSolution(rng: RandomFn): Uint8Array {
  const grid = new Uint8Array(81);
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);

  // Cells in reading order, each trying its legal digits in a shuffled order.
  // The masks catch a dead end the moment a cell has nothing left, so the
  // search almost never has to back up more than a cell or two.
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    const r = ROW[i];
    const c = COL[i];
    const b = BOX[i];
    const free = ALL_DIGITS & ~(rows[r] | cols[c] | boxes[b]);
    for (const digit of shuffle(digitsOf(free), rng)) {
      const digitBit = bit(digit);
      rows[r] |= digitBit;
      cols[c] |= digitBit;
      boxes[b] |= digitBit;
      grid[i] = digit;
      if (fill(i + 1)) return true;
      rows[r] ^= digitBit;
      cols[c] ^= digitBit;
      boxes[b] ^= digitBit;
    }
    grid[i] = 0;
    return false;
  };

  fill(0);
  return grid;
}

/**
 * Remove givens in random order while the puzzle stays unique → a minimal
 * puzzle.
 *
 * One pass is enough: removing a later given can only add solutions, so a
 * given that was needed when it was tried is still needed at the end. Cells
 * already empty in the input are left alone, so this also minimises a puzzle
 * — given one with a unique solution to begin with.
 */
export function digMinimal(solution: Values, rng: RandomFn): Uint8Array {
  const puzzle = Uint8Array.from(solution);
  const order = shuffle(
    Array.from({ length: 81 }, (_, i) => i),
    rng,
  );
  for (const i of order) {
    const held = puzzle[i];
    if (held === 0) continue;
    puzzle[i] = 0;
    if (!hasUniqueSolution(puzzle)) puzzle[i] = held;
  }
  return puzzle;
}

/**
 * How many cells were still empty when the solve of `givens` took its first
 * Expert step — that is, when everything easier had run out, as the grader
 * always tries the easiest first. For a solve that takes one.
 */
function emptyAtFirstExpertStep(givens: Values, result: Grade): number {
  let empty = 81 - countFilled(givens);
  for (const step of result.steps) {
    if (TECHNIQUE_TIER[step.technique] === 'expert') break;
    if (step.placement) empty--;
  }
  return empty;
}

/** Whether a graded minimal puzzle is exactly what was asked for. */
function isOnTarget(givens: Values, result: Grade, difficulty: Difficulty): boolean {
  // Medium has to genuinely need locked candidates: a puzzle that only needs
  // naked singles is Medium by tier, but plays like an Easy with a snag. (And
  // `hardest` alone is not enough: a solve can use pointing and then stall.)
  if (difficulty === 'medium') {
    return result.solved && (result.hardest === 'pointing' || result.hardest === 'claiming');
  }
  // Expert, likewise, has to need its technique early: one needed only once
  // the grid has nearly filled up is Expert by tier, but plays like a Hard.
  // (Graded Expert, the solve is sure to have taken an Expert step.)
  if (difficulty === 'expert') {
    return (
      result.difficulty === 'expert' && emptyAtFirstExpertStep(givens, result) >= EXPERT_MIN_EMPTY
    );
  }
  return result.difficulty === difficulty;
}

/**
 * Easy: start from a minimal puzzle and, while box hidden singles can't finish
 * it, hand back the solution digit of a random cell still empty where they got
 * stuck. Then pad with random givens up to NYT's 38.
 *
 * Adding a given never makes a puzzle harder, so the result stays Easy; and it
 * never breaks uniqueness, so no attempt is ever thrown away.
 */
function generateEasy(rng: RandomFn): Puzzle {
  const solution = randomSolution(rng);
  const givens = digMinimal(solution, rng);
  for (;;) {
    const result = grade(givens, EASY_TECHNIQUES);
    if (result.solved) break;
    const reached = new Set(result.solveOrder);
    const stuck: number[] = [];
    for (let i = 0; i < 81; i++) if (givens[i] === 0 && !reached.has(i)) stuck.push(i);
    const i = stuck[Math.floor(rng() * stuck.length)];
    givens[i] = solution[i];
  }
  const empties: number[] = [];
  for (let i = 0; i < 81; i++) if (givens[i] === 0) empties.push(i);
  shuffle(empties, rng);
  // Already past 38 because a stubborn grid needed many givens back? Keep it
  // as it is (possible, though never seen in 3,000 seeds).
  for (let n = countFilled(givens); n < EASY_GIVENS; n++) {
    const i = empties.pop()!;
    givens[i] = solution[i];
  }
  return { givens: formatGrid(givens), solution: formatGrid(solution), difficulty: 'easy' };
}

/** A candidate puzzle and where it landed. */
interface Attempt {
  givens: Uint8Array;
  solution: Uint8Array;
  /** Its true tier — the label it gets if it is the one returned. */
  difficulty: Difficulty;
  /** How close it is to the target: lower is better (see `preferenceOf`). */
  preference: number;
}

/**
 * How close a graded attempt that missed is to the target, for the fallback:
 * lower is better.
 *
 * Closeness goes by the label the attempt would be returned with, which is
 * what `rate` says — so a puzzle the set can't solve counts as Expert, and an
 * Expert request takes it over a solved Hard. Ties go to the easier tier and,
 * within a tier, to a puzzle the set solves over one it can't: the easier of
 * the two again.
 */
function preferenceOf(result: Grade, target: Difficulty): number {
  const rank = TIER_RANK[result.difficulty ?? 'expert'];
  // Each key stays below the next one's multiplier, so they never mix.
  return Math.abs(rank - TIER_RANK[target]) * 100 + rank * 10 + (result.solved ? 0 : 1);
}

/**
 * A puzzle of the requested tier. Pure function of (difficulty, rng state,
 * options).
 *
 * Medium, Hard and Expert are generate-and-test over minimal puzzles. About
 * one random minimal puzzle in eight needs locked candidates, one in fifteen
 * pairs or triples, and one in eight a fish, wing or chain early enough for
 * Expert, so no tier usually needs more than a few dozen attempts. If
 * `maxAttempts` (at least one is always made) runs out first, the attempt
 * whose tier — as `rate` would label it — is closest to the target is
 * returned, labelled with that actual tier, never the one asked for. An
 * Expert that needs its technique only late, like a Medium that needs only
 * singles, counts as the right tier there: it is what `rate` calls it, so it
 * beats anything easier or beyond the set.
 */
export function generatePuzzle(
  difficulty: Difficulty,
  rng: RandomFn,
  options: GenerateOptions = {},
): Puzzle {
  if (difficulty === 'easy') return generateEasy(rng);

  // NaN (a caller's slip, say a bad field in a worker message) would skip the
  // loop and leave nothing to return, so it counts as unset.
  const requested = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const attempts = Number.isNaN(requested)
    ? DEFAULT_MAX_ATTEMPTS
    : Math.max(1, Math.floor(requested));
  let fallback: Attempt | null = null;
  for (let n = 0; n < attempts; n++) {
    const solution = randomSolution(rng);
    const givens = digMinimal(solution, rng);
    const result = grade(givens);
    if (isOnTarget(givens, result, difficulty)) {
      return { givens: formatGrid(givens), solution: formatGrid(solution), difficulty };
    }
    const preference = preferenceOf(result, difficulty);
    // Strictly better only, so the earliest attempt wins a full tie.
    if (fallback === null || preference < fallback.preference) {
      fallback = { givens, solution, difficulty: result.difficulty ?? 'expert', preference };
    }
  }
  const { givens, solution, difficulty: actual } = fallback!;
  return { givens: formatGrid(givens), solution: formatGrid(solution), difficulty: actual };
}
