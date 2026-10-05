import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  NEARLY_DONE,
  PUZZLES,
  cell,
  emptyCells,
  gotoPuzzle,
  grid,
  modeButton,
  padKey,
  resumeButton,
  startButton,
  stubClipboard,
  waitForPlaying,
} from './helpers';

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

/**
 * Let entrance animations finish — a phone's dialog slides up from below the
 * screen as a sheet — so boxes are measured where they come to rest.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
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
    for (const name of ['History', 'Share', 'Settings', 'Help']) {
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
    await page.getByRole('menuitem', { name: 'Hard' }).tap();
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
test.describe('a 375×667 phone', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('fits the whole game with nothing to scroll', async ({ page }) => {
    await tapStart(page);
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

  test('keeps every control a 44px touch target', async ({ page }) => {
    await tapStart(page);
    await expectTouchTargets(page);
  });
});

/*
 * A game past the hour, at the widest a header gets: Medium, the longest
 * tier name, and h:mm:ss on the clock. Something in the header gives way
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
 * A phone on its side: the board fills the height, and the controls sit
 * beside it. Sizes from an iPhone (667×375) and an Android phone (844×390).
 */
for (const viewport of [
  { width: 667, height: 375 },
  { width: 844, height: 390 },
]) {
  test.describe(`a ${viewport.width}×${viewport.height} phone on its side`, () => {
    test.use({ viewport });

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

    test('fits every dialog', async ({ page }) => {
      await tapStart(page);
      for (const name of ['History', 'Share', 'Settings', 'Help']) {
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
});
