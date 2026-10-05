import { expect, test, type Page } from '@playwright/test';
import { encodeGivens } from '../src/core';
import {
  NEARLY_DONE,
  PUZZLES,
  boardArea,
  cell,
  cells,
  copiedText,
  emptyCells,
  gotoPuzzle,
  openHeaderDialog,
  puzzleLink,
  readBoard,
  readTimer,
  resumeButton,
  solveFromKeyboard,
  startButton,
  startPuzzle,
  stubClipboard,
  timer,
  typeDigits,
  waitForPlaying,
} from './helpers';

/**
 * Sharing and racing, end to end. A link carries the puzzle itself (and the
 * sharer's time, name and help), so whoever opens it — in a browser that has
 * never seen the game — gets exactly that puzzle behind a Ready card, and
 * sees how their time compares once they solve it. Links are tidied out of
 * the address bar once read; broken ones say so; a link to a puzzle already
 * solved here offers a fresh attempt instead.
 *
 * "Somewhere else" is a fresh browser context: no storage, no history. The
 * clipboard and the share sheet are stubbed (see helpers), and what the app
 * wrote is read back from the stub.
 *
 * Runs on Chromium (desktop layout).
 */

/** The share parameters have been read and removed from the address bar. */
async function expectLinkConsumed(page: Page): Promise<void> {
  await expect.poll(() => new URL(page.url()).search).toBe('');
}

/** Solve a puzzle opened from a link and return the completion dialog. */
async function solveAndComplete(page: Page) {
  await solveFromKeyboard(page, NEARLY_DONE);
  const dialog = page.getByRole('dialog', { name: 'Solved!' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('opening a link', () => {
  test('a result link shows the Ready card with the challenger, and Start begins', async ({
    page,
  }) => {
    await page.clock.install();
    const hard = PUZZLES.hard;
    await gotoPuzzle(page, hard.givens, {
      challenge: { seconds: 323, name: 'Dan', assists: 'ch2' },
    });

    const area = boardArea(page);
    await expect(area.getByRole('heading', { name: 'Ready?' })).toBeVisible();
    await expect(area).toContainText('Dan solved this Hard puzzle in 5:23. Can you beat it?');
    await expect(area).toContainText('With auto candidates, 2 hints.');
    await expect(area).toContainText('The timer starts when you do.');
    await expectLinkConsumed(page);
    // The tier is the puzzle's own, re-graded on arrival.
    await expect(page.getByRole('banner')).toContainText('Difficulty: Hard');

    // Nothing to see, and no clock running, until Start.
    await expect(cells(page)).toHaveCount(0);
    await expect(timer(page)).toHaveAccessibleName('Start');
    await page.clock.fastForward('01:00');
    expect(await readTimer(page)).toBe('0:00');
    await expect(startButton(page)).toBeFocused();

    await startButton(page).click();
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(hard.givens);
    await page.clock.fastForward('00:03');
    await expect.poll(() => readTimer(page)).toMatch(/^0:0[3-9]$/);
  });

  test('a reload before Start, or a second click on the link, keeps the Ready card', async ({
    page,
  }) => {
    const hard = PUZZLES.hard;
    const challenge = { seconds: 323, name: 'Dan' };
    const area = boardArea(page);
    const expectReady = async () => {
      await expect(area.getByRole('heading', { name: 'Ready?' })).toBeVisible();
      await expect(area).toContainText('Dan solved this Hard puzzle in 5:23. Can you beat it?');
      await expect(cells(page)).toHaveCount(0);
      await expect(timer(page)).toHaveAccessibleName('Start');
      expect(await readTimer(page)).toBe('0:00');
    };
    await gotoPuzzle(page, hard.givens, { challenge });
    await expectReady();
    await expectLinkConsumed(page);

    // A phone reloading a tab in the background, say.
    await page.reload();
    await expectReady();

    // Tapping the link in the chat again.
    await gotoPuzzle(page, hard.givens, { challenge });
    await expectReady();
    await startButton(page).click();
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(hard.givens);
  });

  test('a link without a result just offers the puzzle', async ({ page }) => {
    await gotoPuzzle(page, PUZZLES.medium.givens);
    await expect(boardArea(page)).toContainText('Someone shared a Medium puzzle with you.');
    await expectLinkConsumed(page);
    await startButton(page).click();
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(PUZZLES.medium.givens);
  });

  test('a link that is not a puzzle says so, and a fresh one is made instead', async ({ page }) => {
    await page.goto('/?p=not-a-puzzle!');
    await waitForPlaying(page);
    const notice = page.locator('.hint-bar');
    await expect(notice).toContainText(
      "That puzzle link doesn't work — here's a fresh puzzle instead.",
    );
    await expectLinkConsumed(page);
    await expect(page.getByRole('banner')).toContainText('Difficulty: Easy');

    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveText('');
  });

  test('a link that decodes to a broken grid is refused too', async ({ page }) => {
    // Two 5s in one row: a code the codec reads, but no puzzle.
    const givens = PUZZLES.easy.givens;
    const blank = givens.indexOf('0');
    const rowStart = blank - (blank % 9);
    const clash = [...givens.slice(rowStart, rowStart + 9)].find((ch) => ch !== '0')!;
    const broken = givens.slice(0, blank) + clash + givens.slice(blank + 1);
    await page.goto(`/?p=${encodeGivens(broken)}`);
    await waitForPlaying(page);
    await expect(page.locator('.hint-bar')).toContainText("That puzzle link doesn't work");
    expect(await readBoard(page)).not.toBe(broken);
  });

  test('a link to a game in progress here picks it up where it was left', async ({ page }) => {
    const easy = PUZZLES.easy;
    await startPuzzle(page, easy);
    const target = emptyCells(easy.givens)[0];
    await typeDigits(page, [{ index: target, digit: Number(easy.solution[target]) }]);
    const board = await readBoard(page);

    await page.goto(puzzleLink(easy.givens, { seconds: 200, name: 'Dan' }));
    await expect(resumeButton(page)).toBeVisible();
    await expectLinkConsumed(page);
    await resumeButton(page).click();
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(board);
    await expect(cell(page, target)).toHaveAccessibleName(easy.solution[target]);
  });

  test('a link to a puzzle already solved here offers to play it again', async ({ page }) => {
    await startPuzzle(page, NEARLY_DONE);
    const done = await solveAndComplete(page);
    const time = await readTimer(page);
    await done.getByRole('button', { name: 'Close' }).click();

    await page.goto(puzzleLink(NEARLY_DONE.givens, { seconds: 90, name: 'Dan' }));
    const offer = page.getByRole('dialog', { name: "You've solved this one" });
    await expect(offer).toBeVisible();
    await expect(offer).toContainText(
      new RegExp(`You solved this Easy puzzle in ${time} today at \\d\\d:\\d\\d\\.`),
    );
    await expect(offer.getByRole('region', { name: 'Head to head' })).toContainText(
      /You were 1:[23]\d faster than Dan!/,
    );
    await expectLinkConsumed(page);

    // Closing keeps the game that was on screen: the solved one.
    await offer.getByRole('button', { name: 'Close' }).first().click();
    await expect(offer).toBeHidden();
    expect(await readBoard(page)).toBe(NEARLY_DONE.solution);

    // Play again is a fresh attempt at the same puzzle, under way at once.
    await page.goto(puzzleLink(NEARLY_DONE.givens));
    await offer.getByRole('button', { name: 'Play again' }).click();
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(NEARLY_DONE.givens);
  });

  test('a link to a puzzle solved again compares with the time that counted, not the replay’s', async ({
    page,
  }) => {
    await page.clock.install();
    await startPuzzle(page, NEARLY_DONE);
    await page.clock.fastForward('00:30');
    const done = await solveAndComplete(page);
    const counted = await readTimer(page);
    await done.getByRole('button', { name: 'Close' }).click();

    // Played again from memory, in no time at all.
    await page.goto(puzzleLink(NEARLY_DONE.givens));
    await page
      .getByRole('dialog', { name: "You've solved this one" })
      .getByRole('button', { name: 'Play again' })
      .click();
    await waitForPlaying(page);
    await (await solveAndComplete(page)).getByRole('button', { name: 'Close' }).click();

    await page.goto(puzzleLink(NEARLY_DONE.givens, { seconds: 20, name: 'Zed' }));
    const offer = page.getByRole('dialog', { name: "You've solved this one" });
    await expect(offer).toContainText(`You solved this Easy puzzle in ${counted}`);
    await expect(offer.getByRole('region', { name: 'Head to head' })).toContainText(
      /Zed was 0:1\d faster\./,
    );
  });
});

test.describe('racing a time', () => {
  test('beating the challenger says by how much', async ({ page }) => {
    await page.clock.install();
    await startPuzzle(page, NEARLY_DONE, { challenge: { seconds: 600, name: 'Dan' } });
    await page.clock.fastForward('00:05');
    const dialog = await solveAndComplete(page);
    const versus = dialog.getByRole('region', { name: 'Head to head' });
    await expect(versus).toContainText('10:00');
    await expect(versus).toContainText(/You were 9:5\d faster than Dan!/);
  });

  test('losing to the challenger says so too', async ({ page }) => {
    await page.clock.install();
    await startPuzzle(page, NEARLY_DONE, { challenge: { seconds: 5 } });
    await page.clock.fastForward('00:40');
    const dialog = await solveAndComplete(page);
    // A link without a name races "your friend".
    await expect(dialog.getByRole('region', { name: 'Head to head' })).toContainText(
      /Your friend was 0:3\d faster\./,
    );
  });
});

test.describe('the share dialog', () => {
  test('Copy puts a link to the puzzle and the time on the clipboard, and it opens elsewhere', async ({
    page,
    browser,
  }) => {
    await stubClipboard(page);
    await page.clock.install();
    await startPuzzle(page, NEARLY_DONE);
    // Long enough to be a time worth sharing: a link's time is at least a second.
    await page.clock.fastForward('00:12');
    const done = await solveAndComplete(page);
    const time = await readTimer(page);
    await done.getByRole('button', { name: 'Share your time' }).click();

    const dialog = page.getByRole('dialog', { name: 'Share your time' });
    await dialog.getByRole('textbox', { name: 'Your name (optional)' }).fill('Alice');
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Copied to clipboard');

    const copied = await copiedText(page);
    expect(copied).toHaveLength(1);
    const lines = copied[0].split('\n');
    expect(lines[0]).toBe(`Sudoku · Easy · ${time}`);
    const link = new URL(lines.at(-1)!);
    expect(Object.fromEntries(link.searchParams)).toEqual({
      p: encodeGivens(NEARLY_DONE.givens),
      t: String(Number(time.split(':')[0]) * 60 + Number(time.split(':')[1])),
      n: 'Alice',
    });
    // The preview shows the same link.
    await expect(dialog).toContainText(link.href);

    // Somewhere else entirely: no storage, no history.
    const elsewhere = await browser.newContext();
    try {
      const other = await elsewhere.newPage();
      await other.goto(link.href);
      await expect(boardArea(other)).toContainText(
        `Alice solved this Easy puzzle in ${time}. Can you beat it?`,
      );
      await startButton(other).click();
      await waitForPlaying(other);
      expect(await readBoard(other)).toBe(NEARLY_DONE.givens);
    } finally {
      await elsewhere.close();
    }
  });

  test('mid-game, Share sends the puzzle alone', async ({ page, browser }) => {
    await stubClipboard(page);
    await startPuzzle(page, PUZZLES.hard);
    await openHeaderDialog(page, 'Share');
    const dialog = page.getByRole('dialog', { name: 'Share this puzzle' });
    // No time to put a name beside.
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Copied to clipboard');

    const [message] = await copiedText(page);
    expect(message.split('\n')[0]).toBe('Try this Hard Sudoku!');
    const link = new URL(message.split('\n').at(-1)!);
    expect([...link.searchParams.keys()]).toEqual(['p']);

    const elsewhere = await browser.newContext();
    try {
      const other = await elsewhere.newPage();
      await other.goto(link.href);
      await expect(boardArea(other)).toContainText('Someone shared a Hard puzzle with you.');
      await startButton(other).click();
      await waitForPlaying(other);
      expect(await readBoard(other)).toBe(PUZZLES.hard.givens);
    } finally {
      await elsewhere.close();
    }
  });

  test('where the browser has a share sheet, Share… hands it the message and link', async ({
    page,
  }) => {
    await stubClipboard(page, { share: true });
    await startPuzzle(page, PUZZLES.hard);
    await openHeaderDialog(page, 'Share');
    const dialog = page.getByRole('dialog', { name: 'Share this puzzle' });
    await expect(dialog.getByRole('button', { name: 'Share…' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Share…' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Shared');
    const shared = await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared);
    expect(shared).toEqual([
      {
        title: 'Sudoku',
        text: 'Try this Hard Sudoku!',
        url: `${new URL(page.url()).origin}/?p=${encodeGivens(PUZZLES.hard.givens)}`,
      },
    ]);
  });

  test('when the clipboard refuses, the message is shown selected to copy by hand', async ({
    page,
  }) => {
    await stubClipboard(page, { clipboard: 'fails' });
    await startPuzzle(page, PUZZLES.hard);
    await openHeaderDialog(page, 'Share');
    const dialog = page.getByRole('dialog', { name: 'Share this puzzle' });
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText("Couldn't copy automatically.");

    const box = dialog.getByRole('textbox', { name: 'Message and link' });
    await expect(box).toBeFocused();
    const selection = await box.evaluate((el: HTMLTextAreaElement) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
      length: el.value.length,
    }));
    expect(selection).toEqual({ start: 0, end: selection.length, length: selection.length });
    await expect(box).toHaveValue(/^Try this Hard Sudoku!\nhttp/);
  });
});
