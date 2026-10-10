import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Cell, type CellProps } from './Cell';

function renderCell(overrides: Partial<CellProps> = {}) {
  const props: CellProps = {
    index: 40,
    value: 0,
    given: false,
    mark: 'none',
    candidates: 0,
    highlight: 'selected',
    conflict: false,
    ghosts: 0x1ff,
    onSelect: vi.fn(),
    onToggleCandidate: vi.fn(),
    registerRef: vi.fn(),
    ...overrides,
  };
  // A gridcell belongs in a row of a grid.
  const view = render(
    <div role="grid">
      <div role="row">
        <Cell {...props} />
      </div>
    </div>,
  );
  return { ...view, props, cell: screen.getByRole('gridcell') };
}

const ghost = (digit: number) =>
  document.querySelector<HTMLElement>(`.cell__ghost[data-digit="${digit}"]`)!;

describe('Cell', () => {
  it('knows its place in the grid', () => {
    const { cell } = renderCell();
    expect(cell).toHaveAttribute('aria-rowindex', '5');
    expect(cell).toHaveAttribute('aria-colindex', '5');
  });

  it('toggles a candidate when a mouse clicks its spot in the selected cell', () => {
    const { props } = renderCell();
    fireEvent.pointerDown(ghost(6), { pointerType: 'mouse' });
    fireEvent.click(ghost(6));
    expect(props.onToggleCandidate).toHaveBeenCalledWith(40, 6);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('only selects when a finger taps a spot, which it could not see', () => {
    const { props } = renderCell();
    fireEvent.pointerDown(ghost(6), { pointerType: 'touch' });
    fireEvent.click(ghost(6));
    expect(props.onToggleCandidate).not.toHaveBeenCalled();
    expect(props.onSelect).toHaveBeenCalledWith(40);
  });

  it('only selects on a click the keyboard made', () => {
    // Enter on a focused cell clicks it with no pointer at all — and a mouse
    // press earlier must not linger and turn this into a toggle.
    const { props, cell } = renderCell();
    fireEvent.pointerDown(ghost(2), { pointerType: 'mouse' });
    fireEvent.click(ghost(2));
    fireEvent.click(cell);
    expect(props.onToggleCandidate).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(40);
  });

  it('only selects when the click misses every spot', () => {
    const { props, cell } = renderCell();
    fireEvent.pointerDown(cell, { pointerType: 'mouse' });
    fireEvent.click(cell);
    expect(props.onSelect).toHaveBeenCalledWith(40);
    expect(props.onToggleCandidate).not.toHaveBeenCalled();
  });

  it('draws no ghosts in a cell that cannot take them', () => {
    renderCell({ ghosts: 0, highlight: 'none' });
    expect(document.querySelector('.cell__ghosts')).toBeNull();
  });

  it('offers only the ghosts it is given, keeping each in its spot', () => {
    // In Auto Candidate Mode only the computed candidates can be toggled.
    const { props } = renderCell({ ghosts: 0b101 });
    expect(document.querySelectorAll('.cell__ghost')).toHaveLength(2);
    expect(ghost(1)).toBeInTheDocument();
    expect(ghost(3)).toBeInTheDocument();
    expect(document.querySelector('.cell__ghosts')?.children).toHaveLength(9);
    // A press on an empty spot only selects.
    const empty = document.querySelector('.cell__ghosts')!.children[1];
    fireEvent.pointerDown(empty, { pointerType: 'mouse' });
    fireEvent.click(empty);
    expect(props.onToggleCandidate).not.toHaveBeenCalled();
    expect(props.onSelect).toHaveBeenCalledWith(40);
  });

  it('hides what it draws from assistive technology, which hears its name', () => {
    const { cell, rerender, props } = renderCell({ candidates: 0b10100 });
    // The ghosts are not candidates, and must not be read as any.
    expect(cell).toHaveAccessibleName('empty, candidates 3 5');
    expect(document.querySelector('.cell__ghosts')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.cell__candidates')).toHaveAttribute('aria-hidden', 'true');
    rerender(
      <div role="grid">
        <div role="row">
          <Cell {...props} value={7} ghosts={0} />
        </div>
      </div>,
    );
    expect(document.querySelector('.cell__value')).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks the ghosts of candidates already on show, which a click removes', () => {
    const { props } = renderCell({ candidates: 0b100 });
    expect(ghost(3)).toHaveClass('cell__ghost--shown');
    expect(ghost(4)).not.toHaveClass('cell__ghost--shown');
    fireEvent.pointerDown(ghost(3), { pointerType: 'mouse' });
    fireEvent.click(ghost(3));
    expect(props.onToggleCandidate).toHaveBeenCalledWith(40, 3);
  });

  it('is described by the text it is pointed at: the hint it has had', () => {
    render(<p id="hint">Look here — a hidden pair will unlock this cell.</p>);
    const { cell } = renderCell({ describedBy: 'hint' });
    expect(cell).toHaveAccessibleDescription('Look here — a hidden pair will unlock this cell.');
    expect(cell).toHaveAccessibleName('empty');
  });

  it('selects when focus reaches it some other way', () => {
    const { props, cell } = renderCell({ highlight: 'none' });
    fireEvent.focus(cell);
    expect(props.onSelect).toHaveBeenCalledWith(40);
  });

  it('carries its classes for the stylesheet', () => {
    const { cell } = renderCell({
      value: 4,
      mark: 'correct',
      highlight: 'peer',
      conflict: true,
      ghosts: 0,
    });
    expect(cell).toHaveClass(
      'cell',
      'cell--player',
      'cell--peer',
      'cell--correct',
      'cell--conflict',
    );
    expect(cell).toHaveTextContent('4');
  });

  it('marks the candidate it is told is the selected number, and only that one', () => {
    renderCell({ candidates: (1 << 2) | (1 << 4), sameCandidate: 5, highlight: 'none', ghosts: 0 });
    const marked = document.querySelectorAll('.cell__candidate--same');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent('5');
    expect(document.querySelectorAll('.cell__candidate')).toHaveLength(9);
  });

  it('marks no candidate when there is no selected number to match', () => {
    renderCell({ candidates: (1 << 2) | (1 << 4), highlight: 'none', ghosts: 0 });
    expect(document.querySelector('.cell__candidate--same')).toBeNull();
  });

  it('ticks a checked-correct digit, out of hearing, and nothing else', () => {
    // Correct, revealed and the player's own inks differ by hue alone, which
    // a colour-blind player can lose: the tick says it in shape.
    const { cell, rerender, props } = renderCell({ value: 4, mark: 'correct', ghosts: 0 });
    const tick = () => document.querySelector('.cell__tick');
    expect(tick()).toHaveAttribute('aria-hidden', 'true');
    expect(cell).toHaveAccessibleName('4, correct');
    for (const mark of ['none', 'wrong', 'revealed'] as const) {
      rerender(
        <div role="grid">
          <div role="row">
            <Cell {...props} mark={mark} />
          </div>
        </div>,
      );
      expect(tick(), mark).toBeNull();
    }
  });

  it('does not re-render when nothing it shows has changed', () => {
    const { props, rerender } = renderCell();
    const calls = vi.mocked(props.registerRef).mock.calls.length;
    rerender(
      <div role="grid">
        <div role="row">
          <Cell {...props} />
        </div>
      </div>,
    );
    // An inline ref callback runs on every render, so an unchanged count
    // means the memo held.
    expect(vi.mocked(props.registerRef).mock.calls.length).toBe(calls);
  });
});
