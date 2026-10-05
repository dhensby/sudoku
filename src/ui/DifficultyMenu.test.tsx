import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DifficultyMenu } from './DifficultyMenu';

describe('DifficultyMenu', () => {
  it('lists the four tiers easiest first as commands, the current one marked', () => {
    const onSelect = vi.fn();
    render(<DifficultyMenu current="hard" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    // Commands, not radio buttons: each starts a new game.
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((tier) => tier.textContent)).toEqual([
      'Easy',
      'Medium',
      'Hard',
      'Expert',
    ]);
    const hard = screen.getByRole('menuitem', { name: 'Hard (current)' });
    expect(hard.querySelector('.menu__check')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Easy' }).querySelector('.menu__check')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Expert' }));
    expect(onSelect).toHaveBeenCalledWith('expert');
  });

  it('starts a new game of the current tier too', () => {
    const onSelect = vi.fn();
    render(<DifficultyMenu current="hard" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hard (current)' }));
    expect(onSelect).toHaveBeenCalledWith('hard');
  });
});
