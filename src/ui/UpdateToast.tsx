import { useState } from 'react';
import { CloseIcon } from './icons';
import { keepFocus } from './keepFocus';

/** What the toast says, and what it says to a screen reader as it appears. */
export const UPDATE_TEXT = 'A new version of Sudoku is ready.';
const SPOKEN = `${UPDATE_TEXT} Refresh to use it.`;

export interface UpdateToastProps {
  /** The newer version deployed since the page loaded (see src/update/check.ts), or null. */
  version: string | null;
  /**
   * Whether a dialog covers the page. The toast waits for it to close — the
   * dialog has the floor, and a refresh would lose whatever is in it (a
   * puzzle being typed in, a name) — and only then appears, and is spoken.
   */
  isCovered: boolean;
  /** Load the new version. The game is saved, and reopens paused, as on any reload. */
  onRefresh: () => void;
}

/**
 * The offer of a newer version: "A new version of Sudoku is ready", with
 * Refresh, which loads it, and Dismiss, which puts it away until a newer one
 * still is deployed. It floats at the foot of the page, over the row with the
 * Auto Candidate switch on a phone and under the controls elsewhere, and
 * never takes focus: the keyboard carries on with the board, and a press on
 * either button leaves it there (`keepFocus`). It stays until it is answered.
 *
 * Spoken once, politely, through a status region of its own that is on the
 * page from the start — a region only speaks of a change to it — rather than
 * the game's, whose next message would replace it.
 */
export function UpdateToast({ version, isCovered, onRefresh }: UpdateToastProps) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  // The version the toast has been on show for: spoken as it first shows, and
  // left there, unchanged and so not spoken again, as a dialog comes and goes.
  const [shown, setShown] = useState<string | null>(null);
  const isOffered = version !== null && version !== dismissed;
  const isShown = isOffered && !isCovered;
  // Taken in while rendering, as React documents for state that follows a
  // prop: the render that shows the toast already speaks it.
  if (isShown && shown !== version) setShown(version);

  return (
    <div className="update">
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {isOffered && shown === version && <span>{SPOKEN}</span>}
      </div>
      {isShown && (
        <div className="update-toast">
          <p className="update-toast__text">{UPDATE_TEXT}</p>
          <button
            type="button"
            className="button button--primary button--small"
            onMouseDown={keepFocus}
            onClick={onRefresh}
          >
            Refresh
          </button>
          <button
            type="button"
            className="update-toast__dismiss"
            aria-label="Dismiss"
            title="Dismiss"
            onMouseDown={keepFocus}
            onClick={() => setDismissed(version)}
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}
