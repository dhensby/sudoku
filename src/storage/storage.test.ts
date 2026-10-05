import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIFFICULTIES,
  MAX_NAME_LENGTH,
  browserStorage,
  deleteItem,
  isDifficulty,
  isObject,
  memoryStorage,
  normaliseName,
  readItem,
  readJson,
  writeItem,
  type StorageLike,
} from './storage';
import { quotaStorage, throwingStorage } from '../test/misc-storage';

describe('memoryStorage', () => {
  it('supports get, set and remove', () => {
    const storage = memoryStorage();
    expect(storage.getItem('missing')).toBeNull();
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
    storage.removeItem('k');
    expect(storage.getItem('k')).toBeNull();
  });

  it('keeps separate instances apart', () => {
    const a = memoryStorage();
    const b = memoryStorage();
    a.setItem('k', 'v');
    expect(b.getItem('k')).toBeNull();
  });
});

describe('browserStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses a working localStorage', () => {
    const storage = browserStorage();
    expect(storage).toBe(globalThis.localStorage);
    storage.setItem('x', '1');
    expect(storage.getItem('x')).toBe('1');
    storage.removeItem('x');
  });

  it('probes with a namespaced key and cleans up after itself', () => {
    const calls: string[] = [];
    const fake: StorageLike = {
      getItem: () => null,
      setItem: (key) => {
        calls.push(`set ${key}`);
      },
      removeItem: (key) => {
        calls.push(`remove ${key}`);
      },
    };
    vi.stubGlobal('localStorage', fake);
    expect(browserStorage()).toBe(fake);
    expect(calls).toEqual(['set __sudoku_probe__', 'remove __sudoku_probe__']);
  });

  it('falls back to memory storage when localStorage throws on write', () => {
    vi.stubGlobal('localStorage', throwingStorage({ set: true }));
    const storage = browserStorage();
    storage.setItem('a', 'b');
    expect(storage.getItem('a')).toBe('b'); // memory fallback worked
  });

  it('falls back to memory storage when there is no localStorage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    const storage = browserStorage();
    storage.setItem('a', 'b');
    expect(storage.getItem('a')).toBe('b');
  });

  it('keeps a localStorage that is merely full, so what is saved there stays in reach', () => {
    // The origin is shared: other projects can fill it while our history sits
    // in it. A memory fallback would hide that history and leave no way to
    // prune it to make room.
    const full = quotaStorage();
    full.setItem('sudoku.current', 'abc-1234');
    full.capacity = full.used();
    vi.stubGlobal('localStorage', full);
    const storage = browserStorage();
    expect(storage).toBe(full);
    expect(storage.getItem('sudoku.current')).toBe('abc-1234');
    expect(storage.getItem('__sudoku_probe__')).toBeNull();
  });

  it.each<[string, unknown, 'real' | 'memory']>([
    ['QuotaExceededError', new DOMException('Full', 'QuotaExceededError'), 'real'],
    ['old Firefox’s quota error', { name: 'NS_ERROR_DOM_QUOTA_REACHED' }, 'real'],
    ['the legacy quota code', { code: 22 }, 'real'],
    ['old Firefox’s quota code', { code: 1014 }, 'real'],
    ['a SecurityError', new DOMException('No', 'SecurityError'), 'memory'],
    ['a plain Error', new Error('boom'), 'memory'],
    ['a thrown string', 'quota', 'memory'],
    ['a thrown null', null, 'memory'],
  ])('on a probe that throws %s, uses %s storage', (_label, thrown, expected) => {
    const fake: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw thrown;
      },
      removeItem: () => {},
    };
    vi.stubGlobal('localStorage', fake);
    expect(browserStorage() === fake ? 'real' : 'memory').toBe(expected);
  });

  it('falls back to memory storage when merely touching localStorage throws', () => {
    // Safari with "Block all cookies" throws a SecurityError on access.
    vi.stubGlobal('localStorage', null);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    const storage = browserStorage();
    storage.setItem('a', 'b');
    expect(storage.getItem('a')).toBe('b');
  });
});

describe('readItem', () => {
  it('reads a stored value, or null when missing', () => {
    const storage = memoryStorage();
    storage.setItem('k', 'v');
    expect(readItem(storage, 'k')).toBe('v');
    expect(readItem(storage, 'missing')).toBeNull();
  });

  it('reads null rather than throwing when the storage refuses access', () => {
    expect(readItem(throwingStorage({ get: true }), 'k')).toBeNull();
  });
});

describe('readJson', () => {
  it('parses a stored value', () => {
    const storage = memoryStorage();
    storage.setItem('k', '{"a":[1,2]}');
    expect(readJson(storage, 'k')).toEqual({ a: [1, 2] });
  });

  it.each([
    ['missing', null],
    ['corrupt', '{not json'],
    ['truncated', '{"a":[1,'],
  ])('reads null for a %s value', (_label, raw) => {
    const storage = memoryStorage();
    if (raw !== null) storage.setItem('k', raw);
    expect(readJson(storage, 'k')).toBeNull();
  });

  it('reads null when the storage refuses access', () => {
    expect(readJson(throwingStorage({ get: true }), 'k')).toBeNull();
  });
});

describe('deleteItem', () => {
  it('removes a key', () => {
    const storage = memoryStorage();
    storage.setItem('k', 'v');
    deleteItem(storage, 'k');
    expect(storage.getItem('k')).toBeNull();
  });

  it('swallows a storage that throws', () => {
    expect(() => deleteItem(throwingStorage({ remove: true }), 'k')).not.toThrow();
  });
});

describe('writeItem', () => {
  it('writes and reports success without making room', () => {
    const storage = memoryStorage();
    const makeRoom = vi.fn();
    expect(writeItem(storage, 'k', 'v', makeRoom)).toBe(true);
    expect(storage.getItem('k')).toBe('v');
    expect(makeRoom).not.toHaveBeenCalled();
  });

  it('makes room and retries once after a QuotaExceededError', () => {
    const storage = quotaStorage(20);
    storage.setItem('junk', '0123456789'); // 14 of 20 used
    const makeRoom = vi.fn((s: StorageLike) => s.removeItem('junk'));
    expect(writeItem(storage, 'k', '0123456789', makeRoom)).toBe(true);
    expect(makeRoom).toHaveBeenCalledTimes(1);
    expect(makeRoom).toHaveBeenCalledWith(storage);
    expect(storage.getItem('k')).toBe('0123456789');
    expect(storage.keys()).toEqual(['k']);
  });

  it('gives up quietly when the retry fails too', () => {
    const storage = quotaStorage(5);
    const makeRoom = vi.fn();
    expect(writeItem(storage, 'k', 'far too long a value', makeRoom)).toBe(false);
    expect(makeRoom).toHaveBeenCalledTimes(1);
    // One try, one retry — never a loop.
    expect(storage.writes()).toBe(2);
    expect(storage.getItem('k')).toBeNull();
  });

  it('treats any throw like a full quota', () => {
    const makeRoom = vi.fn();
    expect(writeItem(throwingStorage({ set: true }), 'k', 'v', makeRoom)).toBe(false);
    expect(makeRoom).toHaveBeenCalledTimes(1);
  });

  it('still retries when making room throws partway', () => {
    const storage = quotaStorage(20);
    storage.setItem('junk', '0123456789');
    const makeRoom = (s: StorageLike): void => {
      s.removeItem('junk');
      throw new Error('pruning tripped over something');
    };
    expect(writeItem(storage, 'k', '0123456789', makeRoom)).toBe(true);
  });

  it('tries just once when there is no way to make room', () => {
    const storage = quotaStorage(5);
    expect(writeItem(storage, 'k', 'far too long a value')).toBe(false);
    expect(storage.writes()).toBe(1);
  });
});

describe('isObject', () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    ['{}', false],
    [42, false],
    [undefined, false],
  ])('%j → %s', (value, expected) => {
    expect(isObject(value)).toBe(expected);
  });
});

describe('isDifficulty', () => {
  it('lists the tiers easiest first', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'medium', 'hard', 'expert']);
  });

  it.each(['easy', 'medium', 'hard', 'expert'])('accepts %s', (value) => {
    expect(isDifficulty(value)).toBe(true);
  });

  it.each([['Easy'], ['extreme'], [''], ['constructor'], ['__proto__'], [1], [null], [undefined]])(
    'rejects %j',
    (value) => {
      expect(isDifficulty(value)).toBe(false);
    },
  );
});

describe('normaliseName', () => {
  it.each([
    ['Dan', 'Dan'],
    ['  Dan  ', 'Dan'],
    ['Dan\nHensby', 'Dan Hensby'],
    ['Dan \t  Hensby', 'Dan Hensby'],
    ['Dan\u0000Hensby', 'Dan Hensby'],
    ['   ', ''],
    ['', ''],
    ['abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvw…'],
    // A C1 control (next line) is a control character too.
    ['Dan\u0085Hensby', 'Dan Hensby'],
    // Invisible characters go without leaving a space.
    ['Dan​Hensby­', 'DanHensby'],
    // A right-to-left override would turn "vs Dan 5:23" into "vs Dan 32:5".
    ['Dan‮', 'Dan'],
    ['⁦Dan⁩‏', 'Dan'],
    // Half a surrogate pair renders as �.
    ['Dan\ud83d', 'Dan'],
    // The cut lands just after a space: no space is left before the ellipsis.
    [`${'a'.repeat(22)} bc`, `${'a'.repeat(22)}…`],
  ])('tidies %j to %j', (input, expected) => {
    expect(normaliseName(input)).toBe(expected);
  });

  it('shows a cut name as cut, ending it in an ellipsis rather than mid-word', () => {
    expect(normaliseName('Alexandra the Great of Macedon')).toBe('Alexandra the Great of…');
  });

  it('leaves a name of exactly the longest length whole, with no ellipsis', () => {
    const name = 'x'.repeat(MAX_NAME_LENGTH);
    expect(normaliseName(name)).toBe(name);
    expect(normaliseName('😀'.repeat(MAX_NAME_LENGTH))).toBe('😀'.repeat(MAX_NAME_LENGTH));
  });

  it.each([
    ['a long name', 'Alexandra the Great of Macedon'],
    ['a long name of emoji', '😀'.repeat(30)],
    ['a name stacked with marks', `Dan e${'́'.repeat(100)}`],
    ['a short name', 'Dan'],
  ])('gives back %s unchanged when tidied a second time', (_label, input) => {
    // A name the game accepted must survive a share link, which tidies it again.
    const once = normaliseName(input);
    expect(normaliseName(once)).toBe(once);
  });

  it('cuts by character, never splitting an emoji in half', () => {
    // 😀 is two UTF-16 units; a naive slice would keep only the first.
    const name = normaliseName(`${'a'.repeat(22)}😀bc`);
    expect(name).toBe(`${'a'.repeat(22)}😀…`);
    expect(Array.from(name)).toHaveLength(MAX_NAME_LENGTH);
  });

  it.each([
    ['a flag', '🇬🇧'],
    ['a family (a ZWJ sequence)', '👨‍👩‍👧'],
    ['an accented letter built from two code points', 'é'],
  ])('cuts whole characters, never splitting %s', (_label, last) => {
    const name = normaliseName(`${'a'.repeat(MAX_NAME_LENGTH - 2)}${last}${last}${last}`);
    expect(name).toBe(`${'a'.repeat(MAX_NAME_LENGTH - 2)}${last}…`);
  });

  it('keeps the joiners and tags that emoji are built from', () => {
    // The flag of Scotland is a black flag followed by tag characters.
    const scotland = '🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}';
    expect(normaliseName(`Dan ${scotland}`)).toBe(`Dan ${scotland}`);
    expect(normaliseName('👨‍👩‍👧')).toBe('👨‍👩‍👧');
  });

  it('cuts a name of 30 emoji to 23 and an ellipsis', () => {
    expect(normaliseName('😀'.repeat(30))).toBe(`${'😀'.repeat(MAX_NAME_LENGTH - 1)}…`);
  });

  it('stops before a character stacked with so many marks it would smear across the screen', () => {
    expect(normaliseName(`Dan e${'́'.repeat(100)}`)).toBe('Dan…');
    // With nothing before it, nothing is left: no name, rather than a bare ellipsis.
    expect(normaliseName(`e${'́'.repeat(100)}`)).toBe('');
  });

  it('still never splits a surrogate pair where the platform cannot find characters', () => {
    // Firefox before 125 has no Intl.Segmenter.
    const intl = Intl as unknown as { Segmenter: unknown };
    const segmenter = intl.Segmenter;
    intl.Segmenter = undefined;
    try {
      expect(normaliseName(`${'a'.repeat(22)}😀bc`)).toBe(`${'a'.repeat(22)}😀…`);
    } finally {
      intl.Segmenter = segmenter;
    }
  });

  it.each([[42], [null], [undefined], [{ name: 'Dan' }], [['Dan']]])(
    'reads %j as no name',
    (value) => {
      expect(normaliseName(value)).toBe('');
    },
  );
});
