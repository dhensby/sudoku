import { useEffect, useEffectEvent, useReducer } from 'react';
import {
  INITIAL_CURSOR,
  pauseBefore,
  steer,
  type Playback,
  type PlaybackCommand,
  type PlaybackCursor,
} from '../core';

const noop = () => {};

export interface PlaybackControl {
  cursor: PlaybackCursor;
  /** Move the cursor (see `PlaybackCommand`). Stable for the hook's lifetime. */
  dispatch: (command: PlaybackCommand) => void;
}

/**
 * A playback's cursor, kept and moved on while it plays: the model is
 * `steer` (src/core/playback.ts), and this only waits out the pause before
 * each move — `pauseBefore`, shortened from the player's own and divided by
 * the speed — then shows it, until the solve.
 *
 * One timer at a time, set afresh whenever the cursor changes, so a step,
 * a seek or a change of speed starts the wait for the next move over: at
 * most one move's pause (never above 1.5 s) is waited again, which is
 * simpler than carrying part of a wait across. Timed by the browser's
 * timers, so tests drive it with fake ones — as the end-to-end tests do with
 * Playwright's clock.
 *
 * `onFinish` is called as a running playback reaches the solve by itself —
 * not when the viewer takes it there — so that the player can say so once.
 */
export function usePlayback(playback: Playback, onFinish: () => void = noop): PlaybackControl {
  const [cursor, dispatch] = useReducer(
    (current: PlaybackCursor, command: PlaybackCommand) => steer(playback, current, command),
    INITIAL_CURSOR,
  );
  const finish = useEffectEvent(onFinish);

  useEffect(() => {
    if (!cursor.isPlaying) return undefined;
    const id = window.setTimeout(
      () => {
        // The cursor is as it was when the wait began: any change since
        // would have cleared this timer and set another.
        const next = steer(playback, cursor, { type: 'advance' });
        dispatch({ type: 'advance' });
        if (!next.isPlaying) finish();
      },
      pauseBefore(playback, cursor.position + 1, cursor.speed),
    );
    return () => window.clearTimeout(id);
  }, [playback, cursor]);

  return { cursor, dispatch };
}
