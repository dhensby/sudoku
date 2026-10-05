import { render } from '@testing-library/react';
import * as icons from './icons';

// Every runtime export is an icon component (IconProps is a type, erased).
const ICONS = Object.entries(icons);

describe('icons', () => {
  it('exports every icon the UI asks for', () => {
    expect(ICONS.map(([name]) => name).sort()).toEqual(
      [
        'CheckIcon',
        'CloseIcon',
        'CopyIcon',
        'DownloadIcon',
        'EraseIcon',
        'HelpIcon',
        'HintIcon',
        'HistoryIcon',
        'MenuIcon',
        'MoreIcon',
        'NewGameIcon',
        'PauseIcon',
        'PlayIcon',
        'RedoIcon',
        'ResetIcon',
        'RevealIcon',
        'SettingsIcon',
        'ShareIcon',
        'UndoIcon',
        'UploadIcon',
      ].sort(),
    );
  });

  it.each(ICONS)('%s draws a decorative 24×24 outline in the text colour', (_, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveAttribute('stroke-linecap', 'round');
    expect(svg).toHaveAttribute('stroke-linejoin', 'round');
    // The button around it is what gets named; the drawing must stay out of
    // the accessibility tree and out of the tab order.
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveClass('icon');
    expect(svg.childElementCount).toBeGreaterThan(0);
  });

  it('draws each icon differently', () => {
    const drawings = ICONS.map(([, Icon]) => render(<Icon />).container.innerHTML);
    expect(new Set(drawings).size).toBe(ICONS.length);
  });

  it('adds a class alongside the base one', () => {
    const { container } = render(<icons.UndoIcon className="controls__icon" />);
    expect(container.querySelector('svg')).toHaveAttribute('class', 'icon controls__icon');
  });
});
