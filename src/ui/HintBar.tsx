import type { Hint, TechniqueId, Unit } from '../core';
import {
  MOVED_ON,
  describeHardest,
  describeHint,
  describePosition,
  describeStep,
} from './announce';
import { CloseIcon, HelpIcon, HintIcon, PlayIcon } from './icons';
import { guideIdFor, techniqueQuestion, type GuideId } from './techniqueGuide';
import type { Notice } from './useSudoku';

export interface HintBarProps {
  /**
   * The hint on show, if the board is: the one just asked for, until the
   * next change of any kind, or else the selected cell's remembered hint.
   */
  hint: Hint | null;
  /**
   * The houses of the step a step hint names (see `Sudoku.hintHouses`), so
   * the words can say where a step with no one house of its own is; none by
   * default.
   */
  houses?: readonly Unit[];
  /**
   * Whether the step hint on show is one the board has moved on from (see
   * `Sudoku.isHintMovedOn`): the bar then says so, naming no step — and so
   * asks no "What's a …?" about one.
   */
  isMovedOn?: boolean;
  /**
   * The id to give the hint's words, so the selected cell can be described
   * by them (see Board's `describedBy`).
   */
  textId?: string;
  /**
   * Open "Show me" for the hint's cell — its walkthrough, or for a
   * wrong-marks hint the page naming the missing digit; null when there is
   * nothing to show (a mistake hint, or a solve that stalls before the
   * cell). Never withheld for a wrong digit or a missing candidate
   * elsewhere, which would give it away.
   */
  onShowMe?: (() => void) | null;
  /** A message for the player, until they dismiss it. A hint takes the bar first. */
  notice: Notice | null;
  onDismissNotice: () => void;
  /** Open the technique guide at the entry a hint's "What's a …?" asks about. */
  onOpenGuide: (entry: GuideId) => void;
}

/** The technique a hint names, if it names one: a step hint's is the next step's. */
function namedTechnique(hint: Hint): TechniqueId | null {
  return hint.kind === 'single' || hint.kind === 'deduction' || hint.kind === 'step'
    ? hint.technique
    : null;
}

/**
 * A hint's words. A step hint's hardest step is a sentence of its own, which
 * all but the widest bars leave out of sight (layout.css), to keep the bar
 * to its two lines — it is still read out, as part of the cell's
 * description too, and Show me names every step.
 */
function HintWords({ hint, houses }: { hint: Hint; houses: readonly Unit[] }) {
  const hardest = describeHardest(hint);
  if (hint.kind !== 'step' || hardest === null) return describeHint(hint, houses);
  return (
    <>
      {describeStep(hint, houses)}
      <span className="hint-bar__hardest"> {hardest}</span>
    </>
  );
}

const NO_HOUSES: readonly Unit[] = [];

/**
 * The line under the board: the hint ("Hidden single: there's only one place
 * for a number in this box."), or a notice such as a broken link or a full
 * board that is not right. Always rendered, and holding its height when
 * empty, so a message arriving never shoves the controls down the page.
 *
 * A hint that names a technique ends with a question — "What's a hidden
 * single?", or for a step hint the next step's technique — that opens the
 * guide at it. On the narrowest phones, where the
 * words would push the bar to a third line, it is a question-mark icon that
 * keeps the words as its name (see layout.css). A hint with a walkthrough
 * then offers "Show me", named for the cell it solves ("Show me how to solve
 * row 5, column 2") — or, for a candidate missing from a cell, for what it
 * shows ("Show me what's missing in row 2, column 1"); on the narrowest
 * bars, the hint's own mark gives way to it (see layout.css).
 *
 * Not a live region: the hook already speaks every hint and notice through
 * the app's status region, and saying them twice would talk over the next.
 */
export function HintBar({
  hint,
  houses = NO_HOUSES,
  isMovedOn = false,
  textId,
  onShowMe = null,
  notice,
  onDismissNotice,
  onOpenGuide,
}: HintBarProps) {
  if (hint !== null) {
    const technique = isMovedOn ? null : namedTechnique(hint);
    const showMe =
      onShowMe === null || hint.kind === 'none' ? null : { index: hint.index, onClick: onShowMe };
    return (
      <div className="hint-bar">
        <p className="hint-bar__message hint-bar__message--hint">
          <HintIcon className="hint-bar__icon" />
          <span>
            <span id={textId}>
              {isMovedOn ? MOVED_ON : <HintWords hint={hint} houses={houses} />}
            </span>
            {(technique !== null || showMe !== null) && (
              <>
                {' '}
                {/* Kept on one line, so both end the hint on its last line
                    (see layout.css). */}
                <span className="hint-bar__actions">
                  {technique !== null && (
                    <button
                      type="button"
                      className="hint-bar__question"
                      onClick={() => onOpenGuide(guideIdFor(technique))}
                    >
                      <span className="hint-bar__question-text">
                        {techniqueQuestion(technique)}
                      </span>
                      <HelpIcon className="hint-bar__question-icon" />
                    </button>
                  )}
                  {technique !== null && showMe !== null && ' '}
                  {showMe !== null && (
                    <button
                      type="button"
                      className="hint-bar__show"
                      aria-label={
                        hint.kind === 'struck'
                          ? `Show me what's missing in ${describePosition(showMe.index)}`
                          : `Show me how to solve ${describePosition(showMe.index)}`
                      }
                      onClick={showMe.onClick}
                    >
                      <PlayIcon className="hint-bar__show-icon" />
                      <span className="hint-bar__show-text">Show me</span>
                    </button>
                  )}
                </span>
              </>
            )}
          </span>
        </p>
      </div>
    );
  }
  if (notice !== null) {
    return (
      <div className="hint-bar">
        <p className="hint-bar__message hint-bar__message--notice">
          <span>{notice.text}</span>
          <button
            type="button"
            className="hint-bar__dismiss"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={onDismissNotice}
          >
            <CloseIcon />
          </button>
        </p>
      </div>
    );
  }
  return <div className="hint-bar" />;
}
