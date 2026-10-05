import type { Hint } from '../core';
import { describeHint } from './announce';
import { CloseIcon, HintIcon } from './icons';
import type { Notice } from './useSudoku';

export interface HintBarProps {
  /** The hint on show, if the board is; it goes with the next change of any kind. */
  hint: Hint | null;
  /** A message for the player, until they dismiss it. A hint takes the bar first. */
  notice: Notice | null;
  onDismissNotice: () => void;
}

/**
 * The line under the board: the hint ("Hidden single: there's only one place
 * for a number in this box."), or a notice such as a broken link or a full
 * board that is not right. Always rendered, and holding its height when
 * empty, so a message arriving never shoves the controls down the page.
 *
 * Not a live region: the hook already speaks every hint and notice through
 * the app's status region, and saying them twice would talk over the next.
 */
export function HintBar({ hint, notice, onDismissNotice }: HintBarProps) {
  if (hint !== null) {
    return (
      <div className="hint-bar">
        <p className="hint-bar__message hint-bar__message--hint">
          <HintIcon className="hint-bar__icon" />
          <span>{describeHint(hint)}</span>
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
