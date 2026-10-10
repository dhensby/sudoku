import { decodeGivens, formatGrid, parseGrid } from '../core';
import { WIKIPEDIA_PUZZLE } from '../test/grids';
import {
  buildShareText,
  buildShareUrl,
  canNativeShare,
  copyToClipboard,
  decodeAssists,
  decodeMistakes,
  encodeAssists,
  encodeMistakes,
  messageWithLink,
  nativeShare,
  shareBaseUrl,
  type ShareNavigator,
} from './share';

const GIVENS = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
const NONE = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
const BASE = 'https://dhensby.github.io/sudoku/';

describe('assists in links', () => {
  it.each([
    [NONE, ''],
    [{ ...NONE, autoCandidates: true }, 'c'],
    [{ autoCandidates: true, hints: 2, checks: 1, reveals: 12 }, 'ch2k1r12'],
    [{ ...NONE, reveals: 3 }, 'r3'],
  ])('round-trips %o as "%s"', (assists, packed) => {
    expect(encodeAssists(assists)).toBe(packed);
    expect(decodeAssists(packed)).toEqual(assists);
  });

  it('reads a missing or garbled parameter as no help, keeping what it can', () => {
    expect(decodeAssists(null)).toEqual(NONE);
    expect(decodeAssists('zzz')).toEqual(NONE);
    expect(decodeAssists('h2x?c')).toEqual({ ...NONE, hints: 2, autoCandidates: true });
  });
});

describe('mistakes in links', () => {
  it.each([
    [{ values: 0, candidates: 0 }, 'm0'],
    [{ values: 2, candidates: 0 }, 'm2'],
    [{ values: 0, candidates: 1 }, 'm0x1'],
    [{ values: 12, candidates: 3 }, 'm12x3'],
  ])('round-trips %o as "%s"', (mistakes, packed) => {
    expect(encodeMistakes(mistakes)).toBe(packed);
    expect(decodeMistakes(packed)).toEqual(mistakes);
  });

  it('packs mistakes not known to nothing, so the link says nothing of them', () => {
    expect(encodeMistakes(null)).toBe('');
    expect(encodeMistakes(undefined)).toBe('');
  });

  it('reads them from among the assists, wherever they sit', () => {
    expect(decodeMistakes('ch2k1m3x1')).toEqual({ values: 3, candidates: 1 });
    expect(decodeMistakes('m3ch2')).toEqual({ values: 3, candidates: 0 });
  });

  it.each([
    ['no parameter at all', null],
    ['help alone, as every link from before mistakes were shared', 'ch2k1r3'],
    ['candidate mistakes without the mistakes they go with', 'x2'],
    ['an empty parameter', ''],
    ['an "m" with no count', 'mh2'],
    ['more wrong numbers than a game can count', 'm9999'],
    ['more struck candidates than a game can count', 'm0x82'],
  ])('reads %s as not known, never as none', (_label, raw) => {
    expect(decodeMistakes(raw)).toBeNull();
  });

  it('reads counts to four digits, as the assists, so a longer one is garbled and not known', () => {
    expect(decodeMistakes('m0005')).toEqual({ values: 5, candidates: 0 });
    // "m1234" then a stray 5: 1,234 is more than any game counts.
    expect(decodeMistakes('m12345')).toBeNull();
  });

  it('leaves the assists as they were: the mistakes are invisible to them', () => {
    expect(decodeAssists('ch2m1x3')).toEqual({ ...NONE, autoCandidates: true, hints: 2 });
    expect(decodeAssists('m0')).toEqual(NONE);
  });

  /*
   * The decoder every version before this one shipped, copied here word for
   * word so that it stays as it was even as `decodeAssists` moves on: a link
   * from this version must open there with the same help, its mistakes
   * simply unsaid.
   */
  const OLD_ASSIST_PART = /c|([hkr])(\d{1,4})/g;
  function decodeAssistsBeforeMistakes(raw: string | null) {
    const assists = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
    if (raw === null) return assists;
    for (const match of raw.matchAll(OLD_ASSIST_PART)) {
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

  it.each([
    [NONE, { values: 0, candidates: 0 }],
    [NONE, { values: 7, candidates: 81 }],
    [
      { autoCandidates: true, hints: 2, checks: 1, reveals: 12 },
      { values: 1, candidates: 0 },
    ],
    [
      { ...NONE, reveals: 9999 },
      { values: 648, candidates: 3 },
    ],
    [{ ...NONE, checks: 4 }, null],
  ])('opens a new link to %o with %o on a version from before mistakes', (assists, mistakes) => {
    const url = new URL(buildShareUrl(BASE, GIVENS, { seconds: 90, name: '', assists, mistakes }));
    expect(decodeAssistsBeforeMistakes(url.searchParams.get('a'))).toEqual(assists);
    // And this version reads both back.
    expect(decodeAssists(url.searchParams.get('a'))).toEqual(assists);
    expect(decodeMistakes(url.searchParams.get('a'))).toEqual(mistakes);
  });
});

describe('buildShareUrl', () => {
  it('carries only the puzzle when there is no result', () => {
    const url = new URL(buildShareUrl(BASE, GIVENS));
    expect(url.origin + url.pathname).toBe(BASE);
    expect([...url.searchParams.keys()]).toEqual(['p']);
    expect(decodeGivens(url.searchParams.get('p')!)).toBe(GIVENS);
  });

  it('adds the time, name and assists of a result', () => {
    const url = new URL(
      buildShareUrl(BASE, GIVENS, {
        seconds: 323.9,
        name: ' Dan ',
        assists: { ...NONE, hints: 1 },
      }),
    );
    expect(url.searchParams.get('t')).toBe('323');
    expect(url.searchParams.get('n')).toBe('Dan');
    expect(url.searchParams.get('a')).toBe('h1');
  });

  it('adds known mistakes after the help, in the same parameter, a clean solve as "m0"', () => {
    const link = (assists: typeof NONE, mistakes: { values: number; candidates: number } | null) =>
      new URL(buildShareUrl(BASE, GIVENS, { seconds: 60, name: '', assists, mistakes }));
    expect(link({ ...NONE, hints: 1 }, { values: 2, candidates: 1 }).searchParams.get('a')).toBe(
      'h1m2x1',
    );
    // Unaided and clean still says so: 0 is a claim, and not known is not 0.
    expect(link(NONE, { values: 0, candidates: 0 }).searchParams.get('a')).toBe('m0');
    expect(link(NONE, null).searchParams.has('a')).toBe(false);
    expect([...link(NONE, { values: 0, candidates: 0 }).searchParams.keys()]).toEqual([
      'p',
      't',
      'a',
    ]);
  });

  it('leaves out an empty name and absent assists, and never shares a time of zero', () => {
    const url = new URL(buildShareUrl(BASE, GIVENS, { seconds: 0, name: '  ', assists: NONE }));
    expect(url.searchParams.get('t')).toBe('1');
    expect(url.searchParams.has('n')).toBe(false);
    expect(url.searchParams.has('a')).toBe(false);
  });

  it('says which daily it is, after the puzzle, with or without a result', () => {
    const bare = new URL(buildShareUrl(BASE, GIVENS, undefined, '2026-10-13'));
    expect([...bare.searchParams.keys()]).toEqual(['p', 'd']);
    expect(bare.searchParams.get('d')).toBe('2026-10-13');
    const timed = new URL(
      buildShareUrl(BASE, GIVENS, { seconds: 90, name: '', assists: NONE }, '2026-10-13'),
    );
    expect([...timed.searchParams.keys()]).toEqual(['p', 'd', 't']);
    expect(new URL(buildShareUrl(BASE, GIVENS, undefined, null)).searchParams.has('d')).toBe(false);
  });

  it('replaces whatever query and hash the base had', () => {
    const url = buildShareUrl(`${BASE}?p=old&x=1#frag`, GIVENS);
    expect(url).not.toMatch(/old|x=1|#frag/);
  });
});

describe('buildShareText', () => {
  it('invites a friend to an unsolved puzzle', () => {
    expect(buildShareText({ difficulty: 'hard' })).toBe('Try this Hard Sudoku!');
  });

  it('states a result, and the help it came with', () => {
    expect(buildShareText({ difficulty: 'easy', result: { seconds: 323, assists: NONE } })).toBe(
      'Sudoku · Easy · 5:23\nCan you beat my time?',
    );
    expect(
      buildShareText({
        difficulty: 'expert',
        result: { seconds: 3725, assists: { ...NONE, autoCandidates: true, hints: 2 } },
      }),
    ).toBe('Sudoku · Expert · 1:02:05\nWith auto candidates, 2 hints\nCan you beat my time?');
  });

  it('says the mistakes, when known, on the line under the time, with the help after them', () => {
    const text = (assists: typeof NONE, mistakes: { values: number; candidates: number } | null) =>
      buildShareText({ difficulty: 'easy', result: { seconds: 323, assists, mistakes } });
    expect(text(NONE, { values: 0, candidates: 0 })).toBe(
      'Sudoku · Easy · 5:23\nNo mistakes\nCan you beat my time?',
    );
    expect(text({ ...NONE, hints: 2 }, { values: 0, candidates: 0 })).toBe(
      'Sudoku · Easy · 5:23\nNo mistakes · with 2 hints\nCan you beat my time?',
    );
    expect(text(NONE, { values: 2, candidates: 1 })).toBe(
      'Sudoku · Easy · 5:23\n2 mistakes · 1 candidate mistake\nCan you beat my time?',
    );
    // Not known: nothing of mistakes at all, rather than "No mistakes".
    expect(text(NONE, null)).toBe('Sudoku · Easy · 5:23\nCan you beat my time?');
    expect(text({ ...NONE, checks: 1 }, null)).toBe(
      'Sudoku · Easy · 5:23\nWith 1 check\nCan you beat my time?',
    );
  });

  it("names a daily by its date and year, solved or not, so a group chat's dailies line up", () => {
    expect(buildShareText({ difficulty: 'hard', daily: '2026-10-13' })).toBe(
      'Sudoku Daily · 13 Oct 2026 · Hard\nCan you solve it?',
    );
    expect(
      buildShareText({
        difficulty: 'hard',
        daily: '2026-10-13',
        result: { seconds: 323, assists: { ...NONE, hints: 1 } },
      }),
    ).toBe('Sudoku Daily · 13 Oct 2026 · Hard · 5:23\nWith 1 hint\nCan you beat my time?');
    // A daily's first line stays as it was, with the mistakes under it.
    expect(
      buildShareText({
        difficulty: 'hard',
        daily: '2026-10-13',
        result: { seconds: 323, assists: NONE, mistakes: { values: 1, candidates: 0 } },
      }),
    ).toBe('Sudoku Daily · 13 Oct 2026 · Hard · 5:23\n1 mistake\nCan you beat my time?');
  });

  it('says the same time as the link for a solve under a second', () => {
    const result = { seconds: 0, assists: NONE };
    const link = new URL(buildShareUrl(BASE, GIVENS, { ...result, name: '' }));
    expect(link.searchParams.get('t')).toBe('1');
    expect(buildShareText({ difficulty: 'easy', result })).toMatch(/^Sudoku · Easy · 0:01\n/);
  });

  it('joins message and link for the clipboard', () => {
    expect(messageWithLink('Hi', 'https://x/')).toBe('Hi\nhttps://x/');
  });
});

describe('shareBaseUrl', () => {
  it('points at the app root on the current origin', () => {
    expect(shareBaseUrl()).toBe(`${window.location.origin}/`);
  });
});

describe('native share and clipboard', () => {
  const payload = { title: 'Sudoku', text: 'Hi', url: BASE };

  it('knows when a share sheet is available', () => {
    expect(canNativeShare(payload, {})).toBe(false);
    expect(canNativeShare(payload, { share: async () => {} })).toBe(true);
    expect(canNativeShare(payload, { share: async () => {}, canShare: () => false })).toBe(false);
  });

  it('reports shared, cancelled and failed outcomes', async () => {
    const share = vi.fn(async () => {});
    expect(await nativeShare(payload, { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith(payload);

    const abort = Object.assign(new Error('dismissed'), { name: 'AbortError' });
    expect(await nativeShare(payload, { share: () => Promise.reject(abort) })).toBe('cancelled');
    expect(await nativeShare(payload, { share: () => Promise.reject(new Error('no')) })).toBe(
      'failed',
    );
    expect(await nativeShare(payload, { share: () => Promise.reject('weird') })).toBe('failed');
    expect(await nativeShare(payload, {})).toBe('failed');
  });

  it('copies when it can, and fails quietly when it cannot', async () => {
    const writeText = vi.fn(async () => {});
    const nav: ShareNavigator = { clipboard: { writeText } };
    expect(await copyToClipboard('text', nav)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('text');
    expect(await copyToClipboard('text', {})).toBe('failed');
    expect(
      await copyToClipboard('text', {
        clipboard: { writeText: () => Promise.reject(new Error()) },
      }),
    ).toBe('failed');
  });
});
