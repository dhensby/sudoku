import { expect, type Locator, type Page } from '@playwright/test';
import {
  encodeGivens,
  generatePuzzle,
  gridValues,
  mulberry32,
  rate,
  solve,
  type Difficulty,
  type GridString,
  type Puzzle,
} from '../src/core';

/*
 * Shared fixtures and steps for the end-to-end suite.
 *
 * Puzzles come from the real engine — the same `generatePuzzle` the worker
 * runs, seeded so every run plays the same grids — and reach the app the way
 * a friend's would: as a `?p=` share link built with the real codec. Nothing
 * here copies what the engine does, so the two cannot drift apart.
 *
 * The board is read back through the cells' accessible names ("5, given",
 * "7", "empty, candidates 1 4"), which is what a screen reader hears and is
 * the app's promise about each cell's state.
 */

/** One deterministic puzzle per tier, generated when the suite loads. */
export const PUZZLES: Readonly<Record<Difficulty, Puzzle>> = {
  easy: generatePuzzle('easy', mulberry32(101)),
  medium: generatePuzzle('medium', mulberry32(202)),
  hard: generatePuzzle('hard', mulberry32(303)),
  expert: generatePuzzle('expert', mulberry32(404)),
};

/**
 * Where `nearlyComplete` leaves its blanks: a transversal — (0,0), (4,4),
 * (8,8), (1,3), (2,6)… — so no two share a row, column or box, and each is a
 * full house on its own.
 */
const SPREAD = [0, 40, 80, 12, 24, 28, 52, 56, 68];

/**
 * A puzzle with all but `blanks` cells given, so a test can finish it in a
 * few key presses. Its tier is re-rated, exactly as the app re-rates a link
 * (it comes out Easy: every blank is a full house).
 */
export function nearlyComplete(solution: GridString, blanks = 3): Puzzle {
  const values = gridValues(solution);
  for (const index of SPREAD.slice(0, blanks)) values[index] = 0;
  const givens = Array.from(values).join('');
  return { givens, solution, difficulty: rate(values) };
}

/** Finished in three key presses. */
export const NEARLY_DONE = nearlyComplete(PUZZLES.easy.solution);
/** Another quick one, a different grid, for tests that need two games. */
export const NEARLY_DONE_2 = nearlyComplete(PUZZLES.medium.solution);

/** The empty cells of a puzzle, in reading order. */
export function emptyCells(givens: GridString): number[] {
  return [...givens].flatMap((ch, index) => (ch === '0' ? [index] : []));
}

/** A grid's solution, worked out by the real solver; throws if it has none. */
export function solutionOf(givens: GridString): GridString {
  const solved = solve(gridValues(givens));
  if (solved === null) throw new Error('the grid has no solution');
  return Array.from(solved).join('');
}

/** A sharer's result to put in a link. `assists` is the link's compact form, e.g. `ch2`. */
export interface LinkChallenge {
  seconds: number;
  name?: string;
  assists?: string;
}

/** The path and query of a share link to `givens`, as the app's Share dialog builds it. */
export function puzzleLink(givens: GridString, challenge?: LinkChallenge): string {
  const params = new URLSearchParams({ p: encodeGivens(givens) });
  if (challenge !== undefined) {
    params.set('t', String(challenge.seconds));
    if (challenge.name !== undefined) params.set('n', challenge.name);
    if (challenge.assists !== undefined) params.set('a', challenge.assists);
  }
  return `/?${params.toString()}`;
}

/** The board's place: the grid, or the card standing in for it. Inside `main`, unlike the header. */
export const boardArea = (page: Page): Locator => page.getByRole('main');

/** The card's own Start button — the header's timer is also called "Start" before a shared game begins. */
export const startButton = (page: Page): Locator =>
  boardArea(page).getByRole('button', { name: 'Start' });

/** The card's own Resume button (the timer is also "Resume" while paused). */
export const resumeButton = (page: Page): Locator =>
  boardArea(page).getByRole('button', { name: 'Resume' });

/** The timer: a button named for what it does, described by the time it shows. */
export const timer = (page: Page): Locator =>
  page.getByRole('banner').getByRole('button', { name: /^(Pause|Resume|Start)$/ });

export const grid = (page: Page): Locator => page.getByRole('grid', { name: 'Sudoku board' });

export const cells = (page: Page): Locator => page.getByRole('gridcell');

export const cell = (page: Page, index: number): Locator => cells(page).nth(index);

/** A number pad key: "5", or "5, all placed" once nine are on the board. */
export const padKey = (page: Page, digit: number): Locator =>
  page.getByRole('button', { name: new RegExp(`^${digit}(, all placed)?$`) });

/** One half of the Normal | Candidate toggle. */
export const modeButton = (page: Page, name: 'Normal' | 'Candidate'): Locator =>
  page.getByRole('group', { name: 'Input mode' }).getByRole('button', { name });

/** The time the header shows (also present, visually hidden, once solved). */
export async function readTimer(page: Page): Promise<string> {
  return (await page.getByRole('banner').locator('.timer__time').innerText()).replace(
    /^Solved in\s*/,
    '',
  );
}

/** "m:ss" or "h:mm:ss" to whole seconds. */
export function toSeconds(time: string): number {
  return time.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

/**
 * Open a share link to `givens`. A puzzle new to this browser waits behind
 * its Ready card; this resolves once the card (or, for a puzzle already in
 * progress here, the paused card) is up.
 *
 * Waits for the page to render: `goto` resolves on the load event, and React
 * paints in a task of its own after that, so for a moment the page is an
 * empty #root that a bare key press would fall into.
 */
export async function gotoPuzzle(
  page: Page,
  givens: GridString,
  options: { challenge?: LinkChallenge } = {},
): Promise<void> {
  await page.goto(puzzleLink(givens, options.challenge));
  await expect(boardArea(page).getByRole('heading').or(grid(page)).first()).toBeVisible();
}

/** Open a share link and press Start: the puzzle is on screen with the clock running. */
export async function startPuzzle(
  page: Page,
  puzzle: Puzzle,
  options: { challenge?: LinkChallenge } = {},
): Promise<void> {
  await gotoPuzzle(page, puzzle.givens, options);
  await startButton(page).click();
  await waitForPlaying(page);
}

/** The board is on screen and the clock is running. */
export async function waitForPlaying(page: Page): Promise<void> {
  await expect(grid(page)).toBeVisible();
  await expect(timer(page)).toHaveAccessibleName('Pause');
}

/** Every cell's accessible name, in reading order. */
export async function cellLabels(page: Page): Promise<string[]> {
  return cells(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
}

/** The board as a grid string, read from the cells' accessible names ('0' for empty). */
export async function readBoard(page: Page): Promise<GridString> {
  const labels = await cellLabels(page);
  if (labels.length !== 81) throw new Error(`expected 81 cells, found ${labels.length}`);
  return labels.map((label) => (/^[1-9]/.test(label) ? label[0] : '0')).join('');
}

/** The selected cell's index, from its grid position. */
export async function selectedIndex(page: Page): Promise<number> {
  const selected = page.getByRole('gridcell', { selected: true });
  const row = Number(await selected.getAttribute('aria-rowindex'));
  const col = Number(await selected.getAttribute('aria-colindex'));
  return (row - 1) * 9 + (col - 1);
}

/**
 * Move the selection with the arrow keys, as a keyboard player would. The
 * board clamps at its edges and never wraps, so the path is exact.
 */
export async function arrowTo(page: Page, from: number, to: number): Promise<void> {
  const rows = Math.floor(to / 9) - Math.floor(from / 9);
  const cols = (to % 9) - (from % 9);
  for (let i = 0; i < Math.abs(rows); i++) {
    await page.keyboard.press(rows > 0 ? 'ArrowDown' : 'ArrowUp');
  }
  for (let i = 0; i < Math.abs(cols); i++) {
    await page.keyboard.press(cols > 0 ? 'ArrowRight' : 'ArrowLeft');
  }
}

/**
 * Select a cell with the mouse. A click on the cell that is already selected
 * is not a selection at all — it lands on a ghost candidate and toggles it —
 * so that case is left alone.
 */
export async function selectCell(page: Page, index: number): Promise<void> {
  const target = cell(page, index);
  if ((await target.getAttribute('aria-selected')) !== 'true') await target.click();
  await expect(target).toHaveAttribute('aria-selected', 'true');
}

/** Make sure digits go in as values, not candidates. */
export async function ensureNormalMode(page: Page): Promise<void> {
  const normal = modeButton(page, 'Normal');
  if ((await normal.getAttribute('aria-pressed')) !== 'true') await normal.click();
  await expect(normal).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Type digits into cells from the keyboard: select the first by clicking it,
 * then arrow from cell to cell and press each digit.
 */
export async function typeDigits(
  page: Page,
  entries: readonly { index: number; digit: number }[],
): Promise<void> {
  if (entries.length === 0) return;
  await selectCell(page, entries[0].index);
  let at = entries[0].index;
  for (const { index, digit } of entries) {
    await arrowTo(page, at, index);
    at = index;
    await page.keyboard.press(`Digit${digit}`);
  }
}

/**
 * Fill in the solution from the keyboard, leaving the last `leave` cells
 * that still need it empty. Cells already holding the right digit are
 * skipped; wrong ones are overwritten.
 */
export async function solveFromKeyboard(
  page: Page,
  puzzle: Puzzle,
  options: { leave?: number } = {},
): Promise<void> {
  await ensureNormalMode(page);
  const board = await readBoard(page);
  const needed = [...board].flatMap((ch, index) =>
    ch === puzzle.solution[index] ? [] : [{ index, digit: Number(puzzle.solution[index]) }],
  );
  await typeDigits(page, needed.slice(0, Math.max(0, needed.length - (options.leave ?? 0))));
}

/**
 * Pretend the tab was hidden (or shown again). Headless pages are always
 * "visible", so the property is overridden and the event fired by hand, which
 * is all the app listens to.
 */
export async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => next === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/**
 * Stand in for the clipboard and the share sheet. The real clipboard is
 * shared between test workers (and with the developer), and a real share
 * sheet would wait for a person. Whatever is written is kept on
 * `window.copied`, for `copiedText` to read back.
 */
export async function stubClipboard(
  page: Page,
  options: { clipboard?: 'works' | 'fails'; share?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ clipboard, share }) => {
      const w = window as unknown as { copied: string[]; shared: unknown[] };
      w.copied = [];
      w.shared = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            if (clipboard === 'fails') throw new DOMException('Denied', 'NotAllowedError');
            w.copied.push(text);
          },
        },
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: share ? async (data: unknown) => void w.shared.push(data) : undefined,
      });
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: share ? () => true : undefined,
      });
    },
    { clipboard: options.clipboard ?? 'works', share: options.share ?? false },
  );
}

/** Everything written to the stubbed clipboard so far. */
export async function copiedText(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { copied: string[] }).copied);
}

/** Open the "…" menu and choose an item. */
export async function chooseMore(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: item }).click();
}

/** Start a new game of a tier from the header's New game menu. */
export async function newGame(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .getByRole('menu', { name: 'New game' })
    .getByRole('menuitem', { name: new RegExp(`^${label}( \\(current\\))?$`) })
    .click();
}

/**
 * Open one of the header's dialogs. On a desktop each has its own button; on
 * a phone they fold into the "Menu" overflow.
 */
export async function openHeaderDialog(
  page: Page,
  label: 'History' | 'Share' | 'Settings' | 'Help',
): Promise<void> {
  const direct = page.getByRole('banner').getByRole('button', { name: label, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menu', { name: 'Menu' }).getByRole('menuitem', { name: label }).click();
}
