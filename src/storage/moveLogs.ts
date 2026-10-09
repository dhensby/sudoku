import {
  MOVES_VERSION,
  decodeMoveLog,
  encodeMoveLog,
  readMoveLogHeader,
  type MoveLog,
} from '../core';
import {
  GAME_ID_PATTERN,
  deleteItem,
  readItem,
  readJson,
  writeItem,
  type MakeRoom,
  type StorageLike,
} from './storage';

/*
 * The move logs of the games in the history (see `src/core/moves.ts`): what
 * mistakes are counted from and a solve is played back from.
 *
 * Two kinds of key:
 *   sudoku.moves.<id>   one game's log, as `encodeMoveLog` writes it — a
 *                       plain base64url string, some 200–1,100 characters
 *   sudoku.moveLogs     the ids that have a `sudoku.moves.<id>` key
 *
 * A key of their own, rather than a field of the game's record or its saved
 * board: the history is rewritten whole every few hundred milliseconds of
 * play, and a thousand logs in it would make every save cost a megabyte; a
 * finished game's board is dropped as soon as it leaves the screen, and its
 * log must outlast it, as playback rebuilds a game from its givens and its
 * log alone; and a tab left open on an older version rewrites records and
 * boards with the fields it knows, but never touches these keys.
 *
 * Only the encoded string is stored, and it is decoded strictly on the way
 * back in — a log that does not decode (hand-edited, cut short, or recorded
 * under rules this version does not replay) reads as none at all, never as
 * part of one.
 *
 * As with saved games (see `history.ts`), the list is what lets the store tidy
 * up without enumerating storage or visiting a key per record. It may name a
 * game with no log (a write or delete that failed partway; deleting a missing
 * key is harmless), but every log is on it.
 *
 * Which logs are kept, and which go first when space runs out, is the
 * history's business: this module only reads and writes them.
 */

const KEY_PREFIX = 'sudoku.moves.';
const LIST_KEY = 'sudoku.moveLogs';

/** A log as last written for a game: the object, and the string it was stored as. */
interface Written {
  log: MoveLog;
  encoded: string;
}

/**
 * The log each id was last written with, or null for one this module last
 * deleted, per storage: a log is saved with its game every few hundred
 * milliseconds of play, and most of those saves are for the clock alone, with
 * the log the very same object as last time. Encoding and writing it again
 * would cost its whole length for nothing. Reading what is stored to make sure
 * it is still that costs far less, and catches another tab on the same game
 * having written over it (or deleted it), so the log stored always goes with
 * the board saved beside it. Forgotten for an id whenever this module stores
 * or deletes its key by any other way.
 */
const written = new WeakMap<StorageLike, Map<string, Written | null>>();

function writtenTo(storage: StorageLike): Map<string, Written | null> {
  let cache = written.get(storage);
  if (cache === undefined) {
    cache = new Map();
    written.set(storage, cache);
  }
  return cache;
}

function logKey(id: string): string {
  return KEY_PREFIX + id;
}

/** The ids listed as having a log. Junk in the list costs only itself. */
export function readMoveLogIds(storage: StorageLike): string[] {
  const parsed = readJson(storage, LIST_KEY);
  if (!Array.isArray(parsed)) return [];
  const ids = parsed.filter(
    (id): id is string => typeof id === 'string' && GAME_ID_PATTERN.test(id),
  );
  return [...new Set(ids)];
}

/** A game's log as stored, still encoded; null if it has none. */
export function loadEncodedMoveLog(storage: StorageLike, id: string): string | null {
  return readItem(storage, logKey(id));
}

/** A game's log, decoded; null if it has none, or the one stored does not decode. */
export function loadMoveLog(storage: StorageLike, id: string): MoveLog | null {
  return decodeMoveLog(loadEncodedMoveLog(storage, id));
}

/** What a game's log takes in storage, in characters (key and value, as browsers count them). */
export function moveLogSize(storage: StorageLike, id: string): number {
  const encoded = loadEncodedMoveLog(storage, id);
  return encoded === null ? 0 : logKey(id).length + encoded.length;
}

/**
 * Write an encoded log, then list it. If the list cannot be updated the log is
 * taken back out again, so that it can never end up stored but unlisted.
 * Returns whether the log is stored.
 */
export function storeMoveLog(
  storage: StorageLike,
  id: string,
  encoded: string,
  makeRoom?: MakeRoom | readonly MakeRoom[],
): boolean {
  writtenTo(storage).delete(id);
  if (!writeItem(storage, logKey(id), encoded, makeRoom)) return false;
  const ids = readMoveLogIds(storage);
  if (ids.includes(id)) return true;
  if (writeItem(storage, LIST_KEY, JSON.stringify([...ids, id]), makeRoom)) return true;
  deleteItem(storage, logKey(id));
  return false;
}

/**
 * Write many encoded logs at once, as an import does, into the space that is
 * free and no more: none is written at the cost of anything already stored.
 * Listed first and written after, so the list is rewritten twice rather than
 * once a log; a log that does not fit is taken off the list again (a shorter
 * list always fits where the longer one did). Returns the ids stored.
 */
export function storeMoveLogs(
  storage: StorageLike,
  entries: readonly (readonly [id: string, encoded: string])[],
): string[] {
  if (entries.length === 0) return [];
  const listed = readMoveLogIds(storage);
  const fresh = entries.map(([id]) => id).filter((id) => !listed.includes(id));
  if (!writeItem(storage, LIST_KEY, JSON.stringify([...listed, ...fresh]))) return [];
  const cache = writtenTo(storage);
  const stored: string[] = [];
  for (const [id, encoded] of entries) {
    cache.delete(id);
    if (writeItem(storage, logKey(id), encoded)) stored.push(id);
  }
  const missing = new Set(fresh.filter((id) => !stored.includes(id)));
  if (missing.size > 0)
    writeList(
      storage,
      readMoveLogIds(storage).filter((id) => !missing.has(id)),
    );
  return stored;
}

/**
 * Whether an encoded log is one a newer build wrote, which this one cannot
 * read but must not judge either: a later format, a later rules version, or
 * this build's own versions with an intact check that still does not decode —
 * a move code added since (see `src/core/moves.ts`: a new kind of move takes
 * an unused code, with no new version). A log from an older rules version, or
 * one that is broken, is this build's to judge.
 */
export function isNewerMoveLog(encoded: string): boolean {
  if (decodeMoveLog(encoded) !== null) return false;
  const header = readMoveLogHeader(encoded);
  // A format this build cannot read says no rules version: a newer one.
  return header !== null && (header.rules ?? Number.POSITIVE_INFINITY) >= MOVES_VERSION;
}

/**
 * Save a game's log, or with null make sure it has none: a game whose log
 * stopped being kept (see `Session.moves`) must not leave an old one behind,
 * which would read as the record of a game that went differently — unless
 * the log stored is a newer build's (see `isNewerMoveLog`). This build cannot
 * tell whether that one still matches the game, so it leaves it for the build
 * that can, which checks it against the board before trusting it.
 *
 * Skipped when the very same log (or null) was the last thing saved for the
 * game and storage still holds it (see `written`). A log that cannot be
 * stored takes the one stored before with it: that one stops short of the
 * game now saved beside it, and kept, it would read as the whole game once
 * the board is gone. Returns whether storage now holds what was asked.
 */
export function saveMoveLog(
  storage: StorageLike,
  id: string,
  log: MoveLog | null,
  makeRoom?: MakeRoom | readonly MakeRoom[],
): boolean {
  const cache = writtenTo(storage);
  const last = cache.get(id);
  const stored = loadEncodedMoveLog(storage, id);
  if (log === null) {
    if (last === null && stored === null) return true;
    if (stored !== null && isNewerMoveLog(stored)) {
      cache.delete(id);
      return true;
    }
    deleteMoveLog(storage, id);
    cache.set(id, null);
    return true;
  }
  const encoded = last?.log === log ? last.encoded : encodeMoveLog(log);
  if (last?.log === log && stored === encoded) return true;
  if (!storeMoveLog(storage, id, encoded, makeRoom)) {
    deleteMoveLog(storage, id);
    return false;
  }
  cache.set(id, { log, encoded });
  return true;
}

/** Write the list, or remove it once empty. A shorter list always fits where the longer one did. */
function writeList(storage: StorageLike, ids: readonly string[]): void {
  if (ids.length === 0) deleteItem(storage, LIST_KEY);
  else writeItem(storage, LIST_KEY, JSON.stringify(ids));
}

/**
 * Delete the log of every listed game `isDropped` picks, and take them off the
 * list. Returns whether any was dropped.
 */
export function dropMoveLogs(storage: StorageLike, isDropped: (id: string) => boolean): boolean {
  const ids = readMoveLogIds(storage);
  const kept = ids.filter((id) => !isDropped(id));
  if (kept.length === ids.length) return false;
  const cache = writtenTo(storage);
  for (const id of ids) {
    if (!isDropped(id)) continue;
    deleteItem(storage, logKey(id));
    cache.delete(id);
  }
  writeList(storage, kept);
  return true;
}

/** Delete a game's log, if it has one. */
export function deleteMoveLog(storage: StorageLike, id: string): void {
  // An unlisted key should not exist, but if one does, it goes too.
  if (!dropMoveLogs(storage, (listed) => listed === id)) deleteItem(storage, logKey(id));
  writtenTo(storage).delete(id);
}
