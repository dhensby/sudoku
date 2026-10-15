import { expect, test, type Locator, type Page } from '@playwright/test';
import { encodeGivens } from '../src/core';
import {
  PUZZLES,
  boardArea,
  copiedText,
  elsewhere,
  enterGivens,
  enterStatus,
  openEnterPuzzle,
  openHeaderDialog,
  openYourPuzzles,
  readBoard,
  resumeButton,
  seedPuzzles,
  settle,
  solutionOf,
  startButton,
  stubClipboard,
  waitForPlaying,
} from './helpers';

/**
 * Enter a puzzle: a puzzle from the paper typed in from New game's Your
 * puzzles, or pasted in, checked as it goes in, then played and shared like
 * any other — a Hard typed in plays as the Hard it is, and its link opens it
 * elsewhere as a friend's would, shared from its Start card or from the
 * editor without a game of it — and kept in Your puzzles, finished or not,
 * named as it is typed in or there, to edit, play, share or delete there,
 * and to carry to another browser in History's export. Everything in the
 * editor is found through its dialog: the board and the pad behind it stay
 * on the page.
 *
 * Runs on Chromium (desktop layout).
 */

const HARD = PUZZLES.hard;

/** Open the game on a puzzle of its own, as it opens for anyone. */
async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await waitForPlaying(page);
}

/** What the editor's grid holds, '0' for an empty cell, read from its cells' names. */
async function typedIn(editor: Locator): Promise<string> {
  return editor
    .getByRole('gridcell')
    .evaluateAll((cells) =>
      cells
        .map((cell) => /^(\d), given/.exec(cell.getAttribute('aria-label')!)?.[1] ?? '0')
        .join(''),
    );
}

/** `givens` as a page prints them: nine lines, the boxes spaced, a dot for a blank. */
function printed(givens: string): string {
  return givens
    .replaceAll('0', '.')
    .match(/.{9}/g)!
    .map((row) => row.match(/.{3}/g)!.join(' '))
    .join('\n');
}

/**
 * Paste `text` on the focused cell as Ctrl or Cmd+V would: dispatched, for
 * the real clipboard is shared between test workers (and the developer).
 */
async function pasteOnGrid(page: Page, text: string): Promise<void> {
  await page.evaluate((copied) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', copied);
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
  }, text);
}

test('types a Hard in, and plays it from its Start card as the Hard it is', async ({ page }) => {
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  await expect(editor.getByRole('gridcell').first()).toBeFocused();
  await expect(enterStatus(editor)).toHaveText('Type in the numbers from your puzzle.');
  await enterGivens(editor, HARD.givens);
  await expect(enterStatus(editor)).toHaveText('One solution: a Hard puzzle.');
  await expect(editor.getByRole('gridcell', { name: /conflict/ })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Play' }).click();

  await expect(editor).toBeHidden();
  await expect(boardArea(page)).toContainText('Your Hard puzzle is ready.');
  await expect(boardArea(page)).toContainText('The timer starts when you do.');
  await expect(startButton(page)).toBeFocused();
  await startButton(page).click();
  await waitForPlaying(page);
  await expect(page.getByRole('banner')).toContainText('Difficulty: Hard');
  expect(await readBoard(page)).toBe(HARD.givens);
});

test('shares it from its Start card as the puzzle alone, which opens the same elsewhere', async ({
  page,
  browser,
}) => {
  await stubClipboard(page);
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  await enterGivens(editor, HARD.givens);
  await editor.getByRole('button', { name: 'Play' }).click();
  await expect(startButton(page)).toBeVisible();

  await openHeaderDialog(page, 'Share');
  const share = page.getByRole('dialog', { name: 'Share this puzzle' });
  await share.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(share.getByRole('status')).toHaveText('Copied to clipboard');
  const [message] = await copiedText(page);
  expect(message.split('\n')[0]).toBe('Try this Hard Sudoku!');
  const link = new URL(message.split('\n').at(-1)!);
  expect([...link.searchParams.keys()]).toEqual(['p']);
  expect(link.searchParams.get('p')).toBe(encodeGivens(HARD.givens));
  // Sharing starts nothing: it still waits for Start.
  await share.getByRole('button', { name: 'Close' }).click();
  await expect(boardArea(page)).toContainText('Your Hard puzzle is ready.');

  const elsewhere = await browser.newContext();
  try {
    const other = await elsewhere.newPage();
    await other.goto(link.href);
    await expect(boardArea(other)).toContainText('Someone shared a Hard puzzle with you.');
    await startButton(other).click();
    await waitForPlaying(other);
    expect(await readBoard(other)).toBe(HARD.givens);
  } finally {
    await elsewhere.close();
  }
});

test('shares it from the editor as the puzzle alone, starting nothing, and its link opens the same board elsewhere', async ({
  page,
  browser,
}) => {
  await stubClipboard(page);
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  const shareButton = editor.getByRole('button', { name: 'Share…' });
  await expect(shareButton).toHaveAttribute('aria-disabled', 'true');
  await enterGivens(editor, HARD.givens);
  await expect(shareButton).not.toHaveAttribute('aria-disabled');
  await shareButton.click();

  const share = page.getByRole('dialog', { name: 'Share this puzzle' });
  await share.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(share.getByRole('status')).toHaveText('Copied to clipboard');
  const [message] = await copiedText(page);
  expect(message.split('\n')[0]).toBe('Try this Hard Sudoku!');
  const link = new URL(message.split('\n').at(-1)!);
  expect([...link.searchParams.keys()]).toEqual(['p']);
  expect(link.searchParams.get('p')).toBe(encodeGivens(HARD.givens));
  await page.keyboard.press('Escape');

  // Back in the editor on the same grid, kept as it was shared, focus on Share….
  const again = page.getByRole('dialog', { name: 'Enter a puzzle' });
  await expect(again.getByRole('button', { name: 'Share…' })).toBeFocused();
  await expect(again.getByRole('button', { name: 'Saved' })).toBeVisible();
  expect(await typedIn(again)).toBe(HARD.givens);
  // Nothing was started: Escape twice, and the game behind carries on.
  await page.keyboard.press('Escape');
  const library = page.getByRole('dialog', { name: 'Your puzzles' });
  await expect(library.getByRole('listitem')).toHaveText([/One solution: a Hard puzzle\./]);
  await page.keyboard.press('Escape');
  await expect(library).toBeHidden();
  await waitForPlaying(page);
  expect(await readBoard(page)).not.toBe(HARD.givens);

  await elsewhere(browser, async (other) => {
    await other.goto(link.href);
    await expect(boardArea(other)).toContainText('Someone shared a Hard puzzle with you.');
    await startButton(other).click();
    await waitForPlaying(other);
    expect(await readBoard(other)).toBe(HARD.givens);
  });
});

test('names a puzzle as it is typed in: the name on its link, in Name back from Share, and on its row', async ({
  page,
}) => {
  await stubClipboard(page);
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  await expect(editor.getByRole('gridcell').first()).toBeFocused();
  // Name sits in the header, before Close: two stops back from the grid.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  const name = editor.getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await page.keyboard.type('The Times #5,123');
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('gridcell').first()).toBeFocused();
  await page.keyboard.type(HARD.givens);
  expect(await typedIn(editor)).toBe(HARD.givens);
  // With a mouse, Name makes the header 8px taller than the close button
  // alone would: the board still fits, with nothing to scroll. Measured once
  // the card has risen into place: the keys can all be typed before it has.
  await settle(page);
  expect((await name.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const body = editor.locator('.dialog__body');
  expect(await body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);

  await editor.getByRole('button', { name: 'Share…' }).click();
  const share = page.getByRole('dialog', { name: 'Share this puzzle' });
  await share.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(share.getByRole('status')).toHaveText('Copied to clipboard');
  const [message] = await copiedText(page);
  const lines = message.split('\n');
  expect(lines.slice(0, 2)).toEqual(['Try this Hard Sudoku!', 'The Times #5,123']);
  expect(new URL(lines.at(-1)!).searchParams.get('l')).toBe('The Times #5,123');
  await page.keyboard.press('Escape');

  // Back in the editor, Name on the name as kept.
  const again = page.getByRole('dialog', { name: 'Enter a puzzle' });
  await expect(again.getByRole('textbox', { name: 'Name' })).toHaveValue('The Times #5,123');
  await expect(again.getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.keyboard.press('Escape');
  const library = page.getByRole('dialog', { name: 'Your puzzles' });
  await expect(library.locator('bdi')).toHaveText(['The Times #5,123']);
  await expect(library.getByRole('button', { name: /^Edit The Times #5,123, from/ })).toBeFocused();
});

test('names a clash, and more than one solution, and keeps Play and Share… unavailable', async ({
  page,
}) => {
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  const play = editor.getByRole('button', { name: 'Play' });
  const share = editor.getByRole('button', { name: 'Share…' });
  await expect(play).toHaveAttribute('aria-disabled', 'true');

  // Two 5s in row 1, dotted both.
  await enterGivens(editor, '5005');
  await expect(enterStatus(editor)).toHaveText('Two 5s in row 1.');
  await expect(editor.getByRole('gridcell', { name: '5, given, conflict' })).toHaveCount(2);
  await expect(play).toHaveAttribute('aria-disabled', 'true');

  // A solved grid with its top two rows left blank: they can swap wholesale.
  const solution = solutionOf(HARD.givens);
  await enterGivens(editor, '0'.repeat(18) + solution.slice(18));
  await expect(enterStatus(editor)).toHaveText('More than one solution so far.');
  await expect(play).toHaveAttribute('aria-disabled', 'true');
  await expect(share).toHaveAttribute('aria-disabled', 'true');
  await share.focus();
  await expect(share).toHaveAccessibleDescription('More than one solution so far.');
  await page.keyboard.press('Enter');
  await expect(share).toBeFocused();
  // Focused, it says why; pressed, it does nothing.
  await play.focus();
  await expect(play).toHaveAccessibleDescription('More than one solution so far.');
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await expect(play).toBeFocused();

  // Escape goes back to Your puzzles, the grid kept; Escape again, and the game behind carries on.
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  const library = page.getByRole('dialog', { name: 'Your puzzles' });
  await expect(library.getByRole('listitem')).toHaveText([/More than one solution so far\./]);
  await page.keyboard.press('Escape');
  await expect(library).toBeHidden();
  await waitForPlaying(page);
});

test('pastes a puzzle in on the grid, as Ctrl or Cmd+V does, and says when there is none', async ({
  page,
}) => {
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  await enterGivens(editor, '53');
  await pasteOnGrid(page, 'Sudoku, by the paper');
  await expect(enterStatus(editor)).toHaveText('No puzzle in what you copied.');
  expect(await typedIn(editor)).toBe('53'.padEnd(81, '0'));

  // In place of what was typed, the selection where it was, and played as any typed in.
  await pasteOnGrid(page, printed(HARD.givens));
  await expect(enterStatus(editor)).toHaveText('One solution: a Hard puzzle.');
  expect(await typedIn(editor)).toBe(HARD.givens);
  await expect(editor.getByRole('gridcell').nth(2)).toBeFocused();
  await editor.getByRole('button', { name: 'Play' }).click();
  await expect(boardArea(page)).toContainText('Your Hard puzzle is ready.');
  await startButton(page).click();
  await waitForPlaying(page);
  expect(await readBoard(page)).toBe(HARD.givens);
});

test('pastes a puzzle in from Paste, focus staying on the grid', async ({ page }) => {
  await stubClipboard(page, { pasted: printed(HARD.givens) });
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  await editor.getByRole('button', { name: 'Paste' }).click();
  await expect(enterStatus(editor)).toHaveText('One solution: a Hard puzzle.');
  expect(await typedIn(editor)).toBe(HARD.givens);
  await expect(editor.getByRole('gridcell').first()).toBeFocused();
});

test('says when the clipboard cannot be read, the grid as it was', async ({ page }) => {
  await stubClipboard(page, { pasted: 'fails' });
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  await enterGivens(editor, '53');
  await editor.getByRole('button', { name: 'Paste' }).click();
  await expect(enterStatus(editor)).toHaveText("Couldn't read the clipboard.");
  expect(await typedIn(editor)).toBe('53'.padEnd(81, '0'));
  // A number in, and the line says what the numbers make again.
  await page.keyboard.type('7');
  await expect(enterStatus(editor)).toHaveText('A puzzle needs at least 17 numbers.');
});

test('keeps a puzzle half typed in, to finish another time and play from where it was left', async ({
  page,
}) => {
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  const half = HARD.givens.slice(0, 36);
  expect([...half].filter((ch) => ch !== '0').length).toBeLessThan(17);
  await enterGivens(editor, half);
  const save = editor.getByRole('button', { name: 'Save' });
  await save.click();
  await expect(editor.getByRole('button', { name: 'Saved' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // Saving stays in the editor, focus on the grid to type on.
  await expect(editor.getByRole('gridcell').nth(half.length)).toBeFocused();
  await editor.getByRole('button', { name: 'Close' }).click();

  const library = page.getByRole('dialog', { name: 'Your puzzles' });
  const row = library.getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Untitled puzzle');
  await expect(row).toContainText('A puzzle needs at least 17 numbers.');
  await expect(row.getByRole('button', { name: /^Play/ })).toHaveCount(0);
  await row.getByRole('button', { name: /^Edit untitled puzzle from Today/ }).click();

  // Back in the editor on the numbers kept, just after the last of them.
  const again = page.getByRole('dialog', { name: 'Enter a puzzle' });
  const resume = half.replace(/0+$/, '').length;
  await expect(again.getByRole('gridcell').nth(resume)).toBeFocused();
  await expect(again.getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.keyboard.type(HARD.givens.slice(resume));
  await expect(enterStatus(again)).toHaveText('One solution: a Hard puzzle.');
  await again.getByRole('button', { name: 'Play' }).click();
  await expect(boardArea(page)).toContainText('Your Hard puzzle is ready.');

  // Kept as Play started it: one row still, ready to play from the list.
  const list = await openYourPuzzles(page);
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('listitem')).toContainText('One solution: a Hard puzzle.');
  // Played from its row, it is the attempt waiting behind its card, begun.
  await list.getByRole('button', { name: /^Play untitled puzzle/ }).click();
  await expect(list).toBeHidden();
  await waitForPlaying(page);
  expect(await readBoard(page)).toBe(HARD.givens);
});

test('keeps a grid as the editor closes, back on its row, and Escape twice to the game', async ({
  page,
}) => {
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  await enterGivens(editor, '53');
  await page.keyboard.press('Escape');
  const library = page.getByRole('dialog', { name: 'Your puzzles' });
  await expect(library.getByRole('button', { name: /^Edit untitled puzzle/ })).toBeFocused();
  // Closed untouched, a new grid leaves nothing behind.
  await library.getByRole('button', { name: 'Enter a new puzzle' }).click();
  await page
    .getByRole('dialog', { name: 'Enter a puzzle' })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(library.getByRole('listitem')).toHaveCount(1);
  await expect(library.getByRole('button', { name: 'Enter a new puzzle' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(library).toBeHidden();
  await waitForPlaying(page);
});

test.describe('kept already', () => {
  const at = Date.UTC(2026, 9, 1, 9);
  const kept = [
    { id: 'kept-0001', cells: HARD.givens, createdAt: at + 1, updatedAt: at + 1 },
    {
      id: 'kept-0002',
      cells: '55'.padEnd(81, '0'),
      title: 'Mistyped',
      createdAt: at,
      updatedAt: at,
    },
  ];

  test('names a puzzle, the name kept through a reload', async ({ page }) => {
    await seedPuzzles(page, kept);
    await openGame(page);
    let library = await openYourPuzzles(page);
    await library.getByRole('button', { name: /^Rename untitled puzzle/ }).click();
    const field = library.getByRole('textbox', { name: 'Name' });
    await expect(field).toBeFocused();
    await field.fill('The Times #5,123');
    await page.keyboard.press('Enter');
    await expect(
      library.getByRole('button', { name: /^Rename The Times #5,123, from/ }),
    ).toBeFocused();
    await expect(library.getByRole('listitem').first()).toContainText('The Times #5,123');

    // Reopened as it was left: paused, behind its card.
    await page.reload();
    await expect(resumeButton(page)).toBeVisible();
    library = await openYourPuzzles(page);
    await expect(library.locator('bdi')).toHaveText(['The Times #5,123', 'Mistyped']);
  });

  test('shares a puzzle from its row as the puzzle alone, focus back on its Share', async ({
    page,
  }) => {
    await stubClipboard(page);
    await seedPuzzles(page, kept);
    await openGame(page);
    const library = await openYourPuzzles(page);
    // Only a puzzle ready to play has one.
    await expect(library.getByRole('button', { name: /^Share Mistyped/ })).toHaveCount(0);
    const rowShare = library.getByRole('button', { name: /^Share untitled puzzle/ });
    await rowShare.click();
    const share = page.getByRole('dialog', { name: 'Share this puzzle' });
    await share.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(share.getByRole('status')).toHaveText('Copied to clipboard');
    const [message] = await copiedText(page);
    expect(message.split('\n')[0]).toBe('Try this Hard Sudoku!');
    const link = new URL(message.split('\n').at(-1)!);
    expect([...link.searchParams.keys()]).toEqual(['p']);
    expect(link.searchParams.get('p')).toBe(encodeGivens(HARD.givens));
    await share.getByRole('button', { name: 'Close' }).click();
    await expect(rowShare).toBeFocused();
    // Nothing was started: the game behind carries on as the list closes.
    await page.keyboard.press('Escape');
    await expect(library).toBeHidden();
    await waitForPlaying(page);
  });

  test('deletes a puzzle, asking first, and it stays deleted', async ({ page }) => {
    await seedPuzzles(page, kept);
    await openGame(page);
    let library = await openYourPuzzles(page);
    await library.getByRole('button', { name: /^Delete Mistyped/ }).click();
    const cancel = library.getByRole('button', { name: /^Cancel deleting Mistyped/ });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(library.getByRole('button', { name: /^Delete Mistyped/ })).toBeFocused();
    await expect(library).toBeVisible();
    await library.getByRole('button', { name: /^Delete Mistyped/ }).click();
    await library.getByRole('button', { name: /^Confirm delete, Mistyped/ }).click();
    await expect(library.getByRole('listitem')).toHaveCount(1);
    await expect(library.getByRole('button', { name: 'Enter a new puzzle' })).toBeFocused();

    // Reopened as it was left: paused, behind its card.
    await page.reload();
    await expect(resumeButton(page)).toBeVisible();
    library = await openYourPuzzles(page);
    await expect(library.getByRole('listitem')).toHaveCount(1);
    await expect(library.getByRole('listitem')).toContainText('One solution: a Hard puzzle.');
  });

  test("carries the puzzles in History's export to another browser, whose import lists them, names and all", async ({
    page,
    browser,
  }, testInfo) => {
    await seedPuzzles(page, kept);
    await openGame(page);
    await openHeaderDialog(page, 'History');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('dialog', { name: 'History' }).getByRole('button', { name: 'Export' }).click(),
    ]);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);

    await elsewhere(browser, async (other) => {
      await openGame(other);
      await openHeaderDialog(other, 'History');
      const history = other.getByRole('dialog', { name: 'History' });
      const [chooser] = await Promise.all([
        other.waitForEvent('filechooser'),
        history.getByRole('button', { name: 'Import' }).click(),
      ]);
      await chooser.setFiles(file);
      await expect(history.getByRole('status')).toHaveText(
        'Imported 1 new game, updated 0, and 2 of your puzzles.',
      );
      await history.getByRole('button', { name: 'Close' }).click();

      const library = await openYourPuzzles(other);
      await expect(library.getByRole('listitem')).toHaveText([
        /^Untitled puzzle.*One solution: a Hard puzzle\./,
        /^Mistyped.*Two 5s in row 1\./,
      ]);
      // Played there as here, a puzzle of the player's own.
      await library.getByRole('button', { name: /^Play untitled puzzle/ }).click();
      await expect(boardArea(other)).toContainText('Your Hard puzzle is ready.');
      await startButton(other).click();
      await waitForPlaying(other);
      expect(await readBoard(other)).toBe(HARD.givens);
    });
  });
});
