import type { DailyStatus } from '../storage/streaks';

export interface DailyMarkProps {
  status: DailyStatus;
  /** Extra classes, after the base ones (the calendar sizes its marks smaller than the menu). */
  className?: string;
}

/**
 * How a daily stands, as a small square told apart by its shape rather than
 * its colour, so it reads the same to every eye and in Windows High
 * Contrast: solid for solved on the day (the only kind that keeps a streak),
 * hatched for solved on another day (caught up on later, or begun early
 * from a friend's link), half filled for in progress, an empty outline
 * for not started. Drawn on a 10-unit square in the text colour (the empty
 * one in the muted text colour, see dialogs.css).
 *
 * Decorative: whatever it sits in — a calendar day, a menu item, a row of
 * the day panel — says the same in words for assistive technology.
 */
export function DailyMark({ status, className }: DailyMarkProps) {
  const classes = `daily-mark daily-mark--${status}${className === undefined ? '' : ` ${className}`}`;
  return (
    <svg
      className={classes}
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false"
    >
      {status === 'solved-on-the-day' ? (
        <rect width="10" height="10" fill="currentColor" />
      ) : (
        <rect
          x="0.75"
          y="0.75"
          width="8.5"
          height="8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      )}
      {status === 'solved-later' && (
        <path d="M0 10 10 0M0 5 5 0M5 10 10 5" stroke="currentColor" strokeWidth="1.25" />
      )}
      {status === 'in-progress' && <rect y="5" width="10" height="5" fill="currentColor" />}
    </svg>
  );
}
