import { useEffect } from 'react';
import type { ThemePreference } from '../storage/prefs';

/*
 * Light, dark, or whatever the system says. The colours themselves are CSS
 * custom properties (src/styles/index.css): a `data-theme` attribute on the
 * root element forces one palette, and without it the stylesheet follows
 * `prefers-color-scheme`. All that is left for script is to set or clear the
 * attribute, and to keep the browser chrome's theme colour in step — a meta
 * tag cannot read the stylesheet.
 */

/** The browser chrome's colour for each palette: the page background, so the bar and page meet seamlessly. */
export const THEME_COLOUR: Readonly<Record<'light' | 'dark', string>> = {
  light: '#ffffff',
  dark: '#121212',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Whether the system asks for dark. Guarded because `matchMedia` is missing
 * in jsdom and in some embedded webviews; light is the safe default there,
 * as it is the stylesheet's own.
 */
function systemPrefersDark(view: Window | null): boolean {
  return typeof view?.matchMedia === 'function' && view.matchMedia(DARK_QUERY).matches;
}

/** The palette a preference comes to right now. */
export function resolveTheme(
  preference: ThemePreference,
  view: Window | null = window,
): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  return systemPrefersDark(view) ? 'dark' : 'light';
}

/**
 * Put a theme preference into effect: force the palette with `data-theme`
 * (or clear it, for 'system', so the stylesheet's media query decides), and
 * point every `<meta name="theme-color">` at the palette now showing —
 * creating one if the document has none.
 */
export function applyTheme(preference: ThemePreference, doc: Document = document): void {
  const root = doc.documentElement;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;

  const colour = THEME_COLOUR[resolveTheme(preference, doc.defaultView)];
  const metas = doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) {
    const meta = doc.createElement('meta');
    meta.name = 'theme-color';
    meta.content = colour;
    doc.head.appendChild(meta);
    return;
  }
  metas.forEach((meta) => {
    meta.content = colour;
  });
}

/**
 * Keep the page in the chosen theme. For 'system' it also follows the system
 * as it changes — a Mac switching to dark at sunset — since the stylesheet
 * does so by itself but the theme-colour meta tag cannot.
 */
export function useTheme(preference: ThemePreference): void {
  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const handleChange = (): void => applyTheme('system');
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [preference]);
}
