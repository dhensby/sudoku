import {
  GENERATOR_VERSION,
  createRng,
  encodeGivens,
  formatGrid,
  generatePuzzle,
  parseGrid,
  type Difficulty,
  type GridString,
  type Puzzle,
} from '../core';
import { cacheDaily } from '../storage/dailyCache';
import { memoryStorage, type StorageLike } from '../storage/storage';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import {
  firstUnfrozenDate,
  freezeDays,
  parseArchive,
  serialiseArchive,
  switchEngine,
  type Archive,
} from './archive';
import committedArchive from './archive.json';
import {
  ArchiveUnavailableError,
  createDailyStore,
  dailies,
  prefetchToday,
  type DailyStoreOptions,
} from './dailies';
import { DAILY_TIERS } from './generate';

const PUZZLE = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
const SOLUTION = formatGrid(parseGrid(WIKIPEDIA_SOLUTION));

/** Noon UTC on 6 October 2026: the 6th by any clock from UTC−12 to UTC+11, and the 7th in UTC+14. */
const NOW = Date.UTC(2026, 9, 6, 12);

/** The Wikipedia puzzle with its digits relabelled `shift` places on: as valid, and told apart by its givens. */
function variant(grid: string, shift: number): GridString {
  return grid.replace(/[1-9]/g, (d) => String(((Number(d) - 1 + shift) % 9) + 1));
}

/**
 * The stand-in for the engine: a variant of the Wikipedia puzzle for each
 * daily seed, the four tiers of a date each a different one.
 */
function puzzleFor(tier: Difficulty, seed: string): Puzzle {
  const [, date, , attempt = '1'] = seed.split('/');
  const shift = (Number(date.slice(8)) * 4 + DAILY_TIERS.indexOf(tier) + Number(attempt) - 1) % 9;
  return { givens: variant(PUZZLE, shift), solution: variant(SOLUTION, shift), difficulty: tier };
}

/**
 * A stand-in for the worker: every seed it is handed waits until the test
 * deals it with `finish` (oldest first) or `fail`, so the order of the queue
 * can be watched. With `auto`, it deals at once.
 */
function fakeDealer(auto = false) {
  const asked: { tier: Difficulty; seed: string; done: (error?: Error) => void }[] = [];
  const seeds: string[] = [];
  const generate = (tier: Difficulty, seed: string): Promise<Puzzle> => {
    seeds.push(seed);
    if (auto) return Promise.resolve(puzzleFor(tier, seed));
    return new Promise<Puzzle>((resolve, reject) => {
      asked.push({
        tier,
        seed,
        done: (error) => (error === undefined ? resolve(puzzleFor(tier, seed)) : reject(error)),
      });
    });
  };
  return {
    generate,
    /** Every seed handed over so far, in order. */
    seeds,
    /** The seeds being dealt or waiting, oldest first. */
    waiting: () => asked.map(({ seed }) => seed),
    async finish(): Promise<void> {
      asked.shift()!.done();
      await settle();
    },
    async fail(): Promise<void> {
      asked.shift()!.done(new Error('worker gone'));
      await settle();
    },
  };
}

/** Let every already-settled promise run its callbacks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** The archive as dailies began: nothing frozen. */
const FRESH: Archive = {
  epoch: '2026-10-01',
  segments: [{ version: GENERATOR_VERSION, from: '2026-10-01' }],
  frozenThrough: null,
  days: [],
};

/** An archive with 1–3 October frozen by the engine before this one, which deals from the 4th. */
const FROZEN = switchEngine(
  freezeDays(
    { ...FRESH, segments: [{ version: GENERATOR_VERSION - 1, from: '2026-10-01' }] },
    ['2026-10-01', '2026-10-02', '2026-10-03'].map((date, d) => ({
      date,
      codes: DAILY_TIERS.map((_, t) => encodeGivens(variant(PUZZLE, (d * 4 + t) % 9))),
    })),
    GENERATOR_VERSION - 1,
  ),
  GENERATOR_VERSION,
  Date.UTC(2026, 9, 2),
);

function setup(options: Partial<DailyStoreOptions> & { archive?: Archive } = {}) {
  const dealer = fakeDealer();
  const storage: StorageLike = options.storage ?? memoryStorage();
  const archive = options.archive ?? FRESH;
  const loadArchive = vi.fn(async () => JSON.parse(serialiseArchive(archive)) as unknown);
  const store = createDailyStore({
    generate: dealer.generate,
    storage,
    loadArchive,
    now: () => NOW,
    ...options,
  });
  return { store, dealer, storage, loadArchive };
}

describe('hasDaily', () => {
  it('holds from Daily #1 to the latest date begun anywhere', () => {
    const { store } = setup();
    expect(store.hasDaily('2026-10-01')).toBe(true);
    expect(store.hasDaily('2026-10-06')).toBe(true);
    // Already the 7th in UTC+14, so a friend there has a daily for it.
    expect(store.hasDaily('2026-10-07')).toBe(true);
    expect(store.hasDaily('2026-10-08')).toBe(false);
    expect(store.hasDaily('2026-09-30')).toBe(false);
    expect(store.hasDaily('2026-02-30')).toBe(false);
    expect(store.hasDaily('today')).toBe(false);
  });

  it('moves on as the clock does', () => {
    let now = NOW;
    const { store } = setup({ now: () => now });
    expect(store.hasDaily('2026-10-08')).toBe(false);
    now += 24 * 3_600_000;
    expect(store.hasDaily('2026-10-08')).toBe(true);
  });
});

describe('dailyPuzzle', () => {
  it('deals a live daily from its date’s seed, labelled with its tier and solved', async () => {
    const { store, dealer } = setup();
    const puzzle = store.dailyPuzzle('2026-10-06', 'hard');
    expect(dealer.waiting()).toEqual([]);
    await settle();
    expect(dealer.waiting()).toEqual(['daily/2026-10-06/hard']);
    await dealer.finish();
    await expect(puzzle).resolves.toEqual(puzzleFor('hard', 'daily/2026-10-06/hard'));
  });

  it('deals each daily once a visit, however often it is asked for', async () => {
    const { store, dealer } = setup();
    const first = store.dailyPuzzle('2026-10-06', 'easy');
    const second = store.dailyPuzzle('2026-10-06', 'easy');
    await settle();
    await dealer.finish();
    expect(await first).toBe(await second);
    await store.dailyPuzzle('2026-10-06', 'easy');
    expect(dealer.seeds).toEqual(['daily/2026-10-06/easy']);
  });

  it('keeps a daily between visits, so the next one need not deal it', async () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    const dealt = first.store.dailyPuzzle('2026-10-06', 'expert');
    await settle();
    await first.dealer.finish();
    const second = setup({ storage });
    await expect(second.store.dailyPuzzle('2026-10-06', 'expert')).resolves.toEqual(await dealt);
    expect(second.dealer.seeds).toEqual([]);
  });

  it('deals afresh what another engine kept', async () => {
    const storage = memoryStorage();
    cacheDaily(storage, GENERATOR_VERSION - 1, '2026-10-06', 'easy', variant(PUZZLE, 8));
    const { store, dealer } = setup({ storage });
    const puzzle = store.dailyPuzzle('2026-10-06', 'easy');
    await settle();
    await dealer.finish();
    expect((await puzzle)?.givens).toBe(puzzleFor('easy', 'daily/2026-10-06/easy').givens);
  });

  it('takes a frozen day from the archive and never deals it', async () => {
    const { store, dealer } = setup({ archive: FROZEN });
    await expect(store.dailyPuzzle('2026-10-02', 'medium')).resolves.toEqual({
      givens: variant(PUZZLE, 5),
      solution: variant(SOLUTION, 5),
      difficulty: 'medium',
    });
    expect(dealer.seeds).toEqual([]);
  });

  it('deals the days after the archive’s last frozen one live', async () => {
    const { store, dealer } = setup({ archive: FROZEN });
    void store.dailyPuzzle('2026-10-04', 'easy');
    await settle();
    expect(dealer.waiting()).toEqual(['daily/2026-10-04/easy']);
  });

  it('is null for a date without a daily, reading and dealing nothing', async () => {
    const { store, dealer, loadArchive } = setup();
    for (const date of ['2026-09-30', '2026-10-08', 'soon']) {
      await expect(store.dailyPuzzle(date, 'easy')).resolves.toBeNull();
    }
    expect(loadArchive).not.toHaveBeenCalled();
    expect(dealer.seeds).toEqual([]);
  });

  it('rejects when the archive cannot be read, saying the page may be out of date, and tries again next time', async () => {
    const { store, loadArchive } = setup({ archive: FROZEN });
    const offline = new Error('offline');
    loadArchive.mockRejectedValueOnce(offline);
    const failure = await store.dailyPuzzle('2026-10-01', 'easy').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ArchiveUnavailableError);
    expect((failure as Error).cause).toBe(offline);
    await expect(store.dailyPuzzle('2026-10-01', 'easy')).resolves.toMatchObject({
      difficulty: 'easy',
    });
    expect(loadArchive).toHaveBeenCalledTimes(2);
  });

  it('rejects rather than guess when the archive is not well formed', async () => {
    const { store } = setup({ loadArchive: async () => ({ epoch: 'whenever' }) });
    await expect(store.dailyPuzzle('2026-10-06', 'easy')).rejects.toThrow('"epoch"');
  });

  it('rejects a frozen code that no longer makes a puzzle', async () => {
    const broken = structuredClone(FROZEN);
    broken.days[0].codes[1] = encodeGivens(
      variant(PUZZLE, 0).replace(/[1-9]/g, (d, i) => (i < 20 ? d : '0')),
    );
    const { store } = setup({ archive: broken });
    await expect(store.dailyPuzzle('2026-10-01', 'medium')).rejects.toThrow(
      'The archived medium daily for 2026-10-01 is broken',
    );
  });

  it('rejects when dealing fails, and deals again next time', async () => {
    const { store, dealer } = setup();
    const failed = store.dailyPuzzle('2026-10-06', 'hard');
    await settle();
    await dealer.fail();
    await expect(failed).rejects.toThrow('worker gone');
    const retried = store.dailyPuzzle('2026-10-06', 'hard');
    await settle();
    await dealer.finish();
    await expect(retried).resolves.toMatchObject({ difficulty: 'hard' });
    expect(dealer.seeds).toEqual(['daily/2026-10-06/hard', 'daily/2026-10-06/hard']);
  });

  it('labels a daily with its tier, and tries the next seed if the engine fell back to another', async () => {
    const generate = vi.fn(async (tier: Difficulty, seed: string) => ({
      ...puzzleFor(tier, seed),
      difficulty: seed.endsWith('/2') ? tier : ('hard' as const),
    }));
    const { store } = setup({ generate });
    await expect(store.dailyPuzzle('2026-10-06', 'expert')).resolves.toMatchObject({
      difficulty: 'expert',
    });
    expect(generate.mock.calls.map(([, seed]) => seed)).toEqual([
      'daily/2026-10-06/expert',
      'daily/2026-10-06/expert/2',
    ]);
  });
});

describe('the dealing queue', () => {
  it('deals one daily at a time, a date’s four easiest first', async () => {
    const { store, dealer } = setup();
    store.prefetch('2026-10-06');
    await settle();
    expect(dealer.waiting()).toEqual(['daily/2026-10-06/easy']);
    await dealer.finish();
    expect(dealer.waiting()).toEqual(['daily/2026-10-06/medium']);
    await dealer.finish();
    await dealer.finish();
    await dealer.finish();
    expect(dealer.seeds).toEqual(DAILY_TIERS.map((tier) => `daily/2026-10-06/${tier}`));
  });

  it('puts a daily someone is waiting for ahead of those being made ahead of time', async () => {
    const { store, dealer } = setup();
    store.prefetch('2026-10-06');
    await settle();
    const expert = store.dailyPuzzle('2026-10-06', 'expert');
    const yesterday = store.dailyPuzzle('2026-10-05', 'hard');
    await settle();
    await dealer.finish(); // today's Easy, already under way
    await dealer.finish();
    await dealer.finish();
    expect(dealer.seeds).toEqual([
      'daily/2026-10-06/easy',
      'daily/2026-10-06/expert',
      'daily/2026-10-05/hard',
      'daily/2026-10-06/medium',
    ]);
    await expect(expert).resolves.toMatchObject({ difficulty: 'expert' });
    await expect(yesterday).resolves.toMatchObject({ difficulty: 'hard' });
  });

  it('remembers a daily is wanted even before it has reached the queue', async () => {
    let openArchive = () => {};
    const archiveRead = new Promise<void>((resolve) => (openArchive = resolve));
    const { store, dealer } = setup({
      loadArchive: async () => {
        await archiveRead;
        return JSON.parse(serialiseArchive(FRESH));
      },
    });
    store.prefetch('2026-10-06');
    // Asked for while all four are still waiting on the archive.
    const hard = store.dailyPuzzle('2026-10-06', 'hard');
    openArchive();
    await settle();
    expect(dealer.waiting()).toEqual(['daily/2026-10-06/easy']);
    await dealer.finish();
    expect(dealer.waiting()).toEqual(['daily/2026-10-06/hard']);
    await dealer.finish();
    await expect(hard).resolves.toMatchObject({ difficulty: 'hard' });
  });

  it('carries on with the rest after a daily fails to deal', async () => {
    const { store, dealer } = setup();
    store.prefetch('2026-10-06');
    await settle();
    await dealer.fail();
    expect(dealer.waiting()).toEqual(['daily/2026-10-06/medium']);
  });
});

describe('peekDaily', () => {
  it('hands over a daily dealt this visit or kept from the last, and nothing else', async () => {
    const storage = memoryStorage();
    const { store, dealer } = setup({ storage });
    expect(store.peekDaily('2026-10-06', 'easy')).toBeNull();
    void store.dailyPuzzle('2026-10-06', 'easy');
    await settle();
    expect(store.peekDaily('2026-10-06', 'easy')).toBeNull();
    await dealer.finish();
    const dealt = store.peekDaily('2026-10-06', 'easy');
    expect(dealt).toEqual(puzzleFor('easy', 'daily/2026-10-06/easy'));
    expect(setup({ storage }).store.peekDaily('2026-10-06', 'easy')).toEqual(dealt);
  });

  it('hands over a frozen day once the archive has been read', async () => {
    const { store } = setup({ archive: FROZEN });
    expect(store.peekDaily('2026-10-03', 'expert')).toBeNull();
    await store.dailyPuzzle('2026-10-03', 'easy');
    expect(store.peekDaily('2026-10-03', 'expert')).toMatchObject({
      givens: variant(PUZZLE, 2),
      difficulty: 'expert',
    });
  });

  it('is null for a date without a daily', () => {
    expect(setup().store.peekDaily('2026-09-30', 'easy')).toBeNull();
  });
});

describe('dailiesFor', () => {
  it('hands over a date’s four, with its daily number', async () => {
    const { store } = setup({ archive: FROZEN });
    const set = await store.dailiesFor('2026-10-02');
    expect(set?.date).toBe('2026-10-02');
    expect(set?.number).toBe(2);
    expect(Object.keys(set!.puzzles)).toEqual(DAILY_TIERS);
    expect(set?.puzzles.hard).toMatchObject({ givens: variant(PUZZLE, 6), difficulty: 'hard' });
  });

  it('is null for a date without a daily', async () => {
    await expect(setup().store.dailiesFor('2026-09-30')).resolves.toBeNull();
  });
});

describe('findDaily', () => {
  it('names the tier of the daily with these givens, dealing the tier tried first first', async () => {
    const generate = vi.fn(async (tier: Difficulty, seed: string) => puzzleFor(tier, seed));
    const { store } = setup({ generate });
    const hard = await store.dailyPuzzle('2026-10-06', 'hard');
    generate.mockClear();
    const medium = puzzleFor('medium', 'daily/2026-10-06/medium');
    await expect(store.findDaily('2026-10-06', medium.givens, 'medium')).resolves.toBe('medium');
    expect(generate.mock.calls.map(([tier]) => tier)).toEqual(['medium']);
    // Without a hint, in tier order, from what is to hand where it can.
    await expect(store.findDaily('2026-10-06', hard!.givens)).resolves.toBe('hard');
    expect(generate.mock.calls.map(([tier]) => tier)).toEqual(['medium', 'easy']);
  });

  it('is null for givens that are none of the date’s dailies', async () => {
    const generate = vi.fn(async (tier: Difficulty, seed: string) => puzzleFor(tier, seed));
    const { store } = setup({ generate });
    const stranger = generatePuzzle('easy', createRng('not a daily')).givens;
    await expect(store.findDaily('2026-10-06', stranger, 'hard')).resolves.toBeNull();
    expect(generate).toHaveBeenCalledTimes(4);
  });

  it('checks a frozen day against the archive', async () => {
    const { store, dealer } = setup({ archive: FROZEN });
    await expect(store.findDaily('2026-10-01', variant(PUZZLE, 3))).resolves.toBe('expert');
    expect(dealer.seeds).toEqual([]);
  });

  it('is null for a date without a daily, or givens that are not a grid', async () => {
    const { store, dealer } = setup();
    await expect(store.findDaily('2026-10-08', PUZZLE)).resolves.toBeNull();
    await expect(store.findDaily('yesterday', PUZZLE)).resolves.toBeNull();
    await expect(store.findDaily('2026-10-06', 'not a grid')).resolves.toBeNull();
    expect(dealer.seeds).toEqual([]);
  });
});

describe('prefetch', () => {
  it('reads the archive too, even with every daily of the day already kept', async () => {
    // So a tab has it before a deploy can take its chunk away (see dailies.ts).
    const storage = memoryStorage();
    for (const tier of DAILY_TIERS) {
      cacheDaily(storage, GENERATOR_VERSION, '2026-10-06', tier, variant(PUZZLE, 1));
    }
    const { store, dealer, loadArchive } = setup({ storage });
    store.prefetch('2026-10-06');
    await settle();
    expect(loadArchive).toHaveBeenCalledTimes(1);
    expect(dealer.seeds).toEqual([]);
    // Read once: later prefetches use what was read.
    store.prefetch('2026-10-05');
    await settle();
    expect(loadArchive).toHaveBeenCalledTimes(1);
  });

  it('forgets an archive it could not read, so the next ask tries again', async () => {
    const { store, loadArchive } = setup({ archive: FROZEN });
    loadArchive.mockRejectedValueOnce(new Error('offline'));
    store.prefetch('2026-10-06');
    await settle();
    await expect(store.dailyPuzzle('2026-10-01', 'easy')).resolves.not.toBeNull();
    expect(loadArchive).toHaveBeenCalledTimes(2);
  });

  it('deals nothing for a date without a daily', async () => {
    const { store, dealer, loadArchive } = setup();
    store.prefetch('2026-10-08');
    await settle();
    expect(dealer.seeds).toEqual([]);
    expect(loadArchive).not.toHaveBeenCalled();
  });

  it('leaves the dailies it dealt ready, and forgets those it could not', async () => {
    const { store, dealer } = setup();
    store.prefetch('2026-10-06');
    await settle();
    await dealer.fail();
    await dealer.finish();
    expect(store.peekDaily('2026-10-06', 'easy')).toBeNull();
    expect(store.peekDaily('2026-10-06', 'medium')).not.toBeNull();
  });

  it('starts today’s four by the player’s own date', async () => {
    const store = { ...setup().store, prefetch: vi.fn() };
    const lateEvening = new Date(2026, 9, 6, 23, 30).getTime();
    prefetchToday(store, lateEvening);
    expect(store.prefetch).toHaveBeenCalledWith('2026-10-06');
  });
});

describe('the app’s store', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('reads the committed archive, deals on the puzzle source and keeps what it dealt', async () => {
    // The first day the committed archive leaves to the engine in the code,
    // whatever has been frozen by the time this runs.
    const date = firstUnfrozenDate(parseArchive(committedArchive));
    const [y, m, d] = date.split('-').map(Number);
    const store = createDailyStore({ now: () => Date.UTC(y, m - 1, d, 12) });
    // jsdom has no Worker, so the source deals on the main thread — the
    // same code, the same puzzle.
    const puzzle = await store.dailyPuzzle(date, 'easy');
    expect(puzzle).toEqual({
      ...generatePuzzle('easy', createRng(`daily/${date}/easy`)),
      difficulty: 'easy',
    });
    expect(localStorage.getItem('sudoku.dailies')).toContain(encodeGivens(puzzle!.givens));
  });

  it('is ready to use, and today is worked out from the real clock', () => {
    expect(dailies.hasDaily('2026-10-01')).toBe(true);
    expect(dailies.hasDaily('2026-09-30')).toBe(false);
    const prefetch = vi.spyOn(dailies, 'prefetch').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 6, 23, 59));
    prefetchToday();
    vi.useRealTimers();
    expect(prefetch).toHaveBeenCalledWith('2026-10-06');
    prefetch.mockRestore();
  });
});
