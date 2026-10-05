import { decodeGivens, type GridString } from '../core';
import type { Challenge } from '../storage/history';
import { normaliseName } from '../storage/storage';
import { decodeAssists } from './share';

/** The parameters a share link may carry. */
const SHARE_PARAMS = ['p', 't', 'n', 'a'] as const;

/** What a share link asked for. */
export interface SharedLink {
  /** The raw puzzle code from `?p=`. */
  code: string;
  /** The givens it decodes to, or null when the code is not a puzzle at all. */
  givens: GridString | null;
  /** The sharer's result to race, when the link carries a usable one. */
  challenge: Challenge | null;
}

/**
 * Read a share link from a query string (`window.location.search`).
 *
 * Returns null when there is no `?p=` at all. A `?p=` that does not decode
 * still comes back — with null givens — so the app can say the link is broken
 * instead of silently ignoring it. The result parameters are optional and
 * forgiving: a time that is not a whole number of seconds drops the challenge,
 * an unusable name drops the name, and garbled assists read as none.
 *
 * Nothing from the link is trusted beyond the givens themselves: the caller
 * still validates them, and re-grades the puzzle rather than taking a
 * difficulty label on faith.
 */
export function readSharedLink(search: string): SharedLink | null {
  const params = new URLSearchParams(search);
  const code = params.get('p');
  if (code === null) return null;

  const time = params.get('t');
  const seconds = time !== null && /^\d{1,7}$/.test(time) ? Number(time) : 0;
  const name = normaliseName(params.get('n'));
  const challenge: Challenge | null =
    seconds >= 1
      ? { name: name === '' ? null : name, seconds, assists: decodeAssists(params.get('a')) }
      : null;

  return { code, givens: decodeGivens(code), challenge };
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
