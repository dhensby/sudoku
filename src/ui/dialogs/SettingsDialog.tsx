import { useId } from 'react';
import type { Settings, ThemePreference } from '../../storage/prefs';
import { Dialog } from './Dialog';

export interface SettingsDialogProps {
  settings: Settings;
  /**
   * The stored theme is one a newer version of the game added. It is applied
   * as System, but no theme shows as chosen: an already-checked radio sends
   * no change when clicked, so showing System checked would leave the player
   * no way to pick it and replace the newer theme.
   */
  isThemeNewer?: boolean;
  /** Called on every change with just the field that changed; the parent saves and applies it. */
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

/** The on/off settings — every field of Settings that is a boolean. */
type SwitchKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/** What each switch says. A Record, so a new boolean in Settings will not compile until it has words here. */
const SWITCH_TEXT: Readonly<Record<SwitchKey, { label: string; description: string }>> = {
  showTimer: {
    label: 'Show timer',
    description: 'Hiding it only hides the digits: your time is still kept.',
  },
  highlightRowColumn: {
    label: 'Highlight row and column',
    description: "Tint the selected cell's row and column.",
  },
  highlightBox: {
    label: 'Highlight box',
    description: "Tint the selected cell's 3×3 box.",
  },
  highlightIdentical: {
    label: 'Highlight identical numbers',
    description: 'Tint every cell holding the selected number.',
  },
  highlightConflicts: {
    label: 'Highlight conflicts',
    description: 'Mark numbers that clash with another in their row, column or box.',
  },
  startInAutoCandidate: {
    label: 'Start new games in auto candidate mode',
    description: 'Every possible candidate is filled in from the start. Counts as an assist.',
  },
  clearPeerNotes: {
    label: 'Remove candidates from peers when placing a number',
    description: 'Placing a number clears it from the notes in its row, column and box.',
  },
};

/** The switches, grouped as a player looks for them (a test checks none is left out). */
const GROUPS: readonly { title: string; keys: readonly SwitchKey[] }[] = [
  { title: 'Timer', keys: ['showTimer'] },
  {
    title: 'Highlighting',
    keys: ['highlightRowColumn', 'highlightBox', 'highlightIdentical', 'highlightConflicts'],
  },
  { title: 'Candidates', keys: ['startInAutoCandidate', 'clearPeerNotes'] },
];

const THEMES: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The game's settings. Every control applies at once — there is no Save — so
 * each change goes straight up as a one-field patch. The switches are native
 * checkboxes underneath their styling, so they keep checkbox semantics and
 * keyboard behaviour (Space toggles) everywhere.
 */
export function SettingsDialog({
  settings,
  isThemeNewer = false,
  onChange,
  onClose,
}: SettingsDialogProps) {
  const ids = useId();

  return (
    <Dialog title="Settings" onClose={onClose} className="dialog--settings">
      <div className="settings">
        {GROUPS.map((group) => (
          <fieldset className="settings__group" key={group.title}>
            <legend className="settings__legend">{group.title}</legend>
            {group.keys.map((key) => {
              const { label, description } = SWITCH_TEXT[key];
              const inputId = `${ids}-${key}`;
              return (
                <div className="settings__row" key={key}>
                  <div className="settings__text">
                    <label className="settings__label" htmlFor={inputId}>
                      {label}
                    </label>
                    <p className="settings__description" id={`${inputId}-description`}>
                      {description}
                    </p>
                  </div>
                  <input
                    id={inputId}
                    className="settings__switch"
                    type="checkbox"
                    checked={settings[key]}
                    aria-describedby={`${inputId}-description`}
                    onChange={(event) => onChange({ [key]: event.target.checked })}
                  />
                </div>
              );
            })}
          </fieldset>
        ))}

        <fieldset className="settings__group">
          <legend className="settings__legend">Theme</legend>
          <div className="settings__theme">
            {THEMES.map(({ value, label }) => (
              <label className="settings__theme-option" key={value}>
                <input
                  type="radio"
                  name={`${ids}-theme`}
                  value={value}
                  checked={!isThemeNewer && settings.theme === value}
                  onChange={() => onChange({ theme: value })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
