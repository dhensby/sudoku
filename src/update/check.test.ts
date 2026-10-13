import {
  CHECK_EVERY_MS,
  getNewerVersion,
  reload,
  subscribeNewerVersion,
  watchForUpdates,
  type UpdateCheckEnv,
} from './check';
import { versionTag } from './stamp';

const URL_ = 'https://dhensby.github.io/sudoku/';

/** The deployed page, stamped with `version` (or with none). */
const page = (version: string | null) =>
  `<html><head><title>Sudoku</title>${version === null ? '' : versionTag(version)}</head></html>`;

/** A server that answers with whatever `deployed` is set to. */
function server(deployed: string) {
  const state = { deployed: deployed as string | Error, status: 200 };
  const fetch = vi.fn(async () => {
    if (state.deployed instanceof Error) throw state.deployed;
    return new Response(state.deployed, { status: state.status });
  });
  return { state, fetch };
}

let stop: () => void = () => {};

/** Start looking from a page of version "old", with `deployed` on the server. */
function watch(env: Partial<UpdateCheckEnv> = {}, deployed = page('old')) {
  const { state, fetch } = server(deployed);
  const reloadPage = vi.fn();
  stop = watchForUpdates({
    current: 'old',
    url: URL_,
    fetch: fetch as unknown as typeof globalThis.fetch,
    reload: reloadPage,
    ...env,
  });
  return { state, fetch, reloadPage };
}

/** Let a look's fetch, and what follows it, finish. */
const settle = () => vi.advanceTimersByTimeAsync(0);

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-13T12:00:00Z') });
});

afterEach(() => {
  stop();
  stop = () => {};
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.useRealTimers();
});

describe('looking for a newer version', () => {
  it('never looks from a page with no stamp of its own', async () => {
    const { fetch } = watch({ current: null });
    await vi.advanceTimersByTimeAsync(3 * CHECK_EVERY_MS);
    setVisibility('hidden');
    setVisibility('visible');
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('looks at the page a reload would get as it opens, past the HTTP cache', async () => {
    const { fetch } = watch();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(URL_, { cache: 'no-cache' });
    await settle();
    // Its own version: nothing newer.
    expect(getNewerVersion()).toBeNull();
  });

  it('finds the version deployed now, when it is another', async () => {
    const { state } = watch();
    const changed = vi.fn();
    const leave = subscribeNewerVersion(changed);
    state.deployed = page('new');
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(getNewerVersion()).toBe('new');
    expect(changed).toHaveBeenCalledOnce();
    leave();
  });

  it('finds a page that opened from the cache after a deploy out at once', async () => {
    watch({}, page('new'));
    await settle();
    expect(getNewerVersion()).toBe('new');
  });

  it('looks again every ten minutes while the page is on show', async () => {
    const { fetch } = watch();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 1);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('never looks while hidden, and looks as the page comes back after a while', async () => {
    const { state, fetch } = watch();
    setVisibility('hidden');
    state.deployed = page('new');
    await vi.advanceTimersByTimeAsync(3 * CHECK_EVERY_MS);
    expect(fetch).toHaveBeenCalledOnce();

    setVisibility('visible');
    expect(fetch).toHaveBeenCalledTimes(2);
    await settle();
    expect(getNewerVersion()).toBe('new');
  });

  it('does not look again as the page comes back within ten minutes of the last look', async () => {
    const { fetch } = watch();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 1);
    setVisibility('hidden');
    setVisibility('visible');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('counts the ten minutes from the last look, however it came', async () => {
    const { fetch } = watch();
    await vi.advanceTimersByTimeAsync(60_000);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    // Back at twelve minutes: a look, and the next is ten minutes on from it.
    setVisibility('visible');
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps time by the wall clock, which runs on while a phone sleeps', async () => {
    const { fetch } = watch();
    setVisibility('hidden');
    // Asleep: the wall clock moves on, and no timer runs.
    vi.setSystemTime(Date.now() + CHECK_EVERY_MS);
    setVisibility('visible');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('learns nothing from a page it could not have', async () => {
    const { state } = watch();
    state.deployed = page('new');
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(getNewerVersion()).toBe('new');

    // A missing page, a server error, a page without a stamp, no network:
    // what was found stands.
    state.deployed = page('newer');
    state.status = 404;
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    state.status = 503;
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    state.status = 200;
    state.deployed = page(null);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    state.deployed = new TypeError('Failed to fetch');
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(getNewerVersion()).toBe('new');
  });

  it('follows a deploy taken back: its own version again is nothing newer', async () => {
    const { state } = watch();
    state.deployed = page('new');
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(getNewerVersion()).toBe('new');
    state.deployed = page('old');
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(getNewerVersion()).toBeNull();
  });

  it('tells its subscribers only of a change, until they leave', async () => {
    const { state } = watch();
    const changed = vi.fn();
    const leave = subscribeNewerVersion(changed);
    state.deployed = page('new');
    await vi.advanceTimersByTimeAsync(2 * CHECK_EVERY_MS);
    expect(changed).toHaveBeenCalledOnce();
    leave();
    state.deployed = page('newer');
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(getNewerVersion()).toBe('newer');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('reloads the way it was given', () => {
    const { reloadPage } = watch();
    reload();
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  describe('on a real page', () => {
    afterEach(() => {
      document.querySelector('meta[name="version"]')?.remove();
      vi.unstubAllGlobals();
    });

    it('reads its version from its own stamp, and looks at the app’s own address', async () => {
      const fetch = vi.fn(async () => new Response(page('new')));
      vi.stubGlobal('fetch', fetch);
      document.head.insertAdjacentHTML('beforeend', versionTag('old'));
      stop = watchForUpdates();
      expect(fetch).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/`, {
        cache: 'no-cache',
      });
      await settle();
      expect(getNewerVersion()).toBe('new');
    });

    it('never looks without a stamp, as on the dev server', async () => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      stop = watchForUpdates();
      await vi.advanceTimersByTimeAsync(3 * CHECK_EVERY_MS);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it('stops looking when stopped, and forgets what it found', async () => {
    const { state, fetch } = watch();
    state.deployed = page('new');
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(getNewerVersion()).toBe('new');

    stop();
    expect(getNewerVersion()).toBeNull();
    await vi.advanceTimersByTimeAsync(3 * CHECK_EVERY_MS);
    setVisibility('hidden');
    setVisibility('visible');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
