import { describe, expect, it } from 'vitest';
import { addDays, encodeGivens, formatGrid, mulberry32, parseGrid } from '../core';
import {
  MAX_RECORDS,
  MAX_SAVED_GAMES,
  MAX_SEEN,
  computeStats,
  createGameId,
  deleteGameBlob,
  deleteRecord,
  exportHistory,
  findAttempts,
  findDailyAttempts,
  freeSpace,
  hasGameBlob,
  hasSeen,
  importHistory,
  loadDailyLedger,
  loadCurrentId,
  loadGameBlob,
  loadHistory,
  markSeen,
  saveCurrentId,
  saveGameBlob,
  savedGameIds,
  upsertRecord,
  type GameRecord,
} from './history';
import { memoryStorage, type StorageLike } from './storage';
import { computeStreak } from './streaks';
import { quotaStorage, throwingStorage } from '../test/misc-storage';
import { WIKIPEDIA_PUZZLE } from '../test/grids';

const HISTORY = 'sudoku.history';
const CURRENT = 'sudoku.current';
const SEEN = 'sudoku.seen';
const PUZZLE = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
const OTHER_PUZZLE = `${PUZZLE.slice(0, 80)}0`;
const NO_ASSISTS = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };

/** An unfinished game created at `createdAt` (and last played then). */
function playing(id: string, createdAt: number, overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    id,
    givens: PUZZLE,
    difficulty: 'easy',
    source: 'generated',
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    status: 'playing',
    elapsedMs: 0,
    assists: { ...NO_ASSISTS },
    challenge: null,
    ...overrides,
  };
}

/** A finished game created at `createdAt` and solved in `elapsedMs`. */
function solved(
  id: string,
  createdAt: number,
  elapsedMs = 60_000,
  overrides: Partial<GameRecord> = {},
): GameRecord {
  return playing(id, createdAt, {
    status: 'solved',
    updatedAt: createdAt + elapsedMs,
    completedAt: createdAt + elapsedMs,
    elapsedMs,
    ...overrides,
  });
}

/** Write raw records straight into storage, bypassing every rule. */
function seed(storage: StorageLike, records: unknown[]): void {
  storage.setItem(HISTORY, JSON.stringify(records));
}

const ids = (records: readonly GameRecord[]): string[] => records.map((record) => record.id);

/** The Wikipedia puzzle with all but its first `count` givens blanked. */
function firstGivens(count: number): string {
  let kept = 0;
  return PUZZLE.replace(/[1-9]/g, (digit) => (kept++ < count ? digit : '0'));
}

/** A storage that counts calls, to show how much work an operation does. */
function countingStorage(): StorageLike & { removes: number; sets: string[] } {
  const inner = memoryStorage();
  const storage = {
    removes: 0,
    sets: [] as string[],
    getItem: (key: string) => inner.getItem(key),
    setItem: (key: string, value: string) => {
      storage.sets.push(key);
      inner.setItem(key, value);
    },
    removeItem: (key: string) => {
      storage.removes++;
      inner.removeItem(key);
    },
  };
  return storage;
}

describe('createGameId', () => {
  it('is the time in base 36, a dash and four random base-36 characters', () => {
    const id = createGameId(1_700_000_000_000, mulberry32(1));
    expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]{4}$/);
    expect(id.split('-')[0]).toBe((1_700_000_000_000).toString(36));
  });

  it('is deterministic for a seeded random source', () => {
    expect(createGameId(5, mulberry32(7))).toBe(createGameId(5, mulberry32(7)));
  });

  it('tells apart two games created in the same millisecond', () => {
    const rng = mulberry32(3);
    expect(createGameId(5, rng)).not.toBe(createGameId(5, rng));
  });

  it('uses the platform CSPRNG by default', () => {
    const made = new Set(Array.from({ length: 20 }, () => createGameId(5)));
    expect(made.size).toBeGreaterThan(1);
    for (const id of made) expect(id).toMatch(/^5-[0-9a-z]{4}$/);
  });

  it.each([
    ['a fraction', 1234.9, (1234).toString(36)],
    ['a negative', -5, '0'],
    ['NaN', Number.NaN, '0'],
    ['Infinity', Number.POSITIVE_INFINITY, '0'],
  ])('never writes a dot or sign into the id for %s', (_label, now, prefix) => {
    expect(createGameId(now, mulberry32(1)).split('-')[0]).toBe(prefix);
  });

  it('writes ids the store accepts back', () => {
    const storage = memoryStorage();
    const id = createGameId(Date.now());
    saveCurrentId(storage, id);
    expect(loadCurrentId(storage)).toBe(id);
    expect(upsertRecord(storage, playing(id, 1))).toHaveLength(1);
  });
});

describe('loadHistory', () => {
  it('is empty for empty storage', () => {
    expect(loadHistory(memoryStorage())).toEqual([]);
  });

  it.each([
    ['corrupt JSON', '[{"id":'],
    ['an object', '{"records":[]}'],
    ['a string', '"history"'],
    ['null', 'null'],
  ])('is empty when the stored history is %s', (_label, raw) => {
    const storage = memoryStorage();
    storage.setItem(HISTORY, raw);
    expect(loadHistory(storage)).toEqual([]);
  });

  it('is empty when the storage refuses to be read', () => {
    expect(loadHistory(throwingStorage({ get: true }))).toEqual([]);
  });

  it('lists records newest first, whatever order they were stored in', () => {
    const storage = memoryStorage();
    seed(storage, [playing('b', 2), solved('c', 3), playing('a', 1)]);
    expect(ids(loadHistory(storage))).toEqual(['c', 'b', 'a']);
  });

  it('round-trips a full record exactly', () => {
    const storage = memoryStorage();
    const record = solved('r', 100, 5000, {
      difficulty: 'hard',
      source: 'shared',
      assists: { autoCandidates: true, hints: 2, checks: 1, reveals: 0 },
      challenge: { name: 'Dan', seconds: 323, assists: { ...NO_ASSISTS, hints: 1 } },
    });
    seed(storage, [record]);
    expect(loadHistory(storage)).toEqual([record]);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a number', 42],
    ['a string', 'a record'],
    ['an array', [playing('x', 1)]],
    ['an empty object', {}],
    ['no id', { ...playing('x', 1), id: undefined }],
    ['an empty id', playing('', 1)],
    ['a numeric id', { ...playing('x', 1), id: 7 }],
    ['an id with a slash', playing('a/b', 1)],
    ['an id with a space', playing('a b', 1)],
    ['an id longer than 64 characters', playing('x'.repeat(65), 1)],
    ['no givens', { ...playing('x', 1), givens: undefined }],
    ['givens of the wrong length', playing('x', 1, { givens: '123' })],
    ['givens with dots', playing('x', 1, { givens: PUZZLE.replace(/0/g, '.') })],
    // Well-formed but unplayable: the share code cannot encode an empty grid,
    // and no puzzle with these givens could have been played to a time.
    ['no givens at all', solved('x', 1, 1, { givens: '0'.repeat(81) })],
    ['16 givens', playing('x', 1, { givens: firstGivens(16) })],
    ['clashing givens', playing('x', 1, { givens: `555${PUZZLE.slice(3)}` })],
    ['an unknown tier', { ...playing('x', 1), difficulty: 'extreme' }],
    ['no tier', { ...playing('x', 1), difficulty: undefined }],
    ['an unknown status', { ...playing('x', 1), status: 'abandoned' }],
    ['no status', { ...playing('x', 1), status: undefined }],
    ['no creation time', { ...playing('x', 1), createdAt: undefined }],
    ['a creation time as a string', { ...playing('x', 1), createdAt: '2026-10-04' }],
    ['a negative creation time', playing('x', -1)],
    ['a non-finite creation time (null in JSON)', { ...playing('x', 1), createdAt: null }],
    ['no time on the clock', { ...solved('x', 1), elapsedMs: undefined }],
    ['a negative time on the clock', solved('x', 1, -5)],
    ['a time on the clock as a string', { ...solved('x', 1), elapsedMs: '5:23' }],
  ])('drops a record with %s, keeping its neighbours', (_label, bad) => {
    const storage = memoryStorage();
    seed(storage, [playing('before', 3), bad, solved('after', 1)]);
    expect(ids(loadHistory(storage))).toEqual(['before', 'after']);
  });

  it.each<[string, Partial<Record<keyof GameRecord, unknown>>, Partial<GameRecord>]>([
    ['an unknown source', { source: 'telepathy' }, { source: 'generated' }],
    ['a missing source', { source: undefined }, { source: 'generated' }],
    ['a missing update time', { updatedAt: undefined }, { updatedAt: 100 }],
    ['an update time before creation', { updatedAt: 50 }, { updatedAt: 100 }],
    ['an unfinished game with a completion time', { completedAt: 500 }, { completedAt: null }],
    ['missing assists', { assists: undefined }, { assists: NO_ASSISTS }],
    ['assists that are not an object', { assists: 'lots' }, { assists: NO_ASSISTS }],
    [
      'odd assist counts',
      { assists: { autoCandidates: 'yes', hints: -2, checks: 'x', reveals: 1.7 } },
      { assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 1 } },
    ],
    ['a challenge that is not an object', { challenge: 'Dan' }, { challenge: null }],
    ['a challenge with no time', { challenge: { name: 'Dan' } }, { challenge: null }],
    ['a challenge of zero seconds', { challenge: { seconds: 0 } }, { challenge: null }],
    ['a challenge time as a string', { challenge: { seconds: '323' } }, { challenge: null }],
    [
      'a challenge with a fractional time, no name and no assists',
      { challenge: { seconds: 323.9 } },
      { challenge: { name: null, seconds: 323, assists: NO_ASSISTS } },
    ],
    [
      'a challenge with a blank name',
      { challenge: { name: '   ', seconds: 5 } },
      { challenge: { name: null, seconds: 5, assists: NO_ASSISTS } },
    ],
    [
      'a challenge with an overlong name',
      { challenge: { name: ` ${'n'.repeat(30)} `, seconds: 5 } },
      { challenge: { name: `${'n'.repeat(23)}…`, seconds: 5, assists: NO_ASSISTS } },
    ],
  ])('coerces %s instead of dropping the record', (_label, fields, expected) => {
    const storage = memoryStorage();
    seed(storage, [{ ...playing('x', 100), ...fields }]);
    expect(loadHistory(storage)).toEqual([{ ...playing('x', 100), ...expected }]);
  });

  it('fills in a missing completion time on a solved game from its update time', () => {
    const storage = memoryStorage();
    seed(storage, [{ ...solved('x', 100, 1000), completedAt: null }]);
    expect(loadHistory(storage)[0].completedAt).toBe(1100);
  });

  it('pulls a completion time before creation level with creation', () => {
    const storage = memoryStorage();
    seed(storage, [solved('x', 100, 1000, { completedAt: 5 })]);
    expect(loadHistory(storage)[0].completedAt).toBe(100);
  });

  it('accepts givens down to the 17 a puzzle can have', () => {
    const storage = memoryStorage();
    seed(storage, [playing('x', 1, { givens: firstGivens(17) })]);
    expect(ids(loadHistory(storage))).toEqual(['x']);
  });

  it('drops fields it does not know', () => {
    const storage = memoryStorage();
    seed(storage, [{ ...playing('x', 1), favouriteColour: 'blue' }]);
    expect(loadHistory(storage)[0]).not.toHaveProperty('favouriteColour');
  });

  it('keeps one record per id: the copy that changed last', () => {
    const storage = memoryStorage();
    seed(storage, [
      playing('x', 1, { updatedAt: 5, elapsedMs: 5 }),
      playing('x', 1, { updatedAt: 9, elapsedMs: 9 }),
      playing('x', 1, { updatedAt: 7, elapsedMs: 7 }),
    ]);
    const records = loadHistory(storage);
    expect(records).toHaveLength(1);
    expect(records[0].elapsedMs).toBe(9);
  });
});

describe('upsertRecord', () => {
  it('inserts a record and persists it', () => {
    const storage = memoryStorage();
    const record = playing('a', 1);
    expect(upsertRecord(storage, record)).toEqual([record]);
    expect(loadHistory(storage)).toEqual([record]);
  });

  it('replaces the record with the same id rather than adding a second', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('a', 1));
    upsertRecord(storage, playing('b', 2));
    const records = upsertRecord(storage, solved('a', 1, 4000));
    expect(ids(records)).toEqual(['b', 'a']);
    expect(records[1].status).toBe('solved');
    expect(loadHistory(storage)).toEqual(records);
  });

  it('keeps the list newest first', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('mid', 2));
    upsertRecord(storage, playing('old', 1));
    expect(ids(upsertRecord(storage, playing('new', 3)))).toEqual(['new', 'mid', 'old']);
  });

  it('does not alias the caller’s record into the list it returns', () => {
    // The list goes straight into React state; sharing objects with the
    // caller would let a later mutation of the record change state unseen.
    const storage = memoryStorage();
    const record = playing('a', 1, { challenge: { name: 'Dan', seconds: 5, assists: NO_ASSISTS } });
    const [stored] = upsertRecord(storage, record);
    expect(stored).not.toBe(record);
    expect(stored.assists).not.toBe(record.assists);
    expect(stored.challenge).not.toBe(record.challenge);
    record.assists.hints = 9;
    expect(stored.assists.hints).toBe(0);
  });

  it('refuses a record that would not survive a reload', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('a', 1));
    const records = upsertRecord(storage, playing('not ok!', 2));
    expect(ids(records)).toEqual(['a']);
    expect(ids(loadHistory(storage))).toEqual(['a']);
  });

  it('returns the list even when the storage refuses every write', () => {
    // Persistence is best-effort: the session carries on in memory.
    const storage = throwingStorage({ set: true });
    expect(ids(upsertRecord(storage, playing('a', 1)))).toEqual(['a']);
  });

  describe('MAX_RECORDS', () => {
    it('is 1000', () => {
      expect(MAX_RECORDS).toBe(1000);
    });

    it('drops the oldest finished games first, with their saved state', () => {
      const storage = memoryStorage();
      // The oldest record is unfinished; the two finished ones just after it
      // are what should go.
      const records = [playing('ancient', 0), solved('s1', 1), solved('s2', 2)];
      for (let i = 3; i < MAX_RECORDS; i++) records.push(playing(`p${i}`, i));
      seed(storage, records);
      saveGameBlob(storage, 's1', {});

      const after = upsertRecord(storage, playing('new', 5000));
      expect(after).toHaveLength(MAX_RECORDS);
      expect(ids(after)).not.toContain('s1');
      expect(ids(after)).toContain('s2');
      expect(ids(after)).toContain('ancient');
      expect(storage.getItem('sudoku.game.s1')).toBeNull();
      expect(loadHistory(storage)).toHaveLength(MAX_RECORDS);
    });

    it('drops the oldest unfinished game once no finished one is left to drop', () => {
      const storage = memoryStorage();
      seed(
        storage,
        Array.from({ length: MAX_RECORDS }, (_, i) => playing(`p${i}`, i)),
      );
      const after = upsertRecord(storage, playing('new', 5000));
      expect(after).toHaveLength(MAX_RECORDS);
      expect(ids(after)).not.toContain('p0');
      expect(ids(after)).toContain('p1');
    });

    it('never drops the record being written or the current game', () => {
      const storage = memoryStorage();
      seed(
        storage,
        Array.from({ length: MAX_RECORDS }, (_, i) => solved(`s${i}`, 10 + i)),
      );
      saveCurrentId(storage, 's0'); // the oldest
      // An import-era record, older than everything: still kept.
      const after = upsertRecord(storage, solved('older', 1));
      expect(ids(after)).toContain('older');
      expect(ids(after)).toContain('s0');
      expect(ids(after)).not.toContain('s1');
      expect(after).toHaveLength(MAX_RECORDS);
    });
  });

  describe('MAX_SAVED_GAMES', () => {
    it('is 50', () => {
      expect(MAX_SAVED_GAMES).toBe(50);
    });

    it('drops the saved state of the least recently played unfinished games, keeping their records', () => {
      const storage = memoryStorage();
      const records: GameRecord[] = [];
      for (let i = 0; i < MAX_SAVED_GAMES + 2; i++) {
        // Created in order, but p0 was played most recently of all.
        records.push(playing(`p${i}`, i, { updatedAt: i === 0 ? 10_000 : 100 + i }));
        saveGameBlob(storage, `p${i}`, {});
      }
      seed(storage, records);
      upsertRecord(storage, playing('new', 9000, { updatedAt: 9000 }));

      // 53 unfinished games now; the three least recently played lose their state.
      expect(hasGameBlob(storage, 'p0')).toBe(true);
      expect(hasGameBlob(storage, 'p1')).toBe(false);
      expect(hasGameBlob(storage, 'p2')).toBe(false);
      expect(hasGameBlob(storage, 'p3')).toBe(false);
      expect(hasGameBlob(storage, 'p4')).toBe(true);
      expect(loadHistory(storage)).toHaveLength(MAX_SAVED_GAMES + 3);
    });

    it('never drops the current game’s saved state', () => {
      const storage = memoryStorage();
      const records: GameRecord[] = [];
      for (let i = 0; i < MAX_SAVED_GAMES + 1; i++) {
        records.push(playing(`p${i}`, i, { updatedAt: 100 + i }));
        saveGameBlob(storage, `p${i}`, {});
      }
      seed(storage, records);
      saveCurrentId(storage, 'p0');
      upsertRecord(storage, playing('p50', 50, { updatedAt: 200 }));
      expect(hasGameBlob(storage, 'p0')).toBe(true);
      expect(hasGameBlob(storage, 'p1')).toBe(true);
    });

    it('drops a finished game’s saved state once it is no longer on screen', () => {
      const storage = memoryStorage();
      saveCurrentId(storage, 'done');
      upsertRecord(storage, solved('done', 1));
      saveGameBlob(storage, 'done', { board: 'solved' });
      upsertRecord(storage, solved('done', 1));
      // Still the current game: reopening the page shows it solved.
      expect(hasGameBlob(storage, 'done')).toBe(true);

      saveCurrentId(storage, 'next');
      upsertRecord(storage, playing('next', 2));
      expect(hasGameBlob(storage, 'done')).toBe(false);
      expect(ids(loadHistory(storage))).toEqual(['next', 'done']);
    });
  });

  describe('in a full storage', () => {
    /** 400 finished games, 20 unfinished ones with saved state, and a storage with no room to spare. */
    function fullStorage(): ReturnType<typeof quotaStorage> {
      const storage = quotaStorage();
      const records: GameRecord[] = [];
      for (let i = 0; i < 400; i++) records.push(solved(`s${i}`, i * 10));
      for (let i = 0; i < 20; i++) {
        records.push(playing(`p${i}`, 10_000 + i, { updatedAt: 20_000 + i }));
        saveGameBlob(storage, `p${i}`, { state: 'x'.repeat(2000) });
      }
      seed(storage, records);
      storage.capacity = storage.used() + 100;
      return storage;
    }

    it('sheds old saved games and finished records, then writes', () => {
      const storage = fullStorage();
      const after = upsertRecord(storage, playing('new', 50_000, { updatedAt: 50_000 }));

      // Only the 10 most recently played unfinished games keep their state —
      // the new game, which has none saved yet, and p11–p19…
      const resumable = Array.from({ length: 20 }, (_, i) => `p${i}`).filter((id) =>
        hasGameBlob(storage, id),
      );
      expect(resumable).toEqual(['p11', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p18', 'p19']);
      // …only the newest 300 finished records survive, and every unfinished one does.
      const finished = after.filter((record) => record.status === 'solved');
      expect(finished).toHaveLength(300);
      expect(ids(finished)).toContain('s399');
      expect(ids(finished)).toContain('s100');
      expect(ids(finished)).not.toContain('s99');
      expect(after.filter((record) => record.status === 'playing')).toHaveLength(21);
      // …and the retry went through.
      expect(loadHistory(storage)).toEqual(after);
      expect(ids(after)[0]).toBe('new');
    });

    it('keeps the current game through the shedding', () => {
      const storage = fullStorage();
      saveCurrentId(storage, 's0'); // the oldest finished game
      upsertRecord(storage, playing('new', 50_000, { updatedAt: 50_000 }));
      expect(ids(loadHistory(storage))).toContain('s0');
    });

    it('gives up quietly if even the smaller list does not fit', () => {
      const storage = fullStorage();
      storage.capacity = 10;
      expect(() => upsertRecord(storage, playing('new', 50_000))).not.toThrow();
    });

    it('never sheds the record being written, even an old finished one', () => {
      // Updating the oldest finished game while the storage is full: the
      // shedding drops the oldest finished records, but not this one.
      const storage = fullStorage();
      saveCurrentId(storage, 'p19');
      storage.capacity = storage.used() - 5;
      const after = upsertRecord(storage, solved('s0', 0, 60_000, { updatedAt: 99_999 }));
      expect(ids(after)).toContain('s0');
      expect(ids(after)).not.toContain('s1');
      expect(ids(loadHistory(storage))).toContain('s0');
    });
  });

  it('visits only the games with saved state, not every record', () => {
    // The history is saved every few hundred milliseconds of play, so its
    // tidying must not cost a storage call per record.
    const storage = countingStorage();
    const records: GameRecord[] = [];
    for (let i = 0; i < MAX_RECORDS - 1; i++) {
      records.push(i % 10 === 0 ? playing(`p${i}`, i) : solved(`s${i}`, i));
    }
    seed(storage, records);
    saveGameBlob(storage, 'p990', {});
    saveGameBlob(storage, 's991', {}); // finished and not on screen: due to go
    saveCurrentId(storage, 'cur');
    storage.removes = 0;
    upsertRecord(storage, playing('cur', 5000));
    expect(storage.removes).toBe(1);
    expect(hasGameBlob(storage, 's991')).toBe(false);
    expect(hasGameBlob(storage, 'p990')).toBe(true);

    storage.removes = 0;
    upsertRecord(storage, playing('cur', 5000, { updatedAt: 5500 }));
    expect(storage.removes).toBe(0);
  });
});

describe('deleteRecord', () => {
  it('removes the record and its saved game', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('a', 1));
    upsertRecord(storage, playing('b', 2));
    saveGameBlob(storage, 'a', { cells: [] });
    expect(ids(deleteRecord(storage, 'a'))).toEqual(['b']);
    expect(ids(loadHistory(storage))).toEqual(['b']);
    expect(loadGameBlob(storage, 'a')).toBeNull();
  });

  it('forgets the current game if it was the one deleted', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('a', 1));
    saveCurrentId(storage, 'a');
    deleteRecord(storage, 'a');
    expect(loadCurrentId(storage)).toBeNull();
  });

  it('leaves the current game alone when another is deleted', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('a', 1));
    upsertRecord(storage, playing('b', 2));
    saveCurrentId(storage, 'b');
    deleteRecord(storage, 'a');
    expect(loadCurrentId(storage)).toBe('b');
  });

  it('changes nothing for an unknown id', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('a', 1));
    const before = storage.getItem(HISTORY);
    expect(ids(deleteRecord(storage, 'zzz'))).toEqual(['a']);
    expect(storage.getItem(HISTORY)).toBe(before);
    expect(storage.getItem(SEEN)).toBeNull();
  });

  it.each([
    ['an unfinished game with time on its clock', playing('a', 1, { elapsedMs: 6031 })],
    ['a solved game', solved('a', 1)],
  ])('keeps the puzzle of %s seen, whatever was remembered before', (_label, record) => {
    // A record from before the list of seen puzzles, say.
    const storage = memoryStorage();
    upsertRecord(storage, record);
    deleteRecord(storage, 'a');
    expect(hasSeen(storage, loadHistory(storage), PUZZLE)).toBe(true);
  });

  it('lets a puzzle whose board never showed go unseen with its record', () => {
    // A shared puzzle still behind its Start button: no time on its clock.
    const storage = memoryStorage();
    upsertRecord(storage, playing('a', 1, { source: 'shared' }));
    deleteRecord(storage, 'a');
    expect(hasSeen(storage, loadHistory(storage), PUZZLE)).toBe(false);
  });
});

describe('puzzles seen', () => {
  it('counts a puzzle with an attempt in the history as seen', () => {
    const storage = memoryStorage();
    const records = [playing('a', 1)];
    expect(hasSeen(storage, records, PUZZLE)).toBe(true);
    expect(hasSeen(storage, records, OTHER_PUZZLE)).toBe(false);
  });

  it('remembers a puzzle marked seen after every record of it has gone', () => {
    const storage = memoryStorage();
    markSeen(storage, PUZZLE);
    expect(hasSeen(storage, [], PUZZLE)).toBe(true);
    expect(hasSeen(storage, [], OTHER_PUZZLE)).toBe(false);
    // Stored as share codes, not as givens.
    expect(JSON.parse(storage.getItem(SEEN)!)).toEqual([encodeGivens(PUZZLE)]);
  });

  it('moves a puzzle seen again to the most recent place, writing nothing if it is there already', () => {
    const storage = countingStorage();
    markSeen(storage, PUZZLE);
    markSeen(storage, OTHER_PUZZLE);
    markSeen(storage, PUZZLE);
    expect(JSON.parse(storage.getItem(SEEN)!)).toEqual([
      encodeGivens(OTHER_PUZZLE),
      encodeGivens(PUZZLE),
    ]);
    const writes = storage.sets.length;
    markSeen(storage, PUZZLE);
    expect(storage.sets.length).toBe(writes);
  });

  it('forgets the puzzles seen longest ago beyond MAX_SEEN', () => {
    const storage = memoryStorage();
    const codes = Array.from({ length: MAX_SEEN }, (_, i) => `b${i.toString(36)}`);
    storage.setItem(SEEN, JSON.stringify(codes));
    markSeen(storage, PUZZLE);
    const kept = JSON.parse(storage.getItem(SEEN)!) as string[];
    expect(kept).toHaveLength(MAX_SEEN);
    expect(kept[0]).toBe(codes[1]);
    expect(kept.at(-1)).toBe(encodeGivens(PUZZLE));
  });

  it('skips junk in the stored list one entry at a time', () => {
    const storage = memoryStorage();
    const code = encodeGivens(PUZZLE);
    storage.setItem(SEEN, JSON.stringify([42, null, 'not a code!', 'Apadded', code, code]));
    expect(hasSeen(storage, [], PUZZLE)).toBe(true);
    markSeen(storage, OTHER_PUZZLE);
    expect(JSON.parse(storage.getItem(SEEN)!)).toEqual([code, encodeGivens(OTHER_PUZZLE)]);
  });

  it.each([
    ['not JSON', '{'],
    ['not a list', '{"a":1}'],
  ])('reads a stored list that is %s as nothing seen', (_label, raw) => {
    const storage = memoryStorage();
    storage.setItem(SEEN, raw);
    expect(hasSeen(storage, [], PUZZLE)).toBe(false);
  });

  it('makes room in a full storage, then remembers', () => {
    const storage = quotaStorage();
    const records: GameRecord[] = [];
    for (let i = 0; i < 15; i++) {
      records.push(playing(`p${i}`, i, { updatedAt: 100 + i }));
      saveGameBlob(storage, `p${i}`, 'x'.repeat(1000));
    }
    seed(storage, records);
    storage.capacity = storage.used() + 20;
    markSeen(storage, PUZZLE);
    // Saved games of the least recently played went to make room.
    expect(hasGameBlob(storage, 'p0')).toBe(false);
    expect(hasSeen(storage, [], PUZZLE)).toBe(true);
  });

  it('gives up quietly when the storage refuses every write', () => {
    const storage = throwingStorage({ set: true });
    expect(() => markSeen(storage, PUZZLE)).not.toThrow();
    expect(hasSeen(storage, [], PUZZLE)).toBe(false);
  });
});

describe('saved games', () => {
  it('round-trips any JSON value under a namespaced key', () => {
    const storage = memoryStorage();
    const blob = { v: 1, values: PUZZLE, notes: [0, 3, 511] };
    expect(saveGameBlob(storage, 'a', blob)).toBe(true);
    expect(storage.getItem('sudoku.game.a')).toBe(JSON.stringify(blob));
    expect(loadGameBlob(storage, 'a')).toEqual(blob);
    expect(hasGameBlob(storage, 'a')).toBe(true);
  });

  it('reads null for a missing or corrupt saved game', () => {
    const storage = memoryStorage();
    expect(loadGameBlob(storage, 'missing')).toBeNull();
    expect(hasGameBlob(storage, 'missing')).toBe(false);
    storage.setItem('sudoku.game.bad', '{"v":1,');
    expect(loadGameBlob(storage, 'bad')).toBeNull();
  });

  it('deletes a saved game', () => {
    const storage = memoryStorage();
    saveGameBlob(storage, 'a', {});
    deleteGameBlob(storage, 'a');
    expect(hasGameBlob(storage, 'a')).toBe(false);
  });

  it.each<[string, unknown]>([
    [
      'a cycle',
      (() => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        return cyclic;
      })(),
    ],
    ['a BigInt', { n: 1n }],
    ['undefined', undefined],
    ['a function', () => 1],
  ])('skips a value JSON cannot hold (%s) without throwing', (_label, blob) => {
    const storage = memoryStorage();
    expect(saveGameBlob(storage, 'a', blob)).toBe(false);
    expect(hasGameBlob(storage, 'a')).toBe(false);
  });

  it('makes room in a full storage, then saves', () => {
    const storage = quotaStorage();
    const records: GameRecord[] = [];
    for (let i = 0; i < 15; i++) {
      records.push(playing(`p${i}`, i, { updatedAt: 100 + i }));
      saveGameBlob(storage, `p${i}`, 'x'.repeat(1000));
    }
    seed(storage, records);
    storage.capacity = storage.used() + 500;
    saveGameBlob(storage, 'p14', { big: 'y'.repeat(2000) });
    // The five least recently played lost their state to make room.
    expect(hasGameBlob(storage, 'p0')).toBe(false);
    expect(hasGameBlob(storage, 'p4')).toBe(false);
    expect(hasGameBlob(storage, 'p5')).toBe(true);
    expect(loadGameBlob(storage, 'p14')).toEqual({ big: 'y'.repeat(2000) });
  });

  it('gives up quietly when the storage refuses writes, and says so', () => {
    expect(saveGameBlob(throwingStorage({ set: true }), 'a', {})).toBe(false);
  });

  it('lists the games with saved state', () => {
    const storage = memoryStorage();
    saveGameBlob(storage, 'a', {});
    saveGameBlob(storage, 'b', {});
    // Saved again over the first: already listed, and still saved.
    expect(saveGameBlob(storage, 'a', { again: true })).toBe(true);
    expect(savedGameIds(storage)).toEqual(new Set(['a', 'b']));
    expect(JSON.parse(storage.getItem('sudoku.games')!)).toEqual(['a', 'b']);
    deleteGameBlob(storage, 'a');
    expect(savedGameIds(storage)).toEqual(new Set(['b']));
    // The list goes with the last saved game.
    deleteGameBlob(storage, 'b');
    expect(storage.getItem('sudoku.games')).toBeNull();
  });

  it('takes saved state back out if it cannot be listed', () => {
    // Saved but unlisted, no sweep would ever find it: it would sit in the
    // quota for good.
    const inner = memoryStorage();
    const storage: StorageLike = {
      ...inner,
      setItem: (key, value) => {
        if (key === 'sudoku.games') throw new DOMException('Full', 'QuotaExceededError');
        inner.setItem(key, value);
      },
    };
    expect(saveGameBlob(storage, 'a', {})).toBe(false);
    expect(hasGameBlob(storage, 'a')).toBe(false);
  });

  it('reports only listed games whose state is really there', () => {
    // A write can fail after its game was listed.
    const storage = memoryStorage();
    storage.setItem('sudoku.games', JSON.stringify(['a', 'gone']));
    storage.setItem('sudoku.game.a', '{}');
    expect(savedGameIds(storage)).toEqual(new Set(['a']));
  });

  it.each<[string, string]>([
    ['corrupt', '["a",'],
    ['not a list', '{"a":true}'],
    ['full of junk', JSON.stringify(['a', 7, null, 'a b', 'x'.repeat(65), 'a'])],
  ])('copes with a list that is %s', (_label, raw) => {
    const storage = memoryStorage();
    storage.setItem('sudoku.game.a', '{}');
    storage.setItem('sudoku.games', raw);
    const expected = raw.startsWith('[') && raw.endsWith(']') ? ['a'] : [];
    expect([...savedGameIds(storage)]).toEqual(expected);
  });

  it('deletes saved state that somehow missed the list', () => {
    const storage = memoryStorage();
    storage.setItem('sudoku.game.a', '{}');
    deleteGameBlob(storage, 'a');
    expect(hasGameBlob(storage, 'a')).toBe(false);
  });
});

describe('current game id', () => {
  it('is null until one is saved', () => {
    expect(loadCurrentId(memoryStorage())).toBeNull();
  });

  it('round-trips an id, and null forgets it', () => {
    const storage = memoryStorage();
    saveCurrentId(storage, 'abc-1234');
    expect(loadCurrentId(storage)).toBe('abc-1234');
    saveCurrentId(storage, null);
    expect(loadCurrentId(storage)).toBeNull();
    expect(storage.getItem(CURRENT)).toBeNull();
  });

  it.each([
    ['an empty string', ''],
    ['a space', 'a b'],
    ['JSON', '"abc"'],
    ['too long', 'x'.repeat(65)],
  ])('reads a stored id that is %s as none', (_label, raw) => {
    const storage = memoryStorage();
    storage.setItem(CURRENT, raw);
    expect(loadCurrentId(storage)).toBeNull();
  });
});

describe('findAttempts', () => {
  it('lists every record of a puzzle, in the order given', () => {
    const records = [playing('c', 3), playing('b', 2, { givens: OTHER_PUZZLE }), solved('a', 1)];
    expect(ids(findAttempts(records, PUZZLE))).toEqual(['c', 'a']);
    expect(ids(findAttempts(records, OTHER_PUZZLE))).toEqual(['b']);
    expect(findAttempts(records, '0'.repeat(81))).toEqual([]);
  });
});

describe('computeStats', () => {
  it('has an empty entry for every tier', () => {
    const empty = { played: 0, solved: 0, bestMs: null, averageMs: null };
    expect(computeStats([])).toEqual({ easy: empty, medium: empty, hard: empty, expert: empty });
  });

  it('counts every game as played but times only solves without reveals', () => {
    const stats = computeStats([
      solved('a', 1, 100_000),
      solved('b', 2, 200_001),
      // A reveal: counted as solved, but its time says nothing.
      solved('c', 3, 10_000, { assists: { ...NO_ASSISTS, reveals: 1 } }),
      // Hints and auto candidates still count towards the times.
      solved('d', 4, 300_000, {
        assists: { autoCandidates: true, hints: 3, checks: 2, reveals: 0 },
      }),
      // Unfinished: played, but its clock is not a solve time.
      playing('e', 5, { elapsedMs: 1000 }),
      solved('f', 6, 5000, { difficulty: 'hard' }),
    ]);
    expect(stats.easy).toEqual({ played: 5, solved: 4, bestMs: 100_000, averageMs: 200_000 });
    expect(stats.hard).toEqual({ played: 1, solved: 1, bestMs: 5000, averageMs: 5000 });
    expect(stats.medium.played).toBe(0);
  });

  it('rounds the average to the millisecond', () => {
    const stats = computeStats([solved('a', 1, 1000), solved('b', 2, 1001), solved('c', 3, 1001)]);
    expect(stats.easy.averageMs).toBe(1001);
  });

  it('counts replays as played and solved, but never as a best or in the average', () => {
    // A replay is a puzzle the player had already seen.
    const stats = computeStats([
      solved('a', 1, 100_000),
      solved('b', 2, 5000, { source: 'replay' }),
      playing('c', 3, { source: 'replay' }),
    ]);
    expect(stats.easy).toEqual({ played: 3, solved: 2, bestMs: 100_000, averageMs: 100_000 });
  });

  it('has no best or average when every solve used a reveal', () => {
    const stats = computeStats([solved('a', 1, 1000, { assists: { ...NO_ASSISTS, reveals: 2 } })]);
    expect(stats.easy).toEqual({ played: 1, solved: 1, bestMs: null, averageMs: null });
  });
});

describe('exportHistory', () => {
  it('writes a versioned envelope with every record and every saved game', () => {
    const storage = memoryStorage();
    upsertRecord(storage, solved('a', 1));
    upsertRecord(storage, playing('b', 2));
    saveCurrentId(storage, 'b');
    saveGameBlob(storage, 'b', { v: 1, values: PUZZLE });

    const json = exportHistory(storage, 1_759_600_000_000);
    expect(JSON.parse(json)).toEqual({
      app: 'sudoku',
      version: 1,
      exportedAt: 1_759_600_000_000,
      records: loadHistory(storage),
      games: { b: { v: 1, values: PUZZLE } },
      seen: [],
      dailyLedger: {},
    });
    // Indented, for anyone who opens the file.
    expect(json).toContain('\n  "records"');
  });

  it('keeps an id of __proto__ as a key rather than a prototype', () => {
    const storage = memoryStorage();
    seed(storage, [playing('__proto__', 1)]);
    saveCurrentId(storage, '__proto__');
    saveGameBlob(storage, '__proto__', { v: 1 });
    const data = JSON.parse(exportHistory(storage, 0)) as { games: object };
    expect(Object.hasOwn(data.games, '__proto__')).toBe(true);
  });
});

describe('importHistory', () => {
  /** An export file built by hand. */
  function file(records: unknown[], games: unknown = {}): string {
    return JSON.stringify({ app: 'sudoku', version: 1, exportedAt: 0, records, games });
  }

  it('round-trips an export into empty storage, saved games and all', () => {
    const source = memoryStorage();
    upsertRecord(source, solved('a', 1));
    upsertRecord(source, playing('b', 2));
    saveCurrentId(source, 'b');
    saveGameBlob(source, 'b', { v: 1, values: PUZZLE });

    const target = memoryStorage();
    expect(importHistory(target, exportHistory(source, 0))).toEqual({
      ok: true,
      added: 2,
      updated: 0,
    });
    expect(loadHistory(target)).toEqual(loadHistory(source));
    expect(loadGameBlob(target, 'b')).toEqual({ v: 1, values: PUZZLE });
    // The current game is the page's business, not the file's.
    expect(loadCurrentId(target)).toBeNull();
  });

  it.each([
    ['invalid JSON', '{"app":"sudoku",'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"sudoku"'],
    ['another app’s file', JSON.stringify({ app: 'minesweeper', version: 1, records: [] })],
    ['no app at all', JSON.stringify({ version: 1, records: [] })],
    ['a newer version', JSON.stringify({ app: 'sudoku', version: 2, records: [] })],
    ['no version', JSON.stringify({ app: 'sudoku', records: [] })],
    ['no records', JSON.stringify({ app: 'sudoku', version: 1 })],
    ['records that are not a list', JSON.stringify({ app: 'sudoku', version: 1, records: {} })],
  ])('refuses %s and leaves storage untouched', (_label, json) => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('a', 1));
    const before = storage.getItem(HISTORY);
    expect(importHistory(storage, json)).toEqual({ ok: false });
    expect(storage.getItem(HISTORY)).toBe(before);
  });

  it('keeps whichever copy of a record changed last', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('newer-here', 1, { updatedAt: 500, elapsedMs: 500 }));
    upsertRecord(storage, playing('newer-there', 2, { updatedAt: 500, elapsedMs: 500 }));
    upsertRecord(storage, playing('same', 3, { updatedAt: 500, elapsedMs: 500 }));
    saveGameBlob(storage, 'newer-here', { here: true });
    saveGameBlob(storage, 'same', { here: true });

    const result = importHistory(
      storage,
      file(
        [
          playing('newer-here', 1, { updatedAt: 400, elapsedMs: 400 }),
          solved('newer-there', 2, 9000, { updatedAt: 600 }),
          playing('same', 3, { updatedAt: 500, elapsedMs: 1 }),
        ],
        { 'newer-here': { there: true }, 'newer-there': { there: true }, same: { there: true } },
      ),
    );
    expect(result).toEqual({ ok: true, added: 0, updated: 1 });
    const byId = new Map(loadHistory(storage).map((record) => [record.id, record]));
    expect(byId.get('newer-here')!.elapsedMs).toBe(500);
    expect(byId.get('newer-there')!.status).toBe('solved');
    expect(byId.get('same')!.elapsedMs).toBe(500);
    expect(loadGameBlob(storage, 'newer-here')).toEqual({ here: true });
    expect(loadGameBlob(storage, 'same')).toEqual({ here: true });
  });

  it('carries saved state with a replaced record, and drops state the winning copy lacks', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('with', 1, { updatedAt: 100 }));
    upsertRecord(storage, playing('without', 2, { updatedAt: 100 }));
    saveGameBlob(storage, 'with', { old: true });
    saveGameBlob(storage, 'without', { old: true });
    importHistory(
      storage,
      file([playing('with', 1, { updatedAt: 200 }), playing('without', 2, { updatedAt: 200 })], {
        with: { new: true },
      }),
    );
    expect(loadGameBlob(storage, 'with')).toEqual({ new: true });
    // The old state belonged to the copy that lost: resuming it would
    // contradict the record that won.
    expect(hasGameBlob(storage, 'without')).toBe(false);
  });

  it('never replaces the game on screen', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('current', 1, { updatedAt: 100 }));
    saveCurrentId(storage, 'current');
    saveGameBlob(storage, 'current', { mine: true });
    const result = importHistory(
      storage,
      file([solved('current', 1, 50, { updatedAt: 999 })], { current: { theirs: true } }),
    );
    expect(result).toEqual({ ok: true, added: 0, updated: 0 });
    expect(loadHistory(storage)[0].status).toBe('playing');
    expect(loadGameBlob(storage, 'current')).toEqual({ mine: true });
  });

  it('skips bad records individually', () => {
    const storage = memoryStorage();
    const result = importHistory(
      storage,
      file([playing('good', 1), { id: 'bad' }, 'junk', null, solved('also-good', 2)]),
    );
    expect(result).toEqual({ ok: true, added: 2, updated: 0 });
    expect(ids(loadHistory(storage))).toEqual(['also-good', 'good']);
  });

  it('counts a record listed twice in the file once, keeping its later copy', () => {
    const storage = memoryStorage();
    const result = importHistory(
      storage,
      file([playing('x', 1, { updatedAt: 5 }), playing('x', 1, { updatedAt: 9, elapsedMs: 9 })]),
    );
    expect(result).toEqual({ ok: true, added: 1, updated: 0 });
    expect(loadHistory(storage)[0].elapsedMs).toBe(9);
  });

  it.each([
    ['missing', undefined],
    ['a list', [{ v: 1 }]],
    ['a string', 'games'],
  ])('imports the records when the saved games are %s', (_label, games) => {
    const storage = memoryStorage();
    expect(importHistory(storage, file([playing('a', 1)], games))).toEqual({
      ok: true,
      added: 1,
      updated: 0,
    });
    expect(hasGameBlob(storage, 'a')).toBe(false);
  });

  it('treats a null saved game as none', () => {
    const storage = memoryStorage();
    importHistory(storage, file([playing('a', 1)], { a: null }));
    expect(hasGameBlob(storage, 'a')).toBe(false);
  });

  it('ignores saved games for records the file does not list', () => {
    const storage = memoryStorage();
    importHistory(storage, file([playing('a', 1)], { a: { v: 1 }, stray: { v: 1 } }));
    expect(hasGameBlob(storage, 'a')).toBe(true);
    expect(hasGameBlob(storage, 'stray')).toBe(false);
  });

  it('writes nothing when the file has nothing new', () => {
    const storage = memoryStorage();
    upsertRecord(storage, playing('a', 1));
    const before = storage.getItem(HISTORY);
    expect(importHistory(storage, file([playing('a', 1)]))).toEqual({
      ok: true,
      added: 0,
      updated: 0,
    });
    expect(storage.getItem(HISTORY)).toBe(before);
  });

  it('adds the file’s seen puzzles to the ones here, even with no record new', () => {
    const source = memoryStorage();
    upsertRecord(source, playing('a', 1));
    markSeen(source, OTHER_PUZZLE);
    const target = memoryStorage();
    upsertRecord(target, playing('a', 1));
    markSeen(target, PUZZLE);
    expect(importHistory(target, exportHistory(source, 0))).toEqual({
      ok: true,
      added: 0,
      updated: 0,
    });
    expect(hasSeen(target, [], OTHER_PUZZLE)).toBe(true);
    expect(hasSeen(target, [], PUZZLE)).toBe(true);
  });

  it('never makes a puzzle unseen, and drops the file’s seen puzzles before any seen here', () => {
    const storage = memoryStorage();
    const local = Array.from({ length: MAX_SEEN - 1 }, (_, i) => `b${i.toString(36)}`);
    storage.setItem(SEEN, JSON.stringify(local));
    const json = JSON.stringify({
      app: 'sudoku',
      version: 1,
      records: [],
      seen: ['c1', 'c2', 'not a code!', 7, local[0]],
    });
    importHistory(storage, json);
    // Room for one more: the file's most recent one, never pushing out a local one.
    expect(JSON.parse(storage.getItem(SEEN)!)).toEqual(['c2', ...local]);
  });

  it.each([
    ['no seen puzzles at all', undefined],
    ['seen puzzles that are not a list', 'c1'],
    ['nothing new among them', []],
  ])('leaves the seen puzzles alone for a file with %s', (_label, seen) => {
    const storage = memoryStorage();
    markSeen(storage, PUZZLE);
    const before = storage.getItem(SEEN);
    importHistory(storage, JSON.stringify({ app: 'sudoku', version: 1, records: [], seen }));
    expect(storage.getItem(SEEN)).toBe(before);
  });

  it('holds the merged history to the caps, counting only what was kept', () => {
    const storage = memoryStorage();
    seed(
      storage,
      Array.from({ length: MAX_RECORDS }, (_, i) => playing(`here${i}`, 1000 + i)),
    );
    const incoming = [solved('old-solve', 1), playing('fresh', 99_999)];
    const result = importHistory(storage, file(incoming, { 'old-solve': { v: 1 } }));
    // Over the cap by two: the finished import goes first, then the oldest
    // unfinished game already here.
    expect(result).toEqual({ ok: true, added: 1, updated: 0 });
    const after = ids(loadHistory(storage));
    expect(after).toHaveLength(MAX_RECORDS);
    expect(after).toContain('fresh');
    expect(after).not.toContain('old-solve');
    expect(after).not.toContain('here0');
    expect(hasGameBlob(storage, 'old-solve')).toBe(false);
  });

  it('takes no saved state for a game that would be swept straight away', () => {
    // A finished game that is not on screen keeps no state, so writing the
    // file's copy would only cost a write and a delete.
    const storage = countingStorage();
    importHistory(storage, file([solved('a', 1)], { a: { v: 1 } }));
    expect(storage.sets.filter((key) => key.startsWith('sudoku.game'))).toEqual([]);
    expect(hasGameBlob(storage, 'a')).toBe(false);
  });

  it('drops state left under an imported id by some other copy', () => {
    const storage = memoryStorage();
    saveGameBlob(storage, 'a', { stale: true }); // listed, but no record here
    importHistory(storage, file([playing('a', 1)]));
    expect(hasGameBlob(storage, 'a')).toBe(false);
  });

  it('never evicts a game saved here to make room for its own', () => {
    // 30 unfinished games here, each resumable; room for the merged history
    // and only about three of the 40 older games the file brings.
    const storage = quotaStorage();
    const local: GameRecord[] = [];
    for (let i = 0; i < 30; i++) {
      local.push(playing(`here${i}`, 1_000_000 + i, { updatedAt: 2_000_000 + i }));
      saveGameBlob(storage, `here${i}`, { state: 'x'.repeat(1000) });
    }
    seed(storage, local);
    saveCurrentId(storage, 'here29');
    const incoming: GameRecord[] = [];
    const games: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      incoming.push(playing(`there${i}`, 1000 + i, { updatedAt: 2000 + i }));
      games[`there${i}`] = { state: 'y'.repeat(1000) };
    }
    const growth = JSON.stringify([...local, ...incoming]).length - JSON.stringify(local).length;
    storage.capacity = storage.used() + growth + 3500;

    expect(importHistory(storage, file(incoming, games))).toEqual({
      ok: true,
      added: 40,
      updated: 0,
    });
    expect(local.filter((record) => hasGameBlob(storage, record.id))).toHaveLength(30);
    // What did fit went to the most recently played of the imported games.
    const resumable = ids(incoming.filter((record) => hasGameBlob(storage, record.id)));
    expect(resumable).toEqual(['there37', 'there38', 'there39']);
    expect(savedGameIds(storage).size).toBe(33);
    expect(loadHistory(storage)).toHaveLength(70);
  });

  it('caps the saved games it brings in', () => {
    const storage = memoryStorage();
    const records = Array.from({ length: MAX_SAVED_GAMES + 5 }, (_, i) =>
      playing(`p${i}`, i, { updatedAt: 100 + i }),
    );
    const games = Object.fromEntries(records.map((record) => [record.id, { v: 1 }]));
    importHistory(storage, file(records, games));
    const resumable = records.filter((record) => hasGameBlob(storage, record.id));
    expect(resumable).toHaveLength(MAX_SAVED_GAMES);
    expect(hasGameBlob(storage, 'p0')).toBe(false);
    expect(hasGameBlob(storage, `p${MAX_SAVED_GAMES + 4}`)).toBe(true);
  });
});

describe('freeSpace', () => {
  it('sheds saved games beyond the 10 most recently played, sparing the current one', () => {
    const storage = memoryStorage();
    const records: GameRecord[] = [];
    for (let i = 0; i < 12; i++) {
      records.push(playing(`p${i}`, i, { updatedAt: 100 + i }));
      saveGameBlob(storage, `p${i}`, {});
    }
    seed(storage, records);
    saveCurrentId(storage, 'p0');
    const before = storage.getItem(HISTORY);
    freeSpace(storage);
    expect(hasGameBlob(storage, 'p0')).toBe(true);
    expect(hasGameBlob(storage, 'p1')).toBe(false);
    expect(hasGameBlob(storage, 'p2')).toBe(true);
    // No record was dropped, so the history was not rewritten.
    expect(storage.getItem(HISTORY)).toBe(before);
  });

  it('drops finished records beyond the newest 300, with their saved state', () => {
    const storage = memoryStorage();
    seed(
      storage,
      Array.from({ length: 305 }, (_, i) => solved(`s${i}`, i)),
    );
    saveGameBlob(storage, 's0', {});
    freeSpace(storage);
    const after = ids(loadHistory(storage));
    expect(after).toHaveLength(300);
    expect(after).not.toContain('s4');
    expect(after).toContain('s5');
    expect(hasGameBlob(storage, 's0')).toBe(false);
  });

  it('does nothing to an empty storage', () => {
    const storage = quotaStorage();
    freeSpace(storage);
    expect(storage.keys()).toEqual([]);
  });
});

describe('daily records', () => {
  /** Noon UTC on 6 October 2026, when the dailies of the 6th (and, in UTC+14, the 7th) have begun. */
  const OCT_6 = Date.UTC(2026, 9, 6, 12);

  /** A daily attempt: the record with the daily's date, and its tier as the difficulty. */
  const daily = (record: GameRecord, date = '2026-10-06'): GameRecord => ({
    ...record,
    source: 'daily',
    difficulty: 'hard',
    daily: date,
  });

  it('round-trip with their date and source', () => {
    const storage = memoryStorage();
    const record = daily(solved('d', OCT_6, 5000));
    seed(storage, [record]);
    expect(loadHistory(storage)).toEqual([record]);
  });

  it('keep a daily date up to the latest that had begun anywhere when the game was created', () => {
    const storage = memoryStorage();
    // From Daily #1 to the 7th: already the 7th in UTC+14 at noon UTC on the 6th.
    const dates = ['2026-10-01', '2026-10-06', '2026-10-07'];
    seed(
      storage,
      dates.map((date, i) => daily(playing(`d${i}`, OCT_6 - i), date)),
    );
    expect(loadHistory(storage).map((record) => record.daily)).toEqual(dates);
  });

  it.each<[string, unknown]>([
    ['a date before Daily #1', '2026-09-30'],
    ['a date that had not begun anywhere when the game was created', '2026-10-08'],
    ['a date that does not exist', '2027-02-29'],
    ['a date not written as YYYY-MM-DD', '2026-10-6'],
    ['a number', 20261006],
    ['null', null],
    ['an empty string', ''],
  ])('drop %s as the daily, keeping the game', (_label, date) => {
    const storage = memoryStorage();
    seed(storage, [{ ...solved('d', OCT_6), source: 'daily', daily: date }]);
    const [record] = loadHistory(storage);
    expect(record.id).toBe('d');
    expect(record.source).toBe('daily');
    expect(record).not.toHaveProperty('daily');
  });

  it('leave other games’ records as they were stored before dailies', () => {
    const storage = memoryStorage();
    upsertRecord(storage, solved('a', OCT_6));
    expect(loadHistory(storage)[0]).not.toHaveProperty('daily');
    expect(storage.getItem(HISTORY)).not.toContain('daily');
  });

  it('are written by upsertRecord, and refused a bad date there too', () => {
    const storage = memoryStorage();
    upsertRecord(storage, daily(playing('a', OCT_6)));
    upsertRecord(storage, { ...daily(playing('b', OCT_6 + 1)), daily: '2026-02-30' });
    const [b, a] = loadHistory(storage);
    expect(a.daily).toBe('2026-10-06');
    expect(b).not.toHaveProperty('daily');
  });

  it('go out in an export and come back in an import', () => {
    const source = memoryStorage();
    upsertRecord(source, daily(solved('a', OCT_6)));
    const json = exportHistory(source, 0);
    expect(JSON.parse(json).records[0].daily).toBe('2026-10-06');
    const target = memoryStorage();
    importHistory(target, json);
    expect(loadHistory(target)).toEqual(loadHistory(source));
  });

  it('lose a bad daily date on import, but not the game', () => {
    const storage = memoryStorage();
    const file = JSON.stringify({
      app: 'sudoku',
      version: 1,
      exportedAt: 0,
      records: [
        { ...daily(solved('a', OCT_6)), daily: 'tomorrow' },
        // Dated a year before the daily it claims to be.
        { ...daily(solved('b', OCT_6 - 365 * 86_400_000)) },
      ],
    });
    expect(importHistory(storage, file)).toEqual({ ok: true, added: 2, updated: 0 });
    for (const record of loadHistory(storage)) expect(record).not.toHaveProperty('daily');
  });

  it('count a first attempt at a daily like any first attempt, and a replay of one like any replay', () => {
    const stats = computeStats([
      daily(solved('a', OCT_6, 90_000)),
      { ...daily(solved('b', OCT_6 + 1, 30_000)), source: 'replay' as const },
      solved('c', OCT_6 + 2, 120_000, { difficulty: 'hard' }),
    ]);
    expect(stats.hard).toEqual({ played: 3, solved: 3, bestMs: 90_000, averageMs: 105_000 });
  });

  describe('the date an attempt was started on', () => {
    /** 11:00 UTC on the 6th: still the 5th in UTC−12, already the 7th in UTC+14. */
    const ELEVEN = OCT_6 - 3_600_000;
    const started = (startedOn: unknown): GameRecord =>
      ({ ...daily(solved('d', ELEVEN)), startedOn }) as GameRecord;

    it.each(['2026-10-05', '2026-10-06', '2026-10-07'])(
      'is kept as %s, the date somewhere on Earth while the game was played',
      (date) => {
        const storage = memoryStorage();
        seed(storage, [started(date)]);
        expect(loadHistory(storage)[0].startedOn).toBe(date);
      },
    );

    it('may be days after the game was created, if it waited that long behind Start', () => {
      const storage = memoryStorage();
      const waited = { ...started('2026-10-09'), updatedAt: ELEVEN + 3 * 86_400_000 };
      seed(storage, [waited]);
      expect(loadHistory(storage)[0].startedOn).toBe('2026-10-09');
    });

    it.each<[string, unknown]>([
      ['a date before the game was created anywhere', '2026-10-04'],
      ['a date after it was last played anywhere', '2026-10-08'],
      ['a date that does not exist', '2026-10-32'],
      ['a number', 20261006],
    ])('is dropped when it is %s, keeping the game and its daily', (_label, date) => {
      const storage = memoryStorage();
      seed(storage, [started(date)]);
      const [record] = loadHistory(storage);
      expect(record.daily).toBe('2026-10-06');
      expect(record).not.toHaveProperty('startedOn');
    });

    it('is dropped with the daily it belongs to', () => {
      const storage = memoryStorage();
      seed(storage, [{ ...started('2026-10-06'), daily: '2026-09-01' }]);
      expect(loadHistory(storage)[0]).not.toHaveProperty('startedOn');
    });
  });

  describe('the ledger', () => {
    const DAY = 86_400_000;
    /** A Hard daily of 1 October plus `i` days, begun and solved at noon UTC on its own day. */
    const streakDay = (i: number): GameRecord => {
      const date = addDays('2026-10-01', i);
      return {
        ...daily(solved(`d${i}`, Date.UTC(2026, 9, 1, 12) + i * DAY), date),
        startedOn: date,
      };
    };
    /** `count` random solved games, all newer than a month of dailies. */
    const randoms = (count: number): GameRecord[] =>
      Array.from({ length: count }, (_, i) => solved(`r${i}`, Date.UTC(2026, 10, 1) + i));

    it('keeps what pruned dailies said, so a streak outlives their records', () => {
      const storage = memoryStorage();
      const streak = Array.from({ length: 30 }, (_, i) => streakDay(i));
      seed(storage, [...randoms(MAX_RECORDS - 30), ...streak]);
      expect(computeStreak(loadHistory(storage), 'hard', '2026-10-30')).toEqual({
        current: 30,
        best: 30,
      });
      // Thirty more random games push every daily out of the history...
      for (const record of randoms(MAX_RECORDS + 30).slice(MAX_RECORDS - 30)) {
        upsertRecord(storage, record);
      }
      const records = loadHistory(storage);
      expect(records).toHaveLength(MAX_RECORDS);
      expect(records.filter((record) => record.daily !== undefined)).toEqual([]);
      // ...but not out of the streak.
      const ledger = loadDailyLedger(storage);
      expect(computeStreak(records, 'hard', '2026-10-30', ledger)).toEqual({
        current: 30,
        best: 30,
      });
      expect(storage.getItem('sudoku.dailyLedger')).toContain('"2026-10-05":"--d-"');
    });

    it('keeps a pruned daily solved on another day as that', () => {
      const storage = memoryStorage();
      const later = { ...daily(solved('l', OCT_6), '2026-10-05'), startedOn: '2026-10-06' };
      seed(storage, [...randoms(MAX_RECORDS - 1), later]);
      upsertRecord(storage, solved('new', Date.UTC(2026, 11, 1)));
      expect(loadHistory(storage).some((record) => record.daily !== undefined)).toBe(false);
      expect([...loadDailyLedger(storage)]).toEqual([['2026-10-05', { hard: 'solved-later' }]]);
    });

    it('takes nothing from an unfinished daily pruned for space', () => {
      // Unfinished games go only once every finished one has: with a protected
      // history full of them, the oldest goes.
      const storage = memoryStorage();
      const unfinished = daily(playing('u', OCT_6), '2026-10-06');
      const others = Array.from({ length: MAX_RECORDS - 1 }, (_, i) =>
        playing(`p${i}`, Date.UTC(2026, 10, 1) + i),
      );
      seed(storage, [...others, unfinished]);
      upsertRecord(storage, playing('new', Date.UTC(2026, 11, 1)));
      expect(loadHistory(storage).some((record) => record.id === 'u')).toBe(false);
      expect(loadDailyLedger(storage).size).toBe(0);
      expect(storage.getItem('sudoku.dailyLedger')).toBeNull();
    });

    it('keeps a solved daily in the history when the ledger cannot be written', () => {
      const memory = memoryStorage();
      const storage: StorageLike = {
        ...memory,
        getItem: (key) => memory.getItem(key),
        removeItem: (key) => memory.removeItem(key),
        setItem: (key, value) => {
          if (key === 'sudoku.dailyLedger') throw new DOMException('Full', 'QuotaExceededError');
          memory.setItem(key, value);
        },
      };
      seed(storage, [...randoms(MAX_RECORDS - 1), streakDay(0)]);
      upsertRecord(storage, solved('new', Date.UTC(2026, 11, 1)));
      const records = loadHistory(storage);
      // A record too many rather than a streak lost; the oldest random game went instead.
      expect(records.some((record) => record.id === 'd0')).toBe(true);
      expect(records.some((record) => record.id === 'new')).toBe(true);
    });

    it('goes out in an export, and an import adds it to the ledger here, the better standing winning', () => {
      const source = memoryStorage();
      source.setItem('sudoku.dailyLedger', JSON.stringify({ '2026-10-02': 'd-l-' }));
      const json = exportHistory(source, 0);
      expect(JSON.parse(json).dailyLedger).toEqual({ '2026-10-02': 'd-l-' });

      const target = memoryStorage();
      target.setItem(
        'sudoku.dailyLedger',
        JSON.stringify({ '2026-10-01': '---d', '2026-10-02': 'l-d-' }),
      );
      importHistory(target, json);
      expect(JSON.parse(target.getItem('sudoku.dailyLedger')!)).toEqual({
        '2026-10-01': '---d',
        '2026-10-02': 'd-d-',
      });
    });

    it('is left alone by an import with nothing new for it', () => {
      const target = memoryStorage();
      target.setItem('sudoku.dailyLedger', JSON.stringify({ '2026-10-02': 'dddd' }));
      const before = target.getItem('sudoku.dailyLedger');
      const file = JSON.stringify({
        app: 'sudoku',
        version: 1,
        exportedAt: 0,
        records: [],
        dailyLedger: { '2026-10-02': 'llll' },
      });
      importHistory(target, file);
      expect(target.getItem('sudoku.dailyLedger')).toBe(before);
    });

    it('reads a junk day as nothing, and junk overall as an empty ledger', () => {
      const storage = memoryStorage();
      storage.setItem(
        'sudoku.dailyLedger',
        JSON.stringify({
          '2026-10-03': 'd---',
          '2026-09-30': 'dddd',
          '2026-10-32': 'dddd',
          '2026-10-04': 'dx--',
          '2026-10-05': 'ddd',
          '2026-10-06': 4,
          '2026-10-07': '----',
        }),
      );
      expect([...loadDailyLedger(storage)]).toEqual([
        ['2026-10-03', { easy: 'solved-on-the-day' }],
      ]);
      storage.setItem('sudoku.dailyLedger', '["2026-10-03"]');
      expect(loadDailyLedger(storage).size).toBe(0);
    });
  });

  describe('findDailyAttempts', () => {
    it('lists the attempts recorded as one daily, in the order given', () => {
      const records = [
        daily(playing('e', OCT_6 + 5)),
        daily(solved('d', OCT_6 + 4), '2026-10-05'),
        { ...daily(solved('c', OCT_6 + 3)), difficulty: 'easy' as const },
        solved('b', OCT_6 + 2, 1000, { difficulty: 'hard' }),
        daily(solved('a', OCT_6 + 1)),
      ];
      expect(ids(findDailyAttempts(records, '2026-10-06', 'hard'))).toEqual(['e', 'a']);
      expect(ids(findDailyAttempts(records, '2026-10-06', 'easy'))).toEqual(['c']);
      expect(findDailyAttempts(records, '2026-10-07', 'hard')).toEqual([]);
    });
  });
});
