import { Fragment, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Difficulty } from '../../core';
import { DIFFICULTY_LABEL } from '../format';
import { focusQuietly } from '../keepFocus';
import { TechniqueDiagram } from '../TechniqueDiagram';
import {
  GUIDE,
  GUIDE_ORDER,
  guideExamples,
  guideTier,
  guideTiers,
  type GuideId,
} from '../techniqueGuide';
import { Dialog } from './Dialog';

export interface TechniquesDialogProps {
  /** The entry to open at — the technique a hint named. The first entry when not given. */
  initial?: GuideId;
  onClose: () => void;
}

const TIERS: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

/** The entries under their tiers, each listed at the easiest tier it belongs to. */
const GROUPS = TIERS.map((tier) => ({
  tier,
  ids: GUIDE_ORDER.filter((id) => guideTier(id) === tier),
}));

/** "Also known as last remaining cell or last digit", each name set off in italics. */
function AlsoKnownAs({ names }: { names: readonly string[] }) {
  return (
    <p className="guide__aka">
      Also known as{' '}
      {names.map((name, i) => (
        <Fragment key={name}>
          {i > 0 && (i === names.length - 1 ? ' or ' : ', ')}
          <em>{name}</em>
        </Fragment>
      ))}
    </p>
  );
}

interface StepProps {
  direction: 'previous' | 'next';
  to: GuideId;
  onShow: (entry: GuideId, isFocusMoved: boolean) => void;
}

/**
 * Previous or Next, showing where it goes. Named in full ("Next: Swordfish")
 * by a label rather than by its two lines of text, which browsers join with
 * spaces of their own.
 */
function Step({ direction, to, onShow }: StepProps) {
  const word = direction === 'previous' ? 'Previous' : 'Next';
  const { title } = GUIDE[to];
  return (
    <button
      type="button"
      className={`guide__step guide__step--${direction}`}
      aria-label={`${word}: ${title}`}
      onClick={() => onShow(to, true)}
    >
      <span className="guide__step-label">
        {direction === 'previous' ? `← ${word}` : `${word} →`}
      </span>
      <span className="guide__step-title">{title}</span>
    </button>
  );
}

/**
 * The guide to the solving techniques: every technique the grader knows, by
 * tier, each with its other names, what it is, a worked example drawn from a
 * real puzzle, why it works and how to spot it.
 *
 * A list of the entries beside the open one on a wide screen; on a narrow
 * one (a phone's bottom sheet) a native picker above it, which the platform
 * draws at a size a finger can use. Previous and Next at the foot of each
 * entry walk the guide in order.
 *
 * Focus starts on the open entry's heading, so a screen reader begins with
 * the entry asked for, and moves to the new heading when the list or the
 * Previous and Next buttons change it — scrolled back to the top, since the
 * old entry's place means nothing in the new one. A choice in the picker
 * leaves focus in the picker, where the arrow keys are still choosing.
 */
export function TechniquesDialog({ initial, onClose }: TechniquesDialogProps) {
  const [current, setCurrent] = useState<GuideId>(initial ?? GUIDE_ORDER[0]);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const id = useId();

  const show = (next: GuideId, isFocusMoved: boolean) => {
    // Committed at once, so the new heading is there to focus.
    flushSync(() => setCurrent(next));
    // The dialog's body is what scrolls (see Dialog), and the guide is always in it.
    rootRef.current!.closest('.dialog__body')!.scrollTop = 0;
    if (isFocusMoved) focusQuietly(headingRef.current);
  };

  const entry = GUIDE[current];
  const at = GUIDE_ORDER.indexOf(current);
  const previous = GUIDE_ORDER[at - 1] as GuideId | undefined;
  const next = GUIDE_ORDER[at + 1] as GuideId | undefined;
  const tiers = guideTiers(current);
  const titleId = `${id}-title`;

  return (
    <Dialog title="Solving techniques" onClose={onClose} className="dialog--techniques">
      <div className="guide" ref={rootRef}>
        <nav className="guide__nav" aria-label="Techniques">
          {GROUPS.map(({ tier, ids }) => (
            <div key={tier} className="guide__group">
              <p className="guide__group-label" id={`${id}-${tier}`}>
                {DIFFICULTY_LABEL[tier]}
              </p>
              <ul className="guide__list" aria-labelledby={`${id}-${tier}`}>
                {ids.map((guideId) => (
                  <li key={guideId}>
                    <button
                      type="button"
                      className="guide__link"
                      aria-current={guideId === current ? 'true' : undefined}
                      onClick={() => show(guideId, true)}
                    >
                      {GUIDE[guideId].title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="guide__picker">
          <label className="visually-hidden" htmlFor={`${id}-picker`}>
            Technique
          </label>
          <select
            id={`${id}-picker`}
            className="guide__select"
            value={current}
            onChange={(event) => show(event.target.value as GuideId, false)}
          >
            {GROUPS.map(({ tier, ids }) => (
              <optgroup key={tier} label={DIFFICULTY_LABEL[tier]}>
                {ids.map((guideId) => (
                  <option key={guideId} value={guideId}>
                    {GUIDE[guideId].title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Keyed, so each entry arrives as new content rather than an edit of the last. */}
        <article key={current} className="guide__entry" aria-labelledby={titleId}>
          <header className="guide__header">
            <h3 className="guide__title" id={titleId} tabIndex={-1} ref={headingRef} data-autofocus>
              {entry.title}
            </h3>
            <p className="guide__tiers">
              <span className="visually-hidden">Difficulty: </span>
              {tiers.map(({ difficulty, label }, i) => (
                <Fragment key={difficulty}>
                  {i > 0 && <span className="visually-hidden">, </span>}
                  <span className="guide__tier">
                    <span className="guide__tier-name">{DIFFICULTY_LABEL[difficulty]}</span>
                    {label !== null && ` ${label.toLowerCase()}`}
                  </span>
                </Fragment>
              ))}
            </p>
          </header>
          {entry.aka.length > 0 && <AlsoKnownAs names={entry.aka} />}
          <p className="guide__summary">{entry.summary}</p>

          <div className="guide__examples">
            {guideExamples(current).map((example) => (
              <TechniqueDiagram
                key={example.technique}
                trace={example.trace}
                caption={example.caption}
                label={example.label}
              />
            ))}
          </div>

          <section className="guide__section" aria-labelledby={`${id}-how`}>
            <h4 className="guide__heading" id={`${id}-how`}>
              How it works
            </h4>
            {entry.explanation.map((paragraph) => (
              <p key={paragraph} className="guide__text">
                {paragraph}
              </p>
            ))}
          </section>
          <section className="guide__section" aria-labelledby={`${id}-spot`}>
            <h4 className="guide__heading" id={`${id}-spot`}>
              How to spot it
            </h4>
            <p className="guide__text">{entry.spot}</p>
          </section>

          <nav className="guide__pager" aria-label="Previous and next">
            {previous !== undefined && <Step direction="previous" to={previous} onShow={show} />}
            {next !== undefined && <Step direction="next" to={next} onShow={show} />}
          </nav>
        </article>
      </div>
    </Dialog>
  );
}
