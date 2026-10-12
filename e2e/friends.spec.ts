import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  NEARLY_DONE,
  NEARLY_DONE_2,
  boardArea,
  gotoPuzzle,
  grid,
  openFriends,
  openHeaderDialog,
  solveFromKeyboard,
  startButton,
  waitForPlaying,
  type LinkChallenge,
} from './helpers';
import type { Puzzle } from '../src/core';

/**
 * Friends, end to end: a link with a time carries its sender's player ID,
 * and every link opened with one is noted; Friends, at the foot of History,
 * lists them, and the name given someone there is the one shown on every race
 * of theirs — whatever their links call them, past races and later ones
 * alike, through a reload.
 *
 * Runs on Chromium (desktop layout).
 */

/** A sending browser's ID, as its links carry it (`u=`). */
const SENDER = 'k3x9q7za2m';

const historyDialog = (page: Page) => page.getByRole('dialog', { name: 'History' });

/** The rows of History's list — not the chips nested inside them. */
const historyRows = (page: Page) =>
  historyDialog(page).getByRole('list', { name: 'Games, newest first' }).locator(':scope > li');

/** Friends' rows. */
const friendRows = (friends: Locator) =>
  friends.getByRole('list', { name: 'Friends, latest first' }).getByRole('listitem');

/** Open a link from SENDER, behind its Ready card. */
async function openTheirLink(page: Page, puzzle: Puzzle, challenge: LinkChallenge): Promise<void> {
  await gotoPuzzle(page, puzzle.givens, { challenge: { ...challenge, playerId: SENDER } });
  await expect(startButton(page)).toBeVisible();
}

/** Press Start on the link's card, solve it a few seconds in, and leave Solved! up. */
async function race(page: Page, puzzle: Puzzle): Promise<Locator> {
  await startButton(page).click();
  await waitForPlaying(page);
  await page.clock.fastForward('00:05');
  await solveFromKeyboard(page, puzzle);
  const solved = page.getByRole('dialog', { name: 'Solved!' });
  await expect(solved).toBeVisible();
  return solved;
}

test.describe('friends', () => {
  test('a sender named in Friends goes by that name on every race, through a reload and a later link calling itself something else', async ({
    page,
  }) => {
    await page.clock.install();
    // Their first link, by the name it gives.
    await openTheirLink(page, NEARLY_DONE, { seconds: 200, name: 'Rude Name' });
    await expect(boardArea(page)).toContainText(
      'Rude Name solved this Easy puzzle in 3:20. Can you beat it?',
    );
    let solved = await race(page, NEARLY_DONE);
    await expect(solved.getByRole('columnheader').nth(1)).toHaveText('Rude Name');
    await page.keyboard.press('Escape');
    await expect(solved).toBeHidden();

    // Named in Friends, from the keyboard: the name it goes by now, selected,
    // typed over, and Enter.
    let friends = await openFriends(page);
    await expect(friendRows(friends)).toHaveCount(1);
    await expect(friendRows(friends)).toContainText('Name from their latest link');
    const rename = friends.getByRole('button', { name: /^Rename Rude Name, latest link Today/ });
    await expect(rename).toBeFocused();
    await page.keyboard.press('Enter');
    const field = friends.getByRole('textbox', { name: 'Their name' });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Rude Name');
    await page.keyboard.type('Bob');
    await expect(field).toHaveValue('Bob');
    // Escape backs out of the edit, not the dialog: nothing saved.
    await page.keyboard.press('Escape');
    await expect(field).toBeHidden();
    await expect(friends).toBeVisible();
    await expect(rename).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Bob');
    await page.keyboard.press('Enter');
    await expect(
      friends.getByRole('button', { name: /^Rename Bob, latest link Today/ }),
    ).toBeFocused();
    await expect(friends.getByRole('status')).toHaveText("Renamed: you'll see them as Bob.");
    await expect(friendRows(friends)).toContainText('Their latest link says Rude Name');

    // Back in History, on Friends, the race already under the new name.
    await page.keyboard.press('Escape');
    await expect(historyDialog(page).getByRole('button', { name: 'Friends' })).toBeFocused();
    await expect(historyRows(page).first()).toContainText('vs Bob 3:20');
    await expect(historyDialog(page)).not.toContainText('Rude Name');

    // Kept through a reload, which reopens the solved game.
    await page.reload();
    await expect(grid(page)).toBeVisible();
    await openHeaderDialog(page, 'History');
    await expect(historyRows(page).first()).toContainText('vs Bob 3:20');
    await page.keyboard.press('Escape');

    // A later link from the same browser, calling itself something else.
    await openTheirLink(page, NEARLY_DONE_2, { seconds: 300, name: 'Ruder' });
    await expect(boardArea(page)).toContainText(
      'Bob solved this Easy puzzle in 5:00. Can you beat it?',
    );
    await expect(boardArea(page)).not.toContainText('Ruder');
    solved = await race(page, NEARLY_DONE_2);
    await expect(solved.getByRole('columnheader').nth(1)).toHaveText('Bob');
    await expect(solved.locator('.comparison__verdict')).toHaveText(
      /^You were \d:\d\d faster than Bob!$/,
    );
    await page.keyboard.press('Escape');

    // Both races under it, and still one friend, by the name given, their
    // latest link's name beside it.
    await openHeaderDialog(page, 'History');
    await expect(historyRows(page).filter({ hasText: 'vs Bob' })).toHaveCount(2);
    await historyDialog(page).getByRole('button', { name: 'Friends' }).click();
    friends = page.getByRole('dialog', { name: 'Friends' });
    await expect(friendRows(friends)).toHaveCount(1);
    await expect(friendRows(friends)).toContainText('Bob');
    await expect(friendRows(friends)).toContainText('Their latest link says Ruder');
  });
});
