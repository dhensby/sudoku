import type { Hint, TechniqueId } from '../core';
import { describeHint, describePosition } from './announce';
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
   * The id to give the hint's words, so the selected cell can be described
   * by them (see Board's `describedBy`).
   */
  textId?: string;
  /**
   * Open "Show me" for the hint's cell; null when there is no walkthrough to
   * show (a mistake hint, or a solve that stalls before the cell). Never
   * withheld for a wrong digit elsewhere, which would give it away.
   */
  onShowMe?: (() => void) | null;
  /** A message for the player, until they dismiss it. A hint takes the bar first. */
  notice: Notice | null;
  onDismissNotice: () => void;
  /** Open the technique guide at the entry a hint's "What's a …?" asks about. */
  onOpenGuide: (entry: GuideId) => void;
}

/** The technique a hint names, if it names one. */
function namedTechnique(hint: Hint): TechniqueId | null {
  return hint.kind === 'single' || hint.kind === 'deduction' ? hint.technique : null;
}

/**
 * The line under the board: the hint ("Hidden single: there's only one place
 * for a number in this box."), or a notice such as a broken link or a full
 * board that is not right. Always rendered, and holding its height when
 * empty, so a message arriving never shoves the controls down the page.
 *
 * A hint that names a technique ends with a question — "What's a hidden
 * single?" — that opens the guide at it. On the narrowest phones, where the
 * words would push the bar to a third line, it is a question-mark icon that
 * keeps the words as its name (see layout.css). A hint with a walkthrough
 * then offers "Show me", named for the cell it solves ("Show me how to solve
 * row 5, column 2"); on the narrowest bars, the hint's own mark gives way
 * to it (see layout.css).
 *
 * Not a live region: the hook already speaks every hint and notice through
 * the app's status region, and saying them twice would talk over the next.
 */
export function HintBar({
  hint,
  textId,
  onShowMe = null,
  notice,
  onDismissNotice,
  onOpenGuide,
}: HintBarProps) {
  if (hint !== null) {
    const technique = namedTechnique(hint);
    const showMe =
      onShowMe === null || hint.kind === 'none' ? null : { index: hint.index, onClick: onShowMe };
    return (
      <div className="hint-bar">
        <p className="hint-bar__message hint-bar__message--hint">
          <HintIcon className="hint-bar__icon" />
          <span>
            <span id={textId}>{describeHint(hint)}</span>
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
                      aria-label={`Show me how to solve ${describePosition(showMe.index)}`}
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
