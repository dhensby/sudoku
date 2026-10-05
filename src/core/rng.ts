/** A source of pseudo-random numbers in the range [0, 1). */
export type RandomFn = () => number;

/**
 * Deterministic, well-distributed 32-bit PRNG. Same seed → same sequence,
 * which is what makes generator golden tests reproducible: a puzzle is a pure
 * function of its seed, its tier and `GENERATOR_VERSION`.
 */
export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash so a human-friendly string seed maps to a 32-bit number. */
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function cryptoRandom(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 4294967296;
}

/**
 * Build a random source. With no seed you get a cryptographically-strong
 * generator; with a seed you get a reproducible one.
 */
export function createRng(seed?: number | string): RandomFn {
  if (seed === undefined) return cryptoRandom;
  const numericSeed = typeof seed === 'string' ? seedFromString(seed) : seed;
  return mulberry32(numericSeed);
}

/** A fresh random seed: eight base-36 characters from the platform CSPRNG. */
export function randomSeed(): string {
  const buffer = new Uint32Array(2);
  globalThis.crypto.getRandomValues(buffer);
  return (buffer[0].toString(36) + buffer[1].toString(36)).padStart(8, '0').slice(-8);
}

/**
 * Shuffle an array in place with Fisher–Yates and return it.
 *
 * Never `sort(() => rng() - 0.5)`: a random comparator is biased, and its
 * result depends on each engine's sort algorithm — the same seed would deal a
 * different puzzle in Safari than in Chrome.
 */
export function shuffle<T>(items: T[], rng: RandomFn): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const held = items[i];
    items[i] = items[j];
    items[j] = held;
  }
  return items;
}
