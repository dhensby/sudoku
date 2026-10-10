import { expect, test, type Page } from '@playwright/test';
import { STUCK_ON_AN_XY_CHAIN, STUCK_ON_A_HIDDEN_PAIR } from '../src/test/logic-fixtures';
import {
  arrowTo,
  cell,
  chooseMore,
  ensureNormalMode,
  getStuck,
  getStuckOnAnXyChain,
  grid,
  modeButton,
  openHeaderDialog,
  readTimer,
  resumeButton,
  selectCell,
  selectedIndex,
  toSeconds,
  typeDigits,
  waitForPlaying,
} from './helpers';

/**
 * Remembered hints and "Show me", end to end, on the board behind the report
 * that asked for them: a player sixteen entries into the puzzle of share
 * code `O3NLgKqUTeam9ygZMBQVALBbgSY`, whose hint pointed at row 5, column 2
 * and named a hidden pair — in column 6, three steps and half a board away.
 * Show me walks those three steps; selecting the cell again shows the hint
 * again, and neither that nor asking again costs another hint.
 *
 * Runs on Chromium (desktop layout); the phones' bottom sheet is checked by
 * axe in a11y.spec.ts and its press areas in touch.spec.ts.
 */

const { target } = STUCK_ON_A_HIDDEN_PAIR;

const HINT = "Look here — a hidden pair will unlock this cell. What's a hidden pair? Show me";

/** What each step says, as its diagram is named. */
const CAPTIONS = [
  'In column 6, the 1 and 7 can only go in rows 4 and 6. Those two cells must hold the 1 and 7, ' +
    'one each, so nothing else fits in them: remove 5 from row 4, column 6; and 2 and 8 from row ' +
    '6, column 6.',
  'Step 1 removed 5 from row 4, column 6. In box 5, the only places left for a 5 are in row 5, ' +
    "at columns 5 and 6. Box 5's 5 must be one of them, and so it is also row 5's 5: no other " +
    'cell in row 5 can be a 5. Remove it from row 5, columns 2 and 3.',
  'Row 5, column 2 sees 1, 3, 6 and 7 in its row; and 2, 4 and 9 in its column. Step 2 ruled ' +
    'out its 5. So 8 is all it can be.',
];

const hintBar = (page: Page) => page.locator('.hint-bar');
const showMe = (page: Page) =>
  page.getByRole('button', { name: 'Show me how to solve row 5, column 2' });
const walkthrough = (page: Page) =>
  page.getByRole('dialog', { name: 'How to solve row 5, column 2' });
const stepHeading = (page: Page) => walkthrough(page).getByRole('heading', { level: 3 });

/** The help the game on screen has taken, as History lists it, is (or matches) `help`. */
async function expectHelpUsed(page: Page, help: string | RegExp): Promise<void> {
  await openHeaderDialog(page, 'History');
  const history = page.getByRole('dialog', { name: 'History' });
  await expect(history.getByRole('list', { name: 'Help used' })).toHaveText(help);
  await page.keyboard.press('Escape');
  await waitForPlaying(page);
}

test('Show me walks a stuck player through the cell their hint points at', async ({ page }) => {
  await getStuck(page);
  await chooseMore(page, 'Hint');
  await expect(hintBar(page)).toHaveText(HINT);
  expect(await selectedIndex(page)).toBe(target);

  await showMe(page).click();
  await expect(walkthrough(page)).toBeVisible();
  // A dialog like the others: the board is out of the page while it is open.
  await expect(grid(page)).toHaveCount(0);
  // What it cost, on show and in its description, as the help taken is veiled.
  await expect(walkthrough(page).locator('.walkthrough__charge')).toHaveText('2 hints used.');
  await expect(walkthrough(page)).toHaveAccessibleDescription(/ 2 hints used\.$/);

  const titles = ['Hidden pair', 'Pointing pair or triple', 'Naked single'];
  for (const [k, caption] of CAPTIONS.entries()) {
    await expect(stepHeading(page)).toHaveAccessibleName(`Step ${k + 1} of 3: ${titles[k]}`);
    await expect(stepHeading(page)).toBeFocused();
    await expect(walkthrough(page).getByRole('img')).toHaveAccessibleName(caption);
    if (k < 2) {
      await walkthrough(page)
        .getByRole('button', { name: `Next: ${titles[k + 1]}` })
        .click();
    }
  }
  await expect(walkthrough(page).locator('.walkthrough__answer')).toHaveText(
    'The answer: Row 5, column 2 must be 8.',
  );
  await walkthrough(page).getByRole('button', { name: 'Done' }).click();
  await waitForPlaying(page);
  // Opened with the mouse: back to the board, on the cell it solved.
  await expect(page.getByRole('gridcell', { selected: true })).toBeFocused();
  expect(await selectedIndex(page)).toBe(target);
  // The hint, and Show me itself, each counted once.
  await expectHelpUsed(page, '2 hints');
});

test('a hinted cell shows its hint again whenever it is selected, at no further cost', async ({
  page,
}) => {
  await getStuck(page);
  await chooseMore(page, 'Hint');
  await showMe(page).click();
  await page.keyboard.press('Escape');
  await waitForPlaying(page);

  // Away from the cell, the hint goes; back on it, it returns, Show me and all.
  await arrowTo(page, target, target - 9);
  await expect(hintBar(page)).toHaveText('');
  await arrowTo(page, target - 9, target);
  await expect(hintBar(page)).toHaveText(HINT);
  // A screen reader hears it as the cell's description, not from the status region.
  await expect(page.getByRole('gridcell', { selected: true })).toHaveAccessibleDescription(
    'Look here — a hidden pair will unlock this cell.',
  );

  // Asking again, and opening Show me again, are free.
  await arrowTo(page, target, 0);
  await chooseMore(page, 'Hint');
  expect(await selectedIndex(page)).toBe(target);
  await showMe(page).click();
  await expect(walkthrough(page)).toBeVisible();
  await expect(walkthrough(page).locator('.walkthrough__charge')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await waitForPlaying(page);
  await expectHelpUsed(page, '2 hints');

  // And they are kept with the game.
  await page.reload();
  await resumeButton(page).click();
  await waitForPlaying(page);
  await selectCell(page, target);
  await expect(hintBar(page)).toHaveText(HINT);
  await expectHelpUsed(page, '2 hints');
});

test('a step asks after its technique, and the guide hands back to that step', async ({ page }) => {
  await getStuck(page);
  await chooseMore(page, 'Hint');
  await showMe(page).click();
  await walkthrough(page)
    .getByRole('button', { name: /^Next:/ })
    .click();
  await walkthrough(page)
    .getByRole('button', { name: "What's a pointing pair or triple?" })
    .click();
  const guide = page.getByRole('dialog', { name: 'Solving techniques' });
  await expect(guide.getByRole('heading', { level: 3 })).toHaveText('Pointing pair or triple');
  await page.keyboard.press('Escape');
  await expect(stepHeading(page)).toHaveAccessibleName('Step 2 of 3: Pointing pair or triple');
  await expect(stepHeading(page)).toBeFocused();
});

test('opened from the keyboard, it gives focus back to Show me, and the clock holds', async ({
  page,
}) => {
  await page.clock.install();
  await getStuck(page);
  await chooseMore(page, 'Hint');
  const before = toSeconds(await readTimer(page));
  await showMe(page).focus();
  await page.keyboard.press('Enter');
  await expect(stepHeading(page)).toBeFocused();
  await page.clock.fastForward('10:00');
  await page.keyboard.press('Escape');
  await waitForPlaying(page);
  await expect(showMe(page)).toBeFocused();
  expect(toSeconds(await readTimer(page)) - before).toBeLessThan(30);
});

test('Show me says nothing, for free, of a wrong digit elsewhere, and points at it when pressed', async ({
  page,
}) => {
  await getStuck(page);
  await chooseMore(page, 'Hint');
  // Row 1, column 1 takes a 9; a 6 there breaks no rule, so nothing shows it.
  await arrowTo(page, target, 0);
  await page.keyboard.press('Digit6');
  await arrowTo(page, 0, target);
  // The hint is put afresh from the board as it looks, the 6 and all — so
  // it may read differently — and Show me is still offered.
  await expect(showMe(page)).toBeVisible();

  // Pressed, it does what Hint would: point at the mistake, counted as Hint counts it.
  await showMe(page).click();
  await expect(walkthrough(page)).toHaveCount(0);
  await expect(hintBar(page)).toContainText('This number is incorrect.');
  expect(await selectedIndex(page)).toBe(0);
  await expectHelpUsed(page, '2 hints');

  // Put right, Show me walks through the cell after all.
  await page.keyboard.press('Digit9');
  await arrowTo(page, 0, target);
  await showMe(page).click();
  await expect(stepHeading(page)).toHaveAccessibleName('Step 1 of 3: Hidden pair');
});

test('a hinted cell’s hint is put afresh as the board moves on, agreeing with its Show me', async ({
  page,
}) => {
  await getStuck(page);
  await chooseMore(page, 'Hint');
  // Two right digits in row 5, and the hidden pair is no longer needed.
  await typeDigits(page, [
    { index: target + 3, digit: 9 },
    { index: target + 4, digit: 5 },
  ]);
  await arrowTo(page, target + 4, target);
  await expect(hintBar(page)).toHaveText(
    "Naked single: only one number fits in this cell. What's a naked single? Show me",
  );
  await expect(page.getByRole('gridcell', { selected: true })).toHaveAccessibleDescription(
    'Naked single: only one number fits in this cell.',
  );
  await showMe(page).click();
  await expect(stepHeading(page)).toHaveAccessibleName('Step 1 of 1: Naked single');
  await page.keyboard.press('Escape');
  await waitForPlaying(page);
  // Put afresh, not asked for again: the hint and Show me, once each.
  await expectHelpUsed(page, '2 hints');
});

test.describe('hints from your own candidates', () => {
  // The report that asked for them (see `getStuckOnAnXyChain`), in Auto
  // Candidate Mode: row 2, column 1, whose answer is 9.
  const { target, strikes } = STUCK_ON_AN_XY_CHAIN;
  const at = (row: number, col: number) => (row - 1) * 9 + col - 1;
  const showMeFor = (page: Page) =>
    page.getByRole('button', { name: 'Show me how to solve row 2, column 1' });
  const stepsFor = (page: Page) =>
    page.getByRole('dialog', { name: 'How to solve row 2, column 1' });

  test('Show me moves on once the box/line reduction it starts with is taken', async ({ page }) => {
    await getStuckOnAnXyChain(page);
    await chooseMore(page, 'Hint');
    expect(await selectedIndex(page)).toBe(target);
    await showMeFor(page).click();
    await expect(stepsFor(page).getByRole('heading', { level: 3 })).toHaveAccessibleName(
      'Step 1 of 7: Box/line reduction',
    );
    await page.keyboard.press('Escape');
    await waitForPlaying(page);

    // Its first step taken: the 2s struck from row 8, column 9 and row 9, column 9.
    await modeButton(page, 'Candidate').click();
    await typeDigits(
      page,
      strikes.map(([row, col, digit]) => ({ index: at(row, col), digit })),
    );
    await ensureNormalMode(page);
    await selectCell(page, target);
    await showMeFor(page).click();
    const heading = stepsFor(page).getByRole('heading', { level: 3 });
    await expect(heading).toHaveAccessibleName('Step 1 of 6: Hidden triple');
    // The chain rests on a 2 the player struck, and says so.
    for (let step = 1; step < 5; step++) {
      await stepsFor(page)
        .getByRole('button', { name: /^Next:/ })
        .click();
    }
    await expect(heading).toHaveAccessibleName('Step 5 of 6: XY-Chain');
    await expect(stepsFor(page).getByRole('img')).toHaveAccessibleName(
      /You'd already ruled out 2 from row 9, column 9\./,
    );
  });

  test('a struck answer gets a hint of its own, and Show me names it and puts it back', async ({
    page,
  }) => {
    await getStuckOnAnXyChain(page);
    // The 9 struck out of row 2, column 1: its answer.
    await modeButton(page, 'Candidate').click();
    await typeDigits(page, [{ index: target, digit: 9 }]);
    await ensureNormalMode(page);
    await chooseMore(page, 'Hint');
    await expect(hintBar(page)).toHaveText(
      "This cell is missing a candidate that can't be ruled out yet. Show me",
    );
    expect(await selectedIndex(page)).toBe(target);

    await page.getByRole('button', { name: "Show me what's missing in row 2, column 1" }).click();
    const page9 = page.getByRole('dialog', { name: 'Why row 2, column 1 can still be 9' });
    await expect(page9.getByRole('img')).toHaveAccessibleName(
      "There's no 9 in row 2, in column 1 or in box 1, and no pattern among the candidates " +
        'rules a 9 out of row 2, column 1.',
    );
    await page9.getByRole('button', { name: 'Put the 9 back' }).click();
    await waitForPlaying(page);
    await expect(cell(page, target)).toHaveAccessibleName(/^empty, candidates( \d)* 9$/);
    // Asked for once, and Show me once: two hints, as History lists them.
    await expectHelpUsed(page, /^Auto candidates.*2 hints$/);
  });
});
