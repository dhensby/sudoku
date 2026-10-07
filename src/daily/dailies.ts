import {
  DAILY_EPOCH,
  GENERATOR_VERSION,
  checkGivens,
  dailyNumber,
  dateKeyOf,
  daysBetween,
  decodeGivens,
  isDateKey,
  isGridString,
  latestDateAnywhere,
  type DateKey,
  type Difficulty,
  type GridString,
  type Puzzle,
} from '../core';
import { cacheDaily, readCachedDaily } from '../storage/dailyCache';
import { browserStorage, type StorageLike } from '../storage/storage';
// The one puzzle source the app has, worker and main-thread fallback alike:
// a daily is dealt exactly as a random puzzle is, only from its date's seed.
import { createPuzzleSource, type SeededPuzzleSource } from '../ui/puzzleSource';
import { frozenCodes, parseArchive, type Archive } from './archive';
import { DAILY_TIERS, generateDailyAsync, type GenerateAsyncFn } from './generate';

/*
 * The daily puzzles at runtime: each date's four, from the archive for a day
 * an engine since replaced dealt, and otherwise dealt live from the date's
 * seeds by the engine in the bundle (see `archive.ts` and `generate.ts`).
 *
 * Dealing is the slow part — a few tens of milliseconds for a day's four on
 * a laptop, rarely a tenth of a second (an Expert has the long tail), and a
 * few hundred milliseconds on a slow phone — so a daily, once dealt, is
 * kept: in memory for the visit, and in localStorage between visits
 * (`dailyCache.ts`), so today's puzzles and any calendar day opened again
 * are to hand at once. Today's four are worth starting as soon as the page
 * has loaded (`prefetchToday`), so they are usually ready before anyone asks.
 *
 * The archive comes in a chunk of its own, named by a hash of its content, so
 * it changes name only when it changes — at an engine change. A tab opened
 * before that deploy asks for the old name afterwards and finds nothing; so
 * the first prefetch reads the archive too, whatever the cache already holds,
 * and a tab has it before a deploy can take it away. One that still finds it
 * gone is out of date, and says so (`ArchiveUnavailableError`).
 *
 * Dealing has a queue of its own, one daily at a time and on a worker of its
 * own: a daily someone is waiting for goes ahead of those being made ahead
 * of time (an Expert asked for from the menu does not wait behind today's
 * Medium and Hard), and neither waits behind the next random puzzle.
 *
 * Which dates have a daily: every date from Daily #1 (`DAILY_EPOCH`) up to
 * the latest one that has begun anywhere on Earth. The calendar offers only
 * the player's own dates up to today, but a friend a time zone ahead can
 * send a link to a daily that is still "tomorrow" here, and it must check
 * out. A date beyond that has not begun for anyone, so nothing is dealt for
 * it — not that it would stop a determined player, who has the generator.
 */

/**
 * The archive's chunk could not be loaded — nearly always because the site
 * has been deployed again since the page was opened, and the chunk this page
 * knows by name has gone: reloading fixes it, trying again does not.
 */
export class ArchiveUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The daily archive could not be loaded; the page may be out of date', { cause });
    this.name = 'ArchiveUnavailableError';
  }
}

/** A date's four dailies. */
export interface DailySet {
  date: DateKey;
  /** Its daily number: 1 for `DAILY_EPOCH`. */
  number: number;
  puzzles: Record<Difficulty, Puzzle>;
}

/** The daily puzzles (see the module comment). */
export interface DailyStore {
  /** Whether a date has a daily: a real date from the epoch to the latest begun anywhere. */
  hasDaily(date: string): date is DateKey;
  /**
   * A date's daily of a tier, labelled with that tier, or null for a date
   * with no daily (`hasDaily`). Rejects if the archive could not be read
   * (with an `ArchiveUnavailableError` if its chunk could not be loaded at
   * all) or the daily could not be dealt; a later call tries again.
   */
  dailyPuzzle(date: string, tier: Difficulty): Promise<Puzzle | null>;
  /**
   * The daily if it is already to hand — dealt this visit, or kept from an
   * earlier one — without waiting; else null. For rendering without a
   * spinner what `dailyPuzzle` would hand over in a moment.
   */
  peekDaily(date: string, tier: Difficulty): Puzzle | null;
  /** All four of a date's dailies, or null for a date with none. Rejects as `dailyPuzzle` does. */
  dailiesFor(date: string): Promise<DailySet | null>;
  /**
   * Which of a date's dailies has these givens, or null if none has (or the
   * date has no daily) — how a shared link's date hint is checked before
   * its game is recorded as that daily. The tier the puzzle grades as is
   * worth passing as `firstTry`: a live daily always grades as its own tier,
   * so the check then usually deals one daily rather than up to four.
   * Rejects as `dailyPuzzle` does.
   */
  findDaily(date: string, givens: GridString, firstTry?: Difficulty): Promise<Difficulty | null>;
  /**
   * Start dealing a date's four in the background, easiest first, behind
   * anything asked for — and read the archive, if it has not been read yet
   * (see the module comment).
   */
  prefetch(date: string): void;
}

/** What a store is built from. Each has a default for the app; tests bring their own. */
export interface DailyStoreOptions {
  /** Read the archive's JSON. Defaults to the committed `archive.json`, a chunk of its own. */
  loadArchive?: () => Promise<unknown>;
  /** Deal a tier from a seed. Defaults to a puzzle source of the store's own, started on first use. */
  generate?: GenerateAsyncFn;
  /** Where dealt dailies are kept between visits. Defaults to localStorage, opened on first use. */
  storage?: StorageLike;
  /** The wall clock, in epoch ms, for which dates have begun. Defaults to `Date.now`. */
  now?: () => number;
}

/** A daily waiting its turn to be dealt. */
interface Job {
  key: string;
  date: DateKey;
  tier: Difficulty;
  resolve: (puzzle: Puzzle) => void;
  reject: (error: unknown) => void;
}

/** The archive as the bundle has it: the committed file, in a chunk of its own. */
const loadCommittedArchive = (): Promise<unknown> =>
  import('./archive.json').then((module) => module.default);

/** A puzzle of `tier` from its givens, solved afresh; null if they no longer make one. */
function solvedPuzzle(givens: GridString | null, tier: Difficulty): Puzzle | null {
  const checked = givens === null ? null : checkGivens(givens);
  return checked?.ok === true
    ? { givens: givens!, solution: checked.solution, difficulty: tier }
    : null;
}

/** A store of the daily puzzles. The app uses `dailies`; tests build their own. */
export function createDailyStore(options: DailyStoreOptions = {}): DailyStore {
  const { loadArchive = loadCommittedArchive, now = Date.now } = options;

  let source: SeededPuzzleSource | null = null;
  const generate: GenerateAsyncFn =
    options.generate ??
    ((tier, seed) => {
      source ??= createPuzzleSource();
      return source.generate(tier, seed);
    });

  let openedStorage: StorageLike | null = null;
  const storage = (): StorageLike => (openedStorage ??= options.storage ?? browserStorage());

  /** The archive once read, and the read itself while it is under way. */
  let archive: Archive | null = null;
  let archiveLoad: Promise<Archive> | null = null;
  const readArchive = (): Promise<Archive> => {
    archiveLoad ??= loadArchive()
      .then(parseArchive, (error: unknown) => {
        throw new ArchiveUnavailableError(error);
      })
      .then(
        (parsed) => (archive = parsed),
        (error: unknown) => {
          archiveLoad = null; // so a later call can try again
          throw error;
        },
      );
    return archiveLoad;
  };

  /** Dailies already dealt this visit, and those on their way, by `date/tier`. */
  const ready = new Map<string, Puzzle>();
  const pending = new Map<string, Promise<Puzzle>>();

  /** The dealing queue: dailies someone is waiting for, then those made ahead of time. */
  const wanted: Job[] = [];
  const ahead: Job[] = [];
  /** Dailies someone is waiting for, whether or not they have reached the queue yet. */
  const wantedKeys = new Set<string>();
  let isDealing = false;

  const dealNext = (): void => {
    if (isDealing) return;
    const job = wanted.shift() ?? ahead.shift();
    if (job === undefined) return;
    isDealing = true;
    generateDailyAsync(job.date, job.tier, generate)
      .then(job.resolve, job.reject)
      .finally(() => {
        isDealing = false;
        dealNext();
      });
  };

  /** Queue a daily to be dealt live, ahead of the background work if someone is waiting for it. */
  const enqueue = (key: string, date: DateKey, tier: Difficulty): Promise<Puzzle> =>
    new Promise<Puzzle>((resolve, reject) => {
      (wantedKeys.has(key) ? wanted : ahead).push({ key, date, tier, resolve, reject });
      dealNext();
    });

  /** Move a daily someone is now waiting for to the front lane, wherever it has got to. */
  const want = (key: string): void => {
    wantedKeys.add(key);
    const index = ahead.findIndex((job) => job.key === key);
    if (index !== -1) wanted.push(...ahead.splice(index, 1));
  };

  /** A daily kept from an earlier visit by this engine, or frozen in an archive already read. */
  const kept = (date: DateKey, tier: Difficulty): Puzzle | null => {
    const frozen = archive === null ? null : frozenCodes(archive, date);
    // A kept daily was dealt live by this very engine, so it can never be for
    // a frozen date (the guard test keeps every frozen day an older engine's).
    const givens =
      frozen === null
        ? readCachedDaily(storage(), GENERATOR_VERSION, date, tier)
        : decodeGivens(frozen[tier]);
    return solvedPuzzle(givens, tier);
  };

  /** Find or deal a daily, for a date known to have one. */
  const deal = async (key: string, date: DateKey, tier: Difficulty): Promise<Puzzle> => {
    const found = kept(date, tier);
    if (found !== null) return found;
    const frozen = frozenCodes(await readArchive(), date);
    if (frozen !== null) {
      const puzzle = solvedPuzzle(decodeGivens(frozen[tier]), tier);
      // The guard test checks every frozen code; this only stops a crash.
      if (puzzle === null) throw new Error(`The archived ${tier} daily for ${date} is broken`);
      return puzzle;
    }
    const puzzle = { ...(await enqueue(key, date, tier)), difficulty: tier };
    cacheDaily(storage(), GENERATOR_VERSION, date, tier, puzzle.givens);
    return puzzle;
  };

  /** A daily, for a date known to have one: to hand, on its way, or dealt now. */
  const load = (date: DateKey, tier: Difficulty, isWanted: boolean): Promise<Puzzle> => {
    const key = `${date}/${tier}`;
    const known = ready.get(key);
    if (known !== undefined) return Promise.resolve(known);
    if (isWanted) want(key);
    const inFlight = pending.get(key);
    if (inFlight !== undefined) return inFlight;
    const dealt = deal(key, date, tier);
    pending.set(key, dealt);
    const settle = () => {
      pending.delete(key);
      wantedKeys.delete(key);
    };
    dealt.then((puzzle) => {
      ready.set(key, puzzle);
      settle();
    }, settle);
    return dealt;
  };

  const hasDaily = (date: string): date is DateKey =>
    isDateKey(date) &&
    daysBetween(DAILY_EPOCH, date) >= 0 &&
    daysBetween(date, latestDateAnywhere(now())) >= 0;

  return {
    hasDaily,

    async dailyPuzzle(date, tier) {
      return hasDaily(date) ? load(date, tier, true) : null;
    },

    peekDaily(date, tier) {
      if (!hasDaily(date)) return null;
      const key = `${date}/${tier}`;
      const known = ready.get(key) ?? kept(date, tier);
      if (known !== null) ready.set(key, known);
      return known;
    },

    async dailiesFor(date) {
      if (!hasDaily(date)) return null;
      const found = await Promise.all(DAILY_TIERS.map((tier) => load(date, tier, true)));
      const puzzles = Object.fromEntries(DAILY_TIERS.map((tier, i) => [tier, found[i]]));
      return { date, number: dailyNumber(date), puzzles: puzzles as DailySet['puzzles'] };
    },

    async findDaily(date, givens, firstTry) {
      if (!hasDaily(date) || !isGridString(givens)) return null;
      const order = firstTry === undefined ? DAILY_TIERS : [firstTry, ...DAILY_TIERS];
      for (const tier of new Set(order)) {
        if ((await load(date, tier, true)).givens === givens) return tier;
      }
      return null;
    },

    prefetch(date) {
      if (!hasDaily(date)) return;
      // Forgotten if it fails, like the dailies below: the next ask tries again.
      readArchive().catch(() => {});
      for (const tier of DAILY_TIERS) {
        // Nobody is waiting on these yet: a failure is forgotten, and the
        // next ask tries again.
        load(date, tier, false).catch(() => {});
      }
    },
  };
}

/** The app's daily puzzles. Nothing is read, started or dealt until first asked. */
export const dailies: DailyStore = createDailyStore();

/**
 * Start dealing today's four — the player's own date, by their own clock —
 * so they are ready by the time anyone opens the New game menu. Call once the
 * page has loaded, and again when it comes back into view on a new day.
 */
export function prefetchToday(store: DailyStore = dailies, now: number = Date.now()): void {
  store.prefetch(dateKeyOf(now));
}
