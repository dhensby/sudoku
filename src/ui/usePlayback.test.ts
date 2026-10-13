import { act, renderHook } from '@testing-library/react';
import { LONGEST_CUE_MS, LONGEST_PAUSE_MS, preparePlayback, type Playback } from '../core';
import { passTime } from '../test/time';
import { shortSolve } from './testFixtures';
import { usePlayback } from './usePlayback';

/*
 * The short solve's moves are at 1, 5, 6, 7 and 9 s of play: so a playback
 * waits 1 s, 1.5 s (4 s shortened), 1 s, 1 s and 1.5 s (2 s shortened)
 * before each, at 1× — the last 0.4 s of each with the move cued.
 */
const PLAYBACK: Playback = (() => {
  const { puzzle, encoded } = shortSolve();
  const result = preparePlayback(puzzle.givens, puzzle.difficulty, encoded);
  if (!result.ok) throw new Error(result.reason);
  return result.playback;
})();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePlayback', () => {
  it('opens at the start, paused', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    expect(result.current.cursor).toEqual({
      position: 0,
      isPlaying: false,
      speed: 1,
      isCued: false,
    });
    passTime(10_000);
    expect(result.current.cursor.position).toBe(0);
  });

  it('shows each move after the player’s own pause, shortened, and stops at the solve', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    act(() => result.current.dispatch({ type: 'play' }));
    passTime(999);
    expect(result.current.cursor.position).toBe(0);
    passTime(1);
    expect(result.current.cursor.position).toBe(1);
    // 4 s before the second move, played as 1.5 s.
    passTime(LONGEST_PAUSE_MS - 1);
    expect(result.current.cursor.position).toBe(1);
    passTime(1);
    expect(result.current.cursor.position).toBe(2);
    passTime(1000 + 1000 + LONGEST_PAUSE_MS);
    expect(result.current.cursor).toEqual({
      position: 5,
      isPlaying: false,
      speed: 1,
      isCued: false,
    });
  });

  it('cues each move, out of the pause before it rather than on top of it', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    const cursor = () => result.current.cursor;
    act(() => result.current.dispatch({ type: 'play' }));
    // The first move's 1 s: 0.6 s with nothing cued, then 0.4 s cued.
    passTime(1000 - LONGEST_CUE_MS - 1);
    expect(cursor()).toMatchObject({ position: 0, isCued: false });
    passTime(1);
    expect(cursor()).toMatchObject({ position: 0, isCued: true });
    passTime(LONGEST_CUE_MS - 1);
    expect(cursor()).toMatchObject({ position: 0, isCued: true });
    passTime(1);
    expect(cursor()).toMatchObject({ position: 1, isCued: false });
    // The second's 1.5 s likewise.
    passTime(LONGEST_PAUSE_MS - LONGEST_CUE_MS - 1);
    expect(cursor()).toMatchObject({ position: 1, isCued: false });
    passTime(1);
    expect(cursor()).toMatchObject({ position: 1, isCued: true });
  });

  it('takes the cue back as it pauses, and keeps it through a change of speed', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    act(() => result.current.dispatch({ type: 'play' }));
    passTime(1000 - LONGEST_CUE_MS);
    act(() => result.current.dispatch({ type: 'pause' }));
    expect(result.current.cursor).toMatchObject({ position: 0, isCued: false });
    passTime(10_000);
    expect(result.current.cursor).toMatchObject({ position: 0, isCued: false });

    act(() => result.current.dispatch({ type: 'play' }));
    passTime(1000 - LONGEST_CUE_MS);
    act(() => result.current.dispatch({ type: 'speed', speed: 8 }));
    // Cued still, and the move shown after its cue at 8×: half its 125 ms
    // pause, waited afresh (give or take the timers' rounding).
    expect(result.current.cursor).toMatchObject({ position: 0, isCued: true });
    passTime(61);
    expect(result.current.cursor).toMatchObject({ position: 0, isCued: true });
    passTime(3);
    expect(result.current.cursor).toMatchObject({ position: 1, isCued: false });
  });

  it('says when it reaches the solve by itself, once, and not when taken there', () => {
    const onFinish = vi.fn();
    const { result } = renderHook(() => usePlayback(PLAYBACK, onFinish));
    act(() => result.current.dispatch({ type: 'play' }));
    passTime(1000 + LONGEST_PAUSE_MS + 1000 + 1000 + LONGEST_PAUSE_MS - 1);
    expect(onFinish).not.toHaveBeenCalled();
    passTime(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
    passTime(10_000);
    expect(onFinish).toHaveBeenCalledTimes(1);
    // Taken there by the viewer, playing or not: their own doing, unsaid.
    act(() => result.current.dispatch({ type: 'play' }));
    act(() => result.current.dispatch({ type: 'end' }));
    passTime(10_000);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('plays faster at a higher speed', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    act(() => result.current.dispatch({ type: 'speed', speed: 8 }));
    act(() => result.current.dispatch({ type: 'play' }));
    // The whole solve, 6 s of shortened pauses at 1×, in 0.75 s (give or
    // take the timers' rounding of each pause to a whole millisecond).
    passTime(740);
    expect(result.current.cursor.position).toBe(4);
    passTime(20);
    expect(result.current.cursor).toEqual({
      position: 5,
      isPlaying: false,
      speed: 8,
      isCued: false,
    });
  });

  it('holds still while paused, and waits afresh after a step', () => {
    const { result } = renderHook(() => usePlayback(PLAYBACK));
    act(() => result.current.dispatch({ type: 'play' }));
    passTime(1000);
    act(() => result.current.dispatch({ type: 'pause' }));
    passTime(10_000);
    expect(result.current.cursor.position).toBe(1);
    act(() => result.current.dispatch({ type: 'step', by: 1 }));
    expect(result.current.cursor).toEqual({
      position: 2,
      isPlaying: false,
      speed: 1,
      isCued: false,
    });
    act(() => result.current.dispatch({ type: 'seek', position: 3 }));
    act(() => result.current.dispatch({ type: 'play' }));
    passTime(999);
    expect(result.current.cursor.position).toBe(3);
    passTime(1);
    expect(result.current.cursor.position).toBe(4);
  });

  it('stops its timer when it goes', () => {
    const { result, unmount } = renderHook(() => usePlayback(PLAYBACK));
    act(() => result.current.dispatch({ type: 'play' }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
