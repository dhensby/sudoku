import { decodeGivens, isDateKey, type DateKey, type GridString } from '../core';
import type { Challenge } from '../storage/history';
import { normaliseName } from '../storage/storage';
import { decodeAssists, decodeMistakes } from './share';

/** The parameters a share link may carry. */
const SHARE_PARAMS = ['p', 'd', 't', 'n', 'a', 's'] as const;

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
 * A solve (`&s=`) only comes back with a result to go with it, as it is
 * checked against the result's time.
 *
 * Nothing from the link is trusted beyond the givens themselves: the caller
 * still validates them, re-grades the puzzle rather than taking a
 * difficulty label on faith, checks a daily's date against that day's
 * puzzles, and replays a solve before offering it.
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
  const challenge: Challenge | null =
    seconds >= 1
      ? {
          name: name === '' ? null : name,
          seconds,
          assists: decodeAssists(assists),
          ...(mistakes === null ? {} : { mistakes }),
        }
      : null;

  const date = params.get('d');
  const daily = isDateKey(date) ? date : null;

  const solve = challenge === null ? null : params.get('s');

  return { code, givens: decodeGivens(code), challenge, daily, solve: solve === '' ? null : solve };
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
