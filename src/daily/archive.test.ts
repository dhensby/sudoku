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
  epoch: '2026-10-01',
  segments: [{ version: 4, from: '2026-10-01' }],
  frozenThrough: null,
  days: [],
};

/** Version 4's first eight days frozen, and version 5 live from the day after. */
const SWITCHED: Archive = switchEngine(
  freezeDays(FRESH, newDays('2026-10-01', 8), 4),
  5,
  noon('2026-10-06'),
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
    const segments = [{ version: 4, from: '2026-10-01', note: 'x' }];
    expect(parseArchive(raw(FRESH, { segments, extra: true }))).toEqual(FRESH);
  });

  it('refuses anything that is not an object', () => {
    for (const value of [null, [], 'archive', 4]) {
      expect(() => parseArchive(value)).toThrow('must hold a JSON object');
    }
  });

  it('refuses another epoch, seed recipe or set of tiers', () => {
    expect(() => parseArchive(raw(FRESH, { epoch: '2026-10-02' }))).toThrow('"epoch"');
    expect(() => parseArchive(raw(FRESH, { seed: 'daily/<tier>/<date>' }))).toThrow('"seed"');
    expect(() => parseArchive(raw(FRESH, { tiers: ['easy', 'hard'] }))).toThrow('"tiers"');
    expect(() => parseArchive(raw(FRESH, { tiers: 'easy' }))).toThrow('"tiers"');
  });

  it('refuses segments that are missing or malformed', () => {
    expect(() => parseArchive(raw(FRESH, { segments: [] }))).toThrow('at least one engine');
    expect(() => parseArchive(raw(FRESH, { segments: undefined }))).toThrow('at least one');
    for (const segment of [
      null,
      { version: 0, from: '2026-10-01' },
      { version: 4.5, from: '2026-10-01' },
      { version: 4, from: '2026-02-30' },
    ]) {
      expect(() => parseArchive(raw(FRESH, { segments: [segment] }))).toThrow('{ version, from }');
    }
  });

  it('refuses segments that do not start on the epoch and move on in date and version', () => {
    const at = (...segments: [number, string][]) =>
      raw(FRESH, { segments: segments.map(([version, from]) => ({ version, from })) });
    expect(() => parseArchive(at([4, '2026-10-02']))).toThrow('must start on the epoch');
    expect(() => parseArchive(at([4, '2026-10-01'], [5, '2026-10-01']))).toThrow('later date');
    expect(() => parseArchive(at([4, '2026-10-01'], [4, '2026-10-05']))).toThrow('newer version');
    expect(() => parseArchive(at([5, '2026-10-01'], [4, '2026-10-05']))).toThrow('newer version');
  });

  it('refuses a frozenThrough that is not a date, or not the last frozen day', () => {
    expect(() => parseArchive(raw(FRESH, { frozenThrough: 'never' }))).toThrow('"frozenThrough"');
    expect(() => parseArchive(raw(FRESH, { frozenThrough: '2026-10-01' }))).toThrow(
      'must be null while "days" is empty',
    );
    expect(() => parseArchive(raw(SWITCHED, { frozenThrough: '2026-10-07' }))).toThrow(
      '"frozenThrough" must be 2026-10-08',
    );
    expect(() => parseArchive(raw(SWITCHED, { frozenThrough: null }))).toThrow('2026-10-08');
  });

  it('refuses days that are not a list of lines, one per day from the epoch', () => {
    const lines = raw(SWITCHED).days as string[];
    const withDays = (days: unknown) => raw(SWITCHED, { days, frozenThrough: '2026-10-08' });
    expect(() => parseArchive(raw(FRESH, { days: 'none' }))).toThrow('"days" must be a list');
    // A day missing from the middle, so the rest are out of place.
    expect(() =>
      parseArchive(withDays([...lines.slice(0, 3), ...lines.slice(4), lines[7]])),
    ).toThrow('The line for 2026-10-04');
    expect(() => parseArchive(withDays([42, ...lines.slice(1)]))).toThrow(
      'The line for 2026-10-01',
    );
    const [first] = lines;
    for (const broken of [
      first.replace(' v4 ', ' '),
      first.replace(' v4 ', ' v0 '),
      first.replace(/ \S+$/, ''),
      `${first} extra`,
    ]) {
      expect(() => parseArchive(withDays([broken, ...lines.slice(1)]))).toThrow(
        'must read "2026-10-01 v<version>" and four share codes',
      );
    }
    expect(() => parseArchive(withDays([first.replace(/ E/, ' AE'), ...lines.slice(1)]))).toThrow(
      'not a share code',
    );
  });

  it('refuses a day whose provenance is not its segment’s engine', () => {
    const lines = (raw(SWITCHED).days as string[]).map((line) => line.replace(' v4 ', ' v5 '));
    expect(() => parseArchive(raw(SWITCHED, { days: lines }))).toThrow(
      '2026-10-01 was frozen from version 5, but version 4 deals that date',
    );
  });
});

describe('reading an archive', () => {
  it('finds the segment that deals a date', () => {
    expect(segmentFor(SWITCHED, '2026-10-01')).toEqual({ version: 4, from: '2026-10-01' });
    expect(segmentFor(SWITCHED, '2026-10-08').version).toBe(4);
    expect(segmentFor(SWITCHED, '2026-10-09').version).toBe(5);
    expect(segmentFor(SWITCHED, '2031-01-01').version).toBe(5);
    expect(liveSegment(SWITCHED)).toEqual({ version: 5, from: '2026-10-09' });
  });

  it('knows the first day that is not frozen', () => {
    expect(firstUnfrozenDate(FRESH)).toBe('2026-10-01');
    expect(firstUnfrozenDate(SWITCHED)).toBe('2026-10-09');
  });

  it('hands back a frozen day’s codes by tier, and nothing for any other date', () => {
    const [easy, medium, hard, expert] = codes('2026-10-03');
    expect(frozenCodes(SWITCHED, '2026-10-03')).toEqual({ easy, medium, hard, expert });
    expect(frozenCodes(SWITCHED, '2026-10-09')).toBeNull();
    expect(frozenCodes(SWITCHED, '2026-09-30')).toBeNull();
    expect(frozenCodes(SWITCHED, 'yesterday')).toBeNull();
    expect(frozenCodes(FRESH, '2026-10-01')).toBeNull();
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
    expect(problem).toContain('stores every day from 2026-10-01 through the day after tomorrow');
    expect(problem).toContain(`2. then, with your change back in place, ${SWITCH_COMMAND}`);
    expect(problem).toContain('hands every later day to version 5');
    // And the same after a handover, from where the archive leaves off.
    expect(checkArchive(SWITCHED, 6)[0]).toContain('every day from 2026-10-09 through');
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
    const frozen = freezeDays(FRESH, newDays('2026-10-01', 3), 4);
    expect(checkArchive(frozen, 4)).toEqual([
      expect.stringContaining(
        `Days through 2026-10-03 are frozen, but version 4 still deals every day from 2026-10-01`,
      ),
    ]);
    expect(checkArchive(frozen, 4)[0]).toContain(SWITCH_COMMAND);
  });

  it('fails a new engine switched in without freezing the old one’s days, spelling out both commands', () => {
    const unfrozen: Archive = {
      ...FRESH,
      segments: [...FRESH.segments, { version: 5, from: '2026-10-06' }],
    };
    const [problem, ...rest] = checkArchive(unfrozen, 5);
    expect(rest).toEqual([]);
    expect(problem).toContain(
      'Version 5 takes over the dailies on 2026-10-06, but the archive is frozen on no day at all',
    );
    expect(problem).toContain('the days from 2026-10-01 to 2026-10-05 were dealt by version 4');
    expect(problem).toContain(FREEZE_COMMAND);
    expect(problem).toContain(SWITCH_COMMAND);
  });

  it('fails a new engine that leaves a gap after the frozen days', () => {
    const gap: Archive = {
      ...SWITCHED,
      segments: [SWITCHED.segments[0], { version: 5, from: '2026-10-12' }],
    };
    expect(checkArchive(gap, 5)[0]).toContain('frozen only through 2026-10-08');
    expect(checkArchive(gap, 5)[0]).toContain('the days from 2026-10-09 to 2026-10-11');
  });

  describe('at the exact edges', () => {
    it('fails a single day frozen without a switch', () => {
      expect(checkArchive(freezeDays(FRESH, newDays('2026-10-01', 1), 4), 4)).toEqual([
        expect.stringContaining('Days through 2026-10-01 are frozen'),
      ]);
    });

    it('fails a new engine starting one day after the day after the last frozen one', () => {
      // Frozen through the 8th: the 9th would be dealt by nobody.
      const gap: Archive = {
        ...SWITCHED,
        segments: [SWITCHED.segments[0], { version: 5, from: '2026-10-10' }],
      };
      expect(checkArchive(gap, 5)).toEqual([
        expect.stringContaining('the days from 2026-10-09 to 2026-10-09'),
      ]);
    });

    it('passes a new engine starting the very day after the last frozen one', () => {
      expect(SWITCHED.segments[1]).toEqual({ version: 5, from: '2026-10-09' });
      expect(checkArchive(SWITCHED, 5)).toEqual([]);
    });
  });
});

describe('checkAgainstRelease', () => {
  /** Noon UTC on a date: the next date has begun in UTC+14 (at 10:00 UTC), the one after not yet. */
  const middayUtc = (date: string) => Date.parse(`${date}T12:00:00Z`);

  it('passes anything while dailies have not been released', () => {
    const repointed: Archive = { ...FRESH, segments: [{ version: 7, from: '2026-10-01' }] };
    expect(checkAgainstRelease(null, repointed, middayUtc('2026-10-07'))).toEqual([]);
  });

  it('passes the released archive itself, however much later', () => {
    expect(checkAgainstRelease(SWITCHED, SWITCHED, middayUtc('2027-06-01'))).toEqual([]);
    expect(checkAgainstRelease(FRESH, FRESH, middayUtc('2027-06-01'))).toEqual([]);
  });

  it('passes a freeze and switch handing over days still ahead everywhere', () => {
    const now = middayUtc('2026-10-06');
    const plan = planFreeze(FRESH, 4, undefined, now);
    const frozen = freezeDays(FRESH, newDays(plan.from, plan.count), 4);
    const switched = switchEngine(frozen, 5, now);
    expect(liveSegment(switched).from).toBe('2026-10-09');
    expect(checkAgainstRelease(FRESH, switched, now)).toEqual([]);
    // Until the day before its first day has begun everywhere — then no longer.
    expect(checkAgainstRelease(FRESH, switched, Date.parse('2026-10-08T09:59:59Z'))).toEqual([]);
    const [stale] = checkAgainstRelease(FRESH, switched, Date.parse('2026-10-08T10:00:00Z'));
    expect(stale).toContain('Version 5 takes over the dailies on 2026-10-09');
    expect(stale).toContain('it is 2026-10-09 in UTC+14');
    expect(stale).toContain('the switch has gone stale');
    expect(stale).toContain(FREEZE_COMMAND);
  });

  it('fails a switch merged days after it was made', () => {
    const switched = switchEngine(
      freezeDays(FRESH, newDays('2026-10-01', 8), 4),
      5,
      middayUtc('2026-10-06'),
    );
    expect(checkAgainstRelease(FRESH, switched, middayUtc('2026-10-10'))).toEqual([
      expect.stringContaining('the switch has gone stale'),
    ]);
  });

  it('fails a live segment re-pointed by hand after its engine has dealt', () => {
    const repointed: Archive = { ...FRESH, segments: [{ version: 7, from: '2026-10-01' }] };
    const [problem, ...rest] = checkAgainstRelease(FRESH, repointed, middayUtc('2026-10-07'));
    expect(rest).toEqual([]);
    expect(problem).toContain('Version 4 has dealt the dailies from 2026-10-01');
    expect(problem).toContain('Put it back to version 4');
    expect(problem).toContain('stores every day from 2026-10-01');
  });

  it('passes a live segment re-pointed while its first day is still ahead everywhere', () => {
    // Switched in on the 6th to take over on the 9th, and replaced on the 7th.
    const replaced = switchEngine(SWITCHED, 6, middayUtc('2026-10-07'));
    expect(checkAgainstRelease(SWITCHED, replaced, middayUtc('2026-10-07'))).toEqual([]);
    expect(checkAgainstRelease(SWITCHED, replaced, middayUtc('2026-10-08'))).toEqual([
      expect.stringContaining('Version 5 has dealt the dailies from 2026-10-09'),
    ]);
  });

  it('fails an archive that drops or rewrites what the released one holds', () => {
    const rewritten = structuredClone(SWITCHED);
    rewritten.days[2].codes[0] = rewritten.days[3].codes[0];
    expect(checkAgainstRelease(SWITCHED, rewritten, middayUtc('2026-10-07'))).toEqual([
      expect.stringContaining('no longer holds everything the released one (on main) does'),
    ]);
    expect(checkAgainstRelease(SWITCHED, FRESH, middayUtc('2026-10-07'))).toHaveLength(1);
  });
});

describe('planFreeze', () => {
  it('freezes through the day after tomorrow by default, from the first unfrozen day', () => {
    expect(MAX_FREEZE_AHEAD).toBe(2);
    expect(planFreeze(FRESH, 4, undefined, noon('2026-10-06'))).toEqual({
      from: '2026-10-01',
      through: '2026-10-08',
      count: 8,
    });
  });

  it('freezes through an earlier date when asked', () => {
    expect(planFreeze(FRESH, 4, '2026-10-01', noon('2026-10-06'))).toEqual({
      from: '2026-10-01',
      through: '2026-10-01',
      count: 1,
    });
  });

  it('carries on from the last frozen day, and has nothing to do once it is past the date', () => {
    const frozen = freezeDays(FRESH, newDays('2026-10-01', 5), 4);
    expect(planFreeze(frozen, 4, undefined, noon('2026-10-06'))).toEqual({
      from: '2026-10-06',
      through: '2026-10-08',
      count: 3,
    });
    expect(planFreeze(frozen, 4, '2026-10-03', noon('2026-10-06')).count).toBe(0);
  });

  it('refuses to run once the engine has changed', () => {
    expect(() => planFreeze(FRESH, 5, undefined, noon('2026-10-06'))).toThrow(
      "GENERATOR_VERSION is 5, but the archive's live engine is version 4",
    );
  });

  it('refuses a date that is not one', () => {
    expect(() => planFreeze(FRESH, 4, '2026-10-32', noon('2026-10-06'))).toThrow(
      '--through must be a real date',
    );
  });

  it('refuses to store days further ahead than the day after tomorrow', () => {
    expect(() => planFreeze(FRESH, 4, '2026-10-09', noon('2026-10-06'))).toThrow(
      'Refusing to freeze through 2026-10-09',
    );
  });
});

describe('freezeDays', () => {
  it('adds the days to the end, stamped with the engine that dealt them', () => {
    const once = freezeDays(FRESH, newDays('2026-10-01', 2), 4);
    expect(once.frozenThrough).toBe('2026-10-02');
    expect(once.days).toEqual([
      { date: '2026-10-01', version: 4, codes: codes('2026-10-01') },
      { date: '2026-10-02', version: 4, codes: codes('2026-10-02') },
    ]);
    const twice = freezeDays(once, newDays('2026-10-03', 1), 4);
    expect(twice.days.map((day) => day.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(isExtensionOf(once, twice)).toBe(true);
  });

  it('freezes a later engine’s days after its segment has begun', () => {
    const more = freezeDays(SWITCHED, newDays('2026-10-09', 2), 5);
    expect(more.days.slice(-2).map((day) => day.version)).toEqual([5, 5]);
    expect(parseArchive(JSON.parse(serialiseArchive(more)))).toEqual(more);
  });

  it('never changes the archive it is given', () => {
    const before = structuredClone(FRESH);
    freezeDays(FRESH, newDays('2026-10-01', 2), 4);
    expect(FRESH).toEqual(before);
  });

  it('hands back the same archive when there is nothing to freeze', () => {
    expect(freezeDays(FRESH, [], 4)).toBe(FRESH);
  });

  it('refuses days that would rewrite, skip or reorder frozen ones', () => {
    const frozen = freezeDays(FRESH, newDays('2026-10-01', 2), 4);
    expect(() => freezeDays(frozen, newDays('2026-10-02', 1), 4)).toThrow(
      'Refusing to freeze 2026-10-02: the next day to freeze is 2026-10-03',
    );
    expect(() => freezeDays(frozen, newDays('2026-10-04', 1), 4)).toThrow('2026-10-03');
    const [a, b] = newDays('2026-10-03', 2);
    expect(() => freezeDays(frozen, [b, a], 4)).toThrow('Refusing to freeze 2026-10-04');
  });

  it('refuses days dealt by any engine but the live one', () => {
    expect(() => freezeDays(FRESH, newDays('2026-10-01', 1), 5)).toThrow(
      'Refusing to freeze days dealt by version 5',
    );
  });

  it('refuses a day without four share codes', () => {
    const [day] = newDays('2026-10-01', 1);
    expect(() => freezeDays(FRESH, [{ ...day, codes: day.codes.slice(1) }], 4)).toThrow(
      '2026-10-01 must hold 4 share codes',
    );
    expect(() => freezeDays(FRESH, [{ ...day, codes: [...day.codes.slice(1), 'A0'] }], 4)).toThrow(
      'share codes',
    );
  });
});

describe('switchEngine', () => {
  const frozen = freezeDays(FRESH, newDays('2026-10-01', 8), 4);

  it('starts the new engine the day after the last frozen day', () => {
    expect(switchEngine(frozen, 5, noon('2026-10-06')).segments).toEqual([
      { version: 4, from: '2026-10-01' },
      { version: 5, from: '2026-10-09' },
    ]);
    expect(isExtensionOf(frozen, SWITCHED)).toBe(true);
  });

  it('refuses until GENERATOR_VERSION has been bumped', () => {
    expect(() => switchEngine(frozen, 4, noon('2026-10-06'))).toThrow(
      'GENERATOR_VERSION is 4, and the live engine is already version 4',
    );
  });

  it('replaces a live engine that has not dealt a day yet, from the same day', () => {
    // Switched in on the 6th to take over on the 9th, and replaced before then.
    const replaced = switchEngine(SWITCHED, 6, noon('2026-10-07'));
    expect(replaced.segments).toEqual([
      { version: 4, from: '2026-10-01' },
      { version: 6, from: '2026-10-09' },
    ]);
    expect(replaced.days).toBe(SWITCHED.days);
    expect(checkArchive(replaced, 6)).toEqual([]);
    expect(isExtensionOf(SWITCHED, replaced)).toBe(true);
  });

  it('re-points the one segment to any engine before dailies are released, whatever the date', () => {
    const repointed = switchEngine(FRESH, 7, noon('2026-10-07'), false);
    expect(repointed).toEqual({ ...FRESH, segments: [{ version: 7, from: '2026-10-01' }] });
    expect(checkArchive(repointed, 7)).toEqual([]);
    expect(isExtensionOf(FRESH, repointed)).toBe(true);
    // Released, the same switch would deal a week of dailies again.
    expect(() => switchEngine(FRESH, 7, noon('2026-10-07'))).toThrow('are frozen yet');
  });

  it('refuses while none of the live engine’s days are frozen, spelling out both commands', () => {
    // Version 5's first day, the 9th, has begun in UTC+14 by noon UTC on the 8th.
    for (const archive of [FRESH, SWITCHED]) {
      const attempt = () => switchEngine(archive, 6, Date.UTC(2026, 9, 8, 12));
      expect(attempt).toThrow('are frozen yet, so switching would deal them all again');
      expect(attempt).toThrow(FREEZE_COMMAND);
    }
  });

  it('refuses to hand over a day that has already begun somewhere', () => {
    const short = freezeDays(FRESH, newDays('2026-10-01', 5), 4);
    // Noon UTC on the 5th is 02:00 on the 6th in UTC+14.
    expect(() => switchEngine(short, 5, Date.UTC(2026, 9, 5, 12))).toThrow(
      'The archive is frozen only through 2026-10-05, but 2026-10-06 has already begun',
    );
    // 2026-10-06 begins in UTC+14 at 10:00 UTC on the 5th.
    expect(() => switchEngine(short, 5, Date.UTC(2026, 9, 5, 9, 59))).not.toThrow();
    expect(() => switchEngine(short, 5, Date.UTC(2026, 9, 5, 10, 0))).toThrow('already begun');
  });

  it('never changes the archive it is given', () => {
    const before = structuredClone(frozen);
    switchEngine(frozen, 5, noon('2026-10-06'));
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
      segments: [SWITCHED.segments[0], { version: 5, from: '2026-10-10' }],
    };
    expect(isExtensionOf(SWITCHED, moved)).toBe(false);
    const older = {
      ...SWITCHED,
      segments: [SWITCHED.segments[0], { version: 3, from: '2026-10-09' }],
    };
    expect(isExtensionOf(SWITCHED, older)).toBe(false);
    const earlier = {
      ...SWITCHED,
      segments: [{ version: 5, from: '2026-10-01' }, SWITCHED.segments[1]],
    };
    expect(isExtensionOf(SWITCHED, earlier)).toBe(false);
    expect(isExtensionOf(SWITCHED, { ...SWITCHED, epoch: '2026-10-02' })).toBe(false);
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
      freezeDays(FRESH, newDays('2026-10-01', 1), 4),
      freezeDays(FRESH, newDays('2026-10-01', 3), 4),
      SWITCHED,
      switchEngine(freezeDays(SWITCHED, newDays('2026-10-09', 2), 5), 6, noon('2026-10-06')),
    ];
    for (const archive of shapes) {
      const text = serialiseArchive(archive);
      expect(await prettier(text)).toBe(text);
    }
  });

  it('turns a freeze into a diff of added lines, plus a comma on the line before them', () => {
    const before = serialiseArchive(freezeDays(FRESH, newDays('2026-10-01', 2), 4)).split('\n');
    const after = serialiseArchive(freezeDays(FRESH, newDays('2026-10-01', 4), 4)).split('\n');
    const changed = before.filter((line) => !after.includes(line));
    // The frozenThrough line, and the old last day, which gains a comma.
    expect(changed).toEqual([
      '  "frozenThrough": "2026-10-02",',
      `    "2026-10-02 v4 ${codes('2026-10-02').join(' ')}"`,
    ]);
    expect(after).toHaveLength(before.length + 2);
  });
});
