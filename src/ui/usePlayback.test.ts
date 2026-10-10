import { act, renderHook } from '@testing-library/react';
import { LONGEST_PAUSE_MS, preparePlayback, type Playback } from '../core';
import { shortSolve } from './testFixtures';
import { usePlayback } from './usePlayback';

/*
 * The short solve's moves are at 1, 5, 6, 7 and 9 s of play: so a playback
 * waits 1 s, 1.5 s (4 s shortened), 1 s, 1 s and 1.5 s (2 s shortened)
 * before each, at 1×.
 */
const PLAYBACK: Playback = (() => {
  const { puzzle, encoded } = shortSolve();
  const result = preparePlayback(puzzle.givens, puzzle.difficulty, encoded);
  if (!result.ok) throw new Error(result.reason);
  return result.playback;
})();

/**
 * Let `ms` of time pass a millisecond at a time, each in an act of its own:
 * each move's timer is set by an effect after the last move renders, which
 * one long advance would never let happen.
 */
function advance(ms: number): void {
  for (let i = 0; i < ms; i++) {
    act(() => {
      vi.advanceTimersByTime(1);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePlayback', () => {
  it('opens at the start, paused', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    expect(result.current.cursor).toEqual({ position: 0, isPlaying: false, speed: 1 });
    advance(10_000);
    expect(result.current.cursor.position).toBe(0);
  });

  it('shows each move after the player’s own pause, shortened, and stops at the solve', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    act(() => result.current.dispatch({ type: 'play' }));
    advance(999);
    expect(result.current.cursor.position).toBe(0);
    advance(1);
    expect(result.current.cursor.position).toBe(1);
    // 4 s before the second move, played as 1.5 s.
    advance(LONGEST_PAUSE_MS - 1);
    expect(result.current.cursor.position).toBe(1);
    advance(1);
    expect(result.current.cursor.position).toBe(2);
    advance(1000 + 1000 + LONGEST_PAUSE_MS);
    expect(result.current.cursor).toEqual({ position: 5, isPlaying: false, speed: 1 });
  });

  it('says when it reaches the solve by itself, once, and not when taken there', () => {
    const onFinish = vi.fn();
    const { result } = renderHook(() => usePlayback(PLAYBACK, onFinish));
    act(() => result.current.dispatch({ type: 'play' }));
    advance(1000 + LONGEST_PAUSE_MS + 1000 + 1000 + LONGEST_PAUSE_MS - 1);
    expect(onFinish).not.toHaveBeenCalled();
    advance(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
    advance(10_000);
    expect(onFinish).toHaveBeenCalledTimes(1);
    // Taken there by the viewer, playing or not: their own doing, unsaid.
    act(() => result.current.dispatch({ type: 'play' }));
    act(() => result.current.dispatch({ type: 'end' }));
    advance(10_000);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('plays faster at a higher speed', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    act(() => result.current.dispatch({ type: 'speed', speed: 8 }));
    act(() => result.current.dispatch({ type: 'play' }));
    // The whole solve, 6 s of shortened pauses at 1×, in 0.75 s (give or
    // take the timers' rounding of each pause to a whole millisecond).
    advance(740);
    expect(result.current.cursor.position).toBe(4);
    advance(20);
    expect(result.current.cursor).toEqual({ position: 5, isPlaying: false, speed: 8 });
  });

  it('holds still while paused, and waits afresh after a step', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    act(() => result.current.dispatch({ type: 'play' }));
    advance(1000);
    act(() => result.current.dispatch({ type: 'pause' }));
    advance(10_000);
    expect(result.current.cursor.position).toBe(1);
    act(() => result.current.dispatch({ type: 'step', by: 1 }));
    expect(result.current.cursor).toEqual({ position: 2, isPlaying: false, speed: 1 });
    act(() => result.current.dispatch({ type: 'seek', position: 3 }));
    act(() => result.current.dispatch({ type: 'play' }));
    advance(999);
    expect(result.current.cursor.position).toBe(3);
    advance(1);
    expect(result.current.cursor.position).toBe(4);
  });

  it('stops its timer when it goes', () => {
    const { result, unmount } = renderHook(() => usePlayback(PLAYBACK));
    act(() => result.current.dispatch({ type: 'play' }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
