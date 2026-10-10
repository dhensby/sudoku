import { MAX_NEWER_FIELDS, MAX_NEWER_FIELD_JSON, fieldsOf, newerFields } from './newerFields';

const KNOWN = ['id', 'seconds'] as const;

describe('newerFields', () => {
  it('keeps the small fields it does not know, and none it does', () => {
    const source = {
      id: 'x',
      seconds: 5,
      mistakes: { values: 2, candidates: 1 },
      checkGuesses: true,
    };
    expect(newerFields(source, KNOWN)).toEqual({
      mistakes: { values: 2, candidates: 1 },
      checkGuesses: true,
    });
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'mistakes'],
    ['an array', [{ mistakes: 1 }]],
  ])('is empty for %s', (_label, source) => {
    expect(newerFields(source, KNOWN)).toEqual({});
  });

  it('copies what it keeps, sharing nothing with the source', () => {
    const mistakes = { values: 2 };
    const kept = newerFields({ mistakes }, KNOWN);
    mistakes.values = 9;
    expect(kept.mistakes).toEqual({ values: 2 });
  });

  it.each([
    ['starts with a capital', 'Mistakes'],
    ['starts with a digit', '2fa'],
    ['has a digit in it', 'moves2'],
    ['has an underscore', 'move_log'],
    ['has a dash', 'move-log'],
    ['is empty', ''],
    ['is longer than 24 characters', `a${'b'.repeat(24)}`],
    ['is a name every object already has', 'constructor'],
    ['is another of them', 'toString'],
  ])('drops a field whose key %s', (_label, key) => {
    expect(newerFields({ [key]: 1 }, KNOWN)).toEqual({});
  });

  it('keeps a key of exactly 24 characters', () => {
    const key = `a${'b'.repeat(23)}`;
    expect(newerFields({ [key]: 1 }, KNOWN)).toEqual({ [key]: 1 });
  });

  it('never takes __proto__ as a prototype', () => {
    const kept = newerFields(JSON.parse('{"__proto__": {"polluted": true}}'), KNOWN);
    expect(kept).toEqual({});
    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype);
  });

  it(`keeps a value of up to ${MAX_NEWER_FIELD_JSON} characters of JSON and drops a longer one`, () => {
    // A string's JSON is the string plus its two quotes.
    const longest = 'x'.repeat(MAX_NEWER_FIELD_JSON - 2);
    expect(newerFields({ note: longest }, KNOWN)).toEqual({ note: longest });
    expect(newerFields({ note: `${longest}x` }, KNOWN)).toEqual({});
  });

  it('drops a value JSON cannot hold, rather than throwing', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const source = { cycle, big: 1n, fn: () => 1, gone: undefined, kept: 1 };
    expect(newerFields(source, KNOWN)).toEqual({ kept: 1 });
  });

  it(`keeps at most ${MAX_NEWER_FIELDS} fields, the first that qualify`, () => {
    const source: Record<string, unknown> = { Junk: 1, tooBig: 'x'.repeat(500) };
    const keys = Array.from({ length: MAX_NEWER_FIELDS + 3 }, (_, i) => `f${'abcdefghijk'[i]}`);
    for (const key of keys) source[key] = true;
    expect(Object.keys(newerFields(source, KNOWN))).toEqual(keys.slice(0, MAX_NEWER_FIELDS));
  });

  it('does not count known fields towards the cap', () => {
    const source: Record<string, unknown> = { id: 'x', seconds: 5 };
    const keys = Array.from({ length: MAX_NEWER_FIELDS }, (_, i) => `f${'abcdefgh'[i]}`);
    for (const key of keys) source[key] = 0;
    expect(Object.keys(newerFields(source, KNOWN))).toEqual(keys);
  });
});

describe('fieldsOf', () => {
  interface Example {
    id: string;
    seconds?: number;
  }

  it('lists the names of the fields it is given', () => {
    expect(fieldsOf<Example>({ id: true, seconds: true })).toEqual(['id', 'seconds']);
  });

  it('will not compile with a field left out, optional ones included, or one the type lacks', () => {
    // Checked by `npm run typecheck`: each line must be a type error.
    // @ts-expect-error -- `seconds` is left out
    expect(fieldsOf<Example>({ id: true })).toEqual(['id']);
    // @ts-expect-error -- `name` is not a field of Example
    expect(fieldsOf<Example>({ id: true, seconds: true, name: true })).toHaveLength(3);
  });
});
