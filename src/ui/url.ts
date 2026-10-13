import { decodeGivens, isDateKey, type DateKey, type GridString } from '../core';
import type { Challenge } from '../storage/history';
import { isPlayerId, normaliseName, normaliseTitle } from '../storage/storage';
import { decodeAssists, decodeMistakes } from './share';

/** The parameters a share link may carry. */
const SHARE_PARAMS = ['p', 'd', 't', 'n', 'u', 'a', 'l', 's'] as const;

/** What a share link asked for. */
export interface SharedLink {
  /** The raw puzzle code from `?p=`. */
  code: string;
  /** The givens it decodes to, or null when the code is not a puzzle at all. */
  givens: GridString | null;
  /** The sharer's result to race, when the link carries a usable one. */
  challenge: Challenge | null;
  /**
   * The date of the daily the link says its puzzle is (`&d=`), when it names
   * a real date. Only a claim: the app checks it against that date's daily
   * before recording the game as one.
   */
  daily: DateKey | null;
  /**
   * The sharer's solve, as its encoded move log (`&s=`), when the link
   * carries one alongside a usable result — read as it came, still to be
   * checked against the puzzle and the time (see `sharedSolveRefusal`)
   * before it is offered to watch; null otherwise.
   */
  solve: string | null;
  /**
   * The puzzle's name, as the link gives it (`&l=`): its sender's for it in
   * Your puzzles, or the one their own link gave. Tidied as one is there (see
   * `normaliseTitle`); null when the link gives none, or nothing is left of
   * it.
   */
  title: string | null;
}

/**
 * Read a share link from a query string (`window.location.search`).
 *
 * Returns null when there is no `?p=` at all. A `?p=` that does not decode
 * still comes back — with null givens — so the app can say the link is broken
 * instead of silently ignoring it. The result parameters are optional and
 * forgiving: a time that is not a whole number of seconds drops the challenge,
 * an unusable name drops the name, garbled assists read as none, and a
 * daily's date that is not a real date is no date at all. Mistakes are the
 * exception: a link that does not say them — every link from before they
 * were shared — or says them in a way no game could have counted leaves the
 * challenge's mistakes unset, not known, never none (see `decodeMistakes`).
 *
 * A puzzle's name (`&l=`) comes back with or without a result, tidied as a
 * name is: free text anyone can write, for drawing in its own direction.
 *
 * A solve (`&s=`) only comes back with a result to go with it, as it is
 * checked against the result's time. So does the sharer's player ID (`&u=`),
 * on the challenge: one that is not shaped like an ID (see `isPlayerId`) is
 * no ID, and costs only itself — the challenger is then known by their name
 * alone, as from a link made before IDs.
 *
 * Nothing from the link is trusted beyond the givens themselves: the caller
 * still validates them, re-grades the puzzle rather than taking a
 * difficulty label on faith (so a puzzle beyond the techniques the grader
 * knows reads Beyond Expert, wherever it came from), checks a daily's date
 * against that day's puzzles, and replays a solve before offering it.
 */
export function readSharedLink(search: string): SharedLink | null {
  const params = new URLSearchParams(search);
  const code = params.get('p');
  if (code === null) return null;

  const time = params.get('t');
  const seconds = time !== null && /^\d{1,7}$/.test(time) ? Number(time) : 0;
  const name = normaliseName(params.get('n'));
  const assists = params.get('a');
  const mistakes = decodeMistakes(assists);
  const playerId = params.get('u');
  const challenge: Challenge | null =
    seconds >= 1
      ? {
          name: name === '' ? null : name,
          seconds,
          assists: decodeAssists(assists),
          ...(mistakes === null ? {} : { mistakes }),
          ...(isPlayerId(playerId) ? { playerId } : {}),
        }
      : null;

  const date = params.get('d');
  const daily = isDateKey(date) ? date : null;

  const solve = challenge === null ? null : params.get('s');
  const title = normaliseTitle(params.get('l'));

  return {
    code,
    givens: decodeGivens(code),
    challenge,
    daily,
    solve: solve === '' ? null : solve,
    title: title === '' ? null : title,
  };
}

/**
 * Drop the share parameters from the address bar once a link has been opened,
 * keeping anything else in the URL. Otherwise a reload — or a bookmark made a
 * week later — would keep dragging the player back to the shared puzzle after
 * they had moved on.
 */
export function clearShareParams(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const name of SHARE_PARAMS) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(window.history.state, '', url.href);
}
