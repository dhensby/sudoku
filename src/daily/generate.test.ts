import {
  createRng,
  decodeGivens,
  encodeGivens,
  formatGrid,
  generatePuzzle,
  parseGrid,
  type Difficulty,
  type Puzzle,
} from '../core';
import {
  DAILY_SEED_PATTERN,
  DAILY_TIERS,
  MAX_DAILY_SEEDS,
  dailySeed,
  generateDaily,
  generateDailyAsync,
  generateDay,
  type GenerateFn,
} from './generate';
import { WIKIPEDIA_PUZZLE } from '../test/grids';

const GIVENS = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));

/**
 * A stand-in generator that deals the same puzzle for every seed, labelled
 * `label(tier, seed)`, and keeps the seeds it was handed.
 */
function fakeGenerator(label: (tier: Difficulty, seed: string) => Difficulty = (tier) => tier) {
  const seeds: string[] = [];
  const generate: GenerateFn = (tier, seed) => {
    seeds.push(seed);
    return { givens: GIVENS, solution: GIVENS, difficulty: label(tier, seed) };
  };
  return { generate, seeds };
}

describe('dailySeed', () => {
  it('names the date and tier, as the archive records', () => {
    expect(dailySeed('2026-10-06', 'hard')).toBe('daily/2026-10-06/hard');
    expect(DAILY_SEED_PATTERN).toBe('daily/<date>/<tier>');
  });

  it('numbers the seeds after the first', () => {
    expect(dailySeed('2026-10-06', 'expert', 1)).toBe('daily/2026-10-06/expert');
    expect(dailySeed('2026-10-06', 'expert', 2)).toBe('daily/2026-10-06/expert/2');
  });
});

describe('DAILY_TIERS', () => {
  it('holds every tier, easiest first', () => {
    expect(DAILY_TIERS).toEqual(['easy', 'medium', 'hard', 'expert']);
  });
});

describe('generateDaily', () => {
  it('deals the puzzle the date’s seed deals', () => {
    expect(generateDaily('2026-10-06', 'easy')).toEqual(
      generatePuzzle('easy', createRng('daily/2026-10-06/easy')),
    );
  });

  it('deals the same day the same way every time', () => {
    expect(generateDaily('2026-10-06', 'medium')).toEqual(generateDaily('2026-10-06', 'medium'));
    expect(generateDaily('2026-10-06', 'medium')).not.toEqual(
      generateDaily('2026-10-07', 'medium'),
    );
  });

  it('tries the next seed when the generator falls back to another tier', () => {
    const { generate, seeds } = fakeGenerator((tier, seed) =>
      seed.endsWith('/3') ? tier : 'hard',
    );
    expect(generateDaily('2026-10-06', 'expert', generate).difficulty).toBe('expert');
    expect(seeds).toEqual([
      'daily/2026-10-06/expert',
      'daily/2026-10-06/expert/2',
      'daily/2026-10-06/expert/3',
    ]);
  });

  it('gives up, saying so, when every seed misses', () => {
    const { generate, seeds } = fakeGenerator(() => 'hard');
    expect(() => generateDaily('2026-10-06', 'expert', generate)).toThrow(
      'The expert daily for 2026-10-06 missed its tier from all 5 seeds',
    );
    expect(seeds).toHaveLength(MAX_DAILY_SEEDS);
  });
});

describe('generateDailyAsync', () => {
  it('deals exactly what generateDaily deals, through an asynchronous generator', async () => {
    const generate = async (tier: Difficulty, seed: string): Promise<Puzzle> =>
      generatePuzzle(tier, createRng(seed));
    await expect(generateDailyAsync('2026-10-06', 'easy', generate)).resolves.toEqual(
      generateDaily('2026-10-06', 'easy'),
    );
  });

  it('tries the next seed on a miss, and rejects when every seed misses', async () => {
    const fallsBackOnce = fakeGenerator((tier, seed) => (seed.endsWith('/2') ? tier : 'medium'));
    const once = async (tier: Difficulty, seed: string) => fallsBackOnce.generate(tier, seed);
    await expect(generateDailyAsync('2026-10-06', 'hard', once)).resolves.toMatchObject({
      difficulty: 'hard',
    });
    expect(fallsBackOnce.seeds).toEqual(['daily/2026-10-06/hard', 'daily/2026-10-06/hard/2']);

    const alwaysMisses = fakeGenerator(() => 'medium');
    const never = async (tier: Difficulty, seed: string) => alwaysMisses.generate(tier, seed);
    await expect(generateDailyAsync('2026-10-06', 'hard', never)).rejects.toThrow(
      'missed its tier',
    );
  });

  it('rejects when the generator does', async () => {
    const broken = () => Promise.reject(new Error('worker gone'));
    await expect(generateDailyAsync('2026-10-06', 'easy', broken)).rejects.toThrow('worker gone');
  });
});

describe('generateDay', () => {
  it('deals each tier from its own seed and hands back the codes in tier order', () => {
    const { generate, seeds } = fakeGenerator();
    expect(generateDay('2026-10-06', generate)).toEqual({
      date: '2026-10-06',
      codes: DAILY_TIERS.map(() => encodeGivens(GIVENS)),
    });
    expect(seeds).toEqual(DAILY_TIERS.map((tier) => `daily/2026-10-06/${tier}`));
  });

  it('refuses a day with a tier that misses from every seed', () => {
    const { generate } = fakeGenerator((tier) => (tier === 'expert' ? 'hard' : tier));
    expect(() => generateDay('2026-10-06', generate)).toThrow('The expert daily for 2026-10-06');
  });

  it('stores Easy puzzles of 38 givens, as the real generator deals them', () => {
    const real: GenerateFn = (tier, seed) =>
      tier === 'easy'
        ? generatePuzzle(tier, createRng(seed))
        : fakeGenerator().generate(tier, seed);
    const { codes } = generateDay('2026-10-06', real);
    expect(decodeGivens(codes[0])!.replace(/0/g, '')).toHaveLength(38);
  });
});
