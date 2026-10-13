/**
 * The version a page was built as, written into it: a `<meta>` in its head
 * that the build stamps (plugins/version.ts), and that a running page reads
 * back from the page deployed now to tell whether that is a newer one
 * (check.ts). Both sides use this module, so they cannot disagree about how
 * it is written.
 */

/** The name the version goes under. */
export const VERSION_META = 'version';

/** The tag a build adds to its page's head. */
export function versionTag(version: string): string {
  return `<meta name="${VERSION_META}" content="${version}">`;
}

const TAG = new RegExp(`<meta name="${VERSION_META}" content="([^"]*)">`);

/** The version a page's HTML was stamped with, or null if it has no stamp. */
export function versionIn(html: string): string | null {
  return TAG.exec(html)?.[1] ?? null;
}
