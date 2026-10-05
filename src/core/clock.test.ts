import {
  STOPPED_CLOCK,
  elapsedMs,
  formatDuration,
  isRunning,
  pauseClock,
  startClock,
  toSeconds,
  type Clock,
} from './clock';

describe('STOPPED_CLOCK', () => {
  it('has nothing banked and is not running', () => {
    expect(STOPPED_CLOCK).toEqual({ bankedMs: 0, runningSince: null });
    expect(isRunning(STOPPED_CLOCK)).toBe(false);
    expect(elapsedMs(STOPPED_CLOCK, 123_456)).toBe(0);
  });

  it('is frozen, so a stray mutation of shared UI state cannot change it', () => {
    expect(Object.isFrozen(STOPPED_CLOCK)).toBe(true);
  });
});

describe('startClock', () => {
  it('opens a segment at now without touching what is banked', () => {
    const clock = startClock({ bankedMs: 5000, runningSince: null }, 1000);
    expect(clock).toEqual({ bankedMs: 5000, runningSince: 1000 });
    expect(isRunning(clock)).toBe(true);
  });

  it('does not copy or alter the stopped clock', () => {
    const clock = startClock(STOPPED_CLOCK, 1000);
    expect(clock).not.toBe(STOPPED_CLOCK);
    expect(STOPPED_CLOCK.runningSince).toBeNull();
  });

  it('returns the same object when already running, keeping the original start', () => {
    // A second start must not restart the segment, or a double click on
    // Resume would throw away the time since the first.
    const running = startClock(STOPPED_CLOCK, 1000);
    expect(startClock(running, 9000)).toBe(running);
  });
});

describe('pauseClock', () => {
  it('banks the running segment and stops', () => {
    const clock = pauseClock({ bankedMs: 2000, runningSince: 1000 }, 4500);
    expect(clock).toEqual({ bankedMs: 5500, runningSince: null });
    expect(isRunning(clock)).toBe(false);
  });

  it('returns the same object when already paused', () => {
    const paused: Clock = { bankedMs: 2000, runningSince: null };
    expect(pauseClock(paused, 9000)).toBe(paused);
    expect(pauseClock(STOPPED_CLOCK, 9000)).toBe(STOPPED_CLOCK);
  });

  it('banks nothing for a segment the clock ran backwards through', () => {
    // The wall clock was set back an hour mid-game: the segment counts as
    // zero rather than eating into the time already banked.
    const clock = pauseClock({ bankedMs: 2000, runningSince: 10_000 }, 10_000 - 3_600_000);
    expect(clock).toEqual({ bankedMs: 2000, runningSince: null });
  });
});

describe('elapsedMs', () => {
  it('adds the running segment to the banked time', () => {
    expect(elapsedMs({ bankedMs: 2000, runningSince: 1000 }, 1750)).toBe(2750);
  });

  it('reads just the banked time while paused, whatever now is', () => {
    expect(elapsedMs({ bankedMs: 2000, runningSince: null }, 99_999)).toBe(2000);
  });

  it('never goes below the banked time when the clock goes backwards', () => {
    expect(elapsedMs({ bankedMs: 2000, runningSince: 5000 }, 1000)).toBe(2000);
    expect(elapsedMs({ bankedMs: 0, runningSince: 5000 }, 1000)).toBe(0);
  });

  it('accumulates across pauses and resumes', () => {
    let clock = startClock(STOPPED_CLOCK, 0);
    clock = pauseClock(clock, 1500); // 1.5s
    clock = startClock(clock, 60_000); // a long break that must not count
    clock = pauseClock(clock, 62_000); // +2s
    clock = startClock(clock, 100_000);
    expect(elapsedMs(clock, 100_250)).toBe(3750);
  });
});

describe('toSeconds', () => {
  it.each([
    [0, 0],
    [999, 0],
    [1000, 1],
    [59_999, 59],
    [61_500, 61],
  ])('floors %d ms to %d s', (ms, seconds) => {
    expect(toSeconds(ms)).toBe(seconds);
  });

  it.each([
    ['negative', -1500],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('reads a %s duration as zero', (_label, ms) => {
    expect(toSeconds(ms)).toBe(0);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1000, '0:01'],
    [59_999, '0:59'], // floored, never rounded up to 1:00
    [60_000, '1:00'],
    [323_000, '5:23'],
    [599_000, '9:59'],
    [600_000, '10:00'],
    [3_599_000, '59:59'],
    [3_599_999, '59:59'],
    [3_600_000, '1:00:00'],
    [3_661_000, '1:01:01'],
    [36_000_000, '10:00:00'],
    [360_000_000, '100:00:00'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it.each([
    ['negative', -5000],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('shows a %s duration as 0:00', (_label, ms) => {
    expect(formatDuration(ms)).toBe('0:00');
  });
});
