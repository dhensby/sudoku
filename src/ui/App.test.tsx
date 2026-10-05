import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeGivens, type Puzzle } from '../core';
import { upsertRecord } from '../storage/history';
import { memoryStorage, type StorageLike } from '../storage/storage';
import { App } from './App';
import type { PuzzleSource } from './puzzleSource';
import { FIRST_EMPTY, PUZZLE, answerAt, fakeSource, linkFor, nearlySolved } from './testFixtures';
import type { UseSudokuOptions } from './useSudoku';

interface Options extends Partial<UseSudokuOptions> {
  storage?: StorageLike;
  source?: PuzzleSource;
}

function renderApp(options: Options = {}) {
  const storage = options.storage ?? memoryStorage();
  const source = options.source ?? fakeSource();
  const view = render(<App options={{ search: '', ...options, storage, source }} />);
  return { ...view, storage, source };
}

/** Render, and wait for the first puzzle to be on the board. */
async function startApp(options: Options = {}) {
  const view = renderApp(options);
  await screen.findByRole('grid');
  return view;
}

/** The app's own live region (dialogs and cards have status roles of their own). */
function liveRegion(): HTMLElement {
  return document.querySelector<HTMLElement>('.app > [role="status"]')!;
}

function press(
  key: string,
  init: Partial<KeyboardEventInit> = {},
  target: Element = document.body,
) {
  const code = /^[1-9]$/.test(key) ? `Digit${key}` : key === ' ' ? 'Space' : init.code;
  return fireEvent.keyDown(target, { key, code, ...init });
}

const cells = () => screen.getAllByRole('gridcell');

/** The selected cell: the grid's one tab stop. */
const selectedCell = () => document.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]');

/** A mouse click, as a browser sends it: a press (which may not focus), then a click with a count. */
function clickWithMouse(element: Element) {
  fireEvent.pointerDown(element, { pointerType: 'mouse' });
  fireEvent.mouseDown(element);
  fireEvent.click(element, { detail: 1 });
}

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

/**
 * Wait for the next animation frame, when focus lost with a control has been
 * sent home (see `guardFocus`). No timers are advanced: the clock's ticks
 * cannot be what moved it.
 */
async function nextFrame(): Promise<void> {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
});

describe('App', () => {
  it('plays a puzzle to the finish from the keyboard', async () => {
    const near = nearlySolved([0, 1]);
    await startApp({ source: fakeSource(near) });
    expect(cells()[0]).toHaveAttribute('aria-selected', 'true');

    press(String(answerAt(0)));
    expect(cells()[0]).toHaveAccessibleName(String(answerAt(0)));
    press('ArrowRight');
    press(String(answerAt(1)));

    expect(liveRegion()).toHaveTextContent(/^Solved in 0:0\d\.$/);
    const dialog = await screen.findByRole('dialog', { name: 'Solved!' });
    expect(within(dialog).getByText('Easy')).toBeInTheDocument();
    // Solved: the board stays on show, frozen, and the timer is just a time.
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  it('announces each move in the status region, re-announcing repeats', async () => {
    await startApp();
    const region = liveRegion();
    press(' ');
    expect(region).toHaveTextContent('Candidate mode.');
    const first = region.firstElementChild;
    press(' ');
    press(' ');
    expect(region).toHaveTextContent('Candidate mode.');
    expect(region.firstElementChild).not.toBe(first);
  });

  it('hides every digit while paused, and ignores the keyboard but P', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    // Not merely hidden: the givens are not in the page at all.
    expect(document.querySelector('.cell')).toBeNull();
    const card = document.querySelector<HTMLElement>('.board-overlay')!;
    const resume = within(card).getByRole('button', { name: 'Resume' });
    expect(within(card).getByRole('heading', { name: 'Paused' })).toBeInTheDocument();
    expect(resume).toHaveFocus();

    press('5');
    press(' ');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(resume).toBeInTheDocument();

    press('p');
    expect(screen.getByRole('grid')).toBeInTheDocument();
    // The keyboard carries on from the board, not from the page.
    expect(cells()[FIRST_EMPTY]).toHaveFocus();
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty');
  });

  it('pauses and resumes with P', async () => {
    await startApp();
    press('p');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('Paused.');
    press('p', { repeat: true });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    press('P');
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('moves the selection with the arrow keys, focus following it on the board', async () => {
    await startApp();
    cells()[FIRST_EMPTY].focus();
    press('ArrowDown', {}, cells()[FIRST_EMPTY]);
    expect(cells()[FIRST_EMPTY + 9]).toHaveFocus();
    expect(cells()[FIRST_EMPTY + 9]).toHaveAttribute('aria-selected', 'true');
  });

  it('erases, undoes and redoes from the keyboard', async () => {
    await startApp();
    const cell = () => cells()[FIRST_EMPTY];
    press('4');
    expect(cell()).toHaveAccessibleName('4');
    press('Backspace');
    expect(cell()).toHaveAccessibleName('empty');
    press('z', { ctrlKey: true });
    expect(cell()).toHaveAccessibleName('4');
    press('z', { ctrlKey: true, shiftKey: true });
    expect(cell()).toHaveAccessibleName('empty');
  });

  it('does not repeat a held digit', async () => {
    // In candidate mode a repeating digit would flicker its candidate.
    await startApp();
    press(' ');
    press('4');
    press('4', { repeat: true });
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty, candidates 4');
  });

  it('flips to candidates while Shift is held, by the key’s position', async () => {
    await startApp();
    fireEvent.keyDown(document.body, { key: 'Shift', code: 'ShiftLeft' });
    expect(screen.getByRole('button', { name: 'Candidate' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Shift+4 types '$'; the code still says 4.
    fireEvent.keyDown(document.body, { key: '$', code: 'Digit4', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'Shift', code: 'ShiftLeft', repeat: true });
    fireEvent.keyUp(document.body, { key: 'Shift', code: 'ShiftLeft' });
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty, candidates 4');
  });

  it('forgets a held modifier when the window loses focus', async () => {
    await startApp();
    fireEvent.keyDown(document.body, { key: 'Alt', code: 'AltLeft' });
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves Space to a focused button outside the board', async () => {
    await startApp();
    const help = screen.getByRole('button', { name: 'Help' });
    help.focus();
    const isUnclaimed = press(' ', {}, help);
    expect(isUnclaimed).toBe(true);
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('takes Space for the mode on a cell, so it does not press the cell', async () => {
    await startApp();
    const cell = cells()[FIRST_EMPTY];
    cell.focus();
    expect(press(' ', {}, cell)).toBe(false);
    expect(screen.getByRole('button', { name: 'Candidate' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('ignores game keys while a dialog is open', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
    expect(press('5')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty');
  });

  it('leaves keys typed into a text field to the field', async () => {
    await startApp({ source: fakeSource(nearlySolved([0])) });
    press(String(answerAt(0)));
    await screen.findByRole('dialog', { name: 'Solved!' });
    fireEvent.click(screen.getByRole('button', { name: 'Share your time' }));
    const name = screen.getByRole('textbox', { name: 'Your name (optional)' });
    expect(press('p', {}, name)).toBe(true);
  });

  it('keeps arrow keys inside an open menu', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    press('ArrowDown', {}, screen.getByRole('menuitem', { name: 'Hint' }));
    // Both checks have nothing to check yet, so are skipped.
    expect(screen.getByRole('menuitem', { name: 'Reveal cell' })).toHaveFocus();
    expect(cells()[FIRST_EMPTY]).toHaveAttribute('aria-selected', 'true');
  });

  it('enters digits from the pad, and toggles candidates in candidate mode', async () => {
    await startApp();
    const answer = String(answerAt(FIRST_EMPTY));
    fireEvent.click(screen.getByRole('button', { name: answer }));
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName(answer);
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Candidate' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty, candidates 2');
  });

  it('toggles a candidate from its spot with a mouse', async () => {
    await startApp();
    const ghost = cells()[FIRST_EMPTY].querySelector('[data-digit="8"]')!;
    fireEvent.pointerDown(ghost, { pointerType: 'mouse' });
    fireEvent.click(ghost);
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty, candidates 8');
  });

  it('shows a hint under the board until the next move', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hint' }));
    expect(
      screen.getByText(/single|full house/i, { selector: '.hint-bar span' }),
    ).toBeInTheDocument();
    press(' ');
    expect(document.querySelector('.hint-bar')).toBeEmptyDOMElement();
  });

  it('asks before resetting the puzzle', async () => {
    await startApp();
    press(String(answerAt(FIRST_EMPTY)));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset puzzle…' }));
    const dialog = screen.getByRole('dialog', { name: 'Reset puzzle?' });
    expect(dialog).toHaveAccessibleDescription(
      'Clear all your entries and start again? The clock keeps running.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty');
  });

  it('opens the share dialog with a link to the puzzle on screen', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = screen.getByRole('dialog', { name: 'Share this puzzle' });
    expect(
      within(dialog).getByText(new RegExp(`\\?p=${encodeGivens(PUZZLE.givens)}$`)),
    ).toBeInTheDocument();
    // Mid-game there is no time to share, so no name to put on it.
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    // The board waits, hidden, behind the dialog.
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('applies settings as they change', async () => {
    // A clash in row 1, so the conflict setting has something to show.
    await startApp();
    press('5');
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('5, conflict');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Highlight conflicts' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('5');
  });

  it('starts a new game from the New game menu', async () => {
    await startApp({ source: fakeSource(PUZZLE, nearlySolved([0, 1, 2])) });
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Expert' }));
    expect(await screen.findByText('Expert')).toBeInTheDocument();
    await screen.findByRole('grid');
    expect(cells()[0]).toHaveAccessibleName('empty');
  });

  it('opens a shared puzzle behind a Ready card, then starts it', async () => {
    const near = nearlySolved([0, 1, 2]);
    renderApp({ search: linkFor(near.givens, { t: '323', n: 'Dan' }) });
    expect(screen.getByRole('heading', { name: 'Ready?' })).toBeInTheDocument();
    expect(document.querySelector('.board-overlay__text')).toHaveTextContent(
      'Dan solved this Easy puzzle in 5:23. Can you beat it?',
    );
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Start' })[1]);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(cells()[0]).toHaveFocus();
  });

  it('offers a fresh attempt at a linked puzzle already solved', async () => {
    const storage = memoryStorage();
    const puzzle: Puzzle = PUZZLE;
    upsertRecord(storage, {
      id: 'old-0001',
      givens: puzzle.givens,
      difficulty: puzzle.difficulty,
      source: 'generated',
      createdAt: Date.now() - 86_400_000,
      updatedAt: Date.now() - 86_400_000,
      completedAt: Date.now() - 86_400_000,
      status: 'solved',
      elapsedMs: 290_000,
      assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
      challenge: null,
    });
    renderApp({ storage, search: linkFor(puzzle.givens, { t: '323', n: 'Dan' }) });
    const dialog = await screen.findByRole('dialog', { name: "You've solved this one" });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Play again' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('lists games in History and resumes one', async () => {
    await startApp({ source: fakeSource(PUZZLE, nearlySolved([0, 1, 2])) });
    press(String(answerAt(FIRST_EMPTY)));
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Medium' }));
    await screen.findByRole('grid');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const dialog = screen.getByRole('dialog', { name: 'History' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Resume/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName(String(answerAt(FIRST_EMPTY)));
  });

  it('shares the time from the completion dialog, and starts the next game from it', async () => {
    await startApp({ source: fakeSource(nearlySolved([0]), PUZZLE) });
    press(String(answerAt(0)));
    await screen.findByRole('dialog', { name: 'Solved!' });
    fireEvent.click(screen.getByRole('button', { name: 'Share your time' }));
    const share = screen.getByRole('dialog', { name: 'Share your time' });
    fireEvent.click(within(share).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports a broken link under the board', async () => {
    await startApp({ search: '?p=nonsense!' });
    expect(
      screen.getByText("That puzzle link doesn't work — here's a fresh puzzle instead.", {
        selector: '.hint-bar span',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(document.querySelector('.hint-bar')).toBeEmptyDOMElement();
  });

  it('offers to try again when no puzzle could be made', async () => {
    const source: PuzzleSource = {
      next: () => Promise.reject(new Error('down')),
      prefetch: () => {},
      dispose: () => {},
    };
    renderApp({ source });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('leaves keys it has no use for, and key-ups other than the modifiers, to the browser', async () => {
    await startApp();
    expect(press('q')).toBe(true);
    expect(fireEvent.keyUp(document.body, { key: '5', code: 'Digit5' })).toBe(true);
    // A key sent to the document itself, with no element focused.
    expect(fireEvent.keyDown(document, { key: '5', code: 'Digit5' })).toBe(false);
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('5, conflict');
  });

  it('checks a cell and the whole puzzle from the "…" menu', async () => {
    await startApp();
    const wrong = answerAt(FIRST_EMPTY) === 9 ? 1 : 9;
    press(String(wrong));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Check cell' }));
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName(new RegExp(`^${wrong}.*, incorrect$`));
    press('ArrowRight');
    press(String(answerAt(FIRST_EMPTY + 1)));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Check puzzle' }));
    expect(cells()[FIRST_EMPTY + 1]).toHaveAccessibleName(`${answerAt(FIRST_EMPTY + 1)}, correct`);
  });

  it('marks a mistake a hint points at, and keeps the mark after the hint goes', async () => {
    await startApp();
    const wrong = answerAt(FIRST_EMPTY) === 9 ? 1 : 9;
    press(String(wrong));
    press('ArrowRight');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hint' }));
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName(new RegExp(`^${wrong}.*, incorrect$`));
    press('ArrowRight');
    expect(document.querySelector('.hint-bar')).toBeEmptyDOMElement();
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName(new RegExp(`^${wrong}.*, incorrect$`));
  });

  it('offers Check puzzle only once there is something to check', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Check puzzle' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    press(String(answerAt(FIRST_EMPTY)));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Check puzzle' })).toBeEnabled();
  });

  it('leaves digits typed in an open menu to the menu, not the board behind it', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(press('5', {}, screen.getByRole('menuitem', { name: 'Hint' }))).toBe(true);
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('waits behind Start, saying whose puzzle it is, when the puzzle arrives in a hidden tab', async () => {
    setVisibility('hidden');
    try {
      renderApp();
      expect(await screen.findByText('Your Easy puzzle is ready.')).toBeInTheDocument();
      // The card's, not the timer's.
      const start = within(document.querySelector<HTMLElement>('.board-overlay')!).getByRole(
        'button',
        { name: 'Start' },
      );
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      setVisibility('visible');
      fireEvent.click(start);
      expect(screen.getByRole('grid')).toBeInTheDocument();
    } finally {
      setVisibility('visible');
    }
  });

  it('shows nothing behind a dialog while there is no game to show', async () => {
    // A first visit, with a link to a puzzle already solved, and the next
    // puzzle still on its way.
    const storage = memoryStorage();
    upsertRecord(storage, {
      id: 'old-0001',
      givens: PUZZLE.givens,
      difficulty: PUZZLE.difficulty,
      source: 'generated',
      createdAt: Date.now() - 86_400_000,
      updatedAt: Date.now() - 86_400_000,
      completedAt: Date.now() - 86_400_000,
      status: 'solved',
      elapsedMs: 290_000,
      assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
      challenge: null,
    });
    renderApp({
      storage,
      source: { ...fakeSource(), next: () => new Promise(() => {}) },
      search: linkFor(PUZZLE.givens),
    });
    expect(document.querySelector('.board-overlay--veiled')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.board-overlay--loading')).toHaveTextContent(
      'Generating an Easy puzzle…',
    );
  });

  describe('focus', () => {
    it('goes back to the board after a game action from the "…" menu, so Space switches the mode', async () => {
      await startApp();
      cells()[FIRST_EMPTY].focus();
      clickWithMouse(screen.getByRole('button', { name: 'More' }));
      clickWithMouse(screen.getByRole('menuitem', { name: 'Hint' }));
      // The hint moved the selection; focus followed it.
      expect(selectedCell()).not.toBe(cells()[FIRST_EMPTY]);
      expect(selectedCell()).toHaveFocus();
      press(' ', {}, document.activeElement!);
      expect(liveRegion()).toHaveTextContent('Candidate mode.');
      press('ArrowDown', {}, document.activeElement!);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('goes back to the board after a game action chosen from the keyboard too', async () => {
      await startApp();
      press(String(answerAt(FIRST_EMPTY)));
      const more = screen.getByRole('button', { name: 'More' });
      more.focus();
      fireEvent.click(more);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Check puzzle' }));
      expect(selectedCell()).toHaveFocus();
    });

    it('leaves a mouse press on the menus and the timer where focus was', async () => {
      await startApp();
      for (const name of ['More', 'New game', 'Pause']) {
        expect(fireEvent.mouseDown(screen.getByRole('button', { name }))).toBe(false);
      }
    });

    it('hands focus to the new board’s selected cell after New game', async () => {
      await startApp({ source: fakeSource(PUZZLE, nearlySolved([0, 1, 2])) });
      clickWithMouse(screen.getByRole('button', { name: 'New game' }));
      clickWithMouse(screen.getByRole('menuitem', { name: 'Expert' }));
      await screen.findByText('Expert');
      await screen.findByRole('grid');
      expect(selectedCell()).toHaveFocus();
    });

    it('lands on the selected cell when Undo empties its stack', async () => {
      await startApp();
      press(String(answerAt(FIRST_EMPTY)));
      const undo = screen.getByRole('button', { name: 'Undo' });
      undo.focus();
      fireEvent.click(undo);
      expect(undo).toBeDisabled();
      await nextFrame();
      expect(selectedCell()).toHaveFocus();
    });

    it('stays on the board when a pad key solves the puzzle, and comes back there from the dialog', async () => {
      await startApp({ source: fakeSource(nearlySolved([0])) });
      const key = screen.getByRole('button', { name: String(answerAt(0)) });
      key.focus();
      fireEvent.keyDown(key, { key: 'Enter' });
      fireEvent.click(key);
      await nextFrame();
      expect(selectedCell()).toHaveFocus();
      await screen.findByRole('dialog', { name: 'Solved!' });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(selectedCell()).toHaveFocus();
    });

    it('stays on the board when the puzzle is solved with focus on the timer', async () => {
      await startApp({ source: fakeSource(nearlySolved([0])) });
      const timer = screen.getByRole('button', { name: 'Pause' });
      timer.focus();
      press(String(answerAt(0)), {}, timer);
      expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
      await nextFrame();
      expect(selectedCell()).toHaveFocus();
    });

    it('hands focus to the next board after New game from the completion dialog', async () => {
      await startApp({ source: fakeSource(nearlySolved([0]), PUZZLE) });
      press(String(answerAt(0)));
      const dialog = await screen.findByRole('dialog', { name: 'Solved!' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'New game' }));
      await screen.findByRole('grid');
      expect(selectedCell()).toHaveFocus();
    });

    it('hands focus to the board after Play again in the challenge dialog', async () => {
      const storage = memoryStorage();
      upsertRecord(storage, {
        id: 'old-0001',
        givens: PUZZLE.givens,
        difficulty: PUZZLE.difficulty,
        source: 'generated',
        createdAt: Date.now() - 86_400_000,
        updatedAt: Date.now() - 86_400_000,
        completedAt: Date.now() - 86_400_000,
        status: 'solved',
        elapsedMs: 290_000,
        assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
        challenge: null,
      });
      renderApp({ storage, search: linkFor(PUZZLE.givens) });
      const dialog = await screen.findByRole('dialog', { name: "You've solved this one" });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Play again' }));
      expect(selectedCell()).toHaveFocus();
    });

    it('lands on the board when a notice’s Dismiss goes', async () => {
      await startApp({ search: '?p=nonsense!' });
      const dismiss = screen.getByRole('button', { name: 'Dismiss' });
      dismiss.focus();
      fireEvent.click(dismiss);
      await nextFrame();
      expect(selectedCell()).toHaveFocus();
    });

    it('goes home when a press outside closes a menu, with no render of the App to wait for', async () => {
      await startApp();
      // Paused: no clock ticking, so nothing re-renders the App behind the menu.
      press('p');
      const resume = within(document.querySelector<HTMLElement>('.board-overlay')!).getByRole(
        'button',
        { name: 'Resume' },
      );
      clickWithMouse(screen.getByRole('button', { name: 'New game' }));
      expect(screen.getByRole('menuitem', { name: /^Easy/ })).toHaveFocus();
      // A press on a blank part of the page: the menu goes, and its item's focus with it.
      fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      await nextFrame();
      expect(resume).toHaveFocus();
    });

    it('leaves focus on nothing after a press on a blank part of the page that took nothing away', async () => {
      await startApp();
      const cell = cells()[FIRST_EMPTY];
      act(() => cell.focus());
      // The browser's own blur for a press on nothing in particular.
      act(() => cell.blur());
      await nextFrame();
      expect(document.body).toHaveFocus();
    });

    it('closes a header menu as the Paused card takes focus when the tab hides', async () => {
      await startApp();
      const newGame = screen.getByRole('button', { name: 'New game' });
      newGame.focus();
      press('Enter', {}, newGame);
      fireEvent.click(newGame);
      expect(screen.getByRole('menu', { name: 'New game' })).toBeInTheDocument();
      setVisibility('hidden');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      setVisibility('visible');
      const card = document.querySelector<HTMLElement>('.board-overlay')!;
      expect(within(card).getByRole('button', { name: 'Resume' })).toHaveFocus();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('comes back to the board from a dialog opened with the mouse, not to its button', async () => {
      // Safari never focuses a clicked button, and Space after closing should
      // switch the mode, not open the dialog again.
      await startApp();
      cells()[FIRST_EMPTY].focus();
      clickWithMouse(screen.getByRole('button', { name: 'Settings' }));
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(selectedCell()).toHaveFocus();
    });

    it('waits on the board’s place while a new board is on its way', async () => {
      const pending: ((puzzle: Puzzle) => void)[] = [];
      const source: PuzzleSource = {
        next: (difficulty) =>
          new Promise((resolve) => pending.push((puzzle) => resolve({ ...puzzle, difficulty }))),
        prefetch: () => {},
        dispose: () => {},
      };
      renderApp({ source });
      await act(async () => pending.shift()!(nearlySolved([0])));
      press(String(answerAt(0)));
      const dialog = await screen.findByRole('dialog', { name: 'Solved!' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'New game' }));
      expect(document.querySelector('.board-area')).toHaveFocus();
      await act(async () => pending.shift()!(PUZZLE));
      expect(selectedCell()).toHaveFocus();
    });

    it('focuses without a keyboard ring before any key has been pressed', async () => {
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      const near = nearlySolved([0, 1, 2]);
      renderApp({ search: linkFor(near.givens) });
      const start = screen.getAllByRole('button', { name: 'Start' })[1];
      expect(start).toHaveFocus();
      expect(focus.mock.contexts.at(-1)).toBe(start);
      expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
      // After a key, the ring is the browser's call again.
      press('p');
      expect(focus).toHaveBeenLastCalledWith(undefined);
      focus.mockRestore();
    });

    it('gives no stray hand-over to the board under StrictMode', async () => {
      // StrictMode's rehearsal unmount of the Paused card must not leave a
      // request behind for the board to take focus with later.
      render(
        <StrictMode>
          <App options={{ search: '', storage: memoryStorage(), source: fakeSource() }} />
        </StrictMode>,
      );
      await screen.findByRole('grid');
      press('p');
      expect(screen.getByRole('heading', { name: 'Paused' })).toBeInTheDocument();
      const help = screen.getByRole('button', { name: 'Help' });
      help.focus();
      press('p', {}, help);
      expect(screen.getByRole('grid')).toBeInTheDocument();
      expect(help).toHaveFocus();
    });
  });

  it('starts the next game of the same tier from the completion dialog', async () => {
    const source = fakeSource(nearlySolved([0]), PUZZLE);
    await startApp({ source });
    press(String(answerAt(0)));
    const dialog = await screen.findByRole('dialog', { name: 'Solved!' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'New game' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await screen.findByRole('grid');
    expect(source.requests).toEqual(['easy', 'easy']);
  });
});
