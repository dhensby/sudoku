import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Walkthrough } from '../../core';
import { describePosition } from '../announce';
import { capitalise } from '../format';
import { BookIcon } from '../icons';
import { focusQuietly } from '../keepFocus';
import { TechniqueDiagram } from '../TechniqueDiagram';
import {
  GUIDE,
  creditsFor,
  guideIdFor,
  techniqueQuestion,
  walkthroughCaption,
  type GuideId,
} from '../techniqueGuide';
import { Dialog } from './Dialog';
import { WALKTHROUGH_INTRO } from './text';

export interface WalkthroughDialogProps {
  /** The steps that solve the cell, from the board as it stands. */
  walkthrough: Walkthrough;
  /** The step to open at, from 0: where the reader was before looking in the guide. */
  initialStep?: number;
  /** Open the guide at a step's technique; `step` is where to come back to. */
  onOpenGuide: (entry: GuideId, step: number) => void;
  onClose: () => void;
}

/** The title of a step: its technique as the guide names it. */
function stepTitle(walkthrough: Walkthrough, step: number): string {
  return GUIDE[guideIdFor(walkthrough.steps[step].step.technique)].title;
}

interface PageProps {
  direction: 'previous' | 'next';
  title: string;
  onClick: () => void;
}

/**
 * Previous or Next, showing which step it goes to, as the guide's do — and
 * named in full ("Next: Pointing pair or triple") by a label rather than by
 * its two lines of text, which browsers join with spaces of their own.
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
 * real board as it stands at that step — the cell being solved marked on
 * every one — with the guide's caption for its technique, a way into the
 * guide's entry for it, and, on the last, the answer.
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
  onOpenGuide,
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
    // Committed at once, so the new heading is there to focus.
    flushSync(() => setCurrent(step));
    // The dialog's body is what scrolls (see Dialog), and the steps are always in it.
    rootRef.current!.closest('.dialog__body')!.scrollTop = 0;
    focusQuietly(headingRef.current);
  };

  const trace = steps[current];
  const { technique } = trace.step;
  const isLast = current === steps.length - 1;
  const position = describePosition(target);
  const introId = `${id}-intro`;
  const headingId = `${id}-heading`;
  const count = `Step ${current + 1} of ${steps.length}`;
  const title = stepTitle(walkthrough, current);

  const footer = (
    <nav className="walkthrough__pager" aria-label="Steps">
      {current > 0 && (
        <Page
          direction="previous"
          title={stepTitle(walkthrough, current - 1)}
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
        <Page
          direction="next"
          title={stepTitle(walkthrough, current + 1)}
          onClick={() => show(current + 1)}
        />
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
          {WALKTHROUGH_INTRO}
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
          </header>
          <TechniqueDiagram
            trace={trace}
            caption={walkthroughCaption(trace, steps.slice(0, current))}
            target={target}
            ruledOut={creditsFor(trace.step, steps.slice(0, current)).flatMap(
              (credit) => credit.eliminations,
            )}
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
