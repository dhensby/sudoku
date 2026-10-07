import {
  BOX,
  COL,
  DAILY_EPOCH,
  ROW,
  bit,
  createRng,
  daysBetween,
  earliestDateAnywhere,
  encodeGivens,
  isDateKey,
  isGridString,
  latestDateAnywhere,
  looksLikeShareCode,
  type Assists,
  type DateKey,
  type Difficulty,
  type GridString,
  type RandomFn,
} from '../core';
import {
  DIFFICULTIES,
  deleteItem,
  isDifficulty,
  isObject,
  normaliseName,
  readItem,
  readJson,
  writeItem,
  type StorageLike,
} from './storage';
import {
  EMPTY_LEDGER,
  addToLedger,
  mergeLedgers,
  type DailyLedger,
  type SolvedStatus,
} from './streaks';

/*
 * The history of every game played, the saved state of unfinished ones, and
 * the puzzles the player has seen.
 *
 * Six kinds of key:
 *   sudoku.history      the list of `GameRecord`s, newest first
 *   sudoku.game.<id>    one game's saved state, opaque here (the game module
 *                       validates it on the way back in)
 *   sudoku.games        the ids that have a `sudoku.game.<id>` key
 *   sudoku.current      the id of the game on screen
 *   sudoku.seen         the share codes of puzzles whose board has been on
 *                       show, least recently seen first (see `markSeen`)
 *   sudoku.dailyLedger  what the solved dailies among pruned records said,
 *                       so streaks outlast them (see `DailyLedger`)
 *
 * Records are small and kept for a long time (up to MAX_RECORDS); saved games
 * are a few times bigger and only worth keeping while someone might resume
 * them. So a record outlives its saved state: an unfinished game that falls
 * beyond MAX_SAVED_GAMES keeps its record and can still be replayed from its
 * givens, and a finished game's state is dropped as soon as it stops being
 * the game on screen — nothing but the current game ever reopens a finished
 * one. When the browser refuses a write for space, the store sheds the
 * cheapest data first (see `freeSpace`) and tries once more.
 *
 * The list of saved games is what lets the store tidy up without touching
 * every record: the history is saved every few hundred milliseconds of play,
 * and checking a thousand `sudoku.game.*` keys each time — almost all of them
 * absent — is work the browser does synchronously on the main thread. The
 * list may name a game with nothing saved (when some write or delete failed
 * partway; deleting a missing key is harmless), but every saved game is on
 * it: one that is not would be invisible to every sweep and sit in the quota
 * for good.
 *
 * Everything read back is validated record by record. Storage can be
 * hand-edited, written by another version of the game, or imported from a
 * file, and one bad record must cost that record only — never the history.
 */

/** Someone else's result that a shared link carried, to compare against. */
export interface Challenge {
  /** The challenger's display name from the link, or null. */
  name: string | null;
  /** Their time in whole seconds. */
  seconds: number;
  /** The help their time came with. */
  assists: Assists;
}

/**
 * Where a game's puzzle came from: the generator, a daily puzzle opened as
 * one (from the New game menu), a shared link, or a replay of a puzzle
 * already seen — which is what any attempt at a seen puzzle is,
 * whatever brought it back (see `hasSeen`). Only replays are left out of best
 * and average times; and only generated games are dropped as glimpses, so an
 * unplayed daily is kept, to resume, rather than turned into a replay.
 */
export type GameSource = 'generated' | 'daily' | 'shared' | 'replay';

/** One game, played or in progress. */
export interface GameRecord {
  id: string;
  givens: GridString;
  difficulty: Difficulty;
  source: GameSource;
  /** When the game was created (epoch ms). Records are listed newest first by this. */
  createdAt: number;
  /** When the record last changed (epoch ms). An import keeps whichever copy changed last. */
  updatedAt: number;
  /** When the puzzle was solved (epoch ms), or null while unfinished. */
  completedAt: number | null;
  status: 'playing' | 'solved';
  /** Time on the clock: the final time once solved. */
  elapsedMs: number;
  /** The help taken during the game. */
  assists: Assists;
  /** The result this game is being played against, if it came from a link that carried one. */
  challenge: Challenge | null;
  /**
   * The date of the daily this game is an attempt at; the daily's tier is the
   * record's `difficulty`. Absent for every other game — including a puzzle
   * that happens to be a daily but was not opened as one, such as from a
   * link without a date hint. Set on every attempt at a daily, whatever its
   * source: a first attempt ('daily'), a link whose date hint checked out
   * ('shared') and a replay alike. Which of them count towards a streak is
   * `streaks.ts`'s business.
   */
  daily?: DateKey;
  /**
   * For a daily attempt, the player's own date when its clock first ran —
   * written down then, as the device's time zone had it, because the same
   * moment read in another zone later can fall on another date (see
   * `streaks.ts`). Absent until the attempt is started (one waiting behind
   * its Start card has not been), and on every other game.
   */
  startedOn?: DateKey;
}

/** Totals for one tier. */
export interface DifficultyStats {
  /** Games started, finished or not. */
  played: number;
  solved: number;
  /** Fastest solve that counts (no reveals, not a replay), or null if there is none. */
  bestMs: number | null;
  /** Mean time of the solves that count, rounded to the millisecond, or null if there are none. */
  averageMs: number | null;
}

/** What an import did, or that the file was not a Sudoku history at all. */
export type ImportResult = { ok: true; added: number; updated: number } | { ok: false };

/** The most records kept. Beyond it the oldest finished games go first. */
export const MAX_RECORDS = 1000;
/** The most unfinished games whose state is kept for resuming. */
export const MAX_SAVED_GAMES = 50;
/**
 * The most puzzles remembered as seen. Beyond it the one seen longest ago is
 * forgotten. Twice MAX_RECORDS, so a puzzle outlives its record here; at
 * about 30 characters a code, a full list is some 60 KB.
 */
export const MAX_SEEN = 2000;

/** After a write is refused for space: unfinished games whose state survives… */
const SAVED_GAMES_WHEN_FULL = 10;
/** …and finished records that survive. */
const FINISHED_RECORDS_WHEN_FULL = 300;

const HISTORY_KEY = 'sudoku.history';
const CURRENT_KEY = 'sudoku.current';
const SAVED_KEY = 'sudoku.games';
const GAME_KEY_PREFIX = 'sudoku.game.';
const SEEN_KEY = 'sudoku.seen';
const LEDGER_KEY = 'sudoku.dailyLedger';

/** The fewest givens a uniquely solvable Sudoku can have. */
const MIN_GIVENS = 17;

/** Export file envelope. */
const EXPORT_APP = 'sudoku';
const EXPORT_VERSION = 1;

/**
 * What an id may look like. `createGameId` writes far less than this allows;
 * the pattern is loose so ids from another version of the game still load,
 * and exists at all so an imported file cannot mint arbitrary storage keys.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const GAME_SOURCES: readonly string[] = ['generated', 'daily', 'shared', 'replay'];

function gameKey(id: string): string {
  return GAME_KEY_PREFIX + id;
}

/**
 * A fresh game id: the creation time in base 36, a dash, and four random
 * base-36 characters (`mbx3k2f0-q7za`). Time first, so ids sort roughly by
 * age; the random tail keeps two games created in the same millisecond — a
 * double-clicked New game — apart.
 */
export function createGameId(now: number, rng: RandomFn = createRng()): string {
  const time = Number.isFinite(now) && now > 0 ? Math.floor(now) : 0;
  let tail = '';
  for (let k = 0; k < 4; k++) tail += ID_ALPHABET[Math.floor(rng() * ID_ALPHABET.length)];
  return `${time.toString(36)}-${tail}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A whole, non-negative count; anything else counts as none. */
function toCount(value: unknown): number {
  return isFiniteNumber(value) && value > 0 ? Math.floor(value) : 0;
}

function normaliseAssists(value: unknown): Assists {
  const source = isObject(value) ? value : {};
  return {
    autoCandidates: source.autoCandidates === true,
    hints: toCount(source.hints),
    checks: toCount(source.checks),
    reveals: toCount(source.reveals),
  };
}

/**
 * Whether givens could start a game: at least 17 of them and no two clashing.
 * This turns away records from a hand-edited file — all zeros, say — that the
 * share code cannot encode and that would sit in the stats as a best time for
 * a puzzle nobody could have played. Whether there is exactly one solution is
 * left to `checkGivens` on replay: that costs a search, and this runs on every
 * record at every load.
 */
function isPlayable(givens: GridString): boolean {
  const seen = new Uint16Array(27);
  let count = 0;
  for (let i = 0; i < 81; i++) {
    const digit = givens.charCodeAt(i) - 48;
    if (digit === 0) continue;
    const digitBit = bit(digit);
    const row = ROW[i];
    const column = 9 + COL[i];
    const box = 18 + BOX[i];
    if ((seen[row] | seen[column] | seen[box]) & digitBit) return false;
    seen[row] |= digitBit;
    seen[column] |= digitBit;
    seen[box] |= digitBit;
    count++;
  }
  return count >= MIN_GIVENS;
}

/**
 * Whether a value can be the date of a daily begun at `createdAt`: a real
 * date from Daily #1 to the latest that had begun anywhere on Earth by then.
 * Not the player's own date: a link from a friend whose day is already the
 * next can open that day's daily before the player's date reaches it. But no
 * daily exists before its date has begun somewhere, so a record that says
 * otherwise has been tampered with.
 */
function isDailyDate(value: unknown, createdAt: number): value is DateKey {
  return (
    isDateKey(value) &&
    daysBetween(DAILY_EPOCH, value) >= 0 &&
    daysBetween(value, latestDateAnywhere(createdAt)) >= 0
  );
}

/**
 * Whether a value can be the date a daily attempt created at `createdAt` and
 * last changed at `updatedAt` was started on: a real date that was the date
 * somewhere on Earth at some moment in between — so whatever zone the device
 * was in. One that was not is tampered with.
 */
function isStartDate(value: unknown, createdAt: number, updatedAt: number): value is DateKey {
  return (
    isDateKey(value) &&
    daysBetween(earliestDateAnywhere(createdAt), value) >= 0 &&
    daysBetween(value, latestDateAnywhere(updatedAt)) >= 0
  );
}

/** A usable challenge, or null — a broken one only costs the comparison, so it never sinks the record. */
function normaliseChallenge(value: unknown): Challenge | null {
  if (!isObject(value)) return null;
  const { seconds } = value;
  if (!isFiniteNumber(seconds) || seconds < 1) return null;
  const name = normaliseName(value.name);
  return {
    name: name === '' ? null : name,
    seconds: Math.floor(seconds),
    assists: normaliseAssists(value.assists),
  };
}

/**
 * A well-formed record, or null if it is not one.
 *
 * Fields the history cannot do without — id, givens (playable ones, see
 * `isPlayable`), tier, status, creation time and the time on the clock — must
 * be right, or the record is dropped: a solved game with a made-up time would
 * sit in the stats as a best. Fields
 * that are merely odd are coerced: an unknown source reads as 'generated',
 * timestamps out of order are pulled level, missing assists count as none,
 * and a broken challenge or daily date is dropped on its own — the game is
 * still a game, just not one against a rival or a daily.
 */
function normaliseRecord(value: unknown): GameRecord | null {
  if (!isObject(value)) return null;
  const { id, givens, difficulty, status, createdAt, elapsedMs } = value;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  if (!isGridString(givens) || !isPlayable(givens) || !isDifficulty(difficulty)) return null;
  if (status !== 'playing' && status !== 'solved') return null;
  if (!isFiniteNumber(createdAt) || createdAt < 0) return null;
  if (!isFiniteNumber(elapsedMs) || elapsedMs < 0) return null;

  const updatedAt = isFiniteNumber(value.updatedAt)
    ? Math.max(value.updatedAt, createdAt)
    : createdAt;
  let completedAt: number | null = null;
  if (status === 'solved') {
    completedAt = isFiniteNumber(value.completedAt)
      ? Math.max(value.completedAt, createdAt)
      : updatedAt;
  }
  const isDaily = isDailyDate(value.daily, createdAt);
  return {
    id,
    givens,
    difficulty,
    source: GAME_SOURCES.includes(value.source as string)
      ? (value.source as GameSource)
      : 'generated',
    createdAt,
    updatedAt,
    completedAt,
    status,
    elapsedMs,
    assists: normaliseAssists(value.assists),
    challenge: normaliseChallenge(value.challenge),
    // Left off altogether rather than null, so the records of other games —
    // nearly all of them — are stored just as they were before dailies.
    ...(isDaily ? { daily: value.daily as DateKey } : {}),
    ...(isDaily && isStartDate(value.startedOn, createdAt, updatedAt)
      ? { startedOn: value.startedOn }
      : {}),
  };
}

/** One record per id, keeping the copy that changed last. */
function dedupe(records: readonly GameRecord[]): GameRecord[] {
  const byId = new Map<string, GameRecord>();
  for (const record of records) {
    const seen = byId.get(record.id);
    if (seen === undefined || record.updatedAt > seen.updatedAt) byId.set(record.id, record);
  }
  return [...byId.values()];
}

/** Sort in place, newest `createdAt` first. Stable, so ties keep their order. */
function sortNewestFirst(records: GameRecord[]): GameRecord[] {
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

function parseRecords(items: readonly unknown[]): GameRecord[] {
  const records: GameRecord[] = [];
  for (const item of items) {
    const record = normaliseRecord(item);
    if (record !== null) records.push(record);
  }
  return dedupe(records);
}

// ---------------------------------------------------------------------------
// The list of saved games
// ---------------------------------------------------------------------------

/** The ids listed as having saved state. Junk in the list costs only itself. */
function readSavedIds(storage: StorageLike): string[] {
  const parsed = readJson(storage, SAVED_KEY);
  if (!Array.isArray(parsed)) return [];
  const ids = parsed.filter((id): id is string => typeof id === 'string' && ID_PATTERN.test(id));
  return [...new Set(ids)];
}

/**
 * Write a game's state, then list it. If the list cannot be updated the state
 * is taken back out again, so that it can never end up saved but unlisted
 * (see the module comment). Returns whether the game is saved.
 */
function storeGame(
  storage: StorageLike,
  id: string,
  json: string,
  makeRoom?: (storage: StorageLike) => void,
): boolean {
  if (!writeItem(storage, gameKey(id), json, makeRoom)) return false;
  const ids = readSavedIds(storage);
  if (ids.includes(id)) return true;
  if (writeItem(storage, SAVED_KEY, JSON.stringify([...ids, id]), makeRoom)) return true;
  deleteItem(storage, gameKey(id));
  return false;
}

/**
 * Delete the saved state of every listed game `isDropped` picks, and take
 * them off the list. Returns whether any was dropped. A shorter list always
 * fits where the longer one did, so its write needs no room made.
 */
function dropSavedGames(storage: StorageLike, isDropped: (id: string) => boolean): boolean {
  const ids = readSavedIds(storage);
  const kept = ids.filter((id) => !isDropped(id));
  if (kept.length === ids.length) return false;
  for (const id of ids) if (isDropped(id)) deleteItem(storage, gameKey(id));
  if (kept.length === 0) deleteItem(storage, SAVED_KEY);
  else writeItem(storage, SAVED_KEY, JSON.stringify(kept));
  return true;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** Ids that pruning must never touch: the game on screen, plus any extras. */
function protectedIds(storage: StorageLike, ...extra: string[]): Set<string> {
  const ids = new Set(extra);
  const current = loadCurrentId(storage);
  if (current !== null) ids.add(current);
  return ids;
}

/** The ids of up to `count` records of a status, oldest first, never a protected one. */
function oldest(
  records: readonly GameRecord[],
  status: GameRecord['status'],
  count: number,
  keep: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  for (let i = records.length - 1; i >= 0 && ids.length < count; i--) {
    const record = records[i];
    if (record.status === status && !keep.has(record.id)) ids.push(record.id);
  }
  return ids;
}

/**
 * Drop records by id, along with their saved games. A solved daily goes only
 * once what it said is safely in the ledger (see `DailyLedger`): if the
 * ledger cannot be written, the daily stays — a record too many is better
 * than a streak lost.
 */
function removeRecords(
  storage: StorageLike,
  records: GameRecord[],
  ids: readonly string[],
): GameRecord[] {
  if (ids.length === 0) return records;
  const drop = new Set(ids);
  const ledger = loadDailyLedger(storage);
  const kept = addToLedger(
    ledger,
    records.filter((record) => drop.has(record.id)),
  );
  if (kept !== ledger && !writeItem(storage, LEDGER_KEY, JSON.stringify(encodeLedger(kept)))) {
    for (const record of records) {
      if (record.daily !== undefined && record.status === 'solved') drop.delete(record.id);
    }
  }
  dropSavedGames(storage, (id) => drop.has(id));
  return records.filter((record) => !drop.has(record.id));
}

/** Hold the list to MAX_RECORDS: the oldest finished games go first, then the oldest unfinished. */
function capRecords(
  storage: StorageLike,
  records: GameRecord[],
  keep: ReadonlySet<string>,
): GameRecord[] {
  const excess = records.length - MAX_RECORDS;
  if (excess <= 0) return records;
  const ids = oldest(records, 'solved', excess, keep);
  ids.push(...oldest(records, 'playing', excess - ids.length, keep));
  return removeRecords(storage, records, ids);
}

/** The games whose saved state is worth keeping: the protected ones and the `limit` most recently played unfinished ones. */
function savedGameSlots(
  records: readonly GameRecord[],
  limit: number,
  keep: ReadonlySet<string>,
): Set<string> {
  const slots = new Set(keep);
  const unfinished = records
    .filter((record) => record.status === 'playing')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const record of unfinished.slice(0, limit)) slots.add(record.id);
  return slots;
}

/**
 * Delete saved game state nobody will resume: everything but that of the
 * protected games (by default, the current one) and of the `limit` most
 * recently played unfinished games. Only listed games are visited, so this
 * costs one key per saved game, not one per record.
 */
function sweepSavedGames(
  storage: StorageLike,
  records: readonly GameRecord[],
  limit: number,
  keep: ReadonlySet<string> = protectedIds(storage),
): void {
  const slots = savedGameSlots(records, limit, keep);
  dropSavedGames(storage, (id) => !slots.has(id));
}

/**
 * Make room after a refused write, cheapest losses first: the saved state of
 * all but the 10 most recently played unfinished games (their records stay,
 * replayable from the givens), then finished records beyond the newest 300.
 * Neither touches a protected game. Returns the records that remain.
 */
function shed(
  storage: StorageLike,
  records: GameRecord[],
  keep: ReadonlySet<string>,
): GameRecord[] {
  sweepSavedGames(storage, records, SAVED_GAMES_WHEN_FULL, keep);
  const finished = records.filter((record) => record.status === 'solved').length;
  const excess = finished - FINISHED_RECORDS_WHEN_FULL;
  return removeRecords(storage, records, oldest(records, 'solved', excess, keep));
}

/**
 * Write the record list. If the browser refuses it, shed what can be spared —
 * from this very list, so the retry is smaller, and never a game in `keep` —
 * and try once more. Returns the list as it now stands, whether or not the
 * write went through: persistence is best-effort, and the session carries on
 * regardless.
 */
function saveRecords(
  storage: StorageLike,
  records: GameRecord[],
  keep: ReadonlySet<string> = protectedIds(storage),
): GameRecord[] {
  if (writeItem(storage, HISTORY_KEY, JSON.stringify(records))) return records;
  const kept = shed(storage, records, keep);
  writeItem(storage, HISTORY_KEY, JSON.stringify(kept));
  return kept;
}

/**
 * Free space after some other write was refused (see `writeItem`): sheds
 * saved games and old finished records as `saveRecords` does, and rewrites
 * the history if that dropped any records.
 */
export function freeSpace(storage: StorageLike): void {
  const records = loadHistory(storage);
  const kept = shed(storage, records, protectedIds(storage));
  if (kept.length < records.length) writeItem(storage, HISTORY_KEY, JSON.stringify(kept));
}

// ---------------------------------------------------------------------------
// The daily ledger
// ---------------------------------------------------------------------------

/*
 * Stored as one short string per date, a letter per tier in DIFFICULTIES
 * order — `d` solved on the day, `l` solved on another day, `-` neither:
 *
 *   sudoku.dailyLedger  { "2026-10-06": "dd-l", "2026-10-07": "-d--" }
 *
 * Some 20 bytes a day, so it is never pruned.
 */

const LEDGER_LETTER: Readonly<Record<SolvedStatus, string>> = {
  'solved-on-the-day': 'd',
  'solved-later': 'l',
};
const LEDGER_DAY = /^[dl-]{4}$/;

/** A ledger as stored and exported. */
function encodeLedger(ledger: DailyLedger): Record<string, string> {
  return Object.fromEntries(
    [...ledger].map(([date, solved]) => [
      date,
      DIFFICULTIES.map((tier) => {
        const status = solved[tier];
        return status === undefined ? '-' : LEDGER_LETTER[status];
      }).join(''),
    ]),
  );
}

/**
 * A ledger read back from storage or a file. Anything that is not a date from
 * Daily #1 with four letters costs only its own day.
 */
function decodeLedger(value: unknown): DailyLedger {
  if (!isObject(value)) return EMPTY_LEDGER;
  const ledger = new Map<DateKey, Partial<Record<Difficulty, SolvedStatus>>>();
  for (const [date, letters] of Object.entries(value)) {
    if (!isDateKey(date) || daysBetween(DAILY_EPOCH, date) < 0) continue;
    if (typeof letters !== 'string' || !LEDGER_DAY.test(letters)) continue;
    const solved: Partial<Record<Difficulty, SolvedStatus>> = {};
    DIFFICULTIES.forEach((tier, i) => {
      if (letters[i] === 'd') solved[tier] = 'solved-on-the-day';
      else if (letters[i] === 'l') solved[tier] = 'solved-later';
    });
    if (Object.keys(solved).length > 0) ledger.set(date, solved);
  }
  return ledger;
}

/**
 * What the solved dailies among pruned records said (see `DailyLedger`) —
 * read with the records wherever streaks and the dailies' marks are worked
 * out.
 */
export function loadDailyLedger(storage: StorageLike): DailyLedger {
  return decodeLedger(readJson(storage, LEDGER_KEY));
}

/**
 * Add an imported ledger to the one here, each date and tier keeping the
 * better standing: like the puzzles seen, an import only ever adds. A file
 * from before there was a ledger has none, which is no loss: its records
 * speak for themselves.
 */
function mergeLedger(storage: StorageLike, incoming: unknown): void {
  const ledger = loadDailyLedger(storage);
  const merged = mergeLedgers(ledger, decodeLedger(incoming));
  if (merged !== ledger) writeItem(storage, LEDGER_KEY, JSON.stringify(encodeLedger(merged)));
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** Every valid record, newest first. Invalid records are dropped one by one. */
export function loadHistory(storage: StorageLike): GameRecord[] {
  const parsed = readJson(storage, HISTORY_KEY);
  if (!Array.isArray(parsed)) return [];
  return sortNewestFirst(parseRecords(parsed));
}

/**
 * Insert a record, or replace the one with its id. Returns the new list.
 *
 * Enforces both caps on the way: beyond MAX_RECORDS the oldest finished
 * games are dropped first (then the oldest unfinished), and unfinished games
 * beyond the MAX_SAVED_GAMES most recently played lose their saved state —
 * their record stays, resumable only as a replay. The record being written
 * and the current game are never pruned.
 *
 * The record is stored as a copy, so later changes to the caller's object do
 * not leak into the list returned. One that would not survive a reload (a
 * malformed id, givens or time) is not written at all.
 */
export function upsertRecord(storage: StorageLike, record: GameRecord): GameRecord[] {
  const records = loadHistory(storage);
  const incoming = normaliseRecord(record);
  if (incoming === null) return records;
  const index = records.findIndex((existing) => existing.id === incoming.id);
  if (index === -1) records.unshift(incoming);
  else records[index] = incoming;
  sortNewestFirst(records);

  const keep = protectedIds(storage, incoming.id);
  const saved = saveRecords(storage, capRecords(storage, records, keep), keep);
  sweepSavedGames(storage, saved, MAX_SAVED_GAMES);
  return saved;
}

/**
 * Delete a record and its saved game; forgets the current game if it was this
 * one. Returns the new list.
 *
 * The puzzle stays seen if its board was ever on show — time on its clock, or
 * solved — whether or not `markSeen` heard of it at the time (a record from
 * before the list of seen puzzles existed, or a write the quota refused):
 * deleting an attempt must never turn a studied puzzle back into a fresh one.
 */
export function deleteRecord(storage: StorageLike, id: string): GameRecord[] {
  const records = loadHistory(storage);
  const doomed = records.find((record) => record.id === id);
  if (doomed !== undefined && (doomed.status === 'solved' || doomed.elapsedMs > 0)) {
    markSeen(storage, doomed.givens);
  }
  deleteGameBlob(storage, id);
  if (loadCurrentId(storage) === id) saveCurrentId(storage, null);
  const kept = records.filter((record) => record.id !== id);
  return kept.length === records.length ? records : saveRecords(storage, kept);
}

/** Every attempt at a puzzle, newest first (given a list in that order). */
export function findAttempts(records: readonly GameRecord[], givens: GridString): GameRecord[] {
  return records.filter((record) => record.givens === givens);
}

/**
 * Every attempt recorded as a daily, newest first (given a list in that
 * order). For deciding how to open a daily, prefer `findAttempts` on its
 * givens: that also finds attempts at the same puzzle made before it was
 * opened as a daily, which make a new attempt a replay all the same.
 */
export function findDailyAttempts(
  records: readonly GameRecord[],
  date: DateKey,
  tier: Difficulty,
): GameRecord[] {
  return records.filter((record) => record.daily === date && record.difficulty === tier);
}

/**
 * Per-tier totals. Every record counts as played, and every solve as solved;
 * best and average cover only the solves that say something about the
 * player. That leaves out games with reveals — a revealed cell is a cell not
 * solved — and replays, puzzles the player had already seen: an attempt at a
 * board studied beforehand would be a record nobody could fairly beat. Other
 * help (hints, checks, auto candidates) still counts: it is shown next to the
 * time instead.
 */
export function computeStats(records: readonly GameRecord[]): Record<Difficulty, DifficultyStats> {
  const stats = {} as Record<Difficulty, DifficultyStats>;
  for (const difficulty of DIFFICULTIES) {
    let played = 0;
    let solved = 0;
    let timed = 0;
    let totalMs = 0;
    let bestMs: number | null = null;
    for (const record of records) {
      if (record.difficulty !== difficulty) continue;
      played++;
      if (record.status !== 'solved') continue;
      solved++;
      if (record.assists.reveals > 0 || record.source === 'replay') continue;
      timed++;
      totalMs += record.elapsedMs;
      if (bestMs === null || record.elapsedMs < bestMs) bestMs = record.elapsedMs;
    }
    stats[difficulty] = {
      played,
      solved,
      bestMs,
      averageMs: timed === 0 ? null : Math.round(totalMs / timed),
    };
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Saved games and the current game
// ---------------------------------------------------------------------------

/**
 * Save a game's state (anything JSON can hold — the game module's serialised
 * form). Best-effort: if the browser refuses it even after `freeSpace`, the
 * game simply is not resumable after a reload. Returns whether it was saved,
 * so the caller can avoid pointing `sudoku.current` at a game that was not.
 */
export function saveGameBlob(storage: StorageLike, id: string, blob: unknown): boolean {
  let json: string | undefined;
  try {
    json = JSON.stringify(blob);
  } catch {
    return false; // a cycle or a BigInt: a programmer error, but not one worth a crash
  }
  if (json === undefined) return false;
  return storeGame(storage, id, json, freeSpace);
}

/** A game's saved state, or null if there is none or it is not valid JSON. Not validated further. */
export function loadGameBlob(storage: StorageLike, id: string): unknown {
  return readJson(storage, gameKey(id));
}

/** Whether a game has saved state — cheaper than loading it, for marking resumable games in a list. */
export function hasGameBlob(storage: StorageLike, id: string): boolean {
  return readItem(storage, gameKey(id)) !== null;
}

/**
 * The ids of every game with saved state — one read per saved game, so cheap
 * enough for marking the resumable games in a list of a thousand.
 */
export function savedGameIds(storage: StorageLike): Set<string> {
  return new Set(readSavedIds(storage).filter((id) => hasGameBlob(storage, id)));
}

/** Delete a game's saved state, if it has any. */
export function deleteGameBlob(storage: StorageLike, id: string): void {
  // An unlisted key should not exist, but if one does, it goes too.
  if (!dropSavedGames(storage, (listed) => listed === id)) deleteItem(storage, gameKey(id));
}

/** The id of the game on screen when the page was last used, or null. */
export function loadCurrentId(storage: StorageLike): string | null {
  const id = readItem(storage, CURRENT_KEY);
  return id !== null && ID_PATTERN.test(id) ? id : null;
}

/** Remember the game on screen, or forget it with null. */
export function saveCurrentId(storage: StorageLike, id: string | null): void {
  if (id === null) deleteItem(storage, CURRENT_KEY);
  else writeItem(storage, CURRENT_KEY, id, freeSpace);
}

// ---------------------------------------------------------------------------
// Puzzles seen
// ---------------------------------------------------------------------------

/*
 * A puzzle the player has seen can never again give a fair time: they may
 * have studied its board. So every attempt at one after the first is a
 * replay (see `computeStats`), and the game has to remember which puzzles
 * those are for longer than it keeps their records — a record can be deleted
 * from History, or pruned, and reopening the puzzle's link afterwards must
 * not hand out a fresh attempt that sets a best from memory.
 *
 * Kept as share codes (`encodeGivens`): a third the size of the givens, and
 * just as exact, since the code is a bijection.
 */

/**
 * The share codes of the puzzles seen, least recently seen first. Anything in
 * the list that is not shaped like a code costs only itself; a code is never
 * decoded here, as that would cost a big-number parse per puzzle on every
 * check, and a malformed one simply matches nothing.
 */
function readSeen(storage: StorageLike): string[] {
  const parsed = readJson(storage, SEEN_KEY);
  if (!Array.isArray(parsed)) return [];
  const codes = parsed.filter(
    (code): code is string => typeof code === 'string' && looksLikeShareCode(code),
  );
  // One entry per code, at its most recent place.
  return [...new Set(codes.reverse())].reverse();
}

/** Write the list of seen puzzles, held to the MAX_SEEN seen most recently. */
function writeSeen(storage: StorageLike, codes: readonly string[]): void {
  writeItem(storage, SEEN_KEY, JSON.stringify(codes.slice(-MAX_SEEN)), freeSpace);
}

/**
 * Remember that a puzzle's board has been on show, as its most recent sight.
 * Best-effort, like every write: a refused one makes room (see `freeSpace`)
 * and tries once more.
 */
export function markSeen(storage: StorageLike, givens: GridString): void {
  const code = encodeGivens(givens);
  const codes = readSeen(storage);
  if (codes.at(-1) === code) return;
  writeSeen(storage, [...codes.filter((seen) => seen !== code), code]);
}

/**
 * Whether the player has seen a puzzle before: an attempt at it is in the
 * history, or its board was once on show in an attempt since deleted or
 * pruned (see `markSeen`).
 */
export function hasSeen(
  storage: StorageLike,
  records: readonly GameRecord[],
  givens: GridString,
): boolean {
  return (
    findAttempts(records, givens).length > 0 || readSeen(storage).includes(encodeGivens(givens))
  );
}

/**
 * Add the seen puzzles an import brought to the ones here. It only ever adds:
 * an import cannot make a puzzle unseen. The imported ones count as seen
 * longer ago than any here, so when the two together pass MAX_SEEN, it is
 * theirs that are dropped, never one seen on this browser.
 */
function mergeSeen(storage: StorageLike, incoming: unknown): void {
  if (!Array.isArray(incoming)) return;
  const local = readSeen(storage);
  const known = new Set(local);
  const added = incoming.filter(
    (code): code is string =>
      typeof code === 'string' && looksLikeShareCode(code) && !known.has(code),
  );
  if (added.length === 0) return;
  writeSeen(storage, [...new Set(added), ...local]);
}

// ---------------------------------------------------------------------------
// Export and import
// ---------------------------------------------------------------------------

/**
 * The whole history as a JSON file: every record, plus the saved state of
 * every game that has some, so an unfinished game can be resumed on the
 * other side; the puzzles seen, so one played and deleted here is no fresh
 * puzzle there either; and the daily ledger, so streaks travel whole. Safari
 * deletes the storage of a site not visited for seven days, so this file is
 * the only backup there is.
 */
export function exportHistory(storage: StorageLike, now: number): string {
  const records = loadHistory(storage);
  const saved = savedGameIds(storage);
  // fromEntries rather than assignment: an id of `__proto__` must become a
  // key, not a prototype.
  const games = Object.fromEntries(
    records.flatMap((record) => {
      const blob = saved.has(record.id) ? loadGameBlob(storage, record.id) : null;
      return blob === null ? [] : [[record.id, blob] as const];
    }),
  );
  const seen = readSeen(storage);
  const dailyLedger = encodeLedger(loadDailyLedger(storage));
  return JSON.stringify(
    {
      app: EXPORT_APP,
      version: EXPORT_VERSION,
      exportedAt: now,
      records,
      games,
      seen,
      dailyLedger,
    },
    null,
    2,
  );
}

/**
 * Merge an exported history into this one, by id: a record not here yet is
 * added; one already here is replaced only if the imported copy changed
 * later (`updatedAt`), and its saved state goes with it. The game on screen
 * is never replaced — the page holds it in memory and would save over the
 * import moments later. Anything that is not a Sudoku history file is
 * refused whole; within one, bad records are skipped individually.
 *
 * Saved state from the file is taken only for games that will keep it (the
 * MAX_SAVED_GAMES most recently played unfinished ones), newest first, and
 * only into space that is free: an import never evicts a game saved here to
 * make room for one of its own. The file's seen puzzles are added to the ones
 * here (see `mergeSeen`); a file from before they were exported has none,
 * which is no loss, as its records count as seen in their own right. So is
 * its daily ledger (see `mergeLedger`).
 */
export function importHistory(storage: StorageLike, json: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false };
  }
  if (
    !isObject(data) ||
    data.app !== EXPORT_APP ||
    data.version !== EXPORT_VERSION ||
    !Array.isArray(data.records)
  ) {
    return { ok: false };
  }
  const games = isObject(data.games) ? data.games : {};
  mergeSeen(storage, data.seen);
  mergeLedger(storage, data.dailyLedger);

  const current = loadCurrentId(storage);
  const records = loadHistory(storage);
  const byId = new Map(records.map((record) => [record.id, record]));
  const added = new Set<string>();
  const updated = new Set<string>();
  for (const incoming of parseRecords(data.records)) {
    const existing = byId.get(incoming.id);
    if (existing === undefined) added.add(incoming.id);
    else if (incoming.id !== current && incoming.updatedAt > existing.updatedAt) {
      updated.add(incoming.id);
    } else continue;
    byId.set(incoming.id, incoming);
  }
  if (added.size + updated.size === 0) return { ok: true, added: 0, updated: 0 };

  const keep = protectedIds(storage);
  const merged = sortNewestFirst([...byId.values()]);
  const saved = saveRecords(storage, capRecords(storage, merged, keep), keep);
  const isImported = (id: string): boolean => added.has(id) || updated.has(id);
  const imported = saved.filter((record) => isImported(record.id));

  // Anything already saved under an imported id belonged to the copy that
  // lost; resuming it would contradict the record that won.
  dropSavedGames(storage, isImported);
  const slots = savedGameSlots(saved, MAX_SAVED_GAMES, keep);
  const incomingGames = imported
    .filter((record) => slots.has(record.id) && Object.hasOwn(games, record.id))
    .filter((record) => games[record.id] !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const record of incomingGames) {
    storeGame(storage, record.id, JSON.stringify(games[record.id]));
  }
  sweepSavedGames(storage, saved, MAX_SAVED_GAMES);

  const addedCount = imported.filter((record) => added.has(record.id)).length;
  return { ok: true, added: addedCount, updated: imported.length - addedCount };
}
