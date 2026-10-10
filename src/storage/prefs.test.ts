import { describe, expect, it } from 'vitest';
import { formatGrid, parseGrid, type Difficulty } from '../core';
import { saveGameBlob } from './history';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_SETTINGS,
  hasNewerTheme,
  loadPreferences,
  setLastDifficulty,
  setPlayerName,
  updateSettings,
  type Settings,
} from './prefs';
import { memoryStorage } from './storage';
import { quotaStorage, throwingStorage } from '../test/misc-storage';
import { WIKIPEDIA_PUZZLE } from '../test/grids';

const KEY = 'sudoku.prefs';

function storageWith(value: unknown): ReturnType<typeof memoryStorage> {
  const storage = memoryStorage();
  storage.setItem(KEY, JSON.stringify(value));
  return storage;
}

describe('defaults', () => {
  it('match the spec: every aid on; auto candidates, peer-note clearing, Check guesses and the error counter off', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      showTimer: true,
      highlightRowColumn: true,
      highlightBox: true,
      highlightIdentical: true,
      highlightConflicts: true,
      startInAutoCandidate: false,
      clearPeerNotes: false,
      checkGuesses: false,
      showErrorCounter: false,
      theme: 'system',
    });
    expect(DEFAULT_PREFERENCES).toEqual({
      settings: DEFAULT_SETTINGS,
      playerName: '',
      lastDifficulty: 'easy',
    });
  });
});

describe('loadPreferences', () => {
  it('returns defaults for empty storage', () => {
    expect(loadPreferences(memoryStorage())).toEqual(DEFAULT_PREFERENCES);
  });

  it('does not return the shared default objects', () => {
    const loaded = loadPreferences(memoryStorage());
    expect(loaded).not.toBe(DEFAULT_PREFERENCES);
    expect(loaded.settings).not.toBe(DEFAULT_SETTINGS);
    loaded.settings.showTimer = false;
    loaded.playerName = 'Mallory';
    expect(DEFAULT_SETTINGS.showTimer).toBe(true);
    expect(DEFAULT_PREFERENCES.playerName).toBe('');
  });

  it('falls back to defaults on corrupt JSON', () => {
    const storage = memoryStorage();
    storage.setItem(KEY, '{not valid json');
    expect(loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
  });

  it('falls back to defaults when the storage refuses to be read', () => {
    expect(loadPreferences(throwingStorage({ get: true }))).toEqual(DEFAULT_PREFERENCES);
  });

  it.each([
    ['null', null],
    ['an array', [1, 2, 3]],
    ['a string', 'dark'],
    ['a number', 42],
  ])('falls back to defaults when the stored value is %s', (_label, value) => {
    expect(loadPreferences(storageWith(value))).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps every valid field it finds', () => {
    const stored = {
      settings: {
        showTimer: false,
        highlightRowColumn: false,
        highlightBox: false,
        highlightIdentical: false,
        highlightConflicts: false,
        startInAutoCandidate: true,
        clearPeerNotes: true,
        checkGuesses: true,
        showErrorCounter: true,
        theme: 'dark',
      },
      playerName: 'Dan',
      lastDifficulty: 'expert',
    };
    expect(loadPreferences(storageWith(stored))).toEqual(stored);
  });

  it('sanitises invalid stored values field by field', () => {
    const storage = storageWith({
      settings: {
        showTimer: 'no',
        highlightBox: false,
        clearPeerNotes: 1,
        checkGuesses: 'yes',
        showErrorCounter: null,
        theme: 'sepia',
        unknownSetting: true,
      },
      playerName: 42,
      lastDifficulty: 'impossible',
      somethingElse: 'from a newer build',
    });
    expect(loadPreferences(storage)).toEqual({
      settings: { ...DEFAULT_SETTINGS, highlightBox: false },
      playerName: '',
      lastDifficulty: 'easy',
    });
  });

  it.each([
    ['null', null],
    ['an array', [true, false]],
    ['a string', 'all on'],
  ])('uses default settings when settings is %s', (_label, settings) => {
    const prefs = loadPreferences(storageWith({ settings, playerName: 'Dan' }));
    expect(prefs.settings).toEqual(DEFAULT_SETTINGS);
    expect(prefs.playerName).toBe('Dan');
  });

  it('saves the two Mistakes settings like any other switch', () => {
    const storage = memoryStorage();
    updateSettings(storage, { checkGuesses: true });
    const prefs = updateSettings(storage, { showErrorCounter: true });
    expect(prefs.settings).toMatchObject({ checkGuesses: true, showErrorCounter: true });
    expect(loadPreferences(storage).settings).toMatchObject({
      checkGuesses: true,
      showErrorCounter: true,
    });
  });

  it.each(['system', 'light', 'dark', 'contrast'])('keeps the %s theme', (theme) => {
    expect(loadPreferences(storageWith({ settings: { theme } })).settings.theme).toBe(theme);
  });

  it.each([['Dark'], [''], [null], [1], ['constructor']])('discards a theme of %j', (theme) => {
    expect(loadPreferences(storageWith({ settings: { theme } })).settings.theme).toBe('system');
  });

  it('tidies a stored name that was hand-edited past the limit', () => {
    const prefs = loadPreferences(storageWith({ playerName: `  ${'x'.repeat(40)}  ` }));
    expect(prefs.playerName).toBe(`${'x'.repeat(23)}…`);
  });

  it.each([['easy'], ['medium'], ['hard'], ['expert']])('keeps %s as the last tier', (tier) => {
    expect(loadPreferences(storageWith({ lastDifficulty: tier })).lastDifficulty).toBe(tier);
  });
});

describe('updateSettings', () => {
  it('persists the change and survives a reload', () => {
    const storage = memoryStorage();
    updateSettings(storage, { theme: 'dark', clearPeerNotes: true });
    const prefs = loadPreferences(storage);
    expect(prefs.settings.theme).toBe('dark');
    expect(prefs.settings.clearPeerNotes).toBe(true);
    expect(prefs.settings.showTimer).toBe(true);
  });

  it('keeps settings the patch leaves out, and the rest of the preferences', () => {
    const storage = memoryStorage();
    setPlayerName(storage, 'Dan');
    setLastDifficulty(storage, 'hard');
    updateSettings(storage, { showTimer: false });
    const prefs = updateSettings(storage, { highlightBox: false });
    expect(prefs.settings).toEqual({ ...DEFAULT_SETTINGS, showTimer: false, highlightBox: false });
    expect(prefs.playerName).toBe('Dan');
    expect(prefs.lastDifficulty).toBe('hard');
  });

  it('treats an undefined field as unchanged rather than resetting it', () => {
    // Partial<Settings> allows `{ theme: undefined }`; a plain spread would
    // write it over the stored theme and the next load would reset it.
    const storage = memoryStorage();
    updateSettings(storage, { theme: 'light' });
    const prefs = updateSettings(storage, { theme: undefined, showTimer: false });
    expect(prefs.settings.theme).toBe('light');
    expect(loadPreferences(storage).settings.theme).toBe('light');
  });

  it('ignores values of the wrong type and keys it does not know', () => {
    const storage = memoryStorage();
    const patch = { showTimer: 'off', theme: 'neon', extra: true } as unknown as Partial<Settings>;
    const prefs = updateSettings(storage, patch);
    expect(prefs.settings).toEqual(DEFAULT_SETTINGS);
    expect(storage.getItem(KEY)).not.toContain('extra');
  });

  it('does not alias the caller’s patch into the preferences it returns', () => {
    // The returned prefs go straight into React state; if they shared an
    // object with the patch, the Settings dialog could mutate state behind
    // React's back. (A storage round-trip would not catch this: saving
    // serialises at once, which copies by itself.)
    const patch: Partial<Settings> = { theme: 'dark' };
    const prefs = updateSettings(memoryStorage(), patch);
    expect(prefs.settings).not.toBe(patch);
    patch.theme = 'light';
    expect(prefs.settings.theme).toBe('dark');
  });

  it('returns the new preferences even when the storage refuses the write', () => {
    // Persistence is best-effort: the setting still takes effect this session.
    const prefs = updateSettings(throwingStorage({ set: true }), { theme: 'dark' });
    expect(prefs.settings.theme).toBe('dark');
  });

  it('makes room in a full storage by shedding saved games', () => {
    // The storage is full of a finished game's saved state, which nothing
    // will reopen now that it is no longer on screen: the first thing to go.
    const storage = quotaStorage();
    storage.setItem(
      'sudoku.history',
      JSON.stringify([
        {
          id: 'old',
          givens: formatGrid(parseGrid(WIKIPEDIA_PUZZLE)),
          difficulty: 'easy',
          source: 'generated',
          createdAt: 1,
          updatedAt: 1,
          completedAt: 1,
          status: 'solved',
          elapsedMs: 1000,
          assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
          challenge: null,
        },
      ]),
    );
    saveGameBlob(storage, 'old', 'x'.repeat(500));
    storage.capacity = storage.used() + 50;
    const prefs = updateSettings(storage, { theme: 'dark' });
    expect(prefs.settings.theme).toBe('dark');
    expect(storage.getItem('sudoku.game.old')).toBeNull();
    expect(loadPreferences(storage).settings.theme).toBe('dark');
  });
});

describe('setPlayerName', () => {
  it('persists a tidied name', () => {
    const storage = memoryStorage();
    const prefs = setPlayerName(storage, '  Dan\n Hensby  ');
    expect(prefs.playerName).toBe('Dan Hensby');
    expect(loadPreferences(storage).playerName).toBe('Dan Hensby');
  });

  it('caps the name at 24 characters, the last an ellipsis to show it was cut', () => {
    expect(setPlayerName(memoryStorage(), 'x'.repeat(30)).playerName).toBe(`${'x'.repeat(23)}…`);
  });

  it('clears the name with an empty or blank string', () => {
    const storage = memoryStorage();
    setPlayerName(storage, 'Dan');
    expect(setPlayerName(storage, '   ').playerName).toBe('');
    expect(loadPreferences(storage).playerName).toBe('');
  });

  it('keeps the settings', () => {
    const storage = memoryStorage();
    updateSettings(storage, { theme: 'dark' });
    expect(setPlayerName(storage, 'Dan').settings.theme).toBe('dark');
  });
});

describe('setLastDifficulty', () => {
  it('persists the tier', () => {
    const storage = memoryStorage();
    expect(setLastDifficulty(storage, 'medium').lastDifficulty).toBe('medium');
    expect(loadPreferences(storage).lastDifficulty).toBe('medium');
  });

  it('keeps the previous tier when handed one the game does not know', () => {
    const storage = memoryStorage();
    setLastDifficulty(storage, 'hard');
    const prefs = setLastDifficulty(storage, 'extreme' as Difficulty);
    expect(prefs.lastDifficulty).toBe('hard');
    expect(loadPreferences(storage).lastDifficulty).toBe('hard');
  });
});

describe('what a newer version stored', () => {
  /*
   * A tab left open on this version after a deploy saves the preferences
   * whenever the player changes something. It must not wipe what the newer
   * version added to them.
   */
  const NEWER = {
    settings: {
      ...DEFAULT_SETTINGS,
      theme: 'sepia',
      soundOnSolve: true,
      compactPad: false,
    },
    playerName: 'Dan',
    lastDifficulty: 'hard',
    tourSeen: true,
  };

  const stored = (storage: ReturnType<typeof memoryStorage>): Record<string, unknown> =>
    JSON.parse(storage.getItem(KEY)!) as Record<string, unknown>;

  it('shows a theme it does not know as System', () => {
    const prefs = loadPreferences(storageWith(NEWER));
    expect(prefs.settings).toEqual(DEFAULT_SETTINGS);
    expect(prefs).toEqual({
      settings: DEFAULT_SETTINGS,
      playerName: 'Dan',
      lastDifficulty: 'hard',
    });
  });

  it.each<[string, (storage: ReturnType<typeof memoryStorage>) => unknown]>([
    ['a setting changes', (storage) => updateSettings(storage, { showTimer: false })],
    ['the name changes', (storage) => setPlayerName(storage, 'Sam')],
    ['the tier changes', (storage) => setLastDifficulty(storage, 'easy')],
  ])('keeps the new settings, the new fields and the new theme when %s', (_label, change) => {
    const storage = storageWith(NEWER);
    change(storage);
    expect(stored(storage)).toMatchObject({
      settings: { theme: 'sepia', soundOnSolve: true, compactPad: false },
      tourSeen: true,
    });
    // And again: what was kept is kept on the next save too.
    updateSettings(storage, { highlightBox: false });
    expect(stored(storage)).toMatchObject({
      settings: { theme: 'sepia', soundOnSolve: true, highlightBox: false },
      tourSeen: true,
    });
  });

  it.each(['light', 'dark', 'contrast', 'system'])(
    'replaces the new theme once the player picks %s',
    (theme) => {
      const storage = storageWith(NEWER);
      const prefs = updateSettings(storage, { theme: theme as Settings['theme'] });
      expect(prefs.settings.theme).toBe(theme);
      expect(stored(storage)).toMatchObject({ settings: { theme, soundOnSolve: true } });
    },
  );

  it('says the stored theme is a newer one until the player picks one here', () => {
    const storage = storageWith(NEWER);
    expect(hasNewerTheme(storage)).toBe(true);
    updateSettings(storage, { showTimer: false });
    expect(hasNewerTheme(storage)).toBe(true);
    updateSettings(storage, { theme: 'system' });
    expect(hasNewerTheme(storage)).toBe(false);
  });

  it.each<[string, unknown]>([
    ['nothing stored', undefined],
    ['one of its own themes', { settings: { theme: 'dark' } }],
    // An older version took High contrast for a newer theme; this one knows it.
    ['High contrast', { settings: { theme: 'contrast' } }],
    ['an odd theme', { settings: { theme: 'High-Contrast' } }],
    ['settings that are not an object', { settings: 'sepia' }],
    ['preferences that are not an object', 'sepia'],
  ])('does not say the stored theme is a newer one for %s', (_label, value) => {
    const storage = value === undefined ? memoryStorage() : storageWith(value);
    expect(hasNewerTheme(storage)).toBe(false);
  });

  it.each<[string, unknown]>([
    ['an odd theme', 'High-Contrast'],
    ['a theme that is not a string', 3],
  ])('does not keep %s', (_label, theme) => {
    const storage = storageWith({ settings: { theme } });
    updateSettings(storage, { showTimer: false });
    expect(stored(storage)).toMatchObject({ settings: { theme: 'system' } });
  });

  it('drops new fields too big or odd to keep', () => {
    const storage = storageWith({
      settings: { Junk: true, notes: 'x'.repeat(300) },
      'odd-field': 1,
      history: 'x'.repeat(300),
    });
    updateSettings(storage, { showTimer: false });
    expect(stored(storage)).toEqual({
      settings: { ...DEFAULT_SETTINGS, showTimer: false },
      playerName: '',
      lastDifficulty: 'easy',
    });
  });

  it('never lets a stored field override one it knows', () => {
    const storage = storageWith({ ...NEWER, settings: { ...NEWER.settings, showTimer: 'no' } });
    updateSettings(storage, { highlightBox: false });
    expect(stored(storage)).toMatchObject({ settings: { showTimer: true, highlightBox: false } });
  });

  it('saves as before over settings that are not an object', () => {
    const storage = storageWith({ settings: 'all on', tourSeen: true });
    updateSettings(storage, { showTimer: false });
    expect(stored(storage)).toEqual({
      settings: { ...DEFAULT_SETTINGS, showTimer: false },
      playerName: '',
      lastDifficulty: 'easy',
      tourSeen: true,
    });
  });
});
