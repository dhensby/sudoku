import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Header, type HeaderProps } from './Header';
import { BookIcon, MenuIcon, MoreIcon } from './icons';

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    difficulty: 'medium',
    elapsedMs: 65_000,
    phase: 'playing',
    showTimer: true,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onNewGame: vi.fn(),
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

  it('has a short tier name for a cramped header, which assistive technology skips', () => {
    // The stylesheet swaps it in when the header runs out of room; the full
    // name stays readable to a screen reader either way.
    renderHeader({ difficulty: 'expert' });
    expect(screen.getByText('Exp')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Expert')).not.toHaveAttribute('aria-hidden');
  });

  it.each([
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

  it.each(['History', 'Share', 'Settings', 'Solving techniques', 'Help'])(
    'does not take focus from the board when %s is clicked',
    (label) => {
      // Focus left on a cell keeps Space for the mode toggle, instead of
      // pressing this button again.
      renderHeader();
      expect(fireEvent.mouseDown(screen.getByRole('button', { name: label }))).toBe(false);
    },
  );

  it('starts a new game from the New game menu', () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hard' }));
    expect(props.onNewGame).toHaveBeenCalledWith('hard');
  });

  it('folds the less-used actions into a menu for phones', () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const menu = screen.getByRole('menu', { name: 'Menu' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['History', 'Share', 'Settings', 'Solving techniques', 'Help']);
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
