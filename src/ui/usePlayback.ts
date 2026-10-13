import { useEffect, useEffectEvent, useReducer } from 'react';
import {
  INITIAL_CURSOR,
  steer,
  waitBeforeAdvance,
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
 * each move — the player's own, shortened and divided by the speed — in its
 * two parts (`waitBeforeAdvance`): after the first the move's cell is
 * outlined, and after the second, the cue, the move is shown; and so on until
 * the solve.
 *
 * One timer at a time, set afresh whenever the cursor changes, so a step or
 * a seek starts the wait for the next move over, and a change of speed the
 * part of it under way (the pause less its cue, or the cue): at most one
 * move's pause (never above 1.5 s) is waited again, which is simpler than
 * carrying part of a wait across. Timed by the browser's
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
      waitBeforeAdvance(playback, cursor),
    );
    return () => window.clearTimeout(id);
  }, [playback, cursor]);

  return { cursor, dispatch };
}
