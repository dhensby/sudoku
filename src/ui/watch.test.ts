import { MOVES_VERSION } from '../core';
import { logFromAnotherBuild } from '../test/movePlayers';
import { shortSolve } from './testFixtures';
import { OWN_SOLVE_TITLE, isWatchable, ownSolveSource } from './watch';

const { puzzle, encoded } = shortSolve();

describe('isWatchable', () => {
  it('watches a solve whose log this version replays to the end', () => {
    expect(isWatchable(puzzle.givens, encoded)).toBe(true);
    // And the same again, remembered.
    expect(isWatchable(puzzle.givens, encoded)).toBe(true);
  });

  it('watches nothing without a log, or with one it cannot play back', () => {
    expect(isWatchable(puzzle.givens, null)).toBe(false);
    expect(isWatchable(puzzle.givens, logFromAnotherBuild(MOVES_VERSION + 1, 0))).toBe(false);
    expect(isWatchable(puzzle.givens, encoded.slice(0, -3))).toBe(false);
    // The log is of this puzzle, not another.
    expect(isWatchable('0'.repeat(81), encoded)).toBe(false);
  });

  it('keeps answering rightly once it has remembered more than it keeps', () => {
    for (let i = 0; i < 1300; i++) expect(isWatchable(`not a grid ${i}`, encoded)).toBe(false);
    expect(isWatchable(puzzle.givens, encoded)).toBe(true);
  });
});

describe('ownSolveSource', () => {
  const game = { givens: puzzle.givens, difficulty: 'hard' as const, elapsedMs: 323_900 };

  it('heads the player’s own solve with its tier and time', () => {
    expect(ownSolveSource(game, encoded, '2026-10-13')).toEqual({
      givens: puzzle.givens,
      difficulty: 'hard',
      log: encoded,
      title: 'Your solve',
      subtitle: 'Hard · 5:23',
    });
    expect(OWN_SOLVE_TITLE).toBe('Your solve');
    expect(ownSolveSource({ ...game, daily: null }, encoded, '2026-10-13').subtitle).toBe(
      'Hard · 5:23',
    );
  });

  it('names a daily as the Solved dialog does', () => {
    expect(ownSolveSource({ ...game, daily: '2026-10-12' }, encoded, '2026-10-13').subtitle).toBe(
      'Daily · 12 Oct · Hard · 5:23',
    );
  });
});
