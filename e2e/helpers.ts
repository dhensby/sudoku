import { expect, type Locator, type Page } from '@playwright/test';
import {
  appendMove,
  createGame,
  createMoveLog,
  encodeGivens,
  encodeMoveLog,
  generatePuzzle,
  gridValues,
  moveFor,
  mulberry32,
  rate,
  reduce,
  solve,
  type Difficulty,
  type Digit,
  type GridString,
  type Puzzle,
} from '../src/core';
import { STUCK_ON_AN_XY_CHAIN, STUCK_ON_A_HIDDEN_PAIR } from '../src/test/logic-fixtures';

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

/**
 * Open one of today's daily puzzles from the header's New game menu, as
 * "Easy", "Hard" and so on, and wait for it to be on screen, clock running
 * (it may have to be dealt first, in the worker).
 */
export async function openTodaysDaily(page: Page, tier: string): Promise<void> {
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .getByRole('menu', { name: 'New game' })
    .getByRole('menuitem', { name: new RegExp(`^Today's ${tier} puzzle`) })
    .click();
  await expect(grid(page)).toBeVisible({ timeout: 30_000 });
  await expect(timer(page)).toHaveAccessibleName('Pause');
}

/**
 * Put records in the history before the page loads, as a returning player's
 * browser holds them — once, so a reload does not put them back.
 */
export async function seedHistory(page: Page, records: readonly unknown[]): Promise<void> {
  await page.addInitScript((seeded) => {
    if (localStorage.getItem('e2e.seeded') !== null) return;
    localStorage.setItem('sudoku.history', JSON.stringify(seeded));
    localStorage.setItem('e2e.seeded', '1');
  }, records);
}

/** A solved or unfinished daily attempt, as the history stores one, begun at `createdAt`. */
export function dailyRecord(
  id: string,
  puzzle: Puzzle,
  daily: string,
  createdAt: number,
  status: 'solved' | 'playing' = 'solved',
) {
  const elapsedMs = 200_000 + id.length * 7000;
  return {
    id,
    givens: puzzle.givens,
    difficulty: puzzle.difficulty,
    source: 'daily',
    createdAt,
    updatedAt: createdAt + elapsedMs,
    completedAt: status === 'solved' ? createdAt + elapsedMs : null,
    status,
    elapsedMs,
    assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
    challenge: null,
    daily,
  };
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
  label: 'Daily puzzles' | 'History' | 'Share' | 'Settings' | 'Solving techniques' | 'Help',
): Promise<void> {
  const direct = page.getByRole('banner').getByRole('button', { name: label, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menu', { name: 'Menu' }).getByRole('menuitem', { name: label }).click();
}

/**
 * The board behind "Show me": a player sixteen right entries into the
 * puzzle of share code `O3NLgKqUTeam9ygZMBQVALBbgSY`, opened from its link
 * and started. Their hint points at row 5, column 2 and names a hidden pair
 * half a board away, which its walkthrough takes three steps to reach.
 */
export async function getStuck(page: Page): Promise<void> {
  const { code, entries } = STUCK_ON_A_HIDDEN_PAIR;
  await page.goto(`/?p=${code}`);
  await startButton(page).click();
  await waitForPlaying(page);
  await typeDigits(
    page,
    entries.map(([row, col, digit]) => ({ index: (row - 1) * 9 + col - 1, digit })),
  );
}

/**
 * Whether the header's wordmark and tier are whole: each either out of view
 * (the stylesheet hides it to a 1px box when there is no room for it) or with
 * every word of it inside its own box. Measured with a Range, to the
 * sub-pixel: an over-full row can shrink the tier a fraction of a pixel short
 * of its words, drawing an ellipsis that `scrollWidth`, a whole number, does
 * not show.
 */
export async function expectHeaderWhole(page: Page): Promise<void> {
  const cut = await page.getByRole('banner').evaluate((header) => {
    /** How far `parts`' words reach past `right`, those on show only. */
    const past = (parts: Element[], right: number) =>
      Math.max(
        0,
        ...parts
          .filter((part) => {
            const box = part.getBoundingClientRect();
            return part.getClientRects().length > 0 && box.width > 1 && box.height > 1;
          })
          .map((part) => {
            const range = document.createRange();
            range.selectNodeContents(part);
            return range.getBoundingClientRect().right - right;
          }),
      );
    const title = header.querySelector('.header__title')!;
    const tier = header.querySelector('.header__difficulty')!;
    const style = getComputedStyle(tier);
    const box = tier.getBoundingClientRect();
    const inside = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    return {
      title: past([title], title.getBoundingClientRect().right),
      tier: past(
        [...tier.querySelectorAll('.header__daily, .header__tier, .header__tier-short')],
        inside,
      ),
    };
  });
  expect(cut.title, 'the wordmark cut short').toBeLessThanOrEqual(0.01);
  expect(cut.tier, 'the tier cut short').toBeLessThanOrEqual(0.01);
}

/**
 * Stuck as `getStuck` leaves the player, then a note of 1 alone pencilled
 * into the cell their hint points at — row 5, column 2, whose answer is 8 —
 * so that Hint points out the candidate it is missing. Back in Normal mode.
 */
export async function leaveOutAnAnswer(page: Page): Promise<void> {
  await getStuck(page);
  await modeButton(page, 'Candidate').click();
  await typeDigits(page, [{ index: STUCK_ON_A_HIDDEN_PAIR.target, digit: 1 }]);
  await ensureNormalMode(page);
}

/**
 * The report that made hints read the player's own candidates: the Expert
 * daily of 10 October 2026, opened from its link in Auto Candidate Mode,
 * with the six cells its first hints point at filled. The next hint points
 * at row 2, column 1 and names an XY-Chain, and its Show me starts with a
 * box/line reduction that removes 2 from row 8, column 9 and row 9, column 9.
 */
export async function getStuckOnAnXyChain(page: Page): Promise<void> {
  const { code, entries } = STUCK_ON_AN_XY_CHAIN;
  await page.goto(`/?p=${code}`);
  await startButton(page).click();
  await waitForPlaying(page);
  await page.getByRole('switch', { name: 'Auto Candidate Mode' }).click();
  await typeDigits(
    page,
    entries.map(([row, col, digit]) => ({ index: (row - 1) * 9 + col - 1, digit })),
  );
}

/**
 * Solve `puzzle` (by default `NEARLY_DONE`, every blank a full house) on
 * Playwright's clock, with one mistake that counts: a wrong number in its
 * first blank, left 4 s of play before it is put right — past the 3 s a slip
 * has. Installs the clock itself, so call it before the page is opened. The
 * Solved dialog is up when it returns. Returns the cell and the wrong digit.
 */
export async function solveWithAMistake(
  page: Page,
  puzzle: Puzzle = NEARLY_DONE,
): Promise<{ index: number; wrong: number }> {
  await page.clock.install();
  await startPuzzle(page, puzzle);
  await ensureNormalMode(page);
  const [index] = emptyCells(puzzle.givens);
  const wrong = (Number(puzzle.solution[index]) % 9) + 1;
  await page.clock.fastForward('00:02');
  await typeDigits(page, [{ index, digit: wrong }]);
  await page.clock.fastForward('00:04');
  await solveFromKeyboard(page, puzzle);
  await expect(
    page.getByRole('dialog', { name: 'Solved!' }).locator('.result__mistakes'),
  ).toHaveText('1 mistake');
  return { index, wrong };
}

/**
 * Let entrance animations finish — a phone's dialog slides up from below the
 * screen as a sheet — so boxes are measured where they come to rest. One
 * cancelled on the way has come to rest too: help taken's tick is cut short
 * as its mark is taken off, or as a new tick plays afresh, and its
 * `finished` then rejects rather than resolving.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/**
 * A solve of `puzzle` as a friend's link would carry it: every blank placed
 * in reading order, `gapMs` of play apart, recorded by the real engine's move
 * log — and the whole seconds its link gives as the time it agrees with.
 */
export function placedSolve(puzzle: Puzzle, gapMs = 1000): { log: string; seconds: number } {
  let game = createGame(puzzle);
  let log = createMoveLog();
  let at = 0;
  for (const index of emptyCells(puzzle.givens)) {
    at += gapMs;
    const action = {
      type: 'enter',
      digit: Number(puzzle.solution[index]) as Digit,
      index,
      mode: 'normal',
    } as const;
    const next = reduce(game, action);
    log = appendMove(log, moveFor(game, action, next)!, at);
    game = next;
  }
  return { log: encodeMoveLog(log), seconds: Math.floor(at / 1000) };
}
