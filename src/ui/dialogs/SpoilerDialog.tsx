import { useId } from 'react';
import { Dialog } from './Dialog';

export interface SpoilerDialogProps {
  /** The friend whose solve it is, from their link; null for a link with no name. */
  name: string | null;
  /** Watch it anyway, giving up a time for the puzzle. */
  onWatch: () => void;
  /** Leave it, and play the puzzle first. */
  onPlay: () => void;
  /** Escape, the close button and the scrim: back to where it was, nothing done. */
  onClose: () => void;
}

/**
 * Asks before showing a friend's solve of a puzzle the player has not solved
 * — plainly, as it costs them for good: having seen every number go in, they
 * can never record a time for the puzzle, in the attempt they have or any
 * other (see `GameRecord.watched`).
 *
 * Opens on "Play it first", the choice that costs nothing, so a reflexive
 * Enter or Space plays rather than spoils; "Watch anyway" is styled as the
 * cost it is.
 */
export function SpoilerDialog({ name, onWatch, onPlay, onClose }: SpoilerDialogProps) {
  const messageId = useId();
  return (
    <Dialog
      // The name, from a link anyone can write, kept apart from the words
      // around it, as in the message: a right-to-left one must not pull the
      // heading round it.
      title={
        name === null ? (
          "Watch your friend's solve?"
        ) : (
          <>
            Watch <bdi>{name}</bdi>&apos;s solve?
          </>
        )
      }
      onClose={onClose}
      className="dialog--confirm"
      // Focus lands on Play it first, below the message; this has it read on the way in.
      describedBy={messageId}
      footer={
        <>
          <button type="button" className="button button--primary" data-autofocus onClick={onPlay}>
            Play it first
          </button>
          <button type="button" className="button button--danger" onClick={onWatch}>
            Watch anyway
          </button>
        </>
      }
    >
      <p className="confirm__message" id={messageId}>
        This shows every number {name === null ? 'your friend' : <bdi>{name}</bdi>} placed. You
        haven&apos;t solved this puzzle yet: if you watch now, you won&apos;t be able to record a
        time for it, now or later.
      </p>
    </Dialog>
  );
}
