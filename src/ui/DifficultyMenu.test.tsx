import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DifficultyMenu, type DifficultyMenuProps, type TodayDailies } from './DifficultyMenu';

const TODAY: TodayDailies = {
  date: '2026-10-13',
  statuses: {
    easy: 'solved-on-the-day',
    medium: 'in-progress',
    hard: 'not-started',
    expert: 'not-started',
  },
};

function renderMenu(overrides: Partial<DifficultyMenuProps> = {}) {
  const props: DifficultyMenuProps = {
    current: 'hard',
    today: TODAY,
    onSelect: vi.fn(),
    onSelectDaily: vi.fn(),
    onOpenCalendar: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
  render(<DifficultyMenu {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'New game' }));
  return props;
}

const group = (name: RegExp | string) => screen.getByRole('group', { name });

describe('DifficultyMenu', () => {
  it("offers today's puzzles first, then a random puzzle of each tier", () => {
    renderMenu();
    const groups = within(screen.getByRole('menu', { name: 'New game' })).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      "Today's puzzles, Tuesday 13 October",
      'Random puzzle',
    ]);
    // The date of today's puzzles shows beside the heading.
    expect(groups[0]).toHaveTextContent(/^Today's puzzlesTue 13 Oct/);
  });

  it("names each of today's dailies with how it stands, marked by shape", () => {
    renderMenu();
    const today = group(/^Today's puzzles/);
    expect(
      within(today)
        .getAllByRole('menuitem')
        .map((item) => item.getAttribute('aria-label') ?? item.textContent),
    ).toEqual([
      "Today's Easy puzzle, solved",
      "Today's Medium puzzle, in progress",
      "Today's Hard puzzle, not started",
      "Today's Expert puzzle, not started",
      'Daily puzzles',
    ]);
    const easy = within(today).getByRole('menuitem', { name: "Today's Easy puzzle, solved" });
    expect(easy).toHaveTextContent('EasySolved');
    expect(easy.querySelector('.daily-mark--solved-on-the-day')).not.toBeNull();
    const medium = within(today).getByRole('menuitem', { name: /Medium/ });
    expect(medium).toHaveTextContent('MediumIn progress');
    expect(medium.querySelector('.daily-mark--in-progress')).not.toBeNull();
    // Not started needs no words: its empty mark says it.
    const hard = within(today).getByRole('menuitem', { name: /Hard/ });
    expect(hard).toHaveTextContent(/^Hard$/);
    expect(hard.querySelector('.daily-mark--not-started')).not.toBeNull();
  });

  it('calls a daily solved later just solved, as the menu only offers today', () => {
    renderMenu({ today: { ...TODAY, statuses: { ...TODAY.statuses, easy: 'solved-later' } } });
    expect(screen.getByRole('menuitem', { name: "Today's Easy puzzle, solved" })).toBeVisible();
  });

  it("opens today's daily of a tier, and the calendar", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: "Today's Hard puzzle, not started" }));
    expect(props.onSelectDaily).toHaveBeenCalledWith('hard');
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Daily puzzles' }));
    expect(props.onOpenCalendar).toHaveBeenCalled();
  });

  it('lists the four random tiers easiest first as commands, the current one marked', () => {
    const props = renderMenu();
    const random = group('Random puzzle');
    // Commands, not radio buttons: each starts a new game.
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(
      within(random)
        .getAllByRole('menuitem')
        .map((tier) => tier.textContent),
    ).toEqual(['Easy', 'Medium', 'Hard', 'Expert']);
    const hard = within(random).getByRole('menuitem', { name: 'Hard (current)' });
    expect(hard.querySelector('.menu__check')).not.toBeNull();
    expect(
      within(random).getByRole('menuitem', { name: 'Easy' }).querySelector('.menu__check'),
    ).toBeNull();
    fireEvent.click(within(random).getByRole('menuitem', { name: 'Expert' }));
    expect(props.onSelect).toHaveBeenCalledWith('expert');
  });

  it('starts a new game of the current tier too', () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hard (current)' }));
    expect(props.onSelect).toHaveBeenCalledWith('hard');
  });

  it("marks no random tier as current while a daily is on show, but today's daily of its tier", () => {
    renderMenu({ dailyOnShow: TODAY.date });
    expect(within(group('Random puzzle')).getByRole('menuitem', { name: 'Hard' })).toBeVisible();
    const current = screen.getAllByRole('menuitem', { name: /\(current\)/ });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Today's Hard puzzle, not started (current)");
    expect(current[0].querySelector('.menu__check')).not.toBeNull();
  });

  it('ticks a solved daily on show once, as current, its status saying solved in words', () => {
    renderMenu({ current: 'easy', dailyOnShow: TODAY.date });
    const easy = screen.getByRole('menuitem', { name: "Today's Easy puzzle, solved (current)" });
    expect(easy).toHaveTextContent('EasySolved');
    expect(easy.querySelectorAll('svg.icon:not(.daily-mark)')).toHaveLength(1);
    expect(easy.querySelector('.menu__check')).not.toBeNull();
  });

  it("marks nothing as current while a past day's daily is on show", () => {
    renderMenu({ dailyOnShow: '2026-10-08' });
    expect(screen.queryByRole('menuitem', { name: /\(current\)/ })).not.toBeInTheDocument();
  });

  it('works out today afresh as it opens, so a menu opened after midnight is up to date', () => {
    const props = renderMenu();
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it('offers no daily on a device whose clock is set before Daily #1', () => {
    renderMenu({ today: { ...TODAY, date: '2026-10-06' } });
    expect(screen.getByRole('menuitem', { name: /^Today's Hard puzzle/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Daily puzzles' })).toBeEnabled();
  });

  it('offers today’s dailies from Daily #1, 7 October 2026, the day they launched', () => {
    renderMenu({ today: { ...TODAY, date: '2026-10-07' } });
    for (const tier of ['Easy', 'Medium', 'Hard', 'Expert']) {
      expect(
        screen.getByRole('menuitem', { name: new RegExp(`^Today's ${tier} puzzle`) }),
      ).toBeEnabled();
    }
  });

  it('moves through both runs with the arrow keys, as through one list', () => {
    renderMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(9);
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'End' });
    expect(items[8]).toHaveFocus();
    fireEvent.keyDown(items[8], { key: 'ArrowUp' });
    expect(items[7]).toHaveFocus();
    fireEvent.keyDown(items[7], { key: 'Home' });
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
  });
});
