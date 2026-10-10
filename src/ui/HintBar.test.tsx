import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Hint } from '../core';
import { HintBar, type HintBarProps } from './HintBar';
import type { Notice } from './useSudoku';

const NOTICE: Notice = {
  kind: 'boardFull',
  text: "The board is full, but something isn't right.",
  id: 1,
};

function renderBar(props: Partial<HintBarProps> = {}) {
  const all: HintBarProps = {
    hint: null,
    notice: null,
    onDismissNotice: vi.fn(),
    onOpenGuide: vi.fn(),
    ...props,
  };
  return { ...render(<HintBar {...all} />), props: all };
}

describe('HintBar', () => {
  it('shows the hint in words, technique and all', () => {
    renderBar({
      hint: { kind: 'single', index: 3, technique: 'nakedSingle', unit: null },
      notice: NOTICE,
    });
    expect(
      screen.getByText(/^Naked single: only one number fits in this cell\./),
    ).toBeInTheDocument();
    // A hint takes the bar first.
    expect(screen.queryByText(NOTICE.text)).not.toBeInTheDocument();
  });

  it.each<[Hint, string, string]>([
    [
      { kind: 'single', index: 3, technique: 'hiddenSingleLine', unit: { kind: 'row', index: 0 } },
      "What's a hidden single?",
      'hiddenSingle',
    ],
    [{ kind: 'deduction', index: 3, technique: 'xWing' }, "What's an X-Wing?", 'xWing'],
    [
      { kind: 'deduction', index: 3, technique: 'claiming' },
      "What's a box/line reduction?",
      'claiming',
    ],
  ])(
    'asks about the technique a hint names, and opens the guide at it (%#)',
    (hint, question, entry) => {
      const { props } = renderBar({ hint });
      fireEvent.click(screen.getByRole('button', { name: question }));
      expect(props.onOpenGuide).toHaveBeenCalledExactlyOnceWith(entry);
    },
  );

  it.each<Hint>([
    { kind: 'mistake', index: 3 },
    { kind: 'struck', index: 3 },
    { kind: 'deduction', index: 3, technique: null },
    { kind: 'none' },
  ])('asks nothing when the hint names no technique (%o)', (hint) => {
    renderBar({ hint });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the question’s words as its name when only an icon shows', () => {
    // The stylesheet shows the icon alone on the narrowest phones; the words
    // stay in the page for assistive technology.
    renderBar({ hint: { kind: 'deduction', index: 3, technique: 'xyWing' } });
    const button = screen.getByRole('button', { name: "What's an XY-Wing?" });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('offers "Show me" for a hint with a walkthrough, named for the cell it solves', () => {
    const onShowMe = vi.fn();
    renderBar({ hint: { kind: 'deduction', index: 37, technique: 'hiddenPair' }, onShowMe });
    const show = screen.getByRole('button', { name: 'Show me how to solve row 5, column 2' });
    // Its words are its name's first: what a voice-control user says is what they see.
    expect(show).toHaveTextContent(/^Show me$/);
    expect(show.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(show);
    expect(onShowMe).toHaveBeenCalledTimes(1);
    // After the question, which still opens the guide.
    expect(screen.getAllByRole('button').map((button) => button.className)).toEqual([
      'hint-bar__question',
      'hint-bar__show',
    ]);
  });

  it('offers "Show me" for a wrong-marks hint, named for what it shows, with no digit in sight', () => {
    const onShowMe = vi.fn();
    const { container } = renderBar({ hint: { kind: 'struck', index: 9 }, onShowMe });
    expect(container).toHaveTextContent(
      "This cell is missing a candidate that can't be ruled out yet. Show me",
    );
    const show = screen.getByRole('button', { name: "Show me what's missing in row 2, column 1" });
    expect(show).toHaveTextContent(/^Show me$/);
    fireEvent.click(show);
    expect(onShowMe).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('offers no "Show me" for a hint without a walkthrough', () => {
    renderBar({ hint: { kind: 'deduction', index: 37, technique: 'hiddenPair' } });
    expect(screen.queryByRole('button', { name: /^Show me/ })).not.toBeInTheDocument();
  });

  it('offers no "Show me" when the puzzle is complete, whatever it is given', () => {
    renderBar({ hint: { kind: 'none' }, onShowMe: vi.fn() });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('gives the hint’s words, and only them, the id a cell can be described by', () => {
    renderBar({
      hint: { kind: 'deduction', index: 37, technique: 'hiddenPair' },
      textId: 'hint-text',
      onShowMe: vi.fn(),
    });
    expect(document.getElementById('hint-text')).toHaveTextContent(
      /^Look here — a hidden pair will unlock this cell\.$/,
    );
  });

  it('shows a notice the player can dismiss', () => {
    const { props } = renderBar({ notice: NOTICE });
    expect(screen.getByText(NOTICE.text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismissNotice).toHaveBeenCalledTimes(1);
  });

  it('keeps its place when it has nothing to say', () => {
    const { container } = renderBar();
    expect(container.querySelector('.hint-bar')).toBeEmptyDOMElement();
  });
});
