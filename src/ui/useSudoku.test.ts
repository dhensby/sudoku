import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeCandidates,
  dateKeyOf,
  digitsOf,
  reduce,
  valuesOf,
  serialiseGame,
  verifyMoveLog,
  type Digit,
  type LoggedMove,
  type Puzzle,
} from '../core';
import { ArchiveUnavailableError, dailies as appDailies } from '../daily/dailies';
import {
  computeStats,
  exportHistory,
  hasSeen,
  hasWatched,
  loadCurrentId,
  loadGameBlob,
  loadHistory,
  recordedMistakes,
  upsertRecord,
  type GameRecord,
} from '../storage/history';
import { loadEncodedMoveLog, loadMoveLog, readMoveLogIds, storeMoveLog } from '../storage/moveLogs';
import { loadPreferences, setLastDifficulty } from '../storage/prefs';
import { memoryStorage, type StorageLike } from '../storage/storage';
import { STUCK_ON_AN_XY_CHAIN, STUCK_ON_A_HIDDEN_PAIR } from '../test/logic-fixtures';
import type { PuzzleSource } from './puzzleSource';
import {
  FIRST_EMPTY,
  PUZZLE,
  answerAt,
  failingSource,
  fakeDailies,
  type FakeDailies,
  fakeSource,
  linkFor,
  nearlySolved,
  shortSolve,
} from './testFixtures';
import {
  CLOCK_SAVE_MS,
  COMPLETION_DELAY_MS,
  SAVE_DELAY_MS,
  useSudoku,
  type CalendarView,
  type UseSudokuOptions,
} from './useSudoku';

const NOW = Date.UTC(2026, 9, 12, 12);
const NO_HELP = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };

/** The PUZZLE cell index of the n-th empty cell. */
const EMPTIES = [...PUZZLE.givens].flatMap((ch, i) => (ch === '0' ? [i] : []));

interface SetupOptions extends Partial<UseSudokuOptions> {
  storage?: StorageLike;
  source?: PuzzleSource;
  dailies?: FakeDailies;
  strict?: boolean;
}

function setup({ strict = false, ...options }: SetupOptions = {}) {
  const storage = options.storage ?? memoryStorage();
  const source = options.source ?? fakeSource();
  // Never the app's own store, which would deal real dailies on the main thread.
  const dailies = options.dailies ?? fakeDailies();
  const view = renderHook(
    () => useSudoku({ storage, source, search: '', now: () => Date.now(), ...options, dailies }),
    strict ? { wrapper: StrictMode } : undefined,
  );
  return { ...view, storage, source, dailies };
}

type Hook = ReturnType<typeof setup>['result'];

/** Let the puzzle source's promise settle and React commit what it caused. */
async function settle(): Promise<void> {
  await act(async () => {});
}

/** Set up and wait for the first puzzle. */
async function started(options: SetupOptions = {}) {
  const view = setup(options);
  await settle();
  return view;
}

function advance(ms: number): void {
  act(() => vi.advanceTimersByTime(ms));
}

/** Select a cell and type a digit into it — two user events, two acts. */
function enter(result: Hook, index: number, digit: number): void {
  act(() => result.current.actions.select(index));
  act(() => result.current.actions.enterDigit(digit as Digit));
}

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Another puzzle of the same tier, for an earlier game that is not this one. */
function another(puzzle: Puzzle): Puzzle {
  const givens = nearlySolved([3, 4, 5]).givens;
  expect(givens).not.toBe(puzzle.givens);
  return { ...puzzle, givens };
}

/** A record of a solved game, for the stats a new solve is compared with. */
function solvedRecord(puzzle: Puzzle, elapsedMs: number, id = 'old-0001'): GameRecord {
  return {
    id,
    givens: puzzle.givens,
    difficulty: puzzle.difficulty,
    source: 'generated',
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 86_400_000,
    completedAt: NOW - 86_400_000,
    status: 'solved',
    elapsedMs,
    assists: NO_HELP,
    challenge: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('useSudoku', () => {
  describe('on a first visit', () => {
    it('generates a puzzle at the last difficulty chosen and starts playing at once', async () => {
      const storage = memoryStorage();
      setLastDifficulty(storage, 'hard');
      const source = fakeSource();
      const { result } = setup({ storage, source });
      expect(result.current.phase).toBe('loading');
      expect(result.current.difficulty).toBe('hard');

      await settle();
      expect(source.requests).toEqual(['hard']);
      expect(result.current.phase).toBe('playing');
      expect(result.current.game?.selected).toBe(FIRST_EMPTY);
      expect(result.current.announcement?.text).toBe('New Hard puzzle.');
      // Saved straight away, and remembered as the game on screen.
      expect(loadCurrentId(storage)).toBe(result.current.record?.id);
      expect(loadHistory(storage)).toHaveLength(1);
    });

    it('lines up one puzzle of every tier for the next New game', async () => {
      const source = fakeSource();
      await started({ source });
      expect(source.prefetches).toEqual(['easy', 'medium', 'hard', 'expert']);
    });

    it('starts only one game under StrictMode', async () => {
      // StrictMode mounts, unmounts and remounts: the first request must be
      // dropped, not adopted alongside the second.
      const { result, storage } = await started({ strict: true });
      expect(result.current.phase).toBe('playing');
      expect(loadHistory(storage)).toHaveLength(1);
    });

    it('starts in auto candidate mode when the setting says so', async () => {
      const storage = memoryStorage();
      storage.setItem('sudoku.prefs', JSON.stringify({ settings: { startInAutoCandidate: true } }));
      const { result } = await started({ storage });
      expect(result.current.game?.autoCandidates).toBe(true);
    });

    it('offers to try again when no puzzle can be made at all', async () => {
      const { result } = await started({ source: failingSource() });
      expect(result.current.phase).toBe('loading');
      expect(result.current.isLoadFailed).toBe(true);
      expect(result.current.notice?.kind).toBe('generationFailed');
    });

    it('gets a puzzle on a retry once the source recovers', async () => {
      let isBroken = true;
      const working = fakeSource();
      const source: PuzzleSource = {
        next: (difficulty) =>
          isBroken ? Promise.reject(new Error('down')) : working.next(difficulty),
        prefetch: () => {},
        dispose: () => {},
      };
      const { result } = await started({ source });
      isBroken = false;
      act(() => result.current.actions.retry());
      await settle();
      expect(result.current.phase).toBe('playing');
      expect(result.current.isLoadFailed).toBe(false);
    });

    it('disposes of the puzzle source when it unmounts', async () => {
      const { unmount, source } = await started();
      unmount();
      expect((source as ReturnType<typeof fakeSource>).isDisposed).toBe(true);
    });
  });

  describe('on a return visit', () => {
    it('reopens the game on screen, paused, with its time and board', async () => {
      const storage = memoryStorage();
      const first = await started({ storage });
      enter(first.result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      advance(65_000);
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      first.unmount();

      const { result } = setup({ storage, source: fakeSource() });
      expect(result.current.phase).toBe('paused');
      expect(result.current.pauseReason).toBe('restored');
      expect(result.current.elapsedMs).toBe(65_000);
      expect(result.current.game?.cells[FIRST_EMPTY].value).toBe(answerAt(FIRST_EMPTY));

      act(() => result.current.actions.resume());
      expect(result.current.phase).toBe('playing');
      advance(5000);
      expect(result.current.elapsedMs).toBe(70_000);
    });

    it('shows a solved game solved, without its dialog', async () => {
      const storage = memoryStorage();
      const first = await started({ storage, source: fakeSource(nearlySolved([0])) });
      enter(first.result, 0, answerAt(0));
      first.unmount();

      const { result } = setup({ storage });
      expect(result.current.phase).toBe('solved');
      expect(result.current.dialog).toBeNull();
      // The wave belongs to the solve, not to every visit after it.
      expect(result.current.isCelebrating).toBe(false);
    });
  });

  describe('opening a share link', () => {
    it('waits behind Start, with the challenger’s time, then starts the clock', async () => {
      const near = nearlySolved([0, 10, 20]);
      const search = linkFor(near.givens, { t: '323', n: 'Dan', a: 'h2' });
      window.history.replaceState(null, '', `/${search}`);
      const { result, storage } = await started({ search });

      expect(result.current.phase).toBe('ready');
      expect(result.current.record).toMatchObject({
        source: 'shared',
        givens: near.givens,
        challenge: { name: 'Dan', seconds: 323, assists: { ...NO_HELP, hints: 2 } },
      });
      // The link has done its job; a reload must not drag the player back to it.
      expect(window.location.search).toBe('');
      expect(loadCurrentId(storage)).toBe(result.current.record?.id);

      advance(10_000);
      expect(result.current.elapsedMs).toBe(0);
      act(() => result.current.actions.resume());
      expect(result.current.phase).toBe('playing');
      expect(result.current.announcement?.text).toBe('Started.');
      advance(2000);
      expect(result.current.elapsedMs).toBe(2000);
    });

    it('says when a link is broken, and starts a fresh puzzle instead', async () => {
      const { result, source } = setup({ search: '?p=not-a-puzzle!' });
      expect(result.current.notice?.text).toBe(
        "That puzzle link doesn't work — here's a fresh puzzle instead.",
      );
      await settle();
      expect((source as ReturnType<typeof fakeSource>).requests).toHaveLength(1);
      advance(0);
      // Said once: a "New Easy puzzle." straight after would be read instead.
      expect(result.current.announcement).toEqual({
        text: "That puzzle link doesn't work — here's a fresh puzzle instead.",
        id: 1,
      });
      act(() => result.current.actions.dismissNotice());
      expect(result.current.notice).toBeNull();
    });

    it('promises no fresh puzzle when it keeps the game already on screen', async () => {
      const storage = memoryStorage();
      const first = await started({ storage });
      advance(1000);
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      first.unmount();
      const { result } = setup({ storage, search: '?p=AAAA' });
      expect(result.current.phase).toBe('paused');
      expect(result.current.notice?.text).toBe(
        "That puzzle link doesn't work, so here's the game you were playing.",
      );
      advance(0);
      expect(result.current.announcement?.text).toBe(result.current.notice?.text);
    });

    it('reopens an unfinished attempt at the puzzle, racing the link’s time', async () => {
      const storage = memoryStorage();
      const first = await started({ storage });
      enter(first.result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      act(() => first.result.current.actions.pause());
      const id = first.result.current.record?.id;
      first.unmount();

      const { result } = setup({ storage, search: linkFor(PUZZLE.givens, { t: '200' }) });
      expect(result.current.record?.id).toBe(id);
      expect(result.current.phase).toBe('paused');
      expect(result.current.record?.challenge?.seconds).toBe(200);
      expect(result.current.game?.cells[FIRST_EMPTY].value).toBe(answerAt(FIRST_EMPTY));
    });

    describe('for a puzzle already solved', () => {
      async function solvedThenLinked() {
        const storage = memoryStorage();
        upsertRecord(storage, solvedRecord(PUZZLE, 290_000));
        const other = nearlySolved([4, 5, 6]);
        const view = await started({
          storage,
          source: fakeSource(other),
          search: linkFor(PUZZLE.givens, { t: '323', n: 'Dan' }),
        });
        return { ...view, other };
      }

      it('offers a fresh attempt, with the earlier time and the link’s', async () => {
        const { result, storage } = await solvedThenLinked();
        expect(result.current.dialog).toMatchObject({
          kind: 'challenge',
          offer: { previous: { id: 'old-0001' }, challenge: { name: 'Dan', seconds: 323 } },
        });
        // A game is still made for behind the dialog, held until it closes —
        // and unrecorded until then, as nobody has seen it.
        expect(result.current.phase).toBe('paused');
        expect(result.current.pauseReason).toBe('dialog');
        act(() => {
          window.dispatchEvent(new Event('pagehide'));
        });
        advance(CLOCK_SAVE_MS);
        expect(loadHistory(storage).map((record) => record.id)).toEqual(['old-0001']);
        expect(loadCurrentId(storage)).toBeNull();
      });

      it('records the game behind the offer once the offer is turned down', async () => {
        const { result, storage, other } = await solvedThenLinked();
        act(() => result.current.actions.closeDialog());
        expect(loadCurrentId(storage)).toBe(result.current.record?.id);
        expect(loadHistory(storage).find((record) => record.givens === other.givens)).toBeDefined();
      });

      it('plays the puzzle again as a replay, racing the link', async () => {
        const { result, storage } = await solvedThenLinked();
        act(() => result.current.actions.playAgain());
        expect(result.current.dialog).toBeNull();
        expect(result.current.phase).toBe('playing');
        expect(result.current.record).toMatchObject({
          source: 'replay',
          givens: PUZZLE.givens,
          challenge: { name: 'Dan' },
        });
        // And the game made behind the offer, never seen, leaves no trace.
        expect(loadHistory(storage)).toHaveLength(2);
        expect(loadHistory(storage).filter((r) => r.givens === PUZZLE.givens)).toHaveLength(2);
      });

      it('keeps the game on screen when the offer is turned down', async () => {
        const { result, other } = await solvedThenLinked();
        act(() => result.current.actions.closeDialog());
        expect(result.current.phase).toBe('playing');
        expect(result.current.record?.givens).toBe(other.givens);
      });
    });
  });

  describe('the clock', () => {
    it('counts while playing and stops while paused', async () => {
      const { result } = await started();
      advance(3000);
      expect(result.current.elapsedMs).toBe(3000);
      act(() => result.current.actions.pause());
      expect(result.current.phase).toBe('paused');
      expect(result.current.pauseReason).toBe('user');
      expect(result.current.announcement?.text).toBe('Paused.');
      advance(60_000);
      expect(result.current.elapsedMs).toBe(3000);
      act(() => result.current.actions.resume());
      expect(result.current.announcement?.text).toBe('Resumed.');
      advance(1000);
      expect(result.current.elapsedMs).toBe(4000);
    });

    it('pauses the moment the tab is hidden, and stays paused when it comes back', async () => {
      const { result, storage } = await started();
      advance(2000);
      setVisibility('hidden');
      expect(result.current.phase).toBe('paused');
      expect(result.current.pauseReason).toBe('hidden');
      // The board is gone; the status region should not still describe it.
      expect(result.current.announcement?.text).toBe('Paused.');
      // Banked and saved at once: the tab may never be seen again.
      expect(loadHistory(storage)[0].elapsedMs).toBe(2000);
      advance(600_000);
      setVisibility('visible');
      expect(result.current.phase).toBe('paused');
      expect(result.current.elapsedMs).toBe(2000);
    });

    it('saves a game left paused when the page goes away', async () => {
      const { result, storage } = await started();
      act(() => result.current.actions.pause());
      act(() => result.current.actions.select(FIRST_EMPTY + 1));
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      expect(
        (loadGameBlob(storage, result.current.record!.id) as { selected: number }).selected,
      ).toBe(result.current.game?.selected);
    });

    it('ignores game input while the board is hidden', async () => {
      const { result } = await started();
      act(() => result.current.actions.pause());
      const before = result.current.game;
      act(() => result.current.actions.enterDigit(answerAt(FIRST_EMPTY) as Digit));
      act(() => result.current.actions.hint());
      act(() => result.current.actions.requestReset());
      expect(result.current.game).toBe(before);
      expect(result.current.dialog).toBeNull();
    });
  });

  describe('dialogs', () => {
    it('pause the game silently while open, and resume it as they close', async () => {
      const { result } = await started();
      const said = result.current.announcement;
      act(() => result.current.actions.openDialog('settings'));
      expect(result.current.dialog).toEqual({ kind: 'settings' });
      expect(result.current.phase).toBe('paused');
      expect(result.current.pauseReason).toBe('dialog');
      expect(result.current.announcement).toBe(said);
      advance(30_000);
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('playing');
      expect(result.current.elapsedMs).toBe(0);
    });

    it('leave a game the player paused paused when they close', async () => {
      const { result } = await started();
      act(() => result.current.actions.pause());
      act(() => result.current.actions.openDialog('help'));
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('paused');
      expect(result.current.pauseReason).toBe('user');
    });

    it('open the technique guide at an entry, pausing silently, with no help recorded', async () => {
      const { result } = await started();
      const said = result.current.announcement;
      act(() => result.current.actions.openTechniques('xWing'));
      expect(result.current.dialog).toEqual({ kind: 'techniques', initial: 'xWing' });
      expect(result.current.phase).toBe('paused');
      expect(result.current.pauseReason).toBe('dialog');
      expect(result.current.announcement).toBe(said);
      advance(30_000);
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('playing');
      expect(result.current.elapsedMs).toBe(0);
      // Reading about a technique is not help with this puzzle.
      expect(result.current.game?.assists).toEqual(NO_HELP);
    });

    it('open the technique guide from the header at its start', async () => {
      const { result } = await started();
      act(() => result.current.actions.openDialog('techniques'));
      expect(result.current.dialog).toEqual({ kind: 'techniques', initial: null });
      expect(result.current.pauseReason).toBe('dialog');
    });

    it('let the technique guide take Help’s place, staying paused until it closes', async () => {
      const { result } = await started();
      act(() => result.current.actions.openDialog('help'));
      advance(5_000);
      act(() => result.current.actions.openTechniques(null));
      expect(result.current.dialog).toEqual({ kind: 'techniques', initial: null });
      expect(result.current.phase).toBe('paused');
      advance(5_000);
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toBeNull();
      expect(result.current.phase).toBe('playing');
      expect(result.current.elapsedMs).toBe(0);
    });

    it('share the puzzle alone mid-game', async () => {
      const { result } = await started();
      act(() => result.current.actions.openDialog('share'));
      expect(result.current.dialog).toEqual({
        kind: 'share',
        target: {
          givens: PUZZLE.givens,
          difficulty: 'easy',
          result: null,
          daily: null,
          solve: null,
        },
        returnTo: null,
      });
    });

    it('apply settings and remember them', async () => {
      const { result, storage } = await started();
      act(() => result.current.actions.updateSettings({ highlightBox: false }));
      expect(result.current.settings.highlightBox).toBe(false);
      expect(loadPreferences(storage).settings.highlightBox).toBe(false);
    });

    it('say a newer version’s theme is stored until a theme is picked here', async () => {
      // Applied as System, but Settings must let the player pick System to replace it.
      const storage = memoryStorage();
      storage.setItem('sudoku.prefs', JSON.stringify({ settings: { theme: 'sepia' } }));
      const { result } = await started({ storage });
      expect(result.current.settings.theme).toBe('system');
      expect(result.current.isThemeNewer).toBe(true);
      act(() => result.current.actions.updateSettings({ highlightBox: false }));
      expect(result.current.isThemeNewer).toBe(true);
      act(() => result.current.actions.updateSettings({ theme: 'system' }));
      expect(result.current.isThemeNewer).toBe(false);
      expect(loadPreferences(storage).settings.theme).toBe('system');
    });

    it('take High contrast for a theme of their own, not a newer version’s', async () => {
      // The version before this one stored it as a newer theme and kept it;
      // this one shows it chosen.
      const storage = memoryStorage();
      storage.setItem('sudoku.prefs', JSON.stringify({ settings: { theme: 'contrast' } }));
      const { result } = await started({ storage });
      expect(result.current.settings.theme).toBe('contrast');
      expect(result.current.isThemeNewer).toBe(false);
    });

    it('remember the player’s name, tidied', async () => {
      const { result, storage } = await started();
      act(() => result.current.actions.setPlayerName('  Dan   H  '));
      expect(result.current.playerName).toBe('Dan H');
      expect(loadPreferences(storage).playerName).toBe('Dan H');
    });
  });

  describe('hints remembered, and Show me', () => {
    /** The puzzle a player got stuck on, and their sixteen right entries. */
    const STUCK: Puzzle = {
      givens: STUCK_ON_A_HIDDEN_PAIR.givens,
      solution: STUCK_ON_A_HIDDEN_PAIR.solution,
      difficulty: 'hard',
    };

    /** A cell by its row and column, counted from one as the game shows them. */
    const rc = (row: number, col: number) => (row - 1) * 9 + col - 1;

    async function stuck(options: SetupOptions = {}) {
      const view = await started({ source: fakeSource(STUCK), ...options });
      for (const [row, col, digit] of STUCK_ON_A_HIDDEN_PAIR.entries) {
        enter(view.result, rc(row, col), digit);
      }
      return view;
    }

    it('show a cell’s hint again whenever it is selected, and ask nothing more for it', async () => {
      const { result } = await started();
      act(() => result.current.actions.hint());
      const hint = result.current.game!.hint!;
      const hinted = result.current.game!.selected;
      expect(result.current.shownHint).toBe(hint);
      expect(result.current.game?.assists.hints).toBe(1);

      const elsewhere = EMPTIES.find((index) => index !== hinted)!;
      act(() => result.current.actions.select(elsewhere));
      expect(result.current.shownHint).toBeNull();
      act(() => result.current.actions.select(hinted));
      expect(result.current.game?.hint).toBeNull();
      expect(result.current.shownHint).toEqual(hint);

      // Asking again from elsewhere finds the same cell: shown, selected, free.
      act(() => result.current.actions.select(elsewhere));
      act(() => result.current.actions.hint());
      expect(result.current.game?.selected).toBe(hinted);
      expect(result.current.game?.assists.hints).toBe(1);
    });

    it('forget a hint once its cell holds its answer', async () => {
      const { result } = await started();
      act(() => result.current.actions.hint());
      const hinted = result.current.game!.selected;
      act(() => result.current.actions.enterDigit(answerAt(hinted) as Digit));
      expect(result.current.shownHint).toBeNull();
      expect(result.current.game?.cellHints.has(hinted)).toBe(false);
    });

    it('keep a cell’s hint, and what it cost, across a reload', async () => {
      const storage = memoryStorage();
      const first = await started({ storage });
      act(() => first.result.current.actions.hint());
      const hint = first.result.current.game!.hint!;
      const hinted = first.result.current.game!.selected;
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      first.unmount();

      const { result } = setup({ storage, source: fakeSource() });
      act(() => result.current.actions.resume());
      act(() => result.current.actions.select(hinted));
      expect(result.current.shownHint).toEqual(hint);
      act(() => result.current.actions.hint());
      expect(result.current.game?.assists.hints).toBe(1);
    });

    it('offer the steps for the hint on show, and none for a mistake', async () => {
      const { result } = await started();
      expect(result.current.walkthrough).toBeNull();
      act(() => result.current.actions.hint());
      // A single: the walkthrough is the single itself.
      expect(result.current.walkthrough?.target).toBe(result.current.game?.selected);
      expect(result.current.walkthrough?.steps).toHaveLength(1);

      enter(result, EMPTIES[3], answerAt(EMPTIES[3]) === 9 ? 1 : 9);
      act(() => result.current.actions.hint());
      expect(result.current.shownHint?.kind).toBe('mistake');
      expect(result.current.walkthrough).toBeNull();
    });

    it('walk the stuck player through their cell, counted as a hint the first time only', async () => {
      const { result } = await stuck();
      act(() => result.current.actions.hint());
      expect(result.current.game?.hint).toEqual({
        kind: 'deduction',
        index: STUCK_ON_A_HIDDEN_PAIR.target,
        technique: 'hiddenPair',
      });
      expect(result.current.game?.assists.hints).toBe(1);
      const said = result.current.announcement;

      act(() => result.current.actions.showMe());
      const { dialog } = result.current;
      expect(dialog?.kind).toBe('walkthrough');
      if (dialog?.kind !== 'walkthrough') return;
      expect(dialog.step).toBe(0);
      expect(dialog.walkthrough.target).toBe(STUCK_ON_A_HIDDEN_PAIR.target);
      expect(dialog.walkthrough.steps.map((trace) => trace.step.technique)).toEqual([
        'hiddenPair',
        'pointing',
        'nakedSingle',
      ]);
      // A dialog like any other: the clock stops, silently.
      expect(result.current.phase).toBe('paused');
      expect(result.current.pauseReason).toBe('dialog');
      expect(result.current.announcement).toBe(said);
      expect(result.current.game?.assists.hints).toBe(2);
      // The hint stays, behind it.
      expect(result.current.shownHint?.kind).toBe('deduction');

      advance(30_000);
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('playing');
      expect(result.current.elapsedMs).toBe(0);

      act(() => result.current.actions.showMe());
      expect(result.current.dialog?.kind).toBe('walkthrough');
      expect(result.current.game?.assists.hints).toBe(2);
    });

    it('put a remembered hint afresh once the board has moved on, as Show me would show it', async () => {
      const { result } = await stuck();
      const { target } = STUCK_ON_A_HIDDEN_PAIR;
      act(() => result.current.actions.hint());
      // Two right digits elsewhere, and the hidden pair is no longer needed.
      enter(result, rc(5, 5), 9);
      enter(result, rc(5, 6), 5);
      act(() => result.current.actions.select(target));
      expect(result.current.shownHint).toEqual({
        kind: 'single',
        index: target,
        technique: 'nakedSingle',
        unit: null,
      });
      expect(result.current.walkthrough?.steps.map((trace) => trace.step.technique)).toEqual([
        'nakedSingle',
      ]);
      // Remembered as it was given, and asked for once.
      expect(result.current.game?.cellHints.get(target)?.fill).toMatchObject({
        technique: 'hiddenPair',
      });
      expect(result.current.game?.assists.hints).toBe(1);
    });

    it('offer Show me whatever the rest of the board holds, and point at a mistake when pressed', async () => {
      const { result } = await stuck();
      const { target } = STUCK_ON_A_HIDDEN_PAIR;
      act(() => result.current.actions.hint());
      // A 6 at row 1, column 1 is wrong (it takes a 9) but breaks no rule,
      // so nothing on the board gives it away — and neither may Show me.
      const wrong = rc(1, 1);
      enter(result, wrong, 6);
      act(() => result.current.actions.select(target));
      expect(result.current.walkthrough).not.toBeNull();
      expect(result.current.game?.assists.hints).toBe(1);

      // Pressed, it does what Hint would: point at the mistake, counted.
      act(() => result.current.actions.showMe());
      expect(result.current.dialog).toBeNull();
      expect(result.current.game?.hint).toEqual({ kind: 'mistake', index: wrong });
      expect(result.current.game?.selected).toBe(wrong);
      expect(result.current.game?.cells[wrong].mark).toBe('wrong');
      expect(result.current.announcement?.text).toMatch(
        /incorrect\. Row 1, column 1\. 2 hints used\.$/,
      );
      expect(result.current.game?.assists.hints).toBe(2);
      // Pointed out once, it is no news the second time.
      act(() => result.current.actions.select(target));
      act(() => result.current.actions.showMe());
      expect(result.current.game?.hint?.kind).toBe('mistake');
      expect(result.current.game?.assists.hints).toBe(2);

      // Put right, Show me walks through the cell after all, counted once.
      enter(result, wrong, 9);
      act(() => result.current.actions.select(target));
      act(() => result.current.actions.showMe());
      expect(result.current.dialog?.kind).toBe('walkthrough');
      expect(result.current.game?.assists.hints).toBe(3);
    });

    it('say what Show me cost as it opens, while help taken is shown, and nothing when it was free', async () => {
      const { result } = await stuck();
      act(() => result.current.actions.hint());
      act(() => result.current.actions.showMe());
      expect(result.current.dialog).toMatchObject({ kind: 'walkthrough', charge: '2 hints used.' });
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.showMe());
      expect(result.current.dialog).toMatchObject({ kind: 'walkthrough', charge: null });
      expect(result.current.game?.assists.hints).toBe(2);
    });

    it('say nothing of what Show me cost with help taken hidden', async () => {
      const storage = memoryStorage();
      storage.setItem('sudoku.prefs', JSON.stringify({ settings: { showHelpTaken: false } }));
      const { result } = await stuck({ storage });
      act(() => result.current.actions.hint());
      expect(result.current.announcement?.text).not.toMatch(/used/);
      act(() => result.current.actions.showMe());
      expect(result.current.dialog).toMatchObject({ kind: 'walkthrough', charge: null });
      expect(result.current.game?.assists.hints).toBe(2);
    });

    it('go to the guide from a step and back to that step, the clock stopped throughout', async () => {
      const { result } = await stuck();
      act(() => result.current.actions.hint());
      act(() => result.current.actions.showMe());
      const walkthrough = result.current.walkthrough!;
      act(() => result.current.actions.openTechniques('pointing', 1));
      expect(result.current.dialog).toEqual({
        kind: 'techniques',
        initial: 'pointing',
        returnTo: { kind: 'walkthrough', walkthrough, step: 1 },
      });
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toEqual({ kind: 'walkthrough', walkthrough, step: 1 });
      expect(result.current.pauseReason).toBe('dialog');
      // Without a step to go back to, it goes back where it was.
      act(() => result.current.actions.openTechniques('hiddenPair'));
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toEqual({ kind: 'walkthrough', walkthrough, step: 1 });
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toBeNull();
      expect(result.current.phase).toBe('playing');
      // Reading the guide is still not help.
      expect(result.current.game?.assists.hints).toBe(2);
    });

    it('open no walkthrough with none to show, or with the board hidden', async () => {
      const { result } = await started();
      act(() => result.current.actions.showMe());
      expect(result.current.dialog).toBeNull();
      act(() => result.current.actions.hint());
      act(() => result.current.actions.pause());
      act(() => result.current.actions.showMe());
      expect(result.current.dialog).toBeNull();
      expect(result.current.game?.assists.hints).toBe(1);
    });

    describe('from the player’s own candidates', () => {
      // Row 1, column 4 (cell 3): candidates 2 and 6, answer 6.
      const CELL = 3;

      /** A game in auto candidate mode with cell 3's answer struck out. */
      async function struck(options: SetupOptions = {}) {
        const view = await started(options);
        act(() => view.result.current.actions.setAutoCandidates(true));
        act(() => view.result.current.actions.toggleCandidate(CELL, 6));
        return view;
      }

      it('point at a struck answer without naming it, counted once while it stays struck', async () => {
        const { result } = await struck();
        act(() => result.current.actions.hint());
        expect(result.current.shownHint).toEqual({ kind: 'struck', index: CELL });
        expect(result.current.game?.selected).toBe(CELL);
        // With the count of help taken, as every charge is said (Show help taken is on).
        expect(result.current.announcement?.text).toBe(
          "This cell is missing a candidate that can't be ruled out yet. Row 1, column 4. 1 hint used.",
        );
        expect(result.current.game?.assists.hints).toBe(1);
        // Show me is on offer, with no walkthrough: its page is of its own.
        expect(result.current.walkthrough).toBeNull();
        expect(result.current.isShowMeOffered).toBe(true);
        act(() => result.current.actions.select(FIRST_EMPTY));
        act(() => result.current.actions.hint());
        expect(result.current.game?.assists.hints).toBe(1);
      });

      it('name the struck answer in Show me, counted once, and put it back as an ordinary move', async () => {
        const { result } = await struck();
        act(() => result.current.actions.hint());
        const said = result.current.announcement;
        act(() => result.current.actions.showMe());
        expect(result.current.dialog).toMatchObject({ kind: 'struck', index: CELL, digit: 6 });
        expect(result.current.pauseReason).toBe('dialog');
        expect(result.current.announcement).toBe(said);
        expect(result.current.game?.assists.hints).toBe(2);
        act(() => result.current.actions.closeDialog());
        expect(result.current.phase).toBe('playing');
        act(() => result.current.actions.showMe());
        expect(result.current.game?.assists.hints).toBe(2);

        act(() => result.current.actions.putBack());
        expect(result.current.dialog).toBeNull();
        expect(result.current.phase).toBe('playing');
        expect(result.current.game?.cells[CELL].autoRemoved).toBe(0);
        expect(result.current.announcement?.text).toBe('Candidate 6 added.');
        expect(result.current.game?.cellHints.has(CELL)).toBe(false);
        expect(result.current.shownHint).toBeNull();
        // An ordinary move: Undo strikes it again.
        act(() => result.current.actions.undo());
        expect(result.current.game?.cells[CELL].autoRemoved).toBe(1 << 5);
        expect(result.current.game?.assists.hints).toBe(2);
      });

      it('put nothing back without the page open, and leave the board be while it is', async () => {
        const { result } = await struck();
        act(() => result.current.actions.putBack());
        expect(result.current.game?.cells[CELL].autoRemoved).toBe(1 << 5);
        act(() => result.current.actions.hint());
        act(() => result.current.actions.showMe());
        // The page stops the clock, and no move is taken while it is open, so
        // its button is the only way the digit goes back before it closes.
        act(() => result.current.actions.toggleCandidate(CELL, 6));
        expect(result.current.game?.cells[CELL].autoRemoved).toBe(1 << 5);
        act(() => result.current.actions.putBack());
        expect(result.current.game?.cells[CELL].autoRemoved).toBe(0);
      });

      it('forget a struck hint at any change to its cell, saying nothing of which, and count it again', async () => {
        const after = async (digit: number) => {
          const { result, unmount } = await struck();
          act(() => result.current.actions.toggleCandidate(CELL, 2));
          act(() => result.current.actions.hint());
          act(() => result.current.actions.toggleCandidate(CELL, digit as Digit));
          act(() => result.current.actions.select(FIRST_EMPTY));
          act(() => result.current.actions.select(CELL));
          const seen = {
            hint: result.current.shownHint,
            isShowMeOffered: result.current.isShowMeOffered,
            hints: result.current.game?.assists.hints,
          };
          // Asked again: counted again whenever it is still missing.
          act(() => result.current.actions.hint());
          const again = result.current.game?.assists.hints;
          unmount();
          return { seen, again };
        };
        // Both candidates struck, then the answer put back, or the other: the
        // bar alike, and Hint again counted either way when it says anything.
        const right = await after(6);
        const wrong = await after(2);
        expect(right.seen).toEqual({ hint: null, isShowMeOffered: false, hints: 1 });
        expect(wrong.seen).toEqual(right.seen);
        expect(wrong.again).toBe(2);
        expect(right.again).toBe(2);
      });

      it('keep a struck hint, and what it cost, across a reload', async () => {
        const storage = memoryStorage();
        const first = await struck({ storage });
        act(() => first.result.current.actions.hint());
        act(() => first.result.current.actions.showMe());
        act(() => first.result.current.actions.closeDialog());
        act(() => {
          window.dispatchEvent(new Event('pagehide'));
        });
        first.unmount();

        const { result } = setup({ storage, source: fakeSource() });
        act(() => result.current.actions.resume());
        act(() => result.current.actions.select(CELL));
        expect(result.current.shownHint).toEqual({ kind: 'struck', index: CELL });
        act(() => result.current.actions.hint());
        act(() => result.current.actions.showMe());
        expect(result.current.game?.assists.hints).toBe(2);
      });

      it('never let a struck answer elsewhere change what Show me offers, until it is pressed', async () => {
        // The stuck player's hint, in auto candidate mode, then a candidate
        // struck from row 1, column 3, which the steps do not rest on (answer
        // 6): its answer, or another. Nothing on show may tell the two apart
        // — the boards Show me draws are the player's, and differ only by
        // the candidate they struck.
        const { target } = STUCK_ON_A_HIDDEN_PAIR;
        const seen = async (strike: number) => {
          const view = await stuck();
          act(() => view.result.current.actions.setAutoCandidates(true));
          act(() => view.result.current.actions.hint());
          act(() => view.result.current.actions.toggleCandidate(rc(1, 3), strike as Digit));
          act(() => view.result.current.actions.select(target));
          return view;
        };
        const wrong = await seen(6);
        const right = await seen(9);
        const stepsOf = (view: typeof wrong) =>
          view.result.current.walkthrough?.steps.map(({ step }) => step);
        expect(wrong.result.current.shownHint).toEqual(right.result.current.shownHint);
        expect(stepsOf(wrong)).toEqual(stepsOf(right));
        expect(wrong.result.current.isShowMeOffered).toBe(true);
        expect(right.result.current.isShowMeOffered).toBe(true);
        expect(wrong.result.current.game?.assists.hints).toBe(1);

        // Pressed, it does what Hint would: point at the cell, counted as Hint counts it.
        act(() => wrong.result.current.actions.showMe());
        expect(wrong.result.current.dialog).toBeNull();
        expect(wrong.result.current.game?.hint).toEqual({ kind: 'struck', index: rc(1, 3) });
        expect(wrong.result.current.game?.selected).toBe(rc(1, 3));
        expect(wrong.result.current.game?.assists.hints).toBe(2);
        act(() => right.result.current.actions.showMe());
        expect(right.result.current.dialog?.kind).toBe('walkthrough');
      });

      it('point at a wrong digit first, when Show me is pressed on a struck answer', async () => {
        const { result } = await struck();
        act(() => result.current.actions.hint());
        // A wrong 9 in the centre (answer 5).
        enter(result, 40, 9);
        act(() => result.current.actions.hint());
        expect(result.current.shownHint).toEqual({ kind: 'mistake', index: 40 });
        act(() => result.current.actions.select(CELL));
        expect(result.current.shownHint).toEqual({ kind: 'struck', index: CELL });
        act(() => result.current.actions.showMe());
        expect(result.current.dialog).toBeNull();
        expect(result.current.game?.hint).toEqual({ kind: 'mistake', index: 40 });
      });

      it.each([
        ['struck out of the automatic candidates', true],
        ['pencilled into the notes', false],
      ])(
        'show the same remembered hint, and offer Show me alike, whatever is %s in its cell',
        async (_name, autoCandidates) => {
          // The report's stuck cell, hinted; then each set of its candidates
          // in turn, with the answer (9) and without. Nothing the bar shows
          // unasked may tell them apart.
          const { givens, solution, entries, target } = STUCK_ON_AN_XY_CHAIN;
          const { result } = await started({
            source: fakeSource({ givens, solution, difficulty: 'expert' }),
          });
          act(() => result.current.actions.setAutoCandidates(autoCandidates));
          for (const [row, col, digit] of entries) enter(result, rc(row, col), digit);
          act(() => result.current.actions.hint());
          const hints = result.current.game!.assists.hints;
          const digits = digitsOf(computeCandidates(valuesOf(result.current.game!))[target]);
          expect(digits).toContain(9);
          const bars = new Set<string>();
          for (let subset = 0; subset < 1 << digits.length; subset++) {
            const marked = digits.filter((_, i) => (subset & (1 << i)) !== 0);
            const toggle = () => {
              for (const digit of marked) {
                act(() => result.current.actions.toggleCandidate(target, digit as Digit));
              }
            };
            toggle();
            act(() => result.current.actions.select(target));
            const { shownHint, isShowMeOffered, walkthrough } = result.current;
            bars.add(JSON.stringify({ shownHint, isShowMeOffered, steps: walkthrough?.steps }));
            toggle();
          }
          expect(bars.size).toBe(1);
          expect(result.current.game?.assists.hints).toBe(hints);
        },
      );

      it('move Show me on as the player strikes what it starts with (the report)', async () => {
        const { givens, solution, entries, strikes, target } = STUCK_ON_AN_XY_CHAIN;
        const { result } = await started({
          source: fakeSource({ givens, solution, difficulty: 'expert' }),
        });
        act(() => result.current.actions.setAutoCandidates(true));
        for (const [row, col, digit] of entries) enter(result, rc(row, col), digit);
        act(() => result.current.actions.hint());
        expect(result.current.shownHint).toEqual({
          kind: 'deduction',
          index: target,
          technique: 'xyChain',
        });
        const first = () => result.current.walkthrough?.steps[0].step.technique;
        expect(first()).toBe('claiming');
        for (const [row, col, digit] of strikes) {
          act(() => result.current.actions.toggleCandidate(rc(row, col), digit as Digit));
        }
        // The bar holds to the candidates the hint was given from — the
        // strikes since are unchecked — but Show me, pressed, starts from the
        // player's: the step they have taken is gone.
        act(() => result.current.actions.select(target));
        expect(first()).toBe('claiming');
        act(() => result.current.actions.showMe());
        const opened = result.current.dialog;
        expect(opened?.kind === 'walkthrough' && opened.walkthrough.steps[0].step.technique).toBe(
          'hiddenTriple',
        );
        act(() => result.current.actions.closeDialog());
        // Hint again, free for the cell, brings the bar up to date.
        act(() => result.current.actions.hint());
        expect(result.current.game?.selected).toBe(target);
        expect(first()).toBe('hiddenTriple');
        expect(result.current.game?.assists.hints).toBe(2);
      });
    });
  });

  describe('help taken', () => {
    it('says the new count with a hint that charges it, and nothing more for one asked again', async () => {
      const { result } = await started();
      act(() => result.current.actions.hint());
      const hinted = result.current.game!.selected;
      expect(result.current.game?.assists.hints).toBe(1);
      expect(result.current.announcement?.text).toMatch(/\. 1 hint used\.$/);

      // Asked again from elsewhere: the same cell, free, and said without a count.
      act(() => result.current.actions.select(EMPTIES.find((index) => index !== hinted)!));
      act(() => result.current.actions.hint());
      expect(result.current.game?.selected).toBe(hinted);
      expect(result.current.game?.assists.hints).toBe(1);
      expect(result.current.announcement?.text).not.toMatch(/used/);

      // Its cell solved, the next hint is a new one: charged, and said.
      enter(result, hinted, answerAt(hinted));
      act(() => result.current.actions.hint());
      expect(result.current.game?.selected).not.toBe(hinted);
      expect(result.current.game?.assists.hints).toBe(2);
      expect(result.current.announcement?.text).toMatch(/\. 2 hints used\.$/);
    });

    it('says what auto candidates, a check and a reveal cost, once each', async () => {
      const { result } = await started();
      act(() => result.current.actions.setAutoCandidates(true));
      expect(result.current.announcement?.text).toBe('Auto candidates on. Counts as help.');
      act(() => result.current.actions.setAutoCandidates(false));
      act(() => result.current.actions.setAutoCandidates(true));
      // On again, it cost nothing more.
      expect(result.current.announcement?.text).toBe('Auto candidates on.');
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY) === 9 ? 1 : 9);
      act(() => result.current.actions.check('cell'));
      const column = (FIRST_EMPTY % 9) + 1;
      expect(result.current.announcement?.text).toBe(
        `Row 1, column ${column} is incorrect. 1 check used.`,
      );
      act(() => result.current.actions.reveal());
      expect(result.current.announcement?.text).toBe(
        `Revealed ${answerAt(FIRST_EMPTY)} in row 1, column ${column}. 1 reveal used.`,
      );
      expect(result.current.game?.assists).toEqual({
        autoCandidates: true,
        hints: 0,
        checks: 1,
        reveals: 1,
      });
    });

    it('says no count with help taken hidden, though the help is still recorded', async () => {
      const storage = memoryStorage();
      storage.setItem('sudoku.prefs', JSON.stringify({ settings: { showHelpTaken: false } }));
      const { result } = await started({ storage });
      act(() => result.current.actions.hint());
      expect(result.current.game?.assists.hints).toBe(1);
      expect(result.current.announcement?.text).not.toMatch(/used/);
      act(() => result.current.actions.setAutoCandidates(true));
      expect(result.current.announcement?.text).toBe('Auto candidates on.');
    });
  });

  describe('saving', () => {
    it('saves moves after a quiet moment rather than on every keystroke', async () => {
      const { result, storage } = await started();
      const id = result.current.record!.id;
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      const blob = () => loadGameBlob(storage, id) as { values: string };
      expect(blob().values[FIRST_EMPTY]).toBe('0');
      advance(SAVE_DELAY_MS);
      expect(blob().values[FIRST_EMPTY]).toBe(String(answerAt(FIRST_EMPTY)));
      expect(blob()).toEqual(serialiseGame(result.current.game!));
    });
  });

  describe('moves', () => {
    it('announce what they did', async () => {
      const { result } = await started();
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      expect(result.current.announcement?.text).toMatch(/in row 1, column \d\.$/);
    });

    it('flip the mode while Shift or Alt is held', async () => {
      const { result } = await started();
      act(() => result.current.actions.setModifier('Shift', true));
      expect(result.current.effectiveMode).toBe('candidate');
      act(() => result.current.actions.enterDigit(4));
      expect(result.current.game?.cells[FIRST_EMPTY]).toMatchObject({ value: 0, notes: 0b1000 });
      // Both held: one let go keeps the other's flip.
      act(() => result.current.actions.setModifier('Alt', true));
      act(() => result.current.actions.setModifier('Shift', false));
      expect(result.current.effectiveMode).toBe('candidate');
      act(() => result.current.actions.setModifier('Alt', false));
      expect(result.current.effectiveMode).toBe('normal');
      act(() => result.current.actions.setModifier('Alt', false));
      expect(result.current.effectiveMode).toBe('normal');
    });

    it('drop held modifiers when the window loses them', async () => {
      const { result } = await started();
      act(() => result.current.actions.setModifier('Shift', true));
      act(() => result.current.actions.clearModifiers());
      expect(result.current.effectiveMode).toBe('normal');
      act(() => result.current.actions.setModifier('Shift', true));
      setVisibility('hidden');
      expect(result.current.effectiveMode).toBe('normal');
    });

    it('toggle a candidate by its spot whatever the mode', async () => {
      const { result } = await started();
      act(() => result.current.actions.toggleCandidate(FIRST_EMPTY, 7));
      expect(result.current.game?.cells[FIRST_EMPTY].notes).toBe(0b1000000);
      expect(result.current.game?.mode).toBe('normal');
    });

    it('pass the clear-peer-notes setting on with each digit', async () => {
      const { result } = await started();
      const peer = EMPTIES[1];
      act(() => result.current.actions.toggleCandidate(peer, answerAt(FIRST_EMPTY) as Digit));
      act(() => result.current.actions.updateSettings({ clearPeerNotes: true }));
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      expect(result.current.game?.cells[peer].notes).toBe(0);
    });

    it('run the rest of the controls', async () => {
      const { result } = await started();
      act(() => result.current.actions.setMode('candidate'));
      expect(result.current.game?.mode).toBe('candidate');
      act(() => result.current.actions.toggleMode());
      expect(result.current.game?.mode).toBe('normal');
      act(() => result.current.actions.move('right'));
      expect(result.current.game?.selected).toBe(FIRST_EMPTY + 1);
      act(() => result.current.actions.setAutoCandidates(true));
      expect(result.current.game?.autoCandidates).toBe(true);
      act(() => result.current.actions.undo());
      expect(result.current.game?.autoCandidates).toBe(false);
      act(() => result.current.actions.redo());
      expect(result.current.game?.autoCandidates).toBe(true);
      enter(result, FIRST_EMPTY, 9);
      act(() => result.current.actions.erase());
      expect(result.current.game?.cells[FIRST_EMPTY].value).toBe(0);
      enter(result, FIRST_EMPTY, 9);
      act(() => result.current.actions.check('cell'));
      expect(result.current.game?.cells[FIRST_EMPTY].mark).toBe('wrong');
      act(() => result.current.actions.reveal());
      expect(result.current.game?.cells[FIRST_EMPTY]).toMatchObject({
        value: answerAt(FIRST_EMPTY),
        mark: 'revealed',
      });
    });

    it('point a hint at a cell and name the technique, without filling it', async () => {
      const { result } = await started();
      act(() => result.current.actions.hint());
      const hint = result.current.game?.hint;
      expect(hint?.kind).toBe('single');
      expect(result.current.game?.selected).toBe(hint?.kind === 'single' ? hint.index : -1);
      expect(result.current.game?.assists.hints).toBe(1);
      expect(result.current.announcement?.text).toMatch(/single|full house/i);
    });

    it('point a hint at a mistake first', async () => {
      const { result } = await started();
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY) === 9 ? 1 : 9);
      act(() => result.current.actions.hint());
      expect(result.current.game?.hint).toEqual({ kind: 'mistake', index: FIRST_EMPTY });
    });
  });

  describe('the move log', () => {
    /**
     * A play clock of its own, apart from the wall clock and running from
     * another origin, as the monotonic one does: it moves with the fake timers.
     */
    const clock = (): number => Date.now() - NOW + 7_000_000;
    const wrong = (index: number): number => (answerAt(index) % 9) + 1;
    /** Each move logged, as [op, time on the play clock]. */
    const timeline = (moves: readonly LoggedMove[]) => moves.map((move) => [move.op, move.at]);

    it('records every kind of move at its time on the play clock, pauses left out', async () => {
      const { result, storage } = await started({ clock });
      const id = result.current.record!.id;
      const step = (ms: number, action: () => void): void => {
        advance(ms);
        act(action);
      };
      const { actions } = result.current;
      step(1000, () => actions.select(EMPTIES[0]));
      act(() => actions.enterDigit(answerAt(EMPTIES[0]) as Digit));
      step(1000, () => actions.toggleCandidate(EMPTIES[1], 1));
      step(1000, () => actions.select(EMPTIES[1]));
      act(() => actions.erase());
      step(1000, () => actions.setAutoCandidates(true));
      step(500, () => actions.setAutoCandidates(false));
      step(500, () => actions.undo());
      step(500, () => actions.redo());
      // A minute paused counts for nothing.
      step(0, () => actions.pause());
      step(60_000, () => actions.resume());
      step(1000, () => actions.hint());
      step(500, () => actions.showMe());
      // Nor does the time Show me's dialog is open.
      step(10_000, () => actions.closeDialog());
      step(1000, () => actions.select(EMPTIES[5]));
      act(() => actions.enterDigit(wrong(EMPTIES[5]) as Digit));
      step(500, () => actions.check('cell'));
      step(500, () => actions.select(EMPTIES[6]));
      act(() => actions.enterDigit(wrong(EMPTIES[6]) as Digit));
      act(() => actions.check('puzzle'));
      step(500, () => actions.select(EMPTIES[7]));
      act(() => actions.reveal());
      step(500, () => actions.requestReset());
      step(5000, () => actions.confirmReset());
      act(() => actions.pause());

      const log = loadMoveLog(storage, id)!;
      expect(timeline(log.moves)).toEqual([
        ['place', 1000],
        ['candidate', 2000],
        ['erase', 3000],
        ['autoOn', 4000],
        ['autoOff', 4500],
        ['undo', 5000],
        ['redo', 5500],
        ['hint', 6500],
        ['walkthrough', 7000],
        ['place', 8000],
        ['checkCell', 8500],
        ['place', 9000],
        ['checkPuzzle', 9000],
        ['reveal', 9500],
        ['reset', 10_000],
      ]);
      expect(result.current.elapsedMs).toBe(10_000);
      // And it replays to the game on screen.
      expect(verifyMoveLog(PUZZLE, log, result.current.game!)).toBe(true);
    });

    it('records the solving move, and keeps the log once the game is solved', async () => {
      const near = nearlySolved([0]);
      const { result, storage } = await started({ clock, source: fakeSource(near) });
      advance(2000);
      enter(result, 0, answerAt(0));
      expect(result.current.phase).toBe('solved');
      const log = loadMoveLog(storage, result.current.record!.id)!;
      expect(timeline(log.moves)).toEqual([['place', 2000]]);
      expect(verifyMoveLog(near, log, result.current.game!)).toBe(true);
    });

    it('logs nothing for moves that change nothing, and saves the log no more often than the game', async () => {
      const { result, storage } = await started({ clock });
      const id = result.current.record!.id;
      act(() => result.current.actions.select(EMPTIES[3]));
      act(() => result.current.actions.setMode('candidate'));
      act(() => result.current.actions.erase());
      advance(SAVE_DELAY_MS);
      expect(loadMoveLog(storage, id)?.moves).toEqual([]);
      const encoded = loadEncodedMoveLog(storage, id);
      advance(CLOCK_SAVE_MS);
      expect(loadEncodedMoveLog(storage, id)).toBe(encoded);
    });

    it('goes on with the log after a reload', async () => {
      const storage = memoryStorage();
      const first = await started({ clock, storage });
      const id = first.result.current.record!.id;
      advance(3000);
      enter(first.result, EMPTIES[0], answerAt(EMPTIES[0]));
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      first.unmount();

      const second = setup({ clock, storage });
      expect(second.result.current.record?.id).toBe(id);
      advance(30_000);
      act(() => second.result.current.actions.resume());
      advance(2000);
      enter(second.result, EMPTIES[1], answerAt(EMPTIES[1]));
      act(() => second.result.current.actions.pause());
      expect(timeline(loadMoveLog(storage, id)!.moves)).toEqual([
        ['place', 3000],
        ['place', 5000],
      ]);
    });

    it('stops recording a game a tab on an older version played on, leaving no log', async () => {
      const storage = memoryStorage();
      const first = await started({ clock, storage });
      const id = first.result.current.record!.id;
      enter(first.result, EMPTIES[0], answerAt(EMPTIES[0]));
      act(() => first.result.current.actions.pause());
      first.unmount();
      // The old tab moves the board on and saves it, knowing nothing of logs.
      const game = reduce(first.result.current.game!, {
        type: 'enter',
        digit: answerAt(EMPTIES[1]) as Digit,
        index: EMPTIES[1],
      });
      storage.setItem(`sudoku.game.${id}`, JSON.stringify(serialiseGame(game)));

      const second = setup({ clock, storage });
      act(() => second.result.current.actions.resume());
      enter(second.result, EMPTIES[2], answerAt(EMPTIES[2]));
      act(() => second.result.current.actions.pause());
      expect(second.result.current.game?.cells[EMPTIES[2]].value).toBe(answerAt(EMPTIES[2]));
      expect(loadEncodedMoveLog(storage, id)).toBeNull();
      expect(readMoveLogIds(storage)).toEqual([]);
    });

    it('deletes a glimpsed game’s log with it', async () => {
      const { result, storage } = await started({ source: fakeSource(PUZZLE, nearlySolved([1])) });
      const glimpsed = result.current.record!.id;
      expect(readMoveLogIds(storage)).toEqual([glimpsed]);
      act(() => result.current.actions.newGame('easy'));
      await settle();
      expect(loadEncodedMoveLog(storage, glimpsed)).toBeNull();
      expect(readMoveLogIds(storage)).toEqual([result.current.record!.id]);
    });

    it('deletes a game’s log when History deletes the game', async () => {
      const { result, storage } = await started();
      const id = result.current.record!.id;
      enter(result, EMPTIES[0], answerAt(EMPTIES[0]));
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.deleteRecord(id));
      expect(loadEncodedMoveLog(storage, id)).toBeNull();
    });

    it('sweeps away logs whose game is no longer in the history as a visit starts', async () => {
      const storage = memoryStorage();
      storeMoveLog(storage, 'gone-0000', 'AB_');
      const { result } = await started({ storage });
      expect(readMoveLogIds(storage)).toEqual([result.current.record!.id]);
    });
  });

  describe('mistakes', () => {
    /** A play clock of its own, moving with the fake timers (see 'the move log'). */
    const clock = (): number => Date.now() - NOW + 7_000_000;
    /** Two cells to finish; the first, a full house, is the obvious one to slip in. */
    const near = nearlySolved([0, 1]);
    const slipped = (answerAt(0) % 9) + 1;

    /** The completion dialog's result, once it opens. */
    function completed(result: Hook) {
      advance(COMPLETION_DELAY_MS);
      const { dialog } = result.current;
      if (dialog?.kind !== 'completion') throw new Error('no completion dialog');
      return dialog.result;
    }

    it('forgives an obvious slip put right 2.9 s later, and says so at the solve', async () => {
      const { result, storage } = await started({ clock, source: fakeSource(near) });
      advance(1000);
      enter(result, 0, slipped);
      advance(2900);
      enter(result, 0, answerAt(0));
      advance(1000);
      enter(result, 1, answerAt(1));
      expect(completed(result).mistakes).toEqual({ values: 0, candidates: 0 });
      expect(loadHistory(storage)[0].mistakes).toEqual({ values: 0, candidates: 0, atMs: 4900 });
    });

    it('counts an obvious slip put right 3.1 s later', async () => {
      const { result, storage } = await started({ clock, source: fakeSource(near) });
      advance(1000);
      enter(result, 0, slipped);
      advance(3100);
      enter(result, 0, answerAt(0));
      advance(1000);
      enter(result, 1, answerAt(1));
      expect(completed(result).mistakes).toEqual({ values: 1, candidates: 0 });
      expect(loadHistory(storage)[0].mistakes).toEqual({ values: 1, candidates: 0, atMs: 5100 });
    });

    it('stops the window while the game is paused: only play time uses it up', async () => {
      const { result } = await started({ clock, source: fakeSource(near) });
      advance(1000);
      enter(result, 0, slipped);
      advance(1000);
      act(() => result.current.actions.pause());
      advance(60_000);
      act(() => result.current.actions.resume());
      // A dialog stops the clock too.
      act(() => result.current.actions.openDialog('help'));
      advance(30_000);
      act(() => result.current.actions.closeDialog());
      advance(1900);
      enter(result, 0, answerAt(0));
      enter(result, 1, answerAt(1));
      expect(completed(result).mistakes).toEqual({ values: 0, candidates: 0 });
    });

    it('shows nothing while the game is played, nor in History for an unfinished game', async () => {
      const { result, storage } = await started({ clock, source: fakeSource(near) });
      enter(result, 0, slipped);
      advance(CLOCK_SAVE_MS);
      // Counted on the record, which History never shows for a game not solved.
      const [record] = loadHistory(storage);
      expect(record.mistakes).toMatchObject({ values: 1 });
      expect(recordedMistakes(record)).toBeNull();
    });

    it('knows no mistakes for a game not recorded move by move', async () => {
      const storage = memoryStorage();
      const first = await started({ clock, storage, source: fakeSource(near) });
      const id = first.result.current.record!.id;
      enter(first.result, 0, answerAt(0));
      act(() => first.result.current.actions.pause());
      first.unmount();
      // As a game begun before logs were kept: a board, and no log.
      storage.removeItem(`sudoku.moves.${id}`);

      const second = setup({ clock, storage });
      act(() => second.result.current.actions.resume());
      enter(second.result, 1, answerAt(1));
      expect(completed(second.result).mistakes).toBeNull();
      expect(loadHistory(storage)[0]).not.toHaveProperty('mistakes');
    });

    it('counts, as a visit starts, the mistakes of a game solved before they were counted', async () => {
      const storage = memoryStorage();
      const first = await started({ clock, storage, source: fakeSource(near, PUZZLE) });
      const id = first.result.current.record!.id;
      advance(1000);
      enter(first.result, 0, slipped);
      advance(5000);
      enter(first.result, 0, answerAt(0));
      enter(first.result, 1, answerAt(1));
      advance(COMPLETION_DELAY_MS);
      act(() => first.result.current.actions.newGame('easy'));
      await settle();
      first.unmount();
      // As a version that kept logs but did not count mistakes left the record.
      const records = loadHistory(storage).map(({ mistakes: _, ...record }) => record);
      storage.setItem('sudoku.history', JSON.stringify(records));
      expect(loadHistory(storage).find((record) => record.id === id)).not.toHaveProperty(
        'mistakes',
      );

      await started({ clock, storage });
      const repaired = loadHistory(storage).find((record) => record.id === id)!;
      expect(recordedMistakes(repaired)).toEqual({ values: 1, candidates: 0 });
    });
  });

  describe('Check guesses when entered, and the error counter', () => {
    const clock = (): number => Date.now() - NOW + 7_000_000;
    const near = nearlySolved([0, 1]);
    /** A wrong digit for a cell. */
    const wrong = (cell: number) => (answerAt(cell) % 9) + 1;

    function withSettings(settings: Record<string, boolean>): StorageLike {
      const storage = memoryStorage();
      storage.setItem('sudoku.prefs', JSON.stringify({ settings }));
      return storage;
    }

    function completed(result: Hook) {
      advance(COMPLETION_DELAY_MS);
      const { dialog } = result.current;
      if (dialog?.kind !== 'completion') throw new Error('no completion dialog');
      return dialog.result;
    }

    it('marks a wrong number and counts it at once, and records the help with the time', async () => {
      const storage = withSettings({ checkGuesses: true });
      const { result } = await started({ clock, storage, source: fakeSource(near) });
      expect(result.current.game?.checkGuesses).toBe(true);
      advance(1000);
      enter(result, 0, wrong(0));
      expect(result.current.game?.cells[0].mark).toBe('wrong');
      expect(result.current.announcement?.text).toMatch(/ Incorrect\.$/);
      enter(result, 0, answerAt(0));
      expect(result.current.game?.cells[0].mark).toBe('none');
      enter(result, 1, answerAt(1));
      const outcome = completed(result);
      // Put right at once, but counted: with Check guesses on nothing is forgiven.
      expect(outcome.mistakes).toEqual({ values: 1, candidates: 0 });
      expect(outcome.assists).toEqual({ ...NO_HELP, checkGuesses: true });
      expect(loadHistory(storage)[0].assists).toEqual({ ...NO_HELP, checkGuesses: true });
      const id = result.current.record!.id;
      expect(loadMoveLog(storage, id)?.moves[0]).toEqual({ op: 'checkGuessesOn', at: 0 });
    });

    it('takes effect as Settings closes, judging nothing entered before, and stays on the record', async () => {
      const { result, storage } = await started({ clock, source: fakeSource(near) });
      advance(1000);
      enter(result, 0, wrong(0));
      act(() => result.current.actions.openDialog('settings'));
      act(() => result.current.actions.updateSettings({ checkGuesses: true }));
      expect(result.current.game?.checkGuesses).toBe(false);
      act(() => result.current.actions.closeDialog());
      expect(result.current.game?.checkGuesses).toBe(true);
      expect(result.current.game?.cells[0].mark).toBe('none');
      expect(result.current.game?.assists.checkGuesses).toBe(true);
      enter(result, 1, wrong(1));
      expect(result.current.game?.cells[1].mark).toBe('wrong');

      act(() => result.current.actions.openDialog('settings'));
      act(() => result.current.actions.updateSettings({ checkGuesses: false }));
      act(() => result.current.actions.closeDialog());
      enter(result, 1, (wrong(1) % 9) + 1);
      expect(result.current.game?.cells[1].mark).toBe('none');
      expect(result.current.game?.assists.checkGuesses).toBe(true);

      act(() => result.current.actions.pause());
      const log = loadMoveLog(storage, result.current.record!.id)!;
      expect(log.moves.map((move) => move.op)).toEqual([
        'place',
        'checkGuessesOn',
        'place',
        'checkGuessesOff',
        'place',
      ]);
      expect(loadHistory(storage)[0].assists.checkGuesses).toBe(true);
    });

    it('records no help for a game behind Start whose player switches it off before starting', async () => {
      const storage = withSettings({ checkGuesses: true });
      // A first visit opened in a background tab: the game waits behind Start.
      setVisibility('hidden');
      const { result } = await started({ clock, storage, source: fakeSource(near) });
      setVisibility('visible');
      expect(result.current.phase).toBe('ready');
      expect(result.current.record?.assists.checkGuesses).toBeUndefined();
      act(() => result.current.actions.openDialog('settings'));
      act(() => result.current.actions.updateSettings({ checkGuesses: false }));
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.resume());
      enter(result, 0, wrong(0));
      expect(result.current.game?.cells[0].mark).toBe('none');
      act(() => result.current.actions.pause());
      expect(loadHistory(storage)[0].assists.checkGuesses).toBeUndefined();
      const log = loadMoveLog(storage, result.current.record!.id)!;
      expect(log.moves.map((move) => move.op)).toEqual(['place']);
    });

    it('says it is help as Settings closes on a game already on show, as the help taken ticks', async () => {
      const { result } = await started({ clock, source: fakeSource(near) });
      expect(result.current.hasBoardShown).toBe(true);
      act(() => result.current.actions.openDialog('settings'));
      act(() => result.current.actions.updateSettings({ checkGuesses: true }));
      act(() => result.current.actions.closeDialog());
      expect(result.current.announcement?.text).toBe('Checked as entered. Counts as help.');
      // Switched off and on again, the game already had it: nothing more to say.
      const said = result.current.announcement;
      act(() => result.current.actions.openDialog('settings'));
      act(() => result.current.actions.updateSettings({ checkGuesses: false }));
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.openDialog('settings'));
      act(() => result.current.actions.updateSettings({ checkGuesses: true }));
      act(() => result.current.actions.closeDialog());
      expect(result.current.announcement).toBe(said);
    });

    it('says it is help with "Resumed." for a paused game that takes it up as play resumes', async () => {
      const { result } = await started({ clock, source: fakeSource(near) });
      act(() => result.current.actions.pause());
      act(() => result.current.actions.openDialog('settings'));
      act(() => result.current.actions.updateSettings({ checkGuesses: true }));
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('paused');
      expect(result.current.announcement?.text).toBe('Paused.');
      act(() => result.current.actions.resume());
      expect(result.current.announcement?.text).toBe(
        'Resumed. Checked as entered. Counts as help.',
      );
    });

    it('says nothing of it for a game behind Start, which opens with it', async () => {
      const storage = withSettings({ checkGuesses: true });
      setVisibility('hidden');
      const { result } = await started({ clock, storage, source: fakeSource(near) });
      setVisibility('visible');
      expect(result.current.hasBoardShown).toBe(false);
      act(() => result.current.actions.resume());
      expect(result.current.hasBoardShown).toBe(true);
      expect(result.current.game?.assists.checkGuesses).toBe(true);
      expect(result.current.announcement?.text).toBe('Started.');
    });

    it('says nothing of it with help taken hidden', async () => {
      const storage = withSettings({ showHelpTaken: false });
      const { result } = await started({ clock, storage, source: fakeSource(near) });
      const said = result.current.announcement;
      act(() => result.current.actions.openDialog('settings'));
      act(() => result.current.actions.updateSettings({ checkGuesses: true }));
      act(() => result.current.actions.closeDialog());
      expect(result.current.game?.assists.checkGuesses).toBe(true);
      expect(result.current.announcement).toBe(said);
    });

    it('takes it up from 0:00 for a game behind Start started with it still on', async () => {
      const storage = withSettings({ checkGuesses: true });
      setVisibility('hidden');
      const { result } = await started({ clock, storage, source: fakeSource(near) });
      setVisibility('visible');
      act(() => result.current.actions.resume());
      expect(result.current.game?.checkGuesses).toBe(true);
      expect(result.current.game?.assists.checkGuesses).toBe(true);
      enter(result, 0, wrong(0));
      expect(result.current.game?.cells[0].mark).toBe('wrong');
      act(() => result.current.actions.pause());
      const log = loadMoveLog(storage, result.current.record!.id)!;
      expect(log.moves[0]).toEqual({ op: 'checkGuessesOn', at: 0 });
    });

    it('is taken up by a game reopened with the setting changed since', async () => {
      const storage = memoryStorage();
      const first = await started({ clock, storage, source: fakeSource(near) });
      enter(first.result, 0, wrong(0));
      act(() => first.result.current.actions.pause());
      first.unmount();
      storage.setItem('sudoku.prefs', JSON.stringify({ settings: { checkGuesses: true } }));

      const second = setup({ clock, storage });
      expect(second.result.current.game?.checkGuesses).toBe(false);
      act(() => second.result.current.actions.resume());
      expect(second.result.current.game?.checkGuesses).toBe(true);
      expect(second.result.current.game?.cells[0].mark).toBe('none');
    });

    it('counts nothing on the counter while the setting is off', async () => {
      const { result } = await started({ clock, source: fakeSource(near) });
      enter(result, 0, wrong(0));
      advance(10_000);
      expect(result.current.mistakesSoFar).toBeNull();
    });

    it('moves the counter only once a slip’s 3 seconds of play are up, with Check guesses off', async () => {
      const storage = withSettings({ showErrorCounter: true });
      const { result } = await started({ clock, storage });
      expect(result.current.mistakesSoFar).toEqual({ values: 0, candidates: 0 });
      advance(1000);
      // Cell 2's answer (4) is not obvious: a wrong number there counts however soon it goes.
      enter(result, FIRST_EMPTY, 1);
      advance(2000);
      expect(result.current.mistakesSoFar).toEqual({ values: 0, candidates: 0 });
      // Paused, the window waits.
      act(() => result.current.actions.pause());
      advance(10_000);
      expect(result.current.mistakesSoFar).toEqual({ values: 0, candidates: 0 });
      act(() => result.current.actions.resume());
      advance(1000);
      expect(result.current.mistakesSoFar).toEqual({ values: 1, candidates: 0 });
    });

    it('never moves the counter for an obvious slip put right in time', async () => {
      const storage = withSettings({ showErrorCounter: true });
      const { result } = await started({ clock, storage, source: fakeSource(near) });
      advance(1000);
      enter(result, 0, wrong(0));
      advance(1000);
      enter(result, 0, answerAt(0));
      advance(10_000);
      expect(result.current.mistakesSoFar).toEqual({ values: 0, candidates: 0 });
    });

    it('moves the counter at once with Check guesses on', async () => {
      const storage = withSettings({ showErrorCounter: true, checkGuesses: true });
      const { result } = await started({ clock, storage });
      advance(1500);
      enter(result, FIRST_EMPTY, 1);
      expect(result.current.mistakesSoFar).toEqual({ values: 1, candidates: 0 });
    });

    it('counts nothing it cannot vouch for: a game not recorded move by move', async () => {
      const storage = withSettings({ showErrorCounter: true });
      const first = await started({ clock, storage, source: fakeSource(near) });
      const id = first.result.current.record!.id;
      enter(first.result, 0, answerAt(0));
      act(() => first.result.current.actions.pause());
      first.unmount();
      storage.removeItem(`sudoku.moves.${id}`);
      const second = setup({ clock, storage });
      expect(second.result.current.mistakesSoFar).toBeNull();
    });
  });

  describe('solving', () => {
    it('stops the clock at the solving move and records the time', async () => {
      const near = nearlySolved([0]);
      const { result, storage } = await started({ source: fakeSource(near) });
      advance(83_400);
      enter(result, 0, answerAt(0));

      expect(result.current.phase).toBe('solved');
      expect(result.current.isCelebrating).toBe(true);
      expect(result.current.announcement?.text).toBe('Solved in 1:23.');
      const [record] = loadHistory(storage);
      expect(record).toMatchObject({
        status: 'solved',
        elapsedMs: 83_400,
        completedAt: NOW + 83_400,
      });
      advance(10_000);
      expect(result.current.elapsedMs).toBe(83_400);
    });

    it('opens the completion dialog a beat after the solve', async () => {
      const { result } = await started({ source: fakeSource(nearlySolved([0])) });
      advance(5000);
      enter(result, 0, answerAt(0));
      expect(result.current.dialog).toBeNull();
      advance(COMPLETION_DELAY_MS - 1);
      expect(result.current.dialog).toBeNull();
      advance(1);
      expect(result.current.dialog).toMatchObject({
        kind: 'completion',
        result: {
          elapsedMs: 5000,
          isNewBest: false,
          stats: { played: 1, solved: 1, bestMs: 5000, averageMs: 5000 },
          challenge: null,
        },
      });
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('solved');
    });

    it('calls a time a new best only when it beats an earlier best', async () => {
      const near = nearlySolved([0]);
      const storage = memoryStorage();
      upsertRecord(storage, solvedRecord(another(near), 600_000));
      const { result } = await started({ storage, source: fakeSource(near) });
      advance(5000);
      enter(result, 0, answerAt(0));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({ result: { isNewBest: true } });
    });

    it('never calls a revealed solve a new best', async () => {
      const near = nearlySolved([0]);
      const storage = memoryStorage();
      upsertRecord(storage, solvedRecord(another(near), 600_000));
      const { result } = await started({ storage, source: fakeSource(near) });
      act(() => result.current.actions.select(0));
      act(() => result.current.actions.reveal());
      expect(result.current.phase).toBe('solved');
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({ result: { isNewBest: false } });
    });

    it('does not open the completion dialog over another', async () => {
      const { result } = await started({ source: fakeSource(nearlySolved([0])) });
      enter(result, 0, answerAt(0));
      act(() => result.current.actions.openDialog('help'));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toEqual({ kind: 'help' });
    });

    it('shares the time once solved', async () => {
      const { result } = await started({ source: fakeSource(nearlySolved([0])) });
      advance(61_000);
      enter(result, 0, answerAt(0));
      advance(COMPLETION_DELAY_MS);
      act(() => result.current.actions.shareResult());
      expect(result.current.dialog).toMatchObject({
        kind: 'share',
        target: { result: { seconds: 61, assists: NO_HELP } },
      });
    });

    it('says when a full board is not right, until it is no longer full', async () => {
      const near = nearlySolved([0, 1]);
      const { result } = await started({ source: fakeSource(near) });
      enter(result, 0, answerAt(1));
      enter(result, 1, answerAt(0));
      expect(result.current.phase).toBe('playing');
      expect(result.current.notice?.kind).toBe('boardFull');
      expect(result.current.announcement?.text).toMatch(/something isn't right\.$/);
      act(() => result.current.actions.erase());
      expect(result.current.notice).toBeNull();
    });

    it('clears the full-board notice when the board is finally solved', async () => {
      const near = nearlySolved([0, 1]);
      const { result } = await started({ source: fakeSource(near) });
      enter(result, 0, answerAt(0));
      enter(result, 1, answerAt(0));
      expect(result.current.notice?.kind).toBe('boardFull');
      enter(result, 1, answerAt(1));
      expect(result.current.phase).toBe('solved');
      expect(result.current.notice).toBeNull();
    });
  });

  describe('reset', () => {
    it('asks first, holding the clock while it asks', async () => {
      const { result } = await started();
      act(() => result.current.actions.requestReset());
      expect(result.current.dialog).toEqual({ kind: 'confirmReset' });
      expect(result.current.pauseReason).toBe('dialog');
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('playing');
    });

    it('clears the board but not the clock, which carries on as the confirmation closes', async () => {
      // Otherwise a player could study the board, reset, and bank a time that
      // left the studying out.
      const { result, storage } = await started();
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      advance(30_000);
      act(() => result.current.actions.requestReset());
      advance(5000);
      act(() => result.current.actions.confirmReset());
      expect(result.current.dialog).toBeNull();
      expect(result.current.phase).toBe('playing');
      expect(result.current.game?.cells[FIRST_EMPTY].value).toBe(0);
      expect(result.current.elapsedMs).toBe(30_000);
      expect(loadHistory(storage)[0].elapsedMs).toBe(30_000);
      expect(result.current.announcement?.text).toBe('Puzzle reset.');
      advance(1000);
      expect(result.current.elapsedMs).toBe(31_000);
    });
  });

  describe('a new game', () => {
    it('keeps the old game resumable and starts the new one at once', async () => {
      const second = nearlySolved([1, 2, 3]);
      const { result, storage, source } = await started({ source: fakeSource(PUZZLE, second) });
      const first = result.current.record!.id;
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      advance(12_000);
      act(() => result.current.actions.newGame('expert'));
      expect(result.current.phase).toBe('loading');
      expect(result.current.difficulty).toBe('expert');
      expect(loadPreferences(storage).lastDifficulty).toBe('expert');

      await settle();
      expect((source as ReturnType<typeof fakeSource>).requests).toEqual(['easy', 'expert']);
      expect(result.current.phase).toBe('playing');
      expect(result.current.record?.givens).toBe(second.givens);
      expect(result.current.elapsedMs).toBe(0);
      const old = loadHistory(storage).find((record) => record.id === first)!;
      expect(old).toMatchObject({ status: 'playing', elapsedMs: 12_000 });
      expect(loadGameBlob(storage, first)).not.toBeNull();
    });

    it('falls back to the old game, paused, when the new one cannot be made', async () => {
      let calls = 0;
      const working = fakeSource();
      const source: PuzzleSource = {
        next: (difficulty) =>
          ++calls === 1 ? working.next(difficulty) : Promise.reject(new Error('down')),
        prefetch: () => {},
        dispose: () => {},
      };
      const { result } = await started({ source });
      act(() => result.current.actions.newGame('hard'));
      await settle();
      expect(result.current.phase).toBe('paused');
      expect(result.current.isLoadFailed).toBe(false);
      expect(result.current.notice?.kind).toBe('generationFailed');
    });

    it('closes the completion dialog it was started from', async () => {
      const { result } = await started({ source: fakeSource(nearlySolved([0]), PUZZLE) });
      enter(result, 0, answerAt(0));
      advance(COMPLETION_DELAY_MS);
      act(() => result.current.actions.newGame('easy'));
      expect(result.current.dialog).toBeNull();
      await settle();
      expect(result.current.phase).toBe('playing');
    });

    it('ignores a puzzle that arrives after a newer request', async () => {
      const resolvers: ((puzzle: Puzzle) => void)[] = [];
      const source: PuzzleSource = {
        next: () => new Promise((resolve) => resolvers.push(resolve)),
        prefetch: () => {},
        dispose: () => {},
      };
      const { result } = setup({ source });
      act(() => result.current.actions.newGame('medium'));
      await act(async () => resolvers[1]({ ...PUZZLE, difficulty: 'medium' }));
      await act(async () => resolvers[0]({ ...nearlySolved([0]), difficulty: 'easy' }));
      expect(result.current.record?.difficulty).toBe('medium');
    });
  });

  describe('history', () => {
    /** Two games in history: an older one and the one on screen. */
    async function twoGames() {
      const second = nearlySolved([30, 31, 32, 33]);
      const view = await started({ source: fakeSource(PUZZLE, second) });
      const { result } = view;
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      advance(20_000);
      const older = result.current.record!.id;
      act(() => result.current.actions.newGame('easy'));
      await settle();
      // Played, not just glimpsed, so it is kept when another game replaces it.
      enter(result, 33, answerAt(33));
      advance(7000);
      return { ...view, older, current: result.current.record!.id };
    }

    it('lists every game when opened, with the ones that can be resumed', async () => {
      const { result, older, current } = await twoGames();
      act(() => result.current.actions.openDialog('history'));
      expect(result.current.history.records.map((record) => record.id)).toEqual([current, older]);
      expect([...result.current.history.resumableIds].sort()).toEqual([current, older].sort());
      expect(result.current.history.now).toBe(Date.now());
      // The game on screen is listed as it stands, not as it was last saved.
      expect(result.current.history.records[0].elapsedMs).toBe(7000);
    });

    it('resumes an older game, leaving the one on screen saved and stopped', async () => {
      const { result, storage, older, current } = await twoGames();
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.resumeRecord(older));
      expect(result.current.dialog).toBeNull();
      expect(result.current.record?.id).toBe(older);
      expect(result.current.phase).toBe('playing');
      expect(result.current.elapsedMs).toBe(20_000);
      expect(result.current.game?.cells[FIRST_EMPTY].value).toBe(answerAt(FIRST_EMPTY));
      expect(loadCurrentId(storage)).toBe(older);

      advance(60_000);
      // Two clocks must never run at once: the game left behind kept its 7s.
      const left = loadHistory(storage).find((record) => record.id === current)!;
      expect(left.elapsedMs).toBe(7000);
    });

    it('treats resuming the game on screen as closing the list', async () => {
      const { result, current } = await twoGames();
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.resumeRecord(current));
      expect(result.current.dialog).toBeNull();
      expect(result.current.phase).toBe('playing');
    });

    it('says so when a game cannot be resumed', async () => {
      const { result } = await twoGames();
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.resumeRecord('nope-0000'));
      expect(result.current.notice?.kind).toBe('resumeFailed');
      expect(result.current.dialog).toBeNull();
    });

    it('replays a solved game as a new one of the same puzzle', async () => {
      const storage = memoryStorage();
      upsertRecord(storage, solvedRecord(PUZZLE, 290_000));
      const { result } = await started({ storage, source: fakeSource(another(PUZZLE)) });
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.replayRecord('old-0001'));
      expect(result.current.record).toMatchObject({ source: 'replay', givens: PUZZLE.givens });
      expect(result.current.record?.id).not.toBe('old-0001');
      expect(result.current.game?.cells[FIRST_EMPTY].value).toBe(0);
      expect(result.current.phase).toBe('playing');
      expect(result.current.announcement?.text).toBe('Playing this Easy puzzle again.');
      // The solve and the replay: the game on screen was only glimpsed, so it went.
      expect(loadHistory(storage)).toHaveLength(2);
    });

    it('plays a puzzle again by resuming its unfinished attempt, never beginning a second', async () => {
      // With two, one could be studied while the other sat at 0:00.
      const { result, storage, older } = await twoGames();
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.replayRecord(older));
      expect(result.current.record?.id).toBe(older);
      expect(result.current.game?.cells[FIRST_EMPTY].value).toBe(answerAt(FIRST_EMPTY));
      expect(result.current.elapsedMs).toBe(20_000);
      expect(result.current.phase).toBe('playing');
      expect(result.current.announcement?.text).toBe('Resumed Easy puzzle.');
      expect(loadHistory(storage)).toHaveLength(2);
    });

    it('starts afresh, as a replay, when the unfinished attempt cannot be reopened', async () => {
      const storage = memoryStorage();
      // An unfinished attempt whose saved board has been pruned.
      upsertRecord(storage, { ...solvedRecord(PUZZLE, 40_000, 'gone-0001'), status: 'playing' });
      const { result } = await started({ storage, source: fakeSource(another(PUZZLE)) });
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.replayRecord('gone-0001'));
      expect(result.current.record).toMatchObject({ source: 'replay', givens: PUZZLE.givens });
      expect(result.current.record?.id).not.toBe('gone-0001');
    });

    it('plays the puzzle on screen again by carrying on with it', async () => {
      const { result, storage, current } = await twoGames();
      enter(result, 30, answerAt(30));
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.replayRecord(current));
      expect(result.current.record?.id).toBe(current);
      // As it stood on screen, not as it was last saved.
      expect(result.current.game?.cells[30].value).toBe(answerAt(30));
      expect(result.current.phase).toBe('playing');
      expect(loadHistory(storage)).toHaveLength(2);
    });

    it('plays a shared puzzle never started by starting it', async () => {
      const storage = memoryStorage();
      const near = nearlySolved([0, 10, 20]);
      const linked = setup({ storage, search: linkFor(near.givens, { t: '95', n: 'Dan' }) });
      const shared = linked.result.current.record!.id;
      linked.unmount();
      const { result } = setup({ storage, source: fakeSource() });
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.replayRecord(shared));
      expect(result.current.record).toMatchObject({ id: shared, source: 'shared' });
      expect(result.current.phase).toBe('playing');
      expect(result.current.announcement?.text).toBe('Started Easy puzzle.');
      expect(loadHistory(storage)).toHaveLength(1);
    });

    it('says so when a game cannot be replayed', async () => {
      const { result } = await twoGames();
      act(() => result.current.actions.replayRecord('nope-0000'));
      expect(result.current.notice?.kind).toBe('resumeFailed');
    });

    it('shares a game from the list and comes back to it', async () => {
      const { result, older } = await twoGames();
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.shareRecord(older));
      expect(result.current.dialog).toMatchObject({
        kind: 'share',
        target: { givens: PUZZLE.givens, result: null },
        returnTo: 'history',
      });
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toEqual({ kind: 'history' });
      // Still paused for the list.
      expect(result.current.pauseReason).toBe('dialog');
      act(() => result.current.actions.shareRecord('nope-0000'));
      expect(result.current.dialog).toEqual({ kind: 'history' });
    });

    it('deletes an older game', async () => {
      const { result, storage, older, current } = await twoGames();
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.deleteRecord(older));
      expect(result.current.history.records.map((record) => record.id)).toEqual([current]);
      expect(loadHistory(storage)).toHaveLength(1);
      expect(result.current.record?.id).toBe(current);
    });

    it('replaces the game on screen when it is deleted, once the list closes', async () => {
      const { result, storage, current, source } = await twoGames();
      act(() => result.current.actions.newGame('hard'));
      await settle();
      const hard = result.current.record!.id;
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.deleteRecord(hard));
      // Nothing is made behind the list: it would be a game the player never saw.
      await settle();
      expect(result.current.record).toBeNull();
      expect(result.current.difficulty).toBe('hard');
      expect((source as ReturnType<typeof fakeSource>).requests).toEqual(['easy', 'easy', 'hard']);
      expect(result.current.history.records.map((record) => record.id)).not.toContain(hard);
      expect(loadCurrentId(storage)).toBeNull();
      expect(loadHistory(storage).some((record) => record.id === current)).toBe(true);
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('loading');
      await settle();
      expect(result.current.phase).toBe('playing');
      expect(result.current.record?.difficulty).toBe('hard');
      expect(loadCurrentId(storage)).toBe(result.current.record?.id);
    });

    it('can be emptied', async () => {
      const { result, storage, older, current } = await twoGames();
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.deleteRecord(current));
      act(() => result.current.actions.deleteRecord(older));
      await settle();
      expect(result.current.history.records).toEqual([]);
      expect(loadHistory(storage)).toEqual([]);
    });

    it('resumes another game after the one on screen was deleted, making none', async () => {
      const { result, storage, older, current, source } = await twoGames();
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.deleteRecord(current));
      act(() => result.current.actions.resumeRecord(older));
      await settle();
      expect(result.current.record?.id).toBe(older);
      expect((source as ReturnType<typeof fakeSource>).requests).toHaveLength(2);
      expect(loadHistory(storage).map((record) => record.id)).toEqual([older]);
    });

    it('exports the history, and imports one back', async () => {
      const { result, storage } = await twoGames();
      const json = result.current.actions.exportHistory();
      expect(JSON.parse(json).records).toHaveLength(2);

      const other = memoryStorage();
      upsertRecord(other, solvedRecord(nearlySolved([0, 1]), 99_000, 'imp-0001'));
      act(() => result.current.actions.openDialog('history'));
      let outcome: ReturnType<typeof result.current.actions.importHistory> | undefined;
      act(() => {
        outcome = result.current.actions.importHistory(exportHistory(other, NOW));
      });
      expect(outcome).toEqual({ ok: true, added: 1, updated: 0 });
      expect(result.current.history.records).toHaveLength(3);
      expect(loadHistory(storage)).toHaveLength(3);
      expect(result.current.actions.importHistory('not json')).toEqual({ ok: false });
    });
  });
  describe('honest times', () => {
    /** A source whose puzzles arrive only when the test says so. */
    function deferredSource() {
      const pending: ((puzzle: Puzzle) => void)[] = [];
      const source: PuzzleSource = {
        next: (difficulty) =>
          new Promise((resolve) => pending.push((puzzle) => resolve({ ...puzzle, difficulty }))),
        prefetch: () => {},
        dispose: () => {},
      };
      const deliver = async (puzzle: Puzzle = PUZZLE) => {
        await act(async () => pending.shift()!(puzzle));
      };
      return { source, deliver };
    }

    it('holds a puzzle that arrives in a hidden tab behind Start, counting nothing', async () => {
      // A first visit opened in a background tab.
      setVisibility('hidden');
      const { result, storage } = await started();
      expect(result.current.phase).toBe('ready');
      expect(result.current.record?.source).toBe('generated');
      advance(5000);
      setVisibility('visible');
      expect(result.current.elapsedMs).toBe(0);
      // It is the player's game, waiting for them: saved, and current.
      expect(loadCurrentId(storage)).toBe(result.current.record?.id);
      act(() => result.current.actions.resume());
      expect(result.current.announcement?.text).toBe('Started.');
      advance(2000);
      expect(result.current.elapsedMs).toBe(2000);
    });

    it('holds a new game the player switched away from behind Start', async () => {
      const { source, deliver } = deferredSource();
      const { result } = setup({ source });
      await deliver();
      act(() => result.current.actions.newGame('expert'));
      setVisibility('hidden');
      await deliver(nearlySolved([1, 2, 3]));
      advance(5000);
      setVisibility('visible');
      expect(result.current.phase).toBe('ready');
      expect(result.current.difficulty).toBe('expert');
      expect(result.current.elapsedMs).toBe(0);
    });

    it('keeps counting when the system clock is set back, and banks the whole time', async () => {
      const near = nearlySolved([0]);
      const { result, storage } = await started({ source: fakeSource(near) });
      advance(30_000);
      // The device clock moved back an hour: play is timed by a monotonic clock.
      act(() => vi.setSystemTime(Date.now() - 3_600_000));
      advance(120_000);
      expect(result.current.elapsedMs).toBe(150_000);
      enter(result, 0, answerAt(0));
      expect(result.current.announcement?.text).toBe('Solved in 2:30.');
      const [record] = loadHistory(storage);
      expect(record.elapsedMs).toBe(150_000);
      // Dates still come from the wall clock (stored no earlier than the
      // game's creation, which the history insists on).
      expect(result.current.record?.completedAt).toBe(Date.now());
      expect(record.completedAt).toBe(record.createdAt);
    });

    it('saves once, not twice, when the clock’s save beats a move’s', async () => {
      const { result, storage } = await started();
      advance(CLOCK_SAVE_MS - 200);
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      const writes = vi.spyOn(storage, 'setItem');
      advance(200);
      const saved = writes.mock.calls.length;
      expect(saved).toBeGreaterThan(0);
      advance(SAVE_DELAY_MS);
      expect(writes.mock.calls.length).toBe(saved);
    });

    it('saves the time on a running clock every few seconds, with no move to save it', async () => {
      // A crash or a force-quit fires no event to save on.
      const { result, storage } = await started();
      advance(CLOCK_SAVE_MS);
      expect(loadHistory(storage)[0].elapsedMs).toBe(CLOCK_SAVE_MS);
      advance(CLOCK_SAVE_MS);
      expect(loadHistory(storage)[0].elapsedMs).toBe(2 * CLOCK_SAVE_MS);
      act(() => result.current.actions.pause());
      const saved = storage.getItem('sudoku.history');
      advance(3 * CLOCK_SAVE_MS);
      expect(storage.getItem('sudoku.history')).toBe(saved);
    });

    it('reopens a shared puzzle never started behind Start again, with its challenge', async () => {
      const storage = memoryStorage();
      const near = nearlySolved([0, 10, 20]);
      const search = linkFor(near.givens, { t: '95', n: 'Dan' });
      const first = setup({ storage, search });
      const id = first.result.current.record?.id;
      first.unmount();
      for (const again of ['', search]) {
        const view = setup({ storage, search: again });
        expect(view.result.current.record?.id).toBe(id);
        expect(view.result.current.phase).toBe('ready');
        expect(view.result.current.record?.challenge).toMatchObject({ name: 'Dan', seconds: 95 });
        view.unmount();
      }
    });

    it('records a game that arrived behind a dialog only once the player can see it', async () => {
      const { source, deliver } = deferredSource();
      const { result, storage } = setup({ source });
      await deliver();
      const first = result.current.record!.id;
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      act(() => result.current.actions.newGame('medium'));
      act(() => result.current.actions.openDialog('help'));
      await deliver(nearlySolved([1, 2, 3]));
      expect(result.current.pauseReason).toBe('dialog');
      advance(CLOCK_SAVE_MS);
      expect(loadHistory(storage).map((record) => record.id)).toEqual([first]);
      expect(loadCurrentId(storage)).toBe(first);
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('playing');
      expect(loadHistory(storage)).toHaveLength(2);
      expect(loadCurrentId(storage)).toBe(result.current.record?.id);
    });

    it('calls a puzzle already in the history a replay, which never sets a record', async () => {
      const near = nearlySolved([0]);
      const storage = memoryStorage();
      upsertRecord(storage, solvedRecord(near, 600_000));
      // The generator happens to hand out a puzzle played before.
      const { result } = await started({ storage, source: fakeSource(near) });
      expect(result.current.record?.source).toBe('replay');
      advance(5000);
      enter(result, 0, answerAt(0));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({
        kind: 'completion',
        result: {
          isReplay: true,
          isNewBest: false,
          stats: { played: 2, solved: 2, bestMs: 600_000, averageMs: 600_000 },
        },
      });
    });
  });

  describe('puzzles seen', () => {
    it('keeps a puzzle seen after its attempt is deleted, so its link is a replay that sets no best', async () => {
      const storage = memoryStorage();
      // An Easy best to beat.
      upsertRecord(storage, solvedRecord(another(PUZZLE), 5000));
      const near = nearlySolved([0, 1]);
      const search = linkFor(near.givens);

      // Open the link, start, and study the board for six seconds…
      const study = await started({ storage, search });
      act(() => study.result.current.actions.resume());
      advance(6000);
      // …then delete the attempt from History.
      act(() => study.result.current.actions.openDialog('history'));
      act(() => study.result.current.actions.deleteRecord(study.result.current.record!.id));
      expect(loadHistory(storage).some((record) => record.givens === near.givens)).toBe(false);
      study.unmount();

      // The same link again: a replay, however quickly it is solved.
      const { result } = await started({ storage, search });
      expect(result.current.record?.source).toBe('replay');
      act(() => result.current.actions.resume());
      enter(result, 0, answerAt(0));
      enter(result, 1, answerAt(1));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({
        kind: 'completion',
        result: { isReplay: true, isNewBest: false, stats: { bestMs: 5000 } },
      });
    });

    it('marks a puzzle seen as its board first shows, not while it waits behind Start', async () => {
      const storage = memoryStorage();
      const near = nearlySolved([0, 10, 20]);
      const { result } = await started({ storage, search: linkFor(near.givens) });
      expect(result.current.phase).toBe('ready');
      expect(hasSeen(storage, [], near.givens)).toBe(false);
      act(() => result.current.actions.resume());
      // At once: not left to the next save.
      expect(hasSeen(storage, [], near.givens)).toBe(true);
    });

    it('lets a link never started be deleted and opened again as the fresh puzzle it still is', async () => {
      const storage = memoryStorage();
      const near = nearlySolved([0, 10, 20]);
      const search = linkFor(near.givens, { t: '95', n: 'Dan' });
      const first = await started({ storage, search });
      act(() => first.result.current.actions.openDialog('history'));
      act(() => first.result.current.actions.deleteRecord(first.result.current.record!.id));
      first.unmount();
      const { result } = await started({ storage, search });
      expect(result.current.record?.source).toBe('shared');
    });

    it('marks a generated puzzle seen as it arrives on show', async () => {
      const { storage } = await started();
      expect(hasSeen(storage, [], PUZZLE.givens)).toBe(true);
    });

    it('shares a replay’s solve as the puzzle alone, never as a time to beat', async () => {
      const near = nearlySolved([0]);
      const storage = memoryStorage();
      upsertRecord(storage, solvedRecord(near, 600_000));
      const { result } = await started({ storage, source: fakeSource(near) });
      expect(result.current.record?.source).toBe('replay');
      enter(result, 0, answerAt(0));
      advance(COMPLETION_DELAY_MS);
      act(() => result.current.actions.shareResult());
      expect(result.current.dialog).toMatchObject({
        kind: 'share',
        target: { givens: near.givens, result: null },
      });
    });
  });

  describe('glimpsed games', () => {
    it('discards a generated game nobody touched once the next one arrives, keeping it seen', async () => {
      const second = nearlySolved([1, 2, 3]);
      const { result, storage } = await started({ source: fakeSource(PUZZLE, second) });
      const glimpsed = result.current.record!.id;
      advance(3000);
      act(() => result.current.actions.newGame('medium'));
      await settle();
      expect(result.current.record?.givens).toBe(second.givens);
      expect(loadHistory(storage).map((record) => record.id)).toEqual([result.current.record!.id]);
      expect(loadGameBlob(storage, glimpsed)).toBeNull();
      // Not played, so not counted as played…
      expect(computeStats(loadHistory(storage)).easy.played).toBe(0);
      // …but seen: meeting it again is a replay.
      expect(hasSeen(storage, loadHistory(storage), PUZZLE.givens)).toBe(true);
    });

    it('keeps the glimpsed game while its replacement is on its way, and if none comes', async () => {
      let calls = 0;
      const working = fakeSource();
      const source: PuzzleSource = {
        next: (difficulty) =>
          ++calls === 1 ? working.next(difficulty) : Promise.reject(new Error('down')),
        prefetch: () => {},
        dispose: () => {},
      };
      const { result, storage } = await started({ source });
      const glimpsed = result.current.record!.id;
      act(() => result.current.actions.newGame('hard'));
      await settle();
      expect(result.current.record?.id).toBe(glimpsed);
      expect(loadHistory(storage).map((record) => record.id)).toEqual([glimpsed]);
      expect(loadCurrentId(storage)).toBe(glimpsed);
    });

    it('discards a glimpsed game when History switches to another', async () => {
      const storage = memoryStorage();
      const older = await started({ storage, source: fakeSource(nearlySolved([30, 31, 32])) });
      enter(older.result, 30, answerAt(30));
      const olderId = older.result.current.record!.id;
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      older.unmount();

      const { result } = await started({ storage, source: fakeSource(PUZZLE) });
      act(() => result.current.actions.newGame('easy'));
      await settle();
      const glimpsed = result.current.record!.id;
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.resumeRecord(olderId));
      expect(result.current.record?.id).toBe(olderId);
      expect(loadHistory(storage).some((record) => record.id === glimpsed)).toBe(false);
    });

    it('keeps a game with anything done to it, and a shared one even untouched', async () => {
      const storage = memoryStorage();
      const near = nearlySolved([0, 10, 20]);
      const linked = await started({ storage, search: linkFor(near.givens) });
      act(() => linked.result.current.actions.resume());
      const shared = linked.result.current.record!.id;
      act(() => linked.result.current.actions.newGame('easy'));
      await settle();
      const noted = linked.result.current.record!.id;
      act(() => linked.result.current.actions.setMode('candidate'));
      enter(linked.result, FIRST_EMPTY, 4);
      act(() => linked.result.current.actions.newGame('easy'));
      await settle();
      const ids = loadHistory(storage).map((record) => record.id);
      expect(ids).toContain(shared);
      expect(ids).toContain(noted);
    });

    it('discards a glimpsed game a link’s game takes the place of', async () => {
      const storage = memoryStorage();
      const first = await started({ storage });
      const glimpsed = first.result.current.record!.id;
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      first.unmount();
      const near = nearlySolved([0, 10, 20]);
      const { result } = await started({ storage, search: linkFor(near.givens) });
      expect(result.current.record?.givens).toBe(near.givens);
      expect(loadHistory(storage).map((record) => record.id)).toEqual([result.current.record!.id]);
      expect(loadGameBlob(storage, glimpsed)).toBeNull();
    });
  });

  describe('storage', () => {
    /** Memory storage that refuses saved games while `isFull` is set. */
    function fillableStorage() {
      const inner = memoryStorage();
      const storage = {
        isFull: false,
        getItem: (key: string) => inner.getItem(key),
        removeItem: (key: string) => inner.removeItem(key),
        setItem: (key: string, value: string) => {
          if (storage.isFull && key.startsWith('sudoku.game')) {
            throw new DOMException('Full', 'QuotaExceededError');
          }
          inner.setItem(key, value);
        },
      };
      return storage;
    }

    it('names a new game current only once its board is saved', async () => {
      const storage = fillableStorage();
      const { result } = await started({
        storage,
        source: fakeSource(PUZZLE, nearlySolved([1, 2, 3])),
      });
      const first = result.current.record!.id;
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      expect(loadCurrentId(storage)).toBe(first);
      storage.isFull = true;
      act(() => result.current.actions.newGame('medium'));
      await settle();
      const second = result.current.record!.id;
      // A reload can still reopen the game that was saved.
      expect(loadCurrentId(storage)).toBe(first);
      storage.isFull = false;
      advance(CLOCK_SAVE_MS);
      expect(loadCurrentId(storage)).toBe(second);
    });
  });

  describe('a full board that is not right', () => {
    /** A game whose board is full, with two answers swapped. */
    async function fullButWrong(storage: StorageLike) {
      const near = nearlySolved([0, 1]);
      const view = await started({ storage, source: fakeSource(near, nearlySolved([5, 6])) });
      enter(view.result, 0, answerAt(1));
      enter(view.result, 1, answerAt(0));
      expect(view.result.current.notice?.kind).toBe('boardFull');
      return view;
    }

    it('says so again on a return visit, as the game resumes', async () => {
      const storage = memoryStorage();
      const first = await fullButWrong(storage);
      act(() => first.result.current.actions.dismissNotice());
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      first.unmount();
      const { result } = setup({ storage });
      expect(result.current.phase).toBe('paused');
      expect(result.current.notice?.kind).toBe('boardFull');
      act(() => result.current.actions.resume());
      expect(result.current.announcement?.text).toBe(
        "Resumed. The board is full, but something isn't right.",
      );
    });

    it('says so again when the game is resumed from History', async () => {
      const storage = memoryStorage();
      const { result } = await fullButWrong(storage);
      const wrong = result.current.record!.id;
      act(() => result.current.actions.newGame('easy'));
      await settle();
      expect(result.current.notice).toBeNull();
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.resumeRecord(wrong));
      expect(result.current.notice?.kind).toBe('boardFull');
      expect(result.current.announcement?.text).toBe(
        "Resumed Easy puzzle. The board is full, but something isn't right.",
      );
    });

    it('lets the notice go with the game when another one is resumed', async () => {
      const storage = memoryStorage();
      const { result } = await fullButWrong(storage);
      const wrong = result.current.record!.id;
      act(() => result.current.actions.newGame('easy'));
      await settle();
      const other = result.current.record!.id;
      enter(result, 5, answerAt(5));
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.resumeRecord(wrong));
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.resumeRecord(other));
      expect(result.current.notice).toBeNull();
    });

    it('lets the notice go with the game when it is deleted', async () => {
      const storage = memoryStorage();
      const { result } = await fullButWrong(storage);
      act(() => result.current.actions.openDialog('history'));
      act(() => result.current.actions.deleteRecord(result.current.record!.id));
      expect(result.current.notice).toBeNull();
    });
  });

  describe('daily puzzles', () => {
    const TODAY = '2026-10-12';
    const YESTERDAY = '2026-10-11';

    /** Today's Hard daily, a move from solved: its one blank is cell 0. */
    const NEAR_HARD = nearlySolved([0]);

    it("deals today's dailies in the background once there is a game, and again on a new day", async () => {
      const { dailies } = await started();
      expect(dailies.prefetched).toEqual([TODAY]);
      // Back in view the same day: nothing more to deal.
      setVisibility('hidden');
      setVisibility('visible');
      expect(dailies.prefetched).toEqual([TODAY]);
      // Back in view after midnight: the new day's.
      act(() => vi.setSystemTime(NOW + 86_400_000));
      setVisibility('hidden');
      setVisibility('visible');
      expect(dailies.prefetched).toEqual([TODAY, '2026-10-13']);
    });

    it("works out today's dailies, and how each stands, afresh on asking and coming back into view", async () => {
      const { result } = await started();
      expect(result.current.today).toEqual({
        date: TODAY,
        statuses: {
          easy: 'not-started',
          medium: 'not-started',
          hard: 'not-started',
          expert: 'not-started',
        },
      });
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      act(() => result.current.actions.refreshToday());
      expect(result.current.today.statuses.hard).toBe('in-progress');
      act(() => vi.setSystemTime(NOW + 86_400_000));
      setVisibility('hidden');
      setVisibility('visible');
      expect(result.current.today.date).toBe('2026-10-13');
      expect(result.current.today.statuses.hard).toBe('not-started');
    });

    it('opens a daily not yet dealt behind the loading card, as an attempt recorded as that daily', async () => {
      const dailies = fakeDailies({ held: true });
      const { result, storage } = await started({ dailies });
      const left = result.current.record!;
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      expect(result.current.phase).toBe('loading');
      expect(result.current.difficulty).toBe('hard');
      expect(result.current.daily).toBe(TODAY);
      // The game being left waits, saved and stopped, until the daily arrives…
      expect(loadHistory(storage).map((record) => record.id)).toEqual([left.id]);
      act(() => dailies.release());
      await settle();
      // …and goes then, as it was only glimpsed.
      expect(loadHistory(storage).map((record) => record.id)).not.toContain(left.id);
      expect(result.current.phase).toBe('playing');
      expect(result.current.record).toMatchObject({
        source: 'daily',
        difficulty: 'hard',
        daily: TODAY,
      });
      expect(result.current.record!.id).not.toBe(left.id);
      expect(dailies.asked).toEqual([`${TODAY}/hard`]);
    });

    it('opens a daily already dealt at once', async () => {
      const dailies = fakeDailies({ dealt: [`${TODAY}/expert`] });
      const { result } = await started({ dailies });
      act(() => result.current.actions.openDaily(TODAY, 'expert'));
      expect(result.current.phase).toBe('playing');
      expect(result.current.record).toMatchObject({ difficulty: 'expert', daily: TODAY });
      expect(dailies.asked).toEqual([]);
    });

    it('asks for a reload when the archive cannot be loaded, the page being out of date', async () => {
      const dailies = fakeDailies({ failing: new ArchiveUnavailableError(new Error('404')) });
      const { result } = await started({ dailies });
      act(() => result.current.actions.openDaily(TODAY, 'medium'));
      await settle();
      expect(result.current.notice).toMatchObject({
        kind: 'outOfDate',
        text: expect.stringContaining('Reload it to play this daily'),
      });
      // The game that was on screen stays.
      expect(result.current.isLoadFailed).toBe(false);
    });

    it('says a daily it could not deal could not be made, and asks for it again on Try again', async () => {
      const dailies = fakeDailies({ failing: true });
      const { result } = setup({ dailies, source: failingSource() });
      await settle();
      act(() => result.current.actions.openDaily(TODAY, 'medium'));
      await settle();
      expect(result.current.isLoadFailed).toBe(true);
      expect(result.current.notice?.kind).toBe('generationFailed');
      act(() => result.current.actions.retry());
      await settle();
      expect(dailies.asked).toEqual([`${TODAY}/medium`, `${TODAY}/medium`]);
    });

    it('opens nothing for a date with no daily', async () => {
      const { result, dailies } = await started();
      const record = result.current.record;
      act(() => result.current.actions.openDaily('2026-10-06', 'hard'));
      act(() => result.current.actions.openDaily('2026-10-15', 'hard'));
      expect(result.current.record).toBe(record);
      expect(dailies.asked).toEqual([]);
    });

    it('resumes an unfinished daily rather than starting it again', async () => {
      const { result } = await started();
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      const daily = result.current.record!;
      enter(result, result.current.game!.selected, 4);
      act(() => result.current.actions.newGame('easy'));
      await settle();
      expect(result.current.record?.daily).toBeUndefined();
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      expect(result.current.record?.id).toBe(daily.id);
      expect(result.current.phase).toBe('playing');
    });

    it('goes back to the daily on screen, cancelling a new game on its way', async () => {
      const { result } = await started();
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      const daily = result.current.record!;
      act(() => result.current.actions.openDialog('daily'));
      expect(result.current.phase).toBe('paused');
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      expect(result.current.dialog).toBeNull();
      expect(result.current.phase).toBe('playing');
      expect(result.current.record?.id).toBe(daily.id);
    });

    it('keeps an unplayed daily, to resume, where an unplayed random puzzle is dropped', async () => {
      const { result, storage } = await started();
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      const daily = result.current.record!;
      act(() => result.current.actions.newGame('easy'));
      await settle();
      expect(loadHistory(storage).map((record) => record.id)).toContain(daily.id);
    });

    it('offers a solved daily again, and records Play again as that daily', async () => {
      const dailies = fakeDailies({ puzzles: { [`${TODAY}/hard`]: NEAR_HARD } });
      const { result } = await started({ dailies });
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      enter(result, 0, answerAt(0, NEAR_HARD));
      const solved = result.current.record!;
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      expect(result.current.dialog).toMatchObject({
        kind: 'challenge',
        offer: { previous: { id: solved.id }, challenge: null, daily: TODAY },
      });
      act(() => result.current.actions.playAgain());
      expect(result.current.record).toMatchObject({ source: 'replay', daily: TODAY });
      expect(result.current.record!.id).not.toBe(solved.id);
    });

    it('offers a solved daily again by the solve that had a time, not a later one after watching', async () => {
      const storage = memoryStorage();
      const base = {
        ...solvedRecord(NEAR_HARD, 200_000),
        daily: TODAY,
        difficulty: 'hard' as const,
      };
      upsertRecord(storage, { ...base, id: 'timed-0001' });
      upsertRecord(storage, {
        ...base,
        id: 'seen-0001',
        createdAt: base.createdAt + 1000,
        elapsedMs: 50_000,
        watched: true,
      });
      const dailies = fakeDailies({ puzzles: { [`${TODAY}/hard`]: NEAR_HARD } });
      const { result } = await started({ storage, dailies });
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      expect(result.current.dialog).toMatchObject({
        kind: 'challenge',
        offer: { previous: { id: 'timed-0001' } },
      });
    });

    it('plays a solved daily again straight from the calendar', async () => {
      const dailies = fakeDailies({ puzzles: { [`${YESTERDAY}/easy`]: NEAR_HARD } });
      const { result } = await started({ dailies });
      act(() => result.current.actions.openDaily(YESTERDAY, 'easy'));
      await settle();
      enter(result, 0, answerAt(0, NEAR_HARD));
      advance(COMPLETION_DELAY_MS);
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.openDialog('daily'));
      act(() => result.current.actions.replayDaily(YESTERDAY, 'easy'));
      expect(result.current.dialog).toBeNull();
      expect(result.current.record).toMatchObject({
        source: 'replay',
        daily: YESTERDAY,
        difficulty: 'easy',
      });
    });

    it('opens a daily never solved when asked to play it again', async () => {
      const { result } = await started();
      act(() => result.current.actions.replayDaily(TODAY, 'medium'));
      await settle();
      expect(result.current.record).toMatchObject({ source: 'daily', daily: TODAY });
    });

    it('records an attempt at the puzzle begun before it was opened as the daily as that daily', async () => {
      // The daily's puzzle arrived as a plain link first.
      const dailies = fakeDailies({ puzzles: { [`${TODAY}/hard`]: PUZZLE } });
      const { result } = setup({
        dailies,
        source: fakeSource(another(PUZZLE)),
        search: linkFor(PUZZLE.givens),
      });
      await settle();
      act(() => result.current.actions.resume());
      const linked = result.current.record!;
      enter(result, FIRST_EMPTY, 4);
      act(() => result.current.actions.newGame('easy'));
      await settle();
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      expect(result.current.record).toMatchObject({ id: linked.id, daily: TODAY });
    });

    it('reopens an attempt begun before it was the daily, paused, if it arrives behind a dialog', async () => {
      const dailies = fakeDailies({ puzzles: { [`${TODAY}/hard`]: PUZZLE }, held: true });
      const { result } = setup({
        dailies,
        source: fakeSource(another(PUZZLE)),
        search: linkFor(PUZZLE.givens),
      });
      await settle();
      act(() => result.current.actions.resume());
      const linked = result.current.record!;
      enter(result, FIRST_EMPTY, 4);
      act(() => result.current.actions.newGame('easy'));
      await settle();
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      act(() => result.current.actions.openDialog('help'));
      act(() => dailies.release());
      await settle();
      expect(result.current.record).toMatchObject({ id: linked.id, daily: TODAY });
      expect(result.current.phase).toBe('paused');
      expect(result.current.dialog).toMatchObject({ kind: 'help' });
    });

    it('names a solved daily and the streak it begins', async () => {
      const dailies = fakeDailies({ puzzles: { [`${TODAY}/hard`]: NEAR_HARD } });
      const { result } = await started({ dailies });
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      enter(result, 0, answerAt(0, NEAR_HARD));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({
        kind: 'completion',
        result: {
          difficulty: 'hard',
          daily: { date: TODAY, today: TODAY, streak: { kind: 'started' } },
        },
      });
    });

    it('counts a solve towards the streak even when the browser refuses to store it', async () => {
      const memory = memoryStorage();
      let isFull = false;
      const storage: StorageLike = {
        getItem: (key) => memory.getItem(key),
        removeItem: (key) => memory.removeItem(key),
        setItem: (key, value) => {
          if (isFull) throw new DOMException('Full', 'QuotaExceededError');
          memory.setItem(key, value);
        },
      };
      const dailies = fakeDailies({ puzzles: { [`${TODAY}/hard`]: NEAR_HARD } });
      const { result } = await started({ dailies, storage });
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      isFull = true;
      enter(result, 0, answerAt(0, NEAR_HARD));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({
        result: { daily: { date: TODAY, streak: { kind: 'started' } } },
      });
    });

    it('carries the streak on from the ledger, where pruned dailies left it', async () => {
      const storage = memoryStorage();
      storage.setItem(
        'sudoku.dailyLedger',
        JSON.stringify({ '2026-10-10': '--d-', '2026-10-11': '--d-' }),
      );
      const dailies = fakeDailies({ puzzles: { [`${TODAY}/hard`]: NEAR_HARD } });
      const { result } = await started({ dailies, storage });
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      enter(result, 0, answerAt(0, NEAR_HARD));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({
        result: { daily: { streak: { kind: 'streak', days: 3 } } },
      });
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.openDialog('daily'));
      expect(result.current.dialog).toMatchObject({ kind: 'daily' });
      const calendar = (result.current.dialog as { calendar: CalendarView }).calendar;
      expect(calendar.ledger.get('2026-10-11')).toEqual({ hard: 'solved-on-the-day' });
    });

    describe("a friend's link to a daily whose day has not begun here yet", () => {
      const TOMORROW = '2026-10-13';
      const DAY = 86_400_000;
      // Noon UTC on the 12th: the 13th has already begun in UTC+14.
      const link = `${linkFor(NEAR_HARD.givens)}&d=${TOMORROW}`;

      it('counts once started on its own day, though it was opened the day before', async () => {
        const dailies = fakeDailies({ puzzles: { [`${TOMORROW}/hard`]: NEAR_HARD } });
        const { result } = setup({ dailies, search: link });
        await settle();
        expect(result.current.phase).toBe('ready');
        expect(result.current.record).toMatchObject({ daily: TOMORROW });
        expect(result.current.record).not.toHaveProperty('startedOn');
        // Left behind its Start card overnight, and opened from New game in the morning.
        act(() => vi.setSystemTime(NOW + DAY));
        act(() => result.current.actions.openDaily(TOMORROW, 'hard'));
        expect(result.current.phase).toBe('playing');
        expect(result.current.record).toMatchObject({ startedOn: dateKeyOf(NOW + DAY) });
        enter(result, 0, answerAt(0, NEAR_HARD));
        advance(COMPLETION_DELAY_MS);
        expect(result.current.dialog).toMatchObject({
          result: { daily: { date: TOMORROW, streak: { kind: 'started' } } },
        });
      });

      it('says one started early does not count, rather than that it was played late', async () => {
        const dailies = fakeDailies({ puzzles: { [`${TOMORROW}/hard`]: NEAR_HARD } });
        const { result } = setup({ dailies, search: link });
        await settle();
        act(() => result.current.actions.resume());
        expect(result.current.record).toMatchObject({ startedOn: dateKeyOf(NOW) });
        enter(result, 0, answerAt(0, NEAR_HARD));
        advance(COMPLETION_DELAY_MS);
        expect(result.current.dialog).toMatchObject({
          result: { daily: { date: TOMORROW, streak: { kind: 'early' } } },
        });
      });
    });

    it("says a past day's daily played today does not count towards the streak", async () => {
      const dailies = fakeDailies({ puzzles: { [`${YESTERDAY}/hard`]: NEAR_HARD } });
      const { result } = await started({ dailies });
      act(() => result.current.actions.openDaily(YESTERDAY, 'hard'));
      await settle();
      enter(result, 0, answerAt(0, NEAR_HARD));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({
        kind: 'completion',
        result: { daily: { date: YESTERDAY, streak: { kind: 'later' } } },
      });
    });

    it('gives a random puzzle no daily in its completion', async () => {
      const { result } = await started({ source: fakeSource(nearlySolved([0])) });
      enter(result, 0, answerAt(0));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({ kind: 'completion', result: { daily: null } });
    });

    it('shares a daily as that daily', async () => {
      const { result } = await started();
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      act(() => result.current.actions.openDialog('share'));
      expect(result.current.dialog).toMatchObject({ kind: 'share', target: { daily: TODAY } });
    });

    it('opens the calendar on the history as it stands, the game on screen saved first', async () => {
      const { result } = await started();
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      await settle();
      act(() => result.current.actions.openDialog('daily'));
      expect(result.current.phase).toBe('paused');
      expect(result.current.dialog).toMatchObject({ kind: 'daily', calendar: { today: TODAY } });
      const { calendar } = result.current.dialog as {
        calendar: { records: readonly GameRecord[] };
      };
      expect(calendar.records.map((record) => record.daily)).toContain(TODAY);
      // Closing it lifts the pause it caused.
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('playing');
    });

    it('moves the open calendar on to a new day when the page comes back into view', async () => {
      const { result } = await started();
      act(() => result.current.actions.openDialog('daily'));
      act(() => vi.setSystemTime(NOW + 86_400_000));
      setVisibility('hidden');
      setVisibility('visible');
      expect(result.current.dialog).toMatchObject({
        kind: 'daily',
        calendar: { today: '2026-10-13' },
      });
    });

    it('plays a daily from the calendar, leaving the game behind it paused by the player', async () => {
      const dailies = fakeDailies({ held: true });
      const { result } = await started({ dailies });
      const left = result.current.record!;
      enter(result, FIRST_EMPTY, 4);
      act(() => result.current.actions.openDialog('daily'));
      act(() => result.current.actions.openDaily(YESTERDAY, 'expert'));
      expect(result.current.dialog).toBeNull();
      expect(result.current.phase).toBe('loading');
      act(() => dailies.release());
      await settle();
      expect(result.current.record).toMatchObject({ daily: YESTERDAY, difficulty: 'expert' });
      act(() => result.current.actions.resumeRecord(left.id));
      expect(result.current.record?.id).toBe(left.id);
    });

    it('holds a daily that arrives behind a dialog until the dialog closes', async () => {
      const dailies = fakeDailies({ held: true });
      const { result } = await started({ dailies });
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      act(() => result.current.actions.openDialog('help'));
      act(() => dailies.release());
      await settle();
      expect(result.current.record).toMatchObject({ daily: TODAY });
      expect(result.current.pauseReason).toBe('dialog');
      act(() => result.current.actions.closeDialog());
      expect(result.current.phase).toBe('playing');
    });

    it('holds a daily that arrives in a hidden tab behind Start', async () => {
      const dailies = fakeDailies({ held: true });
      const { result } = await started({ dailies });
      act(() => result.current.actions.openDaily(TODAY, 'hard'));
      setVisibility('hidden');
      act(() => dailies.release());
      await settle();
      expect(result.current.record).toMatchObject({ daily: TODAY });
      expect(result.current.phase).toBe('ready');
    });

    describe('of 1–6 October, played on the launch morning before Daily #1 moved to the 7th', () => {
      /** 08:30 UTC on 7 October: dailies had launched, with Daily #1 on the 1st. */
      const LAUNCH_MORNING = Date.UTC(2026, 9, 7, 8, 30);

      it('resumes an unfinished one as an ordinary game, its time kept, in no calendar', async () => {
        vi.setSystemTime(LAUNCH_MORNING);
        const storage = memoryStorage();
        const first = await started({ storage });
        enter(first.result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
        advance(65_000);
        act(() => {
          window.dispatchEvent(new Event('pagehide'));
        });
        first.unmount();
        // Recorded as that morning's app recorded it: the 3rd's daily, begun on the 7th.
        const [record] = JSON.parse(storage.getItem('sudoku.history')!) as GameRecord[];
        storage.setItem(
          'sudoku.history',
          JSON.stringify([
            { ...record, source: 'daily', daily: '2026-10-03', startedOn: '2026-10-07' },
          ]),
        );

        vi.setSystemTime(NOW);
        const { result, dailies } = setup({ storage, source: fakeSource() });
        expect(result.current.phase).toBe('paused');
        expect(result.current.pauseReason).toBe('restored');
        expect(result.current.elapsedMs).toBe(65_000);
        expect(result.current.game?.cells[FIRST_EMPTY].value).toBe(answerAt(FIRST_EMPTY));
        expect(result.current.record?.id).toBe(record.id);
        expect(result.current.record).not.toHaveProperty('daily');
        expect(result.current.daily).toBeNull();
        act(() => result.current.actions.resume());
        expect(result.current.phase).toBe('playing');
        act(() => result.current.actions.openDialog('daily'));
        const calendar = (result.current.dialog as { calendar: CalendarView }).calendar;
        expect(calendar.records.filter((entry) => entry.daily !== undefined)).toEqual([]);
        expect(dailies.asked).toEqual([]);
      });

      it('opens a link to one as a plain shared puzzle, never asking for that daily', async () => {
        const dailies = fakeDailies({ puzzles: { '2026-10-03/expert': PUZZLE } });
        const { result, storage } = setup({
          dailies,
          search: `${linkFor(PUZZLE.givens)}&d=2026-10-03`,
        });
        await settle();
        expect(result.current.record).toMatchObject({ source: 'shared' });
        expect(result.current.record).not.toHaveProperty('daily');
        expect(result.current.daily).toBeNull();
        expect(loadHistory(storage)[0]).not.toHaveProperty('daily');
        expect(dailies.asked).toEqual([]);
      });
    });

    describe('a link that says it is a daily', () => {
      it('records the game as that daily once the date checks out', async () => {
        const dailies = fakeDailies({ puzzles: { [`${TODAY}/expert`]: PUZZLE } });
        const { result, storage } = setup({
          dailies,
          search: `${linkFor(PUZZLE.givens)}&d=${TODAY}`,
        });
        await settle();
        expect(result.current.record).toMatchObject({
          source: 'shared',
          daily: TODAY,
          difficulty: 'expert',
        });
        expect(result.current.daily).toBe(TODAY);
        expect(loadHistory(storage)[0]).toMatchObject({ daily: TODAY, difficulty: 'expert' });
        // Checked against the tier it grades as first.
        expect(dailies.asked[0]).toBe(`${TODAY}/${PUZZLE.difficulty}`);
      });

      it('leaves a link whose date does not match a shared puzzle like any other', async () => {
        const { result, dailies } = setup({ search: `${linkFor(PUZZLE.givens)}&d=${TODAY}` });
        await settle();
        expect(dailies.asked).toHaveLength(4);
        expect(result.current.record).toMatchObject({ source: 'shared' });
        expect(result.current.record).not.toHaveProperty('daily');
      });

      it('ignores a date with no daily, and a check that fails', async () => {
        const future = setup({ search: `${linkFor(PUZZLE.givens)}&d=2027-01-01` });
        await settle();
        expect(future.result.current.record).not.toHaveProperty('daily');
        future.unmount();
        const failing = setup({
          dailies: fakeDailies({ failing: true }),
          search: `${linkFor(PUZZLE.givens)}&d=${TODAY}`,
        });
        await settle();
        expect(failing.result.current.record).not.toHaveProperty('daily');
      });

      it("records the link's game as the daily even once another game has taken its place", async () => {
        const dailies = fakeDailies({ puzzles: { [`${TODAY}/hard`]: PUZZLE }, held: true });
        const { result, storage } = setup({
          dailies,
          source: fakeSource(another(PUZZLE)),
          search: `${linkFor(PUZZLE.givens)}&d=${TODAY}`,
        });
        await settle();
        const linked = result.current.record!;
        act(() => result.current.actions.newGame('easy'));
        await settle();
        act(() => dailies.release());
        await settle();
        expect(loadHistory(storage).find((record) => record.id === linked.id)).toMatchObject({
          daily: TODAY,
          difficulty: 'hard',
        });
      });

      it('names the daily in the offer to play a solved one again, and records the replay as it', async () => {
        const storage = memoryStorage();
        upsertRecord(storage, solvedRecord(PUZZLE, 290_000));
        const dailies = fakeDailies({ puzzles: { [`${TODAY}/hard`]: PUZZLE } });
        const { result } = setup({
          storage,
          dailies,
          search: `${linkFor(PUZZLE.givens)}&d=${TODAY}`,
        });
        await settle();
        expect(result.current.dialog).toMatchObject({
          kind: 'challenge',
          offer: { daily: TODAY, puzzle: { difficulty: 'hard' } },
        });
        act(() => result.current.actions.playAgain());
        expect(result.current.record).toMatchObject({ source: 'replay', daily: TODAY });
      });
    });
  });

  describe('guards', () => {
    it('changes the game only through advance, so the move log never misses a move', () => {
      // A path that called the reducer itself would make a move the log
      // never heard of, and every replay of the game would go wrong from there.
      // A path rather than `new URL(name, import.meta.url)`, which Vite rewrites.
      const here = dirname(fileURLToPath(import.meta.url));
      const source = readFileSync(join(here, 'useSudoku.ts'), 'utf8');
      expect(source).not.toMatch(/\breduce\(/);
    });

    it('reads the address bar and localStorage, and asks the app’s dailies, when not told otherwise', () => {
      const near = nearlySolved([0, 1]);
      window.history.replaceState(null, '', `/${linkFor(near.givens)}`);
      localStorage.clear();
      // Asked to deal today's four, but not let: that would be real work.
      const prefetch = vi.spyOn(appDailies, 'prefetch').mockImplementation(() => {});
      const { result } = renderHook(() => useSudoku());
      expect(result.current.phase).toBe('ready');
      expect(localStorage.getItem('sudoku.current')).toBe(result.current.record?.id);
      expect(prefetch).toHaveBeenCalledWith(dateKeyOf(Date.now()));
      prefetch.mockRestore();
      localStorage.clear();
    });

    it('flips candidate mode back to normal while a modifier is held', async () => {
      const { result } = await started();
      act(() => result.current.actions.setMode('candidate'));
      act(() => result.current.actions.setModifier('Shift', true));
      expect(result.current.effectiveMode).toBe('normal');
    });

    it('saves nothing new when the page goes away with nothing changed', async () => {
      const { result, storage } = await started();
      act(() => result.current.actions.pause());
      const saved = storage.getItem('sudoku.history');
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      expect(storage.getItem('sudoku.history')).toBe(saved);
    });

    it('has nothing to save while the first puzzle is still on its way', () => {
      const { result, storage } = setup({
        source: { ...fakeSource(), next: () => new Promise(() => {}) },
      });
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      expect(result.current.phase).toBe('loading');
      expect(storage.getItem('sudoku.history')).toBeNull();
      // Nor anything to share, or to pause.
      act(() => result.current.actions.openDialog('share'));
      act(() => result.current.actions.shareResult());
      act(() => result.current.actions.pause());
      expect(result.current.dialog).toBeNull();
      expect(result.current.announcement).toBeNull();
    });

    it('saves a game with nothing running when the tab is hidden', async () => {
      // A solved board can still be looked around; the selection is saved.
      const { result, storage } = await started({ source: fakeSource(nearlySolved([0])) });
      enter(result, 0, answerAt(0));
      act(() => result.current.actions.select(40));
      setVisibility('hidden');
      const blob = loadGameBlob(storage, result.current.record!.id) as { selected: number };
      expect(blob.selected).toBe(40);
      expect(result.current.phase).toBe('solved');
    });

    it('says nothing for a pause or a resume that changes nothing', async () => {
      const { result } = await started();
      const said = result.current.announcement;
      act(() => result.current.actions.resume());
      expect(result.current.announcement).toBe(said);
      act(() => result.current.actions.pause());
      const paused = result.current.announcement;
      act(() => result.current.actions.pause());
      expect(result.current.announcement).toBe(paused);
    });

    it('lists a paused game in History without saving it again', async () => {
      const { result, storage } = await started();
      act(() => result.current.actions.pause());
      const saved = storage.getItem('sudoku.history');
      act(() => result.current.actions.openDialog('history'));
      expect(storage.getItem('sudoku.history')).toBe(saved);
      expect(result.current.history.records).toHaveLength(1);
    });

    it('clears the full-board notice on a reset', async () => {
      const near = nearlySolved([0, 1]);
      const { result } = await started({ source: fakeSource(near) });
      enter(result, 0, answerAt(1));
      enter(result, 1, answerAt(0));
      act(() => result.current.actions.requestReset());
      act(() => result.current.actions.confirmReset());
      expect(result.current.notice).toBeNull();
    });

    it('cannot reset a solved game', async () => {
      const { result } = await started({ source: fakeSource(nearlySolved([0])) });
      enter(result, 0, answerAt(0));
      const solved = result.current.game;
      act(() => result.current.actions.confirmReset());
      expect(result.current.game).toBe(solved);
    });

    it('ignores Play again with no offer open', async () => {
      const { result } = await started();
      const record = result.current.record;
      act(() => result.current.actions.playAgain());
      expect(result.current.record).toBe(record);
    });

    it('plays a linked puzzle again before any other game has arrived', async () => {
      const storage = memoryStorage();
      upsertRecord(storage, solvedRecord(PUZZLE, 290_000));
      const { result } = setup({
        storage,
        source: { ...fakeSource(), next: () => new Promise(() => {}) },
        search: linkFor(PUZZLE.givens),
      });
      expect(result.current.phase).toBe('loading');
      act(() => result.current.actions.playAgain());
      expect(result.current.phase).toBe('playing');
      expect(result.current.record?.source).toBe('replay');
    });
  });

  describe('watching a solve', () => {
    /** A play clock of its own, moving with the fake timers (see 'the move log'). */
    const clock = (): number => Date.now() - NOW + 7_000_000;
    const near = nearlySolved([0, 1]);

    /** Storage that keeps a list of every key written or removed, to show that watching writes nothing. */
    function recording() {
      const inner = memoryStorage();
      const writes: string[] = [];
      const storage: StorageLike = {
        getItem: (key) => inner.getItem(key),
        setItem: (key, value) => {
          writes.push(key);
          inner.setItem(key, value);
        },
        removeItem: (key) => {
          writes.push(key);
          inner.removeItem(key);
        },
      };
      return { storage, writes };
    }

    /** A game of `near` solved at 0:12, with its Solved dialog open. */
    async function solved(options: SetupOptions = {}) {
      const view = await started({ clock, source: fakeSource(near, PUZZLE), ...options });
      advance(5000);
      enter(view.result, 0, answerAt(0));
      advance(7000);
      enter(view.result, 1, answerAt(1));
      advance(COMPLETION_DELAY_MS);
      expect(view.result.current.dialog?.kind).toBe('completion');
      return { ...view, id: view.result.current.record!.id };
    }

    it('offers the game just solved, recorded move by move, from the Solved dialog', async () => {
      const { storage, writes } = recording();
      const { result, id } = await solved({ storage });
      expect(result.current.canWatchSolve).toBe(true);
      const completion = result.current.dialog;
      const before = writes.length;

      act(() => result.current.actions.watchSolve());
      expect(result.current.dialog).toEqual({
        kind: 'playback',
        source: {
          givens: near.givens,
          difficulty: near.difficulty,
          log: loadEncodedMoveLog(storage, id),
          title: 'Your solve',
          subtitle: 'Easy · 0:12',
        },
        returnTo: completion,
      });
      // Back to the Solved dialog as it was, focus back on Watch, having
      // changed nothing.
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toEqual({ ...completion, isBackFromWatch: true });
      advance(CLOCK_SAVE_MS * 2);
      expect(writes).toHaveLength(before);
    });

    it('offers nothing to watch while the game is still being played', async () => {
      const { result } = await started({ clock, source: fakeSource(near) });
      enter(result, 0, answerAt(0));
      expect(result.current.canWatchSolve).toBe(false);
      act(() => result.current.actions.watchSolve());
      expect(result.current.dialog).toBeNull();
    });

    it('offers nothing to watch for a game not recorded move by move', async () => {
      const storage = memoryStorage();
      const first = await started({ clock, storage, source: fakeSource(near) });
      const id = first.result.current.record!.id;
      enter(first.result, 0, answerAt(0));
      act(() => first.result.current.actions.pause());
      first.unmount();
      // As a game begun before logs were kept: a board, and no log.
      storage.removeItem(`sudoku.moves.${id}`);

      const second = setup({ clock, storage });
      act(() => second.result.current.actions.resume());
      enter(second.result, 1, answerAt(1));
      advance(COMPLETION_DELAY_MS);
      expect(second.result.current.canWatchSolve).toBe(false);
      act(() => second.result.current.actions.watchSolve());
      expect(second.result.current.dialog?.kind).toBe('completion');
      act(() => second.result.current.actions.openDialog('history'));
      const [record] = second.result.current.history.records;
      expect(second.result.current.actions.canWatchRecord(record)).toBe(false);
    });

    it('watches a solved game from History, and comes back to the list, still paused', async () => {
      const { storage, writes } = recording();
      const { result, id } = await solved({ storage });
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.newGame('easy'));
      await settle();
      enter(result, FIRST_EMPTY, answerAt(FIRST_EMPTY));
      act(() => result.current.actions.openDialog('history'));
      const before = writes.length;
      const [current, older] = result.current.history.records;
      expect(older.id).toBe(id);
      expect(result.current.actions.canWatchRecord(older)).toBe(true);
      // Not the game being played: it is not solved.
      expect(result.current.actions.canWatchRecord(current)).toBe(false);

      const place = { filter: 'easy', limit: 200, id } as const;
      act(() => result.current.actions.watchRecord(id, place));
      expect(result.current.dialog).toMatchObject({
        kind: 'playback',
        source: { givens: near.givens, log: loadEncodedMoveLog(storage, id) },
        returnTo: { kind: 'history', place },
      });
      expect(result.current.pauseReason).toBe('dialog');
      // Back to the list as it was: filtered, as long, at the row watched.
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toEqual({ kind: 'history', place });
      expect(result.current.pauseReason).toBe('dialog');
      advance(CLOCK_SAVE_MS * 2);
      expect(writes).toHaveLength(before);
    });

    it('watches the game on screen from History by its own log', async () => {
      const { result, id } = await solved();
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.openDialog('history'));
      const [record] = result.current.history.records;
      expect(record.id).toBe(id);
      expect(result.current.actions.canWatchRecord(record)).toBe(true);
      act(() => result.current.actions.watchRecord(id, { filter: 'all', limit: 100, id }));
      expect(result.current.dialog?.kind).toBe('playback');
    });

    it('names a daily as the Solved dialog does', async () => {
      const today = dateKeyOf(NOW);
      const dailies = fakeDailies({ puzzles: { [`${today}/easy`]: near } });
      const view = await started({ clock, dailies, source: fakeSource(PUZZLE) });
      act(() => view.result.current.actions.openDaily(today, 'easy'));
      await settle();
      enter(view.result, 0, answerAt(0));
      enter(view.result, 1, answerAt(1));
      advance(COMPLETION_DELAY_MS);
      act(() => view.result.current.actions.watchSolve());
      expect(view.result.current.dialog).toMatchObject({
        kind: 'playback',
        source: { subtitle: expect.stringMatching(/^Daily · .+ · Easy · 0:00$/) },
      });
    });

    it('does nothing for a game it cannot find, or one that cannot be watched', async () => {
      const { result } = await solved();
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.openDialog('history'));
      act(() =>
        result.current.actions.watchRecord('nope-0000', { filter: 'all', limit: 100, id: 'x' }),
      );
      expect(result.current.dialog).toEqual({ kind: 'history' });
    });
  });
  describe("watching a friend's solve", () => {
    // Five moves, the last at 0:09: the link's time is 9 seconds.
    const { puzzle: SHARED, encoded: THEIRS } = shortSolve();
    const BLANKS = [0, 40, 80];
    const LINK = linkFor(SHARED.givens, { t: '9', n: 'Dan', s: THEIRS });

    /** Fill in every blank of the shared puzzle, 3 s of play apart. */
    function solveShared(result: Hook): void {
      for (const index of BLANKS) {
        advance(3000);
        enter(result, index, answerAt(index, SHARED));
      }
      advance(COMPLETION_DELAY_MS);
    }

    /** The link opened on its Ready card. */
    async function linked(options: SetupOptions = {}) {
      return started({ search: LINK, ...options });
    }

    it('offers it on the Ready card, and asks first for a puzzle not yet solved', async () => {
      const { result, storage } = await linked();
      expect(result.current.phase).toBe('ready');
      expect(result.current.friendSolve).toEqual({ name: 'Dan' });
      expect(result.current.record?.challenge?.log).toBe(THEIRS);

      act(() => result.current.actions.watchFriendSolve());
      expect(result.current.dialog).toMatchObject({
        kind: 'spoiler',
        solve: { givens: SHARED.givens, log: THEIRS, challenge: { name: 'Dan' } },
      });
      // Nothing is given up by being asked.
      expect(hasWatched(storage, SHARED.givens)).toBe(false);
      expect(result.current.record).not.toHaveProperty('watched');
    });

    it('watched anyway: the puzzle is watched, this attempt flagged, and the card says so', async () => {
      const { result, storage } = await linked();
      act(() => result.current.actions.watchFriendSolve());
      act(() => result.current.actions.confirmWatch());
      expect(result.current.dialog).toEqual({
        kind: 'playback',
        source: {
          givens: SHARED.givens,
          difficulty: SHARED.difficulty,
          log: THEIRS,
          title: "Dan's solve",
          name: 'Dan',
          subtitle: 'Easy · 0:09',
        },
        returnTo: { kind: 'game' },
      });
      expect(hasWatched(storage, SHARED.givens)).toBe(true);
      expect(hasSeen(storage, [], SHARED.givens)).toBe(true);
      expect(result.current.record?.watched).toBe(true);
      expect(loadHistory(storage)[0].watched).toBe(true);
      // Back to the card, the game still waiting for Start.
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toBeNull();
      expect(result.current.phase).toBe('ready');
    });

    it('records the solve that follows without a time: no best, no time to share or race', async () => {
      const storage = memoryStorage();
      upsertRecord(storage, solvedRecord(another(SHARED), 600_000));
      const { result } = await linked({ storage });
      act(() => result.current.actions.watchFriendSolve());
      act(() => result.current.actions.confirmWatch());
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.resume());
      solveShared(result);

      expect(result.current.announcement?.text).toBe(
        'Solved — no time recorded: you watched a solve of this puzzle first.',
      );
      expect(result.current.dialog).toMatchObject({
        kind: 'completion',
        result: { isWatched: true, isNewBest: false, stats: { solved: 2, bestMs: 600_000 } },
      });
      expect(loadHistory(storage)[0]).toMatchObject({ status: 'solved', watched: true });
      act(() => result.current.actions.shareResult());
      expect(result.current.dialog).toMatchObject({
        kind: 'share',
        target: { result: null, solve: null },
      });
    });

    it('plays back the solve that follows with no time in its heading, from Solved and History', async () => {
      const { result } = await linked();
      act(() => result.current.actions.watchFriendSolve());
      act(() => result.current.actions.confirmWatch());
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.resume());
      solveShared(result);

      act(() => result.current.actions.watchSolve());
      expect(result.current.dialog).toMatchObject({
        kind: 'playback',
        source: { title: 'Your solve', subtitle: 'Easy' },
      });
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.openDialog('history'));
      const [record] = result.current.history.records;
      act(() =>
        result.current.actions.watchRecord(record.id, { filter: 'all', limit: 100, id: record.id }),
      );
      expect(result.current.dialog).toMatchObject({
        kind: 'playback',
        source: { title: 'Your solve', subtitle: 'Easy' },
      });
    });

    it('played first: no time is given up, and the solve is free to watch from the Solved dialog', async () => {
      const { result, storage } = await linked();
      act(() => result.current.actions.watchFriendSolve());
      act(() => result.current.actions.playFirst());
      expect(result.current.dialog).toBeNull();
      expect(result.current.phase).toBe('playing');
      solveShared(result);
      expect(result.current.dialog).toMatchObject({
        kind: 'completion',
        result: { isWatched: false },
      });
      expect(result.current.canWatchChallengeSolve).toBe(true);
      // Solved: no card to offer it on any more.
      expect(result.current.friendSolve).toBeNull();

      const completion = result.current.dialog;
      act(() => result.current.actions.watchChallengeSolve());
      expect(result.current.dialog).toMatchObject({
        kind: 'playback',
        source: { title: "Dan's solve", log: THEIRS },
        returnTo: { kind: 'completion', isFriend: true },
      });
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toEqual({ ...completion, isBackFromFriend: true });
      expect(hasWatched(storage, SHARED.givens)).toBe(false);
      expect(loadHistory(storage)[0]).not.toHaveProperty('watched');
    });

    it('is free, with no warning, for a puzzle solved already', async () => {
      const storage = memoryStorage();
      upsertRecord(storage, solvedRecord(SHARED, 120_000));
      const { result } = await linked({ storage });
      expect(result.current.dialog?.kind).toBe('challenge');
      expect(result.current.canWatchChallengeSolve).toBe(true);
      const offer = result.current.dialog;
      act(() => result.current.actions.watchChallengeSolve());
      expect(result.current.dialog).toMatchObject({
        kind: 'playback',
        source: { title: "Dan's solve" },
        returnTo: { kind: 'challenge' },
      });
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toEqual({ ...offer, isBackFromWatch: true });
      expect(hasWatched(storage, SHARED.givens)).toBe(false);
    });

    it('opens the player at once for an unfinished attempt with a solve of it already solved', async () => {
      const storage = memoryStorage();
      const first = await linked({ storage });
      act(() => first.result.current.actions.resume());
      enter(first.result, 0, answerAt(0, SHARED));
      act(() => first.result.current.actions.pause());
      // Solved in another attempt meanwhile — on another device, imported.
      upsertRecord(storage, solvedRecord(SHARED, 120_000, 'elsewhere'));
      first.unmount();
      const { result } = setup({ storage, search: LINK });
      expect(result.current.phase).toBe('paused');
      expect(result.current.friendSolve).toEqual({ name: 'Dan' });
      act(() => result.current.actions.watchFriendSolve());
      expect(result.current.dialog).toMatchObject({ kind: 'playback', returnTo: { kind: 'game' } });
      expect(hasWatched(storage, SHARED.givens)).toBe(false);
    });

    it('asks first from the Paused card too, for an attempt reopened from the link', async () => {
      const storage = memoryStorage();
      const first = await linked({ storage });
      act(() => first.result.current.actions.resume());
      enter(first.result, 0, answerAt(0, SHARED));
      act(() => first.result.current.actions.pause());
      first.unmount();
      const { result } = setup({ storage, search: LINK });
      act(() => result.current.actions.watchFriendSolve());
      expect(result.current.dialog?.kind).toBe('spoiler');
      act(() => result.current.actions.confirmWatch());
      // The attempt in progress as they watched records no time either.
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.resume());
      for (const index of [40, 80]) enter(result, index, answerAt(index, SHARED));
      advance(COMPLETION_DELAY_MS);
      expect(result.current.dialog).toMatchObject({ result: { isWatched: true } });
    });

    it('asks nothing more once the solve has been watched, there being no time left to lose', async () => {
      const { result } = await linked();
      act(() => result.current.actions.watchFriendSolve());
      act(() => result.current.actions.confirmWatch());
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.watchFriendSolve());
      expect(result.current.dialog).toMatchObject({ kind: 'playback', returnTo: { kind: 'game' } });
    });

    describe('no attempt at a watched puzzle records a time', () => {
      /** The link opened, its solve watched, and the Ready card back. */
      async function watched(options: SetupOptions = {}) {
        const view = await linked(options);
        act(() => view.result.current.actions.watchFriendSolve());
        act(() => view.result.current.actions.confirmWatch());
        act(() => view.result.current.actions.closeDialog());
        return view;
      }

      it('reloaded mid-game', async () => {
        const storage = memoryStorage();
        const first = await watched({ storage });
        act(() => first.result.current.actions.resume());
        enter(first.result, 0, answerAt(0, SHARED));
        act(() => {
          window.dispatchEvent(new Event('pagehide'));
        });
        first.unmount();
        const { result } = setup({ storage });
        expect(result.current.record?.watched).toBe(true);
        act(() => result.current.actions.resume());
        for (const index of [40, 80]) enter(result, index, answerAt(index, SHARED));
        advance(COMPLETION_DELAY_MS);
        expect(result.current.dialog).toMatchObject({ result: { isWatched: true } });
      });

      it('played again once solved', async () => {
        const { result, storage } = await watched();
        act(() => result.current.actions.resume());
        solveShared(result);
        act(() => result.current.actions.closeDialog());
        act(() => result.current.actions.openDialog('history'));
        act(() => result.current.actions.replayRecord(result.current.record!.id));
        expect(result.current.record?.watched).toBe(true);
        solveShared(result);
        expect(result.current.dialog).toMatchObject({ result: { isWatched: true } });
        expect(loadHistory(storage).every((record) => record.watched === true)).toBe(true);
      });

      it('a new attempt the generator happens to deal', async () => {
        const storage = memoryStorage();
        const first = await watched({ storage });
        first.unmount();
        // Its record deleted: the puzzle is still watched.
        storage.removeItem('sudoku.history');
        storage.removeItem('sudoku.current');
        const { result } = await started({ storage, source: fakeSource(SHARED) });
        expect(result.current.record?.watched).toBe(true);
        solveShared(result);
        expect(result.current.dialog).toMatchObject({ result: { isWatched: true } });
        expect(computeStats(loadHistory(storage)).easy.bestMs).toBeNull();
      });

      it('resumed from History', async () => {
        const { result, storage } = await watched({ source: fakeSource(PUZZLE) });
        const id = result.current.record!.id;
        act(() => result.current.actions.newGame('easy'));
        await settle();
        expect(result.current.record?.id).not.toBe(id);
        act(() => result.current.actions.openDialog('history'));
        act(() => result.current.actions.resumeRecord(id));
        expect(result.current.record?.id).toBe(id);
        solveShared(result);
        expect(result.current.dialog).toMatchObject({ result: { isWatched: true } });
        expect(loadHistory(storage).find((record) => record.id === id)?.watched).toBe(true);
      });

      it('a daily, which does not count for the streak either', async () => {
        const TODAY = dateKeyOf(NOW);
        const dailies = fakeDailies({ puzzles: { [`${TODAY}/${SHARED.difficulty}`]: SHARED } });
        const { result } = await started({ dailies, search: `${LINK}&d=${TODAY}` });
        expect(result.current.record?.daily).toBe(TODAY);
        act(() => result.current.actions.watchFriendSolve());
        act(() => result.current.actions.confirmWatch());
        act(() => result.current.actions.closeDialog());
        act(() => result.current.actions.resume());
        solveShared(result);
        expect(result.current.dialog).toMatchObject({
          result: { isWatched: true, daily: { date: TODAY, streak: { kind: 'watched' } } },
        });
      });
    });

    it('is offered on a solved History row raced against it, free', async () => {
      const { result } = await linked();
      act(() => result.current.actions.resume());
      solveShared(result);
      act(() => result.current.actions.closeDialog());
      act(() => result.current.actions.openDialog('history'));
      const [record] = result.current.history.records;
      expect(result.current.actions.canWatchRecordChallenge(record)).toBe(true);
      const place = { filter: 'all', limit: 100, id: record.id, solve: 'friend' } as const;
      act(() => result.current.actions.watchRecordChallenge(record.id, place));
      expect(result.current.dialog).toMatchObject({
        kind: 'playback',
        source: { title: "Dan's solve" },
        returnTo: { kind: 'history', place },
      });
      act(() => result.current.actions.closeDialog());
      expect(result.current.dialog).toEqual({ kind: 'history', place });
      // Nothing for a row that is not solved, or one it cannot find.
      expect(result.current.actions.canWatchRecordChallenge({ ...record, status: 'playing' })).toBe(
        false,
      );
      act(() => result.current.actions.watchRecordChallenge('nope-0000', place));
      expect(result.current.dialog).toEqual({ kind: 'history', place });
    });

    it('says a solve from a newer version cannot be watched here, and offers none', async () => {
      const newer = linkFor(SHARED.givens, { t: '9', n: 'Dan', s: 'zAAAAAAAA' });
      const { result } = await started({ search: newer });
      expect(result.current.notice?.text).toBe(
        'This solve needs a newer version of the game to watch.',
      );
      expect(result.current.friendSolve).toBeNull();
      advance(0);
      expect(result.current.announcement?.text).toBe(
        'This solve needs a newer version of the game to watch.',
      );
    });

    it('does nothing when there is nothing to watch or confirm', async () => {
      const { result } = await started({ search: linkFor(SHARED.givens, { t: '9' }) });
      expect(result.current.friendSolve).toBeNull();
      expect(result.current.canWatchChallengeSolve).toBe(false);
      act(() => result.current.actions.watchFriendSolve());
      act(() => result.current.actions.confirmWatch());
      act(() => result.current.actions.watchChallengeSolve());
      expect(result.current.dialog).toBeNull();
    });
  });
});
