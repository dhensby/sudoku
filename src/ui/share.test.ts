import { decodeGivens, formatGrid, parseGrid } from '../core';
import { WIKIPEDIA_PUZZLE } from '../test/grids';
import {
  buildShareText,
  buildShareUrl,
  canNativeShare,
  copyToClipboard,
  decodeAssists,
  encodeAssists,
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

  it('leaves out an empty name and absent assists, and never shares a time of zero', () => {
    const url = new URL(buildShareUrl(BASE, GIVENS, { seconds: 0, name: '  ', assists: NONE }));
    expect(url.searchParams.get('t')).toBe('1');
    expect(url.searchParams.has('n')).toBe(false);
    expect(url.searchParams.has('a')).toBe(false);
  });

  it('says which daily it is, after the puzzle, with or without a result', () => {
    const bare = new URL(buildShareUrl(BASE, GIVENS, undefined, '2026-10-06'));
    expect([...bare.searchParams.keys()]).toEqual(['p', 'd']);
    expect(bare.searchParams.get('d')).toBe('2026-10-06');
    const timed = new URL(
      buildShareUrl(BASE, GIVENS, { seconds: 90, name: '', assists: NONE }, '2026-10-06'),
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
    ).toBe('Sudoku · Expert · 1:02:05\n(with auto candidates, 2 hints)\nCan you beat my time?');
  });

  it("names a daily by its date and year, solved or not, so a group chat's dailies line up", () => {
    expect(buildShareText({ difficulty: 'hard', daily: '2026-10-06' })).toBe(
      'Sudoku Daily · 6 Oct 2026 · Hard\nCan you solve it?',
    );
    expect(
      buildShareText({
        difficulty: 'hard',
        daily: '2026-10-06',
        result: { seconds: 323, assists: { ...NONE, hints: 1 } },
      }),
    ).toBe('Sudoku Daily · 6 Oct 2026 · Hard · 5:23\n(with 1 hint)\nCan you beat my time?');
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
