import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  DAILY_EPOCH,
  addDays,
  addMonths,
  dailyNumber,
  daysInMonth,
  formatDuration,
  monthGrid,
  monthOf,
  weekdayOf,
  type DateKey,
  type Difficulty,
} from '../../core';
import type { GameRecord } from '../../storage/history';
import { DIFFICULTIES } from '../../storage/storage';
import {
  EMPTY_LEDGER,
  computeStreaks,
  dailyStatuses,
  type DailyLedger,
  type DailyStatus,
} from '../../storage/streaks';
import { DailyMark } from '../DailyMark';
import { STATUS_TEXT, describeDay, summariseDaily } from '../daily';
import { DIFFICULTY_LABEL, formatLongDay, formatMonth } from '../format';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { Dialog } from './Dialog';

export interface DailyDialogProps {
  /**
   * Every record, newest first (as `loadHistory` returns them): the marks,
   * the day panel's times and the streaks all come from them.
   */
  records: readonly GameRecord[];
  /** What the dailies of pruned records said, read with them. */
  ledger?: DailyLedger;
  /** The player's date: the last day on offer, ringed. */
  today: DateKey;
  /** Play a day's daily of a tier, or carry on with it if it is unfinished. */
  onPlay: (date: DateKey, tier: Difficulty) => void;
  /** Play a solved daily again. */
  onReplay: (date: DateKey, tier: Difficulty) => void;
  onClose: () => void;
}

/** The days of the week, Monday first as an en-GB calendar sets them out: short, and in full. */
const WEEKDAYS: readonly [string, string][] = [
  ['Mo', 'Monday'],
  ['Tu', 'Tuesday'],
  ['We', 'Wednesday'],
  ['Th', 'Thursday'],
  ['Fr', 'Friday'],
  ['Sa', 'Saturday'],
  ['Su', 'Sunday'],
];

/** The tiers' letters, in the order a day's marks stand in, for the key. */
const TIER_LETTER: Readonly<Record<Difficulty, string>> = {
  easy: 'E',
  medium: 'M',
  hard: 'H',
  expert: 'X',
};

/** The same day `months` months on, or the month's last day if it is shorter. */
function sameDayMonthsOn(date: DateKey, months: number): DateKey {
  const month = addMonths(monthOf(date), months);
  const day = Math.min(Number(date.slice(8)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * Where a key moves the selection from `date`, as the WAI-ARIA date grid
 * has it: a day either way, a week up or down, the week's first or last day,
 * a month (with Shift, a year) back or on. Null for a key that does not move.
 */
function dateForKey(date: DateKey, event: React.KeyboardEvent): DateKey | null {
  switch (event.key) {
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'Home':
      return addDays(date, -weekdayOf(date));
    case 'End':
      return addDays(date, 6 - weekdayOf(date));
    case 'PageUp':
      return sameDayMonthsOn(date, event.shiftKey ? -12 : -1);
    case 'PageDown':
      return sameDayMonthsOn(date, event.shiftKey ? 12 : 1);
    default:
      return null;
  }
}

/** Whether the player has asked for less motion: a scroll then jumps rather than glides. */
function prefersLessMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** "1 day", "5 days": a streak's length. */
function days(n: number): string {
  return n === 1 ? 'day' : 'days';
}

/** What a day panel row says and offers for one tier's daily. */
function DayRow({
  date,
  tier,
  records,
  ledger,
  isPlayable,
  onPlay,
  onReplay,
}: {
  date: DateKey;
  tier: Difficulty;
  records: readonly GameRecord[];
  ledger: DailyLedger;
  /** False only on a device whose clock is set before Daily #1, when no day has a daily. */
  isPlayable: boolean;
  onPlay: DailyDialogProps['onPlay'];
  onReplay: DailyDialogProps['onReplay'];
}) {
  const { status, record } = summariseDaily(records, date, tier, ledger);
  const label = DIFFICULTY_LABEL[tier];
  const time = record === null ? null : formatDuration(record.elapsedMs);
  const isSolved = status === 'solved-on-the-day' || status === 'solved-later';
  let action = 'Play';
  if (status === 'in-progress') action = 'Resume';
  else if (isSolved) action = 'Play again';

  return (
    <li className="daily-day__row">
      <DailyMark status={status} className="daily-day__mark" />
      <p className="daily-day__text">
        <span className="daily-day__tier">{label}</span>
        <span className="daily-day__status">
          {STATUS_TEXT[status]}
          {time !== null && <> · {time}</>}
        </span>
      </p>
      <button
        type="button"
        className={isSolved ? 'button button--small' : 'button button--small button--primary'}
        // Every row has a button like it: its name says which daily it is for.
        aria-label={`${action}, ${label} daily for ${formatLongDay(date)}`}
        disabled={!isPlayable}
        onClick={() => (isSolved ? onReplay(date, tier) : onPlay(date, tier))}
      >
        {action}
      </button>
    </li>
  );
}

/**
 * The daily puzzles, past and present: each tier's streak at the top, a
 * month of days with how each day's four dailies stand, and the day chosen
 * — today, to begin with — with its four to play, carry on with or play
 * again.
 *
 * The month is a WAI-ARIA date grid: one tab stop, on the chosen day, which
 * the arrow keys move a day or a week at a time, Home and End to the week's
 * ends, Page Up and Page Down by a month (with Shift, a year). The choice
 * follows the keys, so the day panel shows each day as the keys reach it.
 * Days run from Daily #1 to today: a day before or after has no daily to
 * play, and neither the keys nor a click reach it.
 *
 * Each day's marks are told apart by shape (see `DailyMark`) and by place —
 * Easy, Medium, Hard and Expert, left to right, as the key says — and its
 * accessible name says it all in words.
 */
export function DailyDialog({
  records,
  ledger = EMPTY_LEDGER,
  today,
  onPlay,
  onReplay,
  onClose,
}: DailyDialogProps) {
  const ids = useId();
  const monthId = `${ids}-month`;
  const dayId = `${ids}-day`;
  const streaksId = `${ids}-streaks`;
  // Nothing before Daily #1, and nothing after today.
  const first = DAILY_EPOCH;
  const last = today < DAILY_EPOCH ? DAILY_EPOCH : today;
  const clamp = (date: DateKey): DateKey => {
    if (date < first) return first;
    return date > last ? last : date;
  };
  const isPlayable = (date: DateKey) => date >= DAILY_EPOCH && date <= today;

  const [chosen, setChosen] = useState<DateKey>(last);
  // Today may move on while the calendar is open (the page came back into
  // view on a new day): the choice stays, within the days on offer.
  const selected = clamp(chosen);
  const month = monthOf(selected);
  const gridRef = useRef<HTMLTableElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Set by the keys: focus follows the choice into a month just drawn.
  const isFocusPending = useRef(false);
  // Set by a press: bring the day panel into view if the choice left it below.
  const isRevealPending = useRef(false);

  const statuses = useMemo(() => dailyStatuses(records, ledger), [records, ledger]);
  const streaks = useMemo(() => computeStreaks(records, today, ledger), [records, today, ledger]);
  const weeks = useMemo(() => monthGrid(month), [month]);

  useEffect(() => {
    if (isFocusPending.current) {
      isFocusPending.current = false;
      gridRef.current?.querySelector<HTMLElement>(`[data-date="${selected}"]`)?.focus();
    }
    if (isRevealPending.current) {
      isRevealPending.current = false;
      // Not in jsdom, nor in every old browser.
      panelRef.current?.scrollIntoView?.({
        block: 'nearest',
        behavior: prefersLessMotion() ? 'auto' : 'smooth',
      });
    }
  }, [selected]);

  const choose = (date: DateKey) => setChosen(clamp(date));

  const handleDayKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      // The day under focus is already the one chosen, so the key moves on to
      // what it offers: the day panel's first button, which says which daily
      // it plays. Otherwise a screen reader would hear nothing happen.
      event.preventDefault();
      panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      return;
    }
    const target = dateForKey(selected, event);
    if (target === null) return;
    event.preventDefault();
    isFocusPending.current = true;
    choose(target);
  };

  const stepMonth = (months: number) => choose(sameDayMonthsOn(selected, months));
  const canGoBack = monthOf(first) < month;
  const canGoOn = month < monthOf(last);

  return (
    <Dialog title="Daily puzzles" onClose={onClose} className="dialog--wide dialog--daily">
      <div className="daily">
        <section className="streaks" aria-labelledby={streaksId}>
          <h3 className="streaks__heading" id={streaksId}>
            Streaks
          </h3>
          <ul className="streaks__list">
            {DIFFICULTIES.map((tier) => {
              const { current, best } = streaks[tier];
              return (
                <li className="streaks__item" key={tier}>
                  <span className="streaks__tier">{DIFFICULTY_LABEL[tier]}</span>
                  <span className="streaks__current">
                    <span className="visually-hidden">current streak </span>
                    <span className="streaks__value">{current}</span> {days(current)}
                  </span>
                  <span className="streaks__best">Best {best}</span>
                </li>
              );
            })}
          </ul>
          <p className="streaks__note">Days in a row with that daily solved on its own day.</p>
        </section>

        <div className="calendar">
          <div className="calendar__nav">
            {/* Greyed out with aria-disabled rather than disabled at either end:
                a disabled button loses focus, and the one just pressed would
                drop it to the page. */}
            <button
              type="button"
              className="calendar__step"
              aria-label="Previous month"
              aria-disabled={canGoBack ? undefined : true}
              onClick={() => {
                if (canGoBack) stepMonth(-1);
              }}
            >
              <ChevronLeftIcon />
            </button>
            {/* Spoken as it changes, so the keys' move into another month is heard. */}
            <h3 className="calendar__month" id={monthId} aria-live="polite">
              {formatMonth(month)}
            </h3>
            <button
              type="button"
              className="calendar__step"
              aria-label="Next month"
              aria-disabled={canGoOn ? undefined : true}
              onClick={() => {
                if (canGoOn) stepMonth(1);
              }}
            >
              <ChevronRightIcon />
            </button>
          </div>

          <table className="calendar__grid" role="grid" aria-labelledby={monthId} ref={gridRef}>
            <thead>
              <tr>
                {WEEKDAYS.map(([short, full]) => (
                  <th key={short} scope="col" abbr={full} className="calendar__weekday">
                    {short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0].date}>
                  {week.map(({ date, inMonth }) => {
                    // The days either side of the month are left blank: each
                    // month shows its own days, and the keys move into the next.
                    if (!inMonth) {
                      return (
                        <td
                          key={date}
                          role="gridcell"
                          className="calendar__day calendar__day--outside"
                        />
                      );
                    }
                    const isChosen = date === selected;
                    const isToday = date === today;
                    const playable = isPlayable(date);
                    const day = statuses.get(date) ?? {};
                    const classes = ['calendar__day'];
                    if (isChosen) classes.push('calendar__day--selected');
                    if (isToday) classes.push('calendar__day--today');
                    if (!playable) classes.push('calendar__day--unavailable');
                    return (
                      <td
                        key={date}
                        // Said outright: not every tool knows a cell of a grid is a gridcell.
                        role="gridcell"
                        className={classes.join(' ')}
                        data-date={date}
                        tabIndex={isChosen ? 0 : -1}
                        aria-selected={isChosen}
                        aria-current={isToday ? 'date' : undefined}
                        aria-disabled={playable ? undefined : true}
                        aria-label={
                          playable ? describeDay(date, day) : `${formatLongDay(date)}: no daily`
                        }
                        data-autofocus={isChosen ? true : undefined}
                        // A day with no daily takes no focus from a press either,
                        // so the grid's one tab stop stays on the chosen day.
                        onMouseDown={(event) => {
                          if (!playable) event.preventDefault();
                        }}
                        onClick={() => {
                          if (!playable) return;
                          isRevealPending.current = true;
                          choose(date);
                        }}
                        onKeyDown={handleDayKey}
                      >
                        <span className="calendar__date" aria-hidden="true">
                          {Number(date.slice(8))}
                        </span>
                        {playable && (
                          <span className="calendar__marks" aria-hidden="true">
                            {DIFFICULTIES.map((tier) => (
                              <DailyMark
                                key={tier}
                                status={day[tier] ?? 'not-started'}
                                className="calendar__mark"
                              />
                            ))}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="daily-day" aria-labelledby={dayId} ref={panelRef}>
          <div className="daily-day__header">
            <h3 className="daily-day__heading" id={dayId}>
              {formatLongDay(selected)}
            </h3>
            <p className="daily-day__number">
              {selected === today ? 'Today · ' : ''}Daily #{dailyNumber(selected)}
            </p>
          </div>
          <ul className="daily-day__list">
            {DIFFICULTIES.map((tier) => (
              <DayRow
                key={tier}
                date={selected}
                tier={tier}
                records={records}
                ledger={ledger}
                isPlayable={isPlayable(selected)}
                onPlay={onPlay}
                onReplay={onReplay}
              />
            ))}
          </ul>
        </section>

        <div className="daily-key">
          <p className="daily-key__order">
            <span className="daily-key__day" aria-hidden="true">
              {DIFFICULTIES.map((tier) => (
                <span key={tier} className="daily-key__letter">
                  {TIER_LETTER[tier]}
                </span>
              ))}
              {DIFFICULTIES.map((tier) => (
                <DailyMark key={tier} status="not-started" className="calendar__mark" />
              ))}
            </span>
            Each day&apos;s marks: Easy, Medium, Hard and Expert, left to right.
          </p>
          <ul className="daily-key__list">
            {(Object.keys(STATUS_TEXT) as DailyStatus[]).map((status) => (
              <li key={status} className="daily-key__item">
                <DailyMark status={status} className="daily-key__mark" />
                {STATUS_TEXT[status]}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
