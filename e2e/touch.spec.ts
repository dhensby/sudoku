import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  NEARLY_DONE,
  PUZZLES,
  cell,
  deployNewerVersion,
  emptyCells,
  expectHeaderWhole,
  getStuck,
  gotoPuzzle,
  grid,
  modeButton,
  openTodaysDaily,
  padKey,
  placedSolve,
  puzzleLink,
  resumeButton,
  seedFriends,
  seedPuzzles,
  settle,
  solveFromKeyboard,
  startButton,
  stubClipboard,
  typeDigits,
  updateOffer,
  waitForPlaying,
} from './helpers';
import { BEYOND_THE_SET } from '../src/test/logic-fixtures';

/**
 * Phones: the game played by touch, and the layout's promise that the whole
 * game fits a phone screen with nothing to scroll in either direction.
 * Plain taps use Playwright's real `tap()`, which is trusted touch input, so
 * the app sees `pointerType: 'touch'` exactly as on a device.
 *
 * Sizes are measured against `documentElement.clientWidth/clientHeight`,
 * not `window.innerWidth`: Chrome on Android inflates the inner size to the
 * scroll size once content overflows, which would make every check pass.
 *
 * Runs on the `iphone` (WebKit, iPhone 15) and `android` (Chromium, Pixel 7)
 * projects only — see playwright.config.ts.
 */

const EASY = PUZZLES.easy;

/** Open a link to `givens` and tap Start. */
async function tapStart(page: Page, givens = EASY.givens): Promise<void> {
  await gotoPuzzle(page, givens);
  await startButton(page).tap();
  await waitForPlaying(page);
}

/** The page's scroll extent against its viewport. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      x: root.scrollWidth - root.clientWidth,
      y: root.scrollHeight - root.clientHeight,
    };
  });
}

/** Whether `target` lies wholly inside the viewport, once it has come to rest. */
async function expectOnScreen(page: Page, target: Locator): Promise<void> {
  await settle(page);
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  const box = await target.boundingBox();
  expect(box, 'has a box').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5);
}

/**
 * The press area of a button that reaches past what it draws (found by
 * hit-testing, through its middle), and how many of the board's cells and
 * the controls it overlaps.
 */
async function pressArea(button: Locator) {
  return button.evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const hits = (x: number, y: number) => target.contains(document.elementFromPoint(x, y));
    const [x, y] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    const ys: number[] = [];
    const xs: number[] = [];
    for (let at = rect.top - 40; at <= rect.bottom + 40; at += 0.5) if (hits(x, at)) ys.push(at);
    for (let at = rect.left - 40; at <= rect.right + 40; at += 0.5) if (hits(at, y)) xs.push(at);
    const [top, bottom] = [Math.min(...ys), Math.max(...ys) + 0.5];
    const [left, right] = [Math.min(...xs), Math.max(...xs) + 0.5];
    const neighbours = document.querySelectorAll('[role="gridcell"], .controls button');
    const overlapping = [...neighbours].filter((element) => {
      const box = element.getBoundingClientRect();
      return box.left < right && box.right > left && box.top < bottom && box.bottom > top;
    });
    return { width: right - left, height: bottom - top, overlapping: overlapping.length };
  });
}

/** A finger's press area, clear of the board's cells and the controls. */
async function expectFingerSized(button: Locator): Promise<void> {
  const area = await pressArea(button);
  expect(area.width).toBeGreaterThanOrEqual(44);
  expect(area.height).toBeGreaterThanOrEqual(44);
  expect(area.overlapping).toBe(0);
}

/** Ask for a hint from the "…" menu, by touch. */
async function tapHint(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More' }).tap();
  await page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: 'Hint' }).tap();
}

/** Open one of the header's dialogs through the phone's overflow menu. */
async function openFromMenu(page: Page, name: string): Promise<Locator> {
  await page.getByRole('banner').getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('menu', { name: 'Menu' }).getByRole('menuitem', { name }).tap();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Everything a finger presses during play — the input-mode toggle, the pad,
 * Erase, Undo and Redo, the switch, the "…" menu and the header's buttons.
 * Disabled ones (Undo and Redo, with nothing to undo) count too: they are
 * where they will be once they are not.
 */
function playControls(page: Page): Locator[] {
  const banner = page.getByRole('banner');
  return [
    modeButton(page, 'Normal'),
    modeButton(page, 'Candidate'),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => padKey(page, digit)),
    page.getByRole('button', { name: 'Erase' }),
    page.getByRole('button', { name: 'Undo' }),
    page.getByRole('button', { name: 'Redo' }),
    page.getByRole('switch', { name: 'Auto Candidate Mode' }),
    page.getByRole('button', { name: 'More' }),
    banner.getByRole('button', { name: 'Pause' }),
    banner.getByRole('button', { name: 'New game' }),
    banner.getByRole('button', { name: 'Menu' }),
  ];
}

/** Spec §4.5: every control at least 44px each way on a coarse pointer. */
async function expectTouchTargets(page: Page): Promise<void> {
  for (const control of playControls(page)) {
    const box = await control.boundingBox();
    const name = (await control.getAttribute('aria-label')) ?? (await control.innerText());
    expect(box, name).not.toBeNull();
    expect(box!.width, name).toBeGreaterThanOrEqual(44);
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }
}

/** Nothing to scroll either way, and every control wholly on screen. */
async function expectWholeGameOnScreen(page: Page): Promise<void> {
  expect(await overflow(page)).toEqual({ x: 0, y: 0 });
  await expectOnScreen(page, grid(page));
  for (const control of playControls(page)) await expectOnScreen(page, control);
}

/**
 * With the offer of a new version up, at the foot of the screen: nothing to
 * scroll, its two buttons a finger's size and on screen, and every play
 * control but the two it lies over — the Auto Candidate switch and the "…"
 * menu — still there to press, each found by hit-testing at its middle.
 */
async function expectOfferClearOfPlay(page: Page): Promise<void> {
  await expect(updateOffer(page)).toBeVisible();
  await settle(page);
  expect(await overflow(page)).toEqual({ x: 0, y: 0 });
  for (const name of ['Refresh', 'Dismiss']) {
    const button = page.getByRole('button', { name });
    await expectOnScreen(page, button);
    const box = (await button.boundingBox())!;
    expect(box.width, name).toBeGreaterThanOrEqual(44);
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
  const covered = ['Auto Candidate Mode', 'More'];
  for (const control of playControls(page)) {
    const name = (await control.getAttribute('aria-label')) ?? (await control.innerText());
    const isPressable = await control.evaluate((target) => {
      const box = target.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return target.contains(hit);
    });
    expect(isPressable, name).toBe(!covered.includes(name));
  }
}

/**
 * Put `ms` on the clock of the game on screen, as if it had been played that
 * long. The record is edited in storage from a page of the app's own origin
 * that doesn't run the app — leaving the game saves it first, and nothing is
 * left running to save over the edit — then the game is reopened, paused.
 */
async function seedElapsed(page: Page, ms: number): Promise<void> {
  await page.goto('/favicon.svg');
  await page.evaluate((elapsedMs) => {
    const id = localStorage.getItem('sudoku.current');
    const records = JSON.parse(localStorage.getItem('sudoku.history') ?? '[]') as {
      id: string;
      elapsedMs: number;
    }[];
    const record = records.find((entry) => entry.id === id);
    if (record === undefined) throw new Error('no current game to seed');
    record.elapsedMs = elapsedMs;
    localStorage.setItem('sudoku.history', JSON.stringify(records));
  }, ms);
  await page.goto('/');
  await expect(resumeButton(page)).toBeVisible();
}

test.describe('touch', () => {
  test('tapping a cell and then a pad key enters the digit', async ({ page }) => {
    await tapStart(page);
    const target = emptyCells(EASY.givens)[2];
    await cell(page, target).tap();
    await expect(cell(page, target)).toHaveAttribute('aria-selected', 'true');
    await padKey(page, Number(EASY.solution[target])).tap();
    await expect(cell(page, target)).toHaveAccessibleName(EASY.solution[target]);

    await page.getByRole('button', { name: 'Erase' }).tap();
    await expect(cell(page, target)).toHaveAccessibleName('empty');
  });

  test('the mode toggle switches the pad to candidates', async ({ page }) => {
    await tapStart(page);
    const target = emptyCells(EASY.givens)[0];
    await cell(page, target).tap();
    await modeButton(page, 'Candidate').tap();
    await expect(modeButton(page, 'Candidate')).toHaveAttribute('aria-pressed', 'true');
    await padKey(page, 3).tap();
    await padKey(page, 7).tap();
    await expect(cell(page, target)).toHaveAccessibleName('empty, candidates 3 7');

    // A finger on the selected cell selects it; it never toggles the
    // candidate under it, which only a mouse pointer can aim at.
    await cell(page, target).tap();
    await expect(cell(page, target)).toHaveAccessibleName('empty, candidates 3 7');

    await modeButton(page, 'Normal').tap();
    await padKey(page, Number(EASY.solution[target])).tap();
    await expect(cell(page, target)).toHaveAccessibleName(EASY.solution[target]);
  });

  test('the game fits the screen with nothing to scroll either way', async ({ page }) => {
    // The Ready card first: the board's place, at the board's size.
    await gotoPuzzle(page, EASY.givens);
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });

    await startButton(page).tap();
    await waitForPlaying(page);
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });
    for (const control of [
      grid(page),
      cell(page, 80),
      padKey(page, 1),
      padKey(page, 9),
      page.getByRole('button', { name: 'Erase' }),
      page.getByRole('button', { name: 'Undo' }),
      page.getByRole('button', { name: 'Redo' }),
      page.getByRole('switch', { name: 'Auto Candidate Mode' }),
      page.getByRole('button', { name: 'More' }),
      page.getByRole('banner').getByRole('button', { name: 'Menu' }),
    ]) {
      await expectOnScreen(page, control);
    }

    // Candidate mode redraws the pad; auto candidates fill every cell.
    await modeButton(page, 'Candidate').tap();
    await page.getByRole('switch', { name: 'Auto Candidate Mode' }).tap();
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });

    // The "…" menu opens upwards, on screen.
    await page.getByRole('button', { name: 'More' }).tap();
    const more = page.getByRole('menu', { name: 'More' });
    await expect(more).toBeVisible();
    await expectOnScreen(page, more);
    await more.getByRole('menuitem', { name: 'Hint' }).tap();
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });

    // Paused: the card in the board's place.
    await page.getByRole('banner').getByRole('button', { name: 'Pause' }).tap();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Paused' })).toBeVisible();
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });
  });

  test('every dialog fits the screen', async ({ page }) => {
    await tapStart(page, NEARLY_DONE.givens);
    for (const name of [
      'Daily puzzles',
      'History',
      'Share',
      'Settings',
      'Solving techniques',
      'Help',
    ]) {
      const dialog = await openFromMenu(page, name);
      await expectOnScreen(page, dialog);
      expect((await overflow(page)).x).toBe(0);
      await dialog.getByRole('button', { name: 'Close' }).first().tap();
      await expect(dialog).toBeHidden();
    }

    // The completion dialog, with its stats.
    for (const index of emptyCells(NEARLY_DONE.givens)) {
      await cell(page, index).tap();
      await padKey(page, Number(NEARLY_DONE.solution[index])).tap();
    }
    const done = page.getByRole('dialog', { name: 'Solved!' });
    await expect(done).toBeVisible();
    await expectOnScreen(page, done);
    await expectOnScreen(page, done.getByRole('button', { name: 'Share your time' }));
    expect((await overflow(page)).x).toBe(0);
  });

  test('text fields are at least 16px, so focusing one does not zoom the page', async ({
    page,
  }) => {
    await stubClipboard(page, { clipboard: 'fails' });
    await tapStart(page, NEARLY_DONE.givens);
    for (const index of emptyCells(NEARLY_DONE.givens)) {
      await cell(page, index).tap();
      await padKey(page, Number(NEARLY_DONE.solution[index])).tap();
    }
    await page
      .getByRole('dialog', { name: 'Solved!' })
      .getByRole('button', { name: 'Share your time' })
      .tap();
    const dialog = page.getByRole('dialog', { name: 'Share your time' });
    await dialog.getByRole('button', { name: 'Copy', exact: true }).tap();
    await expect(dialog.getByRole('textbox', { name: 'Message and link' })).toBeVisible();

    const fields = dialog.locator('input:not([type="checkbox"]):not([type="radio"]), textarea');
    await expect(fields).toHaveCount(2);
    for (const field of await fields.all()) {
      const size = await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
    }
    await expectOnScreen(page, dialog);
  });

  test('New game from the header generates a puzzle on the phone too', async ({ page }) => {
    // Generation runs in a module worker; this is the one place WebKit runs it.
    await page.goto('/');
    await waitForPlaying(page);
    await page.getByRole('banner').getByRole('button', { name: 'New game' }).tap();
    await page.getByRole('menuitem', { name: 'Hard', exact: true }).tap();
    await waitForPlaying(page);
    await expect(page.getByRole('banner')).toContainText('Difficulty: Hard');
    await expect(page.getByRole('gridcell')).toHaveCount(81);
  });

  test('tapping the scrim closes a dialog, even a tall one', async ({ page }) => {
    await tapStart(page);
    for (const name of ['Share', 'Help']) {
      const dialog = await openFromMenu(page, name);
      await settle(page);
      // Help is a tall sheet: the strip of scrim it leaves above it must
      // still be big enough that a finger lands on it, not on the sheet.
      await page.locator('.dialog-overlay').tap({ position: { x: 10, y: 10 } });
      await expect(dialog).toBeHidden();
      await waitForPlaying(page);
    }
  });

  test('the technique guide is a bottom sheet with a picker, nothing to scroll sideways and finger-sized targets', async ({
    page,
  }) => {
    await tapStart(page);
    const sheet = await openFromMenu(page, 'Solving techniques');
    await expectOnScreen(page, sheet);
    const viewport = await page.evaluate(() => document.documentElement.clientWidth);
    const box = (await sheet.boundingBox())!;
    // Edge to edge, anchored to the foot of the screen.
    expect(box.x).toBeLessThanOrEqual(0.5);
    expect(box.width).toBeGreaterThanOrEqual(viewport - 1);
    expect(box.y + box.height).toBeGreaterThanOrEqual(
      (await page.evaluate(() => document.documentElement.clientHeight)) - 1,
    );

    // A picker in place of the list, which a phone has no room for.
    const picker = sheet.getByRole('combobox', { name: 'Technique' });
    await expect(picker).toBeVisible();
    await expect(sheet.getByRole('navigation', { name: 'Techniques', exact: true })).toBeHidden();
    await picker.selectOption('swordfish');
    await expect(sheet.getByRole('heading', { level: 3 })).toHaveText('Swordfish');

    // The worked example takes the sheet's width, and nothing scrolls sideways.
    const body = sheet.locator('.dialog__body');
    const diagram = (await sheet.getByRole('img').boundingBox())!;
    const inner = await body.evaluate((el) => {
      const style = getComputedStyle(el);
      return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    expect(diagram.width).toBeGreaterThanOrEqual(Math.min(inner, 360) - 1);
    expect(diagram.x + diagram.width).toBeLessThanOrEqual(viewport);
    expect((await overflow(page)).x).toBe(0);
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    const targets = [
      picker,
      sheet.getByRole('button', { name: 'Close' }),
      sheet.getByRole('button', { name: /^Previous/ }),
      sheet.getByRole('button', { name: /^Next/ }),
    ];
    for (const target of targets) {
      await target.scrollIntoViewIfNeeded();
      const size = (await target.boundingBox())!;
      expect(size.height, (await target.textContent()) ?? '').toBeGreaterThanOrEqual(44);
      expect(size.width).toBeGreaterThanOrEqual(44);
    }

    await sheet.getByRole('button', { name: /^Next/ }).tap();
    await expect(sheet.getByRole('heading', { level: 3 })).toHaveText('XY-Wing');
    await expect(picker).toHaveValue('xyWing');
  });

  test('the daily calendar is a bottom sheet with nothing to scroll sideways, every day and button finger-sized', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-10-13T10:00:00+01:00') });
    await tapStart(page);
    const sheet = await openFromMenu(page, 'Daily puzzles');
    await expect(sheet).toHaveAccessibleName('Daily puzzles');
    await expectOnScreen(page, sheet);
    const viewport = await page.evaluate(() => document.documentElement.clientWidth);
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(0.5);
    expect(box.width).toBeGreaterThanOrEqual(viewport - 1);
    const body = sheet.locator('.dialog__body');
    expect((await overflow(page)).x).toBe(0);
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    // Every day with a daily, and every button, is a finger's size.
    const days = sheet.getByRole('gridcell', { name: /October: (?!no daily)/ });
    expect(await days.count()).toBe(7);
    for (const target of [
      ...(await days.all()),
      sheet.getByRole('button', { name: 'Close' }),
      sheet.getByRole('button', { name: 'Previous month' }),
      sheet.getByRole('button', { name: 'Next month' }),
      ...(await sheet.getByRole('button', { name: /daily for Tuesday 13 October$/ }).all()),
    ]) {
      await target.scrollIntoViewIfNeeded();
      const size = (await target.boundingBox())!;
      const label = (await target.getAttribute('aria-label')) ?? '';
      expect(size.height, label).toBeGreaterThanOrEqual(44);
      expect(size.width, label).toBeGreaterThanOrEqual(44);
    }

    // A day tapped brings its puzzles into view.
    await sheet.getByRole('gridcell', { name: /^Thursday 8 October/ }).tap();
    const heading = sheet.getByRole('heading', { name: 'Thursday 8 October' });
    await expect(heading).toBeInViewport();
    await expect(
      sheet.getByRole('button', { name: 'Play, Expert daily for Thursday 8 October' }),
    ).toBeInViewport();
  });

  test("a hint's question opens the guide at its technique", async ({ page }) => {
    await tapStart(page);
    await tapHint(page);
    const question = page.locator('.hint-bar').getByRole('button', { name: /^What's a/ });

    // A finger-sized press area round the words, clear of the board's cells
    // and the controls.
    await expectFingerSized(question);

    const name = (await question.textContent())!.replace(/^What's an? |\?$/g, '');
    await question.tap();
    const sheet = page.getByRole('dialog', { name: 'Solving techniques' });
    await expect(sheet.getByRole('heading', { level: 3 })).toHaveText(new RegExp(`^${name}$`, 'i'));
    expect((await overflow(page)).x).toBe(0);
  });

  test("a hint's Show me opens its walkthrough, from a finger-sized press area", async ({
    page,
  }) => {
    await tapStart(page);
    await tapHint(page);
    const show = page.locator('.hint-bar').getByRole('button', { name: /^Show me how to solve/ });
    const question = page.locator('.hint-bar').getByRole('button', { name: /^What's a/ });

    // Each a finger's press area (hit-testing finds each its own, so
    // neither is over the other), clear of the board's cells and the
    // controls.
    for (const button of [show, question]) await expectFingerSized(button);
    // The bar keeps its two lines' height, Show me and all.
    const bar = page.locator('.hint-bar');
    const [height, min] = await bar.evaluate((el) => [
      el.getBoundingClientRect().height,
      parseFloat(getComputedStyle(el).minHeight),
    ]);
    expect(height).toBeLessThanOrEqual(min + 0.5);

    await show.tap();
    const sheet = page.getByRole('dialog', { name: /^How to solve row \d, column \d$/ });
    await expectOnScreen(page, sheet);
    await expectOnScreen(page, sheet.getByRole('button', { name: 'Done' }));
    expect((await overflow(page)).x).toBe(0);
    await sheet.getByRole('button', { name: 'Done' }).tap();
    await expect(sheet).toBeHidden();
  });

  test('rapid taps do not zoom the page, and the board is insulated from selection', async ({
    page,
  }) => {
    await tapStart(page);
    // The scale check alone passes without touch-action, so pin the rule too.
    expect(await cell(page, 0).evaluate((el) => getComputedStyle(el).touchAction)).toBe(
      'manipulation',
    );
    const [a, b] = emptyCells(EASY.givens);
    await cell(page, a).tap();
    await cell(page, b).tap();
    await cell(page, a).tap();
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    // A long press must not start selecting digits. WebKit only honours the
    // prefixed property, which both engines report.
    expect(
      await grid(page).evaluate((el) =>
        getComputedStyle(el).getPropertyValue('-webkit-user-select'),
      ),
    ).toBe('none');
  });

  test('pad keys and cells are comfortable to hit', async ({ page }) => {
    await tapStart(page);
    const key = await padKey(page, 5).boundingBox();
    expect(key!.width).toBeGreaterThanOrEqual(44);
    expect(key!.height).toBeGreaterThanOrEqual(44);
    const square = await cell(page, 0).boundingBox();
    expect(square!.width).toBeGreaterThanOrEqual(36);
  });

  test('every control is a 44px touch target', async ({ page }) => {
    await tapStart(page);
    await expectTouchTargets(page);
  });

  test('sits the controls at the foot of a tall screen, under the thumb', async ({ page }) => {
    await tapStart(page);
    const height = await page.evaluate(() => document.documentElement.clientHeight);
    const controls = (await page.locator('.controls').boundingBox())!;
    // Any height to spare goes between the board and the controls, never
    // under them: below them is only the page's own margin.
    expect(height - (controls.y + controls.height)).toBeLessThanOrEqual(16);
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });
  });
});

/*
 * The sizes the layout promises (spec §4.6): the whole game on screen with
 * nothing to scroll either way, from a 320×568 iPhone SE up, and on a phone
 * turned on its side.
 */
/*
 * Help taken is on unless switched off, and costs a game played without
 * help nothing: before any help, the board is as large as with the setting
 * off, its cells as comfortable to hit.
 */
for (const viewport of [
  { width: 360, height: 640 },
  { width: 375, height: 667 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone before any help`, () => {
    test.use({ viewport });

    test('keeps the board as large as with help taken hidden', async ({ page }) => {
      await tapStart(page);
      const unaided = (await grid(page).boundingBox())!;
      await expect(page.locator('.tally--play')).toBeHidden();
      // The same game, reopened with the setting off.
      await page.goto('/favicon.svg');
      await page.evaluate(() => {
        const prefs = JSON.parse(localStorage.getItem('sudoku.prefs') ?? '{}') as {
          settings?: Record<string, unknown>;
        };
        prefs.settings = { ...prefs.settings, showHelpTaken: false };
        localStorage.setItem('sudoku.prefs', JSON.stringify(prefs));
      });
      await page.goto('/');
      await resumeButton(page).tap();
      await waitForPlaying(page);
      const hidden = (await grid(page).boundingBox())!;
      expect(unaided.width).toBe(hidden.width);
      expect(unaided.height).toBe(hidden.height);
    });
  });
}

test.describe('a 375×667 phone', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('fits the whole game with nothing to scroll', async ({ page }) => {
    await tapStart(page);
    await expectWholeGameOnScreen(page);
  });

  // Help taken is on unless switched off, but its line comes with the first
  // help: the board gives up its height then, and the game still fits.
  test('gives help taken its line above the controls once a hint is taken', async ({ page }) => {
    await tapStart(page);
    const before = (await grid(page).boundingBox())!;
    await expect(page.locator('.tally--play')).toBeHidden();
    await tapHint(page);
    const help = page.locator('.help-taken--play');
    await expect(help.locator('.help-taken__full')).toHaveText('1 hint');
    await expect(help.locator('.help-taken__face')).not.toHaveClass(
      /help-taken__face--(counts|total)/,
    );
    expect((await grid(page).boundingBox())!.width).toBeLessThan(before.width);
    await expectOnScreen(page, help);
    await expectWholeGameOnScreen(page);
  });

  test('lines the controls up with the board, edge to edge', async ({ page }) => {
    await tapStart(page);
    const board = (await grid(page).boundingBox())!;
    const boxes = await Promise.all(
      playControls(page)
        .slice(0, -3) // the header's own buttons sit wherever the header puts them
        .map(async (control) => (await control.boundingBox())!),
    );
    const left = Math.min(...boxes.map((box) => box.x));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    expect(Math.abs(left - board.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(right - (board.x + board.width))).toBeLessThanOrEqual(0.5);
  });

  // The timer widens as the time grows (h:mm:ss past the hour); the header
  // is one row, and must never push the "Menu" button off the edge.
  test('the header still fits once the clock passes ten minutes', async ({ page }) => {
    await page.clock.install();
    await tapStart(page, PUZZLES.medium.givens);
    await page.clock.fastForward('10:00');
    await expect
      .poll(() => page.getByRole('banner').locator('.timer__time').innerText())
      .toMatch(/^10:0\d$/);
    expect((await overflow(page)).x).toBe(0);
    await expectOnScreen(page, page.getByRole('banner').getByRole('button', { name: 'Menu' }));

    await page.clock.fastForward('01:00:00');
    await expect
      .poll(() => page.getByRole('banner').locator('.timer__time').innerText())
      .toMatch(/^1:10:0\d$/);
    expect((await overflow(page)).x).toBe(0);
    await expectOnScreen(page, page.getByRole('banner').getByRole('button', { name: 'Menu' }));
  });
});

test.describe('a 320×568 phone', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('fits the whole game with nothing to scroll', async ({ page }) => {
    await tapStart(page);
    await expectWholeGameOnScreen(page);
  });

  test('offers a new version over the switch row alone, its buttons finger-sized', async ({
    page,
  }) => {
    await deployNewerVersion(page);
    await tapStart(page);
    await expectOfferClearOfPlay(page);
  });

  /*
   * A puzzle's name at its longest, 40 characters, and a word in it with no
   * space to break at: it wraps inside the card, at the board's smallest
   * size here, and the card itself still has nothing to scroll; and so it
   * does in Share's preview of the message, passing it on.
   */
  test("keeps a link's 40-character puzzle name inside its Ready card and Share's preview, with nothing to scroll", async ({
    page,
  }) => {
    const title = 'Supercalifragilisticexpialidocious #1234';
    expect([...title]).toHaveLength(40);
    await gotoPuzzle(page, EASY.givens, { title });
    const card = page.locator('.board-overlay__card');
    const name = card.locator('.board-overlay__name');
    await expect(name).toHaveText(title);
    await settle(page);
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });
    expect(
      await card.evaluate((el) => ({
        x: el.scrollWidth - el.clientWidth,
        y: el.scrollHeight - el.clientHeight,
      })),
    ).toEqual({ x: 0, y: 0 });
    const [box, inner] = [(await card.boundingBox())!, (await name.boundingBox())!];
    expect(inner.x).toBeGreaterThanOrEqual(box.x);
    expect(inner.x + inner.width).toBeLessThanOrEqual(box.x + box.width);
    expect(await name.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    await expectOnScreen(page, startButton(page));

    const share = await openFromMenu(page, 'Share');
    const text = share.locator('.share__text');
    await expect(text).toHaveText(`Try this Easy Sudoku!\n${title}`);
    expect((await overflow(page)).x).toBe(0);
    expect(await text.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    const body = share.locator('.dialog__body');
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  });

  /*
   * Short of height, the board still gives help taken its line once help is
   * taken, as on any phone held upright, and the game still fits; the "…"
   * menu's Hint counts the hints too.
   */
  test('gives help taken its line once a hint is taken, and counts the hints on Hint', async ({
    page,
  }) => {
    await tapStart(page);
    await expect(page.locator('.tally--play')).toBeHidden();
    await tapHint(page);
    const help = page.locator('.help-taken--play');
    await expect(help.locator('.help-taken__full')).toHaveText('1 hint');
    await expectOnScreen(page, help);
    await expectWholeGameOnScreen(page);
    await page.getByRole('button', { name: 'More' }).tap();
    await expect(
      page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: 'Hint (1 used)' }),
    ).toBeVisible();
  });

  // Measured, not read from the stylesheet: the sheet's borders and padding
  // decide what is left for seven days.
  test('keeps every day of the calendar a finger’s 44px, with nothing to scroll sideways', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-10-13T10:00:00+01:00') });
    await tapStart(page);
    const sheet = await openFromMenu(page, 'Daily puzzles');
    await settle(page);
    expect(
      await sheet.locator('.dialog__body').evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBe(0);
    const days = sheet.getByRole('gridcell', { name: /October: (?!no daily)/ });
    expect(await days.count()).toBe(7);
    for (const target of await sheet.locator('td[data-date]').all()) {
      const size = (await target.boundingBox())!;
      const label = (await target.getAttribute('data-date')) ?? '';
      expect(size.width, label).toBeGreaterThanOrEqual(44);
      expect(size.height, label).toBeGreaterThanOrEqual(44);
    }
  });

  /*
   * The head-to-head at its fullest: every row of help and of mistakes,
   * hour-long times and the longest name a link can carry, right to left. The friend wins, so
   * the time to beat is drawn in the winner's heavier weight — the widest a
   * time gets. Fixed columns hold it all inside the card; each time and
   * count stays on one line, and the name is cut short at its end.
   */
  test('fits the head-to-head, hour-long times and a long right-to-left name, each on one line, with nothing to scroll sideways', async ({
    page,
  }) => {
    await page.clock.install();
    await gotoPuzzle(page, NEARLY_DONE.givens, {
      challenge: { seconds: 35084, name: 'אלכסנדרה בת־שבע מרקוביץ', assists: 'ch2k3r1m12x3' },
    });
    await startButton(page).tap();
    await waitForPlaying(page);
    // A few minutes slower than the friend's 9:44:44.
    await page.clock.fastForward('09:50:00');
    await solveFromKeyboard(page, NEARLY_DONE);
    const solved = page.getByRole('dialog', { name: 'Solved!' });
    const versus = solved.getByRole('region', { name: 'Head to head' });
    await expect(versus.getByRole('rowheader')).toHaveText([
      'Time',
      'Auto candidates',
      'Hints',
      'Checks',
      'Reveals',
      'Mistakes',
      'Candidate mistakes',
    ]);
    const times = versus.getByRole('row').nth(1).getByRole('cell');
    await expect(times).toHaveText([/^9:5\d:\d\d$/, '9:44:44']);
    await expect(times.nth(1)).toHaveClass(/comparison__time--winner/);
    await settle(page);
    expect(
      await solved.locator('.dialog__body').evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBe(0);
    // Every time and count on a single line: one line box for all its text.
    const lineCounts = await versus.getByRole('cell').evaluateAll((cells) =>
      cells
        .filter((el) => el.textContent !== '')
        .map((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
        }),
    );
    expect(lineCounts).toEqual(Array(14).fill(1));
    // The name really is cut short, and runs right to left, so the ellipsis
    // takes its end rather than its beginning.
    const name = versus.getByRole('columnheader').nth(1).locator('bdi');
    expect(
      await name.evaluate((el) => ({
        cut: el.scrollWidth > el.clientWidth,
        direction: getComputedStyle(el).direction,
      })),
    ).toEqual({ cut: true, direction: 'rtl' });
  });

  test('keeps every control a 44px touch target', async ({ page }) => {
    await tapStart(page);
    await expectTouchTargets(page);
  });

  /*
   * The board shrinks to fit the height here, and the hint bar with it — to
   * 268px, and once a hint is taken, narrower again, as help taken takes its
   * line above the controls: a hidden single's hint is the longest a single
   * gets, and with its question and Show me it could take a third line,
   * which scrolls. Show me becomes its play mark, its words kept as its name.
   */
  test("keeps a hidden single's hint, its question and Show me to two lines, with nothing to scroll", async ({
    page,
  }) => {
    await getStuck(page);
    // Two more right digits, and a hidden single in its box is the hint.
    await typeDigits(page, [
      { index: 37, digit: 8 },
      { index: 73, digit: 6 },
    ]);
    await tapHint(page);
    const bar = page.locator('.hint-bar');
    await expect(bar).toContainText(
      "Hidden single: there's only one place for a number in this box.",
    );
    const show = bar.getByRole('button', { name: /^Show me how to solve/ });
    const question = bar.getByRole('button', { name: "What's a hidden single?" });
    // Help taken has its line, beside a bar still on two lines.
    await expect(page.locator('.help-taken--play')).toBeVisible();
    await expect(show).toHaveAccessibleName(/^Show me how to solve/);
    await expect(question).toBeVisible();
    const [height, min] = await bar.evaluate((el) => [
      el.getBoundingClientRect().height,
      parseFloat(getComputedStyle(el).minHeight),
    ]);
    expect(height).toBeLessThanOrEqual(min + 0.5);
    await expectWholeGameOnScreen(page);
    for (const button of [show, question]) await expectFingerSized(button);
  });
});

/*
 * With "Show error counter" on: on a phone held upright the counter takes a
 * line of its own above the controls, which the board makes room for — the
 * game still fits with nothing to scroll; on its side it sits beside the
 * timer, and the header still never scrolls sideways. A large phone on its
 * side (896×414, 932×430) is wide enough for the desktop's row of seven
 * buttons, but its header, held to the board, is not wide enough for them
 * and the counter: they fold into the Menu, as on a smaller phone.
 */
for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 896, height: 414 },
  { width: 932, height: 430 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone with the error counter on`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          'sudoku.prefs',
          JSON.stringify({ settings: { showErrorCounter: true } }),
        );
      });
    });

    test('fits the whole game and the counter with nothing to scroll', async ({ page }) => {
      await tapStart(page, PUZZLES.medium.givens);
      const counter = page.locator('.error-counter:visible');
      await expect(counter.locator('[aria-hidden="true"]')).toHaveText(/^Mistakes 0$/);
      await expectWholeGameOnScreen(page);
      await expectOnScreen(page, counter);
      const isUpright = viewport.width < viewport.height;
      await expect(
        page.locator(isUpright ? '.error-counter--play' : '.error-counter--header'),
      ).toBeVisible();
      await expectOnScreen(page, page.getByRole('banner').getByRole('button', { name: 'Menu' }));
    });

    test('gives way in the header at 1:23:45, clipping neither the tier nor the page', async ({
      page,
    }) => {
      await tapStart(page, PUZZLES.medium.givens);
      await seedElapsed(page, (1 * 3600 + 23 * 60 + 45) * 1000);
      await resumeButton(page).tap();
      await waitForPlaying(page);
      const banner = page.getByRole('banner');
      await expect(banner.locator('.timer__time')).toHaveText(/^1:23:4\d$/);
      const tier = banner.locator('.header__difficulty');
      expect(await tier.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      expect((await overflow(page)).x).toBe(0);
      await expectOnScreen(page, page.locator('.error-counter:visible'));
      await expectOnScreen(page, banner.getByRole('button', { name: 'Menu' }));
    });
  });
}

/*
 * Help taken shares the error counter's strip: on a phone held upright the
 * line above the controls, help taken at its start and the counter at its
 * end, never overlapping; on its side, beside the timer, help taken over the
 * counter. The counter at its widest a phone sees in play here — "Mistakes 1
 * · 1 candidate" — and help taken with every kind ("Auto candidates · Checked
 * as entered · 1 hint · 1 check · 1 reveal"), which outgrows its room on the
 * narrowest phones and beside the timer: it gives way to the counts alone,
 * then to their total, "Help 3", and whichever shows is whole, never cut
 * short. The game still fits with nothing to scroll; and on a daily Medium
 * at 1:23:45, with help at its widest, the header gives way without cutting
 * its wordmark or its tier, or scrolling the page.
 */
const FULL_HELP = 'Auto candidates · Checked as entered · 1 hint · 1 check · 1 reveal';
const HELP_WORDS = {
  full: FULL_HELP,
  counts: '1 hint · 1 check · 1 reveal',
  total: 'Help 3',
} as const;

for (const viewport of [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 393, height: 852 },
  { width: 568, height: 320 },
  { width: 640, height: 360 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 896, height: 414 },
  { width: 932, height: 430 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone with help taken and the error counter`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          'sudoku.prefs',
          JSON.stringify({ settings: { showErrorCounter: true, checkGuesses: true } }),
        );
      });
    });

    const isUpright = viewport.width < viewport.height;
    const visibleHelp = (page: Page) =>
      page.locator(isUpright ? '.help-taken--play' : '.help-taken--header');
    const counter = (page: Page) => page.locator('.error-counter:visible');

    /** Choose an item from the "…" menu, by touch. */
    async function tapMore(page: Page, item: string): Promise<void> {
      await page.getByRole('button', { name: 'More' }).tap();
      await page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: item }).tap();
    }

    /**
     * On the Medium link: auto candidates on, a cell's answer struck from its
     * candidates (a candidate mistake, counted at once with Check guesses on)
     * and a wrong number in another (a mistake); then a hint, which points at
     * the mistake, a check of the puzzle and the cell revealed.
     */
    async function takeHelp(page: Page): Promise<void> {
      const { givens, solution } = PUZZLES.medium;
      const [struck, wrong] = emptyCells(givens);
      await page.getByRole('switch', { name: 'Auto Candidate Mode' }).tap();
      await cell(page, struck).tap();
      await modeButton(page, 'Candidate').tap();
      await padKey(page, Number(solution[struck])).tap();
      await modeButton(page, 'Normal').tap();
      await cell(page, wrong).tap();
      await padKey(page, (Number(solution[wrong]) % 9) + 1).tap();
      await expect(counter(page).locator('[aria-hidden="true"]')).toHaveText(
        /^Mistakes 1 · 1 candidate$/,
      );
      await tapMore(page, 'Hint');
      await tapMore(page, 'Check puzzle');
      await tapMore(page, 'Reveal cell');
      await expect(visibleHelp(page).locator('.help-taken__full')).toHaveText(FULL_HELP);
    }

    /**
     * The full words where they fit, else the counts alone, else their total
     * (as on the narrowest phone, upright or on its side, the full words
     * never fit); whichever shows wholly inside the box, measured with a
     * Range, and clear of the counter.
     */
    async function expectHelpWhole(page: Page): Promise<void> {
      const help = visibleHelp(page);
      const face = help.locator('.help-taken__face');
      const className = (await face.getAttribute('class')) ?? '';
      const form = /--total\b/.test(className)
        ? 'total'
        : /--counts\b/.test(className)
          ? 'counts'
          : 'full';
      if (viewport.width === 320 || !isUpright) expect(form).not.toBe('full');
      const words = help.locator(`.help-taken__${form}`);
      await expect(words).toHaveText(HELP_WORDS[form]);
      if (form === 'full') await expect(help).not.toHaveAttribute('title');
      else await expect(help).toHaveAttribute('title', FULL_HELP);
      const past = await words.evaluate((shown) => {
        const box = shown.closest('.help-taken')!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(shown);
        const text = range.getBoundingClientRect();
        return { left: box.left - text.left, right: text.right - box.right };
      });
      expect(past.left, 'cut at the start').toBeLessThanOrEqual(0.01);
      expect(past.right, 'cut at the end').toBeLessThanOrEqual(0.01);
      await expectOnScreen(page, help);
      await expectOnScreen(page, counter(page));
      const [a, b] = [(await help.boundingBox())!, (await counter(page).boundingBox())!];
      const overlaps =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlaps).toBe(false);
    }

    test('fits the whole game, help taken and the counter, with nothing to scroll', async ({
      page,
    }) => {
      await tapStart(page, PUZZLES.medium.givens);
      await takeHelp(page);
      await expectHelpWhole(page);
      await expectWholeGameOnScreen(page);
      await expectOnScreen(page, page.getByRole('banner').getByRole('button', { name: 'Menu' }));
    });

    test('gives way in the header on a daily Medium at 1:23:45, cutting nothing short', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.clock.install({ time: new Date('2026-10-13T10:00:00+01:00') });
      await page.goto('/');
      await waitForPlaying(page);
      await openTodaysDaily(page, 'Medium');
      // Help at its widest beside the timer: the full words at the cap.
      await page.getByRole('switch', { name: 'Auto Candidate Mode' }).tap();
      await tapMore(page, 'Hint');
      await tapMore(page, 'Reveal cell');
      await expect(visibleHelp(page).locator('.help-taken__full')).toHaveText(
        'Auto candidates · Checked as entered · 1 hint · 1 reveal',
      );
      await seedElapsed(page, (1 * 3600 + 23 * 60 + 45) * 1000);
      // Paused, help taken still shows: it says nothing about the board.
      await expect(visibleHelp(page)).toBeVisible();
      const banner = page.getByRole('banner');
      await expect(banner.locator('.header__difficulty')).toContainText('Daily puzzle for');
      for (const state of ['paused', 'playing']) {
        if (state === 'playing') {
          await resumeButton(page).tap();
          await waitForPlaying(page);
        }
        await expect(banner.locator('.timer__time')).toHaveText(/^1:23:4\d$/);
        await expectHeaderWhole(page);
        expect((await overflow(page)).x, state).toBe(0);
        await expectOnScreen(page, visibleHelp(page));
        for (const control of [
          banner.getByRole('button', { name: /^(Pause|Resume)$/ }),
          banner.getByRole('button', { name: 'New game' }),
          banner.getByRole('button', { name: 'Menu' }),
        ]) {
          await expectOnScreen(page, control);
        }
      }
    });
  });
}

/*
 * A game past the hour, at the widest a random game's header gets: Medium,
 * the longest tier name, and h:mm:ss on the clock (a puzzle beyond the
 * techniques, longer again, is below). Something in the header gives way
 * (the wordmark goes first), never the page: nothing scrolls sideways and
 * the Menu button stays whole, paused and playing.
 */
for (const viewport of [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 393, height: 852 },
]) {
  test.describe(`a ${viewport.width}px-wide phone at 1:23:45`, () => {
    test.use({ viewport });

    test('never scrolls the header sideways', async ({ page }) => {
      await tapStart(page, PUZZLES.medium.givens);
      await seedElapsed(page, (1 * 3600 + 23 * 60 + 45) * 1000);
      const banner = page.getByRole('banner');
      await expect(banner.locator('.timer__time')).toHaveText('1:23:45');

      for (const state of ['paused', 'playing']) {
        if (state === 'playing') {
          await resumeButton(page).tap();
          await waitForPlaying(page);
        }
        expect((await overflow(page)).x, state).toBe(0);
        await expect(banner).toContainText('Difficulty: Medium');
        for (const control of [
          banner.getByRole('button', { name: /^(Pause|Resume)$/ }),
          banner.getByRole('button', { name: 'New game' }),
          banner.getByRole('button', { name: 'Menu' }),
        ]) {
          await expectOnScreen(page, control);
        }
      }
    });
  });
}

/*
 * A puzzle beyond the techniques, from a link, past the hour: "Beyond
 * Expert" is the widest label the header shows, wider than "Medium", and the
 * header makes room for it as it does for a daily's "Daily ·" — the wordmark
 * first, then, on the narrowest phone, the label shortens to "Exp+". Whole
 * either way, paused and playing, with nothing scrolling sideways.
 */
for (const { viewport, shown } of [
  { viewport: { width: 320, height: 568 }, shown: 'Exp+' },
  { viewport: { width: 375, height: 667 }, shown: 'Beyond Expert' },
]) {
  test.describe(`a ${viewport.width}px-wide phone with a Beyond Expert puzzle at 1:23:45`, () => {
    test.use({ viewport });

    test(`shows "${shown}" in a header cut nowhere short`, async ({ page }) => {
      await tapStart(page, BEYOND_THE_SET.givens);
      await seedElapsed(page, (1 * 3600 + 23 * 60 + 45) * 1000);
      const banner = page.getByRole('banner');
      await expect(banner).toContainText('Difficulty: Beyond Expert');
      await expect(banner.locator('.header__tier-short')).toBeVisible({
        visible: shown === 'Exp+',
      });
      // The wordmark makes way first, at both widths: still the page's heading, but not on show.
      const wordmark = (await banner.getByRole('heading', { name: 'Sudoku' }).boundingBox())!;
      expect(wordmark.width, 'the wordmark on show').toBeLessThanOrEqual(1);
      for (const state of ['paused', 'playing']) {
        if (state === 'playing') {
          await resumeButton(page).tap();
          await waitForPlaying(page);
        }
        await expect(banner.locator('.timer__time')).toHaveText(/^1:23:4\d$/);
        await expectHeaderWhole(page);
        expect((await overflow(page)).x, state).toBe(0);
        for (const control of [
          banner.getByRole('button', { name: /^(Pause|Resume)$/ }),
          banner.getByRole('button', { name: 'New game' }),
          banner.getByRole('button', { name: 'Menu' }),
        ]) {
          await expectOnScreen(page, control);
        }
      }
    });
  });
}

/*
 * A phone on its side: the board fills the height, and the controls sit
 * beside it. Sizes from an iPhone (667×375) and an Android phone (844×390).
 */
for (const viewport of [
  { width: 667, height: 375 },
  { width: 844, height: 390 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone on its side`, () => {
    test.use({ viewport });

    test('New game shows both its runs whole, nothing cut off below the fold', async ({ page }) => {
      await page.clock.install({ time: new Date('2026-10-13T10:00:00+01:00') });
      await tapStart(page);
      await page.getByRole('banner').getByRole('button', { name: 'New game' }).tap();
      const menu = page.getByRole('menu', { name: 'New game' });
      await expectOnScreen(page, menu);
      for (const item of await menu.getByRole('menuitem').all()) await expectOnScreen(page, item);
      expect(await menu.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
    });

    test('the calendar keeps the day chosen, its name and its puzzles in view', async ({
      page,
    }) => {
      await page.clock.install({ time: new Date('2026-10-13T10:00:00+01:00') });
      await tapStart(page);
      const sheet = await openFromMenu(page, 'Daily puzzles');
      await settle(page);
      const body = sheet.locator('.dialog__body');
      const inBody = async (target: Locator) => {
        const [box, frame] = [(await target.boundingBox())!, (await body.boundingBox())!];
        return box.y >= frame.y - 0.5 && box.y + box.height <= frame.y + frame.height + 0.5;
      };
      expect(await inBody(sheet.getByRole('heading', { name: 'Tuesday 13 October' }))).toBe(true);
      expect(
        await inBody(
          sheet.getByRole('button', { name: 'Play, Easy daily for Tuesday 13 October' }),
        ),
      ).toBe(true);
      await sheet.getByRole('gridcell', { name: /^Thursday 8 October/ }).tap();
      await settle(page);
      expect(await inBody(sheet.getByRole('heading', { name: 'Thursday 8 October' }))).toBe(true);
      expect(
        await inBody(
          sheet.getByRole('button', { name: 'Play, Easy daily for Thursday 8 October' }),
        ),
      ).toBe(true);
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });

    test('fits the whole game with nothing to scroll', async ({ page }) => {
      await gotoPuzzle(page, EASY.givens);
      expect(await overflow(page)).toEqual({ x: 0, y: 0 });
      await expectOnScreen(page, startButton(page));
      await startButton(page).tap();
      await waitForPlaying(page);
      await expectWholeGameOnScreen(page);

      // Candidate mode and a board full of candidates still fit.
      await modeButton(page, 'Candidate').tap();
      await page.getByRole('switch', { name: 'Auto Candidate Mode' }).tap();
      expect(await overflow(page)).toEqual({ x: 0, y: 0 });

      // The "…" menu opens on screen.
      await page.getByRole('button', { name: 'More' }).tap();
      const more = page.getByRole('menu', { name: 'More' });
      await expectOnScreen(page, more);
      await more.getByRole('menuitem', { name: 'Hint' }).tap();
      expect(await overflow(page)).toEqual({ x: 0, y: 0 });

      await page.getByRole('banner').getByRole('button', { name: 'Pause' }).tap();
      await expect(resumeButton(page)).toBeVisible();
      expect(await overflow(page)).toEqual({ x: 0, y: 0 });
      await expectOnScreen(page, resumeButton(page));
    });

    test('keeps every control a 44px touch target', async ({ page }) => {
      await tapStart(page);
      await expectTouchTargets(page);
    });

    test('shows each step of Show me whole, its board beside its words and staying put as they scroll', async ({
      page,
    }) => {
      await getStuck(page);
      await tapHint(page);
      await page.getByRole('button', { name: /^Show me how to solve/ }).tap();
      const sheet = page.getByRole('dialog', { name: 'How to solve row 5, column 2' });
      await expectOnScreen(page, sheet);
      for (let step = 1; step <= 3; step++) {
        await expect(sheet.getByRole('heading', { level: 3 })).toHaveAccessibleName(
          new RegExp(`^Step ${step} of 3:`),
        );
        const layout = await sheet.evaluate((dialog) => {
          const body = dialog.querySelector('.dialog__body')!;
          const box = (element: Element) => element.getBoundingClientRect();
          const board = () => box(dialog.querySelector('.walkthrough__step [role="img"]')!);
          const caption = box(
            dialog.querySelector('.walkthrough__step .technique-diagram__caption')!,
          );
          const inBody = (rect: DOMRect) =>
            rect.top >= box(body).top - 0.5 && rect.bottom <= box(body).bottom + 0.5;
          const before = {
            isBoardWhole: inBody(board()),
            isCaptionBeside: caption.left >= board().right,
            isCaptionBegun: caption.top < box(body).bottom,
          };
          body.scrollTop = body.scrollHeight;
          const isBoardWholeScrolled = inBody(board());
          body.scrollTop = 0;
          return { ...before, isBoardWholeScrolled };
        });
        expect(layout).toEqual({
          isBoardWhole: true,
          isCaptionBeside: true,
          isCaptionBegun: true,
          isBoardWholeScrolled: true,
        });
        if (step < 3) await sheet.getByRole('button', { name: /^Next/ }).tap();
      }
      expect((await overflow(page)).x).toBe(0);
    });

    test('fits every dialog', async ({ page }) => {
      await tapStart(page);
      for (const name of [
        'Daily puzzles',
        'History',
        'Share',
        'Settings',
        'Solving techniques',
        'Help',
      ]) {
        const dialog = await openFromMenu(page, name);
        await expectOnScreen(page, dialog);
        await expectOnScreen(page, dialog.getByRole('button', { name: 'Close' }).first());
        expect((await overflow(page)).x).toBe(0);
        await dialog.getByRole('button', { name: 'Close' }).first().tap();
        await expect(dialog).toBeHidden();
      }
    });
  });
}

/**
 * A right-to-left name as long as a name is kept (24 characters), with no
 * space to break it at, and wider than a row on the narrowest phone: sad and
 * dad, two of the widest Arabic letters, run past 320px at the rows' 15px,
 * where a row has under 280px, so the name has to wrap there.
 */
const LONG_RTL_NAME = 'صض'.repeat(12);

/**
 * Friends with that name everywhere a Friends row draws a name: given one
 * friend (whose latest link says something short), sent by another who has
 * not been named, and said by the latest link of a third, beside a count of
 * their devices — and by that one of the third's two devices, in the list of
 * them their row draws.
 */
const LONG_NAMED_FRIENDS = [
  {
    name: LONG_RTL_NAME,
    devices: [{ id: 'k3x9q7za2m', sentAs: 'Al', lastAt: Date.UTC(2026, 9, 3, 9) }],
  },
  { devices: [{ id: 'z8c2m5r1to', sentAs: LONG_RTL_NAME, lastAt: Date.UTC(2026, 9, 2, 9) }] },
  {
    name: 'Ally',
    devices: [
      { id: 'p0d4wq81xe', sentAs: 'Al', lastAt: Date.UTC(2026, 9, 1, 8) },
      { id: 'q1w2e3r4t5', sentAs: LONG_RTL_NAME, lastAt: Date.UTC(2026, 9, 1, 9) },
    ],
  },
];

/** Every box `targets` draws lies across the dialog's body, inside its padding. */
async function expectInsideBody(dialog: Locator, targets: Locator): Promise<void> {
  const inner = await dialog.locator('.dialog__body').evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      left: box.left + parseFloat(style.paddingLeft),
      right: box.right - parseFloat(style.paddingRight),
    };
  });
  for (const target of await targets.all()) {
    const box = (await target.boundingBox())!;
    expect(box.x, 'its left edge').toBeGreaterThanOrEqual(inner.left - 4.5);
    expect(box.x + box.width, 'its right edge').toBeLessThanOrEqual(inner.right + 4.5);
  }
}

/*
 * Friends, from History's foot: a bottom sheet upright, a card on its side.
 * The longest right-to-left name a link can carry, with nowhere to break, is
 * wider than a row on the narrow phone upright, and wraps inside its row
 * there wherever a row draws it — the name itself, what a named friend's
 * latest link says, and a merged friend's device — rather than scrolling the
 * dialog sideways or being cut off at the row's edge; on its side the name
 * fits a line, and nothing scrolls sideways either. Every control — Rename,
 * Merge… and Split off, the field, Save and Cancel a rename opens, and the
 * picker, Merge and Cancel a merge opens — is a finger's 44px, the field's
 * and the picker's text 16px so that focusing them does not zoom the page.
 */
for (const viewport of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone with friends`, () => {
    test.use({ viewport });

    test('keeps a long right-to-left name inside its Friends row, and every control a 44px touch target, with nothing to scroll sideways', async ({
      page,
    }) => {
      expect([...LONG_RTL_NAME]).toHaveLength(24);
      await seedFriends(page, LONG_NAMED_FRIENDS);
      await tapStart(page);
      const history = await openFromMenu(page, 'History');
      await history.getByRole('button', { name: 'Friends' }).tap();
      const friends = page.getByRole('dialog', { name: 'Friends' });
      await expect(
        friends.getByRole('list', { name: 'Friends, latest first' }).locator(':scope > li'),
      ).toHaveCount(3);
      await settle(page);
      await expectOnScreen(page, friends);
      const body = friends.locator('.dialog__body');
      expect((await overflow(page)).x).toBe(0);
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      const names = friends.locator('bdi', { hasText: LONG_RTL_NAME });
      await expect(names).toHaveCount(4);
      await expectInsideBody(friends, names);
      if (viewport.width === 320) {
        // Upright, the name really does wrap, to two lines or more, each
        // time a row draws it: the line boxes its text sits on.
        const lineCounts = await names.evaluateAll((elements) =>
          elements.map((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
          }),
        );
        expect(lineCounts.map((lines) => lines >= 2)).toEqual([true, true, true, true]);
      }

      for (const button of await friends.getByRole('button').all()) {
        await button.scrollIntoViewIfNeeded();
        const size = (await button.boundingBox())!;
        const label = (await button.getAttribute('aria-label')) ?? '';
        expect(size.height, label).toBeGreaterThanOrEqual(44);
        expect(size.width, label).toBeGreaterThanOrEqual(44);
      }

      // Renaming the friend given the long name, the latest to send a link
      // and so first: the field holds it, and it, Save and Cancel are
      // finger-sized, all inside the row.
      await friends
        .getByRole('button', { name: new RegExp(`^Rename ${LONG_RTL_NAME}`) })
        .first()
        .tap();
      const field = friends.getByRole('textbox', { name: 'Their name' });
      await expect(field).toHaveValue(LONG_RTL_NAME);
      const edit = friends.getByRole('group', { name: new RegExp(`^Rename ${LONG_RTL_NAME}`) });
      for (const target of [
        field,
        edit.getByRole('button', { name: /^Save name/ }),
        edit.getByRole('button', { name: /^Cancel renaming/ }),
      ]) {
        await target.scrollIntoViewIfNeeded();
        const size = (await target.boundingBox())!;
        expect(size.height).toBeGreaterThanOrEqual(44);
        expect(size.width).toBeGreaterThanOrEqual(44);
      }
      expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(16);
      await expectInsideBody(friends, edit);
      expect((await overflow(page)).x).toBe(0);
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      await edit.getByRole('button', { name: /^Cancel renaming/ }).tap();

      // Merging the same friend: everyone else to choose from, the long name
      // among them, in a picker no wider than the row.
      await friends
        .getByRole('button', { name: new RegExp(`^Merge ${LONG_RTL_NAME}`) })
        .first()
        .tap();
      const picker = friends.getByRole('combobox', { name: 'Same person as' });
      await expect(picker).toBeFocused();
      const merging = friends.getByRole('group', { name: new RegExp(`^Merge ${LONG_RTL_NAME}`) });
      for (const target of [
        picker,
        merging.getByRole('button', { name: /^Confirm merge/ }),
        merging.getByRole('button', { name: /^Cancel merging/ }),
      ]) {
        await target.scrollIntoViewIfNeeded();
        const size = (await target.boundingBox())!;
        expect(size.height).toBeGreaterThanOrEqual(44);
        expect(size.width).toBeGreaterThanOrEqual(44);
      }
      expect(await picker.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(16);
      await expectInsideBody(friends, merging);
      expect((await overflow(page)).x).toBe(0);
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });
  });
}

/*
 * History's foot on the narrowest phone: Friends, Export and Import are too
 * many icon buttons for one row at 320px, so Friends takes a row of its own
 * above the other two, 8px apart as the two are side by side, each a
 * finger's 44px, nothing scrolling sideways.
 */
test.describe('a 320×568 phone with friends in History', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("gives Friends a row of its own at History's foot, above Export and Import", async ({
    page,
  }) => {
    await seedFriends(page, LONG_NAMED_FRIENDS);
    await tapStart(page);
    const history = await openFromMenu(page, 'History');
    await settle(page);
    const footer = history.locator('.dialog__footer');
    const [friends, exported, imported] = await Promise.all(
      ['Friends', 'Export', 'Import'].map(
        async (name) => (await footer.getByRole('button', { name }).boundingBox())!,
      ),
    );
    const inner = await footer.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    expect(friends.width).toBeGreaterThanOrEqual(inner - 1);
    expect(exported.y - (friends.y + friends.height)).toBeCloseTo(8, 0);
    // Export and Import share the row beneath, the same 8px apart.
    expect(exported.y).toBe(imported.y);
    expect(imported.x - (exported.x + exported.width)).toBeCloseTo(8, 0);
    for (const box of [friends, exported, imported]) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await expectOnScreen(page, footer);
    expect((await overflow(page)).x).toBe(0);
  });
});

/*
 * "Who sent this?", asked of the first link from someone new: a bottom sheet
 * upright, a card on its side. The longest right-to-left name a link can
 * carry, with nowhere to break, fills its field and is quoted in the field's
 * hint, where upright it wraps inside the sheet rather than scrolling it
 * sideways — and names friends already here, offered in the picker below it,
 * which keeps to the sheet's width. The field, the picker, Save, Skip and
 * the close button are each a finger's 44px, the field's and the picker's
 * text 16px so that focusing them does not zoom the page; upright, Save and
 * Skip share the sheet's foot, Save first.
 */
for (const viewport of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone opening a link from someone new`, () => {
    test.use({ viewport });

    test('keeps a long right-to-left name inside the question of who sent it, and every control a 44px touch target, with nothing to scroll sideways', async ({
      page,
    }) => {
      await seedFriends(page, LONG_NAMED_FRIENDS);
      await gotoPuzzle(page, NEARLY_DONE.givens, {
        challenge: { seconds: 200, name: LONG_RTL_NAME, playerId: 'n3wc0m3r42' },
      });
      const prompt = page.getByRole('dialog', { name: 'Who sent this?' });
      const field = prompt.getByRole('textbox', { name: 'Their name' });
      const picker = prompt.getByRole('combobox', {
        name: 'Or is it a friend you have already, on another device?',
      });
      await expect(picker.getByRole('option')).toHaveCount(4);
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(LONG_RTL_NAME);
      await settle(page);
      await expectOnScreen(page, prompt);
      expect((await overflow(page)).x).toBe(0);
      const body = prompt.locator('.dialog__body');
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      const quoted = prompt.locator('.field__hint bdi');
      await expect(quoted).toHaveText(LONG_RTL_NAME);
      await expectInsideBody(prompt, quoted);
      if (viewport.width === 320) {
        // Upright, the name really does wrap: the line boxes its text sits on.
        const lines = await quoted.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
        });
        expect(lines).toBeGreaterThanOrEqual(2);
        const [save, skip] = await Promise.all(
          ['Save', 'Skip'].map(
            async (name) => (await prompt.getByRole('button', { name }).boundingBox())!,
          ),
        );
        expect(save.y).toBe(skip.y);
        expect(save.x).toBeLessThan(skip.x);
      }

      await expectInsideBody(prompt, picker);
      for (const target of [field, picker, ...(await prompt.getByRole('button').all())]) {
        const size = (await target.boundingBox())!;
        const label = (await target.getAttribute('aria-label')) ?? (await target.innerText());
        expect(size.height, label).toBeGreaterThanOrEqual(44);
        expect(size.width, label).toBeGreaterThanOrEqual(44);
      }
      for (const target of [field, picker]) {
        expect(await target.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(16);
      }
    });
  });
}

/*
 * Enter a puzzle at each phone size, upright and on its side: on screen with
 * nothing to scroll either way, for the board takes the height the rest
 * leaves; every button a finger's 44px (the pad's nine keys, Erase, Play,
 * Share…, Save, Paste and the close button), Play, Share…, Save and Paste
 * side by side with the hint in view under them; and every cell at least
 * WCAG's 24px, but on the shortest phone on its side, which leaves the board
 * room for 22px (upright, it has 25px). A tap on a cell, then on the pad,
 * puts the number in that cell and moves on to the next, as typing does, so
 * the next tap on the pad fills that one.
 */
for (const viewport of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone entering a puzzle`, () => {
    test.use({ viewport });

    test('fits Enter a puzzle with nothing to scroll, every button 44px and every cell 24px', async ({
      page,
    }) => {
      await tapStart(page);
      await page.getByRole('banner').getByRole('button', { name: 'New game' }).tap();
      await page.getByRole('menuitem', { name: 'Your puzzles…' }).tap();
      await page.getByRole('button', { name: 'Enter a new puzzle' }).tap();
      const dialog = page.getByRole('dialog', { name: 'Enter a puzzle' });
      await expect(dialog).toBeVisible();
      await expectOnScreen(page, dialog);
      expect((await overflow(page)).x).toBe(0);
      const body = dialog.locator('.dialog__body');
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      expect(await body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);

      const buttons = await dialog.getByRole('button').all();
      expect(buttons).toHaveLength(15);
      for (const button of buttons) {
        const size = (await button.boundingBox())!;
        const label = (await button.getAttribute('aria-label')) ?? (await button.innerText());
        expect(size.height, label).toBeGreaterThanOrEqual(44);
        expect(size.width, label).toBeGreaterThanOrEqual(44);
      }
      // Play, Share…, Save and Paste on one line, the hint under them and on screen.
      const tops = await Promise.all(
        ['Play', 'Share…', 'Save', 'Paste'].map(async (name) =>
          Math.round((await dialog.getByRole('button', { name }).boundingBox())!.y),
        ),
      );
      expect(new Set(tops).size).toBe(1);
      await expect(dialog.getByText('Check every number against your copy.')).toBeInViewport({
        ratio: 1,
      });
      const smallest = await dialog.getByRole('gridcell').evaluateAll((cells) =>
        Math.min(
          ...cells.flatMap((cell) => {
            const box = cell.getBoundingClientRect();
            return [box.width, box.height];
          }),
        ),
      );
      expect(smallest).toBeGreaterThanOrEqual(viewport.height === 320 ? 22 : 24);

      const target = dialog.getByRole('gridcell').nth(40);
      const next = dialog.getByRole('gridcell').nth(41);
      await target.tap();
      await dialog.getByRole('button', { name: '5', exact: true }).tap();
      await expect(target).toHaveAccessibleName('5, given');
      await expect(next).toHaveAttribute('aria-selected', 'true');
      await dialog.getByRole('button', { name: '6', exact: true }).tap();
      await expect(next).toHaveAccessibleName('6, given');
    });
  });
}

/**
 * A right-to-left name as long as a puzzle's name is kept (40 characters,
 * see `MAX_TITLE_LENGTH`), with no space to break it at: wider than a row on
 * every phone here, upright or on its side.
 */
const LONG_RTL_TITLE = 'صض'.repeat(20);

/** Puzzles kept: one ready to play under that name, and one half typed in, unnamed. */
const LONG_NAMED_PUZZLES = [
  {
    id: 'kept-0001',
    cells: PUZZLES.hard.givens,
    title: LONG_RTL_TITLE,
    createdAt: Date.UTC(2026, 9, 2, 9),
    updatedAt: Date.UTC(2026, 9, 2, 9),
  },
  {
    id: 'kept-0002',
    cells: PUZZLES.hard.givens.slice(0, 30).padEnd(81, '0'),
    createdAt: Date.UTC(2026, 9, 1, 9),
    updatedAt: Date.UTC(2026, 9, 1, 9),
  },
];

/*
 * Your puzzles, from New game, upright and on its side: the longest
 * right-to-left name a puzzle can have, with nowhere to break, wraps inside
 * its row rather than scrolling the dialog sideways or being cut off at the
 * row's edge; Enter a new puzzle, a ready row's Play, Share, Edit, Rename and
 * Delete, and the field, Save and Cancel a rename opens, are each a finger's
 * 44px, the field's text 16px so that focusing it does not zoom the page.
 */
for (const viewport of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 844, height: 390 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone with puzzles kept`, () => {
    test.use({ viewport });

    test('keeps a long right-to-left name inside its row, and every control a 44px touch target, with nothing to scroll sideways', async ({
      page,
    }) => {
      expect([...LONG_RTL_TITLE]).toHaveLength(40);
      await seedPuzzles(page, LONG_NAMED_PUZZLES);
      await tapStart(page);
      await page.getByRole('banner').getByRole('button', { name: 'New game' }).tap();
      await page.getByRole('menuitem', { name: 'Your puzzles…' }).tap();
      const library = page.getByRole('dialog', { name: 'Your puzzles' });
      await expect(library.getByRole('listitem')).toHaveCount(2);
      await settle(page);
      await expectOnScreen(page, library);
      const body = library.locator('.dialog__body');
      expect((await overflow(page)).x).toBe(0);
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      const name = library.locator('bdi', { hasText: LONG_RTL_TITLE });
      await expect(name).toHaveCount(1);
      await expectInsideBody(library, name);

      for (const button of await library.getByRole('button').all()) {
        await button.scrollIntoViewIfNeeded();
        const size = (await button.boundingBox())!;
        const label = (await button.getAttribute('aria-label')) ?? (await button.innerText());
        expect(size.height, label).toBeGreaterThanOrEqual(44);
        expect(size.width, label).toBeGreaterThanOrEqual(44);
      }
      await expectInsideBody(library, library.getByRole('listitem').getByRole('button'));

      await library.getByRole('button', { name: /^Rename صض/ }).tap();
      const field = library.getByRole('textbox', { name: 'Name' });
      await expect(field).toHaveValue(LONG_RTL_TITLE);
      const edit = library.getByRole('group', { name: /^Rename صض/ });
      for (const target of [
        field,
        edit.getByRole('button', { name: /^Save name/ }),
        edit.getByRole('button', { name: /^Cancel renaming/ }),
      ]) {
        await target.scrollIntoViewIfNeeded();
        const size = (await target.boundingBox())!;
        expect(size.height).toBeGreaterThanOrEqual(44);
        expect(size.width).toBeGreaterThanOrEqual(44);
      }
      expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(16);
      await expectInsideBody(library, edit);
      expect((await overflow(page)).x).toBe(0);
      expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });
  });
}

/*
 * The shortest phone on its side, an iPhone SE at 568×320: the game still
 * fits, controls and all. (A two-line hint, under the controls, is the one
 * thing that can need a little scroll at this size.)
 */
test.describe('a 568×320 phone on its side', () => {
  test.use({ viewport: { width: 568, height: 320 } });

  test('fits the whole game with nothing to scroll', async ({ page }) => {
    await tapStart(page);
    await expectWholeGameOnScreen(page);
    await expectTouchTargets(page);
  });

  test('offers a new version over the switch row alone, its buttons finger-sized', async ({
    page,
  }) => {
    await deployNewerVersion(page);
    await tapStart(page);
    await expectOfferClearOfPlay(page);
  });
});

/** A card on the board, whole and still: nothing to scroll inside it, and its top where it arrived. */
async function expectCardWhole(page: Page, heading: string): Promise<void> {
  const card = page.locator('.board-overlay__card');
  await settle(page);
  expect(await overflow(page)).toEqual({ x: 0, y: 0 });
  expect(
    await card.evaluate((el) => ({
      x: el.scrollWidth - el.clientWidth,
      y: el.scrollHeight - el.clientHeight,
      top: el.scrollTop,
    })),
  ).toEqual({ x: 0, y: 0, top: 0 });
  await expectOnScreen(page, card.getByRole('heading', { name: heading }));
}

/*
 * The Start card of a friend's link, on the smallest board of each of its
 * size steps: a 568×320 phone on its side, and the 640×360 board of a common
 * phone on its side (an Android's about 360 tall, a 667×375 iPhone's).
 * Their time to beat with a puzzle's name at its longest fits whole on
 * both, with nothing to scroll inside the card; and on the larger, so does
 * their solve to watch with a name, on the Start card and, after Start, the
 * Paused card. (A solve to watch with a name still scrolls inside the card
 * at 568×320: accepted, its title and Start still in view.)
 */
for (const viewport of [
  { width: 568, height: 320 },
  { width: 640, height: 360 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone on its side, opening a friend's link`, () => {
    test.use({ viewport });

    test('fits their time and a 40-character puzzle name on the Start card, with nothing to scroll', async ({
      page,
    }) => {
      const title = 'Supercalifragilisticexpialidocious #1234';
      expect([...title]).toHaveLength(40);
      await gotoPuzzle(page, EASY.givens, {
        challenge: { seconds: 323, name: 'Dan', assists: 'm0' },
        title,
      });
      await expect(page.locator('.board-overlay__name')).toHaveText(title);
      await expectCardWhole(page, 'Ready?');
      await expectOnScreen(page, startButton(page));
      await expectFingerSized(startButton(page));
    });

    if (viewport.height < 360) return;

    test('fits their solve to watch and a puzzle name on the Start and Paused cards', async ({
      page,
    }) => {
      const { log, seconds } = placedSolve(NEARLY_DONE);
      await page.goto(
        `${puzzleLink(NEARLY_DONE.givens, { seconds, name: 'Dan', assists: 'm0' }, 'The Times #1,234')}&s=${log}`,
      );
      const watch = page.getByRole('main').getByRole('button', { name: "Watch Dan's solve" });
      await expect(watch).toBeVisible();
      await expectCardWhole(page, 'Ready?');
      for (const button of [startButton(page), watch]) {
        await expectOnScreen(page, button);
        await expectFingerSized(button);
      }

      await startButton(page).tap();
      await waitForPlaying(page);
      await page.getByRole('banner').getByRole('button', { name: 'Pause' }).tap();
      await expect(resumeButton(page)).toBeVisible();
      await expectCardWhole(page, 'Paused');
      for (const button of [resumeButton(page), watch]) await expectOnScreen(page, button);
    });
  });
}
