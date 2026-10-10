import { renderHook } from '@testing-library/react';
import type { ThemePreference } from '../storage/prefs';
import { THEME_COLOUR, applyTheme, resolveTheme, useTheme } from './theme';

/**
 * jsdom has no matchMedia at all; stand one in whose answers the test
 * controls — whether the system is dark, and whether it asks for more
 * contrast — and whose change listeners it can fire, as the system would on
 * switching.
 */
function stubMatchMedia(isDark: boolean, isMoreContrast = false) {
  const answers: Record<string, boolean> = {
    '(prefers-color-scheme: dark)': isDark,
    '(prefers-contrast: more)': isMoreContrast,
  };
  // Each query's listeners apart, so a test can see both are listened to.
  const listeners = new Map(Object.keys(answers).map((media) => [media, new Set<() => void>()]));
  const matchMedia = vi.fn((media: string) => {
    const own = listeners.get(media);
    if (own === undefined) throw new Error(`unexpected media query ${media}`);
    return {
      get matches() {
        return answers[media];
      },
      media,
      addEventListener: vi.fn((_type: string, listener: () => void) => own.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: () => void) => own.delete(listener)),
    };
  });
  vi.stubGlobal('matchMedia', matchMedia);
  const notify = () => listeners.forEach((own) => own.forEach((listener) => listener()));
  return {
    matchMedia,
    /** How many queries are being listened to. */
    listening: () => [...listeners.values()].filter((own) => own.size > 0).length,
    switchTo(dark: boolean) {
      answers['(prefers-color-scheme: dark)'] = dark;
      notify();
    },
    askForMoreContrast(more: boolean) {
      answers['(prefers-contrast: more)'] = more;
      notify();
    },
  };
}

const themeAttribute = () => document.documentElement.dataset.theme;
const themeColours = () =>
  [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
    (meta) => meta.content,
  );

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff" />';
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveTheme', () => {
  it('takes a forced palette at its word', () => {
    stubMatchMedia(true, true);
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    stubMatchMedia(false);
    expect(resolveTheme('contrast')).toBe('contrast');
  });

  it('follows the system for "system"', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('comes to High contrast for "system" when the system is dark and asks for more contrast', () => {
    stubMatchMedia(true, true);
    expect(resolveTheme('system')).toBe('contrast');
  });

  it('stays light for "system" when a light system asks for more contrast', () => {
    // Light is ink on paper already; the stylesheet keeps it too.
    stubMatchMedia(false, true);
    expect(resolveTheme('system')).toBe('light');
  });

  it('falls back to light where there is no matchMedia, as in jsdom', () => {
    expect(typeof window.matchMedia).toBe('undefined');
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('system', null)).toBe('light');
  });
});

describe('applyTheme', () => {
  it('forces dark with the attribute and darkens the browser chrome', () => {
    applyTheme('dark');
    expect(themeAttribute()).toBe('dark');
    expect(themeColours()).toEqual([THEME_COLOUR.dark]);
  });

  it('forces light the same way, even on a dark system', () => {
    stubMatchMedia(true);
    applyTheme('light');
    expect(themeAttribute()).toBe('light');
    expect(themeColours()).toEqual([THEME_COLOUR.light]);
  });

  it('clears the attribute for "system", leaving the stylesheet to decide', () => {
    stubMatchMedia(true);
    applyTheme('dark');
    applyTheme('system');
    expect(themeAttribute()).toBeUndefined();
    // The meta tag cannot read the stylesheet, so it is told what it says.
    expect(themeColours()).toEqual([THEME_COLOUR.dark]);
  });

  it('forces High contrast with the attribute and blackens the browser chrome', () => {
    stubMatchMedia(false);
    applyTheme('contrast');
    expect(themeAttribute()).toBe('contrast');
    expect(themeColours()).toEqual([THEME_COLOUR.contrast]);
  });

  it('clears the attribute for "system" on a dark system asking for more contrast', () => {
    stubMatchMedia(true, true);
    applyTheme('contrast');
    applyTheme('system');
    expect(themeAttribute()).toBeUndefined();
    expect(themeColours()).toEqual([THEME_COLOUR.contrast]);
  });

  it('uses the light chrome for "system" when the system cannot be asked', () => {
    applyTheme('system');
    expect(themeColours()).toEqual([THEME_COLOUR.light]);
  });

  it('updates every theme-colour tag', () => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#ffffff" /><meta name="theme-color" content="#ffffff" />';
    applyTheme('dark');
    expect(themeColours()).toEqual([THEME_COLOUR.dark, THEME_COLOUR.dark]);
  });

  it('adds a theme-colour tag when the document has none', () => {
    document.head.innerHTML = '';
    applyTheme('dark');
    expect(themeColours()).toEqual([THEME_COLOUR.dark]);
  });

  it('works on a document other than the global one', () => {
    // A detached document has no window, so "system" can only mean light.
    const doc = document.implementation.createHTMLDocument('other');
    applyTheme('system', doc);
    expect(doc.documentElement.dataset.theme).toBeUndefined();
    expect(doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      THEME_COLOUR.light,
    );
    applyTheme('dark', doc);
    expect(doc.documentElement.dataset.theme).toBe('dark');
    expect(themeAttribute()).toBeUndefined();
  });
});

describe('useTheme', () => {
  it('applies the preference and follows it as it changes', () => {
    const { rerender } = renderHook(({ preference }) => useTheme(preference), {
      initialProps: { preference: 'dark' as ThemePreference },
    });
    expect(themeAttribute()).toBe('dark');
    rerender({ preference: 'light' });
    expect(themeAttribute()).toBe('light');
    expect(themeColours()).toEqual([THEME_COLOUR.light]);
  });

  it('follows the system as it switches while set to "system"', () => {
    const system = stubMatchMedia(false);
    renderHook(() => useTheme('system'));
    expect(themeColours()).toEqual([THEME_COLOUR.light]);

    system.switchTo(true);
    expect(themeColours()).toEqual([THEME_COLOUR.dark]);
    expect(themeAttribute()).toBeUndefined();
  });

  it('follows the system into High contrast and out again while set to "system"', () => {
    const system = stubMatchMedia(true);
    renderHook(() => useTheme('system'));
    expect(themeColours()).toEqual([THEME_COLOUR.dark]);

    system.askForMoreContrast(true);
    expect(themeColours()).toEqual([THEME_COLOUR.contrast]);
    expect(themeAttribute()).toBeUndefined();

    system.switchTo(false);
    expect(themeColours()).toEqual([THEME_COLOUR.light]);
    system.switchTo(true);
    expect(themeColours()).toEqual([THEME_COLOUR.contrast]);
    system.askForMoreContrast(false);
    expect(themeColours()).toEqual([THEME_COLOUR.dark]);
  });

  it('stops listening once the preference is forced or the page is gone', () => {
    // A listener left behind would keep rewriting the chrome colour to the
    // system's after the player had forced a theme.
    const system = stubMatchMedia(false);
    const { rerender, unmount } = renderHook(({ preference }) => useTheme(preference), {
      initialProps: { preference: 'system' as ThemePreference },
    });
    expect(system.listening()).toBe(2);
    rerender({ preference: 'light' });
    expect(system.listening()).toBe(0);

    system.switchTo(true);
    expect(themeColours()).toEqual([THEME_COLOUR.light]);

    rerender({ preference: 'system' });
    expect(system.listening()).toBe(2);
    unmount();
    expect(system.listening()).toBe(0);
  });

  it('does not listen for a forced theme at all', () => {
    const system = stubMatchMedia(false);
    renderHook(() => useTheme('dark'));
    expect(system.matchMedia).not.toHaveBeenCalled();
    expect(system.listening()).toBe(0);
  });

  it('copes with "system" where there is no matchMedia', () => {
    expect(() => renderHook(() => useTheme('system'))).not.toThrow();
    expect(themeColours()).toEqual([THEME_COLOUR.light]);
  });
});
