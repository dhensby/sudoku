import { fieldsOf, newerFields, type Difficulty } from '../core';
import { freeSpace } from './history';
import {
  isDifficulty,
  isObject,
  normaliseName,
  readJson,
  writeItem,
  type StorageLike,
} from './storage';

/*
 * The player's preferences, under one key:
 *
 *   sudoku.prefs   { "settings": { … }, "playerName": "…", "lastDifficulty": "…" }
 *
 * A newer version may add to it — a setting, a theme — and a tab left open on
 * this version after a deploy still saves it whenever the player changes
 * something. So a save carries over what this version does not know: small
 * unknown fields of the preferences and of the settings (see `newerFields`),
 * and a theme it has never heard of, which it shows as System but keeps in
 * storage until the player picks a theme here.
 */

/**
 * The colour scheme: follow the system, or force one. 'contrast' is High
 * contrast, a dark palette of white and yellow on black, which System also
 * comes to when the device is dark and asks for more contrast (theme.ts).
 */
export type ThemePreference = 'system' | 'light' | 'dark' | 'contrast';

/** Everything on the Settings dialog. */
export interface Settings {
  /** Show the running time. Timing carries on regardless. */
  showTimer: boolean;
  /** Tint the selected cell's row and column. */
  highlightRowColumn: boolean;
  /** Tint the selected cell's box. */
  highlightBox: boolean;
  /** Tint every cell holding the selected cell's digit. */
  highlightIdentical: boolean;
  /** Dot every digit that clashes with a peer. */
  highlightConflicts: boolean;
  /** Start new games with auto candidates on. */
  startInAutoCandidate: boolean;
  /**
   * Placing a digit removes it from the manual notes of every peer. NYT
   * doesn't; many other apps do, and players who grew up on them expect it.
   */
  clearPeerNotes: boolean;
  /** Light, dark or High contrast, or whatever the system says. */
  theme: ThemePreference;
}

/** Everything stored under `sudoku.prefs`: the settings plus what the game remembers between visits. */
export interface Preferences {
  settings: Settings;
  /** The name put on shared results; '' until the player gives one. */
  playerName: string;
  /** The tier last chosen, which a first-visit or fallback puzzle is generated at. */
  lastDifficulty: Difficulty;
}

const STORAGE_KEY = 'sudoku.prefs';

/**
 * Every theme this version knows. A Record, so a theme added to
 * ThemePreference will not compile until it is listed here too — left out,
 * it would be taken for a newer version's and shown as System.
 */
const THEMES: readonly string[] = Object.keys({
  system: true,
  light: true,
  dark: true,
  contrast: true,
} satisfies Record<ThemePreference, true>);

/**
 * What a theme a newer version added could be called: a short camelCase word,
 * like every theme here. Anything else stored as a theme is junk, not worth
 * keeping.
 */
const NEWER_THEME = /^[a-z][A-Za-z]{0,23}$/;

/** The top-level fields of the preferences this version knows. */
const PREFERENCE_FIELDS = fieldsOf<Preferences>({
  settings: true,
  playerName: true,
  lastDifficulty: true,
});

/** The on/off settings, which all normalise the same way. */
const SWITCHES = [
  'showTimer',
  'highlightRowColumn',
  'highlightBox',
  'highlightIdentical',
  'highlightConflicts',
  'startInAutoCandidate',
  'clearPeerNotes',
] as const satisfies readonly (keyof Settings)[];

/** Every field of the settings this version knows. */
const SETTING_FIELDS = fieldsOf<Settings>({
  showTimer: true,
  highlightRowColumn: true,
  highlightBox: true,
  highlightIdentical: true,
  highlightConflicts: true,
  startInAutoCandidate: true,
  clearPeerNotes: true,
  theme: true,
});

/** The settings a first visit starts with. */
export const DEFAULT_SETTINGS: Settings = {
  showTimer: true,
  highlightRowColumn: true,
  highlightBox: true,
  highlightIdentical: true,
  highlightConflicts: true,
  startInAutoCandidate: false,
  clearPeerNotes: false,
  theme: 'system',
};

/** The preferences before the player has chosen anything. */
export const DEFAULT_PREFERENCES: Preferences = {
  settings: DEFAULT_SETTINGS,
  playerName: '',
  lastDifficulty: 'easy',
};

/**
 * Settings from untrusted input, each field taken from `source` if it is the
 * right type and from `fallback` otherwise. Loading uses the defaults as the
 * fallback; an update uses the current settings, so a patch that leaves a
 * field out — or sets it to undefined, or to nonsense — changes nothing.
 * Unknown keys are left out, and a theme this version does not know reads as
 * the fallback ('system' on load); what a newer version stored is carried
 * over by the save instead (see `savePreferences`).
 */
function normaliseSettings(source: unknown, fallback: Settings): Settings {
  const fields = isObject(source) ? source : {};
  const settings: Settings = { ...fallback };
  for (const key of SWITCHES) {
    const value = fields[key];
    if (typeof value === 'boolean') settings[key] = value;
  }
  if (THEMES.includes(fields.theme as string)) settings.theme = fields.theme as ThemePreference;
  return settings;
}

/**
 * Coerce whatever was in storage into well-formed Preferences, field by field.
 * There is no version number: a field that is missing or the wrong type falls
 * back to its default and the rest survive, which copes with older and newer
 * builds alike.
 */
function normalise(parsed: unknown): Preferences {
  const fields = isObject(parsed) ? parsed : {};
  return {
    settings: normaliseSettings(fields.settings, DEFAULT_SETTINGS),
    playerName: normaliseName(fields.playerName),
    lastDifficulty: isDifficulty(fields.lastDifficulty)
      ? fields.lastDifficulty
      : DEFAULT_PREFERENCES.lastDifficulty,
  };
}

/**
 * The stored preferences, or the defaults. Always a fresh object, never the
 * shared defaults, so the caller may keep it in state and mutate it freely.
 */
export function loadPreferences(storage: StorageLike): Preferences {
  return normalise(readJson(storage, STORAGE_KEY));
}

/** Whether a stored theme is one a newer version added: not one of ours, but shaped like one. */
function isNewerTheme(value: unknown): value is string {
  return typeof value === 'string' && !THEMES.includes(value) && NEWER_THEME.test(value);
}

/**
 * Whether the stored theme is one a newer version added, which this version
 * applies as System but keeps (see the module comment). Settings then shows
 * no theme as chosen, so that picking any of them — System included — is a
 * change, and replaces it.
 */
export function hasNewerTheme(storage: StorageLike): boolean {
  const stored = readJson(storage, STORAGE_KEY);
  const settings = isObject(stored) ? stored.settings : undefined;
  return isNewerTheme(isObject(settings) ? settings.theme : undefined);
}

/**
 * Write the preferences, carrying over what a newer version stored that this
 * one does not know (see the module comment). Every caller has just loaded
 * them, so what is in storage is what they were built from. A newer theme is
 * kept unless `isThemePicked`: the player chose a theme in this version, which
 * replaces it — even System, the one it was showing as.
 */
function savePreferences(storage: StorageLike, prefs: Preferences, isThemePicked = false): void {
  const stored = readJson(storage, STORAGE_KEY);
  const storedSettings = isObject(stored) ? stored.settings : undefined;
  const storedTheme = isObject(storedSettings) ? storedSettings.theme : undefined;
  const saved = {
    ...newerFields(stored, PREFERENCE_FIELDS),
    ...prefs,
    settings: {
      ...newerFields(storedSettings, SETTING_FIELDS),
      ...prefs.settings,
      ...(!isThemePicked && isNewerTheme(storedTheme) ? { theme: storedTheme } : {}),
    },
  };
  writeItem(storage, STORAGE_KEY, JSON.stringify(saved), freeSpace);
}

/**
 * Change some settings, keeping the rest. Returns the preferences as this
 * version reads them back (a newer theme kept in storage reads as System).
 */
export function updateSettings(storage: StorageLike, patch: Partial<Settings>): Preferences {
  const prefs = loadPreferences(storage);
  prefs.settings = normaliseSettings(patch, prefs.settings);
  savePreferences(storage, prefs, THEMES.includes(patch.theme as string));
  return prefs;
}

/**
 * Remember the name to put on shared results: tidied (see `normaliseName`),
 * and at most 24 characters. The name comes back trimmed, so an input should
 * not echo it straight back while the player is typing — a space typed
 * between two names would vanish before the second could follow it.
 */
export function setPlayerName(storage: StorageLike, name: string): Preferences {
  const prefs = loadPreferences(storage);
  prefs.playerName = normaliseName(name);
  savePreferences(storage, prefs);
  return prefs;
}

/** Remember the tier just chosen, so the next visit starts on it. */
export function setLastDifficulty(storage: StorageLike, difficulty: Difficulty): Preferences {
  const prefs = loadPreferences(storage);
  if (isDifficulty(difficulty)) prefs.lastDifficulty = difficulty;
  savePreferences(storage, prefs);
  return prefs;
}
