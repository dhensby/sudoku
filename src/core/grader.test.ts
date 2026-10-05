import {
  TECHNIQUE_ORDER,
  TECHNIQUE_SCORE,
  TECHNIQUE_TIER,
  grade,
  harderTechnique,
  rate,
  type Grade,
} from './grader';
import { formatGrid, parseGrid } from './grid';
import { TECHNIQUES, cloneBoard, createBoard } from './techniques';
import type { Difficulty, TechniqueId } from './types';
import { EMPTY_GRID, WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import {
  ALL_FIXTURES,
  BEYOND_THE_SET,
  HARDEST,
  minimalPuzzles,
  solvedPuzzle,
} from '../test/logic-fixtures';

const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

describe('technique tables', () => {
  // The spec's table, row by row: order, tier and HoDoKu score.
  it.each<[TechniqueId, Difficulty, number]>([
    ['fullHouse', 'easy', 4],
    ['hiddenSingleBox', 'easy', 14],
    ['hiddenSingleLine', 'medium', 14],
    ['nakedSingle', 'medium', 4],
    ['pointing', 'medium', 50],
    ['claiming', 'medium', 50],
    ['nakedPair', 'hard', 60],
    ['hiddenPair', 'hard', 70],
    ['nakedTriple', 'hard', 80],
    ['hiddenTriple', 'hard', 100],
    ['xWing', 'expert', 140],
    ['swordfish', 'expert', 150],
    ['xyWing', 'expert', 160],
    ['xyzWing', 'expert', 180],
  ])('ranks %s as %s, scoring %i', (id, tier, score) => {
    expect(TECHNIQUE_TIER[id]).toBe(tier);
    expect(TECHNIQUE_SCORE[id]).toBe(score);
  });

  it('tries every technique exactly once, easiest first', () => {
    expect(TECHNIQUE_ORDER).toEqual(Object.keys(TECHNIQUE_TIER));
    expect(new Set(TECHNIQUE_ORDER).size).toBe(14);
    expect(Object.keys(TECHNIQUES).sort()).toEqual([...TECHNIQUE_ORDER].sort());
  });

  it('never gets easier further down the order, so the hardest step decides the tier', () => {
    const ranks = TECHNIQUE_ORDER.map((id) => DIFFICULTY_ORDER.indexOf(TECHNIQUE_TIER[id]));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('picks the later of two techniques', () => {
    expect(harderTechnique(null, 'pointing')).toBe('pointing');
    expect(harderTechnique('pointing', 'nakedSingle')).toBe('pointing');
    expect(harderTechnique('nakedSingle', 'pointing')).toBe('pointing');
    expect(harderTechnique('pointing', 'pointing')).toBe('pointing');
  });
});

/** Checks every grade must pass, whatever the puzzle. */
function checkAccounting(values: Uint8Array, result: Grade): void {
  // A step counts only if it did something, and does exactly one kind of thing.
  for (const step of result.steps) {
    if (step.placement) expect(step.eliminations).toEqual([]);
    else expect(step.eliminations.length).toBeGreaterThan(0);
  }
  // The score is the sum over the steps, nothing more.
  expect(result.score).toBe(result.steps.reduce((sum, s) => sum + TECHNIQUE_SCORE[s.technique], 0));
  // solveOrder is the placements, in order, each cell at most once and never a given.
  const placed = result.steps.flatMap((s) => (s.placement ? [s.placement.index] : []));
  expect(result.solveOrder).toEqual(placed);
  expect(new Set(placed).size).toBe(placed.length);
  for (const i of placed) expect(values[i]).toBe(0);
  if (result.solved) {
    // ...and when solved, it covers every empty cell.
    const empties = [...values.keys()].filter((i) => values[i] === 0);
    expect([...result.solveOrder].sort((a, b) => a - b)).toEqual(empties);
  }
  // The hardest technique is the latest in the order among the steps.
  const ranks = result.steps.map((s) => TECHNIQUE_ORDER.indexOf(s.technique));
  expect(result.hardest).toBe(ranks.length ? TECHNIQUE_ORDER[Math.max(...ranks)] : null);
}

describe('grade', () => {
  it('needs nothing for a complete grid, which counts as easy', () => {
    expect(grade(parseGrid(WIKIPEDIA_SOLUTION))).toEqual({
      solved: true,
      hardest: null,
      difficulty: 'easy',
      score: 0,
      steps: [],
      solveOrder: [],
    });
  });

  it('gets nowhere on an empty grid, and says so', () => {
    expect(grade(parseGrid(EMPTY_GRID))).toEqual({
      solved: false,
      hardest: null,
      difficulty: null,
      score: 0,
      steps: [],
      solveOrder: [],
    });
  });

  it('solves the Wikipedia puzzle with box hidden singles and full houses', () => {
    const values = parseGrid(WIKIPEDIA_PUZZLE);
    const result = grade(values);
    expect(result).toMatchObject({ solved: true, hardest: 'hiddenSingleBox', difficulty: 'easy' });
    expect(result.steps[0]).toEqual({
      technique: 'hiddenSingleBox',
      placement: { index: 5, digit: 8 },
      eliminations: [],
      unit: { kind: 'box', index: 1 },
    });
    checkAccounting(values, result);
  });

  it('does not modify its input, and accepts plain arrays', () => {
    const values = parseGrid(WIKIPEDIA_PUZZLE);
    const before = formatGrid(values);
    const result = grade(values);
    expect(formatGrid(values)).toBe(before);
    expect(grade(Array.from(values))).toEqual(result);
  });

  it.each(Object.entries(HARDEST) as [TechniqueId, (typeof HARDEST)['pointing']][])(
    'grades a puzzle that needs %s by that technique',
    (id, fixture) => {
      const { givens } = solvedPuzzle(fixture);
      const result = grade(givens);
      expect(result.solved).toBe(true);
      expect(result.hardest).toBe(id);
      expect(result.difficulty).toBe(TECHNIQUE_TIER[id]);
      checkAccounting(givens, result);
    },
  );

  it('reports a puzzle beyond the technique set as unsolved, with what it did manage', () => {
    const { givens } = solvedPuzzle(BEYOND_THE_SET);
    const result = grade(givens);
    expect(result.solved).toBe(false);
    expect(result.difficulty).toBeNull();
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.hardest).not.toBeNull();
    checkAccounting(givens, result);
  });

  it('can be limited to a subset of techniques', () => {
    // The pointing puzzle can't be finished by easy techniques alone.
    const { givens } = solvedPuzzle(HARDEST.pointing);
    const easy: TechniqueId[] = ['fullHouse', 'hiddenSingleBox'];
    const result = grade(givens, easy);
    expect(result.solved).toBe(false);
    expect(result.difficulty).toBeNull();
    expect(result.steps.every((s) => easy.includes(s.technique))).toBe(true);
    expect(
      grade(solvedPuzzle(HARDEST.hiddenSingleBox).givens, ['fullHouse', 'hiddenSingleBox']),
    ).toMatchObject({ solved: true, difficulty: 'easy' });
  });

  /*
   * Restart from the easiest technique after every step. Replaying a solve,
   * no technique earlier in the order than the one each step used may have
   * been available at that point — otherwise the grader carried on with a
   * hard technique where an easy one would have done, inflating the grade.
   */
  it.each(ALL_FIXTURES)(
    'goes back to the easiest technique after every step (%s)',
    (_, fixture) => {
      const { givens } = solvedPuzzle(fixture);
      const board = createBoard(givens);
      for (const step of grade(givens).steps) {
        for (const earlier of TECHNIQUE_ORDER.slice(0, TECHNIQUE_ORDER.indexOf(step.technique))) {
          expect(TECHNIQUES[earlier](cloneBoard(board))).toBeNull();
        }
        expect(TECHNIQUES[step.technique](board)).toEqual(step);
      }
    },
  );

  /*
   * A snapshot of how the grader rates the raw material: the hardest
   * technique needed by each of 100 random minimal puzzles. Any change to a
   * technique, the order or the dig shows up here first — and is a change to
   * generated puzzles, so GENERATOR_VERSION has to move with it. Digging and
   * grading a hundred puzzles takes well under a second on its own, but can
   * take many times that under coverage on a busy CI runner — hence the
   * generous timeout.
   */
  it('rates a fixed corpus of random minimal puzzles exactly as before', () => {
    const histogram: Record<string, number> = {};
    for (const { givens } of minimalPuzzles(100)) {
      const result = grade(givens);
      checkAccounting(givens, result);
      const key = result.solved ? result.hardest! : 'unsolved';
      histogram[key] = (histogram[key] ?? 0) + 1;
    }
    expect(histogram).toEqual({
      hiddenSingleBox: 1,
      hiddenSingleLine: 24,
      nakedSingle: 17,
      pointing: 6,
      claiming: 4,
      nakedPair: 7,
      hiddenPair: 2,
      nakedTriple: 1,
      xyWing: 6,
      unsolved: 32,
    });
  }, 60_000);
});

describe('rate', () => {
  it('rates a complete grid easy', () => {
    expect(rate(parseGrid(WIKIPEDIA_SOLUTION))).toBe('easy');
  });

  it.each(Object.entries(HARDEST) as [TechniqueId, (typeof HARDEST)['pointing']][])(
    'rates a puzzle needing %s by its tier',
    (id, fixture) => {
      expect(rate(solvedPuzzle(fixture).givens)).toBe(TECHNIQUE_TIER[id]);
    },
  );

  it('rates a puzzle beyond the technique set expert, never lower', () => {
    expect(rate(solvedPuzzle(BEYOND_THE_SET).givens)).toBe('expert');
  });
});
