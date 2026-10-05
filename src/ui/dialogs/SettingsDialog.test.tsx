import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, type Settings } from '../../storage/prefs';
import { SettingsDialog } from './SettingsDialog';

function renderSettings(settings: Settings = DEFAULT_SETTINGS) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const view = render(<SettingsDialog settings={settings} onChange={onChange} onClose={onClose} />);
  return { ...view, onChange, onClose };
}

const SWITCHES: [keyof Settings, string][] = [
  ['showTimer', 'Show timer'],
  ['highlightRowColumn', 'Highlight row and column'],
  ['highlightBox', 'Highlight box'],
  ['highlightIdentical', 'Highlight identical numbers'],
  ['highlightConflicts', 'Highlight conflicts'],
  ['startInAutoCandidate', 'Start new games in auto candidate mode'],
  ['clearPeerNotes', 'Remove candidates from peers when placing a number'],
];

describe('SettingsDialog', () => {
  it('has a checkbox for every on/off setting, none left out', () => {
    renderSettings();
    const booleans = Object.keys(DEFAULT_SETTINGS).filter(
      (key) => typeof DEFAULT_SETTINGS[key as keyof Settings] === 'boolean',
    );
    // Real checkboxes, whatever they look like: announced and toggled as such.
    expect(screen.getAllByRole('checkbox')).toHaveLength(booleans.length);
    expect(SWITCHES.map(([key]) => key).sort()).toEqual(booleans.sort());
  });

  it.each(SWITCHES)('shows %s as it stands, with a description', (key, label) => {
    renderSettings({ ...DEFAULT_SETTINGS, [key]: true });
    const box = screen.getByRole('checkbox', { name: label });
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription(/\S/);
  });

  it.each(SWITCHES)('sends just %s when it is switched', (key, label) => {
    const settings = { ...DEFAULT_SETTINGS, [key]: false };
    const { onChange } = renderSettings(settings);
    const box = screen.getByRole('checkbox', { name: label });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ [key]: true });
  });

  it('switches off as well as on', () => {
    const { onChange } = renderSettings({ ...DEFAULT_SETTINGS, showTimer: true });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show timer' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ showTimer: false });
  });

  it('groups the switches under named headings', () => {
    renderSettings();
    for (const name of ['Timer', 'Highlighting', 'Candidates', 'Theme']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument();
    }
  });

  it('offers the theme as one choice of three, and sends the one picked', () => {
    const { onChange } = renderSettings({ ...DEFAULT_SETTINGS, theme: 'light' });
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'System' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ theme: 'dark' });
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(onChange).toHaveBeenLastCalledWith({ theme: 'system' });
  });

  it('closes from its close button', () => {
    const { onClose } = renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
