import {
  encodeGivens,
  formatDuration,
  type Assists,
  type DateKey,
  type Difficulty,
  type GridString,
} from '../core';
import { normaliseName } from '../storage/storage';
import { DIFFICULTY_LABEL, describeAssists, formatDayWithYear } from './format';

export { MAX_NAME_LENGTH } from '../storage/storage';

/*
 * Share links carry the puzzle itself — its givens, packed into a short code —
 * so a link opens the same puzzle for anyone, forever, whatever the generator
 * does next. A solved game's link adds the sharer's result so the friend who
 * opens it knows the time to beat. There is no server: everything a friend
 * needs travels in the URL.
 *
 * A daily's link says which daily it is, too (`&d=2026-10-13`), so the
 * friend's game is recorded as that daily — once the app has checked that
 * the date's daily really is this puzzle — and shows in their calendar.
 */

/** A result to put in a link: the time to beat and the help it came with. */
export interface ShareResult {
  seconds: number;
  /** The sharer's name, or '' to stay anonymous. */
  name: string;
  assists: Assists;
}

/**
 * Where links point: the app's own root, so they work from the `/sudoku/`
 * sub-path on GitHub Pages as well as from `/` locally.
 */
export function shareBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/**
 * Pack assists into a few characters: `c` for auto candidates, then `h`, `k`
 * and `r` each followed by a count of hints, checks and reveals. An unassisted
 * game packs to '', and the link leaves the parameter out.
 */
export function encodeAssists(assists: Assists): string {
  let out = assists.autoCandidates ? 'c' : '';
  if (assists.hints > 0) out += `h${assists.hints}`;
  if (assists.checks > 0) out += `k${assists.checks}`;
  if (assists.reveals > 0) out += `r${assists.reveals}`;
  return out;
}

const ASSIST_PART = /c|([hkr])(\d{1,4})/g;

/**
 * Unpack assists from a link. Tolerant: anything it does not recognise is
 * skipped rather than rejected, because a mangled link should still open the
 * puzzle — it just shows less about the sharer's help.
 */
export function decodeAssists(raw: string | null): Assists {
  const assists: Assists = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
  if (raw === null) return assists;
  for (const match of raw.matchAll(ASSIST_PART)) {
    if (match[0] === 'c') {
      assists.autoCandidates = true;
      continue;
    }
    const n = Number(match[2]);
    if (match[1] === 'h') assists.hints = n;
    else if (match[1] === 'k') assists.checks = n;
    else assists.reveals = n;
  }
  return assists;
}

/**
 * The whole seconds a result is shared as, in its message and its link alike.
 * A link can't carry a time of zero — `readSharedLink` drops it, as a 0:00
 * could never be beaten — so a solve under a second goes out as 0:01, and the
 * message says so too rather than promising a 0:00 the friend never sees.
 */
function sharedSeconds(seconds: number): number {
  return Math.max(1, Math.floor(seconds));
}

/**
 * The link that opens `givens` — with the date of the daily it is, if it is
 * one, and the sharer's result, when there is one.
 */
export function buildShareUrl(
  base: string,
  givens: GridString,
  result?: ShareResult,
  daily?: DateKey | null,
): string {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('p', encodeGivens(givens));
  if (daily !== undefined && daily !== null) url.searchParams.set('d', daily);
  if (result !== undefined) {
    url.searchParams.set('t', String(sharedSeconds(result.seconds)));
    const name = normaliseName(result.name);
    if (name !== '') url.searchParams.set('n', name);
    const assists = encodeAssists(result.assists);
    if (assists !== '') url.searchParams.set('a', assists);
  }
  return url.href;
}

/**
 * The message that goes with a link, Wordle-style: short, and readable in a
 * chat preview. The URL itself is not included — `navigator.share` takes it
 * separately, and `messageWithLink` joins the two for the clipboard.
 *
 * A daily names itself, date and year included — the message may be read
 * days later — as "Sudoku Daily · 13 Oct 2026 · Hard", the same first line
 * whether or not it carries a time, so a group chat's dailies line up.
 */
export function buildShareText({
  difficulty,
  result,
  daily = null,
}: {
  difficulty: Difficulty;
  result?: Pick<ShareResult, 'seconds' | 'assists'>;
  /** The date of the daily the puzzle is, if it is one. */
  daily?: DateKey | null;
}): string {
  const label = DIFFICULTY_LABEL[difficulty];
  const name =
    daily === null ? `Sudoku · ${label}` : `Sudoku Daily · ${formatDayWithYear(daily)} · ${label}`;
  if (result === undefined) {
    return daily === null ? `Try this ${label} Sudoku!` : `${name}\nCan you solve it?`;
  }
  const lines = [`${name} · ${formatDuration(sharedSeconds(result.seconds) * 1000)}`];
  const assists = describeAssists(result.assists);
  if (assists !== null) lines.push(`(with ${assists})`);
  lines.push('Can you beat my time?');
  return lines.join('\n');
}

/** The message and link as one block of text, for the clipboard. */
export function messageWithLink(text: string, url: string): string {
  return `${text}\n${url}`;
}

/** What a share or copy attempt came to. */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** The bits of `navigator` sharing needs — injectable so tests need no browser. */
export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: Pick<Clipboard, 'writeText'>;
}

/** Whether the platform has a native share sheet for this payload. */
export function canNativeShare(payload: ShareData, nav: ShareNavigator = navigator): boolean {
  if (typeof nav.share !== 'function') return false;
  return typeof nav.canShare !== 'function' || nav.canShare(payload);
}

/**
 * Open the native share sheet. Dismissing it is not a failure — the browser
 * rejects with an AbortError, which comes back as 'cancelled' so the caller
 * can stay quiet about it.
 */
export async function nativeShare(
  payload: ShareData,
  nav: ShareNavigator = navigator,
): Promise<ShareOutcome> {
  if (!canNativeShare(payload, nav)) return 'failed';
  try {
    await nav.share!(payload);
    return 'shared';
  } catch (error) {
    return error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/**
 * Copy text to the clipboard. Fails (rather than throwing) where the API is
 * missing or refused — an insecure origin, an old browser, a denied
 * permission — so the caller can fall back to showing the text to copy by hand.
 */
export async function copyToClipboard(
  text: string,
  nav: ShareNavigator = navigator,
): Promise<ShareOutcome> {
  if (nav.clipboard === undefined) return 'failed';
  try {
    await nav.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
