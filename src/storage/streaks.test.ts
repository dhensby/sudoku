import type { Difficulty } from '../core';
import type { GameRecord } from './history';
import {
  EMPTY_LEDGER,
  addToLedger,
  computeStreak,
  countsTowardsStreak,
  dailyStatus,
  isCounted,
  isStartedEarly,
  isStartedOnTheDay,
  mergeLedgers,
  startedOnOf,
  type DailyLedger,
} from './streaks';

const PUZZLE = '1'.padEnd(81, '0');

/**
 * Pin the time zone for a block's tests. Node picks up a change to
 * `process.env.TZ` at once, and every local time below is read in it.
 */
function inTimeZone(zone: string): void {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}

/** Epoch ms of a local time written `YYYY-MM-DD HH:MM`, in the zone in force when called. */
function at(local: string): number {
  const [date, time] = local.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}

let serial = 0;

/**
 * A daily attempt at `daily`'s `tier` puzzle, begun at the local time
 * `started` and — unless `status` says otherwise — solved ten minutes later.
 */
function attempt(
  daily: string | undefined,
  started: string,
  overrides: Partial<GameRecord> = {},
): GameRecord {
  const createdAt = at(started);
  const status = overrides.status ?? 'solved';
  return {
    id: `game-${serial++}`,
    givens: PUZZLE,
    difficulty: 'hard',
    source: 'daily',
    createdAt,
    updatedAt: createdAt + 600_000,
    completedAt: status === 'solved' ? createdAt + 600_000 : null,
    status,
    elapsedMs: 600_000,
    assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
    challenge: null,
    ...(daily === undefined ? {} : { daily }),
    ...overrides,
  };
}

/** Solved on the day, at noon. */
function onTheDay(date: string, tier: Difficulty = 'hard'): GameRecord {
  return attempt(date, `${date} 12:00`, { difficulty: tier });
}

/** The same, with the date it was started on written down, as the game now records it. */
function stamped(record: GameRecord): GameRecord {
  return { ...record, startedOn: new Date(record.createdAt).toLocaleDateString('sv') };
}

describe('streaks in Europe/London', () => {
  inTimeZone('Europe/London');

  describe('isStartedOnTheDay and countsTowardsStreak', () => {
    it('hold for a daily begun and solved on its own date', () => {
      const record = onTheDay('2026-10-06');
      expect(isStartedOnTheDay(record)).toBe(true);
      expect(countsTowardsStreak(record)).toBe(true);
    });

    it('go by the local date, not the UTC one', () => {
      // 00:30 BST on the 7th is 23:30 UTC on the 6th.
      const record = attempt('2026-10-07', '2026-10-07 00:30');
      expect(isStartedOnTheDay(record)).toBe(true);
      expect(isStartedOnTheDay(attempt('2026-10-06', '2026-10-07 00:30'))).toBe(false);
    });

    it('need the attempt solved to count', () => {
      const record = attempt('2026-10-06', '2026-10-06 12:00', { status: 'playing' });
      expect(isStartedOnTheDay(record)).toBe(true);
      expect(countsTowardsStreak(record)).toBe(false);
    });

    it('never hold for a game that is not a daily', () => {
      const record = attempt(undefined, '2026-10-06 12:00', { source: 'generated' });
      expect(isStartedOnTheDay(record)).toBe(false);
      expect(countsTowardsStreak(record)).toBe(false);
    });
  });

  describe('computeStreak', () => {
    it('is nothing without any dailies', () => {
      expect(computeStreak([], 'hard', '2026-10-06')).toEqual({ current: 0, best: 0 });
    });

    it('counts today once its daily is solved', () => {
      const records = [onTheDay('2026-10-06')];
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 1, best: 1 });
    });

    it('keeps a streak alive through a day whose daily is not solved yet', () => {
      const records = [onTheDay('2026-10-04'), onTheDay('2026-10-05')];
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 2, best: 2 });
    });

    it('ends a streak once a whole day is missed, keeping it as the best', () => {
      const records = [onTheDay('2026-10-03'), onTheDay('2026-10-04')];
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 0, best: 2 });
    });

    it('counts a run of days ending today', () => {
      const records = ['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06'].map((d) =>
        onTheDay(d),
      );
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 2, best: 2 });
      records.push(onTheDay('2026-10-04'));
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 5, best: 5 });
    });

    it('keeps the longest run as the best when the current one is shorter', () => {
      const records = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-06'].map((d) =>
        onTheDay(d),
      );
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 1, best: 3 });
    });

    it('keeps each tier’s streak to itself', () => {
      const records = [onTheDay('2026-10-05', 'easy'), onTheDay('2026-10-06', 'hard')];
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 1, best: 1 });
      expect(computeStreak(records, 'easy', '2026-10-06')).toEqual({ current: 1, best: 1 });
      expect(computeStreak(records, 'medium', '2026-10-06')).toEqual({ current: 0, best: 0 });
    });

    it('does not count a daily begun but not solved', () => {
      const records = [
        onTheDay('2026-10-05'),
        attempt('2026-10-06', '2026-10-06 09:00', { status: 'playing' }),
      ];
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 1, best: 1 });
    });

    it('counts a day solved twice only once', () => {
      const records = [
        onTheDay('2026-10-05'),
        attempt('2026-10-06', '2026-10-06 08:00'),
        attempt('2026-10-06', '2026-10-06 20:00', { source: 'replay' }),
      ];
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 2, best: 2 });
    });

    it('never counts a past day caught up on later, nor lets it fill a gap', () => {
      const records = [
        onTheDay('2026-10-04'),
        // The 5th, played on the 6th.
        attempt('2026-10-05', '2026-10-06 09:00'),
        onTheDay('2026-10-06'),
      ];
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 1, best: 1 });
    });

    it('never counts a solved replay of an earlier day', () => {
      const records = [
        attempt('2026-10-03', '2026-10-06 10:00', { source: 'replay' }),
        attempt('2026-10-05', '2026-10-06 11:00', { source: 'replay' }),
      ];
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 0, best: 0 });
    });

    it('counts a daily begun before midnight and solved after it, for the day it was begun', () => {
      const late = attempt('2026-10-05', '2026-10-05 23:50', {
        completedAt: at('2026-10-06 00:10'),
        updatedAt: at('2026-10-06 00:10'),
      });
      expect(computeStreak([late], 'hard', '2026-10-06')).toEqual({ current: 1, best: 1 });
      expect(computeStreak([late, onTheDay('2026-10-06')], 'hard', '2026-10-06').current).toBe(2);
    });

    it('does not count a daily begun the day before its own date', () => {
      // Opened from a link sent by someone whose day had already begun.
      const early = attempt('2026-10-06', '2026-10-05 23:30');
      expect(computeStreak([early], 'hard', '2026-10-06')).toEqual({ current: 0, best: 0 });
    });

    it('runs across the end of a month and of a year', () => {
      const autumn = ['2026-10-30', '2026-10-31', '2026-11-01'].map((d) => onTheDay(d));
      expect(computeStreak(autumn, 'hard', '2026-11-01')).toEqual({ current: 3, best: 3 });
      const winter = ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'].map((d) =>
        onTheDay(d),
      );
      expect(computeStreak(winter, 'hard', '2027-01-03')).toEqual({ current: 4, best: 4 });
      expect(computeStreak(winter, 'hard', '2027-01-04')).toEqual({ current: 0, best: 4 });
    });

    it('runs through the clocks going back, across the 25-hour day', () => {
      // 25 October 2026: 02:00 BST becomes 01:00 GMT.
      const records = [
        attempt('2026-10-24', '2026-10-24 23:55'),
        attempt('2026-10-25', '2026-10-25 00:05'),
        attempt('2026-10-26', '2026-10-26 00:30'),
      ];
      expect(computeStreak(records, 'hard', '2026-10-26')).toEqual({ current: 3, best: 3 });
      // Late on the 25th: 23:30 GMT, a full 24 hours after 23:30 BST on the 24th.
      const late = attempt('2026-10-25', '2026-10-25 23:30');
      expect(isStartedOnTheDay(late)).toBe(true);
    });

    it('runs through the clocks going forward, across the 23-hour day', () => {
      // 28 March 2027: 01:00 GMT becomes 02:00 BST.
      const records = [
        attempt('2027-03-27', '2027-03-27 23:55'),
        attempt('2027-03-28', '2027-03-28 00:05'),
        attempt('2027-03-28', '2027-03-28 23:55'),
        attempt('2027-03-29', '2027-03-29 00:05'),
      ];
      expect(records.map(isStartedOnTheDay)).toEqual([true, true, true, true]);
      expect(computeStreak(records, 'hard', '2027-03-29')).toEqual({ current: 3, best: 3 });
      expect(computeStreak(records, 'hard', '2027-03-30')).toEqual({ current: 3, best: 3 });
      expect(computeStreak(records, 'hard', '2027-03-31')).toEqual({ current: 0, best: 3 });
    });

    it('takes no notice of days after today, even for the best streak', () => {
      // Only possible once the clock has been put back.
      const records = ['2026-10-06', '2026-10-08', '2026-10-09'].map((d) => onTheDay(d));
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 1, best: 1 });
    });

    it('takes no notice of games that are not dailies', () => {
      const records = [attempt(undefined, '2026-10-06 12:00', { source: 'generated' })];
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 0, best: 0 });
    });
  });

  describe('dailyStatus', () => {
    it('is not started without an attempt', () => {
      expect(dailyStatus([onTheDay('2026-10-05')], '2026-10-06', 'hard')).toBe('not-started');
      expect(dailyStatus([onTheDay('2026-10-06', 'easy')], '2026-10-06', 'hard')).toBe(
        'not-started',
      );
    });

    it('tells apart in progress, solved later and solved on the day', () => {
      const playing = attempt('2026-10-06', '2026-10-06 09:00', { status: 'playing' });
      const later = attempt('2026-10-06', '2026-10-07 09:00');
      expect(dailyStatus([playing], '2026-10-06', 'hard')).toBe('in-progress');
      expect(dailyStatus([later], '2026-10-06', 'hard')).toBe('solved-later');
      expect(dailyStatus([onTheDay('2026-10-06')], '2026-10-06', 'hard')).toBe('solved-on-the-day');
    });

    it('goes by the best of the attempts, in whatever order', () => {
      const playing = attempt('2026-10-06', '2026-10-08 09:00', { status: 'playing' });
      const later = attempt('2026-10-06', '2026-10-07 09:00');
      const onDay = onTheDay('2026-10-06');
      expect(dailyStatus([playing, later], '2026-10-06', 'hard')).toBe('solved-later');
      expect(dailyStatus([later, playing], '2026-10-06', 'hard')).toBe('solved-later');
      expect(dailyStatus([playing, onDay, later], '2026-10-06', 'hard')).toBe('solved-on-the-day');
    });
  });
});

describe('the start date written down', () => {
  describe('written in Europe/London', () => {
    inTimeZone('Europe/London');
    let records: GameRecord[] = [];

    beforeAll(() => {
      // Five Hard dailies, 1 to 5 October, each begun at 22:30 London time on its own day.
      records = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((date) =>
        stamped(attempt(date, `${date} 22:30`)),
      );
    });

    it('is read back as written', () => {
      expect(records.map(startedOnOf)).toEqual(records.map((record) => record.daily));
      expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 5, best: 5 });
    });

    describe('and read in Asia/Tokyo, after a flight east', () => {
      inTimeZone('Asia/Tokyo');

      it('keeps every day counted, though each began the next morning by Tokyo’s clock', () => {
        // 22:30 BST is 06:30 the next day in Tokyo.
        expect(new Date(records[0].createdAt).getDate()).toBe(2);
        expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 5, best: 5 });
        expect(dailyStatus(records, '2026-10-03', 'hard')).toBe('solved-on-the-day');
      });

      it('falls back on the creation time, read here, for a record from before it was written down', () => {
        const unstamped = records.map(({ startedOn: _, ...record }) => record);
        expect(computeStreak(unstamped, 'hard', '2026-10-06')).toEqual({ current: 0, best: 0 });
      });
    });
  });
});

describe('isStartedEarly', () => {
  inTimeZone('Europe/London');

  it('holds for a daily begun before its own date had begun here, and only then', () => {
    // From a friend's link, sent from a zone where the 7th had already begun.
    const early = attempt('2026-10-07', '2026-10-06 23:00');
    expect(isStartedEarly(early)).toBe(true);
    expect(isStartedOnTheDay(early)).toBe(false);
    expect(isStartedEarly(onTheDay('2026-10-07'))).toBe(false);
    expect(isStartedEarly(attempt('2026-10-06', '2026-10-07 09:00'))).toBe(false);
    expect(isStartedEarly(attempt(undefined, '2026-10-06 23:00'))).toBe(false);
  });

  it('goes by the date the attempt was started on, not created on', () => {
    // Opened at 23:00, left behind its Start card, and started the next morning.
    const startedOnTheDay = {
      ...attempt('2026-10-07', '2026-10-06 23:00'),
      startedOn: '2026-10-07',
    };
    expect(isStartedEarly(startedOnTheDay)).toBe(false);
    expect(countsTowardsStreak(startedOnTheDay)).toBe(true);
  });
});

describe('the ledger', () => {
  inTimeZone('Europe/London');

  const LEDGER: DailyLedger = new Map([
    ['2026-10-03', { hard: 'solved-on-the-day' as const }],
    ['2026-10-04', { hard: 'solved-on-the-day' as const, easy: 'solved-later' as const }],
  ]);

  it('carries a streak on where the records leave off', () => {
    const records = [onTheDay('2026-10-05'), onTheDay('2026-10-06')];
    expect(computeStreak(records, 'hard', '2026-10-06')).toEqual({ current: 2, best: 2 });
    expect(computeStreak(records, 'hard', '2026-10-06', LEDGER)).toEqual({ current: 4, best: 4 });
  });

  it('counts nothing after today, nor a day solved on another day', () => {
    const ahead: DailyLedger = new Map([['2026-10-09', { hard: 'solved-on-the-day' as const }]]);
    expect(computeStreak([], 'hard', '2026-10-06', ahead)).toEqual({ current: 0, best: 0 });
    expect(computeStreak([], 'easy', '2026-10-04', LEDGER)).toEqual({ current: 0, best: 0 });
  });

  it('says how a day stands where it has no records, and loses to a better record', () => {
    expect(dailyStatus([], '2026-10-04', 'easy', LEDGER)).toBe('solved-later');
    expect(dailyStatus([onTheDay('2026-10-04', 'easy')], '2026-10-04', 'easy', LEDGER)).toBe(
      'solved-on-the-day',
    );
    const playing = attempt('2026-10-03', '2026-10-03 09:00', { status: 'playing' });
    expect(dailyStatus([playing], '2026-10-03', 'hard', LEDGER)).toBe('solved-on-the-day');
  });

  describe('isCounted', () => {
    it('finds a counted day in the records or the ledger', () => {
      expect(isCounted([onTheDay('2026-10-05')], '2026-10-05', 'hard')).toBe(true);
      expect(isCounted([], '2026-10-03', 'hard', LEDGER)).toBe(true);
      expect(isCounted([], '2026-10-04', 'easy', LEDGER)).toBe(false);
      expect(isCounted([attempt('2026-10-05', '2026-10-06 09:00')], '2026-10-05', 'hard')).toBe(
        false,
      );
    });
  });

  describe('addToLedger', () => {
    it('writes in each solved daily, keeping the better standing', () => {
      const records = [
        attempt('2026-10-04', '2026-10-05 09:00', { difficulty: 'easy' }),
        onTheDay('2026-10-05', 'medium'),
        attempt('2026-10-05', '2026-10-06 09:00', { difficulty: 'medium' }),
        attempt('2026-10-03', '2026-10-04 09:00'),
      ];
      expect(addToLedger(LEDGER, records)).toEqual(
        new Map([
          ['2026-10-03', { hard: 'solved-on-the-day' }],
          ['2026-10-04', { hard: 'solved-on-the-day', easy: 'solved-later' }],
          ['2026-10-05', { medium: 'solved-on-the-day' }],
        ]),
      );
      // The ledger passed in is never changed.
      expect(LEDGER.has('2026-10-05')).toBe(false);
    });

    it('raises a day solved later to solved on the day', () => {
      const raised = addToLedger(LEDGER, [onTheDay('2026-10-04', 'easy')]);
      expect(raised.get('2026-10-04')).toEqual({
        hard: 'solved-on-the-day',
        easy: 'solved-on-the-day',
      });
    });

    it('is the same ledger when nothing in the records adds to it', () => {
      const records = [
        attempt('2026-10-03', '2026-10-03 09:00'),
        attempt('2026-10-06', '2026-10-06 09:00', { status: 'playing' }),
        attempt(undefined, '2026-10-06 09:00', { source: 'generated' }),
        attempt('2026-10-04', '2026-10-05 09:00', { difficulty: 'easy' }),
      ];
      expect(addToLedger(LEDGER, records)).toBe(LEDGER);
      expect(addToLedger(EMPTY_LEDGER, [])).toBe(EMPTY_LEDGER);
    });
  });

  describe('mergeLedgers', () => {
    it('keeps the better standing of each day and tier', () => {
      const other: DailyLedger = new Map([
        ['2026-10-04', { easy: 'solved-on-the-day' as const, hard: 'solved-later' as const }],
        ['2026-10-02', { expert: 'solved-later' as const }],
      ]);
      expect(mergeLedgers(LEDGER, other)).toEqual(
        new Map([
          ['2026-10-03', { hard: 'solved-on-the-day' }],
          ['2026-10-04', { hard: 'solved-on-the-day', easy: 'solved-on-the-day' }],
          ['2026-10-02', { expert: 'solved-later' }],
        ]),
      );
    });

    it('is the first ledger when the second adds nothing', () => {
      expect(mergeLedgers(LEDGER, LEDGER)).toBe(LEDGER);
      expect(mergeLedgers(LEDGER, EMPTY_LEDGER)).toBe(LEDGER);
    });
  });
});

describe('streaks in America/New_York', () => {
  inTimeZone('America/New_York');

  it('runs through the clocks going back', () => {
    // 1 November 2026: 02:00 EDT becomes 01:00 EST.
    const records = [
      attempt('2026-10-31', '2026-10-31 23:55'),
      attempt('2026-11-01', '2026-11-01 00:05'),
      attempt('2026-11-01', '2026-11-01 23:55'),
      attempt('2026-11-02', '2026-11-02 00:05'),
    ];
    expect(records.map(isStartedOnTheDay)).toEqual([true, true, true, true]);
    expect(computeStreak(records, 'hard', '2026-11-02')).toEqual({ current: 3, best: 3 });
  });

  it('runs through the clocks going forward', () => {
    // 14 March 2027: 02:00 EST becomes 03:00 EDT.
    const records = ['2027-03-13', '2027-03-14', '2027-03-15'].map((d) => attempt(d, `${d} 23:59`));
    expect(computeStreak(records, 'hard', '2027-03-16')).toEqual({ current: 3, best: 3 });
  });

  it('reads a time late in the evening as that evening’s date, though it is the next day in UTC', () => {
    // 21:00 EDT on 6 October is 01:00 UTC on the 7th.
    const record = attempt('2026-10-06', '2026-10-06 21:00');
    expect(new Date(record.createdAt).getUTCDate()).toBe(7);
    expect(computeStreak([record], 'hard', '2026-10-06')).toEqual({ current: 1, best: 1 });
  });
});
