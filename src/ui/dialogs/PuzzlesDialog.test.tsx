import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { puzzleFromGivens } from '../../core';
import { deletePuzzle, retitlePuzzle, type SavedPuzzle } from '../../storage/puzzles';
import { HARDEST } from '../../test/logic-fixtures';
import { PuzzlesDialog, type PuzzlesDialogProps } from './PuzzlesDialog';

/** 14:30 local on 12 Oct 2026 — local, because the dialog dates puzzles in local time. */
const NOW = new Date(2026, 9, 12, 14, 30).getTime();
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).getTime();

const HARD = HARDEST.nakedPair.givens;

/** As stored: the latest first saved first. */
const PUZZLES: readonly SavedPuzzle[] = [
  // Ready to play, named — right to left.
  {
    id: 'ready-0001',
    cells: HARD,
    title: 'סודוקו',
    createdAt: at(12, 9, 12),
    updatedAt: at(12, 9, 12),
  },
  // Half typed in, unnamed.
  {
    id: 'half-0001',
    cells: HARD.slice(0, 30).padEnd(81, '0'),
    createdAt: at(11, 21, 40),
    updatedAt: at(12, 10, 0),
  },
  // A clash, named.
  {
    id: 'clash-001',
    cells: '55'.padEnd(81, '0'),
    title: 'Guardian 4,201',
    createdAt: at(3, 8, 0),
    updatedAt: at(3, 8, 0),
  },
];

function renderPuzzles(overrides: Partial<PuzzlesDialogProps> = {}) {
  const props: PuzzlesDialogProps = {
    puzzles: PUZZLES,
    onNew: vi.fn(),
    onPlay: vi.fn(),
    onShare: vi.fn(),
    onEdit: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<PuzzlesDialog {...props} />);
  return { ...view, props };
}

/**
 * Your puzzles as the app holds it: a rename or a delete changes the list it
 * is given, in the same render as the dialog's own — so the rows have
 * redrawn by the time focus follows them.
 */
function renderLive() {
  const onRename = vi.fn();
  const onDelete = vi.fn();
  function Live() {
    const [puzzles, setPuzzles] = useState(PUZZLES);
    return (
      <PuzzlesDialog
        puzzles={puzzles}
        onNew={vi.fn()}
        onPlay={vi.fn()}
        onShare={vi.fn()}
        onEdit={vi.fn()}
        onClose={vi.fn()}
        onRename={(id, title) => {
          onRename(id, title);
          setPuzzles((list) => retitlePuzzle(list, id, title, NOW));
        }}
        onDelete={(id) => {
          onDelete(id);
          setPuzzles((list) => deletePuzzle(list, id));
        }}
      />
    );
  }
  render(<Live />);
  return { onRename, onDelete };
}

const dialog = () => screen.getByRole('dialog', { name: 'Your puzzles' });
const list = () => screen.getByRole('list', { name: 'Your puzzles, latest first' });
const rows = () => within(list()).getAllByRole('listitem');
const row = (id: string) => list().querySelector<HTMLElement>(`[data-puzzle="${id}"]`)!;
const newPuzzle = () => screen.getByRole('button', { name: 'Enter a new puzzle' });
const status = () => dialog().querySelector('[role="status"]')!;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PuzzlesDialog', () => {
  it('opens on Enter a new puzzle, which opens the editor', () => {
    const { props } = renderPuzzles();
    expect(newPuzzle()).toHaveFocus();
    expect(newPuzzle()).toHaveClass('button--primary');
    fireEvent.click(newPuzzle());
    expect(props.onNew).toHaveBeenCalledOnce();
    // No footer: the list is everything.
    expect(dialog().querySelector('.dialog__footer')).toBeNull();
  });

  it('says what will be there while there is nothing yet', () => {
    renderPuzzles({ puzzles: [] });
    expect(screen.queryByRole('list')).toBeNull();
    expect(dialog()).toHaveTextContent(
      'No puzzles yet — the ones you enter will appear here, finished or not.',
    );
    expect(newPuzzle()).toHaveFocus();
  });

  it('lists every puzzle kept as stored, each named, dated and said in the editor’s words', () => {
    renderPuzzles();
    expect(
      rows().map((item) => [
        item.querySelector('.puzzles-item__name')?.textContent,
        item.querySelector('.history-item__date')?.textContent,
        item.querySelector('.history-item__status')?.textContent,
      ]),
    ).toEqual([
      ['סודוקו', 'Today 09:12', 'One solution: a Hard puzzle.'],
      ['Untitled puzzle', 'Yesterday 21:40', 'A puzzle needs at least 17 numbers.'],
      ['Guardian 4,201', '3 Oct', 'Two 5s in row 1.'],
    ]);
  });

  it('keeps each name in its own direction, and an unnamed one’s words out of it', () => {
    renderPuzzles();
    expect(row('ready-0001').querySelector('.puzzles-item__name bdi')).toHaveTextContent('סודוקו');
    expect(row('half-0001').querySelector('bdi')).toBeNull();
  });

  it('offers Play first, and Share, for a puzzle ready to play, and Edit first for one that is not', () => {
    renderPuzzles();
    const names = (id: string) =>
      within(row(id))
        .getAllByRole('button')
        .map((button) => [button.textContent, button.classList.contains('button--primary')]);
    expect(names('ready-0001')).toEqual([
      ['Play', true],
      ['Share', false],
      ['Edit', false],
      ['Rename', false],
      ['Delete', false],
    ]);
    expect(names('half-0001')).toEqual([
      ['Edit', true],
      ['Rename', false],
      ['Delete', false],
    ]);
  });

  it('names each button with its row, so it makes sense read alone', () => {
    renderPuzzles();
    expect(
      within(list())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Play סודוקו, from Today 09:12',
      'Share סודוקו, from Today 09:12',
      'Edit סודוקו, from Today 09:12',
      'Rename סודוקו, from Today 09:12',
      'Delete סודוקו, from Today 09:12',
      'Edit untitled puzzle from Yesterday 21:40',
      'Rename untitled puzzle from Yesterday 21:40',
      'Delete untitled puzzle from Yesterday 21:40',
      'Edit Guardian 4,201, from 3 Oct',
      'Rename Guardian 4,201, from 3 Oct',
      'Delete Guardian 4,201, from 3 Oct',
    ]);
  });

  it('plays and shares a row’s puzzle as it is graded, and opens a row in the editor', () => {
    const { props } = renderPuzzles();
    fireEvent.click(within(row('ready-0001')).getByRole('button', { name: /^Play/ }));
    const checked = puzzleFromGivens(HARD);
    expect(props.onPlay).toHaveBeenCalledExactlyOnceWith(checked.ok && checked.puzzle);
    fireEvent.click(within(row('ready-0001')).getByRole('button', { name: /^Share/ }));
    expect(props.onShare).toHaveBeenCalledExactlyOnceWith(
      'ready-0001',
      checked.ok && checked.puzzle,
    );
    fireEvent.click(within(row('half-0001')).getByRole('button', { name: /^Edit/ }));
    expect(props.onEdit).toHaveBeenCalledExactlyOnceWith(PUZZLES[1]);
  });

  it('opens on the Edit of the row the editor was open on, back from it', () => {
    renderPuzzles({ place: { id: 'clash-001', control: 'edit' } });
    expect(within(row('clash-001')).getByRole('button', { name: /^Edit/ })).toHaveFocus();
    expect(newPuzzle()).not.toHaveAttribute('data-autofocus');
  });

  it('opens on the Share of the row shared, back from Share', () => {
    renderPuzzles({ place: { id: 'ready-0001', control: 'share' } });
    expect(within(row('ready-0001')).getByRole('button', { name: /^Share/ })).toHaveFocus();
    expect(dialog().querySelectorAll('[data-autofocus]')).toHaveLength(1);
  });

  it('closes from its close button and on Escape', () => {
    const { props } = renderPuzzles();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  describe('renaming', () => {
    const field = () => screen.getByRole('textbox', { name: 'Name' });

    function open(id: string) {
      fireEvent.click(within(row(id)).getByRole('button', { name: /^Rename/ }));
    }

    it('opens in place of the row’s buttons, its name focused and selected', () => {
      renderPuzzles();
      open('clash-001');
      const group = within(row('clash-001')).getByRole('group', {
        name: 'Rename Guardian 4,201, from 3 Oct',
      });
      expect(within(group).getByRole('textbox')).toBe(field());
      expect(field()).toHaveValue('Guardian 4,201');
      expect(field()).toHaveFocus();
      const input = field() as HTMLInputElement;
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 14]);
      expect(field()).toHaveAccessibleDescription('Leave it empty for none.');
      expect(field()).toHaveAttribute('maxLength', '80');
      expect(within(row('clash-001')).queryByRole('button', { name: /^Edit/ })).toBeNull();
    });

    it('starts from nothing for an unnamed puzzle', () => {
      renderPuzzles();
      open('half-0001');
      expect(field()).toHaveValue('');
    });

    it('saves on Enter, focus back on the row’s Rename under its new name, and says so', () => {
      const { onRename } = renderLive();
      open('half-0001');
      fireEvent.change(field(), { target: { value: '  The Times\t#5,123 ' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      expect(onRename).toHaveBeenCalledExactlyOnceWith('half-0001', '  The Times\t#5,123 ');
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(
        within(row('half-0001')).getByRole('button', {
          name: 'Rename The Times #5,123, from Yesterday 21:40',
        }),
      ).toHaveFocus();
      expect(status()).toHaveTextContent(/^Renamed: The Times #5,123\.$/);
      // Its place in the list is where it was.
      expect(rows()[1]).toBe(row('half-0001'));
    });

    it('takes a name off with an empty one, and says so', () => {
      const { onRename } = renderLive();
      open('ready-0001');
      fireEvent.change(field(), { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: /^Save name/ }));
      expect(onRename).toHaveBeenCalledExactlyOnceWith('ready-0001', '   ');
      expect(row('ready-0001').querySelector('.puzzles-item__name')).toHaveTextContent(
        'Untitled puzzle',
      );
      expect(
        within(row('ready-0001')).getByRole('button', { name: /^Rename untitled puzzle/ }),
      ).toHaveFocus();
      expect(status()).toHaveTextContent(/^Name cleared\.$/);
    });

    it('backs out on Escape without closing the dialog, focus back on Rename', () => {
      const { props } = renderPuzzles();
      open('ready-0001');
      fireEvent.keyDown(field(), { key: 'Escape' });
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(props.onClose).not.toHaveBeenCalled();
      expect(props.onRename).not.toHaveBeenCalled();
      expect(within(row('ready-0001')).getByRole('button', { name: /^Rename/ })).toHaveFocus();
    });

    it('opens one row at a time', () => {
      renderPuzzles();
      open('ready-0001');
      open('clash-001');
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(field()).toHaveValue('Guardian 4,201');
    });
  });

  describe('deleting', () => {
    function request(id: string) {
      fireEvent.click(within(row(id)).getByRole('button', { name: /^Delete/ }));
    }

    it('asks first, in place of the row’s buttons, on Cancel', () => {
      const { props } = renderPuzzles();
      request('half-0001');
      const group = within(row('half-0001')).getByRole('group', {
        name: 'Delete untitled puzzle from Yesterday 21:40?',
      });
      expect(
        within(group)
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label')),
      ).toEqual([
        'Confirm delete, untitled puzzle from Yesterday 21:40',
        'Cancel deleting untitled puzzle from Yesterday 21:40',
      ]);
      expect(within(group).getByRole('button', { name: /^Cancel/ })).toHaveFocus();
      expect(props.onDelete).not.toHaveBeenCalled();
    });

    it.each(['Cancel', 'Escape'])('backs out with %s, focus back on Delete', (how) => {
      const { props } = renderPuzzles();
      request('clash-001');
      const cancel = within(row('clash-001')).getByRole('button', { name: /^Cancel/ });
      if (how === 'Cancel') fireEvent.click(cancel);
      else fireEvent.keyDown(cancel, { key: 'Escape' });
      expect(within(row('clash-001')).getByRole('button', { name: /^Delete/ })).toHaveFocus();
      expect(props.onDelete).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
    });

    it('deletes on Confirm, focus going to Enter a new puzzle', () => {
      const { onDelete } = renderLive();
      request('ready-0001');
      fireEvent.click(screen.getByRole('button', { name: /^Confirm delete/ }));
      expect(onDelete).toHaveBeenCalledExactlyOnceWith('ready-0001');
      expect(rows()).toHaveLength(2);
      expect(newPuzzle()).toHaveFocus();
    });
  });
});
