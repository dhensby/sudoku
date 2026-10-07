import { expect, test, type Page } from '@playwright/test';
import { generateDaily } from '../src/daily/generate';
import {
  boardArea,
  grid,
  openHeaderDialog,
  openTodaysDaily,
  puzzleLink,
  solveFromKeyboard,
  startButton,
  waitForPlaying,
} from './helpers';

/**
 * The daily puzzles, end to end, on a fixed clock: 10:00 on Tuesday 6
 * October 2026 in London (Daily #6). Each daily is dealt live, in the
 * worker, from its date — and here, from the same recipe in the test, so
 * the suite knows each answer without ever reading the app's.
 */

test.use({ timezoneId: 'Europe/London' });

const TODAY = '2026-10-06';
const HARD_TODAY = generateDaily(TODAY, 'hard');

async function freezeClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date(`${TODAY}T10:00:00+01:00`) });
}

const solved = (page: Page) => page.getByRole('dialog', { name: 'Solved!' });

test("today's Hard daily from New game counts for the streak", async ({ page }) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await page.goto('/');
  await waitForPlaying(page);

  // Today's, from the New game menu: dealt live, played to the end.
  await page.getByRole('button', { name: 'New game' }).click();
  const menu = page.getByRole('menu', { name: 'New game' });
  await expect(
    menu.getByRole('group', { name: "Today's puzzles, Tuesday 6 October" }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await openTodaysDaily(page, 'Hard');
  expect(await grid(page).getByRole('gridcell').count()).toBe(81);
  // The header says it is a daily, and which.
  await expect(page.getByRole('banner').locator('.header__difficulty')).toContainText(
    'Daily puzzle for Tuesday 6 October. Difficulty: Daily · Hard',
  );
  await solveFromKeyboard(page, HARD_TODAY);
  await expect(solved(page)).toBeVisible();
  await expect(solved(page)).toContainText('Daily · 6 Oct · Hard');
  await expect(solved(page)).toContainText('That starts a Hard streak');
  await page.keyboard.press('Escape');

  // And the menu's mark for today's.
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(menu.getByRole('menuitem', { name: "Today's Hard puzzle, solved" })).toBeVisible();
});

test('a shared link to a daily, with its date, is recorded as that daily', async ({ page }) => {
  await freezeClock(page);
  await page.goto(`${puzzleLink(HARD_TODAY.givens)}&d=${TODAY}`);
  // Checked against today's Hard, dealt in the worker, before it says so.
  await expect(boardArea(page)).toContainText("Someone shared today's Hard puzzle with you.", {
    timeout: 30_000,
  });
  await startButton(page).click();
  await waitForPlaying(page);

  await openHeaderDialog(page, 'History');
  await expect(page.getByRole('dialog', { name: 'History' })).toContainText('Daily · 6 Oct');
});

test('a link whose date has no daily opens as any shared puzzle', async ({ page }) => {
  await freezeClock(page);
  await page.goto(`${puzzleLink(HARD_TODAY.givens)}&d=2026-12-25`);
  await expect(boardArea(page)).toContainText('Someone shared a Hard puzzle with you.');
  await startButton(page).click();
  await waitForPlaying(page);
  await openHeaderDialog(page, 'History');
  await expect(page.getByRole('dialog', { name: 'History' })).not.toContainText('Daily ·');
});
