import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { formatDuration, type DateKey, type Difficulty } from '../core';
import type { Challenge } from '../storage/history';
import { dailyName, dailyPhrase } from './daily';
import { DIFFICULTY_LABEL, capitalise, describeResult, withArticle } from './format';
import { PlayIcon } from './icons';
import { focusQuietly } from './keepFocus';
import { WatchFriendText } from './WatchFriendText';

/** The daily a card's game is, for its wording: its date, and the player's. */
export interface OverlayDaily {
  date: DateKey;
  today: DateKey;
}

/**
 * A friend's solve a card offers to watch, beside its own button: whose it
 * is (null for a link with no name), and what pressing it does — the app
 * decides whether that asks first.
 */
export interface CardSolve {
  name: string | null;
  onWatch: () => void;
}

/** What the board's place holds while the board itself is not shown. */
export type BoardOverlayContent =
  /** A puzzle is being generated (or a daily dealt). */
  | { kind: 'loading'; difficulty: Difficulty; daily?: OverlayDaily | null }
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
      daily?: OverlayDaily | null;
      onStart: () => void;
      /** The friend's solve the link carried, to watch instead of racing it. */
      solve?: CardSolve | null;
      /**
       * A solve of this puzzle has been watched (see `GameRecord.watched`):
       * the card says no time will be recorded, before Start is pressed.
       */
      isWatched?: boolean;
    }
  /** A paused game. */
  | {
      kind: 'paused';
      difficulty: Difficulty;
      elapsedMs: number;
      showTimer: boolean;
      daily?: OverlayDaily | null;
      onResume: () => void;
      /** The friend's solve the game's link carried, to give up and watch. */
      solve?: CardSolve | null;
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

/**
 * The puzzle, mid-sentence: "this Hard puzzle", or the daily it is — "today's
 * Hard puzzle", "the Hard daily for 12 Oct".
 */
function puzzlePhrase(difficulty: Difficulty, daily: OverlayDaily | null | undefined): string {
  if (daily === null || daily === undefined) return `this ${DIFFICULTY_LABEL[difficulty]} puzzle`;
  return dailyPhrase(daily.date, difficulty, daily.today);
}

/**
 * How the challenger's time was earned, as their share text put it: "No
 * mistakes · with 2 hints", "With 2 hints" (mistakes not known) — or null.
 */
function challengeNote(challenge: Challenge): string | null {
  return describeResult(challenge.assists, challenge.mistakes ?? null);
}

/** "No mistakes" → "no mistakes", to follow a colon. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The challenge line: "Dan solved this Hard puzzle in 5:23. Can you beat it?"
 * — and under it, how that time was earned, when there is anything to say:
 * "Dan's solve: no mistakes · with 2 hints." The note names whose solve it
 * describes because, sitting between the question and "The timer starts
 * when you do.", a bare "No mistakes." reads as a rule of the race, or as
 * the player's own count.
 *
 * Once the player has watched a solve of the puzzle (`isWatched`), no time of
 * theirs will be recorded, so there is no race left to offer: the line stops
 * at the friend's time, and the note under it says why.
 */
function ChallengeText({
  difficulty,
  challenge,
  daily,
  isWatched,
  textId,
  noteId,
}: {
  difficulty: Difficulty;
  challenge: Challenge;
  daily: OverlayDaily | null | undefined;
  isWatched: boolean;
  textId: string;
  noteId: string;
}) {
  const note = challengeNote(challenge);
  return (
    <>
      <p className="board-overlay__text" id={textId}>
        {/* Names come from links anyone can write: <bdi> keeps a
            right-to-left one from pulling the sentence around it. */}
        {challenge.name === null ? 'Your friend' : <bdi>{challenge.name}</bdi>} solved{' '}
        {puzzlePhrase(difficulty, daily)} in {formatDuration(challenge.seconds * 1000)}.
        {!isWatched && ' Can you beat it?'}
      </p>
      {note !== null && (
        <p className="board-overlay__note" id={noteId}>
          {challenge.name === null ? 'Your friend' : <bdi>{challenge.name}</bdi>}'s solve:{' '}
          {lowerFirst(note)}.
        </p>
      )}
    </>
  );
}

/**
 * What a card says of a solve watched before Start: that the attempt about to
 * begin will be recorded without a time — said before the clock starts, not
 * discovered at the solve.
 */
export const WATCHED_CARD_TEXT =
  "You've watched a solve of this puzzle, so no time will be recorded.";

/**
 * "Watch Dan's solve", the second button on a card: the name kept apart from
 * the words around it, as everywhere a link's name is shown.
 */
function WatchSolveButton({ solve, describedBy }: { solve: CardSolve; describedBy?: string }) {
  return (
    <button
      type="button"
      className="button button--wraps board-overlay__button board-overlay__button--secondary"
      aria-describedby={describedBy}
      onClick={solve.onWatch}
    >
      <PlayIcon />
      <WatchFriendText name={solve.name} />
    </button>
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
 *
 * A game whose link carried the friend's solve offers it too, beside Start
 * or Resume — the secondary choice, so focus and Enter stay with playing.
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
  const watchedNoteId = `${ids}-watched`;

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
            Generating{' '}
            {props.daily === null || props.daily === undefined
              ? `${withArticle(DIFFICULTY_LABEL[props.difficulty])} puzzle`
              : dailyPhrase(props.daily.date, props.difficulty, props.daily.today)}
            …
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
              daily={props.daily}
              isWatched={props.isWatched === true}
              textId={textId}
              noteId={noteId}
            />
          ) : props.isShared ? (
            <p className="board-overlay__text" id={textId}>
              Someone shared{' '}
              {props.daily === null || props.daily === undefined
                ? `${withArticle(DIFFICULTY_LABEL[props.difficulty])} puzzle`
                : dailyPhrase(props.daily.date, props.difficulty, props.daily.today)}{' '}
              with you.
            </p>
          ) : (
            <p className="board-overlay__text" id={textId}>
              {props.daily === null || props.daily === undefined
                ? `Your ${DIFFICULTY_LABEL[props.difficulty]} puzzle`
                : capitalise(
                    dailyPhrase(props.daily.date, props.difficulty, props.daily.today),
                  )}{' '}
              is ready.
            </p>
          )}
          {props.isWatched === true ? (
            <p className="board-overlay__note" id={watchedNoteId}>
              {WATCHED_CARD_TEXT}
            </p>
          ) : (
            <p className="board-overlay__note" id={timerNoteId}>
              The timer starts when you do.
            </p>
          )}
          <div className="board-overlay__actions">
            <button
              type="button"
              className="button button--primary board-overlay__button"
              aria-describedby={[
                titleId,
                textId,
                props.challenge !== null && challengeNote(props.challenge) !== null ? noteId : null,
                props.isWatched === true ? watchedNoteId : timerNoteId,
              ]
                .filter((id) => id !== null)
                .join(' ')}
              ref={buttonRef}
              onClick={props.onStart}
            >
              <PlayIcon />
              Start
            </button>
            {props.solve !== undefined && props.solve !== null && (
              <WatchSolveButton
                solve={props.solve}
                describedBy={props.isWatched === true ? watchedNoteId : undefined}
              />
            )}
          </div>
        </div>
      )}
      {props.kind === 'paused' && (
        <div className="board-overlay__card">
          <h2 className="board-overlay__title" id={titleId}>
            Paused
          </h2>
          <p className="board-overlay__text" id={textId}>
            {props.daily === null || props.daily === undefined
              ? DIFFICULTY_LABEL[props.difficulty]
              : dailyName(props.daily.date, props.difficulty, props.daily.today)}
            {props.showTimer && <> · {formatDuration(props.elapsedMs)}</>}
          </p>
          <div className="board-overlay__actions">
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
            {props.solve !== undefined && props.solve !== null && (
              <WatchSolveButton solve={props.solve} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
