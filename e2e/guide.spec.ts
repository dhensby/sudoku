import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_PUZZLES, gridValues, solve, type Puzzle, type TechniqueId } from '../src/core';
import { GUIDE, guideExamples } from '../src/ui/techniqueGuide';
import {
  chooseMore,
  grid,
  openHeaderDialog,
  readTimer,
  selectedIndex,
  startPuzzle,
  toSeconds,
  waitForPlaying,
} from './helpers';

/**
 * The guide to the solving techniques, end to end: the question a hint asks
 * ("What's a pointing pair or triple?") opening the guide at that entry,
 * browsing it with the list and with Previous and Next, the header's book
 * button, Help handing over to it, and the clock holding while it is open.
 *
 * Hints come from the guide's own worked examples, opened as share links:
 * each is a real puzzle on which its technique is the very next step, so the
 * hint names that technique.
 *
 * Runs on Chromium (desktop layout). The phone's bottom sheet is in
 * touch.spec.ts.
 */

/** A worked example's board, as a puzzle a link can carry. */
function examplePuzzle(technique: TechniqueId): Puzzle {
  const givens = EXAMPLE_PUZZLES[technique];
  const solution = Array.from(solve(gridValues(givens))!).join('');
  return { givens, solution, difficulty: 'medium' };
}

const guide = (page: Page) => page.getByRole('dialog', { name: 'Solving techniques' });

/** The open entry's title. */
const entryHeading = (page: Page) => guide(page).getByRole('heading', { level: 3 });

const list = (page: Page) =>
  guide(page).getByRole('navigation', { name: 'Techniques', exact: true });

/** Take a hint on a worked example's board. */
async function hintOn(page: Page, technique: TechniqueId): Promise<void> {
  await startPuzzle(page, examplePuzzle(technique));
  await chooseMore(page, 'Hint');
}

test.describe('from a hint', () => {
  test("the hint's question opens the guide at its technique, worked example and all", async ({
    page,
  }) => {
    await hintOn(page, 'pointing');
    const hint = page.locator('.hint-bar');
    await expect(hint).toHaveText(
      "Look here — a pointing pair or triple will unlock this cell. What's a pointing pair or triple? Show me",
    );
    const hinted = await selectedIndex(page);
    await hint.getByRole('button', { name: "What's a pointing pair or triple?" }).click();

    await expect(guide(page)).toBeVisible();
    await expect(entryHeading(page)).toHaveText('Pointing pair or triple');
    await expect(entryHeading(page)).toBeFocused();
    await expect(
      list(page).getByRole('button', { name: 'Pointing pair or triple' }),
    ).toHaveAttribute('aria-current', 'true');
    const [example] = guideExamples('pointing');
    await expect(guide(page).getByRole('img')).toHaveAccessibleName(example.caption);
    await expect(guide(page).getByText(GUIDE.pointing.summary)).toBeVisible();
    // A dialog like the others: the board is out of the page while it is open.
    await expect(grid(page)).toHaveCount(0);

    await page.keyboard.press('Escape');
    await waitForPlaying(page);
    // Opened with the mouse: focus goes back to the board, where it was.
    expect(await selectedIndex(page)).toBe(hinted);
    await expect(page.getByRole('gridcell', { selected: true })).toBeFocused();
    await expect(
      hint.getByRole('button', { name: "What's a pointing pair or triple?" }),
    ).toBeVisible();
  });

  test('a hint asks after the technique it names, singles included', async ({ page }) => {
    await hintOn(page, 'hiddenSingleBox');
    await page.getByRole('button', { name: "What's a hidden single?" }).click();
    await expect(entryHeading(page)).toHaveText('Hidden single');
    // Both examples, in a box and along a line.
    await expect(guide(page).getByRole('img')).toHaveCount(2);
  });

  test('opened from the keyboard, it gives focus back to the question', async ({ page }) => {
    await hintOn(page, 'xWing');
    const question = page.getByRole('button', { name: "What's an X-Wing?" });
    await question.focus();
    await page.keyboard.press('Enter');
    await expect(entryHeading(page)).toHaveText('X-Wing');
    await expect(entryHeading(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await waitForPlaying(page);
    await expect(question).toBeFocused();
  });
});

test.describe('browsing', () => {
  test('the list and Previous and Next move between entries, each heading taking focus', async ({
    page,
  }) => {
    await startPuzzle(page, examplePuzzle('fullHouse'));
    await openHeaderDialog(page, 'Solving techniques');
    await expect(entryHeading(page)).toHaveText('Full house');
    await expect(entryHeading(page)).toBeFocused();
    // Beside the entry on a desktop, so the phone's picker is not shown.
    await expect(list(page)).toBeVisible();
    await expect(guide(page).getByRole('combobox', { name: 'Technique' })).toBeHidden();
    await expect(guide(page).getByRole('button', { name: /^Previous/ })).toHaveCount(0);

    const next = guide(page).getByRole('button', { name: 'Next: Hidden single' });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(entryHeading(page)).toHaveText('Hidden single');
    await expect(entryHeading(page)).toBeFocused();
    // Back at the top of the new entry.
    expect(
      await guide(page)
        .locator('.dialog__body')
        .evaluate((el) => el.scrollTop),
    ).toBe(0);

    await guide(page).getByRole('button', { name: 'Previous: Full house' }).click();
    await expect(entryHeading(page)).toHaveText('Full house');

    await list(page).getByRole('button', { name: 'XYZ-Wing' }).click();
    await expect(entryHeading(page)).toHaveText('XYZ-Wing');
    await expect(entryHeading(page)).toBeFocused();
    await expect(guide(page).getByRole('button', { name: /^Next/ })).toHaveCount(0);
    await expect(guide(page).getByRole('button', { name: 'Previous: XY-Wing' })).toBeVisible();
  });

  test('Tab and Shift+Tab carry on from the entry heading, not from the ends of the dialog', async ({
    page,
  }) => {
    await startPuzzle(page, examplePuzzle('fullHouse'));
    await openHeaderDialog(page, 'Solving techniques');
    const choose = async (name: string) => {
      await list(page).getByRole('button', { name, exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(entryHeading(page)).toHaveText(name);
      await expect(entryHeading(page)).toBeFocused();
    };

    // On from the heading to the entry's own Previous and Next…
    await choose('Swordfish');
    await page.keyboard.press('Tab');
    await expect(guide(page).getByRole('button', { name: 'Previous: X-Wing' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(guide(page).getByRole('button', { name: 'Next: XY-Wing' })).toBeFocused();

    // …and back from it to the list, the picker beside it being hidden here.
    await choose('Hidden pair');
    await page.keyboard.press('Shift+Tab');
    await expect(list(page).getByRole('button', { name: 'XYZ-Wing' })).toBeFocused();
  });

  test('Help hands over to the guide, which closes back to the game', async ({ page }) => {
    await startPuzzle(page, examplePuzzle('fullHouse'));
    await openHeaderDialog(page, 'Help');
    await page.getByRole('button', { name: 'Browse the solving techniques' }).click();
    await expect(page.getByRole('dialog', { name: 'Help' })).toHaveCount(0);
    await expect(entryHeading(page)).toHaveText('Full house');
    await guide(page).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await waitForPlaying(page);
  });

  test('the clock holds while the guide is open, and no help is recorded for reading it', async ({
    page,
  }) => {
    await page.clock.install();
    await startPuzzle(page, examplePuzzle('nakedPair'));
    await openHeaderDialog(page, 'Solving techniques');
    await expect(guide(page)).toBeVisible();
    await page.clock.fastForward('10:00');
    await page.keyboard.press('Escape');
    await waitForPlaying(page);
    expect(toSeconds(await readTimer(page))).toBeLessThan(30);

    await openHeaderDialog(page, 'History');
    const history = page.getByRole('dialog', { name: 'History' });
    await expect(history.getByRole('list', { name: 'Help used' })).toHaveCount(0);
  });
});
