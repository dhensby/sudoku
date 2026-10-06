import { Fragment, useId } from 'react';
import { formatDuration } from '../core';
import { PauseIcon, PlayIcon } from './icons';
import { keepFocus } from './keepFocus';
import type { Phase } from './session';

export interface TimerProps {
  elapsedMs: number;
  phase: Phase;
  /** The "Show timer" setting. Off hides the digits only: the button stays, and timing carries on. */
  showTimer: boolean;
  onPause: () => void;
  /** Resume a paused game, or start one waiting behind its Start button. */
  onResume: () => void;
}

/**
 * A ticking time, each colon in a span of its own: the stylesheet keeps the
 * digits tabular, so the time holds still as it ticks, and lets the colons
 * keep their natural width — a tabular colon is a digit wide in Schibsted
 * Grotesk, which opens a gap either side of it.
 */
function TickingTime({ time }: { time: string }) {
  return time.split(':').map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <span className="timer__colon">:</span>}
      {part}
    </Fragment>
  ));
}

/**
 * The time, and the button that pauses it. The whole timer is the button —
 * clicking the time pauses, as on NYT — named for what it does ("Pause",
 * "Resume", "Start") and described by the time, so a screen reader hears
 * both without the name changing every second. A mouse press leaves focus
 * where it was, so Space goes on switching the mode rather than pausing
 * again. Once solved it is just the final time.
 */
export function Timer({ elapsedMs, phase, showTimer, onPause, onResume }: TimerProps) {
  const timeId = useId();
  const time = formatDuration(elapsedMs);

  if (phase === 'solved') {
    return (
      <span className="timer timer--solved">
        {showTimer && (
          <span className="timer__time">
            <span className="visually-hidden">Solved in </span>
            {time}
          </span>
        )}
      </span>
    );
  }

  const isRunning = phase === 'playing';
  const action = isRunning ? 'Pause' : phase === 'ready' ? 'Start' : 'Resume';
  return (
    <button
      type="button"
      className={isRunning ? 'timer' : 'timer timer--stopped'}
      aria-label={action}
      title={action}
      aria-describedby={showTimer ? timeId : undefined}
      disabled={phase === 'loading'}
      onMouseDown={keepFocus}
      onClick={isRunning ? onPause : onResume}
    >
      {showTimer && (
        <span className="timer__time" id={timeId}>
          <TickingTime time={time} />
        </span>
      )}
      <span className="timer__icon">{isRunning ? <PauseIcon /> : <PlayIcon />}</span>
    </button>
  );
}
