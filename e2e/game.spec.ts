import { expect, test, type Page } from '@playwright/test';
import {
  PEERS,
  computeCandidates,
  digitsOf,
  gridValues,
  rate,
  type GridString,
  type Puzzle,
} from '../src/core';
import {
  NEARLY_DONE,
  NEARLY_DONE_2,
  PUZZLES,
  cell,
  cells,
  chooseMore,
  emptyCells,
  grid,
  modeButton,
  newGame,
  padKey,
  readBoard,
  readTimer,
  selectCell,
  selectedIndex,
  solutionOf,
  solveFromKeyboard,
  startPuzzle,
  timer,
  toSeconds,
  typeDigits,
  waitForPlaying,
} from './helpers';

/**
 * Playing a game, end to end, against the production bundle: the first visit,
 * entering digits and candidates from the keyboard and the pad (Space, Shift
 * and Alt, key repeat), the two-step Erase, Undo and Redo, Auto Candidate
 * Mode's two layers, conflicts, the "…" menu's Check, Reveal, Hint and Reset,
 * the completion dialog and its stats, New game for each tier, the settings,
 * and what the status region says for a screen reader.
 *
 * Known puzzles are opened from share links built with the real codec, and
 * the expected state of every cell is worked out with the real engine, then
 * read back through the cells' accessible names.
 *
 * Runs on Chromium (desktop layout).
 */

const EASY = PUZZLES.easy;

/** Candidates computed from the board's values — what Auto Candidate Mode shows. */
function computed(values: GridString, index: number): number[] {
  return digitsOf(computeCandidates(gridValues(values))[index]);
}

/** The label of an empty cell showing `digits`. */
function withCandidates(digits: readonly number[]): string {
  return digits.length === 0 ? 'empty' : `empty, candidates ${digits.join(' ')}`;
}

/** An empty cell of `puzzle` with at least `count` computed candidates, so it can hold a wrong digit. */
function cellWithChoices(puzzle: Puzzle, count = 2): number {
  const found = emptyCells(puzzle.givens).find(
    (index) => computed(puzzle.givens, index).length >= count,
  );
  if (found === undefined) throw new Error('fixture has no such cell');
  return found;
}

const autoSwitch = (page: Page) => page.getByRole('switch', { name: 'Auto Candidate Mode' });

const hintBar = (page: Page) => page.locator('.hint-bar');

test.describe('a first visit', () => {
  test('generates an Easy puzzle and starts the clock at once', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await waitForPlaying(page);

    await expect(page).toHaveTitle(/Sudoku/);
    await expect(page.getByRole('banner')).toContainText('Difficulty: Easy');
    await expect(cells(page)).toHaveCount(81);
    // An Easy puzzle has 38 givens, and it really is Easy.
    const board = await readBoard(page);
    expect([...board].filter((ch) => ch !== '0')).toHaveLength(38);
    expect(rate(gridValues(board))).toBe('easy');
    // NYT selects the first empty cell on load.
    expect(await selectedIndex(page)).toBe(board.indexOf('0'));

    // The clock is running: it ticks on its own.
    await page.clock.fastForward('00:05');
    await expect.poll(() => readTimer(page)).toMatch(/^0:0[5-9]$/);
    await expect(timer(page)).toHaveAccessibleName('Pause');
  });
});

test.describe('entering digits', () => {
  test('the keyboard places digits, moves the selection and erases', async ({ page }) => {
    await startPuzzle(page, EASY);
    const [first, second] = emptyCells(EASY.givens);
    await selectCell(page, first);
    await expect(cell(page, first)).toBeFocused();

    await page.keyboard.press(`Digit${EASY.solution[first]}`);
    await expect(cell(page, first)).toHaveAccessibleName(EASY.solution[first]);

    // Arrow keys move the selection, and focus follows it.
    await page.keyboard.press('ArrowRight');
    const next = first + 1;
    await expect(cell(page, next)).toHaveAttribute('aria-selected', 'true');
    await expect(cell(page, next)).toBeFocused();

    // The numpad works as the top row does.
    await selectCell(page, second);
    await page.keyboard.press(`Numpad${EASY.solution[second]}`);
    await expect(cell(page, second)).toHaveAccessibleName(EASY.solution[second]);

    // Givens never change.
    const given = EASY.givens.search(/[1-9]/);
    await selectCell(page, given);
    await page.keyboard.press(`Digit${(Number(EASY.givens[given]) % 9) + 1}`);
    await expect(cell(page, given)).toHaveAccessibleName(`${EASY.givens[given]}, given`);

    // Backspace erases a player's digit.
    await selectCell(page, second);
    await page.keyboard.press('Backspace');
    await expect(cell(page, second)).toHaveAccessibleName('empty');
  });

  test('the number pad enters a digit in the selected cell', async ({ page }) => {
    await startPuzzle(page, EASY);
    const target = emptyCells(EASY.givens)[3];
    await selectCell(page, target);
    await padKey(page, Number(EASY.solution[target])).click();
    await expect(cell(page, target)).toHaveAccessibleName(EASY.solution[target]);
    // A press on a key does not take focus from the board, so the keyboard
    // carries on from the cell.
    await expect(cell(page, target)).toBeFocused();
  });

  test('a digit placed nine times greys out its key, which still works', async ({ page }) => {
    await startPuzzle(page, NEARLY_DONE);
    const [blank] = emptyCells(NEARLY_DONE.givens);
    const digit = Number(NEARLY_DONE.solution[blank]);
    await expect(padKey(page, digit)).toHaveAccessibleName(String(digit));
    await selectCell(page, blank);
    await page.keyboard.press(`Digit${digit}`);
    await expect(padKey(page, digit)).toHaveAccessibleName(`${digit}, all placed`);
    await expect(padKey(page, digit)).toBeEnabled();
  });
});

test.describe('candidates', () => {
  test('Space latches candidate mode, and Shift flips it while held', async ({ page }) => {
    await startPuzzle(page, EASY);
    const target = emptyCells(EASY.givens)[0];
    await selectCell(page, target);
    await expect(modeButton(page, 'Normal')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Space');
    await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Digit1');
    await page.keyboard.press('Digit4');
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates([1, 4]));
    // Pressing a candidate again takes it out.
    await page.keyboard.press('Digit1');
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates([4]));

    await page.keyboard.press('Space');
    await expect(modeButton(page, 'Normal')).toHaveAttribute('aria-pressed', 'true');

    // Held Shift: candidate mode for as long as it is down. The digit is read
    // from the key's position, so Shift+7 is still 7.
    await page.keyboard.down('Shift');
    await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Digit7');
    await page.keyboard.up('Shift');
    await expect(modeButton(page, 'Normal')).toHaveAttribute('aria-pressed', 'true');
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates([4, 7]));

    // Alt (Option) does the same.
    await page.keyboard.down('Alt');
    await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Digit2');
    await page.keyboard.up('Alt');
    await expect(modeButton(page, 'Normal')).toHaveAttribute('aria-pressed', 'true');
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates([2, 4, 7]));

    // Back in normal mode a digit is a value again.
    await page.keyboard.press(`Digit${EASY.solution[target]}`);
    await expect(cell(page, target)).toHaveAccessibleName(EASY.solution[target]);
  });

  test('the mode toggle and the pad enter candidates', async ({ page }) => {
    await startPuzzle(page, EASY);
    const target = emptyCells(EASY.givens)[1];
    await selectCell(page, target);
    await modeButton(page, 'Candidate').click();
    await padKey(page, 2).click();
    await padKey(page, 9).click();
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates([2, 9]));
  });

  test('Erase clears the value first, then the notes underneath it', async ({ page }) => {
    await startPuzzle(page, EASY);
    const target = emptyCells(EASY.givens)[0];
    await selectCell(page, target);
    await page.keyboard.press('Space');
    await page.keyboard.press('Digit2');
    await page.keyboard.press('Digit6');
    await page.keyboard.press('Space');
    await page.keyboard.press(`Digit${EASY.solution[target]}`);
    await expect(cell(page, target)).toHaveAccessibleName(EASY.solution[target]);

    // First press: the value goes, and the notes kept underneath come back.
    await page.getByRole('button', { name: 'Erase' }).click();
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates([2, 6]));
    // Second press: the notes go.
    await page.keyboard.press('Delete');
    await expect(cell(page, target)).toHaveAccessibleName('empty');
  });

  test('Auto Candidate Mode keeps its eliminations and the manual notes apart', async ({
    page,
  }) => {
    await startPuzzle(page, EASY);
    const target = cellWithChoices(EASY, 3);
    const all = computed(EASY.givens, target);
    const solution = Number(EASY.solution[target]);
    const struck = all.find((digit) => digit !== solution)!;

    // A manual note first: the solution digit, which auto mode will also show.
    await selectCell(page, target);
    await page.keyboard.press('Space');
    await page.keyboard.press(`Digit${solution}`);
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates([solution]));

    // On: every legal candidate, from the givens.
    await autoSwitch(page).click();
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates(all));
    // Strike one out in auto mode.
    await page.keyboard.press(`Digit${struck}`);
    const remaining = all.filter((digit) => digit !== struck);
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates(remaining));

    // Off: the manual note, exactly as it was.
    await autoSwitch(page).click();
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates([solution]));

    // On again: the elimination is remembered.
    await autoSwitch(page).click();
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates(remaining));

    // A placed digit drops out of its peers' candidates, and comes back when erased.
    const peer = PEERS[target].find(
      (index) => EASY.givens[index] === '0' && computed(EASY.givens, index).includes(solution),
    )!;
    await page.keyboard.press('Space');
    await selectCell(page, peer);
    await page.keyboard.press(`Digit${solution}`);
    await expect(cell(page, target)).toHaveAccessibleName(
      withCandidates(remaining.filter((digit) => digit !== solution)),
    );
    await page.keyboard.press('Backspace');
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates(remaining));

    // Switching the mode is an undo step of its own.
    await page.keyboard.press('Control+z'); // the erase
    await page.keyboard.press('Control+z'); // the placement
    await page.keyboard.press('Control+z'); // auto back on
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'false');
  });
});

test.describe('key repeat', () => {
  test('a held digit toggles its candidate once, not on and off', async ({ page }) => {
    await startPuzzle(page, EASY);
    const target = emptyCells(EASY.givens)[0];
    await selectCell(page, target);
    await page.keyboard.press('Space');
    // A second keydown without a keyup is a repeat.
    await page.keyboard.down('Digit3');
    await page.keyboard.down('Digit3');
    await page.keyboard.down('Digit3');
    await page.keyboard.up('Digit3');
    await expect(cell(page, target)).toHaveAccessibleName(withCandidates([3]));
  });
});

test.describe('screen readers', () => {
  test('hear each move, the pause and the solve', async ({ page }) => {
    await page.clock.install();
    await startPuzzle(page, NEARLY_DONE);
    // The app's own live region is the first status on the page.
    const status = page.getByRole('status').first();
    const [first, ...rest] = emptyCells(NEARLY_DONE.givens);
    await selectCell(page, first);
    await page.keyboard.press(`Digit${NEARLY_DONE.solution[first]}`);
    await expect(status).toHaveText(
      `${NEARLY_DONE.solution[first]} in row ${Math.floor(first / 9) + 1}, column ${(first % 9) + 1}.`,
    );
    await page.keyboard.press('p');
    await expect(status).toHaveText('Paused.');
    await page.keyboard.press('p');
    await expect(status).toHaveText('Resumed.');

    await page.clock.fastForward('00:21');
    await typeDigits(
      page,
      rest.map((index) => ({ index, digit: Number(NEARLY_DONE.solution[index]) })),
    );
    await expect(status).toHaveText(/^Solved in 0:2\d\.$/);
  });
});

test.describe('undo and redo', () => {
  test('work from the keyboard and the buttons', async ({ page }) => {
    await startPuzzle(page, EASY);
    const [a, b] = emptyCells(EASY.givens);
    const undo = page.getByRole('button', { name: 'Undo' });
    const redo = page.getByRole('button', { name: 'Redo' });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await selectCell(page, a);
    await page.keyboard.press(`Digit${EASY.solution[a]}`);
    await selectCell(page, b);
    await page.keyboard.press(`Digit${EASY.solution[b]}`);
    await expect(undo).toBeEnabled();

    await page.keyboard.press('Control+z');
    await expect(cell(page, b)).toHaveAccessibleName('empty');
    // Undo selects the cell it changed.
    await page.keyboard.press('Control+z');
    await expect(cell(page, a)).toHaveAccessibleName('empty');
    await expect(cell(page, a)).toHaveAttribute('aria-selected', 'true');
    await expect(undo).toBeDisabled();

    await page.keyboard.press('Control+Shift+z');
    await expect(cell(page, a)).toHaveAccessibleName(EASY.solution[a]);
    await page.keyboard.press('Control+y');
    await expect(cell(page, b)).toHaveAccessibleName(EASY.solution[b]);
    await expect(redo).toBeDisabled();

    await undo.click();
    await expect(cell(page, b)).toHaveAccessibleName('empty');
    await redo.click();
    await expect(cell(page, b)).toHaveAccessibleName(EASY.solution[b]);

    // A new change clears what was left to redo.
    await undo.click();
    await expect(redo).toBeEnabled();
    await selectCell(page, emptyCells(EASY.givens)[2]);
    await page.keyboard.press('Digit1');
    await expect(redo).toBeDisabled();
  });
});

test.describe('conflicts', () => {
  test('a clash marks both cells, givens included, and clears with the clash', async ({ page }) => {
    await startPuzzle(page, EASY);
    // An empty cell, and a given in its row whose digit it can be made to clash with.
    const target = emptyCells(EASY.givens)[0];
    const row = Math.floor(target / 9);
    const given = Array.from({ length: 9 }, (_, col) => row * 9 + col).find(
      (index) => EASY.givens[index] !== '0',
    )!;
    const digit = EASY.givens[given];

    await selectCell(page, target);
    await page.keyboard.press(`Digit${digit}`);
    await expect(cell(page, target)).toHaveAccessibleName(`${digit}, conflict`);
    await expect(cell(page, given)).toHaveAccessibleName(`${digit}, given, conflict`);

    await page.keyboard.press('Backspace');
    await expect(cell(page, target)).toHaveAccessibleName('empty');
    await expect(cell(page, given)).toHaveAccessibleName(`${digit}, given`);
  });
});

test.describe('the "…" menu', () => {
  test('Check marks right and wrong, Hint points the way, Reveal fills a cell', async ({
    page,
  }) => {
    await startPuzzle(page, EASY);
    const wrongCell = cellWithChoices(EASY, 2);
    const right = Number(EASY.solution[wrongCell]);
    const wrong = computed(EASY.givens, wrongCell).find((digit) => digit !== right)!;
    const rightCell = emptyCells(EASY.givens).find((index) => index !== wrongCell)!;

    // A wrong digit that clashes with nothing: only Check can find it.
    await selectCell(page, wrongCell);
    await page.keyboard.press(`Digit${wrong}`);
    await expect(cell(page, wrongCell)).toHaveAccessibleName(String(wrong));
    await chooseMore(page, 'Check cell');
    await expect(cell(page, wrongCell)).toHaveAccessibleName(`${wrong}, incorrect`);

    await selectCell(page, rightCell);
    await page.keyboard.press(`Digit${EASY.solution[rightCell]}`);
    await chooseMore(page, 'Check puzzle');
    await expect(cell(page, rightCell)).toHaveAccessibleName(
      `${EASY.solution[rightCell]}, correct`,
    );
    await expect(cell(page, wrongCell)).toHaveAccessibleName(`${wrong}, incorrect`);
    // A checked-correct cell is locked.
    await page.keyboard.press('Backspace');
    await expect(cell(page, rightCell)).toHaveAccessibleName(
      `${EASY.solution[rightCell]}, correct`,
    );

    // With a mistake on the board, the hint points at it first.
    await chooseMore(page, 'Hint');
    await expect(hintBar(page)).toHaveText('This number is incorrect.');
    await expect(cell(page, wrongCell)).toHaveAttribute('aria-selected', 'true');

    // Put right, the next hint names a technique, and goes with the next change.
    await page.keyboard.press('Backspace');
    await expect(hintBar(page)).toHaveText('');
    await chooseMore(page, 'Hint');
    await expect(hintBar(page)).toHaveText(/^(Full house|Hidden single|Naked single):/);
    const hinted = await selectedIndex(page);
    // The hint never fills a digit in.
    await expect(cell(page, hinted)).toHaveAccessibleName(/^empty/);

    // Reveal fills the selected cell with its answer, and locks it.
    await chooseMore(page, 'Reveal cell');
    await expect(cell(page, hinted)).toHaveAccessibleName(`${EASY.solution[hinted]}, revealed`);
    await page.keyboard.press('Backspace');
    await expect(cell(page, hinted)).toHaveAccessibleName(`${EASY.solution[hinted]}, revealed`);
  });

  test('Reset asks first, then clears the board back to its givens, and the clock runs on', async ({
    page,
  }) => {
    await page.clock.install();
    await startPuzzle(page, EASY);
    const target = emptyCells(EASY.givens)[0];
    await selectCell(page, target);
    await page.keyboard.press(`Digit${EASY.solution[target]}`);
    await page.clock.fastForward('00:30');
    await expect.poll(async () => toSeconds(await readTimer(page))).toBeGreaterThanOrEqual(30);

    await chooseMore(page, 'Reset puzzle…');
    const dialog = page.getByRole('dialog', { name: 'Reset puzzle?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(cell(page, target)).toHaveAccessibleName(EASY.solution[target]);

    await chooseMore(page, 'Reset puzzle…');
    await expect(dialog).toContainText('The clock keeps running.');
    await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(EASY.givens);
    // A fresh board, not a fresh time: the clock carries on from where it was.
    expect(toSeconds(await readTimer(page))).toBeGreaterThanOrEqual(30);
    await page.clock.fastForward('00:05');
    await expect.poll(async () => toSeconds(await readTimer(page))).toBeGreaterThanOrEqual(35);
  });

  test('after a "…" menu item, the arrow keys and Space play the board again', async ({ page }) => {
    await startPuzzle(page, EASY);
    await selectCell(page, emptyCells(EASY.givens)[5]);
    await chooseMore(page, 'Hint');
    const hinted = await selectedIndex(page);

    await page.keyboard.press(hinted < 72 ? 'ArrowDown' : 'ArrowUp');
    await expect(page.getByRole('menu', { name: 'More' })).toHaveCount(0);
    expect(await selectedIndex(page)).toBe(hinted < 72 ? hinted + 9 : hinted - 9);
    await page.keyboard.press('Space');
    await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
  });
});

/*
 * Space switches the mode wherever the player last clicked. A mouse press on
 * a menu, a menu item, the timer or a header button never takes focus, and a
 * dialog closing hands focus back to the board, so Space can never press the
 * last button clicked a second time — taking another hint, starting another
 * game or pausing again.
 */
test.describe('Space after the mouse', () => {
  const selectedCell = (page: Page) => page.getByRole('gridcell', { selected: true });

  test('after a "…" item, focus is on the selected cell and Space takes no second hint', async ({
    page,
  }) => {
    await startPuzzle(page, EASY);
    await selectCell(page, emptyCells(EASY.givens)[5]);
    await chooseMore(page, 'Hint');
    await expect(hintBar(page)).not.toHaveText('');
    await expect(selectedCell(page)).toBeFocused();

    await page.keyboard.press('Space');
    await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(modeButton(page, 'Normal')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('menu', { name: 'More' })).toHaveCount(0);

    // One hint on the record, not three.
    await page.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('dialog', { name: 'History' });
    await expect(history.getByRole('list', { name: 'Help used' })).toHaveText('1 hint');
  });

  test('after pausing and resuming with the timer, Space switches the mode', async ({ page }) => {
    await startPuzzle(page, EASY);
    await selectCell(page, emptyCells(EASY.givens)[0]);
    await timer(page).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Paused' })).toBeVisible();
    await timer(page).click();
    await waitForPlaying(page);
    await expect(selectedCell(page)).toBeFocused();

    await page.keyboard.press('Space');
    await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
    // Still playing: the timer was not pressed again.
    await expect(timer(page)).toHaveAccessibleName('Pause');
    await expect(grid(page)).toBeVisible();
  });

  test('after New game, Space switches the mode instead of starting another', async ({ page }) => {
    await page.goto('/');
    await waitForPlaying(page);
    await newGame(page, 'Hard');
    await expect(page.getByRole('banner')).toContainText('Difficulty: Hard');
    await waitForPlaying(page);
    const board = await readBoard(page);
    // The new board's selected cell has focus, so the keyboard plays it.
    await expect(selectedCell(page)).toBeFocused();

    await page.keyboard.press('Space');
    await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(modeButton(page, 'Normal')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('menu', { name: 'New game' })).toHaveCount(0);
    await expect(page.getByRole('banner')).toContainText('Difficulty: Hard');
    expect(await readBoard(page)).toBe(board);
  });

  for (const menu of ['More', 'New game']) {
    test(`after the ${menu} menu, opened with the mouse, closes on Escape, Space switches the mode`, async ({
      page,
    }) => {
      await startPuzzle(page, EASY);
      await selectCell(page, emptyCells(EASY.givens)[0]);
      await page.getByRole('button', { name: menu }).click();
      await expect(page.getByRole('menu', { name: menu })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu', { name: menu })).toHaveCount(0);
      // Back where it was before the menu opened, not on the menu's button.
      await expect(selectedCell(page)).toBeFocused();

      await page.keyboard.press('Space');
      await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('menu')).toHaveCount(0);
    });
  }

  test('a menu opened from the keyboard still hands Escape’s focus to its button', async ({
    page,
  }) => {
    await startPuzzle(page, EASY);
    const more = page.getByRole('button', { name: 'More' });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
  });

  test('a press on a blank part of the page closes a menu and sends focus straight home', async ({
    page,
  }) => {
    await startPuzzle(page, EASY);
    await selectCell(page, emptyCells(EASY.givens)[0]);
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
    await page.mouse.click(5, 300);
    await expect(page.getByRole('menu')).toHaveCount(0);
    // At once: not on the clock's next tick, a second later.
    await expect(selectedCell(page)).toBeFocused({ timeout: 300 });

    // And while paused, with no clock to tick at all: home is the card's button.
    await timer(page).click();
    const resume = page.getByRole('main').getByRole('button', { name: 'Resume' });
    await expect(resume).toBeVisible();
    await page.getByRole('button', { name: 'New game' }).click();
    await expect(page.getByRole('menu', { name: 'New game' })).toBeVisible();
    await page.mouse.click(5, 300);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(resume).toBeFocused({ timeout: 300 });
  });

  test('a press on a blank part of the page with no menu open leaves focus there', async ({
    page,
  }) => {
    await startPuzzle(page, EASY);
    await selectCell(page, emptyCells(EASY.givens)[0]);
    await page.mouse.click(5, 300);
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });

  test('Tab out of a menu opened from the keyboard closes it and moves on', async ({ page }) => {
    await startPuzzle(page, EASY);
    const button = page.getByRole('button', { name: 'New game' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'New game' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toHaveCount(0);
    // Onwards along the header, not dropped to the page.
    await expect(page.getByRole('button', { name: 'Daily puzzles' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(button).toBeFocused();
  });

  test('after a dialog opened with the mouse closes, Space switches the mode', async ({ page }) => {
    await startPuzzle(page, EASY);
    await selectCell(page, emptyCells(EASY.givens)[0]);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await waitForPlaying(page);
    await expect(selectedCell(page)).toBeFocused();

    await page.keyboard.press('Space');
    await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('solving', () => {
  test('the completion dialog shows the time, and the board stays solved', async ({ page }) => {
    await page.clock.install();
    await startPuzzle(page, NEARLY_DONE);
    await page.clock.fastForward('01:05');
    await solveFromKeyboard(page, NEARLY_DONE);

    const dialog = page.getByRole('dialog', { name: 'Solved!' });
    await expect(dialog).toBeVisible();
    // The clock has stopped: the header shows the final time, as plain text.
    await expect(timer(page)).toHaveCount(0);
    const final = await readTimer(page);
    expect(final).toMatch(/^1:0[5-9]$/);
    await expect(dialog.locator('.result__time')).toHaveText(final);
    await expect(dialog.locator('.result__difficulty')).toHaveText('Easy');
    // The first solve of a tier: its own best and average.
    await expect(dialog.getByRole('region', { name: 'Head to head' })).toHaveCount(0);
    await expect(dialog.getByText('Your Easy record')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Share your time' })).toBeFocused();

    // Closing leaves the solved board on show, and frozen.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    expect(await readBoard(page)).toBe(NEARLY_DONE.solution);
    await expect(grid(page)).toHaveAttribute('aria-readonly', 'true');
    await expect(page.getByRole('switch', { name: 'Auto Candidate Mode' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'More' })).toBeDisabled();
  });

  test('a game past the hour is timed as h:mm:ss', async ({ page }) => {
    await page.clock.install();
    await startPuzzle(page, NEARLY_DONE);
    await page.clock.fastForward('01:02:03');
    await solveFromKeyboard(page, NEARLY_DONE);
    const dialog = page.getByRole('dialog', { name: 'Solved!' });
    await expect(dialog.locator('.result__time')).toHaveText(/^1:02:0\d$/);
  });

  test('a full board with a mistake says so and keeps the clock running', async ({ page }) => {
    await startPuzzle(page, NEARLY_DONE);
    const [first, ...rest] = emptyCells(NEARLY_DONE.givens);
    // Every blank but the first right; the first gets a wrong digit.
    await solveFromKeyboard(page, {
      ...NEARLY_DONE,
      solution: [...NEARLY_DONE.solution]
        .map((ch, i) => (i === first ? String((Number(ch) % 9) + 1) : ch))
        .join(''),
    });
    expect(rest.length).toBeGreaterThan(0);
    await expect(hintBar(page)).toHaveText(/The board is full, but something isn't right\./);
    await expect(page.getByRole('dialog', { name: 'Solved!' })).toHaveCount(0);
    await expect(timer(page)).toHaveAccessibleName('Pause');

    // Put right, it is solved.
    await selectCell(page, first);
    await page.keyboard.press(`Digit${NEARLY_DONE.solution[first]}`);
    await expect(page.getByRole('dialog', { name: 'Solved!' })).toBeVisible();
  });

  test('a solved game reopens solved after a reload, with no dialog', async ({ page }) => {
    await startPuzzle(page, NEARLY_DONE);
    await solveFromKeyboard(page, NEARLY_DONE);
    await expect(page.getByRole('dialog', { name: 'Solved!' })).toBeVisible();
    const final = await readTimer(page);

    await page.reload();
    await expect(grid(page)).toBeVisible();
    expect(await readBoard(page)).toBe(NEARLY_DONE.solution);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('banner')).toContainText(`Solved in ${final}`);
  });

  test('a faster solve of the tier is a new best, and the stats count both', async ({ page }) => {
    await page.clock.install();
    // Two different puzzles, both Easy: replays are not the way to a best.
    expect(NEARLY_DONE_2.difficulty).toBe('easy');
    await startPuzzle(page, NEARLY_DONE);
    await page.clock.fastForward('00:40');
    await solveFromKeyboard(page, NEARLY_DONE);
    const first = page.getByRole('dialog', { name: 'Solved!' });
    await expect(first).toBeVisible();
    // Nothing to beat yet.
    await expect(first.getByText('New best!')).toHaveCount(0);
    const slow = await readTimer(page);

    await startPuzzle(page, NEARLY_DONE_2);
    await page.clock.fastForward('00:05');
    await solveFromKeyboard(page, NEARLY_DONE_2);
    const second = page.getByRole('dialog', { name: 'Solved!' });
    await expect(second.getByText('New best!')).toBeVisible();
    const fast = await readTimer(page);
    const stats = second.getByRole('region', { name: 'Your Easy record' });
    await expect(stats).toContainText(/Solved\s*2/);
    await expect(stats).toContainText(new RegExp(`Best\\s*${fast}`));
    // About 0:40 and 0:05: the average of the two.
    expect(toSeconds(slow)).toBeGreaterThanOrEqual(40);
    await expect(stats).toContainText(/Average\s*0:2[0-5]/);
  });

  test("the completion dialog's New game starts another of the same tier", async ({ page }) => {
    await startPuzzle(page, NEARLY_DONE);
    await solveFromKeyboard(page, NEARLY_DONE);
    const dialog = page.getByRole('dialog', { name: 'Solved!' });
    await dialog.getByRole('button', { name: 'New game' }).click();
    await expect(dialog).toBeHidden();
    await waitForPlaying(page);
    await expect(page.getByRole('banner')).toContainText('Difficulty: Easy');
    expect(await readBoard(page)).not.toBe(NEARLY_DONE.solution);
  });
});

test.describe('settings', () => {
  const setting = (page: Page, name: string) =>
    page.getByRole('dialog', { name: 'Settings' }).getByRole('checkbox', { name });

  test('take effect at once, and are remembered', async ({ page }) => {
    await startPuzzle(page, EASY);
    await page.getByRole('button', { name: 'Settings' }).click();
    await setting(page, 'Show timer').uncheck();
    await setting(page, 'Highlight conflicts').uncheck();
    await setting(page, 'Start new games in auto candidate mode').check();
    await page.keyboard.press('Escape');
    await waitForPlaying(page);

    // The time is hidden; the pause button stays, and timing carries on.
    await expect(page.getByRole('banner').locator('.timer__time')).toHaveCount(0);
    await expect(timer(page)).toHaveAccessibleName('Pause');

    // No conflict marks, even on a clash.
    const target = emptyCells(EASY.givens)[0];
    const row = Math.floor(target / 9);
    const given = Array.from({ length: 9 }, (_, col) => row * 9 + col).find(
      (index) => EASY.givens[index] !== '0',
    )!;
    await selectCell(page, target);
    await page.keyboard.press(`Digit${EASY.givens[given]}`);
    await expect(cell(page, target)).toHaveAccessibleName(EASY.givens[given]);

    // A new game starts with auto candidates on — and the settings survive a reload.
    await newGame(page, 'Easy');
    await waitForPlaying(page);
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    await page.getByRole('main').getByRole('button', { name: 'Resume' }).click();
    await waitForPlaying(page);
    await expect(page.getByRole('banner').locator('.timer__time')).toHaveCount(0);
    await expect(autoSwitch(page)).toHaveAttribute('aria-checked', 'true');
  });

  test('the theme can be forced either way', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await startPuzzle(page, EASY);
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await background();

    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('radio', { name: 'Dark' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background()).not.toBe(light);

    await dialog.getByRole('radio', { name: 'System' }).check();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
    expect(await background()).toBe(light);
  });
});

test.describe('new game', () => {
  for (const [label, tier] of [
    ['Easy', 'easy'],
    ['Medium', 'medium'],
    ['Hard', 'hard'],
    ['Expert', 'expert'],
  ] as const) {
    test(`a new ${label} game is labelled ${label}, and is one`, async ({ page }) => {
      await page.goto('/');
      await waitForPlaying(page);
      const before = await readBoard(page);

      await newGame(page, label);
      await waitForPlaying(page);
      await expect(page.getByRole('banner')).toContainText(`Difficulty: ${label}`);
      const board = await readBoard(page);
      expect(board).not.toBe(before);
      // The label matches the puzzle: graded afresh by the real grader.
      expect(rate(gridValues(board))).toBe(tier);
      // And the puzzle is a proper one: it has a solution consistent with its givens.
      expect(solutionOf(board)).toHaveLength(81);

      // The tier on show is marked in the menu — still a plain command.
      await page.getByRole('button', { name: 'New game' }).click();
      const menu = page.getByRole('menu', { name: 'New game' });
      await expect(menu.getByRole('menuitem', { name: `${label} (current)` })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: /\(current\)$/ })).toHaveCount(1);
    });
  }
});
