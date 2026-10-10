import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeGivens, type Puzzle } from '../core';
import { upsertRecord } from '../storage/history';
import { memoryStorage, type StorageLike } from '../storage/storage';
import { App } from './App';
import type { PuzzleSource } from './puzzleSource';
import { STUCK_ON_A_HIDDEN_PAIR } from '../test/logic-fixtures';
import {
  FIRST_EMPTY,
  PUZZLE,
  answerAt,
  fakeDailies,
  fakeSource,
  linkFor,
  nearlySolved,
} from './testFixtures';
import type { UseSudokuOptions } from './useSudoku';

interface Options extends Partial<UseSudokuOptions> {
  storage?: StorageLike;
  source?: PuzzleSource;
}

function renderApp(options: Options = {}) {
  const storage = options.storage ?? memoryStorage();
  const source = options.source ?? fakeSource();
  // Never the app's own store, which would deal real dailies on the main thread.
  const dailies = options.dailies ?? fakeDailies();
  const view = render(<App options={{ search: '', ...options, storage, source, dailies }} />);
  return { ...view, storage, source, dailies };
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

/**
 * Let a puzzle being dealt arrive — the fixtures deal it in a resolved
 * promise — with its board in place and the board's effects run, the focus
 * it takes as it mounts among them. A grid found on the page may not have
 * had them yet: a render React schedules itself runs its effects in a later
 * task. Call it straight after the action that starts the deal, with
 * nothing awaited between: work already handed to React's scheduler is not
 * act's to flush.
 */
async function settle(): Promise<void> {
  await act(async () => {});
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

  it('shows a hint under the board, and again whenever its cell is selected', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hint' }));
    const hinted = selectedCell()!;
    const words = screen.getByText(/^(hidden single|naked single|full house):/i, {
      selector: '.hint-bar__message span',
    });
    // Spoken as it is asked for, so the cell is not described by it as well.
    expect(liveRegion()).toHaveTextContent(words.textContent!);
    expect(hinted).not.toHaveAttribute('aria-describedby');

    // The next move retires the hint just asked for, but the cell remembers
    // it, and from now on describes itself by it.
    press(' ');
    expect(screen.getByText(words.textContent!)).toBeInTheDocument();
    expect(hinted).toHaveAccessibleDescription(words.textContent!);

    const index = Number(hinted.dataset.index);
    const [away, back] =
      index % 9 === 8 ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft'];
    press(away);
    expect(document.querySelector('.hint-bar')).toBeEmptyDOMElement();
    expect(selectedCell()).not.toHaveAttribute('aria-describedby');
    press(back);
    expect(selectedCell()).toBe(hinted);
    expect(screen.getByText(words.textContent!)).toBeInTheDocument();
    expect(hinted).toHaveAccessibleDescription(words.textContent!);
  });

  it('explains the technique a hint names, in the guide, with the board hidden meanwhile', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hint' }));
    const question = screen.getByRole('button', { name: /^What's a / });
    const technique = question.textContent!.replace(/^What's an? |\?$/g, '');
    fireEvent.click(question);

    const guide = screen.getByRole('dialog', { name: 'Solving techniques' });
    expect(within(guide).getByRole('heading', { level: 3 })).toHaveTextContent(
      new RegExp(`^${technique}$`, 'i'),
    );
    expect(within(guide).getAllByRole('img').length).toBeGreaterThan(0);
    // A dialog like any other: the board is hidden, and comes back as it closes.
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('grid')).toBeInTheDocument();
    // The hint is still there: nothing on the board changed.
    expect(screen.getByRole('button', { name: /^What's a / })).toBeInTheDocument();
  });

  it('keeps a hint behind the guide its question opened, and behind no other dialog', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hint' }));
    const hintBar = document.querySelector('.hint-bar')!;
    expect(hintBar).not.toBeEmptyDOMElement();

    // With the board hidden there is no cell for it to point at.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(hintBar).toBeEmptyDOMElement();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(hintBar).not.toBeEmptyDOMElement();

    // The guide is the exception: it gives focus back to the question.
    fireEvent.click(screen.getByRole('button', { name: /^What's a / }));
    expect(screen.getByRole('dialog', { name: 'Solving techniques' })).toBeInTheDocument();
    expect(hintBar).not.toBeEmptyDOMElement();
  });

  describe('Show me', () => {
    /** The board a player got stuck on: their puzzle, and their sixteen right entries. */
    async function startStuck() {
      const view = await startApp({
        source: fakeSource({
          givens: STUCK_ON_A_HIDDEN_PAIR.givens,
          solution: STUCK_ON_A_HIDDEN_PAIR.solution,
          difficulty: 'hard',
        }),
      });
      for (const [row, col, digit] of STUCK_ON_A_HIDDEN_PAIR.entries) {
        fireEvent.click(cells()[(row - 1) * 9 + col - 1]);
        press(String(digit));
      }
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Hint' }));
      return view;
    }

    const showMe = () =>
      screen.getByRole('button', { name: 'Show me how to solve row 5, column 2' });
    const walkthrough = () => screen.getByRole('dialog', { name: 'How to solve row 5, column 2' });
    const stepHeading = () => within(walkthrough()).getByRole('heading', { level: 3 });

    it('walks through the hinted cell step by step, with the board hidden meanwhile', async () => {
      await startStuck();
      expect(document.querySelector('.hint-bar')).toHaveTextContent(
        "Look here — a hidden pair will unlock this cell. What's a hidden pair? Show me",
      );
      clickWithMouse(showMe());
      expect(stepHeading()).toHaveAccessibleName('Step 1 of 3: Hidden pair');
      expect(stepHeading()).toHaveFocus();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      // Silently, as for any dialog.
      expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

      fireEvent.click(within(walkthrough()).getByRole('button', { name: /^Next:/ }));
      expect(stepHeading()).toHaveAccessibleName('Step 2 of 3: Pointing pair or triple');
      fireEvent.click(within(walkthrough()).getByRole('button', { name: /^Next:/ }));
      expect(stepHeading()).toHaveAccessibleName('Step 3 of 3: Naked single');
      expect(
        within(walkthrough()).getByText('Row 5, column 2 must be', { exact: false }),
      ).toHaveTextContent('Row 5, column 2 must be 8.');

      fireEvent.click(within(walkthrough()).getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // Opened with the mouse: back to the board, on the cell it solved.
      expect(selectedCell()).toHaveFocus();
      expect(selectedCell()).toHaveAttribute('aria-rowindex', '5');
      expect(selectedCell()).toHaveAttribute('aria-colindex', '2');
      // The hint, and Show me, are still there.
      expect(showMe()).toBeInTheDocument();
    });

    it('shows its charge in the walkthrough, and ticks it as the walkthrough closes', async () => {
      await startStuck();
      const face = () => document.querySelector('.help-taken--header .help-taken__face');
      const hinted = face();
      expect(hinted).toHaveTextContent('1 hint');
      clickWithMouse(showMe());
      expect(within(walkthrough()).getByText('2 hints used.')).toHaveClass('walkthrough__charge');
      // Behind the dialog's veil it waits, unticked.
      expect(face()).toBe(hinted);
      fireEvent.click(within(walkthrough()).getByRole('button', { name: 'Close' }));
      expect(face()).not.toBe(hinted);
      expect(face()).toHaveClass('help-taken__face--tick');
      expect(face()).toHaveTextContent('2 hints');

      // Opened again for the same cell, it is free: no cost shown, no tick.
      const charged = face();
      clickWithMouse(showMe());
      expect(walkthrough().querySelector('.walkthrough__charge')).toBeNull();
      fireEvent.click(within(walkthrough()).getByRole('button', { name: 'Close' }));
      expect(face()).toBe(charged);
    });

    it('gives focus back to Show me when the keyboard opened it', async () => {
      await startStuck();
      showMe().focus();
      press('Enter', {}, showMe());
      fireEvent.click(showMe());
      expect(stepHeading()).toHaveFocus();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(showMe()).toHaveFocus();
    });

    it('goes from a step to the guide, and back to that step', async () => {
      await startStuck();
      fireEvent.click(showMe());
      fireEvent.click(within(walkthrough()).getByRole('button', { name: /^Next:/ }));
      fireEvent.click(screen.getByRole('button', { name: "What's a pointing pair or triple?" }));
      const guide = screen.getByRole('dialog', { name: 'Solving techniques' });
      expect(within(guide).getByRole('heading', { level: 3 })).toHaveTextContent(
        'Pointing pair or triple',
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(stepHeading()).toHaveAccessibleName('Step 2 of 3: Pointing pair or triple');
      expect(stepHeading()).toHaveFocus();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('grid')).toBeInTheDocument();
    });

    it('comes back, Show me and all, as the hinted cell is selected again', async () => {
      await startStuck();
      press('ArrowUp');
      expect(document.querySelector('.hint-bar')).toBeEmptyDOMElement();
      press('ArrowDown');
      expect(showMe()).toBeInTheDocument();
      expect(selectedCell()).toHaveAccessibleDescription(
        'Look here — a hidden pair will unlock this cell.',
      );
    });
  });

  it('points at a candidate missing from a cell’s notes, names it on Show me, and pencils it in', async () => {
    await startApp();
    // A note of 2 alone in row 1, column 3: its answer, 4, left out.
    fireEvent.click(screen.getByRole('button', { name: 'Candidate' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty, candidates 2');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hint' }));
    expect(document.querySelector('.hint-bar')).toHaveTextContent(
      "This cell is missing a candidate that can't be ruled out yet. Show me",
    );
    expect(selectedCell()).toBe(cells()[FIRST_EMPTY]);

    clickWithMouse(
      screen.getByRole('button', { name: "Show me what's missing in row 1, column 3" }),
    );
    const page = screen.getByRole('dialog', { name: 'Why row 1, column 3 can still be 4' });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    // The hint stays behind it.
    expect(document.querySelector('.hint-bar')).not.toBeEmptyDOMElement();
    fireEvent.click(within(page).getByRole('button', { name: 'Pencil in the 4' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('empty, candidates 2 4');
    expect(screen.getByRole('status')).toHaveTextContent('Candidate 4 added.');
    // Its cell's candidates changed: the hint has gone with it.
    expect(document.querySelector('.hint-bar')).toBeEmptyDOMElement();
  });

  it('opens the guide from the header, and from Help in place of Help', async () => {
    await startApp();
    fireEvent.click(screen.getByRole('button', { name: 'Solving techniques' }));
    const guide = screen.getByRole('dialog', { name: 'Solving techniques' });
    expect(within(guide).getByRole('heading', { level: 3 })).toHaveTextContent('Full house');
    fireEvent.click(within(guide).getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse the solving techniques' }));
    expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Solving techniques' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('grid')).toBeInTheDocument();
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

  describe('the Mistakes settings', () => {
    const counters = () => [...document.querySelectorAll('.error-counter')];
    /** The live region the error counter speaks in, after the app's own. */
    const counterRegion = () => document.querySelectorAll<HTMLElement>('.app > [role="status"]')[1];

    function switchOn(name: string) {
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      fireEvent.click(screen.getByRole('checkbox', { name }));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    }

    it('has its counter’s live region ready before the first game arrives', async () => {
      const storage = memoryStorage();
      storage.setItem('sudoku.prefs', JSON.stringify({ settings: { showErrorCounter: true } }));
      renderApp({ storage });
      expect(document.querySelectorAll('.app > [role="status"]')).toHaveLength(2);
      for (const counter of counters()) expect(counter).toBeEmptyDOMElement();
      await screen.findByRole('grid');
      for (const counter of counters()) expect(counter).toHaveTextContent(/^Mistakes 0/);
    });

    it('shows no error counter until it is switched on', async () => {
      await startApp();
      expect(counters()).toEqual([]);
      expect(document.querySelector('.header')).not.toHaveClass('header--tally');
      expect(document.querySelectorAll('.app > [role="status"]')).toHaveLength(1);
    });

    it('shows the counter beside the timer and above the controls, for the stylesheet to pick', async () => {
      await startApp();
      switchOn('Show error counter');
      expect(document.querySelector('.app')).toHaveClass('app--tally');
      expect(document.querySelector('.header')).toHaveClass('header--tally');
      const [header, play] = counters();
      expect(header).toHaveClass('error-counter--header');
      expect(header.closest('.tally--header')?.nextElementSibling).toHaveClass('header__timer');
      expect(play).toHaveClass('error-counter--play');
      expect(play.closest('.tally--play')?.nextElementSibling).toHaveClass('controls');
      for (const counter of counters()) expect(counter).toHaveTextContent(/^Mistakes 0/);
    });

    it('hides the count with the board while paused', async () => {
      await startApp();
      switchOn('Show error counter');
      press('p');
      for (const counter of counters()) expect(counter).toBeEmptyDOMElement();
      press('p');
      for (const counter of counters()) expect(counter).toHaveTextContent(/^Mistakes 0/);
    });

    it('marks a wrong number the moment it goes in with Check guesses on, and counts it aloud', async () => {
      await startApp();
      switchOn('Show error counter');
      switchOn('Check guesses when entered');
      // Cell 2's answer is 4.
      press('1');
      expect(cells()[FIRST_EMPTY]).toHaveAccessibleName('1, incorrect');
      expect(liveRegion()).toHaveTextContent(/ Incorrect\.$/);
      for (const counter of counters()) expect(counter).toHaveTextContent(/^Mistakes 1/);
      expect(counterRegion()).toHaveTextContent('1 mistake counted.');
      press(String(answerAt(FIRST_EMPTY)));
      expect(cells()[FIRST_EMPTY]).toHaveAccessibleName(String(answerAt(FIRST_EMPTY)));
    });

    it('says nothing about mistakes while paused, nor says one again as play resumes', async () => {
      await startApp();
      switchOn('Show error counter');
      switchOn('Check guesses when entered');
      press('1');
      expect(counterRegion()).toHaveTextContent('1 mistake counted.');
      press('p');
      expect(counterRegion()).toBeEmptyDOMElement();
      press('p');
      expect(counterRegion()).toBeEmptyDOMElement();
      for (const counter of counters()) expect(counter).toHaveTextContent(/^Mistakes 1/);
    });
  });

  describe('help taken', () => {
    const helpTaken = () => [...document.querySelectorAll('.help-taken')];
    /** What each copy shows, the words not on show left out. */
    const shown = () =>
      helpTaken().map((chip) => chip.querySelector('.help-taken__full')!.textContent);

    function openMore() {
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      return screen.getByRole('menu', { name: 'More' });
    }

    function takeHint() {
      fireEvent.click(within(openMore()).getByRole('menuitem', { name: /^Hint/ }));
    }

    it('shows nothing until help is taken, and keeps no line for it on a phone till then', async () => {
      await startApp();
      expect(helpTaken()).toEqual([]);
      // On the page, to tick as it first appears, but given no room.
      expect(document.querySelector('.tally--play')).toBeEmptyDOMElement();
      expect(document.querySelector('.app')).not.toHaveClass('app--tally');
      expect(document.querySelector('.header')).not.toHaveClass('header--tally');
      expect(document.querySelector('.tally--header')).toBeEmptyDOMElement();
      takeHint();
      expect(document.querySelector('.app')).toHaveClass('app--tally');
      expect(document.querySelector('.header')).toHaveClass('header--tally');
    });

    it('shows a hint taken beside the timer and above the controls, says it once, and counts it on Hint', async () => {
      await startApp();
      takeHint();
      expect(shown()).toEqual(['1 hint', '1 hint']);
      const [header, play] = helpTaken();
      expect(header).toHaveClass('help-taken--header');
      expect(header.closest('.tally--header')?.nextElementSibling).toHaveClass('header__timer');
      expect(play).toHaveClass('help-taken--play');
      expect(document.querySelector('.header')).toHaveClass('header--tally');
      expect(header).toHaveTextContent(/Help taken: 1 hint$/);
      expect(liveRegion()).toHaveTextContent(/\. 1 hint used\.$/);
      expect(within(openMore()).getByRole('menuitem', { name: 'Hint (1 used)' })).toBeVisible();
    });

    it('does not tick for Check guesses a shared game takes up as it starts', () => {
      const storage = memoryStorage();
      storage.setItem('sudoku.prefs', JSON.stringify({ settings: { checkGuesses: true } }));
      renderApp({ storage, search: linkFor(nearlySolved([0, 1, 2]).givens) });
      expect(helpTaken()).toEqual([]);
      fireEvent.click(screen.getAllByRole('button', { name: 'Start' })[1]);
      expect(shown()).toEqual(['Checked as entered', 'Checked as entered']);
      expect(document.querySelector('.help-taken__face--tick')).toBeNull();
    });

    it('sits beside the error counter, help taken first', async () => {
      await startApp();
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show error counter' }));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      takeHint();
      for (const tally of document.querySelectorAll('.tally')) {
        expect([...tally.children].map((child) => child.classList[0])).toEqual([
          'help-taken',
          'error-counter',
        ]);
      }
    });

    it('stays on show while the game is paused: it says nothing about the board', async () => {
      await startApp();
      takeHint();
      press('p');
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      expect(shown()).toEqual(['1 hint', '1 hint']);
    });

    it('hides the help, the count on Hint and the count said, with Show help taken off', async () => {
      await startApp();
      takeHint();
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show help taken' }));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(helpTaken()).toEqual([]);
      expect(document.querySelector('.app')).not.toHaveClass('app--tally');
      expect(document.querySelector('.tally')).toBeNull();
      expect(within(openMore()).getByRole('menuitem', { name: 'Hint' })).toBeVisible();
      press('Escape');
      fireEvent.click(screen.getByRole('switch', { name: 'Auto Candidate Mode' }));
      expect(liveRegion()).toHaveTextContent(/^Auto candidates on\.$/);
    });
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
    // The solve's mistakes go with it, as its record has them: none, said as such.
    expect(share.querySelector('.share__text')).toHaveTextContent(
      /^Sudoku · Easy · 0:\d\d No mistakes/,
    );
    expect(new URL(share.querySelector('.share__url')!.textContent!).searchParams.get('a')).toBe(
      'm0',
    );
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
      await settle();
      expect(screen.getByText('Expert')).toBeInTheDocument();
      expect(screen.getByRole('grid')).toBeInTheDocument();
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
      const dialog = await screen.findByRole('dialog', { name: 'Solved!' });
      // It opens on a timer, outside act, so its effects run a task after it
      // is on the page. They take focus and start listening for Escape in the
      // same run, so focus inside means Escape will be heard.
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Share your time' })).toHaveFocus(),
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
      await settle();
      expect(screen.getByRole('grid')).toBeInTheDocument();
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
      // Today's dailies come first.
      expect(screen.getByRole('menuitem', { name: /^Today's Easy puzzle/ })).toHaveFocus();
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

    it('comes back to a hint’s question from the guide it opened from the keyboard', async () => {
      // The board goes while the guide is open; the hint, and its question,
      // wait behind it.
      await startApp();
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Hint' }));
      const question = screen.getByRole('button', { name: /^What's a / });
      question.focus();
      fireEvent.keyDown(question, { key: 'Enter' });
      fireEvent.click(question);
      expect(screen.getByRole('dialog', { name: 'Solving techniques' })).toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(question).toHaveFocus();
    });

    it('comes back to the board from the guide opened from a hint with the mouse', async () => {
      await startApp();
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Hint' }));
      clickWithMouse(screen.getByRole('button', { name: /^What's a / }));
      expect(screen.getByRole('dialog', { name: 'Solving techniques' })).toBeInTheDocument();
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
          <App
            options={{
              search: '',
              storage: memoryStorage(),
              source: fakeSource(),
              dailies: fakeDailies(),
            }}
          />
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

  describe('daily puzzles', () => {
    /** Noon on Tuesday 13 October 2026, local time: today, for these tests. */
    const NOON = new Date(2026, 9, 13, 12).getTime();
    const TODAY = '2026-10-13';
    const now = () => NOON;
    /** Today's Hard daily, a move from solved. */
    const NEAR = nearlySolved([0]);

    function openNewGame() {
      fireEvent.click(screen.getByRole('button', { name: 'New game' }));
      return screen.getByRole('menu', { name: 'New game' });
    }

    it("plays today's daily from New game, then names it and starts its streak", async () => {
      const dailies = fakeDailies({ now, puzzles: { [`${TODAY}/hard`]: NEAR } });
      await startApp({ now, dailies });
      const menu = openNewGame();
      expect(within(menu).getByRole('group', { name: /^Today's puzzles/ })).toHaveTextContent(
        'Tue 13 Oct',
      );
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: "Today's Hard puzzle, not started" }),
      );
      await screen.findByRole('grid');
      expect(liveRegion()).toHaveTextContent("Today's Hard puzzle.");
      press(String(answerAt(0, NEAR)));
      const dialog = await screen.findByRole('dialog', { name: 'Solved!' });
      expect(within(dialog).getByText('Daily · 13 Oct · Hard')).toBeInTheDocument();
      expect(within(dialog).getByText('That starts a Hard streak')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(
        within(openNewGame()).getByRole('menuitem', {
          name: "Today's Hard puzzle, solved (current)",
        }),
      ).toBeInTheDocument();
    });

    it('shows the loading card while a daily is dealt, naming it', async () => {
      const dailies = fakeDailies({ now, held: true });
      await startApp({ now, dailies });
      fireEvent.click(
        within(openNewGame()).getByRole('menuitem', { name: "Today's Expert puzzle, not started" }),
      );
      expect(screen.getByText("Generating today's Expert puzzle…")).toBeInTheDocument();
      await act(async () => dailies.release());
      expect(screen.getByRole('grid')).toBeInTheDocument();
      // The keyboard carries on from the daily's board.
      expect(selectedCell()).toHaveFocus();
    });

    it('takes the keyboard to a daily already dealt, which arrives at once', async () => {
      const dailies = fakeDailies({ now, dealt: [`${TODAY}/hard`] });
      await startApp({ now, dailies });
      const button = screen.getByRole('button', { name: 'New game' });
      button.focus();
      // From the keyboard: a click with no count, as Enter gives.
      fireEvent.click(button, { detail: 0 });
      fireEvent.click(screen.getByRole('menuitem', { name: "Today's Hard puzzle, not started" }), {
        detail: 0,
      });
      expect(screen.queryByText(/^Generating/)).not.toBeInTheDocument();
      expect(selectedCell()).toHaveFocus();
      expect(dailies.asked).toEqual([]);
    });

    it('names a daily on the Paused card and in History', async () => {
      await startApp({ now, dailies: fakeDailies({ now }) });
      fireEvent.click(
        within(openNewGame()).getByRole('menuitem', { name: "Today's Medium puzzle, not started" }),
      );
      await screen.findByRole('grid');
      press('p');
      const card = document.querySelector<HTMLElement>('.board-overlay')!;
      expect(card).toHaveTextContent('Daily · 13 Oct · Medium · 0:00');
      fireEvent.click(screen.getByRole('button', { name: 'History' }));
      const history = screen.getByRole('dialog', { name: 'History' });
      expect(within(history).getByText('Daily · 13 Oct')).toBeInTheDocument();
    });

    it('offers a solved daily again from New game, saying when it was solved', async () => {
      const dailies = fakeDailies({ now, puzzles: { [`${TODAY}/hard`]: NEAR } });
      await startApp({ now, dailies });
      fireEvent.click(
        within(openNewGame()).getByRole('menuitem', { name: "Today's Hard puzzle, not started" }),
      );
      await screen.findByRole('grid');
      press(String(answerAt(0, NEAR)));
      fireEvent.click(
        within(await screen.findByRole('dialog', { name: 'Solved!' })).getByRole('button', {
          name: 'Close',
        }),
      );
      fireEvent.click(
        within(openNewGame()).getByRole('menuitem', {
          name: "Today's Hard puzzle, solved (current)",
        }),
      );
      const offer = screen.getByRole('dialog', { name: "You've solved this one" });
      expect(offer).toHaveTextContent(/You solved the Hard daily for 13 Oct in 0:0\d/);
      fireEvent.click(within(offer).getByRole('button', { name: 'Play again' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(liveRegion()).toHaveTextContent('Playing this Hard puzzle again.');
    });

    it('opens the calendar from the header and from New game, and plays a past day from it', async () => {
      const dailies = fakeDailies({ now });
      await startApp({ now, dailies });
      fireEvent.click(within(openNewGame()).getByRole('menuitem', { name: 'Daily puzzles' }));
      expect(screen.getByRole('dialog', { name: 'Daily puzzles' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      fireEvent.click(screen.getByRole('button', { name: 'Daily puzzles' }));
      const calendar = screen.getByRole('dialog', { name: 'Daily puzzles' });
      // Opened on today.
      expect(within(calendar).getByRole('gridcell', { selected: true })).toHaveAccessibleName(
        'Tuesday 13 October: Easy, Medium, Hard and Expert not started',
      );
      fireEvent.click(within(calendar).getByRole('gridcell', { name: /^Monday 12 October/ }));
      fireEvent.click(
        within(calendar).getByRole('button', { name: 'Play, Easy daily for Monday 12 October' }),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await settle();
      expect(screen.getByRole('grid')).toBeInTheDocument();
      expect(selectedCell()).toHaveFocus();
      expect(liveRegion()).toHaveTextContent('The Easy daily for 12 Oct.');

      fireEvent.click(screen.getByRole('button', { name: 'Daily puzzles' }));
      expect(
        screen.getByRole('gridcell', { name: /^Monday 12 October: Easy in progress/ }),
      ).toBeInTheDocument();
    });

    it('plays a solved daily again from the calendar', async () => {
      const dailies = fakeDailies({ now, puzzles: { [`${TODAY}/hard`]: NEAR } });
      await startApp({ now, dailies });
      fireEvent.click(
        within(openNewGame()).getByRole('menuitem', { name: "Today's Hard puzzle, not started" }),
      );
      await screen.findByRole('grid');
      press(String(answerAt(0, NEAR)));
      fireEvent.click(
        within(await screen.findByRole('dialog', { name: 'Solved!' })).getByRole('button', {
          name: 'Close',
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Daily puzzles' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Play again, Hard daily for Tuesday 13 October' }),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(liveRegion()).toHaveTextContent('Playing this Hard puzzle again.');
    });

    it('shares a daily by name, with its date in the link', async () => {
      await startApp({ now, dailies: fakeDailies({ now }) });
      fireEvent.click(
        within(openNewGame()).getByRole('menuitem', { name: "Today's Hard puzzle, not started" }),
      );
      await screen.findByRole('grid');
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
      const share = screen.getByRole('dialog', { name: 'Share this puzzle' });
      expect(within(share).getByText(/^Sudoku Daily · 13 Oct 2026 · Hard/)).toBeInTheDocument();
      expect(within(share).getByText(/[?&]d=2026-10-13/)).toBeInTheDocument();
    });

    it("names a friend's daily on the Ready card once its date checks out", async () => {
      const dailies = fakeDailies({ now, puzzles: { [`${TODAY}/hard`]: PUZZLE } });
      renderApp({ now, dailies, search: `${linkFor(PUZZLE.givens)}&d=${TODAY}` });
      expect(
        await screen.findByText("Someone shared today's Hard puzzle with you."),
      ).toBeInTheDocument();
    });

    it('opens a link to a daily of 1–6 October, from before Daily #1 moved to the 7th, as a plain shared puzzle', async () => {
      const dailies = fakeDailies({ now, puzzles: { '2026-10-03/hard': PUZZLE } });
      renderApp({ now, dailies, search: `${linkFor(PUZZLE.givens)}&d=2026-10-03` });
      expect(
        await screen.findByText(/^Someone shared an? (Easy|Medium|Hard|Expert) puzzle with you\.$/),
      ).toBeInTheDocument();
      await act(async () => {});
      expect(screen.queryByText(/daily/i)).not.toBeInTheDocument();
      expect(dailies.asked).toEqual([]);
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
