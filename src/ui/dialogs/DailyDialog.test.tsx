import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Difficulty } from '../../core';
import type { GameRecord } from '../../storage/history';
import { DailyDialog, type DailyDialogProps } from './DailyDialog';

const PUZZLE = '1'.padEnd(81, '0');

/** Epoch ms of noon on a local date. */
function noon(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

let serial = 0;

/** A daily attempt at `daily`'s `tier`, begun at noon on `started`, solved unless said otherwise. */
function attempt(
  daily: string,
  tier: Difficulty,
  started: string = daily,
  overrides: Partial<GameRecord> = {},
): GameRecord {
  const createdAt = noon(started);
  const status = overrides.status ?? 'solved';
  return {
    id: `game-${serial++}`,
    givens: PUZZLE,
    difficulty: tier,
    source: 'daily',
    createdAt,
    updatedAt: createdAt + 600_000,
    completedAt: status === 'solved' ? createdAt + 600_000 : null,
    status,
    elapsedMs: 323_000,
    assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
    challenge: null,
    daily,
    ...overrides,
  };
}

function renderCalendar(overrides: Partial<DailyDialogProps> = {}) {
  const props: DailyDialogProps = {
    records: [],
    today: '2026-10-13',
    onPlay: vi.fn(),
    onReplay: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<DailyDialog {...props} />);
  return { ...view, props };
}

const grid = () => screen.getByRole('grid');
const chosen = () => within(grid()).getByRole('gridcell', { selected: true });
const day = (date: string) => document.querySelector<HTMLElement>(`[data-date="${date}"]`)!;
const panel = () => screen.getByRole('region', { name: /day|October|November/ });

function key(name: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document.activeElement!, { key: name, ...init });
}

describe('DailyDialog', () => {
  it("sums up each tier's streak, current and best, and says what counts", () => {
    renderCalendar({
      records: [
        attempt('2026-10-11', 'hard'),
        attempt('2026-10-12', 'hard'),
        attempt('2026-10-13', 'hard'),
        attempt('2026-10-08', 'easy'),
        attempt('2026-10-09', 'easy'),
        // Caught up on later: no streak.
        attempt('2026-10-12', 'medium', '2026-10-13'),
      ],
    });
    const streaks = screen.getByRole('region', { name: 'Streaks' });
    expect(
      within(streaks)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Easycurrent streak 0 daysBest 2',
      'Mediumcurrent streak 0 daysBest 0',
      'Hardcurrent streak 3 daysBest 3',
      'Expertcurrent streak 0 daysBest 0',
    ]);
    expect(streaks).toHaveTextContent('Days in a row with that daily solved on its own day.');
  });

  it('says a streak of one is a day', () => {
    renderCalendar({ records: [attempt('2026-10-13', 'easy')] });
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('1 day');
  });

  it('lays out the month in weeks from Monday, with the days either side left blank', () => {
    renderCalendar();
    expect(grid()).toHaveAccessibleName('October 2026');
    expect(
      within(grid())
        .getAllByRole('columnheader')
        .map((header) => header.getAttribute('abbr')),
    ).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    const firstWeek = within(grid()).getAllByRole('row')[1];
    const cells = within(firstWeek).getAllByRole('gridcell');
    // 1 October 2026 was a Thursday.
    expect(cells.map((cell) => cell.textContent)).toEqual(['', '', '', '1', '2', '3', '4']);
    expect(within(grid()).getAllByRole('row')).toHaveLength(6);
  });

  it('names each day with how its dailies stand, rings today and holds the days to come', () => {
    renderCalendar({
      records: [
        attempt('2026-10-13', 'easy'),
        attempt('2026-10-13', 'medium', '2026-10-13', { status: 'playing' }),
        attempt('2026-10-09', 'expert', '2026-10-10'),
      ],
    });
    expect(day('2026-10-13')).toHaveAccessibleName(
      'Tuesday 13 October: Easy solved on the day, Medium in progress, Hard and Expert not started',
    );
    expect(day('2026-10-13')).toHaveAttribute('aria-current', 'date');
    expect(day('2026-10-09')).toHaveAccessibleName(
      'Friday 9 October: Easy, Medium and Hard not started, Expert solved on another day',
    );
    expect(day('2026-10-09')).not.toHaveAttribute('aria-current');
    expect(day('2026-10-14')).toHaveAccessibleName('Wednesday 14 October: no daily');
    expect(day('2026-10-14')).toHaveAttribute('aria-disabled', 'true');
    expect(day('2026-10-14').querySelector('.daily-mark')).toBeNull();
  });

  it("draws a day's marks by shape, Easy to Expert from left to right", () => {
    renderCalendar({
      records: [
        attempt('2026-10-10', 'easy'),
        attempt('2026-10-10', 'medium', '2026-10-11'),
        attempt('2026-10-10', 'hard', '2026-10-10', { status: 'playing' }),
      ],
    });
    const marks = [...day('2026-10-10').querySelectorAll('.daily-mark')];
    expect(marks.map((mark) => mark.getAttribute('class'))).toEqual([
      'daily-mark daily-mark--solved-on-the-day calendar__mark',
      'daily-mark daily-mark--solved-later calendar__mark',
      'daily-mark daily-mark--in-progress calendar__mark',
      'daily-mark daily-mark--not-started calendar__mark',
    ]);
    // A key says what the shapes and places mean.
    expect(screen.getByText(/Each day's marks: Easy, Medium, Hard and Expert/)).toBeVisible();
  });

  it("opens on today, focused: the grid's one tab stop", () => {
    renderCalendar();
    expect(chosen()).toBe(day('2026-10-13'));
    expect(chosen()).toHaveFocus();
    const stops = within(grid())
      .getAllByRole('gridcell')
      .filter((cell) => cell.tabIndex === 0);
    expect(stops).toEqual([day('2026-10-13')]);
  });

  it('moves the choice by day, week, week end and month with the keys, focus following', () => {
    renderCalendar({ today: '2026-11-18' });
    expect(chosen()).toBe(day('2026-11-18'));
    key('ArrowLeft');
    expect(chosen()).toBe(day('2026-11-17'));
    expect(day('2026-11-17')).toHaveFocus();
    key('ArrowUp');
    expect(chosen()).toBe(day('2026-11-10'));
    key('ArrowDown');
    expect(chosen()).toBe(day('2026-11-17'));
    key('Home');
    expect(chosen()).toBe(day('2026-11-16'));
    // The week's end is past today, which is as far as it goes.
    key('End');
    expect(chosen()).toBe(day('2026-11-18'));
    key('ArrowRight');
    expect(chosen()).toBe(day('2026-11-18'));
    key('ArrowUp');
    key('End');
    expect(chosen()).toBe(day('2026-11-15'));
    key('ArrowDown');
    expect(chosen()).toBe(day('2026-11-18'));
    key('PageUp');
    expect(grid()).toHaveAccessibleName('October 2026');
    expect(chosen()).toBe(day('2026-10-18'));
    expect(day('2026-10-18')).toHaveFocus();
    key('PageDown');
    expect(chosen()).toBe(day('2026-11-18'));
  });

  it('keeps the choice between Daily #1 and today, whatever the key', () => {
    renderCalendar({ today: '2026-11-18' });
    key('PageUp', { shiftKey: true });
    expect(chosen()).toBe(day('2026-10-07'));
    key('ArrowUp');
    key('ArrowLeft');
    expect(chosen()).toBe(day('2026-10-07'));
    key('PageDown', { shiftKey: true });
    expect(chosen()).toBe(day('2026-11-18'));
  });

  it("goes to the same day of the next month, or that month's last if it is shorter", () => {
    renderCalendar({ today: '2027-03-15' });
    key('PageUp');
    key('PageUp');
    expect(chosen()).toBe(day('2027-01-15'));
    // Friday 15 January, then that week's Sunday and two weeks on.
    key('End');
    key('ArrowDown');
    key('ArrowDown');
    expect(chosen()).toBe(day('2027-01-31'));
    key('PageDown');
    expect(chosen()).toBe(day('2027-02-28'));
  });

  it('leaves the choice where it is on Enter, Space and other keys, claiming only its own', () => {
    renderCalendar();
    const before = chosen();
    const enter = fireEvent.keyDown(before, { key: 'Enter' });
    const space = fireEvent.keyDown(before, { key: ' ' });
    const letter = fireEvent.keyDown(before, { key: 'a' });
    expect(chosen()).toBe(before);
    // Claimed (default prevented): fireEvent returns false.
    expect([enter, space, letter]).toEqual([false, false, true]);
  });

  it('moves on to the day panel’s first button on Enter or Space', () => {
    renderCalendar();
    for (const key of ['Enter', ' ']) {
      chosen().focus();
      fireEvent.keyDown(chosen(), { key });
      expect(within(panel()).getAllByRole('button')[0]).toHaveFocus();
    }
  });

  it('chooses a day pressed, but not one still to come', () => {
    renderCalendar();
    fireEvent.click(day('2026-10-09'));
    expect(chosen()).toBe(day('2026-10-09'));
    expect(screen.getByRole('heading', { name: 'Friday 9 October' })).toBeVisible();
    fireEvent.click(day('2026-10-16'));
    expect(chosen()).toBe(day('2026-10-09'));
  });

  it('keeps a press on a day still to come from taking focus off the chosen day', () => {
    renderCalendar();
    // Default prevented on the day to come (fireEvent returns false), not on one to play.
    expect(fireEvent.mouseDown(day('2026-10-16'))).toBe(false);
    expect(fireEvent.mouseDown(day('2026-10-09'))).toBe(true);
  });

  it('brings the day panel into view as a day is pressed — gliding, unless asked for less motion', () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scroll,
      configurable: true,
    });
    renderCalendar();
    // Moved by the keys, focus stays in the grid, and so does the view.
    key('ArrowLeft');
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(day('2026-10-09'));
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    fireEvent.click(day('2026-10-10'));
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'auto' });
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it('shows the day chosen with its daily number, and today as today', () => {
    renderCalendar();
    expect(screen.getByText('Today · Daily #7')).toBeVisible();
    fireEvent.click(day('2026-10-07'));
    expect(screen.getByText('Daily #1')).toBeVisible();
  });

  it("offers each of the day's dailies to play, carry on with, or play again, with its time", () => {
    const { props } = renderCalendar({
      records: [
        attempt('2026-10-12', 'easy'),
        attempt('2026-10-12', 'medium', '2026-10-13'),
        attempt('2026-10-12', 'hard', '2026-10-12', { status: 'playing', elapsedMs: 61_000 }),
      ],
    });
    fireEvent.click(day('2026-10-12'));
    const rows = within(screen.getByRole('region', { name: 'Monday 12 October' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      'EasySolved on the day · 5:23Play again',
      'MediumSolved on another day · 5:23Play again',
      'HardIn progress · 1:01Resume',
      'ExpertNot startedPlay',
    ]);
    fireEvent.click(
      screen.getByRole('button', { name: 'Play again, Easy daily for Monday 12 October' }),
    );
    expect(props.onReplay).toHaveBeenCalledWith('2026-10-12', 'easy');
    fireEvent.click(
      screen.getByRole('button', { name: 'Resume, Hard daily for Monday 12 October' }),
    );
    expect(props.onPlay).toHaveBeenCalledWith('2026-10-12', 'hard');
    fireEvent.click(
      screen.getByRole('button', { name: 'Play, Expert daily for Monday 12 October' }),
    );
    expect(props.onPlay).toHaveBeenCalledWith('2026-10-12', 'expert');
  });

  it("steps a month at a time with its buttons, between Daily #1's month and today's", () => {
    renderCalendar({ today: '2026-11-18' });
    const previous = screen.getByRole('button', { name: 'Previous month' });
    const next = screen.getByRole('button', { name: 'Next month' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    // Greyed out at the end, it does nothing.
    fireEvent.click(next);
    expect(chosen()).toBe(day('2026-11-18'));
    previous.focus();
    fireEvent.click(previous);
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeVisible();
    expect(chosen()).toBe(day('2026-10-18'));
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(next).not.toHaveAttribute('aria-disabled');
    // The button just pressed keeps focus, though it is now at the end: a
    // disabled button would drop focus to the page.
    expect(previous).not.toBeDisabled();
    expect(previous).toHaveFocus();
    fireEvent.click(previous);
    expect(chosen()).toBe(day('2026-10-18'));
    next.focus();
    fireEvent.click(next);
    expect(chosen()).toBe(day('2026-11-18'));
    expect(next).toHaveFocus();
  });

  it('leaves focus on a month button pressed after a key stopped at today', () => {
    renderCalendar({ today: '2026-11-10' });
    key('ArrowRight');
    expect(chosen()).toBe(day('2026-11-10'));
    const previous = screen.getByRole('button', { name: 'Previous month' });
    previous.focus();
    fireEvent.click(previous);
    expect(chosen()).toBe(day('2026-10-10'));
    expect(previous).toHaveFocus();
  });

  it('keeps its choice when today moves on while it is open', () => {
    const { rerender, props } = renderCalendar();
    fireEvent.click(day('2026-10-10'));
    rerender(<DailyDialog {...props} today="2026-10-14" />);
    expect(chosen()).toBe(day('2026-10-10'));
    expect(day('2026-10-14')).toHaveAttribute('aria-current', 'date');
  });

  describe('in October 2026, the month the dailies launched', () => {
    const BEFORE_LAUNCH = [
      ['2026-10-01', 'Thursday 1 October'],
      ['2026-10-02', 'Friday 2 October'],
      ['2026-10-03', 'Saturday 3 October'],
      ['2026-10-04', 'Sunday 4 October'],
      ['2026-10-05', 'Monday 5 October'],
      ['2026-10-06', 'Tuesday 6 October'],
    ];

    it('greys out 1–6 October like the days to come, with no daily to play', () => {
      renderCalendar({ today: '2026-10-13' });
      for (const [date, name] of BEFORE_LAUNCH) {
        expect(day(date)).toHaveAccessibleName(`${name}: no daily`);
        expect(day(date)).toHaveAttribute('aria-disabled', 'true');
        expect(day(date)).toHaveClass('calendar__day--unavailable');
        expect(day(date).querySelector('.daily-mark')).toBeNull();
        // Pressed, it neither takes focus nor becomes the choice.
        expect(fireEvent.mouseDown(day(date))).toBe(false);
        fireEvent.click(day(date));
        expect(chosen()).toBe(day('2026-10-13'));
      }
    });

    it('opens on launch day, 7 October, as Daily #1: the first day to play', () => {
      renderCalendar({ today: '2026-10-07' });
      expect(chosen()).toBe(day('2026-10-07'));
      expect(day('2026-10-07')).toHaveAccessibleName(
        'Wednesday 7 October: Easy, Medium, Hard and Expert not started',
      );
      expect(day('2026-10-07')).not.toHaveAttribute('aria-disabled');
      expect(day('2026-10-07').querySelectorAll('.daily-mark')).toHaveLength(4);
      expect(screen.getByText('Today · Daily #1')).toBeVisible();
      for (const button of within(panel()).getAllByRole('button')) expect(button).toBeEnabled();
    });

    it('keeps the previous-month button greyed out, and doing nothing, all October', () => {
      renderCalendar({ today: '2026-10-13' });
      const previous = screen.getByRole('button', { name: 'Previous month' });
      expect(previous).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(previous);
      expect(grid()).toHaveAccessibleName('October 2026');
      expect(chosen()).toBe(day('2026-10-13'));
    });

    it.each<[string, Partial<KeyboardEventInit>]>([
      ['ArrowLeft', {}],
      ['ArrowUp', {}],
      ['Home', {}],
      ['PageUp', {}],
      ['PageUp', { shiftKey: true }],
    ])('never lands before 7 October on %s %o from it', (name, init) => {
      renderCalendar({ today: '2026-10-13' });
      fireEvent.click(day('2026-10-07'));
      chosen().focus();
      key(name, init);
      expect(chosen()).toBe(day('2026-10-07'));
      expect(day('2026-10-07')).toHaveFocus();
      expect(grid()).toHaveAccessibleName('October 2026');
    });

    it.each(['ArrowLeft', 'ArrowUp', 'Home', 'PageUp'])(
      'leaves focus on a month button pressed after %s stopped at 7 October',
      (name) => {
        renderCalendar({ today: '2026-11-10' });
        fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
        fireEvent.click(day('2026-10-07'));
        chosen().focus();
        key(name);
        expect(chosen()).toBe(day('2026-10-07'));
        const next = screen.getByRole('button', { name: 'Next month' });
        next.focus();
        fireEvent.click(next);
        expect(chosen()).toBe(day('2026-11-07'));
        expect(next).toHaveFocus();
      },
    );

    it('stops at 7 October, not the Monday before it, on Home from later that week', () => {
      renderCalendar({ today: '2026-10-09' });
      key('Home');
      expect(chosen()).toBe(day('2026-10-07'));
    });
  });

  it('offers nothing to play on a device whose clock is set before Daily #1', () => {
    renderCalendar({ today: '2026-09-20' });
    expect(chosen()).toBe(day('2026-10-07'));
    expect(day('2026-10-07')).toHaveAttribute('aria-disabled', 'true');
    for (const button of within(panel()).getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('shows the days and streaks the ledger keeps, once their records are pruned', () => {
    const ledger = new Map([
      ['2026-10-12', { hard: 'solved-on-the-day' as const }],
      ['2026-10-13', { hard: 'solved-on-the-day' as const }],
    ]);
    renderCalendar({ records: [], ledger });
    expect(day('2026-10-12')).toHaveAccessibleName(
      'Monday 12 October: Easy, Medium and Expert not started, Hard solved on the day',
    );
    const hard = within(screen.getByRole('region', { name: 'Streaks' }))
      .getAllByRole('listitem')
      .find((item) => item.textContent?.startsWith('Hard'))!;
    expect(hard).toHaveTextContent('Hardcurrent streak 2 daysBest 2');
    // Its day panel says so, with no time to show, and offers it again.
    fireEvent.click(day('2026-10-12'));
    expect(
      screen.getByRole('button', { name: 'Play again, Hard daily for Monday 12 October' }),
    ).toBeVisible();
  });

  it('closes', () => {
    const { props } = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
