import { useEffect } from 'react';
import type { ThemePreference } from '../storage/prefs';

/*
 * Light, dark, High contrast, or whatever the system says. The colours
 * themselves are CSS custom properties (src/styles/index.css): a
 * `data-theme` attribute on the root element forces one palette, and
 * without it the stylesheet follows the system's media queries — dark for
 * `prefers-color-scheme: dark`, and High contrast when the system is dark
 * and asks for more contrast too. All that is left for script is to set or
 * clear the attribute, and to keep the browser chrome's theme colour in
 * step — a meta tag cannot read the stylesheet.
 */

/** A palette the page can show: what a preference comes to. */
export type Theme = Exclude<ThemePreference, 'system'>;

/**
 * The browser chrome's colour for each palette: the page background (--bg in
 * index.css), so the bar and page meet seamlessly. styles.test.ts holds
 * the two in step.
 */
export const THEME_COLOUR: Readonly<Record<Theme, string>> = {
  light: '#f4eee2',
  dark: '#1a1916',
  contrast: '#000000',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';
/**
 * Asked only when the system is dark. Light is ink on paper already, so a
 * light system asking for more contrast keeps the light palette, as the
 * stylesheet does.
 */
const MORE_CONTRAST_QUERY = '(prefers-contrast: more)';

/**
 * Whether the system's answer to a media query is yes. Guarded because
 * `matchMedia` is missing in jsdom and in some embedded webviews; no is the
 * safe default there, as light is the stylesheet's own.
 */
function systemMatches(view: Window | null, query: string): boolean {
  return typeof view?.matchMedia === 'function' && view.matchMedia(query).matches;
}

/** The palette a preference comes to right now. */
export function resolveTheme(preference: ThemePreference, view: Window | null = window): Theme {
  if (preference !== 'system') return preference;
  if (!systemMatches(view, DARK_QUERY)) return 'light';
  return systemMatches(view, MORE_CONTRAST_QUERY) ? 'contrast' : 'dark';
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
 * as it changes — a Mac switching to dark at sunset, or the player turning
 * on Increase contrast — since the stylesheet does so by itself but the
 * theme-colour meta tag cannot.
 */
export function useTheme(preference: ThemePreference): void {
  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return undefined;
    const queries = [DARK_QUERY, MORE_CONTRAST_QUERY].map((query) => window.matchMedia(query));
    const handleChange = (): void => applyTheme('system');
    queries.forEach((query) => query.addEventListener('change', handleChange));
    return () => queries.forEach((query) => query.removeEventListener('change', handleChange));
  }, [preference]);
}
