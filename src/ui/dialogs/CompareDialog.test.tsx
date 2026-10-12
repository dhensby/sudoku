import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  appendMove,
  createGame,
  createMoveLog,
  encodeMoveLog,
  moveFor,
  reduce,
  type Digit,
  type GameAction,
} from '../../core';
import { REFUSAL_TEXT } from '../playbackText';
import { answerAt, shortSolve } from '../testFixtures';
import { CompareDialog, type CompareSource } from './CompareDialog';

/*
 * Two solves of `nearlySolved([0, 40, 80])`, each blank a full house.
 *
 * The friend's is the short solve (see `shortSolve`): a wrong 6 in cell 0 at
 * 0:01, counted, put right at 0:05; a hint at 0:06; cell 40 at 0:07 and cell
 * 80 at 0:09, the solve.
 *
 * Mine: cell 80 at 0:02; a wrong number in cell 40 at 0:03, left four
 * seconds, so it counts; cell 0 at 0:04; cell 40 put right at 0:07, the solve.
 */
const THEIRS = shortSolve();
const { puzzle } = THEIRS;
const answer = (cell: number) => answerAt(cell, puzzle) as Digit;
const wrong = (cell: number) => ((answer(cell) % 9) + 1) as Digit;
const place = (index: number, digit: Digit): GameAction => ({
  type: 'enter',
  digit,
  index,
  mode: 'normal',
});

function logOf(steps: readonly (readonly [atMs: number, action: GameAction])[]): string {
  let game = createGame(puzzle);
  let log = createMoveLog();
  for (const [atMs, action] of steps) {
    const next = reduce(game, action);
    log = appendMove(log, moveFor(game, action, next)!, atMs);
    game = next;
  }
  return encodeMoveLog(log);
}

const MINE = logOf([
  [2000, place(80, answer(80))],
  [3000, place(40, wrong(40))],
  [4000, place(0, answer(0))],
  [7000, place(40, answer(40))],
]);
/** A clean solve: no mistakes, no help. */
const CLEAN = logOf([
  [1000, place(0, answer(0))],
  [2000, place(40, answer(40))],
  [3000, place(80, answer(80))],
]);

const SOURCE: CompareSource = {
  givens: puzzle.givens,
  difficulty: 'easy',
  puzzleName: 'Easy',
  mine: { log: MINE, seconds: 7 },
  theirs: { log: THEIRS.encoded, name: 'Dan', seconds: 9 },
};

function renderCompare(source: Partial<CompareSource> = {}) {
  const onClose = vi.fn();
  const view = render(<CompareDialog {...SOURCE} {...source} onClose={onClose} />);
  return { ...view, onClose };
}

const slider = () => screen.getByRole('slider', { name: 'Time' });
const board = () => screen.getByRole('table', { name: 'Sudoku board' });
const boardCell = (index: number) => within(board()).getAllByRole('cell')[index] as HTMLElement;
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(slider(), { key, ...init });
const svg = () => document.querySelector<SVGSVGElement>('.compare-chart__svg')!;

/** Lay the chart out `width` pixels wide from the page's left edge, as a browser would. */
function layOut(width = 320) {
  vi.spyOn(svg(), 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width,
    top: 0,
    height: 196,
    right: width,
    bottom: 196,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

/** The x a second sits at across a 320px chart (its plot from 30 to 308). */
const xOf = (second: number, maxSecond = 9) => 30 + (second / maxSecond) * 278;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CompareDialog', () => {
  it('heads the comparison with the two of you and your times', () => {
    renderCompare();
    const dialog = screen.getByRole('dialog', { name: 'You vs Dan' });
    expect(dialog.querySelector('h2 bdi, [class*="title"] bdi')).toHaveTextContent('Dan');
    expect(dialog).toHaveAccessibleDescription('Easy · You 0:07 · Dan 0:09');
  });

  it('names a friend whose link gave no name, and says a solve after watching has no time', () => {
    renderCompare({
      mine: { log: MINE, seconds: null },
      theirs: { log: THEIRS.encoded, name: null, seconds: 9 },
    });
    const dialog = screen.getByRole('dialog', { name: 'You vs your friend' });
    expect(dialog).toHaveAccessibleDescription('Easy · You: no time recorded · Your friend 0:09');
    expect(dialog.querySelector('bdi')).toBeNull();
  });

  it('opens on the chart, its cursor where the faster solve finished', () => {
    renderCompare();
    expect(slider()).toHaveFocus();
    expect(slider()).toHaveAttribute('aria-valuemin', '0');
    expect(slider()).toHaveAttribute('aria-valuemax', '9');
    expect(slider()).toHaveAttribute('aria-valuenow', '7');
    expect(slider()).toHaveAttribute(
      'aria-valuetext',
      '0:07 — You 3 cells, \u2068Dan\u2069 2 cells',
    );
    expect(document.querySelector('.compare-chart__readout')).toHaveTextContent(
      '0:07 — You 3 cells, Dan 2 cells',
    );
    // A count of one is one cell.
    press('ArrowLeft');
    expect(slider()).toHaveAttribute(
      'aria-valuetext',
      '0:06 — You 2 cells, \u2068Dan\u2069 1 cell',
    );
    expect(document.querySelector('.compare-chart__readout')).toHaveTextContent(
      '0:06 — You 2 cells, Dan 1 cell',
    );
  });

  it('moves the cursor a second with the arrows, ten with Page Up and Down, to either end with Home and End', () => {
    renderCompare();
    press('ArrowLeft');
    expect(slider()).toHaveAttribute('aria-valuenow', '6');
    press('ArrowDown');
    expect(slider()).toHaveAttribute('aria-valuenow', '5');
    press('ArrowRight');
    press('ArrowUp');
    expect(slider()).toHaveAttribute('aria-valuenow', '7');
    press('PageUp');
    expect(slider()).toHaveAttribute('aria-valuenow', '9');
    press('PageDown');
    expect(slider()).toHaveAttribute('aria-valuenow', '0');
    expect(slider()).toHaveAttribute(
      'aria-valuetext',
      '0:00 — You 0 cells, \u2068Dan\u2069 0 cells',
    );
    press('End');
    expect(slider()).toHaveAttribute('aria-valuenow', '9');
    press('Home');
    expect(slider()).toHaveAttribute('aria-valuenow', '0');
  });

  it('leaves other keys, and keys held with a modifier, alone', () => {
    renderCompare();
    expect(press('a')).toBe(true);
    expect(press('ArrowLeft', { ctrlKey: true })).toBe(true);
    expect(press('Home', { metaKey: true })).toBe(true);
    expect(press('End', { altKey: true })).toBe(true);
    expect(slider()).toHaveAttribute('aria-valuenow', '7');
    // A key it acts on is its own: nothing else hears it.
    expect(press('ArrowLeft')).toBe(false);
  });

  it('sets the cursor where the chart is pressed, and scrubs it while dragged', () => {
    renderCompare();
    layOut();
    fireEvent.pointerDown(slider(), { button: 0, clientX: xOf(2), pointerId: 1 });
    expect(slider()).toHaveAttribute('aria-valuenow', '2');
    expect(slider()).toHaveFocus();
    fireEvent.pointerMove(slider(), { clientX: xOf(4), pointerId: 1 });
    expect(slider()).toHaveAttribute('aria-valuenow', '4');
    // Past either end, it stops there.
    fireEvent.pointerMove(slider(), { clientX: 999, pointerId: 1 });
    expect(slider()).toHaveAttribute('aria-valuenow', '9');
    fireEvent.pointerUp(slider(), { pointerId: 1 });
    fireEvent.pointerMove(slider(), { clientX: xOf(1), pointerId: 1 });
    expect(slider()).toHaveAttribute('aria-valuenow', '9');
  });

  it('sets the cursor where a finger taps, and scrubs once it drags along the chart', () => {
    renderCompare();
    layOut();
    const touch = { pointerId: 7, pointerType: 'touch', button: 0 };
    // A finger landing leaves the cursor be until it shows what it is doing.
    fireEvent.pointerDown(slider(), { ...touch, clientX: xOf(2), clientY: 100 });
    expect(slider()).toHaveAttribute('aria-valuenow', '7');
    // A tremble is still a tap.
    fireEvent.pointerMove(slider(), { ...touch, clientX: xOf(2) + 3, clientY: 103 });
    expect(slider()).toHaveAttribute('aria-valuenow', '7');
    fireEvent.pointerUp(slider(), { ...touch, clientX: xOf(2), clientY: 100 });
    expect(slider()).toHaveAttribute('aria-valuenow', '2');
    expect(slider()).toHaveFocus();

    fireEvent.pointerDown(slider(), { ...touch, clientX: xOf(3), clientY: 100 });
    fireEvent.pointerMove(slider(), { ...touch, clientX: xOf(5), clientY: 104 });
    expect(slider()).toHaveAttribute('aria-valuenow', '5');
    fireEvent.pointerMove(slider(), { ...touch, clientX: xOf(6), clientY: 140 });
    expect(slider()).toHaveAttribute('aria-valuenow', '6');
    // Another finger is not this one.
    fireEvent.pointerMove(slider(), { ...touch, pointerId: 8, clientX: xOf(1) });
    expect(slider()).toHaveAttribute('aria-valuenow', '6');
    fireEvent.pointerUp(slider(), { ...touch, clientX: xOf(6), clientY: 140 });
    expect(slider()).toHaveAttribute('aria-valuenow', '6');
  });

  it('leaves the cursor where it was when a finger swipes up or down to scroll', () => {
    renderCompare();
    layOut();
    const touch = { pointerId: 3, pointerType: 'touch', button: 0 };
    fireEvent.pointerDown(slider(), { ...touch, clientX: xOf(1), clientY: 150 });
    fireEvent.pointerMove(slider(), { ...touch, clientX: xOf(1) + 4, clientY: 120 });
    // The browser takes the swipe for a scroll.
    fireEvent.pointerCancel(slider(), touch);
    fireEvent.pointerMove(slider(), { ...touch, clientX: xOf(3), clientY: 120 });
    expect(slider()).toHaveAttribute('aria-valuenow', '7');
    // A swipe the browser has not yet cancelled is no tap either.
    fireEvent.pointerDown(slider(), { ...touch, clientX: xOf(1), clientY: 150 });
    fireEvent.pointerMove(slider(), { ...touch, clientX: xOf(1), clientY: 100 });
    fireEvent.pointerMove(slider(), { ...touch, clientX: xOf(4), clientY: 100 });
    fireEvent.pointerUp(slider(), { ...touch, clientX: xOf(4), clientY: 100 });
    expect(slider()).toHaveAttribute('aria-valuenow', '7');
  });

  it('reads a press on a chart drawn at another size than measured, and ignores other buttons', () => {
    renderCompare();
    // Drawn 640px wide on screen: twice the 320 it was laid out at.
    layOut(640);
    fireEvent.pointerDown(slider(), { button: 2, clientX: 2 * xOf(3) });
    expect(slider()).toHaveAttribute('aria-valuenow', '7');
    fireEvent.pointerDown(slider(), { button: 0, clientX: 2 * xOf(3) });
    expect(slider()).toHaveAttribute('aria-valuenow', '3');
    fireEvent.pointerCancel(slider());
    fireEvent.pointerMove(slider(), { clientX: 2 * xOf(8) });
    expect(slider()).toHaveAttribute('aria-valuenow', '3');
    fireEvent.pointerDown(slider(), { button: 0, clientX: 2 * xOf(5) });
    fireEvent.lostPointerCapture(slider());
    fireEvent.pointerMove(slider(), { clientX: 2 * xOf(8) });
    expect(slider()).toHaveAttribute('aria-valuenow', '5');
  });

  it('reads a press with nothing laid out as at the size it was drawn', () => {
    renderCompare();
    // jsdom lays nothing out: no width to scale by.
    fireEvent.pointerDown(slider(), { button: 0, clientX: xOf(1) });
    expect(slider()).toHaveAttribute('aria-valuenow', '1');
  });

  it('overlays both solves on one board at the cursor: whose each number was, and what', () => {
    renderCompare();
    const given = puzzle.givens.indexOf(puzzle.givens.replace(/^0+/, '')[0]);
    expect(boardCell(given)).toHaveAccessibleName(`${puzzle.givens[given]}, given`);
    // 0:07: I have every cell; Dan has cells 0 and 40.
    expect(boardCell(0)).toHaveAccessibleName(`${answer(0)}, both of you`);
    expect(boardCell(40)).toHaveAccessibleName(`${answer(40)}, both of you`);
    expect(boardCell(80)).toHaveAccessibleName(`${answer(80)}, yours`);
    expect(boardCell(80)).toHaveClass('cell--compare', 'cell--compare-mine');

    // 0:04: my answer in cell 0 against Dan's wrong 6; my wrong number in 40.
    press('ArrowLeft');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(boardCell(0)).toHaveAccessibleName(`yours ${answer(0)}, \u2068Dan\u2069's 6`);
    expect(boardCell(0).querySelectorAll('.compare-digit')).toHaveLength(2);
    expect(boardCell(40)).toHaveAccessibleName(`${wrong(40)}, yours`);

    // 0:01: only Dan's wrong 6.
    press('ArrowLeft');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(boardCell(0)).toHaveAccessibleName("6, \u2068Dan\u2069's");
    expect(boardCell(0)).toHaveClass('cell--compare-theirs');
    expect(boardCell(40)).toHaveAccessibleName('empty');
    expect(boardCell(40).querySelector('.compare-digit')).toBeNull();
  });

  it('keys the board: both of you, you, your friend, and a number each', () => {
    renderCompare();
    const key = screen.getByRole('list', { name: 'Key to the board' });
    expect(
      within(key)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['5Both of you', '5You', '5Dan', '37Different']);
    expect(key.querySelector('bdi')).toHaveTextContent('Dan');
  });

  it('keys the chart: a line for each of you, and the marks', () => {
    renderCompare({ theirs: { log: THEIRS.encoded, name: null, seconds: 9 } });
    const legend = screen.getByRole('list', { name: 'Key to the chart' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['You', 'Your friend', 'Mistake', 'Help']);
  });

  it('labels each line at its end with who and their time', () => {
    renderCompare();
    const labels = [...document.querySelectorAll('.compare-chart__label text')].map(
      (text) => text.textContent,
    );
    expect(labels).toEqual(['You 0:07', '\u2068Dan\u2069 0:09']);
  });

  it('labels a line with no time with who alone, and cuts a long name short', () => {
    renderCompare({
      mine: { log: MINE, seconds: null },
      theirs: { log: THEIRS.encoded, name: 'Alexandra Featherstonehx', seconds: 9 },
    });
    const labels = [...document.querySelectorAll('.compare-chart__label text')].map(
      (text) => text.textContent,
    );
    expect(labels).toEqual(['You', '\u2068Alexandra F…\u2069 0:09']);
  });

  it('labels a friend with no name as your friend', () => {
    renderCompare({ theirs: { log: THEIRS.encoded, name: null, seconds: 9 } });
    expect(document.querySelectorAll('.compare-chart__label text')[1]).toHaveTextContent(
      'Your friend 0:09',
    );
  });

  it('marks the mistakes that counted and the help, filled for you and open for your friend', () => {
    renderCompare();
    const mine = svg().querySelectorAll('.compare-chart__shape--mine');
    const theirs = svg().querySelectorAll('.compare-chart__shape--theirs');
    // Mine: one mistake, and the end and cursor dots; theirs: a mistake, a
    // hint, and the two dots.
    expect(mine).toHaveLength(3);
    expect(theirs).toHaveLength(4);
    expect(svg().querySelectorAll('.compare-chart__halo')).toHaveLength(4);
    expect(svg().querySelector('.compare-chart__line--mine')).toHaveAttribute('d');
    expect(svg().querySelector('.compare-chart__line--theirs')).toHaveAttribute('d');
  });

  it('sets the faster line’s label beside its end dot where the labels would run into each other', () => {
    renderCompare();
    // At 320px the lines end 62px apart, closer than Dan's label is wide: mine
    // moves down beside my line's end, to its left, Dan's stays above his.
    const [mine, theirs] = document.querySelectorAll('.compare-chart__label');
    expect(mine).toHaveClass('compare-chart__label--beside');
    expect(mine.querySelector('text')).toHaveAttribute('text-anchor', 'end');
    expect(Number(mine.querySelector('text')!.getAttribute('x'))).toBeLessThan(xOf(7));
    expect(theirs).toHaveClass('compare-chart__label--above');
    expect(theirs.querySelector('text')).toHaveAttribute('x', String(xOf(9)));
    expect(document.querySelector('.compare-chart__leader')).toBeNull();
  });

  it('sets a label beside its end dot to the right where the chart has no room to its left', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80);
    renderCompare();
    const [mine] = document.querySelectorAll('.compare-chart__label');
    expect(mine).toHaveClass('compare-chart__label--beside');
    expect(mine.querySelector('text')).toHaveAttribute('text-anchor', 'start');
  });

  it('draws the friend’s open shapes over yours, so a spot you share shows both', () => {
    renderCompare();
    press('Home');
    // At 0:00 both cursor dots sit at 0 cells, one over the other.
    const dots = [...document.querySelectorAll('.compare-chart__cursor-dots path')].map((path) =>
      path.getAttribute('class'),
    );
    expect(dots).toEqual([
      'compare-chart__halo',
      'compare-chart__shape compare-chart__shape--mine',
      'compare-chart__shape compare-chart__shape--theirs',
    ]);
    const [, mine, theirs] = document.querySelectorAll('.compare-chart__cursor-dots path');
    expect(mine.getAttribute('d')).toBe(theirs.getAttribute('d'));
  });

  it('measures the chart, and draws it again as its width changes', () => {
    // Every observer's callback: the dialog's body has one of its own.
    const callbacks: (() => void)[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    const { unmount } = renderCompare();
    expect(svg()).toHaveAttribute('viewBox', '0 0 800 196');
    // Wide enough for both labels above where their lines end.
    expect(document.querySelectorAll('.compare-chart__label--above')).toHaveLength(2);
    width.mockReturnValue(360);
    act(() => callbacks.forEach((callback) => callback()));
    expect(svg()).toHaveAttribute('viewBox', '0 0 360 196');
    // As high as the stylesheet makes it: lower on a phone on its side.
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(140);
    act(() => callbacks.forEach((callback) => callback()));
    expect(svg()).toHaveAttribute('viewBox', '0 0 360 140');
    expect(svg()).toHaveAttribute('height', '140');
    // The same size measured again draws nothing new.
    const before = svg().innerHTML;
    act(() => callbacks.forEach((callback) => callback()));
    expect(svg().innerHTML).toBe(before);
    height.mockRestore();
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows the chart as a table on request: progress at intervals, and the mistakes and help', () => {
    renderCompare();
    const toggle = screen.getByRole('button', { name: 'Show as table' });
    // After the board and its key: never between the chart and the board.
    expect(
      screen.getByRole('list', { name: 'Key to the board' }).compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: /Cells solved/ })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Hide table');

    const progress = screen.getByRole('table', { name: 'Cells solved, of 3' });
    const rows = within(progress)
      .getAllByRole('row')
      .map((row) => row.textContent);
    expect(rows[0]).toBe('TimeYouDan');
    expect(rows.slice(1)).toEqual([
      '0:0000',
      '0:0100',
      '0:0210',
      '0:0310',
      '0:0420',
      '0:0521',
      '0:0621',
      '0:0732',
      '0:0832',
      '0:0933',
    ]);
    const events = screen.getByRole('table', { name: 'Mistakes and help' });
    expect(
      within(events)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(['0:01DanMistake', '0:03YouMistake', '0:06DanHint']);

    fireEvent.click(toggle);
    expect(screen.queryByRole('table', { name: /Cells solved/ })).toBeNull();
  });

  it('says so when neither of you made a mistake that counted or took a hint, check or reveal', () => {
    renderCompare({
      mine: { log: CLEAN, seconds: 3 },
      theirs: { log: CLEAN, name: null, seconds: 3 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.queryByRole('table', { name: 'Mistakes and help' })).toBeNull();
    expect(
      screen.getByText(
        'Neither of you made a mistake that counted, or took a hint, a check or a reveal.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('table', { name: 'Cells solved, of 3' })).toBeVisible();
    // The friend's column is headed "Your friend".
    expect(screen.getByRole('columnheader', { name: 'Your friend' })).toBeVisible();
  });

  it('says why when a solve cannot be played back, mine or the friend’s', () => {
    const { unmount } = renderCompare({ mine: { log: 'AB_', seconds: 7 } });
    expect(screen.getByText(REFUSAL_TEXT.broken)).toBeVisible();
    expect(screen.queryByRole('slider')).toBeNull();
    unmount();
    renderCompare({ theirs: { log: 'AB_', name: 'Dan', seconds: 9 } });
    expect(screen.getByText(REFUSAL_TEXT.broken)).toBeVisible();
  });

  it('closes with Escape and its close button', () => {
    const { onClose } = renderCompare();
    fireEvent.keyDown(slider(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
