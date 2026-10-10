import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Assists } from '../core';
import {
  assistPartText,
  assistParts,
  describeAssists,
  hasAssists,
  type AssistPart,
} from './format';

/*
 * "Show help taken": the help the game has taken so far, beside the timer
 * (above the controls on a phone, on the error counter's line), in History's
 * words — "Auto candidates · 2 hints" — so a player can see a Hint or a Show
 * me charged as it happens, and that asking again was not. Only a display:
 * help is recorded next to the time whether it shows or not.
 *
 * It shows while the game is paused too, unlike the error counter: it says
 * nothing about the board — what help was taken is no clue to where — and,
 * like the timer's digits, it is a record of the game rather than of its
 * cells.
 */

/** How long a tick stays marked: its flash, or under reduced motion a still highlight. */
export const TICK_MS = 1200;

/** Whether help grew from `before` to `after`: a count went up, or a switch came on. */
function isCharged(before: Assists, after: Assists): boolean {
  return (
    (after.autoCandidates && !before.autoCandidates) ||
    (after.checkGuesses === true && before.checkGuesses !== true) ||
    after.hints > before.hints ||
    after.checks > before.checks ||
    after.reveals > before.reveals
  );
}

/** Whether two tallies of help say the same, whichever objects they are. */
function isSame(a: Assists | null, b: Assists | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.autoCandidates === b.autoCandidates &&
    (a.checkGuesses === true) === (b.checkGuesses === true) &&
    a.hints === b.hints &&
    a.checks === b.checks &&
    a.reveals === b.reveals
  );
}

/** "Auto candidates · 2 hints", each count set in ink as the error counter's are. */
function renderParts(parts: readonly AssistPart[]): ReactNode {
  return parts.map((part, i) => (
    <Fragment key={part.words}>
      {i > 0 && ' · '}
      {part.count === null ? (
        part.words
      ) : (
        <>
          <span className="help-taken__count">{part.count}</span> {part.words}
        </>
      )}
    </Fragment>
  ));
}

/**
 * The last wording, for the least room: "Help 4", the counts added up and
 * set as the error counter's "Mistakes 2" is — short enough to stay whole
 * beside the widest counter on the narrowest phone — or, with only a switch
 * to show, "Help taken".
 */
function renderTotal(assists: Assists): ReactNode {
  const total = assists.hints + assists.checks + assists.reveals;
  if (total === 0) return 'Help taken';
  return (
    <>
      Help <span className="help-taken__count">{total}</span>
    </>
  );
}

/** Which wording shows: the full words, the counts alone, or their total. */
type Form = 'full' | 'counts' | 'total';

export interface HelpTakenProps {
  /** The game's help so far, or null with no game on screen. */
  assists: Assists | null;
  /** The game on screen: another game's help is a fresh start, not a charge. */
  gameId: string | null;
  /**
   * Whether the game's board has been on show (see `hasBoardShown`). Help a
   * game takes up before then — "Check guesses when entered", taken up as a
   * game behind Start or a dialog first starts — is help it opens with, not
   * a charge, and does not tick. Default true.
   */
  isStarted?: boolean;
  /**
   * Whether a dialog covers the page. A charge made as one opens — Show me's,
   * its walkthrough opening over the board — ticks as it closes, where it
   * can be seen, rather than unseen behind it. Default false.
   */
  isCovered?: boolean;
  /**
   * Where it sits, as the error counter does (see `ErrorCounter`): beside
   * the timer, or on the line above a phone's controls. The App renders
   * both and the stylesheet shows one.
   */
  placement: 'header' | 'play';
}

/** What the help taken last saw, to tell a charge from a game opening. */
interface Seen {
  gameId: string | null;
  assists: Assists | null;
  isStarted: boolean;
  /** Ticks so far: each one keys the words afresh, so its flash plays again. */
  tick: number;
  /** A charge made behind a dialog, to tick as it closes. */
  isPending: boolean;
}

/**
 * The help taken, once there is any (nothing at all before). Worded in full
 * — History's chips, joined — where that fits; where it does not, as the
 * counts alone ("2 hints · 1 check"): what the "…" menu charges, and what a
 * player wants to watch, while the two switches show for themselves (the
 * Auto Candidate switch, a checked guess's slash); and where even those do
 * not, as their total, "Help 3" ("Help taken" for a switch alone), never a
 * count cut short. Which fits is measured, not guessed: the box is as wide
 * as the full words, up to the room it is given, so a wording fits exactly
 * when it is no wider than the box. Hovering shows the full words, and a
 * screen reader is given the full list, always.
 *
 * Ticks — the accent colour, underlined, fading back where motion is
 * welcome and held still where it is not — whenever help is charged: not
 * as a game opens with its help, nor for another game's, nor as the setting
 * is switched on. Says nothing itself: the move that charged says the new
 * count (`describeCharge`), once.
 */
export function HelpTaken({
  assists,
  gameId,
  isStarted = true,
  isCovered = false,
  placement,
}: HelpTakenProps) {
  const [seen, setSeen] = useState<Seen>(() => ({
    gameId,
    assists,
    isStarted,
    tick: 0,
    isPending: false,
  }));
  // Taken in while rendering, as React documents for state that follows a
  // prop (and as MistakeAnnouncer does): the render that shows the new
  // help already ticks.
  let current = seen;
  if (
    seen.gameId !== gameId ||
    !isSame(seen.assists, assists) ||
    seen.isStarted !== isStarted ||
    (seen.isPending && !isCovered)
  ) {
    const isSameGame = seen.gameId === gameId;
    // Charged only in a game already on show: what it took up as it first
    // started, it opened with.
    const isCharge =
      isSameGame &&
      seen.isStarted &&
      seen.assists !== null &&
      assists !== null &&
      isCharged(seen.assists, assists);
    const isDue = isSameGame && (seen.isPending || isCharge);
    current = {
      gameId,
      assists,
      isStarted,
      tick: isDue && !isCovered ? seen.tick + 1 : seen.tick,
      isPending: isDue && isCovered,
    };
    setSeen(current);
  }

  // The tick's mark goes once it has played, so the same text is not
  // marked still when a phone turned on its side brings the other copy
  // into view.
  const [settled, setSettled] = useState(0);
  const { tick } = current;
  useEffect(() => {
    if (tick === 0) return undefined;
    const id = window.setTimeout(() => setSettled(tick), TICK_MS);
    return () => window.clearTimeout(id);
  }, [tick]);
  const isTicking = tick > settled;

  const parts = assists === null ? [] : assistParts(assists);
  const counts = parts.filter((part) => part.count !== null);
  const full = parts.map(assistPartText).join(' · ');

  const boxRef = useRef<HTMLParagraphElement>(null);
  const fullRef = useRef<HTMLSpanElement>(null);
  const countsRef = useRef<HTMLSpanElement>(null);
  const [form, setForm] = useState<Form>('full');
  useLayoutEffect(() => {
    const box = boxRef.current;
    const words = fullRef.current;
    const alone = countsRef.current;
    if (box === null || words === null || alone === null) return undefined;
    // To the sub-pixel, as the text is laid out: whole-pixel widths could
    // call words a fraction wider than the box a fit, and clip them. Nothing
    // here is transformed, so these are the layout's own widths.
    const widthOf = (element: Element) => element.getBoundingClientRect().width;
    const measure = () => {
      const room = widthOf(box);
      if (widthOf(words) <= room) setForm('full');
      else setForm(widthOf(alone) <= room ? 'counts' : 'total');
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [full, tick]);

  if (assists === null || !hasAssists(assists)) return null;
  const faceClass = [
    'help-taken__face',
    form !== 'full' && `help-taken__face--${form}`,
    isTicking && 'help-taken__face--tick',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <p
      className={`help-taken help-taken--${placement}`}
      ref={boxRef}
      title={form === 'full' ? undefined : full}
    >
      {/* Keyed by the tick, so each one plays its flash afresh. */}
      <span key={tick} className={faceClass} aria-hidden="true">
        <span className="help-taken__full" ref={fullRef}>
          {renderParts(parts)}
        </span>
        <span className="help-taken__counts" ref={countsRef}>
          {renderParts(counts.length === 0 ? parts : counts)}
        </span>
        <span className="help-taken__total">{renderTotal(assists)}</span>
      </span>
      <span className="visually-hidden">{`Help taken: ${describeAssists(assists)}`}</span>
    </p>
  );
}
