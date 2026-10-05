import { act, renderHook } from '@testing-library/react';
import { STOPPED_CLOCK, pauseClock, startClock, type Clock } from '../core';
import { useElapsed } from './useElapsed';

const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);

interface Props {
  clock: Clock;
  resetKey: unknown;
  now?: () => number;
}

function setup(clock: Clock, resetKey: unknown = 'game-1') {
  return renderHook(({ clock, resetKey, now }: Props) => useElapsed(clock, resetKey, now), {
    initialProps: { clock, resetKey } as Props,
  });
}

/** Let time pass with the timers running, as a foreground tab would. */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Let time pass with no timer firing — a throttled background tab — then come back to it. */
function returnAfter(ms: number): void {
  act(() => {
    vi.setSystemTime(Date.now() + ms);
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useElapsed while paused', () => {
  it('shows the banked time and sets no timers', () => {
    const { result } = setup({ bankedMs: 65_000, runningSince: null });
    expect(result.current).toBe(65_000);
    expect(vi.getTimerCount()).toBe(0);
    advance(10_000);
    expect(result.current).toBe(65_000);
  });

  it('shows zero for a clock that has never run', () => {
    const { result } = setup(STOPPED_CLOCK);
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useElapsed while running', () => {
  it('reads the clock on every whole second', () => {
    const { result } = setup(startClock(STOPPED_CLOCK, T0));
    expect(result.current).toBe(0);
    advance(1000);
    expect(result.current).toBe(1000);
    advance(2500);
    expect(result.current).toBe(3000);
  });

  it('counts on from the banked time of a resumed game', () => {
    const { result } = setup({ bankedMs: 90_000, runningSince: T0 });
    expect(result.current).toBe(90_000);
    advance(1000);
    expect(result.current).toBe(91_000);
  });

  it('aims each tick at the next whole second rather than a flat second on', () => {
    // 1.4s banked: the display should tick over to 2s 600ms from now, when the
    // shown time changes, not 1000ms from now.
    const { result } = setup({ bankedMs: 1400, runningSince: T0 });
    expect(result.current).toBe(1400);
    advance(599);
    expect(result.current).toBe(1400);
    advance(1);
    expect(result.current).toBe(2000);
  });

  it('reads the clock rather than counting ticks, so a throttled tab catches up at once', () => {
    const { result } = setup(startClock(STOPPED_CLOCK, T0));
    // A minute in a background tab, in which the throttled timer never fires.
    returnAfter(60_000);
    expect(result.current).toBe(60_000);
  });

  it('re-aims at the next whole second after catching up', () => {
    const { result } = setup(startClock(STOPPED_CLOCK, T0));
    returnAfter(1400);
    expect(result.current).toBe(1400);
    advance(600);
    expect(result.current).toBe(2000);
  });

  it('never strands a tick when the tab is switched repeatedly', () => {
    setup(startClock(STOPPED_CLOCK, T0));
    for (let i = 0; i < 3; i++) returnAfter(300);
    // A resync that left the previous timeout pending would leave two clocks
    // ticking side by side.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('reads the injected time source', () => {
    const now = vi.fn(() => T0 + 4500);
    const { result } = renderHook(() =>
      useElapsed({ bankedMs: 0, runningSince: T0 + 1000 }, 'game-1', now),
    );
    expect(result.current).toBe(3500);
    expect(now).toHaveBeenCalled();
  });

  it('keeps ticking undisturbed when handed a new time source each render', () => {
    // An inline arrow is a new function every render; it must not restart
    // the ticking, and the newest one is the one that is read.
    const clock = startClock(STOPPED_CLOCK, T0);
    const { result, rerender } = setup(clock);
    rerender({ clock, resetKey: 'game-1', now: () => T0 + 10_000 });
    rerender({ clock, resetKey: 'game-1', now: () => T0 + 20_000 });
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(20_000);
  });
});

describe('useElapsed and a backwards clock', () => {
  /** A game 15s in, after which the system clock steps back five minutes. */
  function steppedBack() {
    const clock: Clock = { bankedMs: 10_000, runningSince: T0 };
    const view = setup(clock);
    advance(5000);
    expect(view.result.current).toBe(15_000);
    // An NTP correction, a machine waking with a corrected RTC, or someone
    // angling for a better time.
    returnAfter(-300_000);
    return { ...view, clock };
  }

  it('never lowers the display', () => {
    const { result } = steppedBack();
    expect(result.current).toBe(15_000);
    advance(3000);
    expect(result.current).toBe(15_000);
  });

  it('counts on again once the clock catches up with what was shown', () => {
    const { result } = steppedBack();
    // The segment now reads from where the clock went back to; the display
    // waits at 15s until the clock passes it.
    returnAfter(300_000 + 1000);
    expect(result.current).toBe(16_000);
  });

  it('keeps the highest reading across a pause and resume', () => {
    const { result, rerender, clock } = steppedBack();
    // Pausing banks only what the backwards clock admits to: 10s.
    const paused = pauseClock(clock, Date.now());
    expect(paused.bankedMs).toBe(10_000);
    rerender({ clock: paused, resetKey: 'game-1' });
    expect(result.current).toBe(15_000);
    expect(vi.getTimerCount()).toBe(0);

    rerender({ clock: startClock(paused, Date.now()), resetKey: 'game-1' });
    expect(result.current).toBe(15_000);
    advance(6000);
    expect(result.current).toBe(16_000);
  });
});

describe('useElapsed starting again', () => {
  it('starts from the new clock for a new game', () => {
    const { result, rerender } = setup(startClock(STOPPED_CLOCK, T0));
    advance(5000);
    rerender({ clock: startClock(STOPPED_CLOCK, Date.now()), resetKey: 'game-2' });
    expect(result.current).toBe(0);
    advance(1000);
    expect(result.current).toBe(1000);
  });

  it('forgets the highest reading when the clock is reset to zero', () => {
    // Otherwise a reset after a backwards clock step would show the old
    // game's time until the new one caught up with it.
    const clock: Clock = { bankedMs: 10_000, runningSince: T0 };
    const { result, rerender } = setup(clock);
    advance(5000);
    returnAfter(-300_000);
    expect(result.current).toBe(15_000);

    rerender({ clock: STOPPED_CLOCK, resetKey: 'game-1' });
    expect(result.current).toBe(0);
    rerender({ clock: startClock(STOPPED_CLOCK, Date.now()), resetKey: 'game-1' });
    advance(1000);
    expect(result.current).toBe(1000);
  });

  it('forgets it too when a reset starts the clock running straight away', () => {
    // Reset puzzle zeroes the clock and starts it in one go, so the zero
    // clock is never rendered; the clock not carrying on is the cue instead.
    const { result, rerender } = setup({ bankedMs: 10_000, runningSince: T0 });
    advance(5000);
    returnAfter(-300_000);
    rerender({ clock: startClock(STOPPED_CLOCK, Date.now()), resetKey: 'game-1' });
    expect(result.current).toBe(0);
    advance(1000);
    expect(result.current).toBe(1000);
  });

  it('forgets it when another game’s paused clock takes over under the same key', () => {
    const { result, rerender } = setup({ bankedMs: 50_000, runningSince: null });
    rerender({ clock: { bankedMs: 20_000, runningSince: null }, resetKey: 'game-1' });
    expect(result.current).toBe(20_000);
  });

  it('carries on through an identical clock handed over again', () => {
    const { result, rerender } = setup({ bankedMs: 10_000, runningSince: T0 });
    advance(2000);
    rerender({ clock: { bankedMs: 10_000, runningSince: T0 }, resetKey: 'game-1' });
    expect(result.current).toBe(12_000);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('useElapsed cleanup', () => {
  it('stops ticking when the clock pauses and when unmounted', () => {
    const clock = startClock(STOPPED_CLOCK, T0);
    const { result, rerender, unmount } = setup(clock);
    expect(vi.getTimerCount()).toBe(1);
    advance(3000);

    const paused = pauseClock(clock, Date.now());
    rerender({ clock: paused, resetKey: 'game-1' });
    expect(vi.getTimerCount()).toBe(0);
    advance(10_000);
    expect(result.current).toBe(3000);

    rerender({ clock: startClock(paused, Date.now()), resetKey: 'game-1' });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    // The visibility listener went with it.
    expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();
  });
});
