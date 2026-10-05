/*
 * Game timing by the wall clock rather than by counting interval ticks.
 *
 * Background tabs have their timers throttled (to roughly once a minute in
 * Chrome, and stopped altogether while a phone is locked), so a counter of
 * ticks undercounts. Instead a clock is the time already banked plus the start
 * of the segment currently running, and every reading is taken from `now`.
 * Pausing banks the running segment; resuming opens a new one. Because the
 * banked total is a plain number it survives a reload as well as a pause.
 *
 * `now` is wall-clock time and can move backwards — an NTP correction, an RTC
 * corrected on wake, someone setting the clock back — so a segment never
 * counts for less than nothing. Every helper is pure and takes `now` from the
 * caller, which keeps the engine free of `Date` and makes the tests exact.
 */

/** Wall-clock timing that survives pauses and reloads: banked time plus the segment currently running. */
export interface Clock {
  /** Milliseconds banked by segments that have already been paused. */
  bankedMs: number;
  /** When the running segment began (epoch ms), or null while paused. */
  runningSince: number | null;
}

/**
 * A clock that has never run. Frozen (and typed read-only, so a write is a
 * compile error rather than a runtime TypeError) because it is shared:
 * `pauseClock` hands back the very same object, so it can end up held in UI
 * state, and a stray mutation there would otherwise change every new game's
 * starting time.
 */
export const STOPPED_CLOCK: Readonly<Clock> = Object.freeze({ bankedMs: 0, runningSince: null });

/** The running segment's length, never negative even if the clock went backwards. */
function segmentMs(clock: Clock, now: number): number {
  return clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince);
}

/** Whether the clock is running. */
export function isRunning(clock: Clock): boolean {
  return clock.runningSince !== null;
}

/** Start (or resume) the clock. Returns the same object if it is already running. */
export function startClock(clock: Clock, now: number): Clock {
  if (isRunning(clock)) return clock;
  return { bankedMs: clock.bankedMs, runningSince: now };
}

/** Pause the clock, banking the running segment. Returns the same object if it is already paused. */
export function pauseClock(clock: Clock, now: number): Clock {
  if (!isRunning(clock)) return clock;
  return { bankedMs: clock.bankedMs + segmentMs(clock, now), runningSince: null };
}

/** Milliseconds on the clock at `now`: banked time plus the running segment. */
export function elapsedMs(clock: Clock, now: number): number {
  return clock.bankedMs + segmentMs(clock, now);
}

/**
 * Whole seconds, floored — the unit times are compared and shared in.
 *
 * Anything that is not a finite, positive duration counts as zero: NaN from a
 * bad subtraction or Infinity from a corrupt record must never surface as a
 * time, let alone as a best one.
 */
export function toSeconds(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

/**
 * A duration as `m:ss` below an hour and `h:mm:ss` from an hour on, floored to
 * whole seconds like every time the game shows (59.999s is still 0:59).
 * Negative, NaN and infinite durations read as 0:00 — see `toSeconds`.
 */
export function formatDuration(ms: number): string {
  const total = toSeconds(ms);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = String(total % 60).padStart(2, '0');
  if (hours === 0) return `${minutes}:${seconds}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
}
