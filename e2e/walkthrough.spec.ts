import { expect, test, type Page } from '@playwright/test';
import { STUCK_ON_A_HIDDEN_PAIR } from '../src/test/logic-fixtures';
import {
  arrowTo,
  chooseMore,
  getStuck,
  openHeaderDialog,
  resumeButton,
  selectCell,
  selectedIndex,
  waitForPlaying,
} from './helpers';

/**
 * Remembered hints, end to end, on the board behind the report that asked
 * for them: a player sixteen entries into the puzzle of share code
 * `O3NLgKqUTeam9ygZMBQVALBbgSY`, whose hint pointed at row 5, column 2 and
 * named a hidden pair — in column 6, half a board away. Selecting the cell
 * again shows the hint again, and neither that nor asking again costs
 * another hint.
 *
 * Runs on Chromium (desktop layout).
 */

const { target } = STUCK_ON_A_HIDDEN_PAIR;

const HINT = "Look here — a hidden pair will unlock this cell. What's a hidden pair?";

const hintBar = (page: Page) => page.locator('.hint-bar');

/** The help the game on screen has taken, as History lists it, is `help`. */
async function expectHelpUsed(page: Page, help: string): Promise<void> {
  await openHeaderDialog(page, 'History');
  const history = page.getByRole('dialog', { name: 'History' });
  await expect(history.getByRole('list', { name: 'Help used' })).toHaveText(help);
  await page.keyboard.press('Escape');
  await waitForPlaying(page);
}

test('a hinted cell shows its hint again whenever it is selected, at no further cost', async ({
  page,
}) => {
  await getStuck(page);
  await chooseMore(page, 'Hint');
  await expect(hintBar(page)).toHaveText(HINT);
  expect(await selectedIndex(page)).toBe(target);

  // Away from the cell, the hint goes; back on it, it returns.
  await arrowTo(page, target, target - 9);
  await expect(hintBar(page)).toHaveText('');
  await arrowTo(page, target - 9, target);
  await expect(hintBar(page)).toHaveText(HINT);
  // A screen reader hears it as the cell's description, not from the status region.
  await expect(page.getByRole('gridcell', { selected: true })).toHaveAccessibleDescription(
    'Look here — a hidden pair will unlock this cell.',
  );

  // Asking again is free.
  await arrowTo(page, target, 0);
  await chooseMore(page, 'Hint');
  expect(await selectedIndex(page)).toBe(target);
  await expectHelpUsed(page, '1 hint');

  // And it is kept with the game.
  await page.reload();
  await resumeButton(page).click();
  await waitForPlaying(page);
  await selectCell(page, target);
  await expect(hintBar(page)).toHaveText(HINT);
  await expectHelpUsed(page, '1 hint');
});
