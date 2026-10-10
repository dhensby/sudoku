import {
  DAILY_EPOCH,
  appendMove,
  createGame,
  createMoveLog,
  daysBetween,
  encodeGivens,
  encodeMoveLog,
  moveFor,
  reduce,
  formatGrid,
  gridValues,
  isDateKey,
  latestDateAnywhere,
  parseGrid,
  rate,
  type DateKey,
  type Difficulty,
  type Digit,
  type GameAction,
  type GridString,
  type Puzzle,
} from '../core';
import type { DailyStore } from '../daily/dailies';
import { DIFFICULTIES } from '../storage/storage';
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

/** A solved game's puzzle and move log, encoded as storage and links keep it. */
export interface SolveFixture {
  puzzle: Puzzle;
  /** The log, as `encodeMoveLog` writes it. */
  encoded: string;
}

/**
 * A short solve to play back: `nearlySolved([0, 40, 80])` (each blank a full
 * house), with a wrong 6 in row 1, column 1 left 4 s before it is put right
 * (a mistake that counts), a hint about row 5, column 5, and the rest placed
 * — five moves, the last at 0:09.
 */
export function shortSolve(): SolveFixture {
  const puzzle = nearlySolved([0, 40, 80]);
  const place = (index: number, digit: number): GameAction => ({
    type: 'enter',
    digit: digit as Digit,
    index,
    mode: 'normal',
  });
  const steps: readonly (readonly [atMs: number, action: GameAction])[] = [
    [1000, place(0, 6)],
    [5000, place(0, answerAt(0))],
    [
      6000,
      {
        type: 'hint',
        hint: {
          kind: 'single',
          index: 40,
          technique: 'fullHouse',
          unit: { kind: 'row', index: 4 },
        },
      },
    ],
    [7000, place(40, answerAt(40))],
    [9000, place(80, answerAt(80))],
  ];
  let game = createGame(puzzle);
  let log = createMoveLog();
  for (const [atMs, action] of steps) {
    const next = reduce(game, action);
    log = appendMove(log, moveFor(game, action, next)!, atMs);
    game = next;
  }
  return { puzzle, encoded: encodeMoveLog(log) };
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

/** Multipliers that shuffle the nine digits among themselves (each is coprime with 9). */
const SHUFFLES = [1, 2, 4, 5, 7, 8];

/**
 * A puzzle with its digits relabelled — the `n`th of 53 relabellings, none of
 * them the original: just as valid, and told apart by its givens.
 */
export function relabelled(puzzle: Puzzle, n: number): Puzzle {
  const k = SHUFFLES[(n + 1) % 6];
  const shift = Math.floor((n + 1) / 6) % 9;
  const relabel = (grid: string) =>
    grid.replace(/[1-9]/g, (d) => String((((Number(d) - 1) * k + shift) % 9) + 1));
  return { ...puzzle, givens: relabel(puzzle.givens), solution: relabel(puzzle.solution) };
}

/** A daily store for tests (see `fakeDailies`), which records what was asked of it. */
export interface FakeDailies extends DailyStore {
  /** Each daily dealt or looked up, as `date/tier`, in order. */
  asked: string[];
  /** Each date whose dailies were prefetched, in order. */
  prefetched: DateKey[];
  /** Deal everything held so far (see the `held` option), and hold nothing from now on. */
  release(): void;
}

export interface FakeDailiesOptions {
  /** A date's daily of a tier, by `date/tier`. Any other is PUZZLE relabelled, a different one per daily. */
  puzzles?: Record<string, Puzzle>;
  /** Dailies already dealt, by `date/tier`: to hand at once (`peekDaily`). */
  dealt?: string[];
  /** The wall clock, for which dates have a daily. Defaults to `Date.now`. */
  now?: () => number;
  /** Hold every deal until `release`, to see what waits for one. */
  held?: boolean;
  /** Fail every deal — with this error, if one is given. */
  failing?: boolean | Error;
}

/**
 * A synchronous stand-in for the daily store: each date's dailies, from
 * Daily #1 to the latest date begun anywhere, as `puzzles` gives them —
 * labelled with their tier, as the real store labels them — and otherwise
 * PUZZLE relabelled, so every daily is a different puzzle. Nothing is
 * generated, and nothing written to storage.
 */
export function fakeDailies(options: FakeDailiesOptions = {}): FakeDailies {
  const { puzzles = {}, now = Date.now, failing = false } = options;
  let isHeld = options.held ?? false;
  const dealt = new Set(options.dealt ?? []);
  const waiting: (() => void)[] = [];
  const hasDaily = (date: string): date is DateKey =>
    isDateKey(date) &&
    daysBetween(DAILY_EPOCH, date) >= 0 &&
    daysBetween(date, latestDateAnywhere(now())) >= 0;
  const puzzleFor = (date: DateKey, tier: Difficulty): Puzzle => {
    const given = puzzles[`${date}/${tier}`];
    if (given !== undefined) return { ...given, difficulty: tier };
    const n = (daysBetween(DAILY_EPOCH, date) * 4 + DIFFICULTIES.indexOf(tier)) % 53;
    return { ...relabelled(PUZZLE, n), difficulty: tier };
  };
  const deal = (date: DateKey, tier: Difficulty): Promise<Puzzle> => {
    store.asked.push(`${date}/${tier}`);
    const settle = (): Promise<Puzzle> => {
      if (failing !== false) {
        return Promise.reject(failing === true ? new Error('no dailies today') : failing);
      }
      dealt.add(`${date}/${tier}`);
      return Promise.resolve(puzzleFor(date, tier));
    };
    if (!isHeld) return settle();
    return new Promise<void>((resolve) => waiting.push(resolve)).then(settle);
  };
  const store: FakeDailies = {
    asked: [],
    prefetched: [],
    release() {
      isHeld = false;
      for (const resolve of waiting.splice(0)) resolve();
    },
    hasDaily,
    dailyPuzzle: async (date, tier) => (hasDaily(date) ? deal(date, tier) : null),
    peekDaily: (date, tier) =>
      hasDaily(date) && dealt.has(`${date}/${tier}`) ? puzzleFor(date, tier) : null,
    dailiesFor: async (date) => {
      if (!hasDaily(date)) return null;
      const found = await Promise.all(DIFFICULTIES.map((tier) => deal(date, tier)));
      return {
        date,
        number: daysBetween(DAILY_EPOCH, date) + 1,
        puzzles: Object.fromEntries(DIFFICULTIES.map((tier, i) => [tier, found[i]])) as Record<
          Difficulty,
          Puzzle
        >,
      };
    },
    findDaily: async (date, givens, firstTry) => {
      if (!hasDaily(date)) return null;
      for (const tier of new Set([
        ...(firstTry === undefined ? [] : [firstTry]),
        ...DIFFICULTIES,
      ])) {
        if ((await deal(date, tier)).givens === givens) return tier;
      }
      return null;
    },
    prefetch(date) {
      if (hasDaily(date)) store.prefetched.push(date);
    },
  };
  return store;
}
