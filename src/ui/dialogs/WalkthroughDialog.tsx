import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { StepNumber, Walkthrough } from '../../core';
import { describePosition } from '../announce';
import { capitalise } from '../format';
import { BookIcon } from '../icons';
import { focusQuietly } from '../keepFocus';
import { TechniqueDiagram } from '../TechniqueDiagram';
import {
  GUIDE,
  creditsFor,
  guideIdFor,
  ruledOutByYou,
  techniqueQuestion,
  walkthroughCaption,
  type GuideId,
} from '../techniqueGuide';
import { Dialog } from './Dialog';
import { walkthroughIntro } from './text';

export interface WalkthroughDialogProps {
  /** The steps that solve the cell, from the board as it stands. */
  walkthrough: Walkthrough;
  /** The step to open at, from 0: where the reader was before looking in the guide. */
  initialStep?: number;
  /**
   * Where the first step falls on the cell's route, as the hint bar numbers
   * it (see `stepNumbering`): with two steps of the route as first shown
   * behind, "Step 3 of 7" — and the pages go on from there. Step 1 of the
   * steps here by default.
   */
  numbering?: StepNumber;
  /**
   * What opening it cost ("2 hints used."), shown after its introduction and
   * so said with it as it opens: the game's status region is outside the
   * dialog, hidden from a screen reader behind it, and the help taken beside
   * the timer is under the dialog's veil until it closes (it ticks then).
   * Null when it was free: opened again for a hint already counted.
   */
  charge?: string | null;
  /**
   * What turning to a page cost ("3 hints used."), shown on that page — `step`
   * — under its heading, and said with it as focus moves to it: once, as it
   * is turned to. Null, or another page's, says nothing.
   */
  pageCharge?: { step: number; text: string } | null;
  /**
   * A page on show, turned to: each new page counts as a hint (the hook
   * keeps count, and hands back what it cost as `pageCharge`).
   */
  onStep?: (step: number) => void;
  /**
   * For each page, whether its step has been seen (see `Sudoku.seenPages`):
   * Previous and Next name the technique of a page seen, and only its
   * number for one not — that would tell, for free, what the page costs a
   * hint to see. Every page seen by default.
   */
  seenPages?: readonly boolean[];
  /** Open the guide at a step's technique; `step` is where to come back to. */
  onOpenGuide: (entry: GuideId, step: number) => void;
  /**
   * Whether the player's candidates are the automatic ones less their
   * strikes, or their notes: the opening line says which. Off by default,
   * as a new game is.
   */
  autoCandidates?: boolean;
  onClose: () => void;
}

/** The title of a step: its technique as the guide names it. */
function stepTitle(walkthrough: Walkthrough, step: number): string {
  return GUIDE[guideIdFor(walkthrough.steps[step].step.technique)].title;
}

interface PageProps {
  direction: 'previous' | 'next';
  /** The page's technique, once its step has been seen; else its number ("Step 4 of 7"). */
  title: string;
  onClick: () => void;
}

/**
 * Previous or Next, showing which step it goes to, as the guide's do — and
 * named in full ("Next: Pointing pair or triple", or "Next: Step 4 of 7"
 * for a page not yet seen) by a label rather than by its two lines of
 * text, which browsers join with spaces of their own.
 */
function Page({ direction, title, onClick }: PageProps) {
  const word = direction === 'previous' ? 'Previous' : 'Next';
  return (
    <button
      type="button"
      className={`walkthrough__page walkthrough__page--${direction}`}
      aria-label={`${word}: ${title}`}
      onClick={onClick}
    >
      <span className="walkthrough__page-label">
        {direction === 'previous' ? `← ${word}` : `${word} →`}
      </span>
      <span className="walkthrough__page-title">{title}</span>
    </button>
  );
}

/**
 * "Show me": the steps that solve one cell, one at a time, each drawn on the
 * player's own board — their candidates — as it stands at that step — the cell being solved marked on
 * every one — with the guide's caption for its technique, a way into the
 * guide's entry for it, and, on the last, the answer. Numbered as the hint
 * bar numbers the cell's route, so the page after the step the bar named is
 * the step after it; each page seen for the first time counts as a hint,
 * and says so.
 *
 * A carousel: Previous and Next are pinned at the foot, so on a phone they
 * stay under the thumb however long a caption is, and the last step ends
 * with Done. As in the guide, focus starts on the step's heading — "Step 1
 * of 3: Hidden pair" — so a screen reader begins with where it is, and moves
 * to the new heading with each step, the body scrolled back to the top.
 */
export function WalkthroughDialog({
  walkthrough,
  initialStep = 0,
  numbering,
  charge = null,
  pageCharge = null,
  onStep,
  seenPages,
  onOpenGuide,
  autoCandidates = false,
  onClose,
}: WalkthroughDialogProps) {
  const { steps, target, digit } = walkthrough;
  const [current, setCurrent] = useState(() =>
    Math.min(Math.max(initialStep, 0), steps.length - 1),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const id = useId();

  const show = (step: number) => {
    // Committed at once — the page, and what turning to it cost — so the new
    // heading is there to focus, described by its cost.
    flushSync(() => {
      setCurrent(step);
      onStep?.(step);
    });
    // The dialog's body is what scrolls (see Dialog), and the steps are always in it.
    rootRef.current!.closest('.dialog__body')!.scrollTop = 0;
    focusQuietly(headingRef.current);
  };

  const trace = steps[current];
  // The first step's board is the player's own candidates.
  const yours = ruledOutByYou(trace, steps[0]);
  const { technique } = trace.step;
  const isLast = current === steps.length - 1;
  const position = describePosition(target);
  const introId = `${id}-intro`;
  const headingId = `${id}-heading`;
  const chargeId = `${id}-charge`;
  const { step: first, of } = numbering ?? { step: 1, of: steps.length };
  const count = `Step ${first + current} of ${of}`;
  const turnCharge = pageCharge?.step === current ? pageCharge.text : null;
  const title = stepTitle(walkthrough, current);
  /** What Previous or Next calls page `step`: see `seenPages`. */
  const pageTitle = (step: number) =>
    seenPages?.[step] === false ? `Step ${first + step} of ${of}` : stepTitle(walkthrough, step);

  const footer = (
    <nav className="walkthrough__pager" aria-label="Steps">
      {current > 0 && (
        <Page
          direction="previous"
          title={pageTitle(current - 1)}
          onClick={() => show(current - 1)}
        />
      )}
      {isLast ? (
        <button
          type="button"
          className="button button--primary walkthrough__done"
          onClick={onClose}
        >
          Done
        </button>
      ) : (
        <Page direction="next" title={pageTitle(current + 1)} onClick={() => show(current + 1)} />
      )}
    </nav>
  );

  return (
    <Dialog
      title={`How to solve ${position}`}
      onClose={onClose}
      className="dialog--walkthrough"
      describedBy={introId}
      footer={footer}
    >
      <div className="walkthrough" ref={rootRef}>
        {/* Marked once the reader has moved on from it, so a phone on its
            side can give its lines to the step (see dialogs.css). */}
        <p className="walkthrough__intro" id={introId} data-read={current > 0 || undefined}>
          {walkthroughIntro(autoCandidates)}
          {charge !== null && (
            <>
              {' '}
              <span className="walkthrough__charge">{charge}</span>
            </>
          )}
        </p>
        {/* Keyed, so each step arrives as new content rather than an edit of the last. */}
        <article key={current} className="walkthrough__step" aria-labelledby={headingId}>
          <header className="walkthrough__header">
            <h3
              className="walkthrough__title"
              id={headingId}
              tabIndex={-1}
              ref={headingRef}
              // Named outright: its two lines are set as blocks, and browsers
              // join blocks' words with spaces of their own, or none.
              aria-label={`${count}: ${title}`}
              aria-describedby={turnCharge === null ? undefined : chargeId}
              data-autofocus
            >
              <span className="walkthrough__count">{count}</span>
              <span className="walkthrough__technique">{title}</span>
            </h3>
            <button
              type="button"
              className="walkthrough__question"
              onClick={() => onOpenGuide(guideIdFor(technique), current)}
            >
              <BookIcon className="walkthrough__question-icon" />
              {techniqueQuestion(technique)}
            </button>
            {turnCharge !== null && (
              <p className="walkthrough__charge walkthrough__charge--page" id={chargeId}>
                {turnCharge}
              </p>
            )}
          </header>
          <TechniqueDiagram
            trace={trace}
            caption={walkthroughCaption(trace, steps.slice(0, current), yours)}
            target={target}
            ruledOut={creditsFor(trace.step, steps.slice(0, current)).flatMap(
              (credit) => credit.eliminations,
            )}
            yours={yours}
            conclusion={
              isLast && (
                <p className="walkthrough__answer">
                  <span className="walkthrough__answer-label">The answer</span>
                  <span className="visually-hidden">: </span>
                  <span className="walkthrough__answer-text">
                    {capitalise(position)} must be <strong>{digit}</strong>.
                  </span>
                </p>
              )
            }
          />
        </article>
      </div>
    </Dialog>
  );
}
