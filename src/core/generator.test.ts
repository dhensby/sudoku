import { GENERATOR_VERSION, digMinimal, generatePuzzle, randomSolution } from './generator';
import { TECHNIQUE_TIER, grade, rate, type Grade } from './grader';
import { UNITS, countFilled, formatGrid, gridValues, parseGrid } from './grid';
import { mulberry32 } from './rng';
import { countSolutions, hasUniqueSolution, solve } from './solver';
import type { Difficulty, Puzzle } from './types';
import { WIKIPEDIA_PUZZLE } from '../test/grids';
import { checkSoundness, solvedPuzzle } from '../test/logic-fixtures';

const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

/** Every row, column and box holds 1–9 once each. */
function isValidSolution(values: ArrayLike<number>): boolean {
  return UNITS.every(
    (unit) =>
      unit
        .map((i) => values[i])
        .sort((a, b) => a - b)
        .join('') === '123456789',
  );
}

/** Every given is needed: taking any one away lets in a second solution. */
function isMinimal(givens: Uint8Array): boolean {
  const probe = givens.slice();
  for (let i = 0; i < 81; i++) {
    if (probe[i] === 0) continue;
    probe[i] = 0;
    const isStillUnique = hasUniqueSolution(probe);
    probe[i] = givens[i];
    if (isStillUnique) return false;
  }
  return true;
}

/** Every given agrees with the solution. */
function isSubsetOf(givens: ArrayLike<number>, solution: ArrayLike<number>): boolean {
  for (let i = 0; i < 81; i++) if (givens[i] !== 0 && givens[i] !== solution[i]) return false;
  return true;
}

/**
 * The cells still empty when a solve first takes an Expert step, replaying
 * its placements one by one; null if it never takes one.
 */
function emptyAtFirstExpertStep(givens: ArrayLike<number>, result: Grade): number | null {
  const index = result.steps.findIndex((step) => TECHNIQUE_TIER[step.technique] === 'expert');
  if (index === -1) return null;
  const placedBefore = result.steps.slice(0, index).filter((step) => step.placement).length;
  return 81 - countFilled(givens) - placedBefore;
}

describe('GENERATOR_VERSION', () => {
  it('is pinned, so a change to generated puzzles has to be deliberate', () => {
    expect(GENERATOR_VERSION).toBe(4);
  });
});

describe('randomSolution', () => {
  it('fills a complete, valid grid', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const grid = randomSolution(mulberry32(seed));
      expect(isValidSolution(grid)).toBe(true);
    }
  });

  it('is reproducible from a seed, and differs between seeds', () => {
    expect(randomSolution(mulberry32(7))).toEqual(randomSolution(mulberry32(7)));
    expect(randomSolution(mulberry32(7))).not.toEqual(randomSolution(mulberry32(8)));
  });
});

describe('digMinimal', () => {
  const solution = randomSolution(mulberry32(11));

  it('digs a unique, minimal puzzle out of a solution', () => {
    const puzzle = digMinimal(solution, mulberry32(12));
    expect(countFilled(puzzle)).toBeLessThan(81);
    expect(isSubsetOf(puzzle, solution)).toBe(true);
    expect(formatGrid(solve(puzzle)!)).toBe(formatGrid(solution));
    expect(hasUniqueSolution(puzzle)).toBe(true);
    expect(isMinimal(puzzle)).toBe(true);
  });

  it('leaves its input alone and is reproducible from a seed', () => {
    const before = formatGrid(solution);
    const puzzle = digMinimal(solution, mulberry32(12));
    expect(formatGrid(solution)).toBe(before);
    expect(puzzle).not.toBe(solution);
    expect(digMinimal(solution, mulberry32(12))).toEqual(puzzle);
  });

  it('minimises an existing puzzle, only ever removing givens', () => {
    // The Wikipedia puzzle has 30 givens and is far from minimal.
    const original = parseGrid(WIKIPEDIA_PUZZLE);
    const puzzle = digMinimal(Array.from(original), mulberry32(3));
    expect(countFilled(puzzle)).toBeLessThan(30);
    expect(isSubsetOf(puzzle, original)).toBe(true);
    expect(hasUniqueSolution(puzzle)).toBe(true);
    expect(isMinimal(puzzle)).toBe(true);
  });
});

describe('generatePuzzle', () => {
  /*
   * Golden output: a puzzle is a pure function of (tier, random source,
   * GENERATOR_VERSION). If one of these changes, every seeded puzzle changed —
   * bump GENERATOR_VERSION and update them together.
   */
  it.each<[Difficulty, Puzzle]>([
    [
      'easy',
      {
        givens: '002000803190038600000026510000010362030407080000290045549000070720659000008702150',
        solution:
          '652174893197538624483926517974815362235467981816293745549381276721659438368742159',
        difficulty: 'easy',
      },
    ],
    [
      'medium',
      {
        givens: '000800007604000900007050030030500000000100009060008504000000000309000600580730000',
        solution:
          '193846257654273918827951436938524761245167389761398524472615893319482675586739142',
        difficulty: 'medium',
      },
    ],
    [
      'hard',
      {
        givens: '400190700050000290080630000020000000070518000005000100000000904000400803000026010',
        solution:
          '462195738351847296789632451128964375973518642645273189536781924217459863894326517',
        difficulty: 'hard',
      },
    ],
    [
      'expert',
      {
        givens: '600020050000000000305000074100000005200900060037010000000046082000050049004003600',
        solution:
          '679324851421587936385169274196438725248975163537612498913746582762851349854293617',
        difficulty: 'expert',
      },
    ],
  ])('generates the same %s puzzle for the same seed', (difficulty, expected) => {
    expect(generatePuzzle(difficulty, mulberry32(2026))).toEqual(expected);
  });

  it('never consults Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    try {
      generatePuzzle('medium', mulberry32(5));
      generatePuzzle('easy', mulberry32(5));
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  /*
   * Property tests: 25 seeds per tier, bar Expert. Each puzzle is checked
   * for what a player relies on (one solution, givens from it, the right
   * label), what calibrates it to NYT (38 Easy givens; Medium needing locked
   * candidates; the rest minimal) or sets Expert apart (its fish, wing or
   * chain needed early), and run through the soundness harness — so the techniques
   * are checked against dozens of real puzzles of every tier.
   *
   * Expert gets 10 seeds: each of its puzzles takes about three times the
   * attempts of a Hard to find, and under coverage on a CI runner an attempt
   * costs tens of milliseconds. Its techniques get the same soundness check
   * over random minimal puzzles in the technique tests.
   */
  describe.each(DIFFICULTY_ORDER)('%s puzzles', (difficulty) => {
    let puzzles: { puzzle: Puzzle; givens: Uint8Array; solution: Uint8Array }[] = [];

    beforeAll(() => {
      puzzles = Array.from({ length: difficulty === 'expert' ? 10 : 25 }, (_, k) => {
        const puzzle = generatePuzzle(difficulty, mulberry32(1000 + k));
        return { puzzle, ...solvedPuzzle(puzzle) };
      });
    }, 120_000);

    it('have exactly one solution, which is the one returned', () => {
      for (const { givens, solution } of puzzles) {
        expect(countSolutions(givens)).toBe(1);
        expect(formatGrid(solve(givens)!)).toBe(formatGrid(solution));
        expect(isValidSolution(solution)).toBe(true);
        expect(isSubsetOf(givens, solution)).toBe(true);
      }
    });

    it(`are labelled ${difficulty} and grade as ${difficulty}`, () => {
      for (const { puzzle, givens } of puzzles) {
        expect(puzzle.difficulty).toBe(difficulty);
        const result = grade(givens);
        expect(result.solved).toBe(true);
        expect(result.difficulty).toBe(difficulty);
        if (difficulty === 'medium') expect(['pointing', 'claiming']).toContain(result.hardest);
      }
    });

    if (difficulty === 'expert') {
      it('need their Expert technique while at least 40 cells are still empty', () => {
        for (const { givens } of puzzles) {
          expect(emptyAtFirstExpertStep(givens, grade(givens))).toBeGreaterThanOrEqual(40);
        }
      });
    }

    if (difficulty === 'easy') {
      it('have exactly 38 givens, like NYT', () => {
        for (const { givens } of puzzles) expect(countFilled(givens)).toBe(38);
      });
    } else {
      it('are minimal, like NYT', () => {
        for (const { givens } of puzzles) expect(isMinimal(givens)).toBe(true);
      });
    }

    it('are solved soundly, step by step', () => {
      for (const puzzle of puzzles) expect(checkSoundness(puzzle).problems).toEqual([]);
    });

    it('differ from seed to seed', () => {
      expect(new Set(puzzles.map(({ puzzle }) => puzzle.givens)).size).toBe(puzzles.length);
    });
  });

  describe('when the attempt cap runs out', () => {
    /** Whether `a` sorts before `b`: the first key that differs decides. */
    function isBefore(a: readonly number[], b: readonly number[]): boolean {
      const x = a.findIndex((key, i) => key !== b[i]);
      return x !== -1 && a[x] < b[x];
    }

    /**
     * What `generatePuzzle` should return, worked out the long way: replay
     * its attempts with the same random source, stop at the first one on
     * target (a Medium needing locked candidates, an Expert needing its
     * technique with 40 cells empty), else keep the one whose label from
     * `rate` is nearest the target — the easier tier on a tie, then one the
     * set solves over one it can't, then the earlier — labelled with that
     * real tier.
     */
    function expected(difficulty: Difficulty, seed: number, maxAttempts: number): Puzzle {
      const rng = mulberry32(seed);
      const target = DIFFICULTY_ORDER.indexOf(difficulty);
      let best: { givens: Uint8Array; solution: Uint8Array; keys: number[] } | null = null;
      for (let n = 0; n < Math.max(1, maxAttempts); n++) {
        const solution = randomSolution(rng);
        const givens = digMinimal(solution, rng);
        const result = grade(givens);
        const isLocked = result.hardest === 'pointing' || result.hardest === 'claiming';
        const isEarly = (emptyAtFirstExpertStep(givens, result) ?? 0) >= 40;
        const meetsTierRule =
          difficulty === 'medium' ? isLocked : difficulty === 'expert' ? isEarly : true;
        if (result.difficulty === difficulty && meetsTierRule) {
          return { givens: formatGrid(givens), solution: formatGrid(solution), difficulty };
        }
        // The label `rate` gives: Expert for a puzzle the set can't solve.
        const rank = DIFFICULTY_ORDER.indexOf(result.solved ? result.difficulty! : 'expert');
        const keys = [Math.abs(rank - target), rank, result.solved ? 0 : 1];
        if (best === null || isBefore(keys, best.keys)) best = { givens, solution, keys };
      }
      return {
        givens: formatGrid(best!.givens),
        solution: formatGrid(best!.solution),
        difficulty: rate(best!.givens),
      };
    }

    it.each<[Difficulty, number]>([
      ['medium', 2],
      ['hard', 3],
      ['expert', 5],
    ])('returns the closest %s attempt within %i, labelled honestly', (difficulty, maxAttempts) => {
      const results: Puzzle[] = [];
      for (let seed = 1; seed <= 8; seed++) {
        const puzzle = generatePuzzle(difficulty, mulberry32(seed), { maxAttempts });
        expect(puzzle).toEqual(expected(difficulty, seed, maxAttempts));
        // Never lie about difficulty: the label is what the puzzle really is.
        expect(puzzle.difficulty).toBe(rate(gridValues(puzzle.givens)));
        expect(hasUniqueSolution(gridValues(puzzle.givens))).toBe(true);
        results.push(puzzle);
      }
      // The cap has to have been hit for this to test anything.
      expect(results.some((p) => p.difficulty !== difficulty)).toBe(true);
    });

    it('rates a puzzle beyond the technique set as Expert, as rate() does', () => {
      // Seed 34's first five attempts: Hard, Medium, beyond the set, Medium,
      // Medium. Asked for Expert, the third is the closest — `rate` calls it
      // Expert. Ranking it past Expert instead would hand back the Hard one,
      // though the player asked for harder.
      const puzzle = generatePuzzle('expert', mulberry32(34), { maxAttempts: 5 });
      expect(puzzle.difficulty).toBe('expert');
      expect(grade(gridValues(puzzle.givens)).solved).toBe(false);
    });

    it('prefers a puzzle the set solves to one rated the same that it cannot', () => {
      // Seed 16's first attempt is beyond the set, its second a solved Expert:
      // both Expert, one tier from Hard. The solved one is the easier, so it
      // wins although it came second.
      const first = generatePuzzle('hard', mulberry32(16), { maxAttempts: 1 });
      expect(first.difficulty).toBe('expert');
      expect(grade(gridValues(first.givens)).solved).toBe(false);
      const puzzle = generatePuzzle('hard', mulberry32(16), { maxAttempts: 2 });
      expect(puzzle.difficulty).toBe('expert');
      expect(grade(gridValues(puzzle.givens)).solved).toBe(true);
    });

    it('always makes at least one attempt, counting whole attempts only', () => {
      for (const maxAttempts of [0, -3, 0.5, -Infinity]) {
        expect(generatePuzzle('expert', mulberry32(4), { maxAttempts })).toEqual(
          generatePuzzle('expert', mulberry32(4), { maxAttempts: 1 }),
        );
      }
      // Seed 6's third Hard attempt beats its first two, so a cap of 2.5 has
      // to stop after two to tell rounding down from rounding up.
      const twoAndAHalf = generatePuzzle('hard', mulberry32(6), { maxAttempts: 2.5 });
      expect(twoAndAHalf).toEqual(generatePuzzle('hard', mulberry32(6), { maxAttempts: 2 }));
      expect(twoAndAHalf).not.toEqual(generatePuzzle('hard', mulberry32(6), { maxAttempts: 3 }));
      expect(generatePuzzle('hard', mulberry32(4), { maxAttempts: 1 })).toEqual(
        expected('hard', 4, 1),
      );
    });

    it('treats a NaN cap as unset rather than making no attempt at all', () => {
      // Math.max(1, NaN) is NaN: unguarded, the loop would never run and
      // there would be nothing to return.
      // Seed 3 lands a Hard puzzle on its second attempt, so a cap of one
      // would give a different one.
      const puzzle = generatePuzzle('hard', mulberry32(3), { maxAttempts: NaN });
      expect(puzzle).toEqual(generatePuzzle('hard', mulberry32(3)));
      expect(puzzle.difficulty).toBe('hard');
    });
  });
});
