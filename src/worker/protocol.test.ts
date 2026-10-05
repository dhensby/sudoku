import { createRng, generatePuzzle, gridValues, type Difficulty } from '../core';
import { respond, type GenerateRequest } from './protocol';

// Wrapped so a test can make generation throw, which the real generator never
// does — the error path guards against a future bug, not a known one.
vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return { ...actual, generatePuzzle: vi.fn(actual.generatePuzzle) };
});

describe('respond', () => {
  it.each<Difficulty>(['easy', 'medium', 'hard', 'expert'])(
    'deals the %s puzzle the seed names, exactly as the main thread would',
    (difficulty) => {
      const response = respond({ id: 7, difficulty, seed: 'abc123' });
      // Same seed, same puzzle on either thread: that is what lets the
      // fallback stand in for the worker without anyone noticing.
      expect(response).toEqual({ id: 7, puzzle: generatePuzzle(difficulty, createRng('abc123')) });
    },
  );

  it('answers with a real puzzle of the tier asked for', () => {
    const response = respond({ id: 1, difficulty: 'easy', seed: 'seed' });
    if (!('puzzle' in response)) throw new Error('expected a puzzle');
    expect(response.puzzle.difficulty).toBe('easy');
    expect(gridValues(response.puzzle.givens).filter((v) => v !== 0)).toHaveLength(38);
  });

  it('deals different puzzles for different seeds', () => {
    const a = respond({ id: 1, difficulty: 'easy', seed: 'one' });
    const b = respond({ id: 2, difficulty: 'easy', seed: 'two' });
    expect(a).not.toEqual({ ...b, id: 1 });
  });

  it.each([
    ['an unknown tier', { id: 3, difficulty: 'impossible', seed: 'x' }],
    ['a missing seed', { id: 3, difficulty: 'easy' }],
    ['a numeric seed', { id: 3, difficulty: 'easy', seed: 42 }],
  ])('refuses %s with an error reply rather than guessing', (_, request) => {
    // Without the check an unknown tier would grind through every generator
    // attempt looking for a tier that does not exist.
    expect(respond(request as unknown as GenerateRequest)).toEqual({
      id: 3,
      error: 'Malformed puzzle request',
    });
  });

  it('turns a thrown error into an error reply, so the page is never left waiting', () => {
    vi.mocked(generatePuzzle).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(respond({ id: 9, difficulty: 'hard', seed: 's' })).toEqual({ id: 9, error: 'boom' });
  });

  it('copes with something thrown that is not an Error', () => {
    vi.mocked(generatePuzzle).mockImplementationOnce(() => {
      throw 'odd';
    });
    expect(respond({ id: 4, difficulty: 'medium', seed: 's' })).toEqual({ id: 4, error: 'odd' });
  });
});
