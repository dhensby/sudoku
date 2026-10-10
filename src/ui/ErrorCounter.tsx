import { useState } from 'react';
import type { MistakeTally } from '../core';
import { count } from './format';

/*
 * "Show error counter": the game's mistakes so far, shown as it is played.
 * It is only a display — not help, and not recorded — because what it shows
 * has settled: with Check guesses off a mistake shows only once its window to
 * be put right has closed (see `src/core/mistakes.ts`), so it never tells the
 * player that a number they have just entered is wrong. With Check guesses
 * on, a mistake counts the moment it is made, and shows at once.
 */

export interface ErrorCounterProps {
  /** The mistakes so far, or null when they are not known (a game not recorded move by move). */
  mistakes: MistakeTally | null;
  /** Whether the board is on show: the count is hidden with it, as the time's digits are not. */
  isShown: boolean;
  /**
   * Where it sits: in the header, beside the timer (on a desktop, and a
   * phone on its side), or above the controls (on a phone held upright,
   * where the header has no room). The App renders both and the stylesheet
   * shows one, so a screen reader meets only that one.
   */
  placement: 'header' | 'play';
}

/** "1 mistake and 2 candidate mistakes so far", for a screen reader. */
function spokenCount(mistakes: MistakeTally): string {
  if (mistakes.values === 0 && mistakes.candidates === 0) return 'No mistakes so far';
  const parts = [count(mistakes.values, 'mistake')];
  if (mistakes.candidates > 0) parts.push(count(mistakes.candidates, 'candidate mistake'));
  return `${parts.join(' and ')} so far`;
}

/**
 * The counter: "Mistakes 2", with "· 1 candidate" after it once a right
 * number has been struck from a cell's candidates — the two kinds apart, as
 * the Solved dialog keeps them. "Mistakes —" for a game whose mistakes are
 * not known, never a 0 it cannot vouch for. Empty while the board is hidden,
 * but still there, so nothing around it moves as the game pauses.
 */
export function ErrorCounter({ mistakes, isShown, placement }: ErrorCounterProps) {
  const className = `error-counter error-counter--${placement}`;
  if (!isShown) return <p className={className} />;
  if (mistakes === null) {
    return (
      <p className={className} title="Not recorded for this game">
        <span aria-hidden="true">
          Mistakes <span className="error-counter__count">—</span>
        </span>
        <span className="visually-hidden">Mistakes not recorded for this game</span>
      </p>
    );
  }
  return (
    <p className={className}>
      <span aria-hidden="true">
        Mistakes <span className="error-counter__count">{mistakes.values}</span>
        {mistakes.candidates > 0 && (
          <>
            {' · '}
            <span className="error-counter__count">{mistakes.candidates}</span>
            {mistakes.candidates === 1 ? ' candidate' : ' candidates'}
          </>
        )}
      </span>
      <span className="visually-hidden">{spokenCount(mistakes)}</span>
    </p>
  );
}

/** A line for the announcer's live region, keyed so the same words twice still speak. */
interface Announcement {
  text: string;
  id: number;
}

export interface MistakeAnnouncerProps {
  /** The counter's tally, as `ErrorCounter` is given it. */
  mistakes: MistakeTally | null;
  /** The game on screen: another game's count is a new start, not news. */
  gameId: string | null;
  /**
   * Whether the counter is on show (as `ErrorCounter`'s `isShown`). While it
   * is not — paused, or the board otherwise hidden — nothing is said, and no
   * new count is taken in: a mistake that settles as the game pauses is said
   * when the board, and the counter with it, shows again.
   */
  isShown: boolean;
}

/** "1 mistake counted.", "1 mistake and 1 candidate mistake counted." */
function countedText(values: number, candidates: number): string {
  const parts: string[] = [];
  if (values > 0) parts.push(count(values, 'mistake'));
  if (candidates > 0) parts.push(count(candidates, 'candidate mistake'));
  return `${parts.join(' and ')} counted.`;
}

/**
 * Says each mistake as it settles, politely, while the counter is on: a
 * sighted player sees the counter move, and a screen reader should hear it.
 * Once per mistake, and only for a rise in the count of the game on screen —
 * not for the count a game opens with, nor for the counter being switched
 * on. A region of its own, rather than the game's status region, as a
 * mistake that counts the moment it is made (Check guesses on) would
 * otherwise replace what that region says about the move itself.
 */
export function MistakeAnnouncer({ mistakes, gameId, isShown }: MistakeAnnouncerProps) {
  const [seen, setSeen] = useState<{
    gameId: string | null;
    mistakes: MistakeTally | null;
    message: Announcement | null;
  }>(() => ({ gameId, mistakes, message: null }));

  // Taken in while rendering, as React documents for state that follows a
  // prop: the render that brings the new count already says it.
  let current = seen;
  if (!isShown) {
    // Hidden: what was said goes, so it is not said again as the board
    // comes back; the count is left as last seen, to be compared then.
    if (seen.message !== null) {
      current = { ...seen, message: null };
      setSeen(current);
    }
  } else if (
    seen.gameId !== gameId ||
    seen.mistakes?.values !== mistakes?.values ||
    seen.mistakes?.candidates !== mistakes?.candidates
  ) {
    let { message } = seen;
    if (seen.gameId === gameId && seen.mistakes !== null && mistakes !== null) {
      const values = Math.max(0, mistakes.values - seen.mistakes.values);
      const candidates = Math.max(0, mistakes.candidates - seen.mistakes.candidates);
      if (values + candidates > 0) {
        message = { text: countedText(values, candidates), id: (message?.id ?? 0) + 1 };
      }
    }
    current = { gameId, mistakes, message };
    setSeen(current);
  }

  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {current.message && <span key={current.message.id}>{current.message.text}</span>}
    </div>
  );
}
