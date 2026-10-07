import {
  decodeGivens,
  encodeGivens,
  isDateKey,
  looksLikeShareCode,
  type DateKey,
  type Difficulty,
  type GridString,
} from '../core';
import { isDifficulty, isObject, readJson, writeItem, type StorageLike } from './storage';

/*
 * The daily puzzles this browser has dealt, kept between visits, so today's
 * (and any day's opened again) are to hand at once rather than dealt
 * afresh: an Expert can take a tenth of a second on a laptop, and a few
 * tenths on a slow phone — and a page showing a spinner for it needs none.
 *
 *   sudoku.dailies   { "version": <GENERATOR_VERSION>, "codes": { "2026-10-06/hard": "<share code>", … } }
 *
 * Only a cache — any of it can be dealt again from its date — so it is held
 * loosely: stamped with the `GENERATOR_VERSION` that dealt it and read back
 * only by that version (a new engine deals new puzzles from the same seeds),
 * held to the MAX_CACHED_DAILIES written last, and never written at the cost
 * of anything else: a write the browser refuses is dropped, rather than
 * making room by shedding the history (see `freeSpace`).
 */

/** The most dailies kept: four weeks of all four tiers. */
export const MAX_CACHED_DAILIES = 112;

const CACHE_KEY = 'sudoku.dailies';

/** An entry's key: the daily's date and tier. */
const ENTRY_KEY = /^(\d{4}-\d{2}-\d{2})\/([a-z]+)$/;

/** Whether a key names a real date and tier. */
function isEntryKey(key: string): boolean {
  const match = ENTRY_KEY.exec(key);
  return match !== null && isDateKey(match[1]) && isDifficulty(match[2]);
}

/**
 * The cached codes `version` dealt, by entry key, in the order they were
 * written. Anything else — another version's, junk, an entry that is not a
 * date and tier with something shaped like a share code — reads as nothing.
 */
function readCodes(storage: StorageLike, version: number): Map<string, string> {
  const stored = readJson(storage, CACHE_KEY);
  const codes = new Map<string, string>();
  if (!isObject(stored) || stored.version !== version || !isObject(stored.codes)) return codes;
  for (const [key, code] of Object.entries(stored.codes)) {
    if (isEntryKey(key) && typeof code === 'string' && looksLikeShareCode(code)) {
      codes.set(key, code);
    }
  }
  return codes;
}

/**
 * The givens of a daily as `version` dealt it, if this browser has kept it;
 * else null (as for a code that no longer decodes). Whether they still make a
 * puzzle is the caller's to check, as it solves them anyway.
 */
export function readCachedDaily(
  storage: StorageLike,
  version: number,
  date: DateKey,
  tier: Difficulty,
): GridString | null {
  const code = readCodes(storage, version).get(`${date}/${tier}`);
  return code === undefined ? null : decodeGivens(code);
}

/**
 * Keep a daily `version` dealt, as the most recently written: beyond
 * MAX_CACHED_DAILIES the one written longest ago goes, and so does
 * everything another version dealt. Best-effort, and never makes room.
 */
export function cacheDaily(
  storage: StorageLike,
  version: number,
  date: DateKey,
  tier: Difficulty,
  givens: GridString,
): void {
  const codes = readCodes(storage, version);
  const key = `${date}/${tier}`;
  codes.delete(key);
  codes.set(key, encodeGivens(givens));
  const kept = [...codes].slice(-MAX_CACHED_DAILIES);
  writeItem(storage, CACHE_KEY, JSON.stringify({ version, codes: Object.fromEntries(kept) }));
}
