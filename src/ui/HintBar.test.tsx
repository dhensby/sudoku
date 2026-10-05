import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HintBar } from './HintBar';
import type { Notice } from './useSudoku';

const NOTICE: Notice = {
  kind: 'boardFull',
  text: "The board is full, but something isn't right.",
  id: 1,
};

describe('HintBar', () => {
  it('shows the hint in words, technique and all', () => {
    render(
      <HintBar
        hint={{ kind: 'single', index: 3, technique: 'nakedSingle', unit: null }}
        notice={NOTICE}
        onDismissNotice={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Naked single: only one number fits in this cell.'),
    ).toBeInTheDocument();
    // A hint takes the bar first.
    expect(screen.queryByText(NOTICE.text)).not.toBeInTheDocument();
  });

  it('shows a notice the player can dismiss', () => {
    const onDismissNotice = vi.fn();
    render(<HintBar hint={null} notice={NOTICE} onDismissNotice={onDismissNotice} />);
    expect(screen.getByText(NOTICE.text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismissNotice).toHaveBeenCalledTimes(1);
  });

  it('keeps its place when it has nothing to say', () => {
    const { container } = render(<HintBar hint={null} notice={null} onDismissNotice={vi.fn()} />);
    expect(container.querySelector('.hint-bar')).toBeEmptyDOMElement();
  });
});
