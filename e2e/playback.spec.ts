import { expect, test, type Locator, type Page } from '@playwright/test';
import { NEARLY_DONE, openHeaderDialog, settle, solveWithAMistake } from './helpers';

/**
 * Watching a solve played back, end to end: a solve with a mistake that
 * counted, watched from the Solved dialog and from History — stepped through
 * by button and by key, scrubbed, played at 8× on Playwright's clock — with
 * the mistake marked on the scrubber and said in its caption, and nothing in
 * the game or its record changed by watching, and focus back on the Watch
 * that opened it as it closes. Then the player on a 320px
 * phone and on a phone on its side, where it must fit without scrolling.
 *
 * NEARLY_DONE's blanks are row 1, column 1; row 5, column 5; and row 9,
 * column 9: so the solve is four moves — the wrong number, put right, and
 * the other two.
 */

const playback = (page: Page): Locator => page.getByRole('dialog', { name: 'Your solve' });
const caption = (page: Page): Locator => playback(page).locator('.playback__caption');
const scrubber = (page: Page): Locator => playback(page).getByRole('slider', { name: 'Move' });
const transport = (page: Page, name: string | RegExp): Locator =>
  playback(page).getByRole('group', { name: 'Playback' }).getByRole('button', { name });

/** Let the playback run on Playwright's clock until its caption says the puzzle is solved. */
async function playToTheSolve(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (/— solved$/.test((await caption(page).textContent()) ?? '')) return;
    await page.clock.runFor(100);
  }
  await expect(caption(page)).toHaveText(/— solved$/);
}

test.describe('watching a solve', () => {
  test.skip(({ isMobile }) => isMobile, 'the desktop project; phones are measured below');

  test('from the Solved dialog: stepped, scrubbed and played at 8×, its mistake marked', async ({
    page,
  }) => {
    const { wrong } = await solveWithAMistake(page);
    const solved = page.getByRole('dialog', { name: 'Solved!' });
    await solved.getByRole('button', { name: 'Watch your solve' }).click();

    await expect(playback(page)).toHaveAccessibleDescription(/^Easy · 0:0\d$/);
    await expect(transport(page, 'Play')).toBeFocused();
    await expect(caption(page)).toHaveText('Before the first move');
    const board = playback(page).getByRole('table', { name: 'Sudoku board' });
    await expect(board.getByRole('cell').first()).toHaveAccessibleName('empty');
    // The board is only to look at: nothing on it takes focus.
    await expect(board.locator('[tabindex]')).toHaveCount(0);

    // A step with the key, then with the button.
    await page.keyboard.press('ArrowRight');
    await expect(caption(page)).toHaveText(`${wrong} in row 1, column 1 — a mistake`);
    await expect(board.locator('.cell--current')).toHaveCount(1);
    await expect(board.getByRole('cell').first()).toHaveClass(/cell--current/);
    await expect(scrubber(page)).toHaveAttribute('aria-valuetext', /^Move 1 of 4, 0:0\d$/);
    await transport(page, 'Forward a move').click();
    await expect(caption(page)).toHaveText(`${NEARLY_DONE.solution[0]} in row 1, column 1`);
    await expect(scrubber(page)).toHaveAttribute('aria-valuetext', /^Move 2 of 4, 0:0\d$/);

    // The mistake is marked on the scrubber, and named in the key under it.
    await expect(playback(page).locator('.playback__ticks .playback__tick--mistake')).toHaveCount(
      1,
    );
    await expect(playback(page).locator('.playback__ticks .playback__tick--slip')).toHaveCount(0);
    await expect(playback(page).locator('.playback__key')).toHaveText('Mistake');

    // Scrubbed with the keyboard: End and Home on the slider itself.
    await scrubber(page).focus();
    await page.keyboard.press('End');
    await expect(caption(page)).toHaveText(/— solved$/);
    await expect(scrubber(page)).toHaveAttribute('aria-valuetext', /^Move 4 of 4, /);
    await page.keyboard.press('Home');
    await expect(caption(page)).toHaveText('Before the first move');
    await page.keyboard.press('ArrowRight');
    await expect(caption(page)).toHaveText(/— a mistake$/);

    // At 8×, from the start.
    await playback(page).getByText('8×').click();
    await transport(page, 'To the start').click();
    await transport(page, 'Play').click();
    await expect(transport(page, 'Pause')).toBeVisible();
    await playToTheSolve(page);
    await expect(transport(page, 'Watch again')).toBeFocused();
    await expect(scrubber(page)).toHaveAttribute('aria-valuetext', /^Move 4 of 4, /);

    // Closing goes back to the Solved dialog, which still says what it did,
    // with focus back on the button that opened the playback.
    await page.keyboard.press('Escape');
    await expect(solved).toBeVisible();
    await expect(solved.getByRole('button', { name: 'Watch your solve' })).toBeFocused();
    await expect(solved.locator('.result__mistakes')).toHaveText('1 mistake');
  });

  test('from History, changing nothing in the game or its record', async ({ page }) => {
    await solveWithAMistake(page);
    const solved = page.getByRole('dialog', { name: 'Solved!' });
    const time = await solved.locator('.result__time').textContent();
    await solved.getByRole('button', { name: 'Close' }).click();

    await openHeaderDialog(page, 'History');
    const history = page.getByRole('dialog', { name: 'History' });
    const status = history.locator('.history-item__status').first();
    await expect(status).toHaveText(`Solved in ${time} · 1 mistake`);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));

    // Filtered to Easy first, and opened from the keyboard: the list comes
    // back as it stood, focus on the same Watch.
    await history.getByRole('tab', { name: 'Easy' }).click();
    const watch = history.getByRole('button', { name: /^Watch your solve, Easy/ });
    await watch.focus();
    await page.keyboard.press('Enter');
    await expect(playback(page)).toHaveAccessibleDescription(`Easy · ${time}`);
    await page.keyboard.press('End');
    await expect(caption(page)).toHaveText(/— solved$/);

    await page.keyboard.press('Escape');
    await expect(history).toBeVisible();
    await expect(history.getByRole('tab', { name: 'Easy' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(watch).toBeFocused();
    await expect(status).toHaveText(`Solved in ${time} · 1 mistake`);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(stored);
  });

  for (const [label, size] of [
    ['a 320px phone', { width: 320, height: 568 }],
    ['a phone on its side', { width: 568, height: 320 }],
  ] as const) {
    test(`fits ${label} without scrolling`, async ({ page }) => {
      await page.setViewportSize(size);
      await solveWithAMistake(page);
      await page
        .getByRole('dialog', { name: 'Solved!' })
        .getByRole('button', { name: 'Watch your solve' })
        .click();
      await expect(caption(page)).toHaveText('Before the first move');
      // Measured where the sheet comes to rest, not as it slides up.
      await settle(page);
      const measured = await page.evaluate(() => {
        const body = document.querySelector('.dialog--playback .dialog__body')!;
        const card = document.querySelector('.dialog--playback')!.getBoundingClientRect();
        const board = document.querySelector('.playback__board')!.getBoundingClientRect();
        return {
          scrollsDown: body.scrollHeight - body.clientHeight,
          scrollsAcross: body.scrollWidth - body.clientWidth,
          pageAcross: document.documentElement.scrollWidth - window.innerWidth,
          inView: card.top >= 0 && card.bottom <= window.innerHeight + 1,
          board: board.width,
        };
      });
      expect(measured.scrollsDown).toBeLessThanOrEqual(1);
      expect(measured.scrollsAcross).toBeLessThanOrEqual(0);
      expect(measured.pageAcross).toBeLessThanOrEqual(0);
      expect(measured.inView).toBe(true);
      expect(measured.board).toBeGreaterThanOrEqual(160);
      // Every control is there to press.
      for (const name of [
        'To the start',
        'Back a move',
        'Play',
        'Forward a move',
        'To the solve',
      ]) {
        await expect(transport(page, name)).toBeInViewport();
      }
      await expect(scrubber(page)).toBeInViewport();
      await expect(playback(page).getByText('8×')).toBeInViewport();
    });
  }
});
