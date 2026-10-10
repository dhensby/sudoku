import type { Difficulty } from '../core';

/*
 * The storage seam every persisted thing goes through.
 *
 * localStorage belongs to the whole origin, and on GitHub Pages that origin is
 * `dhensby.github.io` — shared with every other project hosted there, quota
 * included. So every key is namespaced `sudoku.*`, and every write is allowed
 * to fail: a full quota, a private window that refuses storage, or a browser
 * with storage switched off must cost the player their history at worst, never
 * the game in front of them. Reads are wrapped as well, since some browsers
 * throw on access rather than on write.
 */

/** The subset of the Web Storage API we rely on — easy to fake in tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The key `browserStorage` writes to find out whether localStorage works. */
const PROBE_KEY = '__sudoku_probe__';

/** In-memory storage — the test double, and the fallback when localStorage is unavailable. */
export function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * Whether a storage error is the quota running out, by any of the names and
 * codes browsers have used for it.
 */
function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox before 2020
    code === 22 ||
    code === 1014
  );
}

/**
 * Real localStorage when it works (some browsers throw in private mode, and
 * Safari throws on mere access with site data blocked), else a memory fallback
 * so the game still runs — the history just won't outlive the tab.
 *
 * A probe write refused for quota still counts as working. The origin is
 * shared, so it can fill up with other projects' data while ours sits in it
 * intact; falling back to memory then would hide the player's history and
 * current game, and leave the store no way to prune its own data to make room
 * (see `writeItem`). Reads work in a full storage, and writes fail softly.
 */
export function browserStorage(): StorageLike {
  let storage: StorageLike | undefined;
  try {
    storage = globalThis.localStorage;
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch (error) {
    return storage != null && isQuotaError(error) ? storage : memoryStorage();
  }
}

/** Read a key, or null if it is missing or the storage throws. */
export function readItem(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Read and parse a JSON value, or null if it is missing, corrupt or unreadable. */
export function readJson(storage: StorageLike, key: string): unknown {
  const raw = readItem(storage, key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Remove a key, ignoring a storage that throws. */
export function deleteItem(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* nothing to free, then */
  }
}

function attemptWrite(storage: StorageLike, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Frees space after a write was refused (see `writeItem`). What it returns
 * says what to do next:
 *   false      it found nothing to free: no retry, on to the next stage
 *   true       it freed some, a little at a time, and may free more: if the
 *              retry still fails it is asked again
 *   undefined  it freed what it could in one go: retry, then the next stage
 * True must mean something was freed — a stage that says so while freeing
 * nothing is asked again only up to `MAX_STAGE_ROUNDS` times.
 */
export type MakeRoom = (storage: StorageLike) => boolean | void;

/**
 * The most times one stage of making room is asked again (see `MakeRoom`):
 * far more than any real one needs — the move logs, shed in chunks, take
 * some twenty at worst — and only a bound on one that misbehaves.
 */
export const MAX_STAGE_ROUNDS = 1000;

/**
 * Write a value, best-effort. Returns whether it was stored.
 *
 * A refused write — `QuotaExceededError`, or any other throw — gets another
 * chance after each stage of `makeRoom`, cheapest loss first: each frees what
 * it can (a stage that frees a little at a time is asked again until the
 * write fits or it has nothing left; see `MakeRoom`), then the write is tried
 * again, and the stages stop at the first retry that goes through, so nothing
 * is shed much beyond what the write needed. If every retry fails the value
 * is dropped without a word. Retrying on its own could not help (whatever is
 * filling the origin may not be ours to delete), and surfacing the error
 * would turn a lost save into a broken game.
 */
export function writeItem(
  storage: StorageLike,
  key: string,
  value: string,
  makeRoom?: MakeRoom | readonly MakeRoom[],
): boolean {
  if (attemptWrite(storage, key, value)) return true;
  const stages: readonly MakeRoom[] =
    makeRoom === undefined ? [] : typeof makeRoom === 'function' ? [makeRoom] : makeRoom;
  for (const stage of stages) {
    for (let round = 0; round < MAX_STAGE_ROUNDS; round++) {
      let freed: boolean | void;
      try {
        freed = stage(storage);
      } catch {
        // Whatever it managed to free before throwing still counts: retry
        // anyway, but don't ask it again.
        freed = undefined;
      }
      if (freed === false) break;
      if (attemptWrite(storage, key, value)) return true;
      if (freed !== true) break;
    }
  }
  return false;
}

/**
 * What a game id may look like. `createGameId` writes far less than this
 * allows; the pattern is loose so ids from another version of the game still
 * load, and exists at all so an imported file cannot mint arbitrary storage
 * keys.
 */
export const GAME_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// Field validators shared by the stores
// ---------------------------------------------------------------------------

/** A JSON object — not null, not an array. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every tier, easiest first — the order stats are listed in. */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

/** Whether a value read back from the outside world is a tier the game knows. */
export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value);
}

/**
 * The longest display name kept, in characters (as a reader counts them: an
 * emoji or a flag is one). A longer one is cut to one character less and ends
 * in an ellipsis, so it reads as shortened rather than as someone's full name.
 */
export const MAX_NAME_LENGTH = 24;

/** What a cut name ends with: a single character, so the cut name is still MAX_NAME_LENGTH long. */
const ELLIPSIS = '…';

/**
 * A ceiling on a name's UTF-16 length as well. A single "character" can be
 * built from any number of combining marks, and names arrive in share links
 * from strangers; this keeps one from stacking hundreds of them into a smear
 * across the screen. Ordinary names never get near it.
 */
const MAX_NAME_UNITS = 64;

/**
 * Characters with no business in a name, removed outright: invisible format
 * characters (zero-width spaces, soft hyphens, and the bidi controls that
 * would let a name reorder the text around it — a right-to-left override in
 * "Dan" can make "vs Dan 5:23" read as "vs Dan 32:5"), and unpaired
 * surrogates, which render as �. Spared: the zero-width (non-)joiner, which
 * emoji sequences and scripts such as Persian need, and the tag characters
 * that spell out the flags of England, Scotland and Wales.
 */
const UNWANTED_IN_NAME = /(?!\u200c|\u200d|[\u{e0020}-\u{e007f}])[\p{Cf}\p{Cs}]/gu;

/** Runs of whitespace and control characters (newlines and tabs included). */
const SPACING_IN_NAME = /[\s\p{Cc}]+/gu;

/** A string split into the characters a reader sees (grapheme clusters), where the platform can. */
function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text); // Firefox before 125
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    (part) => part.segment,
  );
}

/**
 * Tidy a display name: invisible and bidi-control characters are removed,
 * runs of whitespace and control characters become one space, and the ends
 * are trimmed. A name still longer than `MAX_NAME_LENGTH` characters (or
 * `MAX_NAME_UNITS` UTF-16 units) is cut to one character less, trimmed again
 * and finished with "…", so "Alexandra the Great of Macedon" shows as
 * "Alexandra the Great of…" rather than as a whole name ending in "M".
 * Anything but a string becomes ''.
 *
 * This is the one place names are tidied, for storage and share links alike,
 * so a name the game accepted always survives a link unchanged: tidying a
 * tidied name, cut or not, gives it back as it was. The cut never splits a
 * character: it counts what a reader sees, so an emoji, a flag or a family is
 * one character and goes whole or not at all (and where the platform cannot
 * tell, it at least never splits a surrogate pair into �).
 */
export function normaliseName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const tidy = value.replace(UNWANTED_IN_NAME, '').replace(SPACING_IN_NAME, ' ').trim();
  const characters = graphemes(tidy);
  if (characters.length <= MAX_NAME_LENGTH && tidy.length <= MAX_NAME_UNITS) return tidy;
  // As many whole characters as leave room for the ellipsis, by either count.
  let name = '';
  for (const grapheme of characters.slice(0, MAX_NAME_LENGTH - 1)) {
    if (name.length + grapheme.length + ELLIPSIS.length > MAX_NAME_UNITS) break;
    name += grapheme;
  }
  name = name.trimEnd();
  // Nothing left before the cut (a lone character stacked past the ceiling)
  // is no name at all, rather than a bare "…".
  return name === '' ? '' : name + ELLIPSIS;
}
