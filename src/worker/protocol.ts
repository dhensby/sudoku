import { createRng, generatePuzzle, type Difficulty, type Puzzle } from '../core';
import { isDifficulty } from '../storage/storage';

/*
 * The messages between the page and the generator worker, and the one thing
 * the worker does with them.
 *
 * Kept apart from the worker script so the work itself is a plain function:
 * testable without a Worker (jsdom has none), and the very same code the
 * main-thread fallback runs, so a seed deals the same puzzle either way.
 */

/** Ask for a puzzle. `id` comes back on the reply, so replies can be matched to requests. */
export interface GenerateRequest {
  id: number;
  difficulty: Difficulty;
  /** Seeds the generator: the same seed and difficulty always deal the same puzzle. */
  seed: string;
}

/** The puzzle asked for, or why there is none. */
export type GenerateResponse = { id: number; puzzle: Puzzle } | { id: number; error: string };

/**
 * Generate the puzzle a request asks for.
 *
 * Never throws: a failure comes back as an error reply carrying the request's
 * id, because a worker that throws instead leaves the page waiting on a reply
 * that will never come. The request is checked rather than trusted — it
 * crossed a thread boundary, and an unknown tier would otherwise run the
 * generator through every one of its attempts in search of a tier that does
 * not exist.
 */
export function respond(request: GenerateRequest): GenerateResponse {
  const { id, difficulty, seed } = request;
  if (!isDifficulty(difficulty) || typeof seed !== 'string') {
    return { id, error: 'Malformed puzzle request' };
  }
  try {
    return { id, puzzle: generatePuzzle(difficulty, createRng(seed)) };
  } catch (error) {
    return { id, error: error instanceof Error ? error.message : String(error) };
  }
}
