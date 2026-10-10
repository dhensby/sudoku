import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { generateDaily } from '../src/daily/generate';
import {
  NEARLY_DONE,
  boardArea,
  copiedText,
  openHeaderDialog,
  placedSolve,
  puzzleLink,
  solveFromKeyboard,
  startButton,
  startPuzzle,
  stubClipboard,
  waitForPlaying,
} from './helpers';

/**
 * Sharing a solve, end to end, between browsers: A solves a puzzle and shares
 * the time with the solve in the link; B, who has not solved it, chooses to
 * play it first, solves it, and then watches A's solve for nothing; C watches
 * it first, anyway, and solves it with no time to show; someone who has
 * solved it already watches without being asked; and a daily's link, whose
 * solve watched first keeps the daily out of the streak.
 *
 * Each browser is a fresh context — no storage, no history — as a friend's
 * would be. Runs on Chromium (desktop layout).
 */

const solved = (page: Page) => page.getByRole('dialog', { name: 'Solved!' });
const player = (page: Page) => page.getByRole('dialog', { name: "Alice's solve" });
const spoiler = (page: Page) => page.getByRole('dialog', { name: "Watch Alice's solve?" });
const watchAlice = (page: Page) => page.getByRole('button', { name: "Watch Alice's solve" });

/** A solves NEARLY_DONE in 0:12 and shares the time as Alice, with the solve in the link. */
async function shareWithTheSolve(page: Page): Promise<URL> {
  await stubClipboard(page);
  await page.clock.install();
  await startPuzzle(page, NEARLY_DONE);
  await page.clock.fastForward('00:12');
  await solveFromKeyboard(page, NEARLY_DONE);
  await solved(page).getByRole('button', { name: 'Share your time' }).click();
  const share = page.getByRole('dialog', { name: 'Share your time' });
  await share.getByRole('textbox', { name: 'Your name (optional)' }).fill('Alice');
  const include = share.getByRole('checkbox', { name: 'Include my solve' });
  await expect(include).not.toBeChecked();
  await include.check();
  await share.getByRole('button', { name: 'Copy' }).click();
  await expect(share.getByRole('status')).toHaveText('Copied to clipboard');
  const [message] = await copiedText(page);
  const lines = message.split('\n');
  expect(lines.slice(0, -1)).toEqual([
    'Sudoku · Easy · 0:12',
    'No mistakes',
    'Can you beat my time?',
    "You can watch my solve too, once you've had a go.",
  ]);
  const link = new URL(lines.at(-1)!);
  expect([...link.searchParams.keys()]).toEqual(['p', 't', 'n', 'a', 's']);
  return link;
}

/** Run `body` in a fresh browser, as a friend's. */
async function elsewhere(browser: Browser, body: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.clock.install();
    await body(page);
  } finally {
    await context.close();
  }
}

/** Step the player to the solve and close it, back where it was opened. */
async function watchToTheEnd(page: Page): Promise<void> {
  await expect(player(page)).toHaveAccessibleDescription('Easy · 0:12');
  await page.keyboard.press('End');
  await expect(player(page).locator('.playback__caption')).toHaveText(/— solved$/);
  await player(page).getByRole('button', { name: 'Close' }).click();
  await expect(player(page)).toBeHidden();
}

test('a friend plays first, solves it, then watches the solve for nothing', async ({
  page,
  browser,
}) => {
  const link = await shareWithTheSolve(page);
  await elsewhere(browser, async (b) => {
    await b.goto(link.href);
    await expect(boardArea(b)).toContainText('Alice solved this Easy puzzle in 0:12.');
    await expect(startButton(b)).toBeFocused();
    await watchAlice(b).click();
    await expect(spoiler(b)).toHaveAccessibleDescription(
      "This shows every number Alice placed. You haven't solved this puzzle yet: if you watch now, you won't be able to record a time for it, now or later.",
    );
    await expect(spoiler(b).getByRole('button', { name: 'Play it first' })).toBeFocused();
    await b.keyboard.press('Enter');
    await waitForPlaying(b);
    await b.clock.fastForward('00:05');
    await solveFromKeyboard(b, NEARLY_DONE);

    // A time of B's own, raced against Alice's — and her solve, free to watch.
    const versus = solved(b).getByRole('region', { name: 'Head to head' });
    await expect(versus.getByRole('row', { name: /^Time/ })).toHaveText(/^Time\s*0:0\d\s*0:12$/);
    await versus.getByRole('button', { name: "Watch Alice's solve" }).click();
    await expect(spoiler(b)).toHaveCount(0);
    await watchToTheEnd(b);
    await expect(versus.getByRole('button', { name: "Watch Alice's solve" })).toBeFocused();
    await solved(b).getByRole('button', { name: 'Close' }).click();

    // And from History, where the game keeps it.
    await openHeaderDialog(b, 'History');
    const history = b.getByRole('dialog', { name: 'History' });
    await expect(history).toContainText(/Solved in 0:0\d/);
    await history.getByRole('button', { name: /^Watch Alice's solve, / }).click();
    await watchToTheEnd(b);
    await expect(history.getByRole('button', { name: /^Watch Alice's solve, / })).toBeFocused();
  });
});

test('a friend who watches first solves it with no time recorded', async ({ page, browser }) => {
  const link = await shareWithTheSolve(page);
  await elsewhere(browser, async (c) => {
    await c.goto(link.href);
    await watchAlice(c).click();
    await spoiler(c).getByRole('button', { name: 'Watch anyway' }).click();
    await watchToTheEnd(c);
    await expect(boardArea(c)).toContainText(
      "You've watched a solve of this puzzle, so no time will be recorded.",
    );

    await startButton(c).click();
    await waitForPlaying(c);
    await c.clock.fastForward('00:05');
    await solveFromKeyboard(c, NEARLY_DONE);
    await expect(solved(c)).toContainText(
      'Solved — no time recorded: you watched a solve of this puzzle first.',
    );
    await expect(solved(c).locator('.result__time')).toHaveCount(0);
    await expect(c.getByRole('banner').locator('.timer__time')).toHaveText(
      'Solved, no time recorded—',
    );
    const versus = solved(c).getByRole('region', { name: 'Head to head' });
    await expect(versus.getByRole('row', { name: /^Time/ })).toHaveText(
      /^Time\s*—\s*no time recorded\s*0:12$/,
    );
    await expect(versus).toContainText("You watched a solve first, so there's no time to compare.");
    await expect(solved(c).getByRole('button', { name: 'Share puzzle' })).toBeFocused();
    await solved(c).getByRole('button', { name: 'Close' }).click();

    await openHeaderDialog(c, 'History');
    const history = c.getByRole('dialog', { name: 'History' });
    await expect(history.locator('.history-item__status').first()).toHaveText(
      'Solved after watching a solve · No mistakes',
    );
    await expect(history.getByRole('row', { name: /^Easy/ })).toHaveText(/^Easy\s*1\s*1\s*—\s*—$/);

    // Played again, it still records no time: the puzzle stays watched.
    await history.getByRole('button', { name: /^Play again, / }).click();
    await waitForPlaying(c);
    await solveFromKeyboard(c, NEARLY_DONE);
    await expect(solved(c)).toContainText('Solved — no time recorded');
  });
});

test('someone who has solved the puzzle already watches without being asked', async ({ page }) => {
  const link = await shareWithTheSolve(page);
  // A has solved it: the link opens the offer to play it again.
  await page.goto(link.href);
  const offer = page.getByRole('dialog', { name: "You've solved this one" });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: "Watch Alice's solve" }).click();
  await expect(spoiler(page)).toHaveCount(0);
  await watchToTheEnd(page);
  await expect(offer.getByRole('button', { name: "Watch Alice's solve" })).toBeFocused();
});

test.describe("a daily's link with a solve", () => {
  test.use({ timezoneId: 'Europe/London' });
  const TODAY = '2026-10-13';
  const EASY_TODAY = generateDaily(TODAY, 'easy');

  test('watched first, the daily records no time and does not count for the streak', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.clock.install({ time: new Date(`${TODAY}T10:00:00+01:00`) });
    const { log, seconds } = placedSolve(EASY_TODAY);
    const link = `${puzzleLink(EASY_TODAY.givens, { seconds, name: 'Alice' })}&d=${TODAY}&s=${log}`;
    await page.goto(link);
    // Checked against today's Easy, dealt in the worker, before it says so.
    await expect(boardArea(page)).toContainText("Alice solved today's Easy puzzle", {
      timeout: 30_000,
    });
    await watchAlice(page).click();
    await spoiler(page).getByRole('button', { name: 'Watch anyway' }).click();
    await expect(player(page)).toHaveAccessibleDescription(/^Daily · 13 Oct · Easy · /);
    await player(page).getByRole('button', { name: 'Close' }).click();

    await startButton(page).click();
    await waitForPlaying(page);
    await solveFromKeyboard(page, EASY_TODAY);
    await expect(solved(page)).toContainText('Daily · 13 Oct · Easy');
    await expect(solved(page)).toContainText(
      "You watched a solve of it first, so it doesn't count towards your streak",
    );
    await solved(page).getByRole('button', { name: 'Close' }).click();

    await openHeaderDialog(page, 'Daily puzzles');
    const calendar = page.getByRole('dialog', { name: 'Daily puzzles' });
    await expect(
      calendar.getByRole('region', { name: 'Streaks' }).getByRole('listitem').filter({
        hasText: 'Easy',
      }),
    ).toHaveText(/^Easycurrent streak 0 daysBest 0/);
    await expect(calendar).toContainText('Solved after watching a solve');
    // The day's name says the same, never that it was solved on another day.
    await expect(calendar.locator(`[data-date="${TODAY}"]`)).toHaveAccessibleName(
      /^Tuesday 13 October: Easy solved after watching a solve, /,
    );
  });
});

test.describe('a friend’s solve on a small screen', () => {
  // The longest name a link keeps (24 characters), and none at all, whose
  // "Watch your friend's solve" is longer than most names make it.
  const NAMES = [
    ['a long name', 'Alexandra Featherstonehx'] as const,
    ['no name', undefined] as const,
  ];
  const { log, seconds } = placedSolve(NEARLY_DONE);
  const linkFor = (name: string | undefined) =>
    `${puzzleLink(NEARLY_DONE.givens, { seconds, name })}&s=${log}`;
  const watchButton = (page: Page | Locator) =>
    page.getByRole('button', { name: /^Watch (your friend's|Alexandra Featherstonehx's) solve$/ });

  /** How far `selector` scrolls sideways, and whether the button is inside it. */
  async function fit(page: Page, selector: string, button: string) {
    return page.evaluate(
      ([boxSelector, buttonSelector]) => {
        const box = document.querySelector(boxSelector)!;
        const outer = box.getBoundingClientRect();
        const inner = box.querySelector(buttonSelector)!.getBoundingClientRect();
        return {
          across: box.scrollWidth - box.clientWidth,
          pageAcross: document.documentElement.scrollWidth - window.innerWidth,
          inside: inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5,
        };
      },
      [selector, button] as const,
    );
  }

  for (const size of [
    { width: 320, height: 568 },
    { width: 568, height: 320 },
  ]) {
    for (const [label, name] of NAMES) {
      test(`keeps the Ready card's button inside the board at ${size.width}×${size.height}, with ${label}`, async ({
        page,
      }) => {
        await page.setViewportSize(size);
        await page.goto(linkFor(name));
        await expect(watchButton(page)).toBeVisible();
        const card = await fit(page, '.board-overlay__card', '.board-overlay__button--secondary');
        expect(card).toEqual({ across: 0, pageAcross: 0, inside: true });
        // And the card inside the frame it stands in for the board.
        const inFrame = await page.evaluate(() => {
          const frame = document.querySelector('.board-overlay')!.getBoundingClientRect();
          const box = document.querySelector('.board-overlay__card')!.getBoundingClientRect();
          return box.left >= frame.left - 0.5 && box.right <= frame.right + 0.5;
        });
        expect(inFrame).toBe(true);
      });
    }
  }

  for (const [label, name] of NAMES) {
    test(`keeps the head-to-head's and History's buttons inside them at 320px, with ${label}`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(linkFor(name));
      await watchButton(page).click();
      await page.getByRole('button', { name: 'Play it first' }).click();
      await waitForPlaying(page);
      await solveFromKeyboard(page, NEARLY_DONE);
      await expect(watchButton(solved(page))).toBeVisible();
      expect(await fit(page, '.dialog__body', '.comparison__watch .button')).toEqual({
        across: 0,
        pageAcross: 0,
        inside: true,
      });
      await solved(page).getByRole('button', { name: 'Close' }).click();
      await openHeaderDialog(page, 'History');
      const history = page.getByRole('dialog', { name: 'History' });
      await expect(history.getByRole('button', { name: /^Watch .*'s solve, / })).toBeVisible();
      expect(await fit(page, '.history-item__actions', '.button--wraps')).toEqual({
        across: 0,
        pageAcross: 0,
        inside: true,
      });
      expect(
        await history.locator('.dialog__body').evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBe(0);
    });
  }
});
