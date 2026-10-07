// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { addDays } from '../core';
import {
  FREEZE_COMMAND,
  MAX_FREEZE_AHEAD,
  SWITCH_COMMAND,
  checkAgainstRelease,
  checkArchive,
  firstUnfrozenDate,
  freezeDays,
  frozenCodes,
  isExtensionOf,
  liveSegment,
  parseArchive,
  planFreeze,
  segmentFor,
  serialiseArchive,
  switchEngine,
  type Archive,
} from './archive';
import type { NewDay } from './generate';

/** Local noon on a date, so its local date is that date in any time zone the tests run in. */
function noon(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

/** Four codes for a day, shaped like real share codes (and as long), which is all these functions look at. */
function codes(date: string): string[] {
  const tag = date.replaceAll('-', '');
  return ['E', 'M', 'H', 'X'].map((tier) => `${tier}${'q'.repeat(20)}${tag}`);
}

function newDays(from: string, count: number): NewDay[] {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(from, i);
    return { date, codes: codes(date) };
  });
}

/** The archive as dailies began: version 4 live from the epoch, nothing frozen. */
const FRESH: Archive = {
  epoch: '2026-10-07',
  segments: [{ version: 4, from: '2026-10-07' }],
  frozenThrough: null,
  days: [],
};

/** Version 4's first eight days frozen, and version 5 live from the day after. */
const SWITCHED: Archive = switchEngine(
  freezeDays(FRESH, newDays('2026-10-07', 8), 4),
  5,
  noon('2026-10-12'),
);

/** An archive as it would be read from disk, with fields overridden. */
function raw(archive: Archive, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...JSON.parse(serialiseArchive(archive)), ...overrides };
}

describe('parseArchive', () => {
  it('reads back what serialiseArchive writes', () => {
    for (const archive of [FRESH, SWITCHED]) {
      expect(parseArchive(JSON.parse(serialiseArchive(archive)))).toEqual(archive);
    }
  });

  it('keeps nothing but the fields it knows', () => {
    const segments = [{ version: 4, from: '2026-10-07', note: 'x' }];
    expect(parseArchive(raw(FRESH, { segments, extra: true }))).toEqual(FRESH);
  });

  it('refuses anything that is not an object', () => {
    for (const value of [null, [], 'archive', 4]) {
      expect(() => parseArchive(value)).toThrow('must hold a JSON object');
    }
  });

  it('reads a released copy whatever its epoch, so long as it is a date everything starts on', () => {
    const earlier = {
      ...raw(FRESH),
      epoch: '2026-10-01',
      segments: [{ version: 4, from: '2026-10-01' }],
    };
    expect(parseArchive(earlier, null)).toEqual({
      ...FRESH,
      epoch: '2026-10-01',
      segments: [{ version: 4, from: '2026-10-01' }],
    });
    expect(() => parseArchive(earlier)).toThrow('"epoch" must be 2026-10-07, the date of Daily #1');
    expect(() => parseArchive({ ...earlier, epoch: 'launch day' }, null)).toThrow(
      '"epoch" must be a YYYY-MM-DD date',
    );
    expect(() => parseArchive({ ...earlier, epoch: '2026-10-02' }, null)).toThrow(
      'must start on the epoch',
    );
  });

  it('refuses another epoch, seed recipe or set of tiers', () => {
    expect(() => parseArchive(raw(FRESH, { epoch: '2026-10-08' }))).toThrow('"epoch"');
    expect(() => parseArchive(raw(FRESH, { seed: 'daily/<tier>/<date>' }))).toThrow('"seed"');
    expect(() => parseArchive(raw(FRESH, { tiers: ['easy', 'hard'] }))).toThrow('"tiers"');
    expect(() => parseArchive(raw(FRESH, { tiers: 'easy' }))).toThrow('"tiers"');
  });

  it('refuses segments that are missing or malformed', () => {
    expect(() => parseArchive(raw(FRESH, { segments: [] }))).toThrow('at least one engine');
    expect(() => parseArchive(raw(FRESH, { segments: undefined }))).toThrow('at least one');
    for (const segment of [
      null,
      { version: 0, from: '2026-10-07' },
      { version: 4.5, from: '2026-10-07' },
      { version: 4, from: '2026-02-30' },
    ]) {
      expect(() => parseArchive(raw(FRESH, { segments: [segment] }))).toThrow('{ version, from }');
    }
  });

  it('refuses segments that do not start on the epoch and move on in date and version', () => {
    const at = (...segments: [number, string][]) =>
      raw(FRESH, { segments: segments.map(([version, from]) => ({ version, from })) });
    expect(() => parseArchive(at([4, '2026-10-08']))).toThrow('must start on the epoch');
    expect(() => parseArchive(at([4, '2026-10-07'], [5, '2026-10-07']))).toThrow('later date');
    expect(() => parseArchive(at([4, '2026-10-07'], [4, '2026-10-11']))).toThrow('newer version');
    expect(() => parseArchive(at([5, '2026-10-07'], [4, '2026-10-11']))).toThrow('newer version');
  });

  it('refuses a frozenThrough that is not a date, or not the last frozen day', () => {
    expect(() => parseArchive(raw(FRESH, { frozenThrough: 'never' }))).toThrow('"frozenThrough"');
    expect(() => parseArchive(raw(FRESH, { frozenThrough: '2026-10-07' }))).toThrow(
      'must be null while "days" is empty',
    );
    expect(() => parseArchive(raw(SWITCHED, { frozenThrough: '2026-10-13' }))).toThrow(
      '"frozenThrough" must be 2026-10-14',
    );
    expect(() => parseArchive(raw(SWITCHED, { frozenThrough: null }))).toThrow('2026-10-14');
  });

  it('refuses days that are not a list of lines, one per day from the epoch', () => {
    const lines = raw(SWITCHED).days as string[];
    const withDays = (days: unknown) => raw(SWITCHED, { days, frozenThrough: '2026-10-14' });
    expect(() => parseArchive(raw(FRESH, { days: 'none' }))).toThrow('"days" must be a list');
    // A day missing from the middle, so the rest are out of place.
    expect(() =>
      parseArchive(withDays([...lines.slice(0, 3), ...lines.slice(4), lines[7]])),
    ).toThrow('The line for 2026-10-10');
    expect(() => parseArchive(withDays([42, ...lines.slice(1)]))).toThrow(
      'The line for 2026-10-07',
    );
    const [first] = lines;
    for (const broken of [
      first.replace(' v4 ', ' '),
      first.replace(' v4 ', ' v0 '),
      first.replace(/ \S+$/, ''),
      `${first} extra`,
    ]) {
      expect(() => parseArchive(withDays([broken, ...lines.slice(1)]))).toThrow(
        'must read "2026-10-07 v<version>" and four share codes',
      );
    }
    expect(() => parseArchive(withDays([first.replace(/ E/, ' AE'), ...lines.slice(1)]))).toThrow(
      'not a share code',
    );
  });

  it('refuses a day whose provenance is not its segment’s engine', () => {
    const lines = (raw(SWITCHED).days as string[]).map((line) => line.replace(' v4 ', ' v5 '));
    expect(() => parseArchive(raw(SWITCHED, { days: lines }))).toThrow(
      '2026-10-07 was frozen from version 5, but version 4 deals that date',
    );
  });
});

describe('reading an archive', () => {
  it('finds the segment that deals a date', () => {
    expect(segmentFor(SWITCHED, '2026-10-07')).toEqual({ version: 4, from: '2026-10-07' });
    expect(segmentFor(SWITCHED, '2026-10-14').version).toBe(4);
    expect(segmentFor(SWITCHED, '2026-10-15').version).toBe(5);
    expect(segmentFor(SWITCHED, '2031-01-01').version).toBe(5);
    expect(liveSegment(SWITCHED)).toEqual({ version: 5, from: '2026-10-15' });
  });

  it('knows the first day that is not frozen', () => {
    expect(firstUnfrozenDate(FRESH)).toBe('2026-10-07');
    expect(firstUnfrozenDate(SWITCHED)).toBe('2026-10-15');
  });

  it('hands back a frozen day’s codes by tier, and nothing for any other date', () => {
    const [easy, medium, hard, expert] = codes('2026-10-09');
    expect(frozenCodes(SWITCHED, '2026-10-09')).toEqual({ easy, medium, hard, expert });
    expect(frozenCodes(SWITCHED, '2026-10-15')).toBeNull();
    expect(frozenCodes(SWITCHED, '2026-10-06')).toBeNull();
    expect(frozenCodes(SWITCHED, 'yesterday')).toBeNull();
    expect(frozenCodes(FRESH, '2026-10-07')).toBeNull();
  });
});

describe('checkArchive', () => {
  it('passes the archive as dailies began, and one handed over properly', () => {
    expect(checkArchive(FRESH, 4)).toEqual([]);
    expect(checkArchive(SWITCHED, 5)).toEqual([]);
  });

  it('fails a GENERATOR_VERSION bumped without freezing, spelling out both commands', () => {
    const [problem, ...rest] = checkArchive(FRESH, 5);
    expect(rest).toEqual([]);
    expect(problem).toContain('GENERATOR_VERSION is 5, but the daily archive still has version 4');
    expect(problem).toContain(`1. ${FREEZE_COMMAND}`);
    expect(problem).toContain('stores every day from 2026-10-07 through the day after tomorrow');
    expect(problem).toContain(`2. then, with your change back in place, ${SWITCH_COMMAND}`);
    expect(problem).toContain('hands every later day to version 5');
    // And the same after a handover, from where the archive leaves off.
    expect(checkArchive(SWITCHED, 6)[0]).toContain('every day from 2026-10-15 through');
  });

  it('says, while nothing is frozen, that before dailies are released a switch alone will do', () => {
    const [problem] = checkArchive(FRESH, 7);
    expect(problem).toContain('Unless dailies have never been released');
    expect(problem).toContain(`${SWITCH_COMMAND} on its own re-points the segment to version 7`);
    // Not once a day has been frozen: dailies have been released by then.
    expect(checkArchive(SWITCHED, 6)[0]).not.toContain('never been released');
  });

  it('says just what to do when it is known whether dailies have been released', () => {
    const [unreleased, ...rest] = checkArchive(FRESH, 7, false);
    expect(rest).toEqual([]);
    expect(unreleased).toContain('Dailies have not been released yet');
    expect(unreleased).toContain(`${SWITCH_COMMAND} re-points the segment to version 7`);
    expect(unreleased).not.toContain(FREEZE_COMMAND);
    const [released] = checkArchive(FRESH, 7, true);
    expect(released).toContain(`1. ${FREEZE_COMMAND}`);
    expect(released).not.toContain('released');
    // Once anything is frozen, the steps are the same either way.
    expect(checkArchive(SWITCHED, 6, false)[0]).toContain(`1. ${FREEZE_COMMAND}`);
  });

  it('fails an engine older than the archive', () => {
    expect(checkArchive(SWITCHED, 4)).toEqual([
      expect.stringContaining('this engine is older than the archive'),
    ]);
  });

  it('fails days frozen without a switch to a new engine', () => {
    const frozen = freezeDays(FRESH, newDays('2026-10-07', 3), 4);
    expect(checkArchive(frozen, 4)).toEqual([
      expect.stringContaining(
        `Days through 2026-10-09 are frozen, but version 4 still deals every day from 2026-10-07`,
      ),
    ]);
    expect(checkArchive(frozen, 4)[0]).toContain(SWITCH_COMMAND);
  });

  it('fails a new engine switched in without freezing the old one’s days, spelling out both commands', () => {
    const unfrozen: Archive = {
      ...FRESH,
      segments: [...FRESH.segments, { version: 5, from: '2026-10-12' }],
    };
    const [problem, ...rest] = checkArchive(unfrozen, 5);
    expect(rest).toEqual([]);
    expect(problem).toContain(
      'Version 5 takes over the dailies on 2026-10-12, but the archive is frozen on no day at all',
    );
    expect(problem).toContain('the days from 2026-10-07 to 2026-10-11 were dealt by version 4');
    expect(problem).toContain(FREEZE_COMMAND);
    expect(problem).toContain(SWITCH_COMMAND);
  });

  it('fails a new engine that leaves a gap after the frozen days', () => {
    const gap: Archive = {
      ...SWITCHED,
      segments: [SWITCHED.segments[0], { version: 5, from: '2026-10-18' }],
    };
    expect(checkArchive(gap, 5)[0]).toContain('frozen only through 2026-10-14');
    expect(checkArchive(gap, 5)[0]).toContain('the days from 2026-10-15 to 2026-10-17');
  });

  describe('at the exact edges', () => {
    it('fails a single day frozen without a switch', () => {
      expect(checkArchive(freezeDays(FRESH, newDays('2026-10-07', 1), 4), 4)).toEqual([
        expect.stringContaining('Days through 2026-10-07 are frozen'),
      ]);
    });

    it('fails a new engine starting one day after the day after the last frozen one', () => {
      // Frozen through the 14th: the 15th would be dealt by nobody.
      const gap: Archive = {
        ...SWITCHED,
        segments: [SWITCHED.segments[0], { version: 5, from: '2026-10-16' }],
      };
      expect(checkArchive(gap, 5)).toEqual([
        expect.stringContaining('the days from 2026-10-15 to 2026-10-15'),
      ]);
    });

    it('passes a new engine starting the very day after the last frozen one', () => {
      expect(SWITCHED.segments[1]).toEqual({ version: 5, from: '2026-10-15' });
      expect(checkArchive(SWITCHED, 5)).toEqual([]);
    });
  });
});

describe('checkAgainstRelease', () => {
  /** Noon UTC on a date: the next date has begun in UTC+14 (at 10:00 UTC), the one after not yet. */
  const middayUtc = (date: string) => Date.parse(`${date}T12:00:00Z`);

  it('passes anything while dailies have not been released', () => {
    const repointed: Archive = { ...FRESH, segments: [{ version: 7, from: '2026-10-07' }] };
    expect(checkAgainstRelease(null, repointed, middayUtc('2026-10-13'))).toEqual([]);
  });

  it('passes the released archive itself, however much later', () => {
    expect(checkAgainstRelease(SWITCHED, SWITCHED, middayUtc('2027-06-01'))).toEqual([]);
    expect(checkAgainstRelease(FRESH, FRESH, middayUtc('2027-06-01'))).toEqual([]);
  });

  it('passes a freeze and switch handing over days still ahead everywhere', () => {
    const now = middayUtc('2026-10-12');
    const plan = planFreeze(FRESH, 4, undefined, now);
    const frozen = freezeDays(FRESH, newDays(plan.from, plan.count), 4);
    const switched = switchEngine(frozen, 5, now);
    expect(liveSegment(switched).from).toBe('2026-10-15');
    expect(checkAgainstRelease(FRESH, switched, now)).toEqual([]);
    // Until the day before its first day has begun everywhere — then no longer.
    expect(checkAgainstRelease(FRESH, switched, Date.parse('2026-10-14T09:59:59Z'))).toEqual([]);
    const [stale] = checkAgainstRelease(FRESH, switched, Date.parse('2026-10-14T10:00:00Z'));
    expect(stale).toContain('Version 5 takes over the dailies on 2026-10-15');
    expect(stale).toContain('it is 2026-10-15 in UTC+14');
    expect(stale).toContain('the switch has gone stale');
    expect(stale).toContain(FREEZE_COMMAND);
  });

  it('fails a switch merged days after it was made', () => {
    const switched = switchEngine(
      freezeDays(FRESH, newDays('2026-10-07', 8), 4),
      5,
      middayUtc('2026-10-12'),
    );
    expect(checkAgainstRelease(FRESH, switched, middayUtc('2026-10-16'))).toEqual([
      expect.stringContaining('the switch has gone stale'),
    ]);
  });

  it('fails a live segment re-pointed by hand after its engine has dealt', () => {
    const repointed: Archive = { ...FRESH, segments: [{ version: 7, from: '2026-10-07' }] };
    const [problem, ...rest] = checkAgainstRelease(FRESH, repointed, middayUtc('2026-10-13'));
    expect(rest).toEqual([]);
    expect(problem).toContain('Version 4 has dealt the dailies from 2026-10-07');
    expect(problem).toContain('Put it back to version 4');
    expect(problem).toContain('stores every day from 2026-10-07');
  });

  it('passes a live segment re-pointed while its first day is still ahead everywhere', () => {
    // Switched in on the 12th to take over on the 15th, and replaced on the 13th.
    const replaced = switchEngine(SWITCHED, 6, middayUtc('2026-10-13'));
    expect(checkAgainstRelease(SWITCHED, replaced, middayUtc('2026-10-13'))).toEqual([]);
    expect(checkAgainstRelease(SWITCHED, replaced, middayUtc('2026-10-14'))).toEqual([
      expect.stringContaining('Version 5 has dealt the dailies from 2026-10-15'),
    ]);
  });

  it('fails an archive that drops or rewrites what the released one holds', () => {
    const rewritten = structuredClone(SWITCHED);
    rewritten.days[2].codes[0] = rewritten.days[3].codes[0];
    expect(checkAgainstRelease(SWITCHED, rewritten, middayUtc('2026-10-13'))).toEqual([
      expect.stringContaining('no longer holds everything the released one (on main) does'),
    ]);
    expect(checkAgainstRelease(SWITCHED, FRESH, middayUtc('2026-10-13'))).toHaveLength(1);
  });
});

describe('checkAgainstRelease when Daily #1 moves', () => {
  /** Noon UTC on a date: the next date has begun in UTC+14 (at 10:00 UTC), the one after not yet. */
  const middayUtc = (date: string) => Date.parse(`${date}T12:00:00Z`);

  /** An archive with nothing frozen, version `version` dealing every day from `epoch`. */
  const fresh = (epoch: string, version = 4): Archive => ({
    epoch,
    segments: [{ version, from: epoch }],
    frozenThrough: null,
    days: [],
  });

  /** As main released it on the launch morning: Daily #1 on the 1st, nothing frozen. */
  const LAUNCHED = fresh('2026-10-01', 7);

  it('passes Daily #1 moved later, to a day begun somewhere, while the release has nothing frozen', () => {
    const moved = fresh('2026-10-07', 7);
    // The day of the move, and any time after: a date's puzzle never depended
    // on Daily #1, so only days before the new one are gone.
    expect(checkAgainstRelease(LAUNCHED, moved, middayUtc('2026-10-07'))).toEqual([]);
    expect(checkAgainstRelease(LAUNCHED, moved, middayUtc('2027-06-01'))).toEqual([]);
    // Begun only in UTC+14 is begun: someone has been dealt it.
    expect(checkAgainstRelease(LAUNCHED, fresh('2026-10-08', 7), middayUtc('2026-10-07'))).toEqual(
      [],
    );
    expect(
      checkAgainstRelease(fresh('2026-10-01'), fresh('2026-12-25'), middayUtc('2026-12-25')),
    ).toEqual([]);
  });

  it('refuses Daily #1 moved to a day still to come, so a move never stands in for a freeze', () => {
    // At noon UTC on the 7th it is the 8th in UTC+14, and the 9th has begun nowhere.
    const now = middayUtc('2026-10-07');
    // Today's dailies gone for everyone…
    const [later, ...rest] = checkAgainstRelease(LAUNCHED, fresh('2026-12-25', 7), now);
    expect(rest).toEqual([]);
    expect(later).toContain(
      'Daily #1 is 2026-10-01 in the released archive (on main), but 2026-12-25 here, a day ' +
        'that has not begun anywhere yet (it is 2026-10-08 in UTC+14)',
    );
    expect(later).toContain('may move later only to a day that has begun somewhere');
    expect(later).toContain("take today's dailies away from every player");
    expect(later).toContain('change the engine on its own');
    expect(later).toContain('back to 2026-10-01');
    // …or a new engine carried in over the 1st to the 8th, which version 7 has dealt, unfrozen.
    expect(checkAgainstRelease(LAUNCHED, fresh('2026-10-09', 8), now)).toEqual([
      expect.stringContaining('may move later only to a day that has begun somewhere'),
    ]);
  });

  it('then holds the change to every rule, as though the release had begun on the new Daily #1', () => {
    // A switch on top of the move, handing over days still ahead everywhere.
    const now = middayUtc('2026-10-07');
    const switched = switchEngine(
      freezeDays(fresh('2026-10-07', 7), newDays('2026-10-07', 3), 7),
      8,
      now,
    );
    expect(checkAgainstRelease(LAUNCHED, switched, now)).toEqual([]);
    expect(checkAgainstRelease(LAUNCHED, switched, middayUtc('2026-10-10'))).toEqual([
      expect.stringContaining('the switch has gone stale'),
    ]);
    // A later segment the release already had keeps its start.
    const twoEngines: Archive = {
      ...LAUNCHED,
      segments: [...LAUNCHED.segments, { version: 8, from: '2026-10-20' }],
    };
    const kept: Archive = {
      ...fresh('2026-10-07', 7),
      segments: [
        { version: 7, from: '2026-10-07' },
        { version: 8, from: '2026-10-20' },
      ],
    };
    expect(checkAgainstRelease(twoEngines, kept, now)).toEqual([]);
    expect(checkAgainstRelease(twoEngines, fresh('2026-10-07', 7), now)).toEqual([
      expect.stringContaining('no longer holds everything the released one (on main) does'),
    ]);
    // And one the new Daily #1 passes is the engine from then on.
    expect(
      checkAgainstRelease(twoEngines, fresh('2026-10-25', 8), middayUtc('2026-10-25')),
    ).toEqual([]);
  });

  it('never lets the moved segment be re-pointed, as its new first day has begun', () => {
    // At noon UTC on the 7th it is the 8th in UTC+14: begun, so dealt by version 7.
    const now = middayUtc('2026-10-07');
    const [problem, ...rest] = checkAgainstRelease(LAUNCHED, fresh('2026-10-08', 8), now);
    expect(rest).toEqual([]);
    expect(problem).toContain('Version 7 has dealt the dailies from 2026-10-08, which has begun');
    expect(problem).toContain('Put it back to version 7');
    expect(problem).toContain('stores every day from 2026-10-08');
  });

  it('refuses Daily #1 moved earlier, saying why, to rebase if behind main, and what to put back', () => {
    const [problem, ...rest] = checkAgainstRelease(
      fresh('2026-10-07', 7),
      LAUNCHED,
      middayUtc('2026-10-07'),
    );
    expect(rest).toEqual([]);
    expect(problem).toContain(
      'Daily #1 is 2026-10-07 in the released archive (on main), but 2026-10-01 here',
    );
    expect(problem).toContain('Daily #1 never moves earlier');
    expect(problem).toContain('the days before it never had a daily');
    // A branch cut before main moved Daily #1 is told to rebase first…
    expect(problem).toContain('If this branch is behind main, rebase onto main');
    expect(problem).toContain('freeze and switch again');
    // …and only a branch that moved it itself to put the dates back.
    expect(problem).toContain('If it moved Daily #1 itself, put DAILY_EPOCH (src/core/dates.ts)');
    expect(problem).toContain('back to 2026-10-07');
  });

  it('refuses Daily #1 moved later once anything is frozen, saying why and what to put back', () => {
    const now = middayUtc('2026-10-07');
    const released = switchEngine(
      freezeDays(LAUNCHED, newDays('2026-10-01', 8), 7),
      8,
      noon('2026-10-06'),
    );
    // Everything from the new Daily #1 kept just as it was, and still refused.
    const moved: Archive = {
      epoch: '2026-10-07',
      segments: [{ version: 7, from: '2026-10-07' }, released.segments[1]],
      frozenThrough: released.frozenThrough,
      days: released.days.slice(6),
    };
    const [problem, ...rest] = checkAgainstRelease(released, moved, now);
    expect(rest).toEqual([]);
    expect(problem).toContain(
      'Daily #1 is 2026-10-01 in the released archive (on main), but 2026-10-07 here',
    );
    expect(problem).toContain('has days frozen through 2026-10-08');
    expect(problem).toContain('throw away frozen dailies players may have played');
    expect(problem).toContain('Daily #1 may move later only while nothing is frozen');
    expect(problem).toContain('back to 2026-10-01');
  });
});

describe('planFreeze', () => {
  it('freezes through the day after tomorrow by default, from the first unfrozen day', () => {
    expect(MAX_FREEZE_AHEAD).toBe(2);
    expect(planFreeze(FRESH, 4, undefined, noon('2026-10-12'))).toEqual({
      from: '2026-10-07',
      through: '2026-10-14',
      count: 8,
    });
  });

  it('freezes through an earlier date when asked', () => {
    expect(planFreeze(FRESH, 4, '2026-10-07', noon('2026-10-12'))).toEqual({
      from: '2026-10-07',
      through: '2026-10-07',
      count: 1,
    });
  });

  it('carries on from the last frozen day, and has nothing to do once it is past the date', () => {
    const frozen = freezeDays(FRESH, newDays('2026-10-07', 5), 4);
    expect(planFreeze(frozen, 4, undefined, noon('2026-10-12'))).toEqual({
      from: '2026-10-12',
      through: '2026-10-14',
      count: 3,
    });
    expect(planFreeze(frozen, 4, '2026-10-09', noon('2026-10-12')).count).toBe(0);
  });

  it('refuses to run once the engine has changed', () => {
    expect(() => planFreeze(FRESH, 5, undefined, noon('2026-10-12'))).toThrow(
      "GENERATOR_VERSION is 5, but the archive's live engine is version 4",
    );
  });

  it('refuses a date that is not one', () => {
    expect(() => planFreeze(FRESH, 4, '2026-10-32', noon('2026-10-12'))).toThrow(
      '--through must be a real date',
    );
  });

  it('refuses to store days further ahead than the day after tomorrow', () => {
    expect(() => planFreeze(FRESH, 4, '2026-10-15', noon('2026-10-12'))).toThrow(
      'Refusing to freeze through 2026-10-15',
    );
  });
});

describe('freezeDays', () => {
  it('adds the days to the end, stamped with the engine that dealt them', () => {
    const once = freezeDays(FRESH, newDays('2026-10-07', 2), 4);
    expect(once.frozenThrough).toBe('2026-10-08');
    expect(once.days).toEqual([
      { date: '2026-10-07', version: 4, codes: codes('2026-10-07') },
      { date: '2026-10-08', version: 4, codes: codes('2026-10-08') },
    ]);
    const twice = freezeDays(once, newDays('2026-10-09', 1), 4);
    expect(twice.days.map((day) => day.date)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    expect(isExtensionOf(once, twice)).toBe(true);
  });

  it('freezes a later engine’s days after its segment has begun', () => {
    const more = freezeDays(SWITCHED, newDays('2026-10-15', 2), 5);
    expect(more.days.slice(-2).map((day) => day.version)).toEqual([5, 5]);
    expect(parseArchive(JSON.parse(serialiseArchive(more)))).toEqual(more);
  });

  it('never changes the archive it is given', () => {
    const before = structuredClone(FRESH);
    freezeDays(FRESH, newDays('2026-10-07', 2), 4);
    expect(FRESH).toEqual(before);
  });

  it('hands back the same archive when there is nothing to freeze', () => {
    expect(freezeDays(FRESH, [], 4)).toBe(FRESH);
  });

  it('refuses days that would rewrite, skip or reorder frozen ones', () => {
    const frozen = freezeDays(FRESH, newDays('2026-10-07', 2), 4);
    expect(() => freezeDays(frozen, newDays('2026-10-08', 1), 4)).toThrow(
      'Refusing to freeze 2026-10-08: the next day to freeze is 2026-10-09',
    );
    expect(() => freezeDays(frozen, newDays('2026-10-10', 1), 4)).toThrow('2026-10-09');
    const [a, b] = newDays('2026-10-09', 2);
    expect(() => freezeDays(frozen, [b, a], 4)).toThrow('Refusing to freeze 2026-10-10');
  });

  it('refuses days dealt by any engine but the live one', () => {
    expect(() => freezeDays(FRESH, newDays('2026-10-07', 1), 5)).toThrow(
      'Refusing to freeze days dealt by version 5',
    );
  });

  it('refuses a day without four share codes', () => {
    const [day] = newDays('2026-10-07', 1);
    expect(() => freezeDays(FRESH, [{ ...day, codes: day.codes.slice(1) }], 4)).toThrow(
      '2026-10-07 must hold 4 share codes',
    );
    expect(() => freezeDays(FRESH, [{ ...day, codes: [...day.codes.slice(1), 'A0'] }], 4)).toThrow(
      'share codes',
    );
  });
});

describe('switchEngine', () => {
  const frozen = freezeDays(FRESH, newDays('2026-10-07', 8), 4);

  it('starts the new engine the day after the last frozen day', () => {
    expect(switchEngine(frozen, 5, noon('2026-10-12')).segments).toEqual([
      { version: 4, from: '2026-10-07' },
      { version: 5, from: '2026-10-15' },
    ]);
    expect(isExtensionOf(frozen, SWITCHED)).toBe(true);
  });

  it('refuses until GENERATOR_VERSION has been bumped', () => {
    expect(() => switchEngine(frozen, 4, noon('2026-10-12'))).toThrow(
      'GENERATOR_VERSION is 4, and the live engine is already version 4',
    );
  });

  it('replaces a live engine that has not dealt a day yet, from the same day', () => {
    // Switched in on the 12th to take over on the 15th, and replaced before then.
    const replaced = switchEngine(SWITCHED, 6, noon('2026-10-13'));
    expect(replaced.segments).toEqual([
      { version: 4, from: '2026-10-07' },
      { version: 6, from: '2026-10-15' },
    ]);
    expect(replaced.days).toBe(SWITCHED.days);
    expect(checkArchive(replaced, 6)).toEqual([]);
    expect(isExtensionOf(SWITCHED, replaced)).toBe(true);
  });

  it('re-points the one segment to any engine before dailies are released, whatever the date', () => {
    const repointed = switchEngine(FRESH, 7, noon('2026-10-13'), false);
    expect(repointed).toEqual({ ...FRESH, segments: [{ version: 7, from: '2026-10-07' }] });
    expect(checkArchive(repointed, 7)).toEqual([]);
    expect(isExtensionOf(FRESH, repointed)).toBe(true);
    // Released, the same switch would deal a week of dailies again.
    expect(() => switchEngine(FRESH, 7, noon('2026-10-13'))).toThrow('are frozen yet');
  });

  it('refuses while none of the live engine’s days are frozen, spelling out both commands', () => {
    // Version 5's first day, the 15th, has begun in UTC+14 by noon UTC on the 14th.
    for (const archive of [FRESH, SWITCHED]) {
      const attempt = () => switchEngine(archive, 6, Date.UTC(2026, 9, 14, 12));
      expect(attempt).toThrow('are frozen yet, so switching would deal them all again');
      expect(attempt).toThrow(FREEZE_COMMAND);
    }
  });

  it('refuses to hand over a day that has already begun somewhere', () => {
    const short = freezeDays(FRESH, newDays('2026-10-07', 5), 4);
    // Noon UTC on the 11th is 02:00 on the 12th in UTC+14.
    expect(() => switchEngine(short, 5, Date.UTC(2026, 9, 11, 12))).toThrow(
      'The archive is frozen only through 2026-10-11, but 2026-10-12 has already begun',
    );
    // 2026-10-12 begins in UTC+14 at 10:00 UTC on the 11th.
    expect(() => switchEngine(short, 5, Date.UTC(2026, 9, 11, 9, 59))).not.toThrow();
    expect(() => switchEngine(short, 5, Date.UTC(2026, 9, 11, 10, 0))).toThrow('already begun');
  });

  it('never changes the archive it is given', () => {
    const before = structuredClone(frozen);
    switchEngine(frozen, 5, noon('2026-10-12'));
    expect(frozen).toEqual(before);
  });
});

describe('isExtensionOf', () => {
  it('holds when only days and segments have been added to the end', () => {
    expect(isExtensionOf(FRESH, FRESH)).toBe(true);
    expect(isExtensionOf(FRESH, SWITCHED)).toBe(true);
  });

  it('fails when anything already there changed, went or moved', () => {
    expect(isExtensionOf(SWITCHED, FRESH)).toBe(false);
    const rewritten = {
      ...SWITCHED,
      days: SWITCHED.days.map((day, i) => (i === 2 ? { ...day, codes: codes('2027-01-01') } : day)),
    };
    expect(isExtensionOf(SWITCHED, rewritten)).toBe(false);
    const moved = {
      ...SWITCHED,
      segments: [SWITCHED.segments[0], { version: 5, from: '2026-10-16' }],
    };
    expect(isExtensionOf(SWITCHED, moved)).toBe(false);
    const older = {
      ...SWITCHED,
      segments: [SWITCHED.segments[0], { version: 3, from: '2026-10-15' }],
    };
    expect(isExtensionOf(SWITCHED, older)).toBe(false);
    const earlier = {
      ...SWITCHED,
      segments: [{ version: 5, from: '2026-10-07' }, SWITCHED.segments[1]],
    };
    expect(isExtensionOf(SWITCHED, earlier)).toBe(false);
    expect(isExtensionOf(SWITCHED, { ...SWITCHED, epoch: '2026-10-08' })).toBe(false);
  });
});

describe('serialiseArchive', () => {
  const ROOT = fileURLToPath(new URL('../..', import.meta.url));

  /** What Prettier makes of a text, with the repo's own settings, as a JSON file in this folder. */
  async function prettier(text: string): Promise<string> {
    const filepath = `${ROOT}src/daily/archive.json`;
    const options = await resolveConfig(filepath);
    return format(text, { ...options, filepath });
  }

  it('writes exactly what Prettier would, whatever the archive holds', async () => {
    const shapes = [
      FRESH,
      freezeDays(FRESH, newDays('2026-10-07', 1), 4),
      freezeDays(FRESH, newDays('2026-10-07', 3), 4),
      SWITCHED,
      switchEngine(freezeDays(SWITCHED, newDays('2026-10-15', 2), 5), 6, noon('2026-10-12')),
    ];
    for (const archive of shapes) {
      const text = serialiseArchive(archive);
      expect(await prettier(text)).toBe(text);
    }
  });

  it('turns a freeze into a diff of added lines, plus a comma on the line before them', () => {
    const before = serialiseArchive(freezeDays(FRESH, newDays('2026-10-07', 2), 4)).split('\n');
    const after = serialiseArchive(freezeDays(FRESH, newDays('2026-10-07', 4), 4)).split('\n');
    const changed = before.filter((line) => !after.includes(line));
    // The frozenThrough line, and the old last day, which gains a comma.
    expect(changed).toEqual([
      '  "frozenThrough": "2026-10-08",',
      `    "2026-10-08 v4 ${codes('2026-10-08').join(' ')}"`,
    ]);
    expect(after).toHaveLength(before.length + 2);
  });
});
