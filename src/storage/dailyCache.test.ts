import { encodeGivens, formatGrid, parseGrid } from '../core';
import { MAX_CACHED_DAILIES, cacheDaily, readCachedDaily } from './dailyCache';
import { memoryStorage } from './storage';
import { quotaStorage, throwingStorage } from '../test/misc-storage';
import { WIKIPEDIA_PUZZLE } from '../test/grids';

const KEY = 'sudoku.dailies';
const PUZZLE = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
/** The same puzzle less its last given: a different set of givens to tell apart. */
const OTHER = PUZZLE.replace(/[1-9](?=0*$)/, '0');

describe('the daily cache', () => {
  it('hands back a daily it kept, for the same date, tier and engine', () => {
    const storage = memoryStorage();
    cacheDaily(storage, 4, '2026-10-06', 'hard', PUZZLE);
    expect(readCachedDaily(storage, 4, '2026-10-06', 'hard')).toBe(PUZZLE);
    expect(readCachedDaily(storage, 4, '2026-10-06', 'easy')).toBeNull();
    expect(readCachedDaily(storage, 4, '2026-10-07', 'hard')).toBeNull();
  });

  it('keeps the givens as a share code, stamped with the engine that dealt them', () => {
    const storage = memoryStorage();
    cacheDaily(storage, 4, '2026-10-06', 'hard', PUZZLE);
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({
      version: 4,
      codes: { '2026-10-06/hard': encodeGivens(PUZZLE) },
    });
  });

  it('reads nothing another engine dealt, and drops it all on the next write', () => {
    const storage = memoryStorage();
    cacheDaily(storage, 4, '2026-10-06', 'hard', PUZZLE);
    expect(readCachedDaily(storage, 5, '2026-10-06', 'hard')).toBeNull();
    cacheDaily(storage, 5, '2026-10-06', 'easy', OTHER);
    expect(JSON.parse(storage.getItem(KEY)!).codes).toEqual({
      '2026-10-06/easy': encodeGivens(OTHER),
    });
  });

  it('replaces a daily kept again, as the most recently written', () => {
    const storage = memoryStorage();
    cacheDaily(storage, 4, '2026-10-06', 'hard', PUZZLE);
    cacheDaily(storage, 4, '2026-10-06', 'easy', PUZZLE);
    cacheDaily(storage, 4, '2026-10-06', 'hard', OTHER);
    expect(readCachedDaily(storage, 4, '2026-10-06', 'hard')).toBe(OTHER);
    expect(Object.keys(JSON.parse(storage.getItem(KEY)!).codes)).toEqual([
      '2026-10-06/easy',
      '2026-10-06/hard',
    ]);
  });

  it(`keeps the ${MAX_CACHED_DAILIES} written last`, () => {
    const storage = memoryStorage();
    const dates = Array.from({ length: MAX_CACHED_DAILIES + 2 }, (_, i) =>
      new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10),
    );
    for (const date of dates) cacheDaily(storage, 4, date, 'easy', PUZZLE);
    const kept = Object.keys(JSON.parse(storage.getItem(KEY)!).codes);
    expect(kept).toHaveLength(MAX_CACHED_DAILIES);
    expect(kept[0]).toBe(`${dates[2]}/easy`);
    expect(readCachedDaily(storage, 4, dates[1], 'easy')).toBeNull();
    expect(readCachedDaily(storage, 4, dates.at(-1)!, 'easy')).toBe(PUZZLE);
  });

  it('reads junk as nothing, entry by entry', () => {
    const storage = memoryStorage();
    const code = encodeGivens(PUZZLE);
    storage.setItem(
      KEY,
      JSON.stringify({
        version: 4,
        codes: {
          '2026-10-06/hard': code,
          '2026-02-30/hard': code,
          '2026-10-06/fiendish': code,
          '2026-10-06': code,
          '2026-10-07/hard': 42,
          '2026-10-08/hard': 'not a code!',
          // Shaped like a code, but decodes to nothing.
          '2026-10-09/hard': '_'.repeat(64),
        },
      }),
    );
    expect(readCachedDaily(storage, 4, '2026-10-06', 'hard')).toBe(PUZZLE);
    for (const date of ['2026-10-07', '2026-10-08', '2026-10-09']) {
      expect(readCachedDaily(storage, 4, date, 'hard')).toBeNull();
    }
    cacheDaily(storage, 4, '2026-10-10', 'easy', PUZZLE);
    expect(Object.keys(JSON.parse(storage.getItem(KEY)!).codes)).toEqual([
      '2026-10-06/hard',
      '2026-10-09/hard',
      '2026-10-10/easy',
    ]);
  });

  it('reads a cache that is not one at all as empty', () => {
    for (const stored of ['not json', '[]', '{"version":4}', '{"version":4,"codes":[]}']) {
      const storage = memoryStorage();
      storage.setItem(KEY, stored);
      expect(readCachedDaily(storage, 4, '2026-10-06', 'hard')).toBeNull();
    }
  });

  it('drops a write the browser refuses, without making room at anything else’s cost', () => {
    const storage = quotaStorage(30);
    storage.setItem('sudoku.history', '[]');
    expect(() => cacheDaily(storage, 4, '2026-10-06', 'hard', PUZZLE)).not.toThrow();
    expect(storage.keys()).toEqual(['sudoku.history']);
  });

  it('copes with storage that throws on every call', () => {
    const storage = throwingStorage({ get: true, set: true });
    expect(() => cacheDaily(storage, 4, '2026-10-06', 'hard', PUZZLE)).not.toThrow();
    expect(readCachedDaily(storage, 4, '2026-10-06', 'hard')).toBeNull();
  });
});
