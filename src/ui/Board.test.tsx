import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createGame, reduce, type Digit, type GameAction, type GameState } from '../core';
import { Board, type BoardProps, type BoardSettings } from './Board';
import { FIRST_EMPTY, PUZZLE, answerAt, nearlySolved } from './testFixtures';

const ALL_ON: BoardSettings = {
  highlightRowColumn: true,
  highlightBox: true,
  highlightIdentical: true,
  highlightConflicts: true,
};

function play(...actions: GameAction[]): GameState {
  return actions.reduce(reduce, createGame(PUZZLE));
}

function renderBoard(overrides: Partial<BoardProps> = {}) {
  const props: BoardProps = {
    game: createGame(PUZZLE),
    settings: ALL_ON,
    isPlaying: true,
    isCelebrating: false,
    onSelect: vi.fn(),
    onToggleCandidate: vi.fn(),
    ...overrides,
  };
  const view = render(<Board {...props} />);
  return { ...view, props };
}

const cellAt = (index: number) => screen.getAllByRole('gridcell')[index];

describe('Board', () => {
  it('declares the grid shape, and each row and cell its position', () => {
    renderBoard();
    const grid = screen.getByRole('grid', { name: 'Sudoku board' });
    expect(grid).toHaveAttribute('aria-rowcount', '9');
    expect(grid).toHaveAttribute('aria-colcount', '9');
    const rows = within(grid).getAllByRole('row');
    expect(rows).toHaveLength(9);
    expect(rows[8]).toHaveAttribute('aria-rowindex', '9');
    const cells = within(rows[4]).getAllByRole('gridcell');
    expect(cells).toHaveLength(9);
    expect(cells[0]).toHaveAttribute('aria-colindex', '1');
    expect(cells[8]).toHaveAttribute('aria-colindex', '9');
    expect(cells[8]).toHaveAttribute('aria-rowindex', '5');
  });

  it('names each cell by its state alone', () => {
    // The Wikipedia puzzle opens 5 3 . . 7 …
    renderBoard({
      game: play(
        { type: 'enter', digit: 4, index: 2, mode: 'candidate' },
        { type: 'enter', digit: 1, index: 2, mode: 'candidate' },
        { type: 'enter', digit: 6, index: 3 },
      ),
    });
    expect(cellAt(0)).toHaveAccessibleName('5, given');
    expect(cellAt(2)).toHaveAccessibleName('empty, candidates 1 4');
    expect(cellAt(3)).toHaveAccessibleName('6');
    expect(cellAt(5)).toHaveAccessibleName('empty');
  });

  it('marks clashes, but only while conflicts are shown', () => {
    // A 5 beside the given 5 in row 1.
    const game = play({ type: 'enter', digit: 5, index: 2 });
    const { rerender, props } = renderBoard({ game });
    expect(cellAt(0)).toHaveAccessibleName('5, given, conflict');
    expect(cellAt(2)).toHaveAccessibleName('5, conflict');
    expect(cellAt(2).querySelector('.cell__conflict')).not.toBeNull();
    rerender(<Board {...props} settings={{ ...ALL_ON, highlightConflicts: false }} />);
    expect(cellAt(2)).toHaveAccessibleName('5');
    expect(cellAt(2).querySelector('.cell__conflict')).toBeNull();
  });

  it('says what Check and Reveal found', () => {
    const wrong = answerAt(2) === 9 ? 1 : 9;
    renderBoard({
      game: play(
        { type: 'enter', digit: wrong as Digit, index: 2 },
        { type: 'select', index: 2 },
        { type: 'check', scope: 'cell' },
        { type: 'select', index: 3 },
        { type: 'reveal' },
      ),
      settings: { ...ALL_ON, highlightConflicts: false },
    });
    expect(cellAt(2)).toHaveAccessibleName(`${wrong}, incorrect`);
    expect(cellAt(2)).toHaveClass('cell--wrong');
    expect(cellAt(3)).toHaveAccessibleName(`${answerAt(3)}, revealed`);
  });

  it('gives only the selected cell a tab stop, and marks it selected', () => {
    renderBoard();
    const cells = screen.getAllByRole('gridcell');
    expect(cells.filter((cell) => cell.tabIndex === 0)).toEqual([cells[FIRST_EMPTY]]);
    expect(cells[FIRST_EMPTY]).toHaveAttribute('aria-selected', 'true');
    expect(cells[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('describes the selected cell, and only it, by the text it is given', () => {
    const { rerender, props } = renderBoard({ describedBy: 'hint-text' });
    const cells = screen.getAllByRole('gridcell');
    expect(cells.filter((cell) => cell.hasAttribute('aria-describedby'))).toEqual([
      cells[FIRST_EMPTY],
    ]);
    expect(cells[FIRST_EMPTY]).toHaveAttribute('aria-describedby', 'hint-text');
    rerender(<Board {...props} describedBy={undefined} />);
    expect(cells[FIRST_EMPTY]).not.toHaveAttribute('aria-describedby');
  });

  it('tints the selected cell’s row, column and box', () => {
    // Select row 5, column 5 (index 40), a given 5 in the middle box.
    renderBoard({ game: play({ type: 'select', index: 40 }) });
    expect(cellAt(40)).toHaveClass('cell--selected');
    expect(cellAt(36)).toHaveClass('cell--peer'); // same row
    expect(cellAt(4)).toHaveClass('cell--peer'); // same column
    expect(cellAt(30)).toHaveClass('cell--peer'); // same box, other row and column
    expect(cellAt(0)).not.toHaveClass('cell--peer');
  });

  it('tints every cell holding the selected digit more strongly than a peer', () => {
    // Index 0 holds a given 5; so do several cells elsewhere.
    renderBoard({ game: play({ type: 'select', index: 0 }) });
    const fives = screen.getAllByRole('gridcell', { name: /^5\b/ });
    expect(fives.length).toBeGreaterThan(2);
    for (const cell of fives.slice(1)) expect(cell).toHaveClass('cell--same');
  });

  it('follows the highlighting settings', () => {
    renderBoard({
      game: play({ type: 'select', index: 40 }),
      settings: {
        highlightRowColumn: false,
        highlightBox: true,
        highlightIdentical: false,
        highlightConflicts: true,
      },
    });
    expect(cellAt(36)).not.toHaveClass('cell--peer');
    expect(cellAt(30)).toHaveClass('cell--peer');
    expect(document.querySelectorAll('.cell--same')).toHaveLength(0);
  });

  it('highlights nothing as the same when the selected cell is empty', () => {
    renderBoard();
    expect(document.querySelectorAll('.cell--same')).toHaveLength(0);
  });

  it('marks the selected number among the candidates, as it does the same numbers', () => {
    // Index 0 is a given 5; index 2 is empty, with notes 3 and 5.
    const game = play(
      { type: 'enter', digit: 3, index: 2, mode: 'candidate' },
      { type: 'enter', digit: 5, index: 2, mode: 'candidate' },
      { type: 'select', index: 0 },
    );
    const marked = () =>
      [...document.querySelectorAll('.cell__candidate--same')].map((spot) => spot.textContent);
    const { rerender, props } = renderBoard({ game });
    expect(marked()).toEqual(['5']);
    expect(cellAt(2).querySelector('.cell__candidate--same')).toHaveTextContent('5');

    rerender(<Board {...props} settings={{ ...ALL_ON, highlightIdentical: false }} />);
    expect(marked()).toEqual([]);

    // An empty cell selected has no number to mark.
    rerender(<Board {...props} game={reduce(game, { type: 'select', index: 2 })} />);
    expect(marked()).toEqual([]);
  });

  it('draws candidates in their spots, and none in a filled cell', () => {
    renderBoard({ game: play({ type: 'enter', digit: 9, index: 2, mode: 'candidate' }) });
    const spots = cellAt(2).querySelectorAll('.cell__candidates > .cell__candidate');
    expect(spots).toHaveLength(9);
    expect(spots[8]).toHaveTextContent('9');
    expect(spots[0]).toHaveTextContent('');
    expect(cellAt(0).querySelector('.cell__candidates')).toBeNull();
  });

  it('selects and focuses a clicked cell', () => {
    const { props } = renderBoard();
    fireEvent.click(cellAt(10));
    expect(props.onSelect).toHaveBeenCalledWith(10);
    expect(cellAt(10)).toHaveFocus();
  });

  it('moves focus with the selection while focus is on the board', () => {
    const { rerender, props } = renderBoard();
    cellAt(FIRST_EMPTY).focus();
    const moved = reduce(props.game, { type: 'move', direction: 'down' });
    rerender(<Board {...props} game={moved} />);
    expect(cellAt(moved.selected)).toHaveFocus();
  });

  it('leaves focus alone when it is elsewhere', () => {
    // A hint moving the selection while focus is in the "…" menu must not
    // yank focus onto the board.
    const { rerender, props } = renderBoard();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    rerender(<Board {...props} game={reduce(props.game, { type: 'move', direction: 'down' })} />);
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('takes focus on arrival when asked to', () => {
    const takeFocusRequest = vi.fn(() => true);
    renderBoard({ takeFocusRequest });
    expect(takeFocusRequest).toHaveBeenCalledTimes(1);
    expect(cellAt(FIRST_EMPTY)).toHaveFocus();
  });

  it('stays put when not asked to take focus', () => {
    renderBoard({ takeFocusRequest: () => false });
    expect(document.body).toHaveFocus();
  });

  it('offers ghost candidates only in the selected, empty, editable cell mid-game', () => {
    const { rerender, props } = renderBoard();
    expect(document.querySelectorAll('.cell__ghosts')).toHaveLength(1);
    expect(cellAt(FIRST_EMPTY).querySelector('.cell__ghosts')).not.toBeNull();
    rerender(<Board {...props} isPlaying={false} />);
    expect(document.querySelectorAll('.cell__ghosts')).toHaveLength(0);
    rerender(<Board {...props} game={play({ type: 'select', index: 0 })} />);
    expect(document.querySelectorAll('.cell__ghosts')).toHaveLength(0);
  });

  it('offers every digit as a ghost normally, but only the computed candidates in auto mode', () => {
    // Row 1, column 3 (the first empty cell) can take 1, 2 or 4.
    const { rerender, props } = renderBoard();
    const ghosts = () =>
      [...cellAt(FIRST_EMPTY).querySelectorAll<HTMLElement>('.cell__ghost')].map((ghost) =>
        Number(ghost.dataset.digit),
      );
    expect(ghosts()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const auto = play({ type: 'setAutoCandidates', enabled: true });
    rerender(<Board {...props} game={auto} />);
    expect(ghosts()).toEqual([1, 2, 4]);
    // One struck out is still offered, to put back.
    const struck = reduce(auto, { type: 'enter', digit: 2, mode: 'candidate' });
    rerender(<Board {...props} game={struck} />);
    expect(ghosts()).toEqual([1, 2, 4]);
  });

  it('is read-only and plays its wave once solved', () => {
    const near = nearlySolved([0]);
    const solved = reduce(createGame(near), { type: 'enter', digit: answerAt(0) as Digit });
    renderBoard({ game: solved, isCelebrating: true, isPlaying: false });
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByRole('grid')).toHaveClass('board--solved');
  });
});
