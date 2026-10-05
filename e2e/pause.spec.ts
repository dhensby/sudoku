import { expect, test, type Page } from '@playwright/test';
import {
  PUZZLES,
  boardArea,
  cell,
  cells,
  emptyCells,
  gotoPuzzle,
  grid,
  openHeaderDialog,
  readBoard,
  readTimer,
  resumeButton,
  selectCell,
  setVisibility,
  startButton,
  startPuzzle,
  timer,
  toSeconds,
  typeDigits,
  waitForPlaying,
} from './helpers';

/**
 * The clock and the pause, end to end: a stopped clock means a hidden board.
 * Pausing (the timer button, or P), hiding the tab and reloading all stop the
 * clock and take the cells out of the page altogether — not just out of
 * sight — so neither a glance nor the DOM nor a screen reader can study the
 * puzzle off the clock. Dialogs stop it too, silently, and start it again as
 * they close.
 *
 * Timer assertions use Playwright's fake clock where time has to pass, so
 * nothing here sleeps.
 *
 * Runs on Chromium (desktop layout).
 */

const EASY = PUZZLES.easy;

/** A few of the solution's digits on the board, so there is player work to hide as well as givens. */
async function playSome(page: Page): Promise<void> {
  const entries = emptyCells(EASY.givens)
    .slice(0, 4)
    .map((index) => ({ index, digit: Number(EASY.solution[index]) }));
  await typeDigits(page, entries);
}

/**
 * Every digit left on the page other than the ones that belong there with
 * the board hidden: the timer, the number pad's keys and the paused card's
 * time. Text and accessible names both count — a screen reader reads either.
 */
async function leakedDigits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const copy = document.body.cloneNode(true) as HTMLElement;
    const allowed = ['.timer', '.numpad__key', '.board-overlay__text'];
    for (const element of copy.querySelectorAll(allowed.join(', '))) element.remove();
    const labels = [...copy.querySelectorAll('[aria-label]')].map(
      (el) => el.getAttribute('aria-label') ?? '',
    );
    return [copy.textContent ?? '', ...labels].join(' ').match(/[1-9]/g) ?? [];
  });
}

/** The board is gone from the page, and the paused card stands in its place. */
async function expectHidden(page: Page): Promise<void> {
  await expect(boardArea(page).getByRole('heading', { name: 'Paused' })).toBeVisible();
  await expect(grid(page)).toHaveCount(0);
  await expect(cells(page)).toHaveCount(0);
  expect(await page.locator('[role="gridcell"], .cell').count()).toBe(0);
}

test.describe('pausing', () => {
  test('the timer button hides every digit, and Resume brings the board back', async ({ page }) => {
    await startPuzzle(page, EASY);
    await playSome(page);
    const board = await readBoard(page);

    await timer(page).click();
    await expectHidden(page);
    expect(await leakedDigits(page)).toEqual([]);
    await expect(timer(page)).toHaveAccessibleName('Resume');
    // Nothing that changes the board can be pressed.
    await expect(page.getByRole('button', { name: '5', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'More' })).toBeDisabled();
    // Focus moves to the card, so Enter or Space carries on.
    await expect(resumeButton(page)).toBeFocused();

    await resumeButton(page).click();
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(board);
    // The keyboard carries on from the board, not from the page.
    await expect(page.getByRole('gridcell', { selected: true })).toBeFocused();
  });

  test('P pauses and resumes, and is the only key that works while paused', async ({ page }) => {
    await page.clock.install();
    await startPuzzle(page, EASY);
    await playSome(page);
    const board = await readBoard(page);

    await page.keyboard.press('p');
    await expectHidden(page);
    expect(await leakedDigits(page)).toEqual([]);
    const paused = await readTimer(page);

    // Keys do nothing to a hidden board, and the clock stays put.
    await page.keyboard.press('Digit1');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Control+z');
    await page.clock.fastForward('02:00');
    expect(await readTimer(page)).toBe(paused);
    await expect(boardArea(page).getByText(`Easy · ${paused}`)).toBeVisible();

    await page.keyboard.press('p');
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(board);
    expect(toSeconds(await readTimer(page))).toBeLessThan(toSeconds(paused) + 5);
  });

  test('hiding the tab pauses at once, and the time away does not count', async ({ page }) => {
    await page.clock.install();
    await startPuzzle(page, EASY);
    await playSome(page);
    await page.clock.fastForward('00:10');

    await setVisibility(page, 'hidden');
    await expect(grid(page)).toHaveCount(0);
    await page.clock.fastForward('05:00');
    await setVisibility(page, 'visible');

    // Back to a paused card, not a running clock.
    await expectHidden(page);
    expect(await leakedDigits(page)).toEqual([]);
    const shown = await readTimer(page);
    expect(toSeconds(shown)).toBeGreaterThanOrEqual(10);
    expect(toSeconds(shown)).toBeLessThan(20);

    await resumeButton(page).click();
    await waitForPlaying(page);
    expect(toSeconds(await readTimer(page))).toBeLessThan(25);
  });

  test('hiding the tab says "Paused.", leaving no trace of the last move', async ({ page }) => {
    await startPuzzle(page, EASY);
    await playSome(page);
    const status = page.getByRole('status').first();
    await expect(status).toHaveText(/ in row \d, column \d\.$/);
    await setVisibility(page, 'hidden');
    await expect(status).toHaveText('Paused.');
    await setVisibility(page, 'visible');
    await expectHidden(page);
    expect(await leakedDigits(page)).toEqual([]);
  });

  test('a menu left open as the tab hides closes as the Paused card takes focus', async ({
    page,
  }) => {
    await startPuzzle(page, EASY);
    await page.getByRole('button', { name: 'New game' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'New game' })).toBeVisible();
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await expectHidden(page);
    // Not lingering over the card, out of the keyboard's reach.
    await expect(resumeButton(page)).toBeFocused();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await waitForPlaying(page);
  });

  test('a reload reopens a paused game paused, with its time to the second', async ({ page }) => {
    await startPuzzle(page, EASY);
    await playSome(page);
    const board = await readBoard(page);
    await page.keyboard.press('p');
    await expectHidden(page);
    const paused = await readTimer(page);

    await page.reload();
    await expectHidden(page);
    expect(await leakedDigits(page)).toEqual([]);
    expect(await readTimer(page)).toBe(paused);
    await expect(boardArea(page).getByText(`Easy · ${paused}`)).toBeVisible();

    await resumeButton(page).click();
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(board);
  });

  test('a reload mid-game banks the time played and reopens paused', async ({ page }) => {
    await page.clock.install();
    await startPuzzle(page, EASY);
    await playSome(page);
    await page.clock.fastForward('00:42');
    await expect.poll(() => readTimer(page)).toMatch(/^0:4[2-9]$/);
    const before = toSeconds(await readTimer(page));
    const board = await readBoard(page);

    await page.reload();
    await expectHidden(page);
    const after = toSeconds(await readTimer(page));
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after).toBeLessThan(before + 5);

    await resumeButton(page).click();
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(board);
  });
});

test.describe('a shared puzzle', () => {
  test('P starts a puzzle waiting behind its Ready card', async ({ page }) => {
    await gotoPuzzle(page, EASY.givens);
    await expect(boardArea(page).getByRole('heading', { name: 'Ready?' })).toBeVisible();
    await page.keyboard.press('Digit5');
    await expect(cells(page)).toHaveCount(0);
    await page.keyboard.press('p');
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(EASY.givens);
  });
});

/*
 * A puzzle that arrives while nobody is looking — a first visit opened in a
 * background tab, or a New game the player switched away from — has never
 * been seen, so it waits behind Start with nothing on the clock.
 */
test.describe('a puzzle made in a hidden tab', () => {
  async function expectWaiting(page: Page, tier: string): Promise<void> {
    await expect(boardArea(page)).toContainText(`Your ${tier} puzzle is ready.`);
    await expect(startButton(page)).toBeVisible();
    await expect(cells(page)).toHaveCount(0);
    await expect(timer(page)).toHaveAccessibleName('Start');
    expect(await readTimer(page)).toBe('0:00');
  }

  test('a first visit in a background tab opens on Start, at 0:00', async ({ page }) => {
    await page.clock.install();
    // Hidden from the first script on, as a tab opened in the background is.
    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    });
    await page.goto('/');
    await expect(startButton(page)).toBeAttached();
    await page.clock.fastForward('01:00');
    await setVisibility(page, 'visible');
    await expectWaiting(page, 'Easy');

    // Never started, so a reload waits behind Start too.
    await page.reload();
    await expect(startButton(page)).toBeAttached();
    await setVisibility(page, 'visible');
    await expectWaiting(page, 'Easy');

    await startButton(page).click();
    await waitForPlaying(page);
    await page.clock.fastForward('00:03');
    await expect.poll(async () => toSeconds(await readTimer(page))).toBeGreaterThanOrEqual(3);
  });

  test('a New game the player switched away from waits behind Start', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await waitForPlaying(page);
    await page.getByRole('button', { name: 'New game' }).click();
    // Chosen and hidden in the same task, so the puzzle cannot beat the switch.
    await page
      .getByRole('menu', { name: 'New game' })
      .getByRole('menuitem', { name: 'Expert' })
      .evaluate((item: HTMLElement) => {
        item.click();
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    await expect(startButton(page)).toBeAttached();
    await page.clock.fastForward('01:00');
    await setVisibility(page, 'visible');
    await expect(page.getByRole('banner')).toContainText('Difficulty: Expert');
    await expectWaiting(page, 'Expert');
  });
});

test.describe('dialogs', () => {
  for (const name of ['Settings', 'Help', 'History', 'Share'] as const) {
    test(`${name} holds the clock silently, and closing it starts it again`, async ({ page }) => {
      await page.clock.install();
      await startPuzzle(page, EASY);
      await playSome(page);

      await openHeaderDialog(page, name);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // The board is hidden behind it, with no Paused card of its own: the
      // dialog has the floor.
      await expect(cells(page)).toHaveCount(0);
      await expect(boardArea(page).getByRole('heading', { name: 'Paused' })).toHaveCount(0);
      await expect(resumeButton(page)).toHaveCount(0);

      await page.clock.fastForward('10:00');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await waitForPlaying(page);
      expect(toSeconds(await readTimer(page))).toBeLessThan(30);
    });
  }

  test('a game the player paused stays paused when a dialog closes', async ({ page }) => {
    await startPuzzle(page, EASY);
    await page.keyboard.press('p');
    await expectHidden(page);

    await openHeaderDialog(page, 'Help');
    await page.getByRole('dialog', { name: 'Help' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectHidden(page);
  });

  test('keys typed while a dialog is open do not reach the board', async ({ page }) => {
    await startPuzzle(page, EASY);
    const target = emptyCells(EASY.givens)[0];
    await selectCell(page, target);
    await openHeaderDialog(page, 'Help');
    await page.keyboard.press(`Digit${EASY.solution[target]}`);
    await page.keyboard.press('Escape');
    await waitForPlaying(page);
    await expect(cell(page, target)).toHaveAccessibleName('empty');
  });
});
