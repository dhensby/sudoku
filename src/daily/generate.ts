import {
  createRng,
  encodeGivens,
  generatePuzzle,
  type DateKey,
  type Difficulty,
  type Puzzle,
} from '../core';
import { DIFFICULTIES } from '../storage/storage';

/*
 * Dealing a date's dailies from its seeds — the one recipe shared by the app,
 * which deals each day live (in the worker, or on the main thread where
 * there is none), and by `npm run dailies:freeze`, which stores the days an
 * engine has dealt before it is replaced. The two must agree to the digit,
 * so neither has a recipe of its own.
 *
 * A daily is `generatePuzzle(tier, createRng('daily/<date>/<tier>'))`. The
 * generator falls back to a puzzle of the nearest tier if a thousand
 * attempts all miss — for an Expert, about a one in 10¹¹ chance — and a daily
 * must really be of its tier: it is labelled with it and counts towards that
 * tier's streak. So a miss moves on to the seed `daily/<date>/<tier>/2`, then
 * `/3`, still a pure function of the date; in practice the first seed always
 * lands.
 */

/** The tiers each day has a daily of, in the order the archive stores them. */
export const DAILY_TIERS: readonly Difficulty[] = DIFFICULTIES;

/** The seed recipe, as the archive records it. */
export const DAILY_SEED_PATTERN = 'daily/<date>/<tier>';

/** The seeds tried for one daily before giving up (see the module comment). */
export const MAX_DAILY_SEEDS = 5;

/** Deal a puzzle of a tier from a seed, as the worker's protocol does. */
export type GenerateFn = (tier: Difficulty, seed: string) => Puzzle;

/** The same, off the main thread: how the app deals live dailies. */
export type GenerateAsyncFn = (tier: Difficulty, seed: string) => Promise<Puzzle>;

/** A date's dailies as share codes, ready to freeze into the archive. */
export interface NewDay {
  date: DateKey;
  /** The day's `encodeGivens` codes, in `DAILY_TIERS` order. */
  codes: string[];
}

/** The seed for a date's daily of a tier: the `attempt`th, counting from 1 (see the module comment). */
export function dailySeed(date: DateKey, tier: Difficulty, attempt = 1): string {
  const seed = `daily/${date}/${tier}`;
  return attempt === 1 ? seed : `${seed}/${attempt}`;
}

/** The real generator, seeded as the worker seeds it. */
const generateFromSeed: GenerateFn = (tier, seed) => generatePuzzle(tier, createRng(seed));

/** Why every seed for a daily missed its tier — which means the generator needs looking at. */
function missed(date: DateKey, tier: Difficulty): Error {
  return new Error(
    `The ${tier} daily for ${date} missed its tier from all ${MAX_DAILY_SEEDS} seeds; the generator needs looking at`,
  );
}

/**
 * A date's daily of a tier, dealt on the spot with the current engine. Throws
 * only if every seed misses (see the module comment).
 */
export function generateDaily(
  date: DateKey,
  tier: Difficulty,
  generate: GenerateFn = generateFromSeed,
): Puzzle {
  for (let attempt = 1; attempt <= MAX_DAILY_SEEDS; attempt++) {
    const puzzle = generate(tier, dailySeed(date, tier, attempt));
    if (puzzle.difficulty === tier) return puzzle;
  }
  throw missed(date, tier);
}

/** `generateDaily` through an asynchronous generator — the worker. Rejects where that throws. */
export async function generateDailyAsync(
  date: DateKey,
  tier: Difficulty,
  generate: GenerateAsyncFn,
): Promise<Puzzle> {
  for (let attempt = 1; attempt <= MAX_DAILY_SEEDS; attempt++) {
    const puzzle = await generate(tier, dailySeed(date, tier, attempt));
    if (puzzle.difficulty === tier) return puzzle;
  }
  throw missed(date, tier);
}

/** A date's four dailies as share codes, for the freeze command. */
export function generateDay(date: DateKey, generate: GenerateFn = generateFromSeed): NewDay {
  return {
    date,
    codes: DAILY_TIERS.map((tier) => encodeGivens(generateDaily(date, tier, generate).givens)),
  };
}
