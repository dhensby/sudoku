import {
  DAILY_EPOCH,
  addDays,
  addMonths,
  dailyNumber,
  dateKeyOf,
  dateOfDaily,
  daysBetween,
  daysInMonth,
  isDateKey,
  isMonthKey,
  earliestDateAnywhere,
  latestDateAnywhere,
  localDateOf,
  monthGrid,
  monthOf,
  weekdayOf,
} from './dates';

const HOUR = 3_600_000;

/**
 * Run a block's tests in a time zone of its own. Node picks up a change to
 * `process.env.TZ` straight away, so this pins the zone whatever the machine
 * running the tests is set to (a laptop in London, a CI runner in UTC).
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

describe('isDateKey', () => {
  it('accepts real dates written as YYYY-MM-DD', () => {
    for (const key of ['2026-10-06', '2028-02-29', '2026-12-31', '0099-01-01', '9999-12-31']) {
      expect(isDateKey(key)).toBe(true);
    }
  });

  it('refuses dates that do not exist', () => {
    for (const key of ['2027-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00']) {
      expect(isDateKey(key)).toBe(false);
    }
  });

  it('refuses anything not written exactly as YYYY-MM-DD', () => {
    for (const value of ['2026-10-6', '26-10-06', '2026/10/06', ' 2026-10-06', '2026-10-06T00']) {
      expect(isDateKey(value)).toBe(false);
    }
    expect(isDateKey(20261006)).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });
});

describe('isMonthKey', () => {
  it('accepts real months written as YYYY-MM', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    expect(isMonthKey('2027-01')).toBe(true);
  });

  it('refuses months that do not exist and anything else', () => {
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-10-01')).toBe(false);
    expect(isMonthKey(202610)).toBe(false);
  });
});

describe('dateKeyOf in Europe/London', () => {
  inTimeZone('Europe/London');

  it('reads the date from the local clock, not from UTC', () => {
    // 23:30 UTC on 6 October is already 00:30 on the 7th in British Summer Time.
    expect(dateKeyOf(Date.UTC(2026, 9, 6, 23, 30))).toBe('2026-10-07');
    expect(dateKeyOf(Date.UTC(2026, 9, 6, 22, 59))).toBe('2026-10-06');
  });

  it('turns over at local midnight either side of the clocks going forward', () => {
    // 29 March 2026: 01:00 GMT becomes 02:00 BST, so that day has 23 hours.
    expect(dateKeyOf(Date.UTC(2026, 2, 28, 23, 59))).toBe('2026-03-28');
    expect(dateKeyOf(Date.UTC(2026, 2, 29, 0, 0))).toBe('2026-03-29');
    expect(dateKeyOf(Date.UTC(2026, 2, 29, 22, 59))).toBe('2026-03-29');
    expect(dateKeyOf(Date.UTC(2026, 2, 29, 23, 0))).toBe('2026-03-30');
  });

  it('turns over at local midnight either side of the clocks going back', () => {
    // 25 October 2026: 02:00 BST becomes 01:00 GMT, so that day has 25 hours.
    expect(dateKeyOf(Date.UTC(2026, 9, 24, 22, 59))).toBe('2026-10-24');
    expect(dateKeyOf(Date.UTC(2026, 9, 24, 23, 0))).toBe('2026-10-25');
    expect(dateKeyOf(Date.UTC(2026, 9, 25, 23, 59))).toBe('2026-10-25');
    expect(dateKeyOf(Date.UTC(2026, 9, 26, 0, 0))).toBe('2026-10-26');
  });

  it('shows why a day is never added as 24 hours of milliseconds', () => {
    const midnight = new Date(2026, 9, 25).getTime();
    // The 25-hour day: 24 hours on from its midnight is still the same date…
    expect(dateKeyOf(midnight + 24 * HOUR)).toBe('2026-10-25');
    // …where moving the calendar date gets the next day.
    expect(addDays(dateKeyOf(midnight), 1)).toBe('2026-10-26');
    // And the 23-hour day: 24 hours on skips past the next midnight entirely.
    const spring = new Date(2026, 2, 29).getTime();
    expect(dateKeyOf(spring + 47 * HOUR)).toBe('2026-03-31');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('dateKeyOf in America/New_York', () => {
  inTimeZone('America/New_York');

  it('turns over at local midnight either side of the clocks going forward', () => {
    // 8 March 2026: 02:00 EST becomes 03:00 EDT. Midnight is 05:00 UTC before, 04:00 after.
    expect(dateKeyOf(Date.UTC(2026, 2, 8, 4, 59))).toBe('2026-03-07');
    expect(dateKeyOf(Date.UTC(2026, 2, 8, 5, 0))).toBe('2026-03-08');
    expect(dateKeyOf(Date.UTC(2026, 2, 9, 3, 59))).toBe('2026-03-08');
    expect(dateKeyOf(Date.UTC(2026, 2, 9, 4, 0))).toBe('2026-03-09');
  });

  it('turns over at local midnight either side of the clocks going back', () => {
    // 1 November 2026: 02:00 EDT becomes 01:00 EST.
    expect(dateKeyOf(Date.UTC(2026, 10, 1, 3, 59))).toBe('2026-10-31');
    expect(dateKeyOf(Date.UTC(2026, 10, 1, 4, 0))).toBe('2026-11-01');
    expect(dateKeyOf(Date.UTC(2026, 10, 2, 4, 59))).toBe('2026-11-01');
    expect(dateKeyOf(Date.UTC(2026, 10, 2, 5, 0))).toBe('2026-11-02');
  });

  it('does date arithmetic the same as anywhere else', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });
});

describe('earliestDateAnywhere', () => {
  it('is the date in UTC−12, which turns over twelve hours after UTC midnight', () => {
    expect(earliestDateAnywhere(Date.UTC(2026, 9, 6, 11, 59))).toBe('2026-10-05');
    expect(earliestDateAnywhere(Date.UTC(2026, 9, 6, 12, 0))).toBe('2026-10-06');
    expect(earliestDateAnywhere(Date.UTC(2027, 0, 1, 11, 0))).toBe('2026-12-31');
  });

  describe.each(['Pacific/Kiritimati', 'Europe/London', 'Pacific/Pago_Pago'])(
    'seen from %s',
    (zone) => {
      inTimeZone(zone);

      it('never comes after the local date, nor more than two days before it', () => {
        for (let hour = 0; hour < 48; hour++) {
          const moment = Date.UTC(2026, 9, 6, hour, 30);
          const local = dateKeyOf(moment);
          const earliest = earliestDateAnywhere(moment);
          expect(daysBetween(earliest, local)).toBeGreaterThanOrEqual(0);
          expect(daysBetween(earliest, local)).toBeLessThanOrEqual(2);
          expect(daysBetween(local, latestDateAnywhere(moment))).toBeGreaterThanOrEqual(0);
        }
      });
    },
  );
});

describe('latestDateAnywhere', () => {
  it('is the date in UTC+14, which turns over ten hours before UTC midnight', () => {
    expect(latestDateAnywhere(Date.UTC(2026, 9, 6, 9, 59))).toBe('2026-10-06');
    expect(latestDateAnywhere(Date.UTC(2026, 9, 6, 10, 0))).toBe('2026-10-07');
    expect(latestDateAnywhere(Date.UTC(2026, 11, 31, 10, 0))).toBe('2027-01-01');
  });

  describe('seen from London', () => {
    inTimeZone('Europe/London');

    it('is the local date in the morning and the next one from late morning', () => {
      // 08:00 BST is 07:00 UTC, 21:00 in UTC+14; 12:00 BST is 02:00 the next day there.
      expect(latestDateAnywhere(new Date(2026, 9, 6, 8).getTime())).toBe('2026-10-06');
      expect(latestDateAnywhere(new Date(2026, 9, 6, 12).getTime())).toBe('2026-10-07');
    });
  });

  describe('seen from the far side of the Pacific', () => {
    inTimeZone('Pacific/Pago_Pago');

    it('runs up to two days ahead of the local date', () => {
      // Samoa (American) is UTC−11, 25 hours behind Kiribati.
      const lateEvening = new Date(2026, 9, 6, 23, 30).getTime();
      expect(dateKeyOf(lateEvening)).toBe('2026-10-06');
      expect(latestDateAnywhere(lateEvening)).toBe('2026-10-08');
    });
  });
});

describe('localDateOf', () => {
  it('is noon on the date by the local clock, ready for Intl to format', () => {
    const date = localDateOf('2026-10-06');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([
      2026, 9, 6, 12,
    ]);
  });

  describe('in a zone whose clocks skip midnight', () => {
    inTimeZone('America/Sao_Paulo');

    it('still lands on the date', () => {
      // Brazil's summer time began at midnight on 4 November 2018: 00:00 became 01:00.
      expect(new Date(2018, 10, 4).getHours()).toBe(1);
      const date = localDateOf('2018-11-04');
      expect([date.getDate(), date.getHours()]).toEqual([4, 12]);
      expect(dateKeyOf(date.getTime())).toBe('2018-11-04');
    });
  });
});

describe('addDays', () => {
  it('moves forward and back across months, years and leap days', () => {
    expect(addDays('2026-10-06', 0)).toBe('2026-10-06');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-10-01', 365 + 365 + 366 + 365)).toBe('2030-10-01');
  });

  it('keeps years below 100 as written', () => {
    expect(addDays('0099-12-31', 1)).toBe('0100-01-01');
  });
});

describe('daysBetween', () => {
  it('counts calendar days, negative when the second date comes first', () => {
    expect(daysBetween('2026-10-06', '2026-10-06')).toBe(0);
    expect(daysBetween('2026-10-06', '2026-10-07')).toBe(1);
    expect(daysBetween('2026-10-07', '2026-10-06')).toBe(-1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
  });

  describe('across the clocks changing', () => {
    inTimeZone('Europe/London');

    it('counts each calendar day once, whatever its length', () => {
      expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
      expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
      expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    });
  });
});

describe('weekdayOf', () => {
  it('counts from Monday (0) to Sunday (6)', () => {
    expect(weekdayOf('2026-10-05')).toBe(0);
    expect(weekdayOf('2026-10-06')).toBe(1);
    expect(weekdayOf('2026-10-01')).toBe(3);
    expect(weekdayOf('2026-10-11')).toBe(6);
  });
});

describe('dailyNumber and dateOfDaily', () => {
  it('numbers the dailies from 1 on the epoch', () => {
    expect(DAILY_EPOCH).toBe('2026-10-01');
    expect(dailyNumber('2026-10-01')).toBe(1);
    expect(dailyNumber('2026-10-06')).toBe(6);
    expect(dailyNumber('2027-10-01')).toBe(366);
    expect(dailyNumber('2026-09-30')).toBe(0);
  });

  it('turns a daily number back into its date', () => {
    expect(dateOfDaily(1)).toBe('2026-10-01');
    expect(dateOfDaily(6)).toBe('2026-10-06');
    for (const key of ['2026-10-01', '2027-03-28', '2028-02-29', '2030-12-31']) {
      expect(dateOfDaily(dailyNumber(key))).toBe(key);
    }
  });
});

describe('months', () => {
  it('finds the month a date falls in', () => {
    expect(monthOf('2026-10-06')).toBe('2026-10');
  });

  it('moves by whole months across years', () => {
    expect(addMonths('2026-10', 0)).toBe('2026-10');
    expect(addMonths('2026-10', 1)).toBe('2026-11');
    expect(addMonths('2026-10', 3)).toBe('2027-01');
    expect(addMonths('2026-10', -10)).toBe('2025-12');
  });

  it('knows how long each month is', () => {
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2026-11')).toBe(30);
    expect(daysInMonth('2027-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
  });
});

describe('monthGrid', () => {
  /** The grid as week rows of day numbers, with days outside the month in brackets. */
  function sketch(month: string): string[] {
    return monthGrid(month).map((week) =>
      week
        .map(({ date, inMonth }) => {
          const day = String(Number(date.slice(8)));
          return inMonth ? day : `(${day})`;
        })
        .join(' '),
    );
  }

  it('lays a month out in Monday-first weeks, filled out from the months either side', () => {
    // 1 October 2026 is a Thursday, and the 31st a Saturday.
    expect(sketch('2026-10')).toEqual([
      '(28) (29) (30) 1 2 3 4',
      '5 6 7 8 9 10 11',
      '12 13 14 15 16 17 18',
      '19 20 21 22 23 24 25',
      '26 27 28 29 30 31 (1)',
    ]);
    expect(monthGrid('2026-10')[0][0].date).toBe('2026-09-28');
    expect(monthGrid('2026-10')[4][6].date).toBe('2026-11-01');
  });

  it('takes four weeks for a February that starts on a Monday', () => {
    const grid = monthGrid('2027-02');
    expect(grid).toHaveLength(4);
    expect(grid.flat().every((day) => day.inMonth)).toBe(true);
  });

  it('takes six weeks for a long month that starts late in the week', () => {
    // 1 August 2026 is a Saturday and the 31st a Monday.
    const grid = monthGrid('2026-08');
    expect(grid).toHaveLength(6);
    expect(grid[5].map((day) => day.inMonth)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  describe('across the clocks changing', () => {
    inTimeZone('Europe/London');

    it('holds every date once, in order, seven to a week', () => {
      for (const month of ['2026-03', '2026-10']) {
        const days = monthGrid(month).flat();
        days.forEach((day, i) => {
          if (i > 0) expect(daysBetween(days[i - 1].date, day.date)).toBe(1);
          if (i % 7 === 0) expect(weekdayOf(day.date)).toBe(0);
        });
        expect(days.filter((day) => day.inMonth)).toHaveLength(31);
      }
    });
  });
});
