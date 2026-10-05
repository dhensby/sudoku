import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { decodeGivens } from '../src/core';
import {
  NEARLY_DONE,
  NEARLY_DONE_2,
  PUZZLES,
  boardArea,
  cell,
  copiedText,
  emptyCells,
  gotoPuzzle,
  newGame,
  openHeaderDialog,
  readBoard,
  readTimer,
  solveFromKeyboard,
  startPuzzle,
  stubClipboard,
  toSeconds,
  typeDigits,
  waitForPlaying,
} from './helpers';

/**
 * History, end to end: every game started is listed, and from the list a
 * game can be resumed (board and time intact), played again, shared or
 * deleted. Export downloads the whole history as JSON, and importing that
 * file into a browser that has never seen it brings the games — unfinished
 * boards included — across.
 *
 * Runs on Chromium (desktop layout).
 */

async function openHistory(page: Page): Promise<Locator> {
  await openHeaderDialog(page, 'History');
  const dialog = page.getByRole('dialog', { name: 'History' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The rows of the list — not the chips nested inside them. */
const rows = (dialog: Locator) =>
  dialog.getByRole('list', { name: 'Games, newest first' }).locator(':scope > li');

/** Enter a number in the game on screen, so it is played rather than only glimpsed. */
async function makeAMove(page: Page): Promise<void> {
  const empty = (await readBoard(page)).indexOf('0');
  await cell(page, empty).click();
  await page.keyboard.press('5');
}

/** A first visit's game, then a Medium one: two unfinished games, Medium on screen. */
async function playTwoGames(page: Page): Promise<void> {
  await page.goto('/');
  await waitForPlaying(page);
  await makeAMove(page);
  await newGame(page, 'Medium');
  await waitForPlaying(page);
  await expect(page.getByRole('banner')).toContainText('Difficulty: Medium');
}

test.describe('history', () => {
  test('lists every game started, newest first, with how far it got', async ({ page }) => {
    await playTwoGames(page);
    const dialog = await openHistory(page);

    await expect(rows(dialog)).toHaveCount(2);
    await expect(rows(dialog).nth(0)).toContainText('Medium');
    await expect(rows(dialog).nth(0)).toContainText('Current');
    await expect(rows(dialog).nth(0)).toContainText(/In progress · 0:\d\d/);
    await expect(rows(dialog).nth(1)).toContainText('Easy');
    await expect(rows(dialog).nth(1)).toContainText(/In progress · 0:\d\d/);
    // The game on screen is not offered for resuming; the other one is.
    await expect(
      rows(dialog)
        .nth(0)
        .getByRole('button', { name: /^Resume/ }),
    ).toHaveCount(0);
    await expect(
      rows(dialog)
        .nth(1)
        .getByRole('button', { name: /^Resume/ }),
    ).toBeVisible();

    const table = dialog.getByRole('table', { name: 'Stats by level' });
    // Played 1, solved 0, no best or average yet.
    await expect(table.getByRole('row', { name: /^Easy/ })).toHaveText(/^Easy\s*1\s*0\s*—\s*—$/);
    await expect(table.getByRole('row', { name: /^Medium/ })).toHaveText(
      /^Medium\s*1\s*0\s*—\s*—$/,
    );
    await expect(table.getByRole('row', { name: /^Hard/ })).toHaveText(/^Hard\s*0\s*0\s*—\s*—$/);

    await dialog.getByRole('tab', { name: 'Medium' }).click();
    await expect(rows(dialog)).toHaveCount(1);
    await dialog.getByRole('tab', { name: 'Hard' }).click();
    await expect(dialog).toContainText('No Hard games yet.');
  });

  test('an unfinished game resumes with its board and its time', async ({ page }) => {
    await page.clock.install();
    const easy = PUZZLES.easy;
    await startPuzzle(page, easy);
    await typeDigits(
      page,
      emptyCells(easy.givens)
        .slice(0, 3)
        .map((index) => ({ index, digit: Number(easy.solution[index]) })),
    );
    const board = await readBoard(page);
    await page.clock.fastForward('00:30');
    // Paused, so the time it is left at is exact.
    await page.keyboard.press('p');
    const time = await readTimer(page);
    expect(toSeconds(time)).toBeGreaterThanOrEqual(30);

    await newGame(page, 'Hard');
    await waitForPlaying(page);
    expect(await readBoard(page)).not.toBe(board);
    // Played, not just glimpsed, so it is kept when the Easy game takes its place.
    await makeAMove(page);

    const dialog = await openHistory(page);
    const row = rows(dialog).filter({ hasText: 'Easy' });
    await expect(row).toContainText(`In progress · ${time}`);
    await row.getByRole('button', { name: /^Resume Easy puzzle from Today \d\d:\d\d$/ }).click();
    await expect(dialog).toBeHidden();

    // The board as it was left, and the clock carrying on from its time.
    await waitForPlaying(page);
    await expect(page.getByRole('banner')).toContainText('Difficulty: Easy');
    expect(await readBoard(page)).toBe(board);
    const resumed = toSeconds(await readTimer(page));
    expect(resumed).toBeGreaterThanOrEqual(toSeconds(time));
    expect(resumed).toBeLessThan(toSeconds(time) + 5);

    // The Hard game was set aside, and can be resumed in turn.
    const again = await openHistory(page);
    await expect(
      rows(again)
        .filter({ hasText: 'Hard' })
        .getByRole('button', { name: /^Resume/ }),
    ).toBeVisible();
  });

  test('Play again on a solved puzzle is a fresh attempt, which sets no record', async ({
    page,
  }) => {
    await page.clock.install();
    await startPuzzle(page, NEARLY_DONE);
    await page.clock.fastForward('00:07');
    await solveFromKeyboard(page, NEARLY_DONE);
    const done = page.getByRole('dialog', { name: 'Solved!' });
    await done.getByRole('button', { name: 'Close' }).click();
    const time = await readTimer(page);

    const dialog = await openHistory(page);
    await expect(rows(dialog)).toHaveCount(1);
    await expect(rows(dialog).first()).toContainText(`Solved in ${time}`);
    await rows(dialog)
      .first()
      .getByRole('button', { name: /^Play again, Easy puzzle/ })
      .click();
    await expect(dialog).toBeHidden();

    await waitForPlaying(page);
    expect(await readBoard(page)).toBe(NEARLY_DONE.givens);
    expect(toSeconds(await readTimer(page))).toBeLessThan(5);

    const after = await openHistory(page);
    await expect(rows(after)).toHaveCount(2);
    await expect(rows(after).nth(0)).toContainText('Current');
    await expect(rows(after).nth(1)).toContainText(`Solved in ${time}`);
    await page.keyboard.press('Escape');
    await waitForPlaying(page);

    // Faster from memory — but a board seen before is no record.
    await solveFromKeyboard(page, NEARLY_DONE);
    const replay = page.getByRole('dialog', { name: 'Solved!' });
    await expect(replay).toContainText("so this time doesn't count towards your best or average");
    await expect(replay.getByText('New best!')).toHaveCount(0);
    const stats = replay.getByRole('region', { name: 'Your Easy record' });
    await expect(stats).toContainText(/Solved\s*2/);
    await expect(stats).toContainText(new RegExp(`Best\\s*${time}`));
    await expect(stats).toContainText(new RegExp(`Average\\s*${time}`));

    // Nor is it a time to race: it shares the puzzle alone.
    await expect(replay.getByRole('button', { name: 'Share your time' })).toHaveCount(0);
    await replay.getByRole('button', { name: 'Share puzzle' }).click();
    const share = page.getByRole('dialog', { name: 'Share this puzzle' });
    await expect(share).toContainText('Try this Easy Sudoku!');
    await expect(share).not.toContainText('Can you beat my time?');
    await share.getByRole('button', { name: 'Close' }).click();

    // From History too, on the replay's row.
    const list = await openHistory(page);
    await rows(list)
      .first()
      .getByRole('button', { name: /^Share Easy puzzle/ })
      .click();
    await expect(page.getByRole('dialog', { name: 'Share this puzzle' })).toBeVisible();
  });

  test('an unfinished game offers Resume rather than Play again, and the one on screen neither', async ({
    page,
  }) => {
    await playTwoGames(page);
    const dialog = await openHistory(page);
    const easy = rows(dialog).filter({ hasText: 'Easy' });
    await expect(easy.getByRole('button', { name: /^Resume Easy puzzle/ })).toBeVisible();
    await expect(easy.getByRole('button', { name: /^Play again/ })).toHaveCount(0);
    const current = rows(dialog).filter({ hasText: 'Current' });
    await expect(current.getByRole('button', { name: /^(Resume|Play again)/ })).toHaveCount(0);
    await expect(current.getByRole('button', { name: /^Share Medium puzzle/ })).toBeVisible();
  });

  test('a shared puzzle on screen, not yet started, offers nothing to resume or replay', async ({
    page,
  }) => {
    await gotoPuzzle(page, PUZZLES.medium.givens, { challenge: { seconds: 200, name: 'Dan' } });
    await expect(boardArea(page).getByRole('heading', { name: 'Ready?' })).toBeVisible();

    const dialog = await openHistory(page);
    await expect(rows(dialog)).toHaveCount(1);
    await expect(rows(dialog).first()).toContainText('vs Dan 3:20');
    await expect(
      rows(dialog)
        .first()
        .getByRole('button', { name: /^(Resume|Play again)/ }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(boardArea(page).getByRole('heading', { name: 'Ready?' })).toBeVisible();
  });

  test('every row lays its actions out on a line of their own, below what it says', async ({
    page,
  }) => {
    await playTwoGames(page);
    const dialog = await openHistory(page);
    for (const row of await rows(dialog).all()) {
      // Both measured at once: the dialog may still be scaling in.
      const [info, actions] = await row.evaluate((li) =>
        ['.history-item__info', '.history-item__actions'].map((selector) => {
          const { x, y, bottom } = li.querySelector(selector)!.getBoundingClientRect();
          return { x, y, bottom };
        }),
      );
      expect(actions.y).toBeGreaterThanOrEqual(info.bottom);
      expect(Math.abs(actions.x - info.x)).toBeLessThanOrEqual(0.5);
    }
  });

  test('games only glimpsed are not kept, nor counted as played', async ({ page }) => {
    await page.goto('/');
    await waitForPlaying(page);
    for (const tier of ['Medium', 'Hard', 'Easy']) {
      await newGame(page, tier);
      await waitForPlaying(page);
    }
    const dialog = await openHistory(page);
    await expect(rows(dialog)).toHaveCount(1);
    await expect(rows(dialog).first()).toContainText('Current');
    const table = dialog.getByRole('table', { name: 'Stats by level' });
    await expect(table.getByRole('row', { name: /^Easy/ })).toHaveText(/^Easy\s*1\s*0/);
    await expect(table.getByRole('row', { name: /^Medium/ })).toHaveText(/^Medium\s*0\s*0/);
    await expect(table.getByRole('row', { name: /^Hard/ })).toHaveText(/^Hard\s*0\s*0/);
  });

  test('a deleted game’s puzzle stays seen: its link opens as a replay, which sets no best', async ({
    page,
  }) => {
    await page.clock.install();
    // An Easy best of a few seconds.
    await startPuzzle(page, NEARLY_DONE_2);
    await page.clock.fastForward('00:05');
    await solveFromKeyboard(page, NEARLY_DONE_2);
    await page
      .getByRole('dialog', { name: 'Solved!' })
      .getByRole('button', { name: 'Close' })
      .click();

    // Study another puzzle for a while, then delete the attempt.
    await startPuzzle(page, NEARLY_DONE);
    await page.clock.fastForward('00:06');
    const dialog = await openHistory(page);
    const studied = rows(dialog).filter({ hasText: 'Current' });
    await studied.getByRole('button', { name: /^Delete Easy puzzle/ }).click();
    await studied.getByRole('button', { name: /^Confirm delete, Easy puzzle/ }).click();
    await page.keyboard.press('Escape');

    // Its link again, solved from memory at once: no fresh attempt, no new best.
    await startPuzzle(page, NEARLY_DONE);
    await solveFromKeyboard(page, NEARLY_DONE);
    const done = page.getByRole('dialog', { name: 'Solved!' });
    await expect(done).toContainText("You'd played this puzzle before");
    await expect(done.getByText('New best!')).toHaveCount(0);
    await expect(done.getByRole('region', { name: 'Your Easy record' })).toContainText(
      /Best\s*0:0[5-6]/,
    );
  });

  test('Share on a row shares that puzzle, then goes back to History', async ({ page }) => {
    await stubClipboard(page);
    await playTwoGames(page);
    const dialog = await openHistory(page);
    await rows(dialog)
      .filter({ hasText: 'Easy' })
      .getByRole('button', { name: /^Share Easy puzzle/ })
      .click();
    const share = page.getByRole('dialog', { name: 'Share this puzzle' });
    await expect(share).toContainText('Try this Easy Sudoku!');
    await share.getByRole('button', { name: 'Copy', exact: true }).click();
    const [message] = await copiedText(page);
    const code = new URL(message.split('\n').at(-1)!).searchParams.get('p');
    expect(decodeGivens(code!)).not.toBeNull();

    await share.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog', { name: 'History' })).toBeVisible();
  });

  test('Delete asks first, then removes the game', async ({ page }) => {
    await playTwoGames(page);
    const dialog = await openHistory(page);
    const easy = rows(dialog).filter({ hasText: 'Easy' });

    await easy.getByRole('button', { name: /^Delete Easy puzzle/ }).click();
    await easy.getByRole('button', { name: /^Cancel deleting Easy puzzle/ }).click();
    await expect(rows(dialog)).toHaveCount(2);

    await easy.getByRole('button', { name: /^Delete Easy puzzle/ }).click();
    await easy.getByRole('button', { name: /^Confirm delete, Easy puzzle/ }).click();
    await expect(rows(dialog)).toHaveCount(1);
    await expect(rows(dialog).first()).toContainText('Medium');

    // Gone for good: still gone after a reload.
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByRole('main').getByRole('button', { name: 'Resume' })).toBeVisible();
    const reopened = await openHistory(page);
    await expect(rows(reopened)).toHaveCount(1);
  });

  test('deleting the game on screen leaves History free to empty, and a new one of its tier follows', async ({
    page,
  }) => {
    await playTwoGames(page);
    const before = await readBoard(page);
    const dialog = await openHistory(page);
    const medium = rows(dialog).filter({ hasText: 'Current' });
    await medium.getByRole('button', { name: /^Delete Medium puzzle/ }).click();
    await medium.getByRole('button', { name: /^Confirm delete, Medium puzzle/ }).click();

    // Nothing takes its place while History is open, so the list can empty.
    await expect(rows(dialog)).toHaveCount(1);
    await expect(rows(dialog).filter({ hasText: 'Current' })).toHaveCount(0);
    const easy = rows(dialog).filter({ hasText: 'Easy' });
    await easy.getByRole('button', { name: /^Delete Easy puzzle/ }).click();
    await easy.getByRole('button', { name: /^Confirm delete, Easy puzzle/ }).click();
    await expect(dialog).toContainText('No games yet');

    // Closing History brings a new game of the deleted one's tier, under way.
    await page.keyboard.press('Escape');
    await waitForPlaying(page);
    await expect(page.getByRole('banner')).toContainText('Difficulty: Medium');
    expect(await readBoard(page)).not.toBe(before);
    const after = await openHistory(page);
    await expect(rows(after)).toHaveCount(1);
    await expect(rows(after).first()).toContainText('Current');
  });

  test('Export downloads the history, and Import restores it in another browser', async ({
    page,
    browser,
  }, testInfo) => {
    // Two unfinished games, the Easy one with some work on its board.
    await page.goto('/');
    await waitForPlaying(page);
    const board = await readBoard(page);
    const blanks = emptyCells(board).slice(0, 2);
    await typeDigits(
      page,
      blanks.map((index) => ({ index, digit: 1 + (index % 9) })),
    );
    const played = await readBoard(page);
    await newGame(page, 'Medium');
    await waitForPlaying(page);

    const dialog = await openHistory(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Export' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^sudoku-history-\d{4}-\d{2}-\d{2}\.json$/);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    const exported = JSON.parse(await readFile(file, 'utf8')) as {
      app: string;
      version: number;
      records: { difficulty: string; status: string }[];
      games: Record<string, unknown>;
    };
    expect(exported.app).toBe('sudoku');
    expect(exported.version).toBe(1);
    expect(exported.records.map((record) => record.difficulty)).toEqual(['medium', 'easy']);
    expect(Object.keys(exported.games)).toHaveLength(2);

    // A browser that has never seen any of it.
    const elsewhere = await browser.newContext();
    try {
      const other = await elsewhere.newPage();
      await other.goto('/');
      await waitForPlaying(other);
      const imported = await openHistory(other);
      await expect(rows(imported)).toHaveCount(1);

      const [chooser] = await Promise.all([
        other.waitForEvent('filechooser'),
        imported.getByRole('button', { name: 'Import' }).click(),
      ]);
      await chooser.setFiles(file);
      await expect(imported.getByRole('status')).toHaveText('Imported 2 new games, updated 0.');
      await expect(rows(imported)).toHaveCount(3);

      // The unfinished Easy game came with its board.
      const easyRows = rows(imported).filter({ hasText: 'Easy' });
      await easyRows
        .getByRole('button', { name: /^Resume Easy puzzle/ })
        .first()
        .click();
      await waitForPlaying(other);
      expect(await readBoard(other)).toBe(played);
    } finally {
      await elsewhere.close();
    }
  });

  test('importing something that is not a history export is refused', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await waitForPlaying(page);
    const dialog = await openHistory(page);
    const file = testInfo.outputPath('not-history.json');
    await writeFile(file, JSON.stringify({ hello: 'world' }));
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      dialog.getByRole('button', { name: 'Import' }).click(),
    ]);
    await chooser.setFiles(file);
    await expect(dialog.getByRole('status')).toHaveText("That file isn't a Sudoku history export.");
    await expect(rows(dialog)).toHaveCount(1);
  });
});
