import type { Difficulty } from '../core';
import type { GameRecord } from '../storage/history';
import {
  STATUS_TEXT,
  dailyName,
  dailyPhrase,
  describeDay,
  statusesOn,
  streakNote,
  summariseDaily,
} from './daily';
import { formatDay, formatDayWithYear, formatLongDay, formatMonth, formatShortDay } from './format';

/*
 * Local times below are read in the time zone the tests run in; each date
 * is a whole local day, so the zone does not change which day a record is
 * on (`dateKeyOf` reads the local calendar, as the app does).
 */

const PUZZLE = '1'.padEnd(81, '0');

/** Epoch ms of a local `YYYY-MM-DD` at `hour`. */
function at(date: string, hour = 12): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
}

let serial = 0;

/** A daily attempt at `daily`, begun at noon on local date `started`, solved unless said otherwise. */
function attempt(
  daily: string,
  tier: Difficulty,
  started: string = daily,
  overrides: Partial<GameRecord> = {},
): GameRecord {
  const createdAt = at(started);
  const status = overrides.status ?? 'solved';
  return {
    id: `game-${serial++}`,
    givens: PUZZLE,
    difficulty: tier,
    source: 'daily',
    createdAt,
    updatedAt: createdAt + 600_000,
    completedAt: status === 'solved' ? createdAt + 600_000 : null,
    status,
    elapsedMs: 600_000,
    assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
    challenge: null,
    daily,
    ...overrides,
  };
}

describe('dates, as the calendar writes them', () => {
  it('writes a date short, adding the year only when it is not this one', () => {
    expect(formatDay('2026-10-06', '2026-10-07')).toBe('6 Oct');
    expect(formatDay('2026-10-06', '2027-01-02')).toBe('6 Oct 2026');
    expect(formatDayWithYear('2026-10-06')).toBe('6 Oct 2026');
  });

  it('names a day in full, in short with its weekday, and a month with its year', () => {
    expect(formatLongDay('2026-10-06')).toBe('Tuesday 6 October');
    expect(formatShortDay('2026-10-06')).toBe('Tue 6 Oct');
    expect(formatMonth('2026-10')).toBe('October 2026');
  });
});

describe('naming a daily', () => {
  it('names a daily as the completion dialog and History do', () => {
    expect(dailyName('2026-10-13', 'hard', '2026-10-13')).toBe('Daily · 13 Oct · Hard');
    expect(dailyName('2026-12-31', 'easy', '2027-01-02')).toBe('Daily · 31 Dec 2026 · Easy');
  });

  it("calls today's today's, and any other day's by its date", () => {
    expect(dailyPhrase('2026-10-13', 'expert', '2026-10-13')).toBe("today's Expert puzzle");
    expect(dailyPhrase('2026-10-12', 'medium', '2026-10-13')).toBe('the Medium daily for 12 Oct');
  });

  it('words each standing for the key', () => {
    expect(Object.values(STATUS_TEXT)).toEqual([
      'Solved on the day',
      'Solved on another day',
      'In progress',
      'Not started',
    ]);
  });
});

describe('describeDay', () => {
  it('says how each tier stands, telling tiers in the same state together', () => {
    expect(describeDay('2026-10-13', { easy: 'solved-on-the-day', medium: 'in-progress' })).toBe(
      'Tuesday 13 October: Easy solved on the day, Medium in progress, Hard and Expert not started',
    );
  });

  it('keeps the order of the tiers, whatever the order of the states', () => {
    expect(
      describeDay('2026-10-08', {
        easy: 'not-started',
        medium: 'solved-later',
        hard: 'not-started',
        expert: 'solved-later',
      }),
    ).toBe(
      'Thursday 8 October: Easy and Hard not started, Medium and Expert solved on another day',
    );
  });

  it('says it once for a day of one state', () => {
    expect(describeDay('2026-10-09', {})).toBe(
      'Friday 9 October: Easy, Medium, Hard and Expert not started',
    );
  });
});

describe('statusesOn and summariseDaily', () => {
  it('stands every tier of a day, attempted or not', () => {
    const records = [attempt('2026-10-13', 'hard'), attempt('2026-10-12', 'easy')];
    expect(statusesOn(records, '2026-10-13')).toEqual({
      easy: 'not-started',
      medium: 'not-started',
      hard: 'solved-on-the-day',
      expert: 'not-started',
    });
  });

  it('has nothing to show for a daily not started', () => {
    expect(summariseDaily([], '2026-10-13', 'hard')).toEqual({
      status: 'not-started',
      record: null,
    });
  });

  it('shows the unfinished attempt played last for a daily in progress', () => {
    const older = attempt('2026-10-13', 'hard', '2026-10-13', { status: 'playing' });
    const newer = { ...older, id: 'newer', updatedAt: older.updatedAt + 1000 };
    // Newest first, as the history lists them — but by when each was begun.
    const { status, record } = summariseDaily([older, newer], '2026-10-13', 'hard');
    expect(status).toBe('in-progress');
    expect(record).toBe(newer);
  });

  it('shows the first solve on the day, not a later replay, for a daily solved on the day', () => {
    const first = attempt('2026-10-13', 'hard', '2026-10-13', { elapsedMs: 300_000 });
    const replay = {
      ...attempt('2026-10-13', 'hard', '2026-10-13', { elapsedMs: 100_000, source: 'replay' }),
      createdAt: first.createdAt + 3_600_000,
    };
    const later = attempt('2026-10-13', 'hard', '2026-10-14');
    const summary = summariseDaily([later, replay, first], '2026-10-13', 'hard');
    expect(summary).toEqual({ status: 'solved-on-the-day', record: first });
    // Whatever order the list is in.
    expect(summariseDaily([first, replay], '2026-10-13', 'hard').record).toBe(first);
  });

  it('shows how a daily stands from the ledger alone, with no attempt to show, once its records are pruned', () => {
    const ledger = new Map([['2026-10-10', { hard: 'solved-on-the-day' as const }]]);
    expect(summariseDaily([], '2026-10-10', 'hard', ledger)).toEqual({
      status: 'solved-on-the-day',
      record: null,
    });
    expect(statusesOn([], '2026-10-10', ledger).hard).toBe('solved-on-the-day');
  });

  it('shows the first solve for a daily only ever solved later', () => {
    const first = attempt('2026-10-11', 'easy', '2026-10-12');
    const second = attempt('2026-10-11', 'easy', '2026-10-13');
    expect(summariseDaily([second, first], '2026-10-11', 'easy')).toEqual({
      status: 'solved-later',
      record: first,
    });
  });
});

describe('streakNote', () => {
  const TODAY = '2026-10-13';

  it('says a daily begun after its day never counts', () => {
    const solve = attempt('2026-10-12', 'hard', TODAY);
    expect(streakNote(solve, [solve], TODAY)).toEqual({ kind: 'later' });
  });

  it('says a first counted day starts a streak', () => {
    const solve = attempt(TODAY, 'hard');
    expect(streakNote(solve, [solve], TODAY)).toEqual({ kind: 'started' });
  });

  it('gives the streak run on', () => {
    const solve = attempt(TODAY, 'hard');
    const records = [solve, attempt('2026-10-12', 'hard'), attempt('2026-10-11', 'hard')];
    expect(streakNote(solve, records, TODAY)).toEqual({ kind: 'streak', days: 3 });
  });

  it("counts only the tier's own days", () => {
    const solve = attempt(TODAY, 'hard');
    const records = [solve, attempt('2026-10-12', 'easy')];
    expect(streakNote(solve, records, TODAY)).toEqual({ kind: 'started' });
  });

  it('gives the streak, not a new start, for a day solved twice', () => {
    const first = attempt(TODAY, 'hard');
    const again = attempt(TODAY, 'hard', TODAY, { source: 'replay' });
    expect(streakNote(again, [again, first], TODAY)).toEqual({ kind: 'streak', days: 1 });
  });

  it("counts yesterday's daily begun yesterday and solved after midnight", () => {
    const solve = attempt('2026-10-12', 'hard', '2026-10-12', { completedAt: at(TODAY, 0) });
    const records = [solve, attempt('2026-10-11', 'hard')];
    expect(streakNote(solve, records, TODAY)).toEqual({ kind: 'streak', days: 2 });
  });

  it('says only that it counts for a day the current streak does not reach', () => {
    // Begun on its day, three days ago, and only finished now.
    const solve = attempt('2026-10-10', 'hard');
    expect(streakNote(solve, [solve], TODAY)).toEqual({ kind: 'counted' });
    const records = [solve, attempt(TODAY, 'hard')];
    expect(streakNote(solve, records, TODAY)).toEqual({ kind: 'counted' });
  });

  it('says a record that is no daily never counts', () => {
    const { daily: _daily, ...plain } = attempt(TODAY, 'hard');
    expect(streakNote(plain, [plain], TODAY)).toEqual({ kind: 'later' });
  });

  it('says a daily started before its day had begun here never counts, and was early', () => {
    // From a friend's link, a time zone ahead, the evening before.
    const solve = attempt('2026-10-14', 'hard', TODAY);
    expect(streakNote(solve, [solve], TODAY)).toEqual({ kind: 'early' });
  });

  it('runs the streak on from the ledger, where pruned records left it', () => {
    const solve = attempt(TODAY, 'hard');
    const ledger = new Map([
      ['2026-10-11', { hard: 'solved-on-the-day' as const }],
      ['2026-10-12', { hard: 'solved-on-the-day' as const }],
    ]);
    expect(streakNote(solve, [solve], TODAY, ledger)).toEqual({ kind: 'streak', days: 3 });
    // A day already counted in the ledger, solved again: the streak, not a new start.
    const again = attempt('2026-10-12', 'hard', '2026-10-12', { completedAt: at(TODAY, 0) });
    const today = new Map([['2026-10-12', { hard: 'solved-on-the-day' as const }]]);
    expect(streakNote(again, [again], TODAY, today)).toEqual({ kind: 'streak', days: 1 });
    // Today counted in the ledger: the streak runs to today.
    const yesterday = attempt('2026-10-12', 'hard', '2026-10-12', { completedAt: at(TODAY, 0) });
    const withToday = new Map([[TODAY, { hard: 'solved-on-the-day' as const }]]);
    expect(streakNote(yesterday, [yesterday], TODAY, withToday)).toEqual({
      kind: 'streak',
      days: 2,
    });
  });
});
