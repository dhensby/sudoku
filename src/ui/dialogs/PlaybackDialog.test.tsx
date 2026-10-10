import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  LONGEST_PAUSE_MS,
  MOVES_VERSION,
  appendMove,
  createMoveLog,
  encodeMoveLog,
  type Digit,
} from '../../core';
import { logFromAnotherBuild } from '../../test/movePlayers';
import type { BoardSettings } from '../Board';
import { shortSolve } from '../testFixtures';
import { PlaybackDialog } from './PlaybackDialog';

/*
 * The short solve (see `shortSolve`): a wrong 6 in row 1, column 1 at 0:01,
 * counted, put right at 0:05; a hint about row 5, column 5 at 0:06; then 5
 * there at 0:07 and 9 in row 9, column 9 at 0:09, the solve.
 */
const SOLVE = shortSolve();

const SETTINGS: BoardSettings = {
  highlightRowColumn: true,
  highlightBox: true,
  highlightIdentical: true,
  highlightConflicts: true,
};

function renderPlayback(log: string = SOLVE.encoded) {
  const onClose = vi.fn();
  const view = render(
    <PlaybackDialog
      givens={SOLVE.puzzle.givens}
      difficulty="easy"
      log={log}
      title="Your solve"
      subtitle="Easy · 0:09"
      settings={SETTINGS}
      onClose={onClose}
    />,
  );
  return { ...view, onClose };
}

const dialog = () => screen.getByRole('dialog', { name: 'Your solve' });
const board = () => screen.getByRole('table', { name: 'Sudoku board' });
const boardCell = (index: number) => within(board()).getAllByRole('cell')[index] as HTMLElement;
const scrubber = () => screen.getByRole('slider', { name: 'Move' });
const caption = () => document.querySelector('.playback__caption')!;
const spoken = () => within(dialog()).getByRole('status');
const button = (name: string | RegExp) =>
  within(screen.getByRole('group', { name: 'Playback' })).getByRole('button', { name });

/** Press a key with focus where it is (on the dialog's own controls). */
function press(key: string, target: Element = document.activeElement!) {
  fireEvent.keyDown(target, { key });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PlaybackDialog', () => {
  it('heads the solve with whose it is and what it was', () => {
    renderPlayback();
    expect(dialog()).toHaveAccessibleDescription('Easy · 0:09');
    expect(dialog().querySelector('bdi')).toBeNull();
  });

  it('keeps a friend’s name from a link apart from the words after it', () => {
    render(
      <PlaybackDialog
        givens={SOLVE.puzzle.givens}
        difficulty="easy"
        log={SOLVE.encoded}
        title="سارة 2's solve"
        name="سارة 2"
        subtitle="Easy · 0:09"
        settings={SETTINGS}
        onClose={vi.fn()}
      />,
    );
    const heading = screen.getByRole('dialog', { name: "سارة 2's solve" });
    expect(heading.querySelector('.dialog__title bdi')).toHaveTextContent(/^سارة 2$/);
  });

  it('opens at the start, on Play, with the givens on a board that cannot be played', () => {
    renderPlayback();
    expect(button('Play')).toHaveFocus();
    expect(caption()).toHaveTextContent('Before the first move');
    expect(boardCell(0)).toHaveAccessibleName('empty');
    expect(boardCell(1)).toHaveAccessibleName('3, given');
    // A table of plain cells: nothing to press, focus or select.
    expect(within(dialog()).queryByRole('grid')).toBeNull();
    expect(within(board()).queryAllByRole('button')).toHaveLength(0);
    expect(board().querySelector('[tabindex]')).toBeNull();
    expect(board().querySelector('.cell--selected')).toBeNull();
  });

  it('steps a move at a time, outlining the move’s cell and captioning it', () => {
    renderPlayback();
    fireEvent.click(button('Forward a move'));
    expect(caption()).toHaveTextContent('6 in row 1, column 1 — a mistake');
    expect(boardCell(0)).toHaveAccessibleName('6, conflict');
    expect(boardCell(0)).toHaveClass('cell--current');
    expect(board().querySelectorAll('.cell--current')).toHaveLength(1);
    fireEvent.click(button('Forward a move'));
    fireEvent.click(button('Forward a move'));
    expect(caption()).toHaveTextContent('Hint: Full house in row 5');
    expect(boardCell(40)).toHaveClass('cell--current');
    fireEvent.click(button('Back a move'));
    expect(caption()).toHaveTextContent('5 in row 1, column 1');
    expect(boardCell(0)).toHaveAccessibleName('5');
  });

  it('jumps to the solve and back to the start', () => {
    renderPlayback();
    fireEvent.click(button('To the solve'));
    expect(caption()).toHaveTextContent('9 in row 9, column 9 — solved');
    expect(boardCell(80)).toHaveAccessibleName('9');
    fireEvent.click(button('To the start'));
    expect(caption()).toHaveTextContent('Before the first move');
    expect(boardCell(80)).toHaveAccessibleName('empty');
  });

  it('marks the buttons that would go past an end unavailable, keeping focus on them', () => {
    renderPlayback();
    expect(button('To the start')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Back a move')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Forward a move')).toHaveAttribute('aria-disabled', 'false');
    button('To the solve').focus();
    fireEvent.click(button('To the solve'));
    expect(button('To the solve')).toHaveAttribute('aria-disabled', 'true');
    expect(button('To the solve')).toHaveFocus();
    expect(button('To the solve')).toBeEnabled();
    // Pressed there, it does nothing.
    fireEvent.click(button('Forward a move'));
    expect(scrubber()).toHaveValue('5');
  });

  it('tells the scrubber’s place as the move and its time', () => {
    renderPlayback();
    expect(scrubber()).toHaveAttribute('min', '0');
    expect(scrubber()).toHaveAttribute('max', '5');
    expect(scrubber()).toHaveAttribute('aria-valuetext', 'Start, 0:00');
    fireEvent.change(scrubber(), { target: { value: '3' } });
    expect(scrubber()).toHaveAttribute('aria-valuetext', 'Move 3 of 5, 0:06');
    expect(caption()).toHaveTextContent('Hint: Full house in row 5');
  });

  it('shows the real play time at the move on show, and the solve’s', () => {
    renderPlayback();
    const time = () => document.querySelector('.playback__time')!;
    expect(time()).toHaveTextContent('Play time 0:00 / of 0:09');
    fireEvent.change(scrubber(), { target: { value: '2' } });
    expect(time()).toHaveTextContent('Play time 0:05 / of 0:09');
  });

  it('marks the mistake and the help along the scrubber, with a key to the marks', () => {
    renderPlayback();
    const ticks = document.querySelector('.playback__ticks')!;
    expect(ticks).toHaveAttribute('aria-hidden', 'true');
    const marks = [...ticks.querySelectorAll<HTMLElement>('.playback__tick')];
    expect(marks.map((mark) => [mark.className, mark.style.getPropertyValue('--at')])).toEqual([
      ['playback__tick playback__tick--mistake', '0.2'],
      ['playback__tick playback__tick--help', '0.6'],
    ]);
    const key = document.querySelector('.playback__key')!;
    expect(key).toHaveTextContent('MistakeHelp');
    expect(key).not.toHaveTextContent('Slip');
  });

  it('plays the solve through, a move after each pause, and offers to watch it again', () => {
    vi.useFakeTimers();
    renderPlayback();
    fireEvent.click(button('Play'));
    expect(button('Pause')).toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(caption()).toHaveTextContent('6 in row 1, column 1 — a mistake');
    // The moves played by themselves go unspoken…
    expect(spoken()).toBeEmptyDOMElement();
    for (const ms of [LONGEST_PAUSE_MS, 1000, 1000]) {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    }
    expect(spoken()).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(LONGEST_PAUSE_MS);
    });
    expect(caption()).toHaveTextContent('solved');
    expect(button('Watch again')).toHaveFocus();
    // …but getting to the solve is said, once.
    expect(spoken()).toHaveTextContent('9 in row 9, column 9 — solved');
    fireEvent.click(button('Watch again'));
    expect(caption()).toHaveTextContent('Before the first move');
    expect(button('Pause')).toBeInTheDocument();
  });

  it('plays at the speed chosen', () => {
    vi.useFakeTimers();
    renderPlayback();
    const speeds = screen.getByRole('group', { name: 'Speed' });
    expect(within(speeds).getByRole('radio', { name: '1×' })).toBeChecked();
    fireEvent.click(within(speeds).getByRole('radio', { name: '8×' }));
    expect(within(speeds).getByRole('radio', { name: '8×' })).toBeChecked();
    fireEvent.click(button('Play'));
    act(() => {
      vi.advanceTimersByTime(125);
    });
    expect(scrubber()).toHaveValue('1');
  });

  it('speaks the caption of a move taken by hand', () => {
    renderPlayback();
    fireEvent.click(button('Forward a move'));
    expect(spoken()).toHaveTextContent('6 in row 1, column 1 — a mistake');
    fireEvent.change(scrubber(), { target: { value: '5' } });
    expect(spoken()).toHaveTextContent('9 in row 9, column 9 — solved');
    // A press that goes nowhere says nothing new.
    fireEvent.click(button('Forward a move'));
    expect(spoken()).toHaveTextContent('9 in row 9, column 9 — solved');
  });

  it('says where it stopped when paused, and nothing as it starts', () => {
    vi.useFakeTimers();
    renderPlayback();
    fireEvent.click(button('Play'));
    expect(spoken()).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(button('Pause'));
    expect(spoken()).toHaveTextContent('6 in row 1, column 1 — a mistake');
    // And again with Space, a move on.
    press(' ', dialog());
    act(() => {
      vi.advanceTimersByTime(LONGEST_PAUSE_MS);
    });
    press(' ', dialog());
    expect(spoken()).toHaveTextContent(`${SOLVE.puzzle.solution[0]} in row 1, column 1`);
  });

  describe('the keys', () => {
    it('step with Left and Right, and jump with Home and End', () => {
      renderPlayback();
      press('ArrowRight');
      press('ArrowRight');
      expect(scrubber()).toHaveValue('2');
      press('ArrowLeft');
      expect(scrubber()).toHaveValue('1');
      press('End');
      expect(scrubber()).toHaveValue('5');
      press('Home');
      expect(scrubber()).toHaveValue('0');
      expect(spoken()).toHaveTextContent('Before the first move');
    });

    it('play and pause with Space, off a button', () => {
      renderPlayback();
      press(' ', dialog());
      expect(button('Pause')).toBeInTheDocument();
      press(' ', scrubber());
      expect(button('Play')).toBeInTheDocument();
    });

    it('take a held Space as one press, not a flicker between playing and paused', () => {
      renderPlayback();
      press(' ', dialog());
      for (let i = 0; i < 3; i++) {
        const event = new KeyboardEvent('keydown', {
          key: ' ',
          repeat: true,
          bubbles: true,
          cancelable: true,
        });
        dialog().dispatchEvent(event);
        // Still claimed, so the page does not scroll.
        expect(event.defaultPrevented).toBe(true);
      }
      expect(button('Pause')).toBeInTheDocument();
    });

    it('leave Space to the button it presses, and the arrows and ends to the scrubber', () => {
      renderPlayback();
      // Space on a button is the button's: the browser clicks it.
      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      button('Forward a move').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(button('Play')).toBeInTheDocument();
      for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        press(key, scrubber());
        expect(scrubber()).toHaveValue('0');
      }
    });

    it('leave the arrows and Space to the speeds', () => {
      renderPlayback();
      const radio = screen.getByRole('radio', { name: '2×' });
      press('ArrowRight', radio);
      press(' ', radio);
      expect(scrubber()).toHaveValue('0');
      expect(button('Play')).toBeInTheDocument();
    });

    it('leave keys with a modifier, or claimed already, alone', () => {
      renderPlayback();
      fireEvent.keyDown(dialog(), { key: 'ArrowRight', ctrlKey: true });
      fireEvent.keyDown(dialog(), { key: 'ArrowRight', altKey: true });
      fireEvent.keyDown(dialog(), { key: 'ArrowRight', metaKey: true });
      const claimed = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      claimed.preventDefault();
      dialog().dispatchEvent(claimed);
      fireEvent.keyDown(dialog(), { key: 'x' });
      expect(scrubber()).toHaveValue('0');
    });

    it('stop listening when the dialog goes', () => {
      const { unmount } = renderPlayback();
      const node = dialog();
      unmount();
      expect(() => fireEvent.keyDown(node, { key: 'ArrowRight' })).not.toThrow();
    });

    it('still close the dialog with Escape', () => {
      const { onClose } = renderPlayback();
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows no key when the solve took no help and made no mistakes', () => {
    // The three answers placed straight off: nothing to mark.
    let log = createMoveLog();
    for (const [i, cell] of [0, 40, 80].entries()) {
      const digit = Number(SOLVE.puzzle.solution[cell]) as Digit;
      log = appendMove(log, { op: 'place', cell, digit, clearPeerNotes: false }, (i + 1) * 1000);
    }
    renderPlayback(encodeMoveLog(log));
    expect(document.querySelector('.playback__ticks')).toBeEmptyDOMElement();
    expect(document.querySelector('.playback__key')).toBeNull();
  });

  it.each([
    [logFromAnotherBuild(0, 0), /older version/],
    [logFromAnotherBuild(MOVES_VERSION + 1, 0), /newer version/],
    ['not a log!', /damaged/],
  ])('says why a log it cannot play back cannot be: %s', (log, text) => {
    renderPlayback(log);
    expect(within(dialog()).getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(dialog()).toHaveAccessibleDescription('Easy · 0:09');
  });
});
