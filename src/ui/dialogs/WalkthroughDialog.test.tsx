import { fireEvent, render, screen, within } from '@testing-library/react';
import { createBoard, explainCell, findHint, explainHint, type Walkthrough } from '../../core';
import { STUCK_ON_A_HIDDEN_PAIR, stuckOnAHiddenPair } from '../../test/logic-fixtures';
import { walkthroughCaption } from '../techniqueGuide';
import { WALKTHROUGH_INTRO } from './text';
import { WalkthroughDialog } from './WalkthroughDialog';

/**
 * The walkthrough behind the report that started "Show me": a player stuck
 * on row 5, column 2, whose hint named a hidden pair half a board away.
 */
function stuck(): Walkthrough {
  const { values, solution } = stuckOnAHiddenPair();
  return explainCell(createBoard(values), STUCK_ON_A_HIDDEN_PAIR.target, solution)!;
}

function renderWalkthrough(walkthrough: Walkthrough = stuck(), initialStep?: number) {
  const onOpenGuide = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <WalkthroughDialog
      walkthrough={walkthrough}
      initialStep={initialStep}
      onOpenGuide={onOpenGuide}
      onClose={onClose}
    />,
  );
  return { ...view, walkthrough, onOpenGuide, onClose };
}

const dialog = () => screen.getByRole('dialog', { name: 'How to solve row 5, column 2' });

/** The step's heading: the one third-level heading. */
const stepHeading = () => screen.getByRole('heading', { level: 3 });

const pager = () => screen.getByRole('navigation', { name: 'Steps' });

/** The answer's label (the diagram's key has "The answer" too, for its frame). */
const ANSWER = '.walkthrough__answer-label';
const answer = () => screen.getByText('The answer', { selector: ANSWER });

describe('WalkthroughDialog', () => {
  it('names the cell it solves, and says what the small numbers are', () => {
    renderWalkthrough();
    expect(dialog()).toHaveAccessibleDescription(WALKTHROUGH_INTRO);
    expect(WALKTHROUGH_INTRO).toMatch(
      /filled-in digits.*less what earlier steps.*not your own notes/,
    );
  });

  it('marks the line about the small numbers read once the reader moves on, and still describes the card', () => {
    renderWalkthrough();
    const intro = screen.getByText(WALKTHROUGH_INTRO);
    expect(intro).not.toHaveAttribute('data-read');
    fireEvent.click(within(pager()).getByRole('button', { name: /^Next/ }));
    expect(intro).toHaveAttribute('data-read');
    expect(dialog()).toHaveAccessibleDescription(WALKTHROUGH_INTRO);
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
