import { fireEvent, render, screen, within } from '@testing-library/react';
import { createGame, formatGrid, hintBoardOf, parseGrid, reduce, type Puzzle } from '../../core';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../../test/grids';
import { StruckDialog } from './StruckDialog';

/*
 * The Wikipedia puzzle in auto candidate mode, the answer of row 1, column 4
 * (cell 3, candidates 2 and 6) — a 6 — struck out.
 */
const PUZZLE: Puzzle = {
  givens: formatGrid(parseGrid(WIKIPEDIA_PUZZLE)),
  solution: formatGrid(parseGrid(WIKIPEDIA_SOLUTION)),
  difficulty: 'easy',
};
const board = hintBoardOf(
  reduce(createGame(PUZZLE, { autoCandidates: true }), {
    type: 'enter',
    digit: 6,
    index: 3,
    mode: 'candidate',
  }),
);

function renderPage(autoCandidates = true, charge: string | null = null) {
  const onPutBack = vi.fn();
  const onClose = vi.fn();
  render(
    <StruckDialog
      index={3}
      digit={6}
      board={board}
      autoCandidates={autoCandidates}
      charge={charge}
      onPutBack={onPutBack}
      onClose={onClose}
    />,
  );
  return { onPutBack, onClose };
}

const dialog = () => screen.getByRole('dialog', { name: 'Why row 1, column 4 can still be 6' });

describe('StruckDialog', () => {
  it('names the digit, and says nothing on the board rules it out yet', () => {
    renderPage();
    expect(dialog()).toHaveAccessibleDescription(
      '6 has been crossed out of its candidates, but nothing on the board rules it out yet.',
    );
  });

  it('shows what opening it cost after its introduction, as Show me does, and nothing when free', () => {
    renderPage(true, '3 hints used.');
    expect(dialog()).toHaveAccessibleDescription(
      '6 has been crossed out of its candidates, but nothing on the board rules it out yet. ' +
        '3 hints used.',
    );
    expect(screen.getByText('3 hints used.')).toHaveClass('walkthrough__charge');
  });

  it('says no cost when opening it was free', () => {
    renderPage();
    expect(document.querySelector('.walkthrough__charge')).toBeNull();
  });

  it('draws the board as the player has it, named by why the digit is still possible', () => {
    renderPage();
    expect(within(dialog()).getByRole('img')).toHaveAccessibleName(
      "There's no 6 in row 1, in column 4 or in box 2, and no pattern among the candidates " +
        'rules a 6 out of row 1, column 4.',
    );
    // The cell, its houses, the 6s alone, and the struck 6 as the player's own doing.
    const key = dialog().querySelector('.technique-diagram__key')!;
    expect(key).toHaveTextContent('The cell missing it');
    expect(key).toHaveTextContent('Where to look');
    expect(key).toHaveTextContent('Crossed out by you');
    expect(key).toHaveTextContent('Candidates shown: 6s only');
    expect(key).not.toHaveTextContent('The pattern');
    expect(key).not.toHaveTextContent('The cell being solved');
    const ruledOut = dialog().querySelectorAll('[data-mark="ruled-out"]');
    expect([...ruledOut].map((mark) => mark.textContent)).toEqual(['6']);
  });

  it('says "an 8"', () => {
    render(
      <StruckDialog
        index={3}
        digit={8}
        board={board}
        autoCandidates
        onPutBack={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(/rules an 8 out of row 1, column 4\.$/);
  });

  it('says what to do about it, and does it with its first button', () => {
    const { onPutBack, onClose } = renderPage();
    expect(dialog()).toHaveTextContent(
      'Put it back: Row 1, column 4 can still be 6, so keep it among its candidates until ' +
        'something rules it out — and hints can carry on from your candidates.',
    );
    const putBack = screen.getByRole('button', { name: 'Put the 6 back' });
    // Where focus starts: what the page is for, and an ordinary move Undo takes back.
    expect(putBack).toHaveFocus();
    fireEvent.click(putBack);
    expect(onPutBack).toHaveBeenCalledTimes(1);
    // Left out after all: closed as any page is.
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('speaks of notes, outside auto candidate mode, where the digit was never pencilled in', () => {
    const { onPutBack } = renderPage(false);
    expect(dialog()).toHaveAccessibleDescription(
      "6 isn't in your notes here, but nothing on the board rules it out yet.",
    );
    expect(dialog().querySelector('.technique-diagram__key')).toHaveTextContent(
      'Not in your notes',
    );
    expect(dialog()).toHaveTextContent(
      'Pencil it in: Row 1, column 4 can still be 6, so keep it in your notes until ' +
        'something rules it out — and hints can carry on from your notes.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pencil in the 6' }));
    expect(onPutBack).toHaveBeenCalledTimes(1);
  });
});
