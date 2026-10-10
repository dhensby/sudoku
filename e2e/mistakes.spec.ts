import { expect, test, type Page } from '@playwright/test';
import { createGame, isObviousAnswer } from '../src/core';
import {
  NEARLY_DONE,
  PUZZLES,
  cell,
  emptyCells,
  ensureNormalMode,
  openHeaderDialog,
  solveFromKeyboard,
  startPuzzle,
  typeDigits,
} from './helpers';

/**
 * Mistakes, end to end: nothing while the game is played, and at the solve a
 * line in the Solved dialog — and on the game's row in History — saying how
 * many wrong numbers stood. A slip of the finger in a cell whose answer was
 * obvious, put right at once, is forgiven; a wrong number where the answer
 * was not obvious counts however fast it is put right.
 */

/** A digit that is not the answer to `index` of `solution`. */
function wrongDigit(solution: string, index: number): number {
  return (Number(solution[index]) % 9) + 1;
}

test.describe('mistakes', () => {
  test('an obvious slip put right at once reads "No mistakes"', async ({ page }) => {
    await startPuzzle(page, NEARLY_DONE);
    await ensureNormalMode(page);
    // Every blank of this puzzle is a full house: its answer is obvious.
    const [first] = emptyCells(NEARLY_DONE.givens);
    await typeDigits(page, [
      { index: first, digit: wrongDigit(NEARLY_DONE.solution, first) },
      { index: first, digit: Number(NEARLY_DONE.solution[first]) },
    ]);
    // Nothing is said of it while the game is played.
    await expect(page.getByText(/mistake/i)).toHaveCount(0);
    await solveFromKeyboard(page, NEARLY_DONE);

    const solved = page.getByRole('dialog', { name: 'Solved!' });
    await expect(solved.locator('.result__mistakes')).toHaveText('No mistakes');
    await expect(solved).toHaveAccessibleDescription(/No mistakes/);
  });

  test('a wrong number where the answer was not obvious reads "1 mistake"', async ({ page }) => {
    const puzzle = PUZZLES.easy;
    // A cell with a choice of digits, and of places for its answer in each of its houses.
    const start = createGame(puzzle);
    const hard = emptyCells(puzzle.givens).find((index) => !isObviousAnswer(start, index));
    expect(hard).toBeDefined();

    await startPuzzle(page, puzzle);
    await ensureNormalMode(page);
    // Put right at once, it still counts: that was no slip of the finger.
    await typeDigits(page, [
      { index: hard!, digit: wrongDigit(puzzle.solution, hard!) },
      { index: hard!, digit: Number(puzzle.solution[hard!]) },
    ]);
    await solveFromKeyboard(page, puzzle);

    const solved = page.getByRole('dialog', { name: 'Solved!' });
    await expect(solved.locator('.result__mistakes')).toHaveText('1 mistake');
    await solved.getByRole('button', { name: 'Close' }).click();

    // History tells it on the game's status line, not among the help.
    await openHeaderDialog(page, 'History');
    const history = page.getByRole('dialog', { name: 'History' });
    const row = history.getByRole('listitem').filter({ hasText: /^Easy/ }).first();
    await expect(row.locator('.history-item__status')).toHaveText(
      /^Solved in \d+:\d\d · 1 mistake$/,
    );
  });
});

/** Switch on settings by name, in the Settings dialog, and close it. */
async function switchOn(page: Page, ...names: string[]): Promise<void> {
  await openHeaderDialog(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  for (const name of names) await settings.getByRole('checkbox', { name }).check();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
}

/**
 * What the error counter on show says to the eye (the stylesheet shows one of
 * its two places; a screen reader hears the same in words of its own).
 */
const errorCounter = (page: Page) => page.locator('.error-counter:visible [aria-hidden="true"]');

test.describe('Check guesses when entered, and the error counter', () => {
  test('a wrong number is marked and counted at once, and the time says the guesses were checked', async ({
    page,
  }) => {
    await startPuzzle(page, NEARLY_DONE);
    await switchOn(page, 'Check guesses when entered', 'Show error counter');
    await ensureNormalMode(page);
    const [first] = emptyCells(NEARLY_DONE.givens);
    const answer = Number(NEARLY_DONE.solution[first]);
    await typeDigits(page, [{ index: first, digit: wrongDigit(NEARLY_DONE.solution, first) }]);
    // Marked as it goes in, and counted with it: no 3 seconds to wait out.
    await expect(cell(page, first)).toHaveAccessibleName(/, incorrect$/);
    await expect(errorCounter(page)).toHaveText(/^Mistakes 1/);
    // An obvious slip, put right at once — and still counted, as nothing is forgiven.
    await page.keyboard.press(`Digit${answer}`);
    await expect(cell(page, first)).toHaveAccessibleName(String(answer));
    await solveFromKeyboard(page, NEARLY_DONE);

    const solved = page.getByRole('dialog', { name: 'Solved!' });
    await expect(solved.locator('.result__mistakes')).toHaveText('1 mistake');
    await expect(solved.locator('.result__assists')).toHaveText('With guesses checked as entered');
    await solved.getByRole('button', { name: 'Close' }).click();

    await openHeaderDialog(page, 'History');
    const history = page.getByRole('dialog', { name: 'History' });
    const row = history.getByRole('listitem').filter({ hasText: /^Easy/ }).first();
    await expect(row.getByRole('list', { name: 'Help used' })).toHaveText('Checked as entered');
  });

  test('with Check guesses off, the error counter moves only once 3 seconds of play are up', async ({
    page,
  }) => {
    const puzzle = PUZZLES.easy;
    const start = createGame(puzzle);
    const hard = emptyCells(puzzle.givens).find((index) => !isObviousAnswer(start, index))!;
    await page.clock.install();
    await startPuzzle(page, puzzle);
    await switchOn(page, 'Show error counter');
    await ensureNormalMode(page);
    await expect(errorCounter(page)).toHaveText(/^Mistakes 0$/);

    await typeDigits(page, [{ index: hard, digit: wrongDigit(puzzle.solution, hard) }]);
    // No mark: Check guesses is off.
    await expect(cell(page, hard)).not.toHaveAccessibleName(/incorrect/);
    await page.clock.fastForward('00:02');
    await expect(errorCounter(page)).toHaveText(/^Mistakes 0$/);
    // Paused, the board and the count are hidden, and the 3 seconds wait.
    await page.keyboard.press('p');
    await expect(page.locator('.error-counter').first()).toBeEmpty();
    await page.clock.fastForward('00:10');
    await page.keyboard.press('p');
    await expect(errorCounter(page)).toHaveText(/^Mistakes 0$/);
    await page.clock.fastForward('00:02');
    await expect(errorCounter(page)).toHaveText(/^Mistakes 1$/);
  });
});
