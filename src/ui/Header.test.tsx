import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Header, type HeaderProps } from './Header';
import { BookIcon, CalendarIcon, MenuIcon, MoreIcon } from './icons';

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    difficulty: 'medium',
    elapsedMs: 65_000,
    phase: 'playing',
    showTimer: true,
    today: {
      date: '2026-10-13',
      statuses: {
        easy: 'not-started',
        medium: 'not-started',
        hard: 'not-started',
        expert: 'not-started',
      },
    },
    onPause: vi.fn(),
    onResume: vi.fn(),
    onNewGame: vi.fn(),
    onOpenDaily: vi.fn(),
    onRefreshToday: vi.fn(),
    onOpenDialog: vi.fn(),
    ...overrides,
  };
  render(<Header {...props} />);
  return props;
}

/** The markup an icon draws, to tell one icon from another. */
const drawing = (icon: React.ReactElement) => render(icon).container.innerHTML;

describe('Header', () => {
  it('carries the wordmark, the tier and the time', () => {
    renderHeader();
    expect(screen.getByRole('heading', { level: 1, name: 'Sudoku' })).toBeInTheDocument();
    expect(screen.getByText('Medium').parentElement).toHaveTextContent(/^Difficulty: Medium/);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAccessibleDescription('1:05');
  });

  it('sets the tally it is given just before the timer, and makes room once it shows', () => {
    renderHeader({ tally: <p className="tally">Mistakes 2</p>, isTallyShown: true });
    const tally = screen.getByText('Mistakes 2');
    expect(tally.nextElementSibling).toHaveClass('header__timer');
    expect(document.querySelector('header')).toHaveClass('header', 'header--tally');
  });

  it('keeps an empty tally on the page without making room for it', () => {
    renderHeader({ tally: <div className="tally" />, isTallyShown: false });
    expect(document.querySelector('.tally')?.nextElementSibling).toHaveClass('header__timer');
    expect(document.querySelector('header')).not.toHaveClass('header--tally');
  });

  it('has no counter, nor says so, without one', () => {
    renderHeader({ daily: '2026-10-13' });
    expect(document.querySelector('header')?.className).toBe('header header--daily');
  });

  it('has a short tier name for a cramped header, which assistive technology skips', () => {
    // The stylesheet swaps it in when the header runs out of room; the full
    // name stays readable to a screen reader either way.
    renderHeader({ difficulty: 'expert' });
    expect(screen.getByText('Exp')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Expert')).not.toHaveAttribute('aria-hidden');
  });

  it.each([
    ['Daily puzzles', 'daily'],
    ['History', 'history'],
    ['Share', 'share'],
    ['Settings', 'settings'],
    ['Solving techniques', 'techniques'],
    ['Help', 'help'],
  ])('opens %s', (label, kind) => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(props.onOpenDialog).toHaveBeenCalledWith(kind);
  });

  it('draws the guide to the solving techniques as a book', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: 'Solving techniques' }).innerHTML).toBe(
      drawing(<BookIcon />),
    );
  });

  it.each(['Daily puzzles', 'History', 'Share', 'Settings', 'Solving techniques', 'Help'])(
    'does not take focus from the board when %s is clicked',
    (label) => {
      // Focus left on a cell keeps Space for the mode toggle, instead of
      // pressing this button again.
      renderHeader();
      expect(fireEvent.mouseDown(screen.getByRole('button', { name: label }))).toBe(false);
    },
  );

  it('draws the daily puzzles as a calendar', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: 'Daily puzzles' }).innerHTML).toBe(
      drawing(<CalendarIcon />),
    );
  });

  it('starts a new game from the New game menu', () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hard' }));
    expect(props.onNewGame).toHaveBeenCalledWith('hard');
  });

  it("opens today's dailies and the calendar from the New game menu, today worked out afresh", () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(props.onRefreshToday).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('menuitem', { name: "Today's Expert puzzle, not started" }));
    expect(props.onOpenDaily).toHaveBeenCalledWith('expert');
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Daily puzzles' }));
    expect(props.onOpenDialog).toHaveBeenCalledWith('daily');
  });

  it("marks no random tier as current while a past day's daily is on show", () => {
    renderHeader({ difficulty: 'hard', daily: '2026-10-08' });
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.queryByRole('menuitem', { name: /\(current\)/ })).not.toBeInTheDocument();
  });

  it('says a daily is one, beside its tier, and names its day for assistive technology', () => {
    renderHeader({ difficulty: 'medium', daily: '2026-10-13' });
    const container = document.body;
    const tier = container.querySelector('.header__difficulty')!;
    expect(tier).toHaveTextContent(
      'Daily puzzle for Tuesday 13 October. Difficulty: Daily · MediumMed',
    );
    expect(container.querySelector('.header__daily')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('header')).toHaveClass('header--daily');
  });

  it('says nothing of dailies for a random game', () => {
    renderHeader({ difficulty: 'medium' });
    const container = document.body;
    expect(container.querySelector('.header__difficulty')).toHaveTextContent(
      /^Difficulty: MediumMed$/,
    );
    expect(container.querySelector('header')).not.toHaveClass('header--daily');
  });

  it('folds the less-used actions into a menu for phones', () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const menu = screen.getByRole('menu', { name: 'Menu' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Daily puzzles', 'History', 'Share', 'Settings', 'Solving techniques', 'Help']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Settings' }));
    expect(props.onOpenDialog).toHaveBeenCalledWith('settings');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Solving techniques' }));
    expect(props.onOpenDialog).toHaveBeenCalledWith('techniques');
  });

  it("draws the phone menu unlike the game's … menu, so the two cannot be confused", () => {
    renderHeader();
    const icon = screen.getByRole('button', { name: 'Menu' }).innerHTML;
    expect(icon).toBe(drawing(<MenuIcon />));
    expect(icon).not.toBe(drawing(<MoreIcon />));
  });

  it('has nothing to share until there is a puzzle', () => {
    renderHeader({ phase: 'loading' });
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('menuitem', { name: 'Share' })).toBeDisabled();
  });
});
