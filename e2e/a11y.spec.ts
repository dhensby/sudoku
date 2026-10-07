import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_PUZZLES, gridValues, solve, type Puzzle, type TechniqueId } from '../src/core';
import { GUIDE, GUIDE_ORDER } from '../src/ui/techniqueGuide';
import {
  NEARLY_DONE,
  NEARLY_DONE_2,
  PUZZLES,
  boardArea,
  cellLabels,
  chooseMore,
  dailyRecord,
  emptyCells,
  getStuck,
  gotoPuzzle,
  modeButton,
  openHeaderDialog,
  seedHistory,
  selectCell,
  solveFromKeyboard,
  startButton,
  startPuzzle,
  timer,
  typeDigits,
  waitForPlaying,
} from './helpers';

/**
 * Accessibility, checked by machine: axe-core runs its WCAG 2.2 A and AA
 * rules over the states a player meets — the board in play with every kind
 * of mark on it, the Ready and Paused cards, the "…" menu, every dialog (each
 * step of Show me among them) and each entry of the technique guide — in the
 * light theme and the dark, and
 * each must come back with no violations at all, with no rule switched off.
 * Contrast is the rule that a palette change is likeliest to break:
 * contrast.test.ts holds the tokens to their targets pair by pair, and this
 * is the check that the rendered page, every colour composed, agrees.
 *
 * axe sees one moment of one page, so this is a floor, not a verdict: focus
 * order, what a screen reader says and how the game feels by keyboard are
 * the rest of the suite's job (keyboard play in game.spec.ts, announcements
 * in the unit tests).
 *
 * The desktop layout runs on Chromium; a shorter pass runs on the phones
 * (`iphone`, `android`), whose layout folds the header into a menu and the
 * guide into a bottom sheet. Motion is reduced so nothing is caught
 * mid-fade.
 */

/** Every WCAG 2.0, 2.1 and 2.2 rule at levels A and AA (axe has no rules tagged 2.2 A). */
const WCAG_A_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.use({ reducedMotion: 'reduce' });

/** Run axe over the whole page as it stands, and fail naming each violation and where. */
async function expectAccessible(page: Page, state: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_A_AA).analyze();
  const found = violations.map(
    ({ id, help, nodes }) => `${id} (${help}): ${nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(found, `axe violations in ${state}`).toEqual([]);
}

/** The emulated colour scheme really is the one under test. */
async function expectScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(
    scheme === 'dark',
  );
}

const EASY = PUZZLES.easy;

/**
 * The board mid-game with one of every mark: player digits, a checked
 * correct one (its tick), a revealed one (its italic), a wrong one checked
 * (the slash) that also clashes with a given (the dot), candidates, and
 * the selection moved by key, so it shows the keyboard's focus line.
 */
async function playWithEveryMark(page: Page): Promise<void> {
  await startPuzzle(page, EASY);
  const empties = emptyCells(EASY.givens);
  const right = (index: number) => ({ index, digit: Number(EASY.solution[index]) });
  await typeDigits(page, empties.slice(0, 3).map(right));

  await selectCell(page, empties[1]);
  await chooseMore(page, 'Check cell');
  await selectCell(page, empties[3]);
  await chooseMore(page, 'Reveal cell');

  // A given from the same row: wrong here, and a clash.
  const wrong = empties[4];
  const row = Math.floor(wrong / 9) * 9;
  const clash = [...EASY.givens.slice(row, row + 9)].find((ch) => ch !== '0')!;
  await selectCell(page, wrong);
  await page.keyboard.press(`Digit${clash}`);
  await chooseMore(page, 'Check cell');

  await modeButton(page, 'Candidate').click();
  await selectCell(page, empties[5]);
  await page.keyboard.press('Digit2');
  await page.keyboard.press('Digit7');
  await modeButton(page, 'Normal').click();

  await selectCell(page, empties[2]);
  await page.keyboard.press(empties[2] % 9 === 8 ? 'ArrowLeft' : 'ArrowRight');

  const board = (await cellLabels(page)).join(' | ');
  for (const mark of [', correct', ', revealed', ', conflict, incorrect', 'candidates 2 7']) {
    expect(board).toContain(mark);
  }
}

/** A worked example from the guide, as a link: its technique is the very next step. */
function examplePuzzle(technique: TechniqueId): Puzzle {
  const givens = EXAMPLE_PUZZLES[technique];
  const solution = Array.from(solve(gridValues(givens))!).join('');
  return { givens, solution, difficulty: 'medium' };
}

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/**
 * Today's Hard daily begun an hour ago and left unfinished, on a clock fixed
 * at 10:00 on Tuesday 6 October 2026 (Daily #6), so New game marks today's
 * dailies both ways they can stand so early in the day.
 */
async function startWithTodaysDaily(page: Page): Promise<void> {
  const now = new Date('2026-10-06T10:00:00+01:00');
  await page.clock.install({ time: now });
  await seedHistory(page, [
    dailyRecord('d6', PUZZLES.hard, '2026-10-06', now.getTime() - 3_600_000, 'playing'),
  ]);
  await page.goto('/');
  await waitForPlaying(page);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    test.skip(({ isMobile }) => isMobile, 'the desktop layout; the phones have their own pass');

    test('the board in play, with every mark, a hint and a notice', async ({ page }) => {
      await playWithEveryMark(page);
      await expectScheme(page, scheme);
      await expectAccessible(page, 'the board with every mark');

      // With a wrong number on the board, the hint points at it.
      await chooseMore(page, 'Hint');
      await expect(page.locator('.hint-bar__message')).toBeVisible();
      await expectAccessible(page, 'a hint about a mistake');

      // A hint that names its technique asks "What's a …?".
      await startPuzzle(page, examplePuzzle('pointing'));
      await chooseMore(page, 'Hint');
      await expect(
        page.getByRole('button', { name: "What's a pointing pair or triple?" }),
      ).toBeVisible();
      await expectAccessible(page, 'a hint that names its technique');

      // A link that cannot be read leaves a notice with a Dismiss button.
      await page.goto('/?p=not-a-puzzle');
      await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();
      await expectAccessible(page, 'the broken-link notice');
    });

    test('a hint with Show me, and every step of its walkthrough', async ({ page }) => {
      await getStuck(page);
      await chooseMore(page, 'Hint');
      const show = page.getByRole('button', { name: /^Show me how to solve/ });
      await expect(show).toBeVisible();
      await expectAccessible(page, 'a hint with Show me');

      await show.click();
      const walkthrough = dialog(page, 'How to solve row 5, column 2');
      for (let step = 1; step <= 3; step++) {
        await expect(walkthrough.getByRole('heading', { level: 3 })).toHaveAccessibleName(
          new RegExp(`^Step ${step} of 3: `),
        );
        await expectAccessible(page, `step ${step} of Show me`);
        if (step < 3) await walkthrough.getByRole('button', { name: /^Next:/ }).click();
      }
    });

    test('the Ready and Paused cards', async ({ page }) => {
      await gotoPuzzle(page, PUZZLES.medium.givens);
      await expect(startButton(page)).toBeVisible();
      await expectAccessible(page, 'the Ready card');

      await gotoPuzzle(page, PUZZLES.hard.givens, {
        challenge: { seconds: 323, name: 'Dan', assists: 'ch2' },
      });
      await expect(startButton(page)).toBeVisible();
      await expectAccessible(page, 'the Ready card with a challenge');

      await startButton(page).click();
      await waitForPlaying(page);
      await timer(page).click();
      await expect(boardArea(page).getByRole('button', { name: 'Resume' })).toBeVisible();
      await expectAccessible(page, 'the Paused card');
    });

    test('the menus and the dialogs a game opens', async ({ page }) => {
      await playWithEveryMark(page);

      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
      await expectAccessible(page, 'the "…" menu');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'New game' }).click();
      await expect(page.getByRole('menu', { name: 'New game' })).toBeVisible();
      await expectAccessible(page, 'the New game menu');
      await page.keyboard.press('Escape');

      await chooseMore(page, 'Reset puzzle…');
      await expect(dialog(page, 'Reset puzzle?')).toBeVisible();
      await expectAccessible(page, 'the Reset confirmation');
      await closeDialog(page);

      for (const [label, title] of [
        ['Settings', 'Settings'],
        ['Help', 'Help'],
        ['Share', 'Share this puzzle'],
        ['History', 'History'],
      ] as const) {
        await openHeaderDialog(page, label);
        await expect(dialog(page, title)).toBeVisible();
        await expectAccessible(page, `the ${title} dialog`);
        await closeDialog(page);
      }
    });

    test('New game with today’s dailies', async ({ page }) => {
      await startWithTodaysDaily(page);
      await expectScheme(page, scheme);
      await page.getByRole('button', { name: 'New game' }).click();
      await expect(
        page.getByRole('menuitem', { name: "Today's Hard puzzle, in progress" }),
      ).toBeVisible();
      await expectAccessible(page, 'New game with today’s dailies');
    });

    test('every entry of the technique guide', async ({ page }) => {
      await startPuzzle(page, EASY);
      await openHeaderDialog(page, 'Solving techniques');
      const guide = dialog(page, 'Solving techniques');
      const list = guide.getByRole('navigation', { name: 'Techniques', exact: true });
      for (const id of GUIDE_ORDER) {
        const { title } = GUIDE[id];
        await list.getByRole('button', { name: title, exact: true }).click();
        await expect(guide.getByRole('heading', { level: 3 })).toHaveText(title);
        await expectAccessible(page, `the guide's ${title}`);
      }
    });

    test('finishing: Solved!, sharing the time, a challenge and History', async ({ page }) => {
      // A time worth sharing is at least a second.
      await page.clock.install();
      await startPuzzle(page, NEARLY_DONE);
      await page.clock.fastForward('00:12');
      await solveFromKeyboard(page, NEARLY_DONE);
      const solved = dialog(page, 'Solved!');
      await expect(solved).toBeVisible();
      await expectAccessible(page, 'the Solved! dialog');

      await solved.getByRole('button', { name: 'Share your time' }).click();
      const share = dialog(page, 'Share your time');
      await share.getByRole('textbox', { name: 'Your name (optional)' }).fill('Alice');
      await expectAccessible(page, 'the Share your time dialog');
      await closeDialog(page);
      await expectAccessible(page, 'the solved board');

      await gotoPuzzle(page, NEARLY_DONE.givens, { challenge: { seconds: 90, name: 'Dan' } });
      await expect(dialog(page, "You've solved this one")).toBeVisible();
      await expectAccessible(page, "the You've solved this one dialog");
      await closeDialog(page);

      // Head to head: a friend's time to beat, then beaten.
      await startPuzzle(page, NEARLY_DONE_2, {
        challenge: { seconds: 300, name: 'Alexandra', assists: 'ch2' },
      });
      await page.clock.fastForward('00:05');
      await solveFromKeyboard(page, NEARLY_DONE_2);
      await expect(
        dialog(page, 'Solved!').getByRole('region', { name: 'Head to head' }),
      ).toBeVisible();
      await expectAccessible(page, 'the Solved! dialog, head to head');
      await closeDialog(page);

      await openHeaderDialog(page, 'History');
      const history = dialog(page, 'History');
      await expect(history.getByRole('list', { name: 'Games, newest first' })).toBeVisible();
      await expectAccessible(page, 'the History dialog with games');
      await history
        .getByRole('button', { name: /^Delete / })
        .first()
        .click();
      await expect(history.getByRole('button', { name: /^Confirm delete/ })).toBeVisible();
      await expectAccessible(page, 'a History row asking to confirm a delete');
    });
  });
}

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the phone layout');

  for (const scheme of ['light', 'dark'] as const) {
    test(`Show me as a bottom sheet, every step, in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await getStuck(page);
      await expectScheme(page, scheme);
      await chooseMore(page, 'Hint');
      await expectAccessible(page, 'a hint with Show me');
      await page.getByRole('button', { name: /^Show me how to solve/ }).click();
      const walkthrough = dialog(page, 'How to solve row 5, column 2');
      for (let step = 1; step <= 3; step++) {
        await expect(walkthrough.getByRole('heading', { level: 3 })).toHaveAccessibleName(
          new RegExp(`^Step ${step} of 3: `),
        );
        await expectAccessible(page, `step ${step} of Show me`);
        if (step < 3) await walkthrough.getByRole('button', { name: /^Next:/ }).click();
      }
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`New game on its side, in the ${scheme} theme`, async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.emulateMedia({ colorScheme: scheme });
      await startWithTodaysDaily(page);
      await expectScheme(page, scheme);
      await page.getByRole('button', { name: 'New game' }).click();
      await expect(page.getByRole('menuitem', { name: 'Expert', exact: true })).toBeVisible();
      await expectAccessible(page, 'New game on its side');
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`the board, the menus, a dialog and the guide in the ${scheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await gotoPuzzle(page, PUZZLES.medium.givens);
      await expectScheme(page, scheme);
      await expectAccessible(page, 'the Ready card');

      await playWithEveryMark(page);
      await expectAccessible(page, 'the board with every mark');

      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
      await expectAccessible(page, 'the "…" menu');
      await page.keyboard.press('Escape');

      await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
      await expect(page.getByRole('menu', { name: 'Menu' })).toBeVisible();
      await expectAccessible(page, 'the header menu');
      await page.keyboard.press('Escape');

      await openHeaderDialog(page, 'Settings');
      await expect(dialog(page, 'Settings')).toBeVisible();
      await expectAccessible(page, 'the Settings dialog');
      await closeDialog(page);

      await openHeaderDialog(page, 'Solving techniques');
      const sheet = dialog(page, 'Solving techniques');
      await sheet.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'X-Wing' });
      await expect(sheet.getByRole('heading', { level: 3 })).toHaveText('X-Wing');
      await expectAccessible(page, 'the guide as a bottom sheet');
    });
  }
});
