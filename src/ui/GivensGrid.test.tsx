import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GivensGrid, type GivensGridProps } from './GivensGrid';

/** Row 1 reads 5 3 . . 5, two 5s; row 2 opens with a 6. */
const TYPED = '530050000' + '600000000' + '0'.repeat(63);

function renderGrid(overrides: Partial<GivensGridProps> = {}) {
  const props: GivensGridProps = {
    cells: TYPED,
    selected: 40,
    settings: { highlightRowColumn: true, highlightBox: true },
    onSelect: vi.fn(),
    onKeyDown: vi.fn(),
    ...overrides,
  };
  const view = render(<GivensGrid {...props} />);
  return { ...view, props };
}

const grid = () => screen.getByRole('grid', { name: 'Your puzzle' });
const cellAt = (index: number) => within(grid()).getAllByRole('gridcell')[index];

describe('GivensGrid', () => {
  it('declares the grid shape, and each row and cell its position, as the board does', () => {
    renderGrid();
    expect(grid()).toHaveAttribute('aria-rowcount', '9');
    expect(grid()).toHaveAttribute('aria-colcount', '9');
    const rows = within(grid()).getAllByRole('row');
    expect(rows).toHaveLength(9);
    expect(within(rows[4]).getAllByRole('gridcell')).toHaveLength(9);
    expect(cellAt(40)).toHaveAttribute('aria-rowindex', '5');
    expect(cellAt(40)).toHaveAttribute('aria-colindex', '5');
  });

  it('sets every number typed in as a given, for that is what it will be', () => {
    renderGrid();
    expect(cellAt(1)).toHaveAccessibleName('3, given');
    expect(cellAt(1)).toHaveClass('cell--given');
    expect(cellAt(9)).toHaveAccessibleName('6, given');
    expect(cellAt(2)).toHaveAccessibleName('empty');
    expect(cellAt(2)).not.toHaveClass('cell--given');
  });

  it('dots both numbers of a clash, whatever the board’s setting', () => {
    renderGrid();
    for (const index of [0, 4]) {
      expect(cellAt(index)).toHaveAccessibleName('5, given, conflict');
      expect(cellAt(index).querySelector('.cell__conflict')).not.toBeNull();
    }
    expect(document.querySelectorAll('.cell__conflict')).toHaveLength(2);
  });

  it('gives only the selected cell a tab stop, and the dialog its first focus there', () => {
    renderGrid();
    const cells = within(grid()).getAllByRole('gridcell');
    expect(cells.filter((cell) => cell.tabIndex === 0)).toEqual([cells[40]]);
    expect(cells.filter((cell) => cell.hasAttribute('data-autofocus'))).toEqual([cells[40]]);
    expect(cells[40]).toHaveAttribute('aria-selected', 'true');
    expect(cells[40]).toHaveClass('cell--selected');
  });

  it('tints the selection’s row, column and box as the settings tint the board’s', () => {
    const { rerender, props } = renderGrid();
    expect(cellAt(36)).toHaveClass('cell--peer'); // same row
    expect(cellAt(4)).toHaveClass('cell--peer'); // same column
    expect(cellAt(30)).toHaveClass('cell--peer'); // same box, other row and column
    expect(cellAt(0)).not.toHaveClass('cell--peer');
    rerender(
      <GivensGrid {...props} settings={{ highlightRowColumn: false, highlightBox: true }} />,
    );
    expect(cellAt(36)).not.toHaveClass('cell--peer');
    expect(cellAt(30)).toHaveClass('cell--peer');
    rerender(
      <GivensGrid {...props} settings={{ highlightRowColumn: true, highlightBox: false }} />,
    );
    expect(cellAt(36)).toHaveClass('cell--peer');
    expect(cellAt(30)).not.toHaveClass('cell--peer');
    // No same-number tint: the dots already find a number twice.
    expect(document.querySelectorAll('.cell--same')).toHaveLength(0);
  });

  it('selects and focuses a cell pressed, a number in it or not', () => {
    const { props } = renderGrid();
    fireEvent.click(cellAt(1));
    expect(props.onSelect).toHaveBeenCalledWith(1);
    expect(cellAt(1)).toHaveFocus();
  });

  it('moves focus with the selection while focus is in the grid', () => {
    const { rerender, props } = renderGrid();
    cellAt(40).focus();
    rerender(<GivensGrid {...props} selected={41} />);
    expect(cellAt(41)).toHaveFocus();
    // From the grid itself, pressed between two cells, too.
    grid().focus();
    rerender(<GivensGrid {...props} selected={42} />);
    expect(cellAt(42)).toHaveFocus();
  });

  it('leaves focus where it is as it arrives, for the dialog to move', () => {
    // The dialog takes it from whatever opened it, after the grid's effects
    // run: taken any sooner, the dialog would take the cell for its opener,
    // and have nothing to give focus back to as it closes.
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    renderGrid();
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('hands the keys pressed in it on, from a cell or from the grid itself', () => {
    const { props } = renderGrid();
    fireEvent.keyDown(cellAt(40), { key: '5', code: 'Digit5' });
    fireEvent.keyDown(grid(), { key: 'ArrowUp' });
    expect(props.onKeyDown).toHaveBeenCalledTimes(2);
    expect(vi.mocked(props.onKeyDown).mock.calls[0][0]).toMatchObject({ key: '5' });
  });
});
