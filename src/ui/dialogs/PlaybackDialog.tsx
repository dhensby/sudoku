import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  PLAYBACK_SPEEDS,
  formatDuration,
  frameAt,
  lengthOf,
  playTimeAt,
  preparePlayback,
  stateAt,
  steer,
  tickFraction,
  type Difficulty,
  type Playback,
  type PlaybackCommand,
  type PlaybackTickKind,
} from '../../core';
import { Board, type BoardSettings } from '../Board';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PauseIcon,
  PlayIcon,
  ToEndIcon,
  ToStartIcon,
} from '../icons';
import { REFUSAL_TEXT, TICK_LABEL, captionAt, positionText } from '../playbackText';
import { usePlayback } from '../usePlayback';
import { Dialog } from './Dialog';

/**
 * What to play back: a puzzle's givens and a solve's encoded move log, with
 * the words to head it. Nothing of the player's own — no record, no saved
 * board — so a solve from anywhere plays the same: from History, from the
 * game just solved, or (later) from a friend's link.
 */
export interface PlaybackSource {
  givens: string;
  /** The puzzle's tier, carried with it (playback works it out from nothing else). */
  difficulty: Difficulty;
  /** The move log, as `encodeMoveLog` writes it. */
  log: string;
  /** Whose solve: "Your solve". */
  title: string;
  /** What it was: "Hard · 5:23". */
  subtitle: string;
}

export interface PlaybackDialogProps extends PlaybackSource {
  /** How the board is drawn: only whether conflicts are shown matters to a playback. */
  settings: BoardSettings;
  onClose: () => void;
}

/** The kinds of mark, in the order the key lists them. */
const TICK_KINDS: readonly PlaybackTickKind[] = ['mistake', 'slip', 'help'];

/** Never called: a board played back takes no input. */
const ignore = () => {};

interface Spoken {
  text: string;
  id: number;
}

/**
 * The player: the board as it stood after the move on show, that move's
 * cell outlined and its caption under it, and the controls — a scrubber with
 * the solve's mistakes, slips and help marked along it, the play time, the
 * speed, and Play with a step either way and a jump to either end.
 *
 * The keys, anywhere in the dialog: Space plays and pauses, Left and Right
 * step a move, Home and End jump to the start and the solve — each left to
 * a control that has a use of its own for it (Space presses a button, the
 * arrows move the scrubber and the speeds, Home and End the scrubber). The
 * game's own keys are not listening: they stand down while any dialog is
 * open (see App).
 *
 * A move taken by hand — a step, a jump, the scrubber — has its caption
 * spoken; the moves of a playback running on its own are not, which would
 * talk over everything at 8×. Where it stops is spoken once: the move on
 * show when the viewer pauses, and the solve when it gets there by itself. Play shows each move in a step, so with less
 * motion asked for it plays the same: nothing on the board animates bar the
 * conflict dot, which the stylesheet stills.
 */
function Player({ playback, settings }: { playback: Playback; settings: BoardSettings }) {
  const [spoken, setSpoken] = useState<Spoken | null>(null);
  const speak = (text: string) => setSpoken((previous) => ({ text, id: (previous?.id ?? 0) + 1 }));
  const { cursor, dispatch } = usePlayback(playback, () =>
    speak(captionAt(playback, lengthOf(playback))),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const ids = useId();
  const { position, isPlaying, speed } = cursor;
  const length = lengthOf(playback);
  const frame = frameAt(playback, position);
  const caption = captionAt(playback, position);

  /** A move taken by hand: made, and its caption spoken. */
  const steerByHand = (command: PlaybackCommand) => {
    const next = steer(playback, cursor, command);
    dispatch(command);
    if (next.position !== position) speak(captionAt(playback, next.position));
  };

  /** Play or pause: a pause says where it stopped, as the moves played went unspoken. */
  const togglePlay = () => {
    if (isPlaying) speak(caption);
    dispatch({ type: 'toggle' });
  };

  // On the dialog, so the keys work wherever focus is in it.
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    // Heard on the dialog, so it comes from an element in it.
    const target = event.target as Element;
    const isOwnedBy = (selector: string) => target.closest(selector) !== null;
    const isScrubber = isOwnedBy('input[type="range"]');
    const isRadio = isOwnedBy('input[type="radio"]');
    switch (event.key) {
      case ' ':
        if (isOwnedBy('button') || isRadio) return;
        // Held down, a key repeats: Space would flick between playing and
        // paused, so only the first press counts (as with the game's keys).
        if (!event.repeat) togglePlay();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (isScrubber || isRadio) return;
        steerByHand({ type: 'step', by: event.key === 'ArrowLeft' ? -1 : 1 });
        break;
      case 'Home':
      case 'End':
        if (isScrubber) return;
        steerByHand({ type: event.key === 'Home' ? 'start' : 'end' });
        break;
      default:
        return;
    }
    event.preventDefault();
  });
  useEffect(() => {
    const dialog = rootRef.current!.closest<HTMLElement>('[role="dialog"]')!;
    const onKeyDown = (event: KeyboardEvent) => handleKey(event);
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, []);

  const kinds = TICK_KINDS.filter((kind) => playback.ticks.some((tick) => tick.kind === kind));
  const atEnd = position === length;

  return (
    <div className="playback" ref={rootRef}>
      <div className="playback__board">
        <div className="board-area">
          <Board
            game={stateAt(playback, position)}
            settings={settings}
            isPlaying={false}
            isCelebrating={false}
            onSelect={ignore}
            onToggleCandidate={ignore}
            isReadOnly
            current={frame?.cell ?? null}
          />
        </div>
      </div>

      <div className="playback__panel">
        <p className="playback__caption">{caption}</p>
        {/* Moves taken by hand, spoken. Keyed, so the same words twice still are. */}
        <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {spoken !== null && <span key={spoken.id}>{spoken.text}</span>}
        </div>

        <div className="playback__scrubber">
          {/* The marks are for the eye: the captions say the same in words. */}
          <div className="playback__ticks" aria-hidden="true">
            {playback.ticks.map((tick) => (
              <span
                key={`${tick.kind}-${tick.position}`}
                className={`playback__tick playback__tick--${tick.kind}`}
                style={{ '--at': tickFraction(playback, tick) } as CSSProperties}
              />
            ))}
          </div>
          <input
            type="range"
            className="playback__range"
            min={0}
            max={length}
            step={1}
            value={position}
            aria-label="Move"
            aria-valuetext={positionText(playback, position)}
            onChange={(event) =>
              steerByHand({ type: 'seek', position: event.currentTarget.valueAsNumber })
            }
          />
        </div>
        {kinds.length > 0 && (
          <ul className="playback__key" aria-hidden="true">
            {kinds.map((kind) => (
              <li className="playback__key-item" key={kind}>
                <span className={`playback__tick playback__tick--${kind}`} />
                {TICK_LABEL[kind]}
              </li>
            ))}
          </ul>
        )}

        <div className="playback__row">
          <p className="playback__time">
            <span className="visually-hidden">Play time </span>
            {formatDuration(playTimeAt(playback, position))}
            <span aria-hidden="true"> / </span>
            <span className="visually-hidden"> of </span>
            {formatDuration(playTimeAt(playback, length))}
          </p>
          <fieldset className="playback__speeds">
            <legend className="visually-hidden">Speed</legend>
            {PLAYBACK_SPEEDS.map((option) => (
              <label className="playback__speed" key={option}>
                <input
                  type="radio"
                  name={`${ids}-speed`}
                  value={option}
                  checked={speed === option}
                  onChange={() => dispatch({ type: 'speed', speed: option })}
                />
                {option}×
              </label>
            ))}
          </fieldset>
        </div>

        {/* At either end the buttons that would go further are marked
            unavailable rather than disabled: disabled, a button in focus
            drops it to the page, out of the dialog and its keys. Pressed
            there, they do nothing. */}
        <div className="playback__transport" role="group" aria-label="Playback">
          <button
            type="button"
            className="button playback__button"
            aria-label="To the start"
            aria-disabled={position === 0}
            onClick={() => steerByHand({ type: 'start' })}
          >
            <ToStartIcon />
          </button>
          <button
            type="button"
            className="button playback__button"
            aria-label="Back a move"
            aria-disabled={position === 0}
            onClick={() => steerByHand({ type: 'step', by: -1 })}
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="button button--primary playback__button playback__play"
            data-autofocus
            onClick={togglePlay}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
            {/* Left to a screen reader where the panel is narrow (see dialogs.css). */}
            <span className="playback__play-label">
              {isPlaying ? 'Pause' : atEnd ? 'Watch again' : 'Play'}
            </span>
          </button>
          <button
            type="button"
            className="button playback__button"
            aria-label="Forward a move"
            aria-disabled={atEnd}
            onClick={() => steerByHand({ type: 'step', by: 1 })}
          >
            <ChevronRightIcon />
          </button>
          <button
            type="button"
            className="button playback__button"
            aria-label="To the solve"
            aria-disabled={atEnd}
            onClick={() => steerByHand({ type: 'end' })}
          >
            <ToEndIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Watch your solve": a solved game played back, move by move, from its
 * givens and its move log alone (see `src/core/playback.ts`). Watching
 * changes nothing: the game behind is paused, as for any dialog, and no
 * record or count moves.
 *
 * A log this build cannot play back — from an older or a newer version, or
 * broken — says so in the board's place. The game only offers one it can,
 * but a log from a link is another matter.
 */
export function PlaybackDialog({
  givens,
  difficulty,
  log,
  title,
  subtitle,
  settings,
  onClose,
}: PlaybackDialogProps) {
  const subtitleId = useId();
  const prepared = useMemo(
    () => preparePlayback(givens, difficulty, log),
    [givens, difficulty, log],
  );

  return (
    <Dialog title={title} onClose={onClose} className="dialog--playback" describedBy={subtitleId}>
      <p className="playback__subtitle" id={subtitleId}>
        {subtitle}
      </p>
      {prepared.ok ? (
        <Player playback={prepared.playback} settings={settings} />
      ) : (
        <p className="playback__refusal">{REFUSAL_TEXT[prepared.reason]}</p>
      )}
    </Dialog>
  );
}
