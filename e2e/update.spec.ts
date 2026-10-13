import type { Page } from '@playwright/test';
import { VERSION_META } from '../src/update/stamp';
import {
  boardArea,
  cell,
  grid,
  readBoard,
  resumeButton,
  selectCell,
  updateOffer,
  waitForPlaying,
} from './helpers';
import { expect, test } from './pages-fixtures';

/**
 * A newer version, offered to a page left open, against a stand-in for GitHub
 * Pages (pages-server.ts) that a test deploys a second build to — its ten
 * minutes of HTTP caching and all, which the page's look and the reload
 * after it both have to get past. Every other spec runs against
 * `vite preview`, whose build only ever matches itself.
 *
 * Runs on Chromium and on the iPhone's WebKit, where a game left open on a
 * home screen is likeliest to be.
 */

/** The version the page on show was built as. */
const loadedVersion = (page: Page) =>
  page.locator(`meta[name="${VERSION_META}"]`).getAttribute('content');

/** The page's next look at the version deployed: its own fetch of the app's address. */
const nextLook = (page: Page, url: string) =>
  page.waitForResponse(
    (response) => response.url() === url && response.request().resourceType() === 'fetch',
  );

/**
 * Open the app at `url` — a first visit deals a game and plays it; a later
 * one reopens it, paused — and resolve once the answer to its first look has
 * arrived.
 */
async function open(page: Page, url: string): Promise<void> {
  const looked = nextLook(page, url);
  await page.goto(url);
  await expect(boardArea(page).getByRole('heading').or(grid(page)).first()).toBeVisible();
  await looked;
}

/** Refresh, from the offer, and wait for the page it loads. */
async function refresh(page: Page): Promise<void> {
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Refresh' }).click(),
  ]);
}

test('offers a version deployed while it is open, and Refresh loads it with the game kept', async ({
  page,
  pages,
  builds,
}) => {
  await page.clock.install();
  await open(page, pages.url);
  await waitForPlaying(page);
  const first = await loadedVersion(page);
  expect(first).toMatch(/^[0-9a-f]{16}$/);

  // A number on the board, for the reload to keep.
  const index = (await readBoard(page)).indexOf('0');
  await selectCell(page, index);
  await page.keyboard.press('Digit5');
  await expect(cell(page, index)).toHaveAccessibleName(/^5\b/);
  // Its first look, long since read, found its own version deployed: nothing
  // to offer.
  await expect(updateOffer(page)).toBeHidden();

  pages.deploy(builds.next);
  // Ten minutes on, it looks again.
  const looked = nextLook(page, pages.url);
  await page.clock.fastForward('10:00');
  await looked;
  await expect(updateOffer(page)).toBeVisible();

  await refresh(page);
  expect(await loadedVersion(page)).toBe('v2');
  // The game reopens paused, as on any reload, with its number in place.
  await resumeButton(page).click();
  await expect(cell(page, index)).toHaveAccessibleName(/^5\b/);
  // The new version's own look found itself: no offer.
  await expect(updateOffer(page)).toBeHidden();
});

test('offers the new version at once from a page the HTTP cache kept from before a deploy', async ({
  page,
  pages,
  builds,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    "Playwright's WebKit keeps no HTTP cache on disk, and the first look displaces the copy it keeps in memory, so it is never handed an old page",
  );
  await open(page, pages.url);
  const first = await loadedVersion(page);

  pages.deploy(builds.next);
  // Opened again from elsewhere, as an app is from a home screen, within the
  // ten minutes Pages lets the browser keep the page: it is the old one.
  await page.goto('about:blank');
  await open(page, pages.url);
  expect(await loadedVersion(page)).toBe(first);
  await expect(updateOffer(page)).toBeVisible();

  await refresh(page);
  expect(await loadedVersion(page)).toBe('v2');
});
