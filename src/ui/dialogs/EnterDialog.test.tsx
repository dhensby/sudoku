import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { formatGrid, parseGrid, puzzleFromGivens, type GridString } from '../../core';
import { THREE_DIGITS_TWO_CELLS, WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../../test/grids';
import { BEYOND_THE_SET, HARDEST } from '../../test/logic-fixtures';
import { EnterDialog } from './EnterDialog';

const PUZZLE = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
const SOLUTION = formatGrid(parseGrid(WIKIPEDIA_SOLUTION));
const HARD = HARDEST.nakedPair.givens;

const BLANK = '0'.repeat(81);

interface EditorOptions {
  initialCells?: GridString;
  initialSelected?: number;
  savedCells?: GridString | null;
  isBackFromShare?: boolean;
}

/** The editor on a new puzzle, or as `options` open it: on a grid kept, say. */
function renderEditor({
  initialCells = BLANK,
  initialSelected = 0,
  savedCells = null,
  isBackFromShare,
}: EditorOptions = {}) {
  const onPlay = vi.fn();
  const onShare = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  const props = {
    settings: { highlightRowColumn: true, highlightBox: true },
    initialCells,
    initialSelected,
    savedCells,
    onPlay,
    onShare,
    onSave,
    onClose,
    isBackFromShare,
  };
  const view = render(<EnterDialog {...props} />);
  return { ...view, props, onPlay, onShare, onSave, onClose };
}

const dialog = () => screen.getByRole('dialog', { name: 'Enter a puzzle' });
const cells = () => within(dialog()).getAllByRole('gridcell');
const cell = (index: number) => cells()[index];
const selected = () => cells().findIndex((it) => it.getAttribute('aria-selected') === 'true');
/** The line saying what the numbers make: the first of the two status regions. */
const status = () => within(dialog()).getAllByRole('status')[0];
/** What Save says it did, unseen: the second. */
const saveStatus = () => within(dialog()).getAllByRole('status')[1];
const play = () => within(dialog()).getByRole('button', { name: 'Play' });
const share = () => within(dialog()).getByRole('button', { name: 'Share…' });
const save = () => within(dialog()).getByRole('button', { name: /^Saved?$/ });
const pasteButton = () => within(dialog()).getByRole('button', { name: 'Paste' });
const padKey = (digit: number) =>
  within(dialog()).getByRole('button', { name: new RegExp(`^${digit}(, all placed)?$`) });

/**
 * Press a key where focus is, as a keyboard sends it — a digit with its
 * key's physical code — and say whether it was let through (not prevented).
 */
function press(key: string, init: Partial<KeyboardEventInit> = {}): boolean {
  const code = /^[0-9]$/.test(key) ? `Digit${key}` : key === ' ' ? 'Space' : init.code;
  return fireEvent.keyDown(document.activeElement!, { key, code, ...init });
}

/** Type `text` from the selection, a key a character: '0' leaves a blank. */
function type(text: string) {
  for (const ch of text) press(ch);
}

/**
 * Paste `text` where focus is, as Ctrl or Cmd+V does, and say whether it was
 * let through (not prevented).
 */
function pasteText(text: string): boolean {
  return fireEvent.paste(document.activeElement!, {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
}

/** Give `navigator` a clipboard for one test, taken away afterwards: jsdom has none. */
function stubClipboard(clipboard: Pick<Clipboard, 'readText'>) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

/** Press Paste, and let the clipboard's answer land. */
async function pressPaste() {
  await act(async () => {
    fireEvent.click(pasteButton());
  });
}

/** What the grid holds, '0' for an empty cell, read from the cells' names. */
const typed = (): GridString =>
  cells()
    .map((it) => /^(\d), given/.exec(it.getAttribute('aria-label')!)?.[1] ?? '0')
    .join('');

describe('EnterDialog', () => {
  it('opens on the first cell of an empty grid, described by what to do', () => {
    renderEditor();
    expect(within(dialog()).getByRole('grid', { name: 'Your puzzle' })).toBeInTheDocument();
    expect(cells()).toHaveLength(81);
    expect(typed()).toBe('0'.repeat(81));
    expect(cell(0)).toHaveFocus();
    expect(dialog()).toHaveAccessibleDescription(
      'Type in the numbers from your puzzle. Check every number against your copy.',
    );
    // No footer: Play is in the body, under the pad.
    expect(dialog().querySelector('.dialog__footer')).toBeNull();
  });

  it('opens on a grid kept, the selection just after its last number, typing on from there', () => {
    const kept = '530070000600195'.padEnd(81, '0');
    renderEditor({ initialCells: kept, initialSelected: 15, savedCells: kept });
    expect(typed()).toBe(kept);
    expect(selected()).toBe(15);
    expect(cell(15)).toHaveFocus();
    expect(status()).toHaveTextContent('A puzzle needs at least 17 numbers.');
    type('98');
    expect(typed().slice(0, 17)).toBe('53007000060019598');
  });

  it('hands up the grid as it was left as it closes, whichever way', () => {
    const { onClose } = renderEditor();
    type('53');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenLastCalledWith('53'.padEnd(81, '0'));
    type('7');
    press('Escape');
    expect(onClose).toHaveBeenLastCalledWith('537'.padEnd(81, '0'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  describe('the keys', () => {
    it('fill a cell with a number and move on, leaving one blank for 0, a dot or Space', () => {
      renderEditor();
      expect(press('5')).toBe(false);
      for (const blank of ['0', '.', ' ']) expect(press(blank)).toBe(false);
      press('3');
      expect(typed().slice(0, 6)).toBe('500030');
      expect(selected()).toBe(5);
      // Focus goes with the selection, for the next key.
      expect(cell(5)).toHaveFocus();
    });

    it('read the numpad as the top row, Num Lock off or on, whatever its dot prints', () => {
      renderEditor();
      // Num Lock off, the keys name where they would move: the dot calls itself Delete.
      press('Home', { code: 'Numpad7' });
      press('Insert', { code: 'Numpad0' });
      press('Delete', { code: 'NumpadDecimal' });
      press('ArrowDown', { code: 'Numpad2' });
      // Num Lock on, in a layout whose numpad dot is a comma.
      press('7', { code: 'Numpad7' });
      press(',', { code: 'NumpadDecimal' });
      expect(typed().slice(0, 6)).toBe('700270');
      expect(selected()).toBe(6);
    });

    it('read a number from its key’s place, Shift or Alt held, whatever the layout prints', () => {
      renderEditor();
      // AZERTY's unshifted 1, Shift+5 and Option+8 on a Mac.
      press('&', { code: 'Digit1' });
      press('%', { code: 'Digit5', shiftKey: true });
      press('•', { code: 'Digit8', altKey: true });
      expect(typed().slice(0, 3)).toBe('158');
    });

    it('go on to the next row from the end of one, and no further than the last cell', () => {
      renderEditor();
      fireEvent.click(cell(8));
      press('1');
      expect(selected()).toBe(9);
      fireEvent.click(cell(80));
      press('2');
      expect(selected()).toBe(80);
      press('3');
      expect(selected()).toBe(80);
      expect(typed()[80]).toBe('3');
      press(' ');
      expect(typed()[80]).toBe('0');
      expect(selected()).toBe(80);
    });

    it('take back the last number with Backspace: the cell’s own, or else the one before', () => {
      renderEditor();
      type('12');
      expect(selected()).toBe(2);
      // On an empty cell: back a cell, and erase it.
      expect(press('Backspace')).toBe(false);
      expect(typed().slice(0, 2)).toBe('10');
      expect(selected()).toBe(1);
      press('Backspace');
      expect(typed().slice(0, 2)).toBe('00');
      expect(selected()).toBe(0);
      // Nothing before the first cell.
      expect(press('Backspace')).toBe(false);
      expect(selected()).toBe(0);
      // On a number: erase it, staying put.
      type('45');
      fireEvent.click(cell(0));
      press('Backspace');
      expect(typed().slice(0, 2)).toBe('05');
      expect(selected()).toBe(0);
    });

    it('erase in place with Delete', () => {
      renderEditor();
      type('12');
      fireEvent.click(cell(1));
      expect(press('Delete')).toBe(false);
      expect(typed().slice(0, 3)).toBe('100');
      expect(selected()).toBe(1);
    });

    it('move the selection with the arrows, stopping at the first cell and the last', () => {
      renderEditor();
      expect(press('ArrowLeft')).toBe(false);
      press('ArrowUp');
      expect(selected()).toBe(0);
      press('ArrowDown');
      press('ArrowRight');
      expect(selected()).toBe(10);
      expect(cell(10)).toHaveFocus();
      fireEvent.click(cell(80));
      press('ArrowDown');
      press('ArrowRight');
      expect(selected()).toBe(80);
      press('ArrowUp');
      press('ArrowLeft');
      expect(selected()).toBe(70);
      // Moving types nothing.
      expect(typed()).toBe('0'.repeat(81));
    });

    it('run on round the rows with left and right, as typing does, but not with up and down', () => {
      renderEditor();
      fireEvent.click(cell(8));
      expect(press('ArrowRight')).toBe(false);
      expect(selected()).toBe(9);
      expect(cell(9)).toHaveFocus();
      press('ArrowLeft');
      expect(selected()).toBe(8);
      // Up and down keep to the column, so the top and bottom rows stop them.
      press('ArrowUp');
      expect(selected()).toBe(8);
      fireEvent.click(cell(72));
      press('ArrowDown');
      expect(selected()).toBe(72);
      press('ArrowLeft');
      expect(selected()).toBe(71);
    });

    it('take a number or a blank once however long its key is held, but go on erasing and moving', () => {
      renderEditor();
      press('5');
      // A repeat ignored is still kept from the page: a held Space scrolls it.
      expect(press('5', { repeat: true })).toBe(false);
      expect(press(' ', { repeat: true })).toBe(false);
      expect(press('0', { repeat: true })).toBe(false);
      expect(typed().slice(0, 2)).toBe('50');
      expect(selected()).toBe(1);
      press('ArrowRight', { repeat: true });
      press('ArrowRight', { repeat: true });
      expect(selected()).toBe(3);
      for (const key of ['Backspace', 'Delete']) {
        fireEvent.click(cell(0));
        press('5');
        fireEvent.click(cell(0));
        press(key, { repeat: true });
        expect(typed()[0], key).toBe('0');
      }
    });

    it('leave every Ctrl and Cmd chord to the browser, and the dialog its own keys', () => {
      const { onClose } = renderEditor();
      for (const chord of [
        { key: '5', ctrlKey: true },
        { key: '0', ctrlKey: true },
        { key: 'v', code: 'KeyV', metaKey: true },
        { key: 'z', code: 'KeyZ', ctrlKey: true },
        { key: 'Backspace', metaKey: true },
        { key: 'ArrowRight', ctrlKey: true },
      ]) {
        expect(press(chord.key, chord), JSON.stringify(chord)).toBe(true);
      }
      for (const key of ['p', 'Tab', 'Enter']) expect(press(key), key).toBe(true);
      expect(typed()).toBe('0'.repeat(81));
      expect(selected()).toBe(0);
      // Escape is the dialog's: it closes, with what was typed.
      press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('count only on the grid: Space on Play, Share…, Save, Paste or a pad key presses it as ever', () => {
      renderEditor();
      for (const target of [play(), share(), save(), pasteButton(), padKey(5)]) {
        target.focus();
        expect(press(' ')).toBe(true);
      }
      expect(typed()).toBe('0'.repeat(81));
    });
  });

  describe('the pad', () => {
    it('puts a number in the selected cell, and Erase takes it out, moving nothing', () => {
      renderEditor();
      fireEvent.click(cell(40));
      fireEvent.click(padKey(5));
      expect(cell(40)).toHaveAccessibleName('5, given');
      expect(selected()).toBe(40);
      // A correction lands in the same cell.
      fireEvent.click(padKey(6));
      expect(cell(40)).toHaveAccessibleName('6, given');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Erase' }));
      expect(cell(40)).toHaveAccessibleName('empty');
      expect(selected()).toBe(40);
    });

    it('keeps focus on the grid as a mouse presses its keys, Save or Paste', () => {
      renderEditor();
      for (const key of [
        padKey(5),
        within(dialog()).getByRole('button', { name: 'Erase' }),
        save(),
        pasteButton(),
      ]) {
        // Pressed, it takes no focus: the browser's own move is prevented.
        expect(fireEvent.mouseDown(key)).toBe(false);
      }
    });

    it('marks a number in nine times as all placed, still a working key', () => {
      renderEditor();
      type(SOLUTION);
      for (let digit = 1; digit <= 9; digit++) {
        expect(padKey(digit)).toHaveAccessibleName(`${digit}, all placed`);
      }
      fireEvent.click(padKey(1));
      expect(typed()[80]).toBe('1');
    });
  });

  describe('the status line', () => {
    it.each<[string, () => void]>([
      ['Two 5s in row 1.', () => type('55')],
      ['Three 5s in row 1.', () => type('555')],
      [
        'Two 5s in column 1.',
        () => {
          type('5');
          fireEvent.click(cell(9));
          type('5');
        },
      ],
      [
        'Two 5s in box 1.',
        () => {
          type('5');
          fireEvent.click(cell(10));
          type('5');
        },
      ],
    ])('names a clash as soon as there is one: "%s"', (text, typeIt) => {
      renderEditor();
      typeIt();
      expect(status()).toHaveTextContent(new RegExp(`^${text}$`));
      expect(cell(0)).toHaveAccessibleName('5, given, conflict');
    });

    it.each<[string, GridString]>([
      ['A puzzle needs at least 17 numbers.', '123'.padEnd(81, '0')],
      ['Every cell is filled: nothing to solve.', SOLUTION],
      // The top two rows of a solved grid left blank: they can swap wholesale.
      ['More than one solution so far.', '0'.repeat(18) + SOLUTION.slice(18)],
      // Row 1, column 3 could hold a 1 as far as its peers go, but its answer is a 4.
      ['No solution: a number must be wrong.', `${PUZZLE.slice(0, 2)}1${PUZZLE.slice(3)}`],
      ['Too complex to check.', formatGrid(parseGrid(THREE_DIGITS_TWO_CELLS))],
      ['One solution: an Easy puzzle.', PUZZLE],
      ['One solution: a Hard puzzle.', HARD],
      ['One solution: an Expert puzzle.', HARDEST.xWing.givens],
      ['One solution: a Beyond Expert puzzle.', BEYOND_THE_SET.givens],
    ])('says "%s"', (text, grid) => {
      renderEditor();
      type(grid);
      expect(typed()).toBe(grid);
      expect(status()).toHaveTextContent(new RegExp(`^${text}$`));
    });

    it('keeps its words while the same thing is true, so a reader hears only what changes', () => {
      renderEditor();
      type('1');
      expect(status()).toHaveTextContent('A puzzle needs at least 17 numbers.');
      const observer = new MutationObserver(() => {});
      observer.observe(status(), { childList: true, characterData: true, subtree: true });
      type('23456');
      // Read before the observer would hear of them, a microtask on.
      expect(observer.takeRecords()).toEqual([]);
      observer.disconnect();
    });
  });

  describe('Play', () => {
    it('is unavailable until the numbers make a puzzle, saying why, and does nothing pressed', () => {
      const { onPlay } = renderEditor();
      expect(play()).toHaveAttribute('aria-disabled', 'true');
      // Never disabled outright: it may hold focus.
      expect(play()).toBeEnabled();
      type('123');
      expect(play()).toHaveAccessibleDescription('A puzzle needs at least 17 numbers.');
      fireEvent.click(play());
      expect(onPlay).not.toHaveBeenCalled();
    });

    it('plays the puzzle typed in, checked and labelled as its link would be', () => {
      const { onPlay } = renderEditor();
      type(HARD);
      expect(play()).not.toHaveAttribute('aria-disabled');
      expect(play()).toHaveAccessibleDescription('One solution: a Hard puzzle.');
      fireEvent.click(play());
      const checked = puzzleFromGivens(HARD);
      expect(checked.ok).toBe(true);
      expect(onPlay).toHaveBeenCalledWith(checked.ok && checked.puzzle);
    });

    it('is unavailable again once a number spoils the puzzle', () => {
      const { onPlay } = renderEditor();
      type(HARD);
      fireEvent.click(cell(2));
      // The 6 already in row 1.
      type('6');
      expect(play()).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(play());
      expect(onPlay).not.toHaveBeenCalled();
    });
  });

  describe('Share…', () => {
    it('is unavailable until the numbers make a puzzle, saying why, and does nothing pressed', () => {
      const { onShare } = renderEditor();
      expect(share()).toHaveAttribute('aria-disabled', 'true');
      expect(share()).toBeEnabled();
      type('123');
      expect(share()).toHaveAccessibleDescription('A puzzle needs at least 17 numbers.');
      fireEvent.click(share());
      expect(onShare).not.toHaveBeenCalled();
    });

    it('shares the puzzle typed in as Play would play it, with the cell selected to come back to', () => {
      const { onShare, onPlay, onSave } = renderEditor();
      type(HARD);
      fireEvent.click(cell(30));
      expect(share()).not.toHaveAttribute('aria-disabled');
      expect(share()).toHaveAccessibleDescription('One solution: a Hard puzzle.');
      fireEvent.click(share());
      const checked = puzzleFromGivens(HARD);
      expect(checked.ok).toBe(true);
      expect(onShare).toHaveBeenCalledExactlyOnceWith(checked.ok && checked.puzzle, 30);
      // Kept by the parent as it shares: Save is not pressed for it, nor Play.
      expect(onSave).not.toHaveBeenCalled();
      expect(onPlay).not.toHaveBeenCalled();
    });

    it('sits between Play and Save, the row shared out equally', () => {
      renderEditor();
      const row = dialog().querySelector('.enter__actions')!;
      expect(
        within(row as HTMLElement)
          .getAllByRole('button')
          .map((it) => it.textContent),
      ).toEqual(['Play', 'Share…', 'Save', 'Paste']);
    });

    it('takes focus back as the editor opens again from Share, the selection where it was', () => {
      renderEditor({
        initialCells: HARD,
        initialSelected: 30,
        savedCells: HARD,
        isBackFromShare: true,
      });
      expect(share()).toHaveFocus();
      expect(selected()).toBe(30);
      expect(cells().filter((it) => it.hasAttribute('data-autofocus'))).toEqual([]);
      expect(save()).toHaveTextContent(/^Saved$/);
    });
  });

  describe('Save', () => {
    it('is unavailable on an empty grid, and does nothing pressed', () => {
      const { onSave } = renderEditor();
      expect(save()).toHaveTextContent(/^Save$/);
      expect(save()).toHaveAttribute('aria-disabled', 'true');
      expect(save()).toBeEnabled();
      fireEvent.click(save());
      expect(onSave).not.toHaveBeenCalled();
    });

    it('keeps any grid with a number in, finished or not, saying so unseen', () => {
      const { onSave } = renderEditor();
      type('55');
      expect(status()).toHaveTextContent('Two 5s in row 1.');
      expect(save()).not.toHaveAttribute('aria-disabled');
      expect(saveStatus()).toBeEmptyDOMElement();
      fireEvent.click(save());
      expect(onSave).toHaveBeenCalledWith('55'.padEnd(81, '0'));
      expect(saveStatus()).toHaveTextContent(/^Saved to Your puzzles\.$/);
      // The line about the numbers keeps its words.
      expect(status()).toHaveTextContent('Two 5s in row 1.');
    });

    it('says Saved, unavailable, while the grid is as saved, and Save again once it changes', () => {
      const kept = '55'.padEnd(81, '0');
      const { onSave, props, rerender } = renderEditor();
      type('55');
      fireEvent.click(save());
      // As the parent has it once kept: saved as typed, the editor staying open.
      rerender(<EnterDialog {...props} savedCells={kept} />);
      expect(save()).toHaveTextContent(/^Saved$/);
      expect(save()).toHaveAttribute('aria-disabled', 'true');
      expect(typed()).toBe(kept);
      fireEvent.click(save());
      expect(onSave).toHaveBeenCalledTimes(1);
      type('3');
      expect(save()).toHaveTextContent(/^Save$/);
      expect(save()).not.toHaveAttribute('aria-disabled');
      // Back as it was saved, it is saved again.
      press('Backspace');
      expect(save()).toHaveTextContent(/^Saved$/);
    });

    it('opens as Saved on a grid kept, and says so again each time it saves', () => {
      const kept = '6'.padEnd(81, '0');
      const { onSave, props, rerender } = renderEditor({
        initialCells: kept,
        initialSelected: 1,
        savedCells: kept,
      });
      expect(save()).toHaveTextContent(/^Saved$/);
      const said: Element[] = [];
      for (const digit of ['7', '8']) {
        type(digit);
        fireEvent.click(save());
        const now = typed();
        expect(onSave).toHaveBeenLastCalledWith(now);
        rerender(<EnterDialog {...props} savedCells={now} />);
        expect(saveStatus()).toHaveTextContent(/^Saved to Your puzzles\.$/);
        said.push(saveStatus().firstElementChild!);
      }
      // A fresh message each time, though the words are the same, so each is announced.
      expect(said[1]).not.toBe(said[0]);
    });

    it('is still unavailable on a grid kept that is erased to nothing', () => {
      const kept = '6'.padEnd(81, '0');
      const { onSave } = renderEditor({ initialCells: kept, initialSelected: 0, savedCells: kept });
      press('Delete');
      expect(save()).toHaveTextContent(/^Save$/);
      expect(save()).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(save());
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('pasting', () => {
    it('puts a grid copied in place of the one typed, from Ctrl or Cmd+V on the grid', () => {
      renderEditor();
      type('53');
      fireEvent.click(cell(30));
      // As a book prints it: nine lines, a dot for each blank.
      expect(pasteText(WIKIPEDIA_PUZZLE)).toBe(false);
      expect(typed()).toBe(PUZZLE);
      // The selection where it was, and the line saying what the grid makes.
      expect(selected()).toBe(30);
      expect(cell(30)).toHaveFocus();
      expect(status()).toHaveTextContent(/^One solution: an Easy puzzle\.$/);
      expect(play()).not.toHaveAttribute('aria-disabled');
    });

    it('says when there is no grid in a paste, each time, until the grid changes', () => {
      renderEditor();
      type('53');
      expect(pasteText('hello')).toBe(false);
      expect(status()).toHaveTextContent(/^No puzzle in what you copied\.$/);
      expect(typed()).toBe('53'.padEnd(81, '0'));
      const first = status().firstElementChild;
      // A paste of nothing, or a cell short: a fresh message, though the words are the same.
      for (const text of ['', PUZZLE.slice(1)]) {
        pasteText(text);
        expect(status()).toHaveTextContent(/^No puzzle in what you copied\.$/);
        expect(status().firstElementChild).not.toBe(first);
      }
      // Moving on leaves it; a number in brings back the line about the numbers.
      press('ArrowRight');
      expect(status()).toHaveTextContent(/^No puzzle in what you copied\.$/);
      type('7');
      expect(status()).toHaveTextContent(/^A puzzle needs at least 17 numbers\.$/);
    });

    it('goes back to the line about the numbers as a grid is pasted after one that was not', () => {
      renderEditor();
      pasteText('hello');
      pasteText(PUZZLE);
      expect(status()).toHaveTextContent(/^One solution: an Easy puzzle\.$/);
    });

    it('reads the clipboard as Paste is pressed, before anything else, and puts its grid in', async () => {
      const readText = vi.fn<() => Promise<string>>().mockResolvedValue(WIKIPEDIA_PUZZLE);
      stubClipboard({ readText });
      renderEditor({ initialCells: HARD, initialSelected: 30, savedCells: HARD });
      fireEvent.click(pasteButton());
      // Asked within the press, as Safari and Firefox need, before its answer is awaited.
      expect(readText).toHaveBeenCalledOnce();
      expect(typed()).toBe(HARD);
      await act(async () => {});
      expect(typed()).toBe(PUZZLE);
      expect(selected()).toBe(30);
      expect(status()).toHaveTextContent(/^One solution: an Easy puzzle\.$/);
      // Not the grid as kept, so it can be saved.
      expect(save()).toHaveTextContent(/^Save$/);
    });

    it('says when the clipboard holds no grid', async () => {
      stubClipboard({ readText: vi.fn().mockResolvedValue('https://example.com/') });
      renderEditor();
      await pressPaste();
      expect(status()).toHaveTextContent(/^No puzzle in what you copied\.$/);
      expect(typed()).toBe(BLANK);
    });

    it('says when the clipboard cannot be read — refused, or missing — each time', async () => {
      stubClipboard({
        readText: vi.fn().mockRejectedValue(new DOMException('No', 'NotAllowedError')),
      });
      renderEditor();
      await pressPaste();
      expect(status()).toHaveTextContent(/^Couldn't read the clipboard\.$/);
      const first = status().firstElementChild;
      // As an insecure page, or an older browser, has none.
      delete (navigator as unknown as Record<string, unknown>).clipboard;
      await pressPaste();
      expect(status()).toHaveTextContent(/^Couldn't read the clipboard\.$/);
      expect(status().firstElementChild).not.toBe(first);
      expect(typed()).toBe(BLANK);
    });
  });
});
