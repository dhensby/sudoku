import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  NEARLY_DONE,
  NEARLY_DONE_2,
  answerWhoSent,
  boardArea,
  copiedText,
  elsewhere,
  gotoPuzzle,
  grid,
  openFriends,
  openHeaderDialog,
  solveFromKeyboard,
  startButton,
  startPuzzle,
  stubClipboard,
  waitForPlaying,
  whoSentDialog,
  type LinkChallenge,
} from './helpers';
import type { Puzzle } from '../src/core';

/**
 * Friends, end to end: a link with a time carries its sender's player ID,
 * and every link opened with one is noted; Friends, at the foot of History,
 * lists them, and the name given someone there is the one shown on every race
 * of theirs — whatever their links call them, past races and later ones
 * alike, through a reload. The first link from someone new asks who sent it
 * before anything else, the name it gives ready to keep or type over — or
 * says it is a friend already known, on another device, and the two are
 * one; Friends splits them apart again, and merges them back. History's
 * export carries the names given to another browser, whose import names
 * the races it brings by them.
 *
 * Runs on Chromium (desktop layout).
 */

/** A sending browser's ID, as its links carry it (`u=`). */
const SENDER = 'k3x9q7za2m';

/** The same sender's other browser: a laptop, say, beside their phone. */
const SENDER_ELSEWHERE = 'p0d4wq81xe';

const historyDialog = (page: Page) => page.getByRole('dialog', { name: 'History' });

/** The rows of History's list — not the chips nested inside them. */
const historyRows = (page: Page) =>
  historyDialog(page).getByRole('list', { name: 'Games, newest first' }).locator(':scope > li');

/** Friends' rows — not the devices a merged friend's row lists. */
const friendRows = (friends: Locator) =>
  friends.getByRole('list', { name: 'Friends, latest first' }).locator(':scope > li');

/**
 * Open a link from SENDER (or another of theirs): behind its Ready card — and,
 * the first time, behind the question of who sent it before that.
 */
async function openTheirLink(
  page: Page,
  puzzle: Puzzle,
  challenge: LinkChallenge,
  playerId = SENDER,
): Promise<void> {
  await gotoPuzzle(page, puzzle.givens, { challenge: { ...challenge, playerId } });
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
    // Their first link, by the name it gives — who sent it, asked first, skipped.
    await openTheirLink(page, NEARLY_DONE, { seconds: 200, name: 'Rude Name' });
    await answerWhoSent(page);
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

    // A later link from the same browser, calling itself something else: no
    // question this time.
    await openTheirLink(page, NEARLY_DONE_2, { seconds: 300, name: 'Ruder' });
    await expect(whoSentDialog(page)).toHaveCount(0);
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

  test('the first link from someone new asks who sent it, the name it gives selected to type over, and Enter, Enter starts the race', async ({
    page,
  }) => {
    await page.clock.install();
    await openTheirLink(page, NEARLY_DONE, { seconds: 200, name: 'Rude Name' });
    const prompt = whoSentDialog(page);
    await expect(prompt).toBeVisible();
    await expect(prompt).toHaveAccessibleDescription(
      "It's the first link you've had from them. The name you give them here is the one you'll see on all their times, whatever their links say. You can change it any time in Friends, at the foot of History.",
    );
    // Before the card: nothing of the link behind it to read.
    await expect(boardArea(page)).not.toContainText('Rude Name');
    await expect(startButton(page)).toHaveCount(0);

    const field = prompt.getByRole('textbox', { name: 'Their name' });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Rude Name');
    await expect(field).toHaveAccessibleDescription(
      'Their link says “Rude Name”. Leave it empty to go by their links.',
    );
    // Selected whole, so typing replaces it.
    expect(
      await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    ).toEqual([0, 9]);

    // Ten seconds thinking it over, which no clock counts.
    await page.clock.fastForward('00:10');
    await page.keyboard.type('Bob');
    await page.keyboard.press('Enter');
    await expect(prompt).toBeHidden();
    await expect(boardArea(page)).toContainText(
      'Bob solved this Easy puzzle in 3:20. Can you beat it?',
    );
    await expect(startButton(page)).toBeFocused();
    await expect(page.getByRole('banner').locator('.timer__time')).toHaveText('0:00');

    // Enter again: the race is on, and the clock with it.
    await page.keyboard.press('Enter');
    await waitForPlaying(page);
    await page.clock.fastForward('00:05');
    await expect(page.getByRole('banner').locator('.timer__time')).toHaveText('0:05');

    // Named as saved, the link's own name beside it.
    const friends = await openFriends(page);
    await expect(friendRows(friends)).toHaveCount(1);
    await expect(friendRows(friends)).toContainText('Bob');
    await expect(friendRows(friends)).toContainText('Their latest link says Rude Name');
  });

  test("a real sharer's links carry one ID, and the first asks who sent it with their name filled in", async ({
    page,
    browser,
  }) => {
    await stubClipboard(page);
    await page.clock.install();
    // Two times shared as Alice, from one browser.
    const links: URL[] = [];
    for (const puzzle of [NEARLY_DONE, NEARLY_DONE_2]) {
      await startPuzzle(page, puzzle);
      await page.clock.fastForward('00:12');
      await solveFromKeyboard(page, puzzle);
      await page
        .getByRole('dialog', { name: 'Solved!' })
        .getByRole('button', { name: 'Share your time' })
        .click();
      const share = page.getByRole('dialog', { name: 'Share your time' });
      await share.getByRole('textbox', { name: 'Your name (optional)' }).fill('Alice');
      await share.getByRole('button', { name: 'Copy', exact: true }).click();
      await expect(share.getByRole('status')).toHaveText('Copied to clipboard');
      links.push(new URL((await copiedText(page)).at(-1)!.split('\n').at(-1)!));
    }
    const [first, second] = links.map((link) => link.searchParams.get('u'));
    expect(first).toMatch(/^[0-9a-z]{10}$/);
    expect(second).toBe(first);

    await elsewhere(browser, async (friend) => {
      await friend.goto(links[0].href);
      await expect(whoSentDialog(friend).getByRole('textbox', { name: 'Their name' })).toHaveValue(
        'Alice',
      );
      await answerWhoSent(friend, { name: 'Ally' });
      await expect(boardArea(friend)).toContainText(/Ally solved this Easy puzzle in 0:1\d\./);

      // Their second link asks nothing, and goes by the name given.
      await friend.goto(links[1].href);
      await expect(boardArea(friend)).toContainText(/Ally solved this Easy puzzle in 0:1\d\./);
      await expect(whoSentDialog(friend)).toHaveCount(0);
    });
  });

  test("one sender's two devices: taken for one at the prompt, split off and merged again in Friends, every race following through a reload", async ({
    page,
  }) => {
    await page.clock.install();
    // The first device's first link, named at the prompt as its link names them.
    await openTheirLink(page, NEARLY_DONE, { seconds: 200, name: 'Alice' });
    await answerWhoSent(page, { name: 'Alice' });
    let solved = await race(page, NEARLY_DONE);
    await page.keyboard.press('Escape');
    await expect(solved).toBeHidden();

    // A link from their other device, by another name: someone new to this
    // browser, so asked about — and it is Alice, on another device.
    await openTheirLink(page, NEARLY_DONE_2, { seconds: 300, name: 'Al' }, SENDER_ELSEWHERE);
    const choice = whoSentDialog(page).getByRole('combobox', {
      name: 'Or is it a friend you have already, on another device?',
    });
    // Never chosen for the player.
    await expect(choice).toHaveValue('');
    await answerWhoSent(page, { sameAs: SENDER });
    await expect(boardArea(page)).toContainText(
      'Alice solved this Easy puzzle in 5:00. Can you beat it?',
    );
    await expect(startButton(page)).toBeFocused();
    solved = await race(page, NEARLY_DONE_2);
    await expect(solved.getByRole('columnheader').nth(1)).toHaveText('Alice');
    await page.keyboard.press('Escape');

    // Both races under the one name, from one friend on two devices.
    await openHeaderDialog(page, 'History');
    await expect(historyRows(page).filter({ hasText: 'vs Alice' })).toHaveCount(2);
    await historyDialog(page).getByRole('button', { name: 'Friends' }).click();
    let friends = page.getByRole('dialog', { name: 'Friends' });
    await expect(friendRows(friends)).toHaveCount(1);
    await expect(friendRows(friends)).toContainText('2 devices');
    await expect(friends.getByRole('list', { name: /^Devices, Alice,/ })).toContainText(
      /Alice · latest link Today .*Al · latest link Today /,
    );

    // Not the same after all: Al split off, a friend of their own, focus on
    // their Rename, and their race back under their link's name.
    await friends
      .getByRole('button', { name: /^Split off Al, latest link Today \d\d:\d\d, from Alice$/ })
      .click();
    await expect(
      friends.getByRole('button', { name: /^Rename Al, latest link Today/ }),
    ).toBeFocused();
    await expect(friends.getByRole('status')).toHaveText('Split off: a friend of their own now.');
    await expect(friendRows(friends)).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(historyRows(page).filter({ hasText: 'vs Al 5:00' })).toHaveCount(1);
    await expect(historyRows(page).filter({ hasText: 'vs Alice 3:20' })).toHaveCount(1);

    // The same after all: merged back from the keyboard, Alice chosen for them.
    await historyDialog(page).getByRole('button', { name: 'Friends' }).click();
    friends = page.getByRole('dialog', { name: 'Friends' });
    await friends
      .getByRole('button', { name: /^Merge Al, latest link Today .* with another friend$/ })
      .click();
    const picker = friends.getByRole('combobox', { name: 'Same person as' });
    await expect(picker).toBeFocused();
    await expect(picker).toHaveValue(SENDER);
    // Escape backs out of the merge, not the dialog.
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    const merge = friends.getByRole('button', { name: /^Merge Al,/ });
    await expect(merge).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(picker).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(friends.getByRole('button', { name: /^Confirm merge, Al,/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(friends.getByRole('button', { name: /^Rename Alice,/ })).toBeFocused();
    await expect(friends.getByRole('status')).toHaveText('Merged into one friend, on 2 devices.');
    await expect(friendRows(friends)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(historyRows(page).filter({ hasText: 'vs Alice' })).toHaveCount(2);
    await page.keyboard.press('Escape');

    // Kept through a reload.
    await page.reload();
    await expect(grid(page)).toBeVisible();
    await openHeaderDialog(page, 'History');
    await expect(historyRows(page).filter({ hasText: 'vs Alice' })).toHaveCount(2);
    await historyDialog(page).getByRole('button', { name: 'Friends' }).click();
    friends = page.getByRole('dialog', { name: 'Friends' });
    await expect(friendRows(friends)).toHaveCount(1);
    await expect(friendRows(friends)).toContainText('2 devices');
  });

  test("a name given goes with History's export, naming the race in the browser that imports it, whose next link from them asks nothing", async ({
    page,
    browser,
  }, testInfo) => {
    await page.clock.install();
    await openTheirLink(page, NEARLY_DONE, { seconds: 200, name: 'Rude Name' });
    await answerWhoSent(page, { name: 'Bob' });
    const solved = await race(page, NEARLY_DONE);
    await page.keyboard.press('Escape');
    await expect(solved).toBeHidden();
    await openHeaderDialog(page, 'History');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      historyDialog(page).getByRole('button', { name: 'Export' }).click(),
    ]);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);

    await elsewhere(browser, async (other) => {
      await other.goto('/');
      await waitForPlaying(other);
      await openHeaderDialog(other, 'History');
      // No one here has sent a time yet.
      await expect(historyDialog(other).getByRole('button', { name: 'Friends' })).toHaveCount(0);
      const [chooser] = await Promise.all([
        other.waitForEvent('filechooser'),
        historyDialog(other).getByRole('button', { name: 'Import' }).click(),
      ]);
      await chooser.setFiles(file);
      await expect(historyDialog(other).getByRole('status')).toHaveText(
        'Imported 1 new game, updated 0.',
      );
      await expect(historyRows(other).filter({ hasText: 'vs Bob 3:20' })).toHaveCount(1);
      await expect(historyDialog(other)).not.toContainText('Rude Name');
      await historyDialog(other).getByRole('button', { name: 'Friends' }).click();
      const friends = other.getByRole('dialog', { name: 'Friends' });
      await expect(friendRows(friends)).toHaveCount(1);
      await expect(friendRows(friends)).toContainText('Bob');

      // Known here now: their next link asks nothing, and goes by the name given.
      await openTheirLink(other, NEARLY_DONE_2, { seconds: 300, name: 'Ruder' });
      await expect(whoSentDialog(other)).toHaveCount(0);
      await expect(boardArea(other)).toContainText(
        'Bob solved this Easy puzzle in 5:00. Can you beat it?',
      );
    });
  });
});
