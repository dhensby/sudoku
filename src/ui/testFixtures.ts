import {
  encodeGivens,
  formatGrid,
  gridValues,
  parseGrid,
  rate,
  type Difficulty,
  type GridString,
  type Puzzle,
} from '../core';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import type { PuzzleSource } from './puzzleSource';

/*
 * Puzzles and puzzle sources for the UI's tests. Test-only: nothing in the
 * app imports this module.
 */

/** The Wikipedia puzzle, labelled with the tier the grader gives it. */
export const PUZZLE: Puzzle = (() => {
  const givens = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
  return {
    givens,
    solution: formatGrid(parseGrid(WIKIPEDIA_SOLUTION)),
    difficulty: rate(gridValues(givens)),
  };
})();

/** The first empty cell of PUZZLE, which a new game selects. */
export const FIRST_EMPTY = PUZZLE.givens.indexOf('0');

/** The solution digit of PUZZLE at a cell. */
export function answerAt(index: number, puzzle: Puzzle = PUZZLE): number {
  return Number(puzzle.solution[index]);
}

/**
 * A puzzle a few moves from solved: the solution with `blanks` emptied.
 * Labelled with the tier the grader gives it, as a link's puzzle would be.
 */
export function nearlySolved(blanks: readonly number[], solution: GridString = PUZZLE.solution) {
  const cells = solution.split('');
  for (const index of blanks) cells[index] = '0';
  const givens = cells.join('');
  return { givens, solution, difficulty: rate(gridValues(givens)) } satisfies Puzzle;
}

/** A query string for a share link to `givens`, with optional result parameters. */
export function linkFor(givens: GridString, result: Record<string, string> = {}): string {
  return `?${new URLSearchParams({ p: encodeGivens(givens), ...result }).toString()}`;
}

/** A puzzle source that hands out `puzzles` in turn (the last one repeating), and records what was asked for. */
export interface FakeSource extends PuzzleSource {
  requests: Difficulty[];
  prefetches: Difficulty[];
  isDisposed: boolean;
}

/**
 * A synchronous puzzle source for tests: each `next` resolves at once with
 * the next puzzle — relabelled with the tier asked for, as the generator
 * would — and nothing runs in the background.
 */
export function fakeSource(...puzzles: Puzzle[]): FakeSource {
  const queue = puzzles.length === 0 ? [PUZZLE] : puzzles;
  let served = 0;
  const source: FakeSource = {
    requests: [],
    prefetches: [],
    isDisposed: false,
    next(difficulty) {
      source.requests.push(difficulty);
      const puzzle = queue[Math.min(served, queue.length - 1)];
      served++;
      return Promise.resolve({ ...puzzle, difficulty });
    },
    prefetch(difficulty) {
      source.prefetches.push(difficulty);
    },
    dispose() {
      source.isDisposed = true;
    },
  };
  return source;
}

/** A source whose every request fails. */
export function failingSource(): PuzzleSource {
  return {
    next: () => Promise.reject(new Error('no puzzles today')),
    prefetch: () => {},
    dispose: () => {},
  };
}
