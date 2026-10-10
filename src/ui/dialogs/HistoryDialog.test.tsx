import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { formatGrid, parseGrid } from '../../core';
import type { GameRecord } from '../../storage/history';
import { WIKIPEDIA_PUZZLE } from '../../test/grids';
import { HistoryDialog, type HistoryDialogProps } from './HistoryDialog';

const GIVENS = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
const NONE = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
/** 14:30 local on 12 Oct 2026 — local, because the dialog dates records in local time. */
const NOW = new Date(2026, 9, 12, 14, 30).getTime();
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).getTime();

function record(id: string, overrides: Partial<GameRecord>): GameRecord {
  return {
    id,
    givens: GIVENS,
    difficulty: 'hard',
    source: 'generated',
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    status: 'playing',
    elapsedMs: 130_000,
    assists: NONE,
    challenge: null,
    ...overrides,
  };
}

/** Newest first, as loadHistory returns them. */
const RECORDS: GameRecord[] = [
  record('cur', { difficulty: 'expert', createdAt: at(12, 14, 20), elapsedMs: 61_000 }),
  record('won', {
    createdAt: at(12, 14, 5),
    status: 'solved',
    completedAt: at(12, 14, 11),
    elapsedMs: 323_400,
    assists: { autoCandidates: true, hints: 2, checks: 1, reveals: 0 },
    challenge: { name: 'Dan', seconds: 323, assists: NONE },
  }),
  record('easy', { difficulty: 'easy', createdAt: at(12, 13, 0), elapsedMs: 130_000 }),
  record('lost', { difficulty: 'medium', createdAt: at(11, 9, 12) }),
  record('peek', {
    createdAt: at(10, 18, 0),
    status: 'solved',
    completedAt: at(10, 18, 30),
    elapsedMs: 200_000,
    assists: { ...NONE, reveals: 1 },
    challenge: { name: null, seconds: 400, assists: { ...NONE, autoCandidates: true, hints: 1 } },
  }),
];

function renderHistory(overrides: Partial<HistoryDialogProps> = {}) {
  const props: HistoryDialogProps = {
    records: RECORDS,
    currentId: 'cur',
    resumableIds: new Set(['cur', 'easy']),
    now: NOW,
    onResume: vi.fn(),
    onReplay: vi.fn(),
    onShare: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(() => '{"app":"sudoku"}'),
    onImport: vi.fn(() => ({ ok: true as const, added: 3, updated: 1 })),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<HistoryDialog {...props} />);
  return { ...view, props };
}

const dialog = () => screen.getByRole('dialog', { name: 'History' });
const list = () => screen.getByRole('list', { name: 'Games, newest first' });
const rows = () =>
  within(list())
    .getAllByRole('listitem')
    .filter((li) => li.parentElement === list());
const tab = (name: string) => screen.getByRole('tab', { name });
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;

describe('HistoryDialog', () => {
  describe('with no games', () => {
    it('says what will appear, and still offers an import', () => {
      renderHistory({ records: [], currentId: null });
      expect(dialog()).toHaveTextContent(
        'No games yet — your finished and unfinished puzzles will appear here.',
      );
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
    });
  });

  describe('the list', () => {
    it('shows every game, newest first, as it was given', () => {
      renderHistory();
      expect(rows().map((row) => row.querySelector('.history-item__date')?.textContent)).toEqual([
        'Today 14:20',
        'Today 14:05',
        'Today 13:00',
        'Yesterday 09:12',
        '10 Oct',
      ]);
    });

    it('describes a finished game: tier, time, help, and the time it was raced against', () => {
      renderHistory();
      const row = rows()[1];
      expect(row).toHaveTextContent('Hard');
      expect(row).toHaveTextContent('Solved in 5:23');
      expect(
        within(within(row).getByRole('list', { name: 'Help used' }))
          .getAllByRole('listitem')
          .map((chip) => chip.textContent),
      ).toEqual(['Auto candidates', '2 hints', '1 check']);
      expect(row).toHaveTextContent('vs Dan 5:23');
      // The challenger's name is a stranger's free text: kept in its own direction.
      expect(within(row).getByText('Dan').tagName).toBe('BDI');
    });

    it('describes an unfinished game, and an anonymous challenger', () => {
      renderHistory();
      expect(rows()[2]).toHaveTextContent('In progress · 2:10');
      expect(within(rows()[2]).queryByRole('list', { name: 'Help used' })).toBeNull();
      expect(rows()[4]).toHaveTextContent('1 reveal');
      expect(rows()[4]).toHaveTextContent('vs your friend 6:40');
    });

    it("adds the challenger's help to their time, and nothing for an unaided one", () => {
      renderHistory();
      // Under the time it qualifies, apart from the chips, which are this game's own help.
      const help = within(rows()[4]).getByText('With auto candidates, 1 hint');
      expect(help.closest('.history-item__challenge')).toHaveTextContent(
        'vs your friend 6:40 With auto candidates, 1 hint',
      );
      expect(help.closest('ul')).toBeNull();
      expect(within(rows()[1]).queryByText(/^With /)).toBeNull();
    });

    it('marks the game on screen as current', () => {
      renderHistory();
      expect(within(rows()[0]).getByText('Current')).toBeInTheDocument();
      expect(rows().filter((row) => within(row).queryByText('Current'))).toHaveLength(1);
    });

    it('offers Resume only for a saved, unfinished game that is not already on screen', () => {
      renderHistory();
      const resumes = screen.getAllByRole('button', { name: /^Resume / });
      // Not "cur" (on screen), not the solved games, not "lost" (nothing saved).
      expect(resumes.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Resume Easy puzzle from Today 13:00',
      ]);
    });

    it('offers Play again only for a solved game, or an unfinished one with nothing saved', () => {
      renderHistory();
      const replays = screen.getAllByRole('button', { name: /^Play again, / });
      // Not "cur" (on screen, still being played), not "easy" (Resume does
      // that); "lost" has no saved board, so it can only begin again.
      expect(replays.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Play again, Hard puzzle from Today 14:05',
        'Play again, Medium puzzle from Yesterday 09:12',
        'Play again, Hard puzzle from 10 Oct',
      ]);
    });

    it('offers neither Resume nor Play again on the game on screen while it is being played', () => {
      renderHistory();
      expect(within(rows()[0]).queryByRole('button', { name: /^(Resume|Play again)/ })).toBeNull();
      expect(within(rows()[0]).getByRole('button', { name: /^Share / })).toBeInTheDocument();
    });

    it('offers Play again on the game on screen once it is solved', () => {
      renderHistory({ currentId: 'won' });
      expect(
        within(rows()[1]).getByRole('button', { name: 'Play again, Hard puzzle from Today 14:05' }),
      ).toBeInTheDocument();
    });

    it('names every row action after its game, so a list of buttons makes sense alone', () => {
      const { props } = renderHistory();
      fireEvent.click(screen.getByRole('button', { name: 'Resume Easy puzzle from Today 13:00' }));
      expect(props.onResume).toHaveBeenCalledExactlyOnceWith('easy');
      fireEvent.click(
        screen.getByRole('button', { name: 'Play again, Medium puzzle from Yesterday 09:12' }),
      );
      expect(props.onReplay).toHaveBeenCalledExactlyOnceWith('lost');
      fireEvent.click(screen.getByRole('button', { name: 'Share Hard puzzle from 10 Oct' }));
      expect(props.onShare).toHaveBeenCalledExactlyOnceWith('peek');
    });
  });

  describe('deleting', () => {
    const deleteButton = (context: string) =>
      screen.getByRole('button', { name: `Delete ${context}` });

    it('asks within the row first, with focus on the safe choice', () => {
      const { props } = renderHistory();
      fireEvent.click(deleteButton('Medium puzzle from Yesterday 09:12'));
      expect(props.onDelete).not.toHaveBeenCalled();
      const group = screen.getByRole('group', {
        name: 'Delete Medium puzzle from Yesterday 09:12?',
      });
      expect(within(group).getByRole('button', { name: /^Confirm delete/ })).toBeInTheDocument();
      // Focus must not fall to the page as the Delete button goes.
      expect(within(group).getByRole('button', { name: /^Cancel/ })).toHaveFocus();
      // The rest of the row's actions step aside while it asks.
      expect(
        screen.queryByRole('button', { name: 'Play again, Medium puzzle from Yesterday 09:12' }),
      ).toBeNull();
    });

    it('goes back to the row, and to its Delete button, on Cancel', () => {
      const { props } = renderHistory();
      fireEvent.click(deleteButton('Medium puzzle from Yesterday 09:12'));
      fireEvent.click(
        screen.getByRole('button', { name: 'Cancel deleting Medium puzzle from Yesterday 09:12' }),
      );
      expect(props.onDelete).not.toHaveBeenCalled();
      expect(deleteButton('Medium puzzle from Yesterday 09:12')).toHaveFocus();
    });

    it('backs out on Escape without closing the dialog', () => {
      const { props } = renderHistory();
      fireEvent.click(deleteButton('Medium puzzle from Yesterday 09:12'));
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(props.onClose).not.toHaveBeenCalled();
      expect(deleteButton('Medium puzzle from Yesterday 09:12')).toHaveFocus();
      // Once out of the confirmation, Escape closes as usual.
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('ignores other keys on the confirmation', () => {
      renderHistory();
      fireEvent.click(deleteButton('Medium puzzle from Yesterday 09:12'));
      const confirm = screen.getByRole('button', { name: /^Confirm delete/ });
      fireEvent.keyDown(confirm, { key: 'Enter' });
      expect(confirm).toBeInTheDocument();
    });

    it('deletes on confirmation, handing focus to the filter', () => {
      const { props } = renderHistory();
      fireEvent.click(deleteButton('Medium puzzle from Yesterday 09:12'));
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirm delete, Medium puzzle from Yesterday 09:12' }),
      );
      expect(props.onDelete).toHaveBeenCalledExactlyOnceWith('lost');
      expect(tab('All')).toHaveFocus();
    });

    it('hands focus to Import when the last game goes, since the filter goes with it', () => {
      const only = [RECORDS[3]];
      renderHistory({ records: only });
      fireEvent.click(deleteButton('Medium puzzle from Yesterday 09:12'));
      fireEvent.click(screen.getByRole('button', { name: /^Confirm delete/ }));
      expect(screen.getByRole('button', { name: 'Import' })).toHaveFocus();
    });

    it('asks about one row at a time, and keeps focus on the newest question', () => {
      renderHistory();
      // The later row first, then an earlier one: the row that stops asking
      // must not pull focus back to its own Delete button.
      fireEvent.click(deleteButton('Hard puzzle from 10 Oct'));
      fireEvent.click(deleteButton('Hard puzzle from Today 14:05'));
      expect(screen.getAllByRole('button', { name: /^Confirm delete/ })).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: 'Cancel deleting Hard puzzle from Today 14:05' }),
      ).toHaveFocus();
      expect(deleteButton('Hard puzzle from 10 Oct')).toBeInTheDocument();
    });

    it('drops a pending confirmation when the filter changes', () => {
      renderHistory();
      fireEvent.click(deleteButton('Hard puzzle from 10 Oct'));
      fireEvent.click(tab('Hard'));
      expect(screen.queryByRole('button', { name: /^Confirm delete/ })).toBeNull();
    });
  });

  describe('filtering', () => {
    it('opens on All, with a stats row for every tier', () => {
      renderHistory();
      expect(tab('All')).toHaveAttribute('aria-selected', 'true');
      const table = screen.getByRole('table', { name: 'Stats by level' });
      const hard = within(table).getByRole('row', { name: /^Hard/ });
      // Two Hard games, both solved; the one with a reveal never counts for
      // best or average.
      expect(
        within(hard)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ).toEqual(['2', '2', '5:23', '5:23']);
      const easy = within(table).getByRole('row', { name: /^Easy/ });
      expect(
        within(easy)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ).toEqual(['1', '0', '—', '—']);
      expect(rows()).toHaveLength(5);
    });

    it('narrows the list and the stats to one tier', () => {
      renderHistory();
      fireEvent.click(tab('Hard'));
      expect(tab('Hard')).toHaveAttribute('aria-selected', 'true');
      expect(tab('All')).toHaveAttribute('aria-selected', 'false');
      expect(rows()).toHaveLength(2);
      expect(screen.queryByRole('table')).toBeNull();
      const stats = screen.getByRole('region', { name: 'Hard stats' });
      expect(within(stats).getByText('Played').nextElementSibling).toHaveTextContent('2');
      expect(within(stats).getByText('Solved').nextElementSibling).toHaveTextContent('2');
      expect(within(stats).getByText('Best').nextElementSibling).toHaveTextContent('5:23');
      expect(within(stats).getByText('Average').nextElementSibling).toHaveTextContent('5:23');
      expect(screen.getByRole('tabpanel', { name: 'Hard' })).toContainElement(list());
    });

    it('says so when a tier has no games', () => {
      renderHistory({ records: RECORDS.filter((r) => r.difficulty !== 'medium') });
      fireEvent.click(tab('Medium'));
      expect(screen.getByRole('tabpanel')).toHaveTextContent('No Medium games yet.');
      expect(screen.queryByRole('list', { name: 'Games, newest first' })).toBeNull();
    });

    it('is one tab stop, moved along by the arrow keys, Home and End', () => {
      renderHistory();
      expect(tab('All')).toHaveAttribute('tabindex', '0');
      expect(tab('Easy')).toHaveAttribute('tabindex', '-1');

      tab('All').focus();
      fireEvent.keyDown(tab('All'), { key: 'ArrowRight' });
      expect(tab('Easy')).toHaveFocus();
      expect(tab('Easy')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Easy')).toHaveAttribute('tabindex', '0');

      fireEvent.keyDown(tab('Easy'), { key: 'ArrowLeft' });
      expect(tab('All')).toHaveFocus();
      // Wraps at both ends.
      fireEvent.keyDown(tab('All'), { key: 'ArrowLeft' });
      expect(tab('Expert')).toHaveFocus();
      fireEvent.keyDown(tab('Expert'), { key: 'ArrowRight' });
      expect(tab('All')).toHaveFocus();

      fireEvent.keyDown(tab('All'), { key: 'End' });
      expect(tab('Expert')).toHaveFocus();
      fireEvent.keyDown(tab('Expert'), { key: 'Home' });
      expect(tab('All')).toHaveFocus();
    });

    it('leaves other keys to the browser', () => {
      renderHistory();
      expect(fireEvent.keyDown(tab('All'), { key: 'a' })).toBe(true);
      expect(tab('All')).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('export', () => {
    it('marks Export and Import with download and upload icons, names unchanged', () => {
      renderHistory();
      const icon = (name: string) => screen.getByRole('button', { name }).querySelector('svg');
      expect(icon('Export')).toHaveAttribute('aria-hidden', 'true');
      expect(icon('Import')).toHaveAttribute('aria-hidden', 'true');
      expect(icon('Export')?.innerHTML).not.toBe(icon('Import')?.innerHTML);
    });
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('downloads the export as a dated JSON file, then lets the blob go', async () => {
      let blob: Blob | undefined;
      const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
        blob = value as Blob;
        return 'blob:history';
      });
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const clicked: HTMLAnchorElement[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        // Followed while in the document: Firefox ignores a detached link.
        expect(this.isConnected).toBe(true);
        clicked.push(this);
      });

      const { props } = renderHistory();
      fireEvent.click(screen.getByRole('button', { name: 'Export' }));

      expect(props.onExport).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledOnce();
      expect(blob?.type).toBe('application/json');
      expect(await blob?.text()).toBe('{"app":"sudoku"}');
      expect(clicked).toHaveLength(1);
      expect(clicked[0].download).toBe('sudoku-history-2026-10-12.json');
      expect(clicked[0].getAttribute('href')).toBe('blob:history');
      expect(clicked[0].isConnected).toBe(false);

      // Not revoked in the same breath as the click, which can cancel the download.
      expect(revoke).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:history');
    });
  });

  describe('import', () => {
    const choose = async (file?: File) => {
      await act(async () => {
        fireEvent.change(fileInput(), { target: { files: file ? [file] : [] } });
      });
    };
    const json = (text: string) => new File([text], 'history.json', { type: 'application/json' });

    it('opens the file picker from the Import button, for JSON files', () => {
      renderHistory();
      const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      expect(click).toHaveBeenCalledOnce();
      expect(fileInput()).toHaveAttribute('accept', 'application/json,.json');
      // Never a tab stop of its own: the button stands in for it.
      expect(fileInput()).toHaveAttribute('hidden');
    });

    it('imports the chosen file and says what it brought in', async () => {
      const { props } = renderHistory();
      await choose(json('{"records":[]}'));
      expect(props.onImport).toHaveBeenCalledExactlyOnceWith('{"records":[]}');
      expect(within(dialog()).getByRole('status')).toHaveTextContent(
        'Imported 3 new games, updated 1.',
      );
    });

    it('counts a single game in the singular', async () => {
      renderHistory({ onImport: () => ({ ok: true, added: 1, updated: 0 }) });
      await choose(json('{}'));
      expect(within(dialog()).getByRole('status')).toHaveTextContent(
        'Imported 1 new game, updated 0.',
      );
    });

    it('says when a file holds nothing new', async () => {
      renderHistory({ onImport: () => ({ ok: true, added: 0, updated: 0 }) });
      await choose(json('{}'));
      expect(within(dialog()).getByRole('status')).toHaveTextContent(
        'Nothing new to import — those games are already here.',
      );
    });

    it('turns away a file that is not a history export', async () => {
      renderHistory({ onImport: () => ({ ok: false }) });
      await choose(json('not json'));
      expect(within(dialog()).getByRole('status')).toHaveTextContent(
        "That file isn't a Sudoku history export.",
      );
    });

    it('treats a file that cannot be read like one that is not an export', async () => {
      const { props } = renderHistory();
      const file = json('{}');
      vi.spyOn(file, 'text').mockRejectedValue(new DOMException('gone', 'NotReadableError'));
      await choose(file);
      expect(props.onImport).not.toHaveBeenCalled();
      expect(within(dialog()).getByRole('status')).toHaveTextContent(
        "That file isn't a Sudoku history export.",
      );
    });

    it('does nothing when the picker is cancelled', async () => {
      const { props } = renderHistory();
      await choose();
      expect(props.onImport).not.toHaveBeenCalled();
      expect(within(dialog()).getByRole('status')).toBeEmptyDOMElement();
    });

    it('can import the same file twice in a row', async () => {
      // A file input fires no change for the file it already holds, so it is
      // emptied after every pick.
      renderHistory();
      await choose(json('{}'));
      expect(fileInput().value).toBe('');
    });
  });

  it('closes from its close button', () => {
    const { props } = renderHistory();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  // A longer timeout: these build hundreds of rows, which under coverage and
  // a full parallel run can take jsdom past the default five seconds.
  describe('a long history', { timeout: 20_000 }, () => {
    // A thousand games with four buttons each is slow to build on a phone, so
    // the list grows a page at a time. Counted with querySelectorAll: role
    // queries over a list this size take seconds in jsdom.
    const many = Array.from({ length: 250 }, (_, i) =>
      record(`g${i}`, {
        difficulty: i % 5 === 0 ? 'easy' : 'hard',
        createdAt: NOW - i * 86_400_000,
      }),
    );
    const shownRows = () => document.querySelectorAll('.history-item');

    it('shows the newest hundred, and more on request', () => {
      renderHistory({ records: many, currentId: null, resumableIds: new Set() });
      expect(shownRows()).toHaveLength(100);
      fireEvent.click(screen.getByRole('button', { name: 'Show more (150 left)' }));
      expect(shownRows()).toHaveLength(200);
      // Focus carries on at the first game added, not back at the top.
      expect(shownRows()[100].querySelector('button')).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Show more (50 left)' }));
      expect(shownRows()).toHaveLength(250);
      // The button has gone, and focus did not go with it.
      expect(screen.queryByRole('button', { name: /^Show more/ })).toBeNull();
      expect(shownRows()[200].querySelector('button')).toHaveFocus();
    });

    it('starts each filter from its first page', () => {
      renderHistory({ records: many, currentId: null, resumableIds: new Set() });
      fireEvent.click(screen.getByRole('button', { name: 'Show more (150 left)' }));
      fireEvent.click(tab('Hard'));
      expect(shownRows()).toHaveLength(100);
      expect(screen.getByRole('button', { name: 'Show more (100 left)' })).toBeInTheDocument();
      fireEvent.click(tab('Easy'));
      // Fifty Easy games: one page, no button.
      expect(shownRows()).toHaveLength(50);
      expect(screen.queryByRole('button', { name: /^Show more/ })).toBeNull();
    });
  });

  describe('HistoryDialog with dailies', () => {
    it("labels a daily with its own date, and says so in its buttons' names", () => {
      renderHistory({
        records: [
          record('daily', {
            source: 'daily',
            daily: '2026-10-11',
            createdAt: at(12, 9, 0),
            status: 'solved',
            completedAt: at(12, 9, 6),
          }),
        ],
        currentId: null,
      });
      const row = screen.getByRole('listitem');
      expect(within(row).getByText('Daily · 11 Oct')).toBeInTheDocument();
      // Played on the 12th, though it is the 11th's daily.
      expect(within(row).getByText('Today 09:00')).toBeInTheDocument();
      expect(
        within(row).getByRole('button', {
          name: 'Play again, Hard daily for 11 Oct, from Today 09:00',
        }),
      ).toBeInTheDocument();
    });

    it('labels no other game a daily', () => {
      renderHistory();
      expect(screen.queryByText(/^Daily ·/)).not.toBeInTheDocument();
    });
  });
});
