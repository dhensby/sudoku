import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { formatDuration, type Difficulty } from '../core';
import type { Challenge } from '../storage/history';
import { DIFFICULTY_LABEL, describeAssists, withArticle } from './format';
import { PlayIcon } from './icons';
import { focusQuietly } from './keepFocus';

/** What the board's place holds while the board itself is not shown. */
export type BoardOverlayContent =
  /** A puzzle is being generated. */
  | { kind: 'loading'; difficulty: Difficulty }
  /** Generation failed with nothing to show instead. */
  | { kind: 'failed'; difficulty: Difficulty; onRetry: () => void }
  /**
   * A game waiting for its Start button: a shared puzzle (`isShared`, with a
   * time to beat if its link carried one), or one that arrived while the tab
   * was hidden or was never started before a reload.
   */
  | {
      kind: 'ready';
      difficulty: Difficulty;
      isShared: boolean;
      challenge: Challenge | null;
      onStart: () => void;
    }
  /** A paused game. */
  | {
      kind: 'paused';
      difficulty: Difficulty;
      elapsedMs: number;
      showTimer: boolean;
      onResume: () => void;
    }
  /** Paused behind a dialog: nothing to say, and nothing to press — the dialog has the floor. */
  | { kind: 'veiled' };

export type BoardOverlayProps = BoardOverlayContent & {
  /**
   * Called as the card goes away while its button has focus, so the board
   * coming in can take focus over (see Board's `takeFocusRequest`).
   */
  onReleaseFocus?: () => void;
  /**
   * Called as the card's button takes focus on arrival: any hand-over still
   * pending is now stale. (Under StrictMode the rehearsal unmount releases
   * focus the card had only just taken; this, run again as it remounts,
   * withdraws that release.)
   */
  onClaimFocus?: () => void;
};

/** The challenge line: "Dan solved this Hard puzzle in 5:23. Can you beat it?" */
function ChallengeText({
  difficulty,
  challenge,
  textId,
  noteId,
}: {
  difficulty: Difficulty;
  challenge: Challenge;
  textId: string;
  noteId: string;
}) {
  const assists = describeAssists(challenge.assists);
  return (
    <>
      <p className="board-overlay__text" id={textId}>
        {/* Names come from links anyone can write: <bdi> keeps a
            right-to-left one from pulling the sentence around it. */}
        {challenge.name === null ? 'Your friend' : <bdi>{challenge.name}</bdi>} solved this{' '}
        {DIFFICULTY_LABEL[difficulty]} puzzle in {formatDuration(challenge.seconds * 1000)}. Can you
        beat it?
      </p>
      {assists !== null && (
        <p className="board-overlay__note" id={noteId}>
          With {assists}.
        </p>
      )}
    </>
  );
}

/**
 * A card in the board's place, the board's exact size so nothing around it
 * moves: generating, ready to start, or paused. The cells are not rendered
 * at all while it shows, so neither the page nor a screen reader can read
 * the digits of a game whose clock is stopped.
 *
 * Focus moves to the card's button as it appears, so Enter or Space
 * continues — and P, from anywhere. The button is described by the card's
 * title and text, so a screen reader landing on "Start" hears what it
 * starts.
 */
export function BoardOverlay(props: BoardOverlayProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const releaseRef = useRef(props.onReleaseFocus);
  const claimRef = useRef(props.onClaimFocus);
  const ids = useId();
  const titleId = `${ids}-title`;
  const textId = `${ids}-text`;
  const noteId = `${ids}-note`;
  const timerNoteId = `${ids}-timer`;

  useLayoutEffect(() => {
    releaseRef.current = props.onReleaseFocus;
    claimRef.current = props.onClaimFocus;
  });

  useEffect(() => {
    const button = buttonRef.current;
    if (button === null) return;
    focusQuietly(button);
    claimRef.current?.();
  }, []);

  // A layout effect, because its cleanup runs before the card leaves the
  // page — the one moment it can still tell whether it held focus.
  useLayoutEffect(() => {
    const card = cardRef.current;
    return () => {
      if (card?.contains(document.activeElement)) releaseRef.current?.();
    };
  }, []);

  return (
    <div className={`board-overlay board-overlay--${props.kind}`} ref={cardRef}>
      {props.kind === 'loading' && (
        <div className="board-overlay__card" role="status">
          <span className="spinner" aria-hidden="true" />
          <p className="board-overlay__text">
            Generating {withArticle(DIFFICULTY_LABEL[props.difficulty])} puzzle…
          </p>
        </div>
      )}
      {props.kind === 'failed' && (
        <div className="board-overlay__card">
          <h2 className="board-overlay__title" id={titleId}>
            Something went wrong
          </h2>
          <p className="board-overlay__text" id={textId}>
            Couldn&apos;t make {withArticle(DIFFICULTY_LABEL[props.difficulty])} puzzle.
          </p>
          <button
            type="button"
            className="button button--primary board-overlay__button"
            aria-describedby={`${titleId} ${textId}`}
            ref={buttonRef}
            onClick={props.onRetry}
          >
            Try again
          </button>
        </div>
      )}
      {props.kind === 'ready' && (
        <div className="board-overlay__card">
          <h2 className="board-overlay__title" id={titleId}>
            Ready?
          </h2>
          {props.challenge !== null ? (
            <ChallengeText
              difficulty={props.difficulty}
              challenge={props.challenge}
              textId={textId}
              noteId={noteId}
            />
          ) : props.isShared ? (
            <p className="board-overlay__text" id={textId}>
              Someone shared {withArticle(DIFFICULTY_LABEL[props.difficulty])} puzzle with you.
            </p>
          ) : (
            <p className="board-overlay__text" id={textId}>
              Your {DIFFICULTY_LABEL[props.difficulty]} puzzle is ready.
            </p>
          )}
          <p className="board-overlay__note" id={timerNoteId}>
            The timer starts when you do.
          </p>
          <button
            type="button"
            className="button button--primary board-overlay__button"
            aria-describedby={[
              titleId,
              textId,
              props.challenge !== null && describeAssists(props.challenge.assists) !== null
                ? noteId
                : null,
              timerNoteId,
            ]
              .filter((id) => id !== null)
              .join(' ')}
            ref={buttonRef}
            onClick={props.onStart}
          >
            <PlayIcon />
            Start
          </button>
        </div>
      )}
      {props.kind === 'paused' && (
        <div className="board-overlay__card">
          <h2 className="board-overlay__title" id={titleId}>
            Paused
          </h2>
          <p className="board-overlay__text" id={textId}>
            {DIFFICULTY_LABEL[props.difficulty]}
            {props.showTimer && <> · {formatDuration(props.elapsedMs)}</>}
          </p>
          <button
            type="button"
            className="button button--primary board-overlay__button"
            aria-describedby={`${titleId} ${textId}`}
            ref={buttonRef}
            onClick={props.onResume}
          >
            <PlayIcon />
            Resume
          </button>
        </div>
      )}
    </div>
  );
}
