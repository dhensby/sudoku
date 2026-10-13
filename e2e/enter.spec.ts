import { expect, test, type Page } from '@playwright/test';
import { encodeGivens } from '../src/core';
import {
  PUZZLES,
  boardArea,
  copiedText,
  enterGivens,
  openEnterPuzzle,
  openHeaderDialog,
  readBoard,
  solutionOf,
  startButton,
  stubClipboard,
  waitForPlaying,
} from './helpers';

/**
 * Enter a puzzle: a puzzle from the paper typed in from New game, checked as
 * it goes in, then played and shared like any other — a Hard typed in plays
 * as the Hard it is, and its link opens it elsewhere as a friend's would.
 * Everything in the editor is found through its dialog: the board and the
 * pad behind it stay on the page.
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
  await expect(editor.getByRole('status')).toHaveText('Type in the numbers from your puzzle.');
  await enterGivens(editor, HARD.givens);
  await expect(editor.getByRole('status')).toHaveText('One solution: a Hard puzzle.');
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
  await expect(editor.getByRole('status')).toHaveText('Two 5s in row 1.');
  await expect(editor.getByRole('gridcell', { name: '5, given, conflict' })).toHaveCount(2);
  await expect(play).toHaveAttribute('aria-disabled', 'true');

  // A solved grid with its top two rows left blank: they can swap wholesale.
  const solution = solutionOf(HARD.givens);
  await enterGivens(editor, '0'.repeat(18) + solution.slice(18));
  await expect(editor.getByRole('status')).toHaveText('More than one solution so far.');
  await expect(play).toHaveAttribute('aria-disabled', 'true');
  // Focused, it says why; pressed, it does nothing.
  await play.focus();
  await expect(play).toHaveAccessibleDescription('More than one solution so far.');
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await expect(play).toBeFocused();

  // Escape closes it, and the game behind carries on.
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await waitForPlaying(page);
});
