import { useEffect, useRef, useState } from 'react';
import { elapsedMs, isRunning, type Clock } from '../core';

/*
 * The timer's display, read from the clock rather than counted in ticks.
 *
 * Background tabs have their timers throttled — to roughly once a minute in
 * Chrome, and stopped altogether while a phone is locked — so a display that
 * counted ticks would fall behind the game. Instead every tick reads the
 * clock, aims the next one at the next whole second, and a tab coming back
 * into view reads it at once. The time a game is recorded with comes from the
 * clock itself, at the moment of the solve; this is only what is shown.
 */

/** The last reading shown, and what it was taken against. */
interface Reading {
  resetKey: unknown;
  clock: Clock;
  ms: number;
}

/**
 * Whether `next` carries on timing the same run as `prev`: the same clock, a
 * pause (the running segment banked) or a resume (a new segment from the same
 * banked total). Anything else — the banked total dropping, a segment
 * restarting from a different moment — is a reset or a different game's
 * clock, after which the old reading means nothing.
 */
function continues(prev: Clock, next: Clock): boolean {
  if (prev.runningSince !== null && next.runningSince === null) {
    return next.bankedMs >= prev.bankedMs;
  }
  if (prev.runningSince === null && next.runningSince !== null) {
    return next.bankedMs === prev.bankedMs;
  }
  return next.bankedMs === prev.bankedMs && next.runningSince === prev.runningSince;
}

/** A clock that has never run, or has been reset: nothing to show but 0:00. */
function isZero(clock: Clock): boolean {
  return clock.bankedMs === 0 && clock.runningSince === null;
}

/**
 * The elapsed time to display for `clock`, in milliseconds, kept up to date
 * while it runs.
 *
 * While the clock runs, a tick reads it and re-aims at the next whole second
 * (so the display re-syncs with the clock instead of drifting), and
 * `visibilitychange` reads it at once. While it is paused there are no timers
 * at all: the paused reading is the banked total.
 *
 * The display never goes down within a run. `now` is wall-clock time and can
 * move backwards — an NTP correction, a corrected RTC on wake, someone setting
 * the clock back — and the clock helpers only stop that going negative; a
 * display that dropped from 6:00 to 1:00 mid-game would look like a bug, so
 * the highest reading stands until the clock catches up with it. It starts
 * again from the clock when `resetKey` changes (pass the game's id), when the
 * clock is reset to zero, or when the clock is replaced by one that does not
 * carry on from it (a reset that starts running at once, say).
 *
 * The caller should take a recorded time from the clock, and may take the
 * larger of that and this display, as minesweeper does, so that a backwards
 * clock cannot bank a time lower than the one the player watched.
 *
 * @param now Injected for tests; read through a ref, so a new function each
 *   render does not restart the ticking.
 */
export function useElapsed(clock: Clock, resetKey: unknown, now: () => number = Date.now): number {
  // Held in a ref so an inline `now` does not re-run the effect each render;
  // written in an effect, as a ref written while rendering is unsafe once a
  // render can be thrown away.
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  });

  const [reading, setReading] = useState<Reading>(() => ({
    resetKey,
    clock,
    ms: elapsedMs(clock, now()),
  }));

  // A new clock or game is taken in while rendering rather than in an effect,
  // so the very render that receives it already shows the right time — the
  // pattern React documents for adjusting state when a prop changes. The
  // guard makes the extra render this triggers a no-op.
  let current = reading;
  if (reading.resetKey !== resetKey || reading.clock !== clock) {
    const carriesOn =
      reading.resetKey === resetKey && !isZero(clock) && continues(reading.clock, clock);
    current = {
      resetKey,
      clock,
      ms: carriesOn ? Math.max(reading.ms, clock.bankedMs) : clock.bankedMs,
    };
    setReading(current);
  }

  useEffect(() => {
    if (!isRunning(clock)) return undefined;

    let id = 0;
    const tick = (): void => {
      const ms = elapsedMs(clock, nowRef.current());
      // Never below what was already shown — see above. A reading for a clock
      // that has since been replaced is dropped: the render that replaced it
      // has already started the new run.
      setReading((shown) =>
        shown.clock !== clock || shown.resetKey !== resetKey || ms <= shown.ms
          ? shown
          : { ...shown, ms },
      );
      // Aim at the next whole second rather than adding a flat 1000ms, so the
      // display re-syncs with the clock instead of accumulating drift.
      id = window.setTimeout(tick, 1000 - (ms % 1000));
    };
    tick();

    // Returning to a throttled tab should correct the display at once, rather
    // than whenever the pending timeout happens to come due.
    const resync = (): void => {
      window.clearTimeout(id);
      tick();
    };
    document.addEventListener('visibilitychange', resync);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener('visibilitychange', resync);
    };
  }, [clock, resetKey]);

  return current.ms;
}
