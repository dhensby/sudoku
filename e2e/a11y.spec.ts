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
  getStuckOnAnXyChain,
  gotoPuzzle,
  leaveOutAnAnswer,
  modeButton,
  openHeaderDialog,
  placedSolve,
  puzzleLink,
  seedFriends,
  seedHistory,
  selectCell,
  solveFromKeyboard,
  solveWithAMistake,
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
 * step of Show me, the Show me of a missing candidate, Friends with a name
 * being changed and with two friends being merged, and "Who sent this?"
 * with friends to choose from, among them), each entry of the technique
 * guide, and a step hint with its houses tinted on the board — in the light
 * theme and the dark (and the main ones, the tint among them, in High
 * contrast), and each must come back with no violations at all, with no
 * rule switched off.
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

/** "Check guesses when entered" and "Show error counter" switched on, from Settings. */
async function turnOnMistakeSettings(page: Page): Promise<void> {
  await openHeaderDialog(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('checkbox', { name: 'Check guesses when entered' }).check();
  await settings.getByRole('checkbox', { name: 'Show error counter' }).check();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
}

/** A wrong number in the first empty cell, marked as it goes in with Check guesses on. */
async function enterAWrongNumber(page: Page): Promise<void> {
  const [first] = emptyCells(EASY.givens);
  await typeDigits(page, [{ index: first, digit: (Number(EASY.solution[first]) % 9) + 1 }]);
  expect((await cellLabels(page))[first]).toMatch(/, incorrect$/);
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
 * "Watch your solve" on a solve with a counted mistake, from its Solved
 * dialog, checked at the start, on the mistake, and at the solve.
 */
async function watchASolve(page: Page, opener: 'Solved!' | 'History' = 'Solved!'): Promise<void> {
  if (opener === 'Solved!') {
    await dialog(page, 'Solved!').getByRole('button', { name: 'Watch your solve' }).click();
  } else {
    await openHeaderDialog(page, 'History');
    await dialog(page, 'History')
      .getByRole('button', { name: /^Watch your solve, / })
      .first()
      .click();
  }
  const playback = dialog(page, 'Your solve');
  const caption = playback.locator('.playback__caption');
  await expect(caption).toHaveText('Before the first move');
  await expectAccessible(page, 'Watch your solve, at the start');
  await page.keyboard.press('ArrowRight');
  await expect(caption).toHaveText(/— a mistake$/);
  await expect(playback.locator('.cell--current')).toHaveCount(1);
  await expectAccessible(page, 'Watch your solve, on its mistake');
  await page.keyboard.press('End');
  await expect(caption).toHaveText(/— solved$/);
  await expectAccessible(page, 'Watch your solve, at the solve');
}

/**
 * A friend's solve, from a link: the Ready card offering it, the warning
 * before watching it, the solve played back, the card after it, and the
 * Solved dialog with no time; then a solve of the player's own shared with
 * the solve switched on. `before` runs once the link is open (to choose High
 * contrast, say).
 */
async function friendsSolve(page: Page, before?: () => Promise<void>): Promise<void> {
  await page.clock.install();
  const { log, seconds } = placedSolve(NEARLY_DONE);
  await page.goto(`${puzzleLink(NEARLY_DONE.givens, { seconds, name: 'Alice' })}&s=${log}`);
  const watch = boardArea(page).getByRole('button', { name: "Watch Alice's solve" });
  await expect(watch).toBeVisible();
  await before?.();
  await expectAccessible(page, "the Ready card with a friend's solve");

  await watch.click();
  await expect(dialog(page, "Watch Alice's solve?")).toBeVisible();
  await expectAccessible(page, "the warning before watching a friend's solve");
  await dialog(page, "Watch Alice's solve?").getByRole('button', { name: 'Watch anyway' }).click();
  await expect(dialog(page, "Alice's solve")).toBeVisible();
  await page.keyboard.press('End');
  await expectAccessible(page, "a friend's solve played back");
  await closeDialog(page);
  await expect(boardArea(page)).toContainText('so no time will be recorded');
  await expectAccessible(page, 'the Ready card after watching');

  await startButton(page).click();
  await waitForPlaying(page);
  await solveFromKeyboard(page, NEARLY_DONE);
  await expect(dialog(page, 'Solved!')).toContainText('no time recorded');
  await expectAccessible(page, 'the Solved! dialog with no time, against a friend');
  await closeDialog(page);

  await startPuzzle(page, NEARLY_DONE_2);
  await page.clock.fastForward('00:05');
  await solveFromKeyboard(page, NEARLY_DONE_2);
  await dialog(page, 'Solved!').getByRole('button', { name: 'Share your time' }).click();
  const share = dialog(page, 'Share your time');
  await share.getByRole('checkbox', { name: 'Include my solve' }).check();
  await expectAccessible(page, 'the Share dialog with the solve included');
}

/**
 * Two solves compared: a friend's from a link, against the player's own,
 * played first — from the Solved dialog, at the moment it opens on, at the
 * start, and at the end with the chart's table shown. `before` runs once the
 * link is open (to choose High contrast, say).
 */
async function compareSolves(page: Page, before?: () => Promise<void>): Promise<void> {
  await page.clock.install();
  // The friend's three cells at 0:04, 0:08 and 0:12; the player's all at 0:05.
  const { log, seconds } = placedSolve(NEARLY_DONE, 4000);
  await page.goto(`${puzzleLink(NEARLY_DONE.givens, { seconds, name: 'Alice' })}&s=${log}`);
  await expect(startButton(page)).toBeVisible();
  await before?.();
  await startButton(page).click();
  await waitForPlaying(page);
  await page.clock.fastForward('00:05');
  await solveFromKeyboard(page, NEARLY_DONE);
  await dialog(page, 'Solved!').getByRole('button', { name: 'Compare solves' }).click();
  const compare = dialog(page, 'You vs Alice');
  const chart = compare.getByRole('slider', { name: 'Time' });
  await expect(chart).toBeFocused();
  // It opens at 0:05: a cell both of you had, and two only the player had.
  await expect(compare.locator('.cell--compare-both')).toHaveCount(1);
  await expect(compare.locator('.cell--compare-mine')).toHaveCount(2);
  await expectAccessible(page, 'two solves compared');
  // At 0:04 the friend has a cell and the player none: the friend's ink.
  await page.keyboard.press('ArrowLeft');
  await expect(compare.locator('.cell--compare-theirs')).toHaveCount(1);
  await expectAccessible(page, 'two solves compared, the friend ahead');
  await page.keyboard.press('End');
  await compare.getByRole('button', { name: 'Show as table' }).click();
  await expect(compare.getByRole('table', { name: 'Cells solved, of 3' })).toBeVisible();
  await expectAccessible(page, 'two solves compared, shown as a table');
}

/**
 * Friends as a browser that has had their links holds them: one named here
 * on two devices (so their row counts them), one going by their link's name,
 * and one whose links give none.
 */
const SEEDED_FRIENDS = [
  {
    name: 'Ally',
    devices: [
      { id: 'k3x9q7za2m', sentAs: 'Rude McRudeface', lastAt: Date.UTC(2026, 9, 1, 9) },
      { id: 'p0d4wq81xe', sentAs: 'Al', lastAt: Date.UTC(2026, 9, 2, 9) },
    ],
  },
  { devices: [{ id: 'q1w2e3r4t5', sentAs: 'Alexandra', lastAt: Date.UTC(2026, 9, 3, 9) }] },
  { devices: [{ id: 'z8c2m5r1to', lastAt: Date.UTC(2026, 9, 4, 9) }] },
];

/**
 * A link from someone new, noted as it opens: "Who sent this?" first, its
 * field focused on the name the link gave and the seeded friends offered
 * below it, then skipped; then History with Friends at its foot, Friends —
 * the new sender and the seeded three, every kind of row, a merged friend's
 * devices among them — and Friends with a name being changed, and with a
 * merge open. `before` runs first, on a puzzle of its own (to choose High
 * contrast, say): the question comes before anything the link opens, the
 * header's menus with it.
 */
async function friendsList(page: Page, before?: () => Promise<void>): Promise<void> {
  await seedFriends(page, SEEDED_FRIENDS);
  if (before !== undefined) {
    await gotoPuzzle(page, EASY.givens);
    await before();
  }
  await gotoPuzzle(page, NEARLY_DONE.givens, {
    challenge: { seconds: 90, name: 'Newcomer', playerId: 'n3wc0m3r42' },
  });
  const whoSent = dialog(page, 'Who sent this?');
  await expect(whoSent.getByRole('textbox', { name: 'Their name' })).toBeFocused();
  await expect(whoSent.getByRole('textbox', { name: 'Their name' })).toHaveValue('Newcomer');
  await expect(
    whoSent.getByRole('combobox', {
      name: 'Or is it a friend you have already, on another device?',
    }),
  ).toBeVisible();
  await expectAccessible(page, 'Who sent this?');
  await whoSent.getByRole('button', { name: 'Skip' }).click();
  await expect(startButton(page)).toBeVisible();
  await openHeaderDialog(page, 'History');
  const open = dialog(page, 'History').getByRole('button', { name: 'Friends' });
  await expect(open).toBeVisible();
  await expectAccessible(page, 'History with Friends at its foot');

  await open.click();
  const friends = dialog(page, 'Friends');
  const rows = friends.getByRole('list', { name: 'Friends, latest first' }).locator(':scope > li');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('Newcomer');
  await expect(friends.getByRole('list', { name: /^Devices, Ally,/ })).toBeVisible();
  await expectAccessible(page, 'the Friends dialog');

  await friends.getByRole('button', { name: /^Rename Ally,/ }).click();
  await expect(friends.getByRole('textbox', { name: 'Their name' })).toBeFocused();
  await expectAccessible(page, 'Friends with a name being changed');

  await page.keyboard.press('Escape');
  await friends.getByRole('button', { name: /^Merge Ally,/ }).click();
  await expect(friends.getByRole('combobox', { name: 'Same person as' })).toBeFocused();
  await expectAccessible(page, 'Friends with two friends being merged');
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

    test('the error counter, and a number marked as it was entered', async ({ page }) => {
      await startPuzzle(page, EASY);
      await turnOnMistakeSettings(page);
      await enterAWrongNumber(page);
      await expect(page.locator('.error-counter--header [aria-hidden="true"]')).toHaveText(
        /^Mistakes 1$/,
      );
      // Check guesses is help, and help taken says so over the counter.
      await expect(page.locator('.help-taken--header .help-taken__full')).toHaveText(
        'Checked as entered',
      );
      await expectAccessible(page, 'the board with the error counter beside the timer');
    });

    test('help taken beside the timer, as it ticks, and the hints used on Hint', async ({
      page,
    }) => {
      await startPuzzle(page, EASY);
      await page.getByRole('switch', { name: 'Auto Candidate Mode' }).click();
      await chooseMore(page, 'Hint');
      const help = page.locator('.help-taken--header');
      await expect(help).toBeVisible();
      await expect(help.locator('.help-taken__full')).toHaveText('Auto candidates · 1 hint');
      await expect(help.getByText('Help taken: auto candidates, 1 hint')).toBeAttached();
      await expectAccessible(page, 'help taken beside the timer');

      await page.getByRole('button', { name: 'More' }).click();
      await expect(
        page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: 'Hint (1 used)' }),
      ).toBeVisible();
      await expectAccessible(page, 'the "…" menu with the hints used');
      await page.keyboard.press('Escape');
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

    test('a step hint, its houses tinted on the board', async ({ page }) => {
      await getStuckOnAnXyChain(page);
      await chooseMore(page, 'Hint');
      await expectTintedStep(page);
      await expectAccessible(page, 'a step hint with its houses tinted');
    });

    test('a hint about a missing candidate, and the Show me that names it', async ({ page }) => {
      await leaveOutAnAnswer(page);
      await chooseMore(page, 'Hint');
      const show = page.getByRole('button', { name: /^Show me what's missing in/ });
      await expect(show).toBeVisible();
      await expectAccessible(page, 'a hint about a missing candidate');
      await show.click();
      await expect(dialog(page, 'Why row 5, column 2 can still be 8')).toBeVisible();
      await expectAccessible(page, 'the Show me of a missing candidate');
    });

    test('the Ready and Paused cards', async ({ page }) => {
      await gotoPuzzle(page, PUZZLES.medium.givens);
      await expect(startButton(page)).toBeVisible();
      await expectAccessible(page, 'the Ready card');

      await gotoPuzzle(page, PUZZLES.hard.givens, {
        challenge: { seconds: 323, name: 'Dan', assists: 'ch2m1' },
      });
      await expect(startButton(page)).toBeVisible();
      // The friend's mistakes included.
      await expect(boardArea(page)).toContainText(
        "Dan's solve: 1 mistake · with auto candidates, 2 hints.",
      );
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
      // Its mistakes line included.
      await expect(solved.locator('.result__mistakes')).toHaveText('No mistakes');
      await expectAccessible(page, 'the Solved! dialog');

      await solved.getByRole('button', { name: 'Share your time' }).click();
      const share = dialog(page, 'Share your time');
      await share.getByRole('textbox', { name: 'Your name (optional)' }).fill('Alice');
      await expectAccessible(page, 'the Share your time dialog');
      await closeDialog(page);
      await expectAccessible(page, 'the solved board');

      await gotoPuzzle(page, NEARLY_DONE.givens, { challenge: { seconds: 90, name: 'Dan' } });
      await expect(dialog(page, "You've solved this one")).toBeVisible();
      await expect(dialog(page, "You've solved this one").getByText('No mistakes.')).toBeVisible();
      // A link without mistakes: the friend's show as a dash, "not recorded".
      await expect(
        dialog(page, "You've solved this one").getByRole('row', { name: /^Mistakes/ }),
      ).toContainText('not recorded');
      await expectAccessible(page, "the You've solved this one dialog");
      await closeDialog(page);

      // Head to head: a friend's time to beat, then beaten.
      await startPuzzle(page, NEARLY_DONE_2, {
        challenge: { seconds: 300, name: 'Alexandra', assists: 'ch2m1x2' },
      });
      await page.clock.fastForward('00:05');
      await solveFromKeyboard(page, NEARLY_DONE_2);
      await expect(
        dialog(page, 'Solved!').getByRole('region', { name: 'Head to head' }),
      ).toBeVisible();
      // Its mistakes rows included.
      await expect(
        dialog(page, 'Solved!').getByRole('row', { name: /^Candidate mistakes/ }),
      ).toBeVisible();
      await expectAccessible(page, 'the Solved! dialog, head to head');
      await closeDialog(page);

      await openHeaderDialog(page, 'History');
      const history = dialog(page, 'History');
      await expect(history.getByRole('list', { name: 'Games, newest first' })).toBeVisible();
      await expect(history.getByText(/^Solved in \d+:\d\d · No mistakes$/).first()).toBeVisible();
      await expectAccessible(page, 'the History dialog with games');
      await history
        .getByRole('button', { name: /^Delete / })
        .first()
        .click();
      await expect(history.getByRole('button', { name: /^Confirm delete/ })).toBeVisible();
      await expectAccessible(page, 'a History row asking to confirm a delete');
    });

    test('watching a solve played back, its mistake marked', async ({ page }) => {
      await solveWithAMistake(page);
      await watchASolve(page);
    });

    test("a friend's solve: the Ready card, the warning, the playback, and no time", async ({
      page,
    }) => {
      await friendsSolve(page);
    });

    test('two solves compared: the chart, its table and the overlaid board', async ({ page }) => {
      await compareSolves(page);
    });

    test('a link from someone new, and the friends list', async ({ page }) => {
      await friendsList(page);
      await expectScheme(page, scheme);
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
 * The report's step hint on show (see `getStuckOnAnXyChain`): the next step
 * for row 2, column 1, a box/line reduction, with column 8 and box 9 tinted
 * — candidates, givens and the player's digits among them.
 */
async function expectTintedStep(page: Page): Promise<void> {
  await expect(page.locator('.hint-bar')).toContainText(
    'Step 1 of 7: a box/line reduction in column 8.',
  );
  await expect(page.locator('.cell--step')).toHaveCount(15);
  await expect(page.locator('.cell--step.cell--given')).not.toHaveCount(0);
  await expect(page.locator('.cell--step .cell__candidates')).not.toHaveCount(0);
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

    test("a friend's solve: the Ready card, the warning, the playback, and no time", async ({
      page,
    }) => {
      await page.emulateMedia(media);
      await friendsSolve(page, async () => {
        if (isChosen) await chooseHighContrast(page);
        await expectHighContrast(page, isChosen);
      });
    });

    test('two solves compared: the chart, its table and the overlaid board', async ({ page }) => {
      await page.emulateMedia(media);
      await compareSolves(page, async () => {
        if (isChosen) await chooseHighContrast(page);
        await expectHighContrast(page, isChosen);
      });
    });

    test('Who sent this?, History with Friends at its foot, and the friends list', async ({
      page,
    }) => {
      await page.emulateMedia(media);
      await friendsList(page, async () => {
        if (isChosen) await chooseHighContrast(page);
        await expectHighContrast(page, isChosen);
      });
      // The link opens as a page of its own: its scans were in High contrast too.
      await expectHighContrast(page, isChosen);
    });

    test('watching a solve played back, from History', async ({ page }) => {
      await page.emulateMedia(media);
      await solveWithAMistake(page);
      await closeDialog(page);
      if (isChosen) await chooseHighContrast(page);
      await expectHighContrast(page, isChosen);
      await watchASolve(page, 'History');
    });

    test('a step hint, its houses tinted on the board', async ({ page }) => {
      await page.emulateMedia(media);
      await getStuckOnAnXyChain(page);
      if (isChosen) await chooseHighContrast(page);
      await expectHighContrast(page, isChosen);
      await chooseMore(page, 'Hint');
      await expectTintedStep(page);
      await expectAccessible(page, 'a step hint with its houses tinted');
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

test.describe('Windows High Contrast (forced colours)', () => {
  test.skip(({ isMobile }) => isMobile, 'a desktop mode; the phones have their own pass');

  test('a step hint, its cells told apart from the rest without their tint', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await getStuckOnAnXyChain(page);
    await chooseMore(page, 'Hint');
    await expectTintedStep(page);
    // The tint falls back to the cell's own system colour here, so the
    // step's cells must differ from every other cell of their kind by more
    // than it: no look a step cell has may be one a plain cell has.
    const looks = await page.evaluate(() => {
      const lookOf = (cell: Element) => {
        const style = getComputedStyle(cell);
        return [style.backgroundColor, style.outlineStyle, style.outlineWidth].join(' ');
      };
      const looksOf = (selector: string) =>
        [...document.querySelectorAll(`.board ${selector}:not(.cell--selected)`)].map(lookOf);
      return {
        step: looksOf('.cell--step:not(.cell--given)'),
        stepGiven: looksOf('.cell--step.cell--given'),
        plain: looksOf('.cell:not(.cell--step, .cell--given)'),
        given: looksOf('.cell--given:not(.cell--step)'),
      };
    });
    expect(looks.step.length).toBeGreaterThan(0);
    expect(looks.stepGiven.length).toBeGreaterThan(0);
    expect(looks.step.filter((look) => looks.plain.includes(look))).toEqual([]);
    expect(looks.stepGiven.filter((look) => looks.given.includes(look))).toEqual([]);
  });
});

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
    test(`the Show me of a missing candidate as a bottom sheet, in the ${scheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await leaveOutAnAnswer(page);
      await expectScheme(page, scheme);
      await chooseMore(page, 'Hint');
      await expectAccessible(page, 'a hint about a missing candidate');
      await page.getByRole('button', { name: /^Show me what's missing in/ }).click();
      await expect(dialog(page, 'Why row 5, column 2 can still be 8')).toBeVisible();
      await expectAccessible(page, 'the Show me of a missing candidate');
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

      // The error counter on its line above the controls. Two mistakes: the
      // clash playWithEveryMark checked (Check settles it, counted), and the
      // wrong number Check guesses counts as it goes in.
      await turnOnMistakeSettings(page);
      await enterAWrongNumber(page);
      await expect(page.locator('.error-counter--play [aria-hidden="true"]')).toHaveText(
        /^Mistakes 2$/,
      );
      // And the help taken at the start of its line: two checks and a
      // reveal, and Check guesses.
      await expect(page.locator('.help-taken--play')).toBeVisible();
      await expect(page.locator('.help-taken--play .visually-hidden')).toHaveText(
        'Help taken: guesses checked as entered, 2 checks, 1 reveal',
      );
      await expectAccessible(page, 'the error counter and help taken above the controls');

      await openHeaderDialog(page, 'Solving techniques');
      const sheet = dialog(page, 'Solving techniques');
      await sheet.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'X-Wing' });
      await expect(sheet.getByRole('heading', { level: 3 })).toHaveText('X-Wing');
      await expectAccessible(page, 'the guide as a bottom sheet');
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`Who sent this? and Friends as bottom sheets, and History's foot, in the ${scheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await friendsList(page);
      await expectScheme(page, scheme);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`watching a solve as a bottom sheet, and on its side, in the ${scheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await solveWithAMistake(page);
      await expectScheme(page, scheme);
      await watchASolve(page);
      // Upright, then on its side: the player fits the screen, nothing to scroll.
      const upright = page.viewportSize()!;
      for (const size of [upright, { width: upright.height, height: upright.width }]) {
        await page.setViewportSize(size);
        const body = page.locator('.dialog--playback .dialog__body');
        await expect
          .poll(() => body.evaluate((el) => el.scrollHeight - el.clientHeight))
          .toBeLessThanOrEqual(1);
        await expect(
          dialog(page, 'Your solve').getByRole('button', { name: 'To the solve' }),
        ).toBeInViewport();
        await expectAccessible(
          page,
          `Watch your solve, ${size === upright ? 'upright' : 'on its side'}`,
        );
      }
    });
  }
});
