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
    });
  });

  it("reads a daily's date, which the app has still to check", () => {
    const url = buildShareUrl('https://x.test/', GIVENS, undefined, '2026-10-06');
    expect(readSharedLink(searchOf(url))).toMatchObject({ givens: GIVENS, daily: '2026-10-06' });
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
    });
    expect(readSharedLink('?p=')).toEqual({ code: '', givens: null, challenge: null, daily: null });
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
    window.history.replaceState({}, '', '/?p=abc&d=2026-10-06&t=10&n=Dan&a=c&keep=1#here');
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
