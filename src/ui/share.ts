import {
  encodeGivens,
  formatDuration,
  isPossibleTally,
  type Assists,
  type DateKey,
  type Difficulty,
  type GridString,
  type MistakeTally,
} from '../core';
import { normaliseName } from '../storage/storage';
import { DIFFICULTY_LABEL, describeResult, formatDayWithYear } from './format';

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
 *
 * A solve's mistakes travel too, inside the assists parameter (see
 * `encodeMistakes`) rather than in one of their own, so a link stays as short
 * as it was and a version from before them opens it just the same.
 *
 * A solved game's link can carry the solve itself, too (`&s=`): its move log,
 * base64url already, so a friend can watch how it was done (see
 * `src/core/playback.ts`). Only with a time, which it must agree with (see
 * `sharedSolveRefusal`), and only when the sharer chooses to: it makes the
 * link several times longer, and it gives the puzzle away. A version from
 * before solves were shared skips the parameter it does not know — it only
 * stays in that version's address bar, as it does not clear it.
 */

/** A result to put in a link: the time to beat, the help it came with and its mistakes. */
export interface ShareResult {
  seconds: number;
  /** The sharer's name, or '' to stay anonymous. */
  name: string;
  assists: Assists;
  /**
   * The solve's mistakes, as its record has them (`recordedMistakes`), or
   * null (or left out) when they are not known — which the link then says
   * nothing about, as it is not the same as none.
   */
  mistakes?: MistakeTally | null;
  /**
   * The solve, as its encoded move log, for a friend to watch — only ever one
   * this build plays back to the solve at this time (see
   * `sharedSolveRefusal`) — or null (or left out) to send the time alone.
   */
  log?: string | null;
}

/**
 * The line a message with a solve in its link adds, after the challenge:
 * that it can be watched, and — as watching first costs the friend their
 * time — that it is for after a go of their own. It says nothing of how the
 * solve went, so it spoils nothing on its own.
 */
export const SOLVE_LINE = "You can watch my solve too, once you've had a go.";

/**
 * Where links point: the app's own root, so they work from the `/sudoku/`
 * sub-path on GitHub Pages as well as from `/` locally.
 */
export function shareBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/**
 * Pack assists into a few characters: `c` for auto candidates, `g` for
 * guesses checked as entered, then `h`, `k` and `r` each followed by a count
 * of hints, checks and reveals. An unassisted game packs to '', and the link
 * leaves the parameter out.
 *
 * A link opened by a version from before a letter was added must still open,
 * and read the rest right: its decoder skips what it does not know (`g` was
 * added after the others, and a version from before it reads `cgh2` as auto
 * candidates and 2 hints). So a new kind of help takes a new letter, never
 * a new meaning for an old one.
 */
export function encodeAssists(assists: Assists): string {
  let out = assists.autoCandidates ? 'c' : '';
  if (assists.checkGuesses === true) out += 'g';
  if (assists.hints > 0) out += `h${assists.hints}`;
  if (assists.checks > 0) out += `k${assists.checks}`;
  if (assists.reveals > 0) out += `r${assists.reveals}`;
  return out;
}

/**
 * The assist codes this version reads: `c` auto candidates, `g` guesses
 * checked as entered, and the counted `h`, `k` and `r`. Every version
 * skips letters it doesn't know, which is what lets later codes ride along
 * without breaking the versions before them — `g` past those before it, and
 * the mistakes' `m` and `x` past all of them; a new code must use a letter
 * none of them reads.
 */
const ASSIST_PART = /[cg]|([hkr])(\d{1,4})/g;

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
    if (match[0] === 'g') {
      assists.checkGuesses = true;
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
 * Pack a solve's mistakes, to follow its assists in the same parameter: `m`
 * and the count of wrong numbers, always, once the count is known — so a
 * clean solve sends `m0`, and a link that says nothing (one from an older
 * version, or a solve not counted) is told apart from one that says none —
 * then `x` and the count of candidate mistakes, when there were any. Not
 * known packs to ''.
 *
 * Letters a version before mistakes never used: its decoder skips what it
 * does not know (see `ASSIST_PART`), so such a link still opens there, with
 * the same help, and only the mistakes go unsaid.
 */
export function encodeMistakes(mistakes: MistakeTally | null | undefined): string {
  if (mistakes === null || mistakes === undefined) return '';
  return mistakes.candidates > 0
    ? `m${mistakes.values}x${mistakes.candidates}`
    : `m${mistakes.values}`;
}

const MISTAKE_PART = /([mx])(\d{1,4})/g;

/**
 * Unpack a solve's mistakes from a link's assists parameter, or null when it
 * does not say. Strict where `decodeAssists` is forgiving: without an `m`,
 * the mistakes are not known — never none, as a link from before mistakes
 * were shared has none to say — and a count no game could make (see
 * `isPossibleTally`) is no count at all. A missing `x` is no candidate
 * mistakes, as the encoder leaves it out for none.
 */
export function decodeMistakes(raw: string | null): MistakeTally | null {
  if (raw === null) return null;
  let values: number | null = null;
  let candidates = 0;
  for (const match of raw.matchAll(MISTAKE_PART)) {
    if (match[1] === 'm') values = Number(match[2]);
    else candidates = Number(match[2]);
  }
  if (values === null) return null;
  const mistakes = { values, candidates };
  return isPossibleTally(mistakes) ? mistakes : null;
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
    // Mistakes after the help, in the same parameter (see `encodeMistakes`).
    const assists = encodeAssists(result.assists) + encodeMistakes(result.mistakes);
    if (assists !== '') url.searchParams.set('a', assists);
    // Last, as the longest by far: a chat preview cut short keeps the rest.
    if (result.log !== undefined && result.log !== null) url.searchParams.set('s', result.log);
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
 *
 * Under a time, a line says how it was earned, as the Ready card a friend
 * opens it on does (see `describeResult`): "No mistakes · with 2 hints",
 * "1 mistake", "With auto candidates" — the mistakes only when the count is
 * known, and nothing at all for an unaided solve whose count is not. A link
 * carrying the solve says so at the end (see `SOLVE_LINE`).
 */
export function buildShareText({
  difficulty,
  result,
  daily = null,
}: {
  difficulty: Difficulty;
  result?: Pick<ShareResult, 'seconds' | 'assists' | 'mistakes' | 'log'>;
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
  const how = describeResult(result.assists, result.mistakes ?? null);
  if (how !== null) lines.push(how);
  lines.push('Can you beat my time?');
  if (result.log !== undefined && result.log !== null) lines.push(SOLVE_LINE);
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
