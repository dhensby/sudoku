import { formatGrid, parseGrid } from '../core';
import { WIKIPEDIA_PUZZLE } from '../test/grids';
import { buildShareUrl } from './share';
import { clearShareParams, readSharedLink } from './url';

const GIVENS = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
const NONE = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };

function searchOf(url: string): string {
  return new URL(url).search;
}

describe('readSharedLink', () => {
  it('returns null when there is no puzzle parameter', () => {
    expect(readSharedLink('')).toBeNull();
    expect(readSharedLink('?t=10')).toBeNull();
  });

  it('decodes the puzzle of a plain link, with no challenge', () => {
    const link = readSharedLink(searchOf(buildShareUrl('https://x.test/', GIVENS)));
    expect(link).toEqual({
      code: expect.any(String),
      givens: GIVENS,
      challenge: null,
      daily: null,
      solve: null,
    });
  });

  it("reads a daily's date, which the app has still to check", () => {
    const url = buildShareUrl('https://x.test/', GIVENS, undefined, '2026-10-13');
    expect(readSharedLink(searchOf(url))).toMatchObject({ givens: GIVENS, daily: '2026-10-13' });
  });

  it.each(['2026-02-30', '2026-10-6', 'yesterday', ''])(
    'ignores a daily date of "%s", which is no date at all',
    (d) => {
      const url = new URL(buildShareUrl('https://x.test/', GIVENS));
      url.searchParams.set('d', d);
      expect(readSharedLink(url.search)).toMatchObject({ givens: GIVENS, daily: null });
    },
  );

  it('reads the challenge from a result link', () => {
    const url = buildShareUrl('https://x.test/', GIVENS, {
      seconds: 323,
      name: 'Dan',
      assists: { ...NONE, hints: 2 },
    });
    expect(readSharedLink(searchOf(url))?.challenge).toEqual({
      name: 'Dan',
      seconds: 323,
      assists: { ...NONE, hints: 2 },
    });
  });

  it("reads the sharer's mistakes from a result link, a clean solve as none", () => {
    const linkWith = (mistakes: { values: number; candidates: number }) =>
      buildShareUrl('https://x.test/', GIVENS, {
        seconds: 323,
        name: 'Dan',
        assists: NONE,
        mistakes,
      });
    expect(readSharedLink(searchOf(linkWith({ values: 2, candidates: 1 })))?.challenge).toEqual({
      name: 'Dan',
      seconds: 323,
      assists: NONE,
      mistakes: { values: 2, candidates: 1 },
    });
    expect(
      readSharedLink(searchOf(linkWith({ values: 0, candidates: 0 })))?.challenge?.mistakes,
    ).toEqual({ values: 0, candidates: 0 });
  });

  it.each([
    ['carries no assists at all', null],
    ['carries help alone', 'ch2'],
    ['garbles them', 'm99999x'],
  ])('leaves the mistakes not known, never none, when an old link %s', (_label, a) => {
    const url = new URL(buildShareUrl('https://x.test/', GIVENS));
    url.searchParams.set('t', '323');
    if (a !== null) url.searchParams.set('a', a);
    const challenge = readSharedLink(url.search)?.challenge;
    expect(challenge).not.toBeNull();
    expect(challenge).not.toHaveProperty('mistakes');
  });

  it('reads guesses checked as entered from a result link', () => {
    const url = buildShareUrl('https://x.test/', GIVENS, {
      seconds: 323,
      name: 'Dan',
      assists: { ...NONE, checkGuesses: true },
    });
    expect(new URL(url).searchParams.get('a')).toBe('g');
    expect(readSharedLink(searchOf(url))?.challenge?.assists).toEqual({
      ...NONE,
      checkGuesses: true,
    });
  });

  it('reads a solve that comes with a result, as it came, for the app to check', () => {
    const url = buildShareUrl('https://x.test/', GIVENS, {
      seconds: 60,
      name: 'Dan',
      assists: NONE,
      log: 'BBAxy-_z',
    });
    expect(readSharedLink(searchOf(url))).toMatchObject({
      challenge: { name: 'Dan', seconds: 60 },
      solve: 'BBAxy-_z',
    });
    // No log on the challenge until it checks out.
    expect(readSharedLink(searchOf(url))?.challenge).not.toHaveProperty('log');
  });

  it('ignores a solve with no time to go with it, and an empty one', () => {
    expect(
      readSharedLink(`${searchOf(buildShareUrl('https://x.test/', GIVENS))}&s=BBA`),
    ).toMatchObject({ challenge: null, solve: null });
    const timed = buildShareUrl('https://x.test/', GIVENS, {
      seconds: 60,
      name: '',
      assists: NONE,
    });
    expect(readSharedLink(`${searchOf(timed)}&s=`)?.solve).toBeNull();
  });

  it('keeps a challenge without a name', () => {
    const url = buildShareUrl('https://x.test/', GIVENS, { seconds: 60, name: '', assists: NONE });
    expect(readSharedLink(searchOf(url))?.challenge).toEqual({
      name: null,
      seconds: 60,
      assists: NONE,
    });
  });

  it('still reports a link whose puzzle does not decode, so the app can say so', () => {
    expect(readSharedLink('?p=!!!')).toEqual({
      code: '!!!',
      givens: null,
      challenge: null,
      daily: null,
      solve: null,
    });
    expect(readSharedLink('?p=')).toEqual({
      code: '',
      givens: null,
      challenge: null,
      daily: null,
      solve: null,
    });
  });

  it.each(['0', '-5', '1.5', 'abc', '', '99999999'])(
    'drops a challenge whose time is "%s"',
    (t) => {
      const url = new URL(buildShareUrl('https://x.test/', GIVENS));
      url.searchParams.set('t', t);
      expect(readSharedLink(url.search)?.challenge).toBeNull();
    },
  );

  it('cleans a hostile name', () => {
    const url = new URL(buildShareUrl('https://x.test/', GIVENS));
    url.searchParams.set('t', '42');
    url.searchParams.set('n', `  <b>\n${'x'.repeat(50)}`);
    const name = readSharedLink(url.search)?.challenge?.name;
    expect(name).not.toMatch(/\n/);
    expect(name!.length).toBeLessThanOrEqual(24);
  });
});

describe('clearShareParams', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('removes the share parameters and keeps the rest of the URL', () => {
    window.history.replaceState({}, '', '/?p=abc&d=2026-10-13&t=10&n=Dan&a=c&s=BBA&keep=1#here');
    clearShareParams();
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#here');
  });

  it('leaves history alone when there is nothing to remove', () => {
    window.history.replaceState({ marker: 1 }, '', '/?keep=1');
    const spy = vi.spyOn(window.history, 'replaceState');
    clearShareParams();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
