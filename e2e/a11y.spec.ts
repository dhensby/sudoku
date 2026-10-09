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
 * light theme and the dark (and the main ones in High contrast), and
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
 * mid-fade. High contrast has passes of its own, both ways it comes —
 * chosen in Settings, and from a dark system asking for more contrast —
 * which also measure what a colour check cannot: its heavier box lines,
 * and its same-number ring kept clear of the digits.
 */

/** Every WCAG 2.0, 2.1 and 2.2 rule at levels A and AA (axe has no rules tagged 2.2 A). */
const WCAG_A_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.use({ reducedMotion: 'reduce' });

/** Run axe over the whole page as it stands, and fail naming each violation and where. */
async function expectAccessible(page: Page, state: string): Promise<void> {
  // Less motion still leaves every change of style a transition of 0.01ms (index.css sets the
  // duration on everything, and transition-property defaults to all), and WebKit can take a frame
  // or more to end one: axe, run inside it, read a calendar day just unchosen in its old ink over
  // its new ground. Waiting on getAnimations() did not catch it there. Turning transitions off
  // cancels any in flight, which jumps it to its end, so the page is read at rest — all a scan
  // of colours and names is about.
  await page.evaluate(() => {
    if (document.getElementById('a11y-at-rest') !== null) return;
    const style = document.createElement('style');
    style.id = 'a11y-at-rest';
    style.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.append(style);
  });
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

/** London noon on a date of October 2026, in epoch ms. */
const octoberNoon = (day: number) =>
  new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00+01:00`).getTime();

/**
 * A week of dailies played every way there is, on a clock fixed at Tuesday
 * 13 October 2026 (Daily #7): solved on the day, solved later, in progress
 * and not started, so the calendar shows every mark, on the chosen day and
 * off it.
 */
async function openSeededCalendar(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-10-13T10:00:00+01:00') });
  await seedHistory(page, [
    dailyRecord('d1', PUZZLES.easy, '2026-10-08', octoberNoon(8)),
    dailyRecord('d2', PUZZLES.hard, '2026-10-08', octoberNoon(10)),
    dailyRecord('d3', PUZZLES.medium, '2026-10-09', octoberNoon(9), 'playing'),
    dailyRecord('d4', PUZZLES.expert, '2026-10-12', octoberNoon(12)),
    dailyRecord('d5', PUZZLES.easy, '2026-10-12', octoberNoon(12)),
    dailyRecord('d6', PUZZLES.hard, '2026-10-13', octoberNoon(13) - 7_200_000, 'playing'),
  ]);
  await page.goto('/');
  await waitForPlaying(page);
  await openHeaderDialog(page, 'Daily puzzles');
  await expect(dialog(page, 'Daily puzzles').getByRole('grid')).toBeVisible();
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

    test('the daily calendar, its marks and a day chosen, and New game with today’s', async ({
      page,
    }) => {
      await openSeededCalendar(page);
      await expectScheme(page, scheme);
      await expectAccessible(page, 'the daily calendar on today');
      const calendar = dialog(page, 'Daily puzzles');
      await calendar.getByRole('gridcell', { name: /^Thursday 8 October/ }).click();
      await expect(calendar.getByRole('heading', { name: 'Thursday 8 October' })).toBeVisible();
      await expectAccessible(page, 'the daily calendar on a day played every way');
      // The keyboard's ring on a day.
      await page.keyboard.press('ArrowRight');
      await expectAccessible(page, 'the daily calendar under the keyboard');
      await closeDialog(page);

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

/**
 * High contrast comes two ways: chosen in Settings, and under System on a
 * dark device that asks for more contrast. The chosen way runs on a dark
 * device that asks for nothing more — the tester's own setup, and the one
 * where the dark palette's block matches too, at the same specificity, so
 * High contrast wins only by coming after it in the stylesheet. (On a light
 * device it would win by specificity alone and prove nothing about order.)
 * Each way runs the same checks.
 */
const HIGH_CONTRAST_WAYS = [
  { way: 'chosen in Settings on a dark device', isChosen: true, media: { colorScheme: 'dark' } },
  {
    way: 'from a dark system asking for more contrast',
    isChosen: false,
    media: { colorScheme: 'dark', contrast: 'more' },
  },
] as const;

/** Pick High contrast in Settings, checking the dialog as it stands in it. */
async function chooseHighContrast(page: Page): Promise<void> {
  await openHeaderDialog(page, 'Settings');
  await dialog(page, 'Settings').getByRole('radio', { name: 'High contrast' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
  await expectAccessible(page, 'the Settings dialog in High contrast');
  await closeDialog(page);
}

/** Open Settings and check it; the way High contrast came decides which theme shows as chosen. */
async function checkSettings(page: Page, isChosen: boolean): Promise<void> {
  await openHeaderDialog(page, 'Settings');
  const settings = dialog(page, 'Settings');
  await expect(
    settings.getByRole('radio', { name: isChosen ? 'High contrast' : 'System' }),
  ).toBeChecked();
  await expectAccessible(page, 'the Settings dialog in High contrast');
  await closeDialog(page);
}

/**
 * The page is in High contrast: its palette, and the browser chrome's colour
 * with it. The page is read as painted, not by its `--bg` token's text: the
 * build minifies `#000000` to `#000`, so only the computed colour is stable.
 * The theme-colour meta is set from script, so it keeps its long form.
 */
async function expectHighContrast(page: Page, isChosen: boolean): Promise<void> {
  const shown = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    bg: getComputedStyle(document.body).backgroundColor,
    chrome: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
  }));
  expect(shown).toEqual({
    theme: isChosen ? 'contrast' : null,
    bg: 'rgb(0, 0, 0)',
    chrome: '#000000',
  });
}

/**
 * Select a given, so its number's other cells take High contrast's yellow
 * ring, and measure the board: box lines at least 3px inside a frame of at
 * least 4px, at whatever size the board is, and the ring clear of every
 * digit it surrounds — yellow against white is barely 1.4:1.
 */
async function expectHighContrastBoard(page: Page, givens: string): Promise<void> {
  await selectCell(
    page,
    [...givens].findIndex((ch) => ch !== '0'),
  );
  const measured = await page.evaluate(() => {
    const board = document.querySelector('.board')!;
    const cells = [...board.querySelectorAll('.cell')].map((cell) => cell.getBoundingClientRect());
    const clearances = [...board.querySelectorAll('.cell--same')].map((cell) => {
      const edge = cell.getBoundingClientRect();
      const digit = cell.querySelector('.cell__value')!.getBoundingClientRect();
      return Math.min(
        digit.left - edge.left,
        edge.right - digit.right,
        digit.top - edge.top,
        edge.bottom - digit.bottom,
      );
    });
    const root = getComputedStyle(document.documentElement);
    return {
      frame: parseFloat(getComputedStyle(board).borderTopWidth),
      // Between the third and fourth cells of the first row.
      boxLine: cells[3].left - cells[2].right,
      ring: parseFloat(root.getPropertyValue('--hl-same-ring-width')),
      ringed: clearances.length,
      clearance: Math.min(...clearances),
    };
  });
  expect(measured.frame).toBeGreaterThanOrEqual(4);
  expect(measured.boxLine).toBeGreaterThanOrEqual(3);
  expect(measured.ring).toBe(2);
  expect(measured.ringed).toBeGreaterThan(0);
  expect(measured.clearance).toBeGreaterThan(measured.ring);
}

for (const { way, isChosen, media } of HIGH_CONTRAST_WAYS) {
  test.describe(`the High contrast theme, ${way}`, () => {
    test.skip(({ isMobile }) => isMobile, 'the desktop layout; the phones have their own pass');

    test('the board in play, with every mark, and the dialogs', async ({ page }) => {
      await page.emulateMedia(media);
      await playWithEveryMark(page);
      if (isChosen) await chooseHighContrast(page);
      await expectHighContrast(page, isChosen);
      await checkSettings(page, isChosen);

      await expectHighContrastBoard(page, EASY.givens);
      await expectAccessible(page, 'the board with every mark');

      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
      await expectAccessible(page, 'the "…" menu');
      await page.keyboard.press('Escape');

      for (const [label, title] of [
        ['Help', 'Help'],
        ['History', 'History'],
      ] as const) {
        await openHeaderDialog(page, label);
        await expect(dialog(page, title)).toBeVisible();
        await expectAccessible(page, `the ${title} dialog`);
        await closeDialog(page);
      }
    });

    test('the daily calendar, its marks and a day chosen', async ({ page }) => {
      await page.emulateMedia(media);
      await openSeededCalendar(page);
      if (isChosen) {
        await closeDialog(page);
        await chooseHighContrast(page);
        await openHeaderDialog(page, 'Daily puzzles');
      }
      await expectHighContrast(page, isChosen);
      await expectAccessible(page, 'the daily calendar on today');
      const calendar = dialog(page, 'Daily puzzles');
      await calendar.getByRole('gridcell', { name: /^Thursday 8 October/ }).click();
      await expect(calendar.getByRole('heading', { name: 'Thursday 8 October' })).toBeVisible();
      await expectAccessible(page, 'the daily calendar on a day played every way');
      await page.keyboard.press('ArrowRight');
      await expectAccessible(page, 'the daily calendar under the keyboard');
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
    test(`the daily calendar as a bottom sheet in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openSeededCalendar(page);
      await expectScheme(page, scheme);
      await expectAccessible(page, 'the daily calendar on today');
      const calendar = dialog(page, 'Daily puzzles');
      await calendar.getByRole('gridcell', { name: /^Thursday 8 October/ }).tap();
      await expect(calendar.getByRole('heading', { name: 'Thursday 8 October' })).toBeVisible();
      await expectAccessible(page, 'the daily calendar on a day played every way');
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`New game and the daily calendar on its side, in the ${scheme} theme`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.emulateMedia({ colorScheme: scheme });
      await openSeededCalendar(page);
      await expectScheme(page, scheme);
      await expectAccessible(page, 'the daily calendar on its side');
      await closeDialog(page);
      await page.getByRole('button', { name: 'New game' }).click();
      await expect(page.getByRole('menuitem', { name: 'Expert', exact: true })).toBeVisible();
      await expectAccessible(page, 'New game on its side');
    });
  }

  // The calendar and the board are separate tests, as on the desktop: the
  // calendar's seeded week holds this Easy puzzle solved, so opening it as a
  // link after the seed lands on "You've solved this one", not a fresh board.
  for (const { way, isChosen, media } of HIGH_CONTRAST_WAYS) {
    test(`the daily calendar as a bottom sheet in High contrast, ${way}`, async ({ page }) => {
      await page.emulateMedia(media);
      await openSeededCalendar(page);
      if (isChosen) {
        await closeDialog(page);
        await chooseHighContrast(page);
        await openHeaderDialog(page, 'Daily puzzles');
      }
      await expectHighContrast(page, isChosen);
      await expectAccessible(page, 'the daily calendar on today');
      const calendar = dialog(page, 'Daily puzzles');
      await calendar.getByRole('gridcell', { name: /^Thursday 8 October/ }).tap();
      await expect(calendar.getByRole('heading', { name: 'Thursday 8 October' })).toBeVisible();
      await expectAccessible(page, 'the daily calendar on a day played every way');
    });

    test(`the board and a dialog in High contrast, ${way}`, async ({ page }) => {
      await page.emulateMedia(media);
      await playWithEveryMark(page);
      if (isChosen) await chooseHighContrast(page);
      await expectHighContrast(page, isChosen);
      await expectHighContrastBoard(page, EASY.givens);
      await expectAccessible(page, 'the board with every mark');
      await checkSettings(page, isChosen);
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
