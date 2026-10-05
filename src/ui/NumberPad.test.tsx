import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberPad, type NumberPadProps } from './NumberPad';

const NONE_PLACED = new Array<number>(10).fill(0);

function renderPad(overrides: Partial<NumberPadProps> = {}) {
  const props: NumberPadProps = {
    mode: 'normal',
    counts: NONE_PLACED,
    isDisabled: false,
    onDigit: vi.fn(),
    ...overrides,
  };
  render(
    <div>
      <NumberPad {...props} />
    </div>,
  );
  return props;
}

describe('NumberPad', () => {
  it('has a key for each digit, one to nine', () => {
    const props = renderPad();
    const keys = screen.getAllByRole('button');
    expect(keys.map((key) => key.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    expect(props.onDigit).toHaveBeenCalledWith(7);
  });

  it('gives each digit its mini-grid spot in candidate mode, for a 3×3 pad to place it', () => {
    renderPad({ mode: 'candidate' });
    const one = screen.getByRole('button', { name: '1' });
    const six = screen.getByRole('button', { name: '6' });
    expect(one).toHaveClass('numpad__key--candidate');
    expect(one.style.getPropertyValue('--spot-row')).toBe('1');
    expect(one.style.getPropertyValue('--spot-col')).toBe('1');
    expect(six.style.getPropertyValue('--spot-row')).toBe('2');
    expect(six.style.getPropertyValue('--spot-col')).toBe('3');
  });

  it('marks a digit placed nine times as done, and it still works', () => {
    const counts = [...NONE_PLACED];
    counts[4] = 9;
    const props = renderPad({ counts });
    const four = screen.getByRole('button', { name: '4, all placed' });
    expect(four).toHaveClass('numpad__key--done');
    expect(four).toBeEnabled();
    fireEvent.click(four);
    expect(props.onDigit).toHaveBeenCalledWith(4);
  });

  it('is inert while the board is hidden', () => {
    renderPad({ isDisabled: true });
    for (const key of screen.getAllByRole('button')) expect(key).toBeDisabled();
  });

  it('does not take focus from the board when clicked', () => {
    // Focus left on a cell keeps the keyboard there, and keeps Space for
    // the mode toggle instead of pressing this key again.
    renderPad();
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: '3' }))).toBe(false);
  });
});
