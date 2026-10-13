import { expect, test, type Page } from '@playwright/test';
import { encodeGivens } from '../src/core';
import {
  PUZZLES,
  boardArea,
  copiedText,
  enterGivens,
  enterStatus,
  openEnterPuzzle,
  openHeaderDialog,
  openYourPuzzles,
  readBoard,
  resumeButton,
  seedPuzzles,
  solutionOf,
  startButton,
  stubClipboard,
  waitForPlaying,
} from './helpers';

/**
 * Enter a puzzle: a puzzle from the paper typed in from New game's Your
 * puzzles, checked as it goes in, then played and shared like any other — a
 * Hard typed in plays as the Hard it is, and its link opens it elsewhere as a
 * friend's would — and kept in Your puzzles, finished or not, to edit, name,
 * play or delete there. Everything in the editor is found through its
 * dialog: the board and the pad behind it stay on the page.
 *
 * Runs on Chromium (desktop layout).
 */

const HARD = PUZZLES.hard;

/** Open the game on a puzzle of its own, as it opens for anyone. */
async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await waitForPlaying(page);
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

test('names a clash, and more than one solution, and keeps Play unavailable', async ({ page }) => {
  await openGame(page);
  const editor = await openEnterPuzzle(page);
  const play = editor.getByRole('button', { name: 'Play' });
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
});
