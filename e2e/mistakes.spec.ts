import { expect, test } from '@playwright/test';
import { createGame, isObviousAnswer } from '../src/core';
import {
  NEARLY_DONE,
  PUZZLES,
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
