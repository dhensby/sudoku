import type { Difficulty } from '../core';
import { freeSpace } from './history';
import {
  isDifficulty,
  isObject,
  normaliseName,
  readJson,
  writeItem,
  type StorageLike,
} from './storage';

/** The colour scheme: follow the system, or force one. */
export type ThemePreference = 'system' | 'light' | 'dark';

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
  /** Light or dark, or whatever the system says. */
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

const THEMES: readonly string[] = ['system', 'light', 'dark'];

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
 * Unknown keys are dropped, so they are never written back.
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

function savePreferences(storage: StorageLike, prefs: Preferences): void {
  writeItem(storage, STORAGE_KEY, JSON.stringify(prefs), freeSpace);
}

/** Change some settings, keeping the rest. Returns the preferences as saved. */
export function updateSettings(storage: StorageLike, patch: Partial<Settings>): Preferences {
  const prefs = loadPreferences(storage);
  prefs.settings = normaliseSettings(patch, prefs.settings);
  savePreferences(storage, prefs);
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
