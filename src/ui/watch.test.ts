import { MOVES_VERSION } from '../core';
import { logFromAnotherBuild } from '../test/movePlayers';
import { shortSolve } from './testFixtures';
import {
  OWN_SOLVE_TITLE,
  WATCHED_RECORD_TEXT,
  WATCHED_SOLVE_TEXT,
  friendSolveSource,
  friendsSolve,
  isWatchable,
  ownSolveSource,
  watchFriendLabel,
} from './watch';

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

  it('gives no time for a solve after watching a friend’s, which recorded none', () => {
    expect(ownSolveSource({ ...game, watched: true }, encoded, '2026-10-13').subtitle).toBe('Hard');
    expect(
      ownSolveSource({ ...game, daily: '2026-10-12', watched: true }, encoded, '2026-10-13')
        .subtitle,
    ).toBe('Daily · 12 Oct · Hard');
  });
});

describe("a friend's solve", () => {
  const challenge = {
    name: 'Dan',
    seconds: 323,
    assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
    log: encoded,
  };
  const solve = {
    givens: puzzle.givens,
    difficulty: 'hard' as const,
    daily: null,
    challenge,
    log: encoded,
  };

  it('is headed with whose it is, over the tier and their time', () => {
    expect(friendSolveSource(solve, '2026-10-13')).toEqual({
      givens: puzzle.givens,
      difficulty: 'hard',
      log: encoded,
      title: "Dan's solve",
      name: 'Dan',
      subtitle: 'Hard · 5:23',
    });
  });

  it('names a daily, and a friend whose link gave no name', () => {
    const source = friendSolveSource(
      { ...solve, daily: '2026-10-12', challenge: { ...challenge, name: null } },
      '2026-10-13',
    );
    expect(source.title).toBe("Your friend's solve");
    expect(source.subtitle).toBe('Daily · 12 Oct · Hard · 5:23');
  });

  it('is offered by name, or as your friend’s', () => {
    expect(friendsSolve('Dan')).toBe("Dan's solve");
    expect(friendsSolve(null)).toBe("Your friend's solve");
    expect(watchFriendLabel('Dan')).toBe("Watch Dan's solve");
    expect(watchFriendLabel(null)).toBe("Watch your friend's solve");
  });
});

describe('a solve after watching one', () => {
  it('says why it has no time', () => {
    expect(WATCHED_SOLVE_TEXT).toBe(
      'Solved — no time recorded: you watched a solve of this puzzle first',
    );
    expect(WATCHED_RECORD_TEXT).toBe('Solved after watching a solve');
  });
});
