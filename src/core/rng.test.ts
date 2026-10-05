import { createRng, mulberry32, randomSeed, seedFromString, shuffle } from './rng';

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const n = rng();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('gives different sequences for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('seedFromString', () => {
  it('is stable and distinguishes strings', () => {
    expect(seedFromString('abc')).toBe(seedFromString('abc'));
    expect(seedFromString('abc')).not.toBe(seedFromString('abd'));
  });
});

describe('createRng', () => {
  it('is reproducible from a string or numeric seed', () => {
    expect(createRng('hello')()).toBe(mulberry32(seedFromString('hello'))());
    expect(createRng(5)()).toBe(mulberry32(5)());
  });

  it('falls back to the platform CSPRNG without a seed', () => {
    const rng = createRng();
    const seen = new Set(Array.from({ length: 100 }, () => rng()));
    expect(seen.size).toBeGreaterThan(1);
    for (const n of seen) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe('randomSeed', () => {
  it('returns eight base-36 characters that differ between calls', () => {
    const seeds = new Set(Array.from({ length: 20 }, () => randomSeed()));
    expect(seeds.size).toBeGreaterThan(1);
    for (const seed of seeds) expect(seed).toMatch(/^[0-9a-z]{8}$/);
  });
});

describe('shuffle', () => {
  it('permutes in place, deterministically for a seed', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = shuffle(items, mulberry32(3));
    expect(result).toBe(items);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], mulberry32(3))).toEqual(result);
  });

  it('leaves empty and single-item arrays alone', () => {
    expect(shuffle([], mulberry32(1))).toEqual([]);
    expect(shuffle(['a'], mulberry32(1))).toEqual(['a']);
  });
});
