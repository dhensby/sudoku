import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import {
  NEARLY_DONE,
  copiedText,
  emptyCells,
  openHeaderDialog,
  solveFromKeyboard,
  startButton,
  startPuzzle,
  stubClipboard,
  waitForPlaying,
} from './helpers';

/**
 * Comparing solves, end to end, between browsers: A solves a puzzle at 0:12
 * and shares the time with the solve in the link; B opens it, plays it
 * first and solves it at 0:05, then compares the two from the Solved dialog
 * and from History — the cursor moved by the keys and by a press on the
 * chart, the readout and the overlaid board following it, focus back on
 * Compare solves as it closes — and the dialog fits a 320px phone and a
 * phone on its side. Accessibility is a11y.spec.ts's.
 *
 * Each browser is a fresh context, as a friend's would be. Runs on Chromium
 * (desktop layout).
 */

const solved = (page: Page) => page.getByRole('dialog', { name: 'Solved!' });
const compare = (page: Page) => page.getByRole('dialog', { name: 'You vs Alice' });
const chart = (page: Page) => compare(page).getByRole('slider', { name: 'Time' });
const readout = (page: Page) => compare(page).locator('.compare-chart__readout');
const BLANKS = emptyCells(NEARLY_DONE.givens);
const answer = (cell: number) => NEARLY_DONE.solution[cell];

/** A solves NEARLY_DONE in 0:12 and shares the time as Alice, with the solve in the link. */
async function shareWithTheSolve(page: Page): Promise<string> {
  await stubClipboard(page);
  await page.clock.install();
  await startPuzzle(page, NEARLY_DONE);
  await page.clock.fastForward('00:12');
  await solveFromKeyboard(page, NEARLY_DONE);
  await solved(page).getByRole('button', { name: 'Share your time' }).click();
  const share = page.getByRole('dialog', { name: 'Share your time' });
  await share.getByRole('textbox', { name: 'Your name (optional)' }).fill('Alice');
  await share.getByRole('checkbox', { name: 'Include my solve' }).check();
  await share.getByRole('button', { name: 'Copy' }).click();
  await expect(share.getByRole('status')).toHaveText('Copied to clipboard');
  const [message] = await copiedText(page);
  return message.split('\n').at(-1)!;
}

/** In a fresh browser, B opens the link, plays it first and solves it at 0:05. */
async function elsewhere(
  browser: Browser,
  link: string,
  body: (page: Page) => Promise<void>,
  viewport?: { width: number; height: number },
): Promise<void> {
  const context = await browser.newContext(viewport === undefined ? {} : { viewport });
  try {
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(link);
    await startButton(page).click();
    await waitForPlaying(page);
    await page.clock.fastForward('00:05');
    await solveFromKeyboard(page, NEARLY_DONE);
    await expect(solved(page)).toBeVisible();
    await body(page);
  } finally {
    await context.close();
  }
}

/** The overlaid board's cell at `index`. */
const boardCell = (page: Page, index: number): Locator =>
  compare(page).getByRole('table', { name: 'Sudoku board' }).getByRole('cell').nth(index);

/** Press the chart where `second` is, of a solve `maxSecond` long. */
async function pressAt(page: Page, second: number, maxSecond: number): Promise<void> {
  const box = (await compare(page).locator('.compare-chart__svg').boundingBox())!;
  // The plot runs from 30px in to 12px short of the right edge (CompareChart.tsx).
  const x = box.x + 30 + (second / maxSecond) * (box.width - 42);
  await page.mouse.click(x, box.y + box.height / 2);
}

test('a friend compares their solve with the one shared, from the Solved dialog and History', async ({
  page,
  browser,
}) => {
  const link = await shareWithTheSolve(page);
  await elsewhere(browser, link, async (b) => {
    const versus = solved(b).getByRole('region', { name: 'Head to head' });
    await expect(versus.getByRole('button')).toHaveText(["Watch Alice's solve", 'Compare solves']);
    await versus.getByRole('button', { name: 'Compare solves' }).click();

    await expect(compare(b)).toHaveAccessibleDescription(/^Easy · You 0:0\d · Alice 0:12$/);
    await expect(chart(b)).toBeFocused();
    // It opens where the faster solve, B's, finished: Alice had nothing yet.
    await expect(readout(b)).toHaveText(/^0:0\d — You 3 cells, Alice 0 cells$/);
    for (const cell of BLANKS) {
      await expect(boardCell(b, cell)).toHaveAccessibleName(`${answer(cell)}, yours`);
    }
    await expect(compare(b).locator('.compare-chart__label text')).toHaveText([
      /^You 0:0\d$/,
      /Alice.* 0:12$/,
    ]);

    await b.keyboard.press('End');
    await expect(readout(b)).toHaveText('0:12 — You 3 cells, Alice 3 cells');
    await expect(chart(b)).toHaveAttribute(
      'aria-valuetext',
      /^0:12 — You 3 cells, .*Alice.* 3 cells$/,
    );
    await expect(boardCell(b, BLANKS[0])).toHaveAccessibleName(`${answer(BLANKS[0])}, both of you`);

    await b.keyboard.press('Home');
    await expect(readout(b)).toHaveText('0:00 — You 0 cells, Alice 0 cells');
    await expect(boardCell(b, BLANKS[0])).toHaveAccessibleName('empty');
    await b.keyboard.press('ArrowRight');
    await expect(chart(b)).toHaveAttribute('aria-valuenow', '1');

    // A press on the chart puts the cursor there.
    await pressAt(b, 9, 12);
    await expect(chart(b)).toHaveAttribute('aria-valuenow', '9');
    await expect(readout(b)).toHaveText('0:09 — You 3 cells, Alice 0 cells');
    await expect(chart(b)).toBeFocused();

    // The table behind it.
    await compare(b).getByRole('button', { name: 'Show as table' }).click();
    await expect(compare(b).getByRole('table', { name: 'Cells solved, of 3' })).toBeVisible();
    await expect(compare(b)).toContainText(
      'Neither of you made a mistake that counted, or took a hint, a check or a reveal.',
    );

    await compare(b).getByRole('button', { name: 'Close' }).click();
    await expect(compare(b)).toBeHidden();
    await expect(versus.getByRole('button', { name: 'Compare solves' })).toBeFocused();
    await solved(b).getByRole('button', { name: 'Close' }).click();

    // And from History, where the game keeps both solves.
    await openHeaderDialog(b, 'History');
    const history = b.getByRole('dialog', { name: 'History' });
    await history.getByRole('button', { name: /^Compare solves, / }).click();
    await expect(readout(b)).toHaveText(/^0:0\d — You 3 cells, Alice 0 cells$/);
    await b.keyboard.press('Escape');
    await expect(compare(b)).toBeHidden();
    await expect(history.getByRole('button', { name: /^Compare solves, / })).toBeFocused();
  });
});

test('offers no comparison for a link without a solve', async ({ page }) => {
  await page.clock.install();
  await startPuzzle(page, NEARLY_DONE, { challenge: { seconds: 12, name: 'Alice' } });
  await solveFromKeyboard(page, NEARLY_DONE);
  await expect(solved(page).getByRole('region', { name: 'Head to head' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare solves' })).toHaveCount(0);
});

test.describe('on a small screen', () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 568, height: 320 },
  ]) {
    test(`fits ${viewport.width}×${viewport.height}, the chart and the board inside the sheet`, async ({
      page,
      browser,
    }) => {
      const link = await shareWithTheSolve(page);
      await elsewhere(
        browser,
        link,
        async (b) => {
          await solved(b).getByRole('button', { name: 'Compare solves' }).click();
          await expect(chart(b)).toBeFocused();
          const fit = await b.evaluate(() => {
            const body = document.querySelector('.dialog__body')!;
            const outer = body.getBoundingClientRect();
            const inside = (selector: string) =>
              [...document.querySelectorAll(selector)].every((element) => {
                const box = element.getBoundingClientRect();
                return box.left >= outer.left - 0.5 && box.right <= outer.right + 0.5;
              });
            /** Wholly in the body's view as it stands, top to bottom. */
            const inView = (selector: string) => {
              const box = document.querySelector(selector)!.getBoundingClientRect();
              return box.top >= outer.top - 0.5 && box.bottom <= outer.bottom + 0.5;
            };
            return {
              across: body.scrollWidth - body.clientWidth,
              pageAcross: document.documentElement.scrollWidth - window.innerWidth,
              // Opened at the top: focusing the chart scrolls nothing.
              scrolled: body.scrollTop,
              // On a phone on its side the chart and the board are both in
              // view as it opens; upright, the board is below the chart.
              bothInView: inView('.compare-chart__svg') && inView('.compare__board .board'),
              chart: inside('.compare-chart__svg'),
              board: inside('.compare__board .board'),
              key: inside('.compare-key__item'),
              legend: inside('.compare-legend__item'),
            };
          });
          expect(fit).toEqual({
            across: 0,
            pageAcross: 0,
            scrolled: 0,
            bothInView: viewport.width > viewport.height,
            chart: true,
            board: true,
            key: true,
            legend: true,
          });
          // The keys still move it, and the board follows.
          await b.keyboard.press('End');
          await expect(boardCell(b, BLANKS[0])).toHaveAccessibleName(
            `${answer(BLANKS[0])}, both of you`,
          );
        },
        viewport,
      );
    });
  }
});
