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
  timer,
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
const YESTERDAY = '2026-10-05';
const HARD_TODAY = generateDaily(TODAY, 'hard');
const HARD_YESTERDAY = generateDaily(YESTERDAY, 'hard');

async function freezeClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date(`${TODAY}T10:00:00+01:00`) });
}

const calendar = (page: Page) => page.getByRole('dialog', { name: 'Daily puzzles' });
const solved = (page: Page) => page.getByRole('dialog', { name: 'Solved!' });

/** A calendar day, found by the start of its accessible name ("Tuesday 6 October"). */
const day = (page: Page, name: string) =>
  calendar(page).getByRole('gridcell', { name: new RegExp(`^${name}:`) });

/** A tier's streak tile: "Hard", its current streak, and its best. */
const streak = (page: Page, tier: string) =>
  calendar(page)
    .getByRole('region', { name: 'Streaks' })
    .getByRole('listitem')
    .filter({ hasText: tier });

test("today's Hard daily from New game counts for the streak; yesterday's from the calendar is kept but does not", async ({
  page,
}) => {
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

  // Ticked in the calendar, and a Hard streak of one.
  await openHeaderDialog(page, 'Daily puzzles');
  await expect(day(page, 'Tuesday 6 October')).toHaveAccessibleName(
    'Tuesday 6 October: Easy, Medium and Expert not started, Hard solved on the day',
  );
  await expect(day(page, 'Tuesday 6 October')).toHaveAttribute('aria-current', 'date');
  await expect(streak(page, 'Hard')).toHaveText('Hardcurrent streak 1 dayBest 1');

  // Yesterday's, from the calendar: recorded, but no help to the streak.
  await day(page, 'Monday 5 October').click();
  await calendar(page)
    .getByRole('button', { name: 'Play, Hard daily for Monday 5 October' })
    .click();
  await expect(calendar(page)).toHaveCount(0);
  await expect(grid(page)).toBeVisible({ timeout: 30_000 });
  await expect(timer(page)).toHaveAccessibleName('Pause');
  await solveFromKeyboard(page, HARD_YESTERDAY);
  await expect(solved(page)).toContainText('Daily · 5 Oct · Hard');
  await expect(solved(page)).toContainText(
    "Played on a later day, so it doesn't count towards your streak",
  );
  await page.keyboard.press('Escape');

  await openHeaderDialog(page, 'Daily puzzles');
  await expect(day(page, 'Monday 5 October')).toHaveAccessibleName(
    'Monday 5 October: Easy, Medium and Expert not started, Hard solved on another day',
  );
  await expect(streak(page, 'Hard')).toHaveText('Hardcurrent streak 1 dayBest 1');

  // And the menu's mark for today's.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(menu.getByRole('menuitem', { name: "Today's Hard puzzle, solved" })).toBeVisible();
});

test('the calendar moves by the keyboard, and keeps to the days that have a daily', async ({
  page,
}) => {
  await freezeClock(page);
  await page.goto('/');
  await waitForPlaying(page);
  await openHeaderDialog(page, 'Daily puzzles');
  // Opened on today, which has focus.
  await expect(day(page, 'Tuesday 6 October')).toBeFocused();
  // A week back is before Daily #1, which is as far as it goes.
  await page.keyboard.press('ArrowUp');
  await expect(day(page, 'Thursday 1 October')).toBeFocused();
  await expect(day(page, 'Thursday 1 October')).toHaveAttribute('aria-selected', 'true');
  await expect(calendar(page).getByRole('heading', { name: 'Thursday 1 October' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(day(page, 'Sunday 4 October')).toBeFocused();
  await page.keyboard.press('PageDown');
  // No further than today.
  await expect(day(page, 'Tuesday 6 October')).toBeFocused();
  await expect(day(page, 'Wednesday 7 October')).toHaveAttribute('aria-disabled', 'true');
  await expect(calendar(page).getByRole('button', { name: 'Next month' })).toBeDisabled();
  await expect(calendar(page).getByRole('button', { name: 'Previous month' })).toBeDisabled();
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

  await openHeaderDialog(page, 'Daily puzzles');
  await expect(day(page, 'Tuesday 6 October')).toHaveAccessibleName(
    'Tuesday 6 October: Easy, Medium and Expert not started, Hard in progress',
  );
  await page.keyboard.press('Escape');
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
