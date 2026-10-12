import { act } from '@testing-library/react';

/*
 * Time passing under fake timers, for what sets its next timer from an
 * effect: a playback, whose each wait is set by an effect after the render
 * the last one caused.
 */

/**
 * Let `ms` of time pass a millisecond at a time, each in an act of its own:
 * a timer set by an effect after the last one fired is only set as its act
 * ends, which one long advance would never let happen.
 */
export function passTime(ms: number): void {
  for (let i = 0; i < ms; i++) {
    act(() => {
      vi.advanceTimersByTime(1);
    });
  }
}
