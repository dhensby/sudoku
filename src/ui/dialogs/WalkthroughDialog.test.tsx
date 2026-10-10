import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  createBoard,
  createGame,
  explainCell,
  explainHint,
  findHint,
  gridValues,
  hintBoardOf,
  reduce,
  type Digit,
  type GameAction,
  type Walkthrough,
} from '../../core';
import {
  STUCK_ON_AN_XY_CHAIN,
  STUCK_ON_A_HIDDEN_PAIR,
  stuckOnAHiddenPair,
} from '../../test/logic-fixtures';
import { walkthroughCaption } from '../techniqueGuide';
import { walkthroughIntro } from './text';
import { WalkthroughDialog } from './WalkthroughDialog';

/**
 * The walkthrough behind the report that started "Show me": a player stuck
 * on row 5, column 2, whose hint named a hidden pair half a board away.
 */
function stuck(): Walkthrough {
  const { values, solution } = stuckOnAHiddenPair();
  return explainCell(createBoard(values), STUCK_ON_A_HIDDEN_PAIR.target, solution)!;
}

function renderWalkthrough(
  walkthrough: Walkthrough = stuck(),
  initialStep?: number,
  autoCandidates?: boolean,
) {
  const onOpenGuide = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <WalkthroughDialog
      walkthrough={walkthrough}
      initialStep={initialStep}
      onOpenGuide={onOpenGuide}
      autoCandidates={autoCandidates}
      onClose={onClose}
    />,
  );
  return { ...view, walkthrough, onOpenGuide, onClose };
}

const dialog = (position = 'row 5, column 2') =>
  screen.getByRole('dialog', { name: `How to solve ${position}` });

/** The step's heading: the one third-level heading. */
const stepHeading = () => screen.getByRole('heading', { level: 3 });

const pager = () => screen.getByRole('navigation', { name: 'Steps' });

/** The answer's label (the diagram's key has "The answer" too, for its frame). */
const ANSWER = '.walkthrough__answer-label';
const answer = () => screen.getByText('The answer', { selector: ANSWER });

describe('WalkthroughDialog', () => {
  it('names the cell it solves, and says what the small numbers are: the player’s notes', () => {
    renderWalkthrough();
    expect(dialog()).toHaveAccessibleDescription(walkthroughIntro(false));
    // Their own notes, a cell with none counting as having every candidate.
    expect(walkthroughIntro(false)).toMatch(
      /your own notes, less what earlier steps rule out.*noted none.*every number/,
    );
  });

  it('shows what opening it cost after its introduction, and says it with its description', () => {
    render(
      <WalkthroughDialog
        walkthrough={stuck()}
        charge="2 hints used."
        onOpenGuide={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(dialog()).toHaveAccessibleDescription(`${walkthroughIntro(false)} 2 hints used.`);
    // On show, for a sighted player: the help taken is veiled behind the dialog.
    expect(screen.getByText('2 hints used.')).toHaveClass('walkthrough__charge');
    expect(screen.getByText('2 hints used.')).not.toHaveClass('visually-hidden');
  });

  it('says no cost when it was free', () => {
    renderWalkthrough();
    expect(document.querySelector('.walkthrough__charge')).toBeNull();
    expect(dialog()).toHaveAccessibleDescription(walkthroughIntro(false));
  });

  it('says the small numbers are the automatic candidates less strikes, in that mode', () => {
    renderWalkthrough(undefined, undefined, true);
    expect(dialog()).toHaveAccessibleDescription(walkthroughIntro(true));
    expect(walkthroughIntro(true)).toMatch(
      /your own candidates, without any you've crossed out, less what earlier steps rule out/,
    );
  });

  it('credits the player with what they had ruled out, in words and on the board', () => {
    // The report that asked for it: the 2s struck from row 8, column 9 and
    // row 9, column 9, which the walkthrough's XY-Chain relies on.
    const { givens, solution, entries, strikes, target } = STUCK_ON_AN_XY_CHAIN;
    const enter =
      (mode: 'normal' | 'candidate') =>
      ([row, col, digit]: readonly [number, number, number]): GameAction => ({
        type: 'enter',
        index: (row - 1) * 9 + col - 1,
        digit: digit as Digit,
        mode,
      });
    const game = [...entries.map(enter('normal')), ...strikes.map(enter('candidate'))].reduce(
      reduce,
      createGame({ givens, solution, difficulty: 'expert' }, { autoCandidates: true }),
    );
    const walkthrough = explainCell(hintBoardOf(game), target, gridValues(solution))!;
    const chain = walkthrough.steps.findIndex(({ step }) => step.technique === 'xyChain');
    renderWalkthrough(walkthrough, chain);
    expect(within(dialog('row 2, column 1')).getByRole('img')).toHaveAccessibleName(
      expect.stringContaining("You'd already ruled out 2 from row 9, column 9."),
    );
    expect(screen.getByText('Ruled out by you')).toBeInTheDocument();
  });

  it('marks the line about the small numbers read once the reader moves on, and still describes the card', () => {
    renderWalkthrough();
    const intro = screen.getByText(walkthroughIntro(false));
    expect(intro).not.toHaveAttribute('data-read');
    fireEvent.click(within(pager()).getByRole('button', { name: /^Next/ }));
    expect(intro).toHaveAttribute('data-read');
    expect(dialog()).toHaveAccessibleDescription(walkthroughIntro(false));
    fireEvent.click(within(pager()).getByRole('button', { name: /^Previous/ }));
    expect(intro).not.toHaveAttribute('data-read');
  });

  it('opens at its first step, the heading focused, so a screen reader starts with where it is', () => {
    renderWalkthrough();
    expect(stepHeading()).toHaveAccessibleName('Step 1 of 3: Hidden pair');
    expect(stepHeading()).toHaveFocus();
    // Focused from script only, never a tab stop of its own.
    expect(stepHeading()).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('article', { name: 'Step 1 of 3: Hidden pair' })).toBeInTheDocument();
  });

  it('draws each step on the board as it stands, named by its caption', () => {
    const { walkthrough } = renderWalkthrough();
    const [first] = walkthrough.steps;
    expect(within(dialog()).getByRole('img')).toHaveAccessibleName(walkthroughCaption(first, []));
    // The cell being solved is marked on every step.
    expect(screen.getByText('The cell being solved')).toBeInTheDocument();
  });

  it('walks forward and back with Next and Previous, each naming the step it goes to', () => {
    const { walkthrough, container } = renderWalkthrough();
    const body = container.ownerDocument.querySelector<HTMLElement>('.dialog__body')!;
    expect(within(pager()).queryByRole('button', { name: /^Previous/ })).not.toBeInTheDocument();

    body.scrollTop = 120;
    fireEvent.click(within(pager()).getByRole('button', { name: 'Next: Pointing pair or triple' }));
    expect(stepHeading()).toHaveAccessibleName('Step 2 of 3: Pointing pair or triple');
    expect(stepHeading()).toHaveFocus();
    // Back at the top of the new step.
    expect(body.scrollTop).toBe(0);
    // Its caption credits the step before with what it relies on, and the
    // board shows it struck.
    expect(within(dialog()).getByRole('img')).toHaveAccessibleName(
      walkthroughCaption(walkthrough.steps[1], walkthrough.steps.slice(0, 1)),
    );
    expect(within(dialog()).getByRole('img')).toHaveAccessibleName(
      /^Step 1 removed 5 from row 4, column 6\./,
    );
    expect(screen.getByText('Removed in an earlier step')).toBeInTheDocument();

    fireEvent.click(within(pager()).getByRole('button', { name: 'Previous: Hidden pair' }));
    expect(stepHeading()).toHaveAccessibleName('Step 1 of 3: Hidden pair');
    expect(stepHeading()).toHaveFocus();
  });

  it('ends with the answer, and Done', () => {
    const { onClose } = renderWalkthrough(stuck(), 2);
    expect(stepHeading()).toHaveAccessibleName('Step 3 of 3: Naked single');
    expect(answer().parentElement).toHaveTextContent('The answer: Row 5, column 2 must be 8.');
    expect(within(pager()).queryByRole('button', { name: /^Next/ })).not.toBeInTheDocument();
    expect(within(pager()).getByRole('button', { name: 'Previous: Pointing pair or triple' }));
    fireEvent.click(within(pager()).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('states no answer before the last step', () => {
    renderWalkthrough(stuck(), 1);
    expect(screen.queryByText('The answer', { selector: ANSWER })).not.toBeInTheDocument();
  });

  it('asks after each step’s technique, and opens the guide at it, saying where to come back to', () => {
    const { onOpenGuide } = renderWalkthrough(stuck(), 1);
    fireEvent.click(screen.getByRole('button', { name: "What's a pointing pair or triple?" }));
    expect(onOpenGuide).toHaveBeenCalledExactlyOnceWith('pointing', 1);
  });

  it('opens at the step it is asked for, kept to the steps it has', () => {
    renderWalkthrough(stuck(), 7);
    expect(stepHeading()).toHaveAccessibleName('Step 3 of 3: Naked single');
  });

  it('shows a single on its own: one step, the hint’s, and the answer', () => {
    // From the givens alone, the hint is a single.
    const { givens, solution } = stuckOnAHiddenPair();
    const hint = findHint(createBoard(givens), solution);
    expect(hint.kind).toBe('single');
    renderWalkthrough(explainHint(createBoard(givens), hint, solution)!);
    expect(stepHeading()).toHaveAccessibleName(/^Step 1 of 1: /);
    expect(answer()).toBeInTheDocument();
    expect(
      within(pager())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Done']);
  });

  it('closes with Escape, as every dialog does', () => {
    const { onClose } = renderWalkthrough();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
