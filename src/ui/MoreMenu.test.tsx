import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoreMenu, type MoreMenuProps } from './MoreMenu';

describe('MoreMenu', () => {
  function renderMore(overrides: Partial<MoreMenuProps> = {}) {
    const props: MoreMenuProps = {
      isDisabled: false,
      canCheckCell: true,
      canCheckPuzzle: true,
      canRevealCell: true,
      onHint: vi.fn(),
      onCheckCell: vi.fn(),
      onCheckPuzzle: vi.fn(),
      onRevealCell: vi.fn(),
      onReset: vi.fn(),
      ...overrides,
    };
    render(<MoreMenu {...props} />);
    return props;
  }

  it.each([
    ['Hint', 'onHint'],
    ['Check cell', 'onCheckCell'],
    ['Check puzzle', 'onCheckPuzzle'],
    ['Reveal cell', 'onRevealCell'],
    ['Reset puzzle…', 'onReset'],
  ] as const)('runs %s', (label, handler) => {
    const props = renderMore();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    expect(props[handler]).toHaveBeenCalledTimes(1);
  });

  it('disables what the selected cell cannot take', () => {
    renderMore({ canCheckCell: false, canRevealCell: false });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Check cell' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Reveal cell' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Hint' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Check puzzle' })).toBeEnabled();
  });

  it('disables Check puzzle when there is nothing on the board to check', () => {
    renderMore({ canCheckPuzzle: false });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Check puzzle' })).toBeDisabled();
  });

  it('says on Hint how many hints are used, in its name as well as on show', () => {
    const props = renderMore({ hintsUsed: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const hint = screen.getByRole('menuitem', { name: 'Hint (2 used)' });
    expect(hint).toHaveTextContent('Hint (2 used)');
    fireEvent.click(hint);
    expect(props.onHint).toHaveBeenCalledTimes(1);
  });

  it('says just "Hint" before any is used', () => {
    renderMore({ hintsUsed: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Hint' })).toHaveTextContent(/^Hint$/);
  });

  it('cannot be opened while the board is hidden or solved', () => {
    renderMore({ isDisabled: true });
    expect(screen.getByRole('button', { name: 'More' })).toBeDisabled();
  });
});
