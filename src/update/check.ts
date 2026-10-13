import { VERSION_META, versionIn } from './stamp';

/**
 * Finding out that a newer version of the game has been deployed, so the page
 * can offer it (UpdateToast). There is no service worker: a page keeps running
 * the code it loaded until it is reloaded, however many deploys go by (see
 * src/core/newerFields.ts).
 *
 * So it fetches its own page now and then and compares the version stamped in
 * it (plugins/version.ts) with its own. The page itself, rather than a file of
 * its own: the fetch revalidates the browser's copy of the page, and so
 * updates it. GitHub Pages lets that copy be kept for ten minutes, and the app
 * opened again within them — from a home screen, say — would otherwise be
 * handed the old page. (A reload asks the server for the page whatever the
 * cache holds, so Refresh gets the new one either way.)
 *
 * It looks as the page opens (it may have come out of that cache, from before
 * a deploy), as the page comes back into view, and every ten minutes or so
 * while it stays there — no more often than `CHECK_EVERY_MS` in all, and
 * never while hidden. Nothing goes with the request that a reload would not
 * send.
 */

/** The least time between two looks. */
export const CHECK_EVERY_MS = 10 * 60 * 1000;

/**
 * How often the timer asks for a look, which the gate then allows or not: on
 * the gate's own period, a tick would land as often a moment short of it as
 * past it, by the wall clock, and leave twenty minutes between looks.
 */
const ASK_EVERY_MS = 60 * 1000;

/** The version deployed now, when it is not this page's; null when it is, or not known. */
let newer: string | null = null;
const listeners = new Set<() => void>();
/** What the page is watching with, while it is (see `watchForUpdates`). */
let watching: UpdateCheckEnv | null = null;

function setNewer(next: string | null): void {
  if (next === newer) return;
  newer = next;
  for (const listener of listeners) listener();
}

/** The newer version deployed since this page loaded, if any, for useSyncExternalStore. */
export const getNewerVersion = (): string | null => newer;

export function subscribeNewerVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Load the version deployed now. The game is saved as the page goes (see useSudoku). */
export function reload(): void {
  watching?.reload();
}

export interface UpdateCheckEnv {
  /** The version this page was built as: its stamp, or null with none (the dev server, tests). */
  current: string | null;
  /** The app's own address: the page a reload gets. */
  url: string;
  fetch: typeof fetch;
  /** A seam for tests: jsdom's `location.reload` cannot be replaced. */
  reload: () => void;
}

function pageEnv(): UpdateCheckEnv {
  return {
    current:
      document.querySelector<HTMLMetaElement>(`meta[name="${VERSION_META}"]`)?.content ?? null,
    url: new URL(import.meta.env.BASE_URL, window.location.origin).href,
    fetch: (input, init) => window.fetch(input, init),
    reload: () => window.location.reload(),
  };
}

/**
 * Start looking for newer versions; a page with no stamp of its own has
 * nothing to compare, and never looks. Returns a function that stops, and
 * forgets what was found.
 */
export function watchForUpdates(env: UpdateCheckEnv = pageEnv()): () => void {
  const { current, url } = env;
  if (current === null) return () => {};
  watching = env;

  // By the wall clock, which runs on while a phone sleeps, unlike the page's
  // own: a page woken after an hour looks at once.
  let checkedAt = -Infinity;
  const check = (): void => {
    if (document.visibilityState !== 'visible' || Date.now() - checkedAt < CHECK_EVERY_MS) return;
    checkedAt = Date.now();
    env
      .fetch(url, { cache: 'no-cache' })
      .then((response) => (response.ok ? response.text() : null))
      .then((html) => {
        // A page with no stamp (an error page served as a success) says nothing.
        const deployed = html === null ? null : versionIn(html);
        if (deployed !== null) setNewer(deployed === current ? null : deployed);
      })
      // Offline, or the server down: nothing learnt, and the next look may do better.
      .catch(() => {});
  };

  check();
  document.addEventListener('visibilitychange', check);
  const timer = window.setInterval(check, ASK_EVERY_MS);
  return () => {
    document.removeEventListener('visibilitychange', check);
    window.clearInterval(timer);
    watching = null;
    setNewer(null);
  };
}
