import {
  MAX_MOVES,
  MOVES_VERSION,
  STOPPED_CLOCK,
  appendMove,
  createGame,
  createMoveLog,
  dateKeyOf,
  encodeMoveLog,
  findHint,
  gridValues,
  reduce,
  serialiseGame,
  valuesOf,
  type Digit,
  type MoveLog,
  type Puzzle,
} from '../core';
import {
  deleteRecord,
  loadGameBlob,
  loadHistory,
  markSeen,
  saveCurrentId,
  saveGameBlob,
  saveGameMoves,
  upsertRecord,
  type Challenge,
  type GameRecord,
} from '../storage/history';
import { loadEncodedMoveLog, loadMoveLog } from '../storage/moveLogs';
import { LOG_IN_A_LATER_FORMAT, logFromAnotherBuild } from '../test/movePlayers';
import { memoryStorage, type StorageLike } from '../storage/storage';
import {
  advance,
  asDaily,
  tagDaily,
  attemptSource,
  createRecord,
  hasBoardShown,
  isGlimpse,
  newSession,
  pauseSession,
  phaseOf,
  planStartup,
  puzzleOf,
  recordOf,
  restoreSession,
  resumeSession,
  saveSession,
  shareTargetOf,
  shareTargetOfRecord,
  type Moment,
  type Session,
} from './session';
import { FIRST_EMPTY, PUZZLE, answerAt, linkFor, nearlySolved } from './testFixtures';

const NOW = Date.UTC(2026, 9, 12, 12);
const NO_HELP = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
const DAN: Challenge = { name: 'Dan', seconds: 323, assists: NO_HELP };

/** A moment when both clocks agree, as they do unless a test says otherwise. */
function at(ms: number): Moment {
  return { wall: ms, clock: ms };
}

function running(puzzle: Puzzle = PUZZLE, now = NOW): Session {
  return newSession(puzzle, {
    source: 'generated',
    challenge: null,
    now: at(now),
    autoCandidates: false,
    start: 'running',
  });
}

/** Save a session as the game on screen, the way the hook leaves storage. */
function saveAsCurrent(storage: StorageLike, session: Session, now = NOW): void {
  saveSession(storage, session, at(now));
  saveCurrentId(storage, session.record.id);
}

describe('phaseOf', () => {
  it('is loading with no game, or while a new one is generated', () => {
    expect(phaseOf(null, false)).toBe('loading');
    // The old game stays on hand while the new one is made, but it is not on show.
    expect(phaseOf(running(), true)).toBe('loading');
  });

  it('follows the clock for an unsolved game', () => {
    const session = running();
    expect(phaseOf(session, false)).toBe('playing');
    expect(phaseOf(pauseSession(session, 'user', NOW + 1000), false)).toBe('paused');
  });

  it('is ready for a shared game waiting behind its Start button', () => {
    const session = newSession(PUZZLE, {
      source: 'shared',
      challenge: null,
      now: at(NOW),
      autoCandidates: false,
      start: 'ready',
    });
    expect(phaseOf(session, false)).toBe('ready');
  });

  it('is solved once the board is, whatever the clock says', () => {
    const near = running(nearlySolved([0]));
    const game = reduce(near.game, { type: 'enter', digit: answerAt(0) as 1 });
    expect(phaseOf({ ...near, game }, false)).toBe('solved');
  });
});

describe('newSession', () => {
  it('starts the clock at once for a game that begins running', () => {
    const session = running();
    expect(session.clock).toEqual({ bankedMs: 0, runningSince: NOW });
    expect(session.pause).toBeNull();
    expect(session.isSeen).toBe(true);
    expect(session.game.selected).toBe(FIRST_EMPTY);
  });

  it('times play by the play clock and dates the record by the wall clock', () => {
    const session = newSession(PUZZLE, {
      source: 'generated',
      challenge: null,
      now: { wall: NOW, clock: 1234 },
      autoCandidates: false,
      start: 'running',
    });
    expect(session.clock.runningSince).toBe(1234);
    expect(session.record.createdAt).toBe(NOW);
  });

  it('holds the clock for a ready game or one behind a dialog, saying why', () => {
    const options = {
      source: 'shared',
      challenge: DAN,
      now: at(NOW),
      autoCandidates: false,
    } as const;
    const ready = newSession(PUZZLE, { ...options, start: 'ready' });
    expect(ready.clock).toBe(STOPPED_CLOCK);
    expect(ready.pause).toBe('ready');
    // Its Start card is on show, so it has been seen; a game behind a dialog has not.
    expect(ready.isSeen).toBe(true);
    const held = newSession(PUZZLE, { ...options, start: 'dialog' });
    expect(held.pause).toBe('dialog');
    expect(held.isSeen).toBe(false);
  });

  it('records the puzzle, its source and its challenge', () => {
    const { record } = newSession(PUZZLE, {
      source: 'shared',
      challenge: DAN,
      now: at(NOW),
      autoCandidates: false,
      start: 'ready',
    });
    expect(record).toMatchObject({
      givens: PUZZLE.givens,
      difficulty: PUZZLE.difficulty,
      source: 'shared',
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      status: 'playing',
      elapsedMs: 0,
      challenge: DAN,
    });
    expect(record.id).toMatch(/^[a-z0-9]+-[a-z0-9]{4}$/);
  });

  it('starts in auto candidate mode when the setting says, and counts it as help from the start', () => {
    const session = newSession(PUZZLE, {
      source: 'generated',
      challenge: null,
      now: at(NOW),
      autoCandidates: true,
      start: 'running',
    });
    expect(session.game.autoCandidates).toBe(true);
    expect(session.record.assists.autoCandidates).toBe(true);
  });
});

describe('attemptSource', () => {
  it('calls a puzzle already in the history a replay, whatever brought it', () => {
    const storage = memoryStorage();
    const record = createRecord(PUZZLE, 'generated', NOW, null, NO_HELP);
    expect(attemptSource(storage, [record], PUZZLE.givens, 'shared')).toBe('replay');
    expect(attemptSource(storage, [record], PUZZLE.givens, 'generated')).toBe('replay');
    expect(attemptSource(storage, [record], nearlySolved([0]).givens, 'shared')).toBe('shared');
    expect(attemptSource(storage, [], PUZZLE.givens, 'generated')).toBe('generated');
  });

  it('calls a puzzle seen in an attempt since deleted a replay too', () => {
    const storage = memoryStorage();
    markSeen(storage, PUZZLE.givens);
    expect(attemptSource(storage, [], PUZZLE.givens, 'shared')).toBe('replay');
  });
});

describe('hasBoardShown', () => {
  it('is true once the clock has run, board in view, and stays true through a pause', () => {
    const session = running();
    expect(hasBoardShown(session)).toBe(true);
    expect(hasBoardShown(pauseSession(session, 'hidden', NOW + 1000))).toBe(true);
  });

  it.each([
    ['waiting behind its Start button', 'ready'],
    ['made behind a dialog', 'dialog'],
  ] as const)('is false for a game %s', (_label, start) => {
    const session = newSession(PUZZLE, {
      source: 'shared',
      challenge: null,
      now: at(NOW),
      autoCandidates: false,
      start,
    });
    expect(hasBoardShown(session)).toBe(false);
    expect(hasBoardShown(resumeSession(session, at(NOW + 1000)))).toBe(true);
  });
});

describe('isGlimpse', () => {
  it('is true for a generated game nobody has touched, however long it was looked at', () => {
    expect(isGlimpse(pauseSession(running(), 'user', NOW + 300_000))).toBe(true);
  });

  it.each([
    ['a number entered', { type: 'enter', digit: answerAt(FIRST_EMPTY) as 1, mode: 'normal' }],
    ['a candidate pencilled in', { type: 'enter', digit: 1, mode: 'candidate' }],
    ['auto candidates switched on', { type: 'setAutoCandidates', enabled: true }],
    ['a hint taken', { type: 'hint', hint: { kind: 'deduction', index: 0, technique: null } }],
  ] as const)('is false once the player has done something: %s', (_label, action) => {
    const session = running();
    const game = reduce(session.game, action as Parameters<typeof reduce>[1]);
    expect(game).not.toBe(session.game);
    expect(isGlimpse({ ...session, game })).toBe(false);
  });

  it('is true for an untouched game started in auto candidate mode by the setting', () => {
    const session = running();
    const game = createGame(session.game.puzzle, { autoCandidates: true });
    expect(game.assists.autoCandidates).toBe(true);
    expect(isGlimpse({ ...session, game })).toBe(true);
  });

  it('is false once auto candidates were switched on and back off by hand', () => {
    const session = running();
    const on = reduce(session.game, { type: 'setAutoCandidates', enabled: true });
    const undone = reduce(on, { type: 'undo' });
    expect(undone.undoStack).toHaveLength(0);
    expect(isGlimpse({ ...session, game: undone })).toBe(false);
  });

  it('is false with a move to undo, even once the board is back to its givens', () => {
    const session = running();
    const entered = reduce(session.game, { type: 'enter', digit: 1, mode: 'normal' });
    const erased = reduce(entered, { type: 'erase' });
    expect(erased.cells[FIRST_EMPTY].value).toBe(0);
    expect(isGlimpse({ ...session, game: erased })).toBe(false);
  });

  it('is false for a candidate struck out of auto candidates, the help itself apart', () => {
    // After a reload there is nothing to undo, but the board still shows the work.
    const session = running();
    const game = {
      ...session.game,
      cells: session.game.cells.map((cell, i) =>
        i === FIRST_EMPTY ? { ...cell, autoRemoved: 2 } : cell,
      ),
    };
    expect(isGlimpse({ ...session, game })).toBe(false);
  });

  it.each([['shared'], ['replay']] as const)('is false for a %s game', (source) => {
    const session = running();
    expect(isGlimpse({ ...session, record: { ...session.record, source } })).toBe(false);
  });

  it('is false for a solved game', () => {
    const session = running(nearlySolved([0]));
    const game = reduce(session.game, { type: 'enter', digit: answerAt(0) as 1, mode: 'normal' });
    expect(game.status).toBe('solved');
    expect(isGlimpse({ ...session, game: { ...game, undoStack: [] } })).toBe(false);
  });
});

describe('createRecord', () => {
  it('records the daily a game is an attempt at, and leaves it off every other', () => {
    expect(createRecord(PUZZLE, 'daily', NOW, null, NO_HELP, '2026-10-12').daily).toBe(
      '2026-10-12',
    );
    expect(createRecord(PUZZLE, 'generated', NOW, null, NO_HELP)).not.toHaveProperty('daily');
    const session = newSession(PUZZLE, {
      source: 'daily',
      challenge: null,
      now: at(NOW),
      autoCandidates: false,
      start: 'running',
      daily: '2026-10-12',
    });
    expect(session.record).toMatchObject({ source: 'daily', daily: '2026-10-12' });
  });

  it('dates a daily attempt started at once by the player’s own date, and only a daily', () => {
    const record = createRecord(PUZZLE, 'daily', NOW, null, NO_HELP, '2026-10-12');
    expect(record.startedOn).toBe(dateKeyOf(NOW));
    expect(createRecord(PUZZLE, 'generated', NOW, null, NO_HELP)).not.toHaveProperty('startedOn');
    // One waiting behind its Start card, or a dialog, has not been started yet.
    expect(
      createRecord(PUZZLE, 'daily', NOW, null, NO_HELP, '2026-10-12', false),
    ).not.toHaveProperty('startedOn');
    for (const start of ['ready', 'dialog'] as const) {
      const waiting = newSession(PUZZLE, {
        source: 'daily',
        challenge: null,
        now: at(NOW),
        autoCandidates: false,
        start,
        daily: '2026-10-12',
      });
      expect(waiting.record).not.toHaveProperty('startedOn');
    }
  });

  it('copies the assists, so the game and its record never share an object', () => {
    const assists = { ...NO_HELP };
    const record = createRecord(PUZZLE, 'replay', NOW, null, assists);
    assists.hints = 5;
    expect(record.assists.hints).toBe(0);
  });
});

describe('asDaily', () => {
  it('makes an attempt the daily of a date, at the daily’s own tier', () => {
    const session = running();
    const tagged = asDaily(session, '2026-10-12', 'expert');
    expect(tagged.record).toMatchObject({ daily: '2026-10-12', difficulty: 'expert' });
    expect(tagged.game).toBe(session.game);
    // Already that daily: the very same session, so nothing needs saving.
    expect(asDaily(tagged, '2026-10-12', 'expert')).toBe(tagged);
  });

  it('dates an attempt already started by the day it was created, and one not yet started not at all', () => {
    expect(asDaily(running(), '2026-10-12', 'hard').record.startedOn).toBe(dateKeyOf(NOW));
    const waiting = newSession(PUZZLE, {
      source: 'shared',
      challenge: null,
      now: at(NOW),
      autoCandidates: false,
      start: 'ready',
    });
    expect(asDaily(waiting, '2026-10-12', 'hard').record).not.toHaveProperty('startedOn');
  });
});

describe('tagDaily', () => {
  it('keeps a start date already written down', () => {
    const record = { ...running().record, startedOn: '2026-10-11' };
    expect(tagDaily(record, '2026-10-12', 'hard', true).startedOn).toBe('2026-10-11');
  });

  it('dates a started record by the day it was created, and leaves an unstarted one undated', () => {
    const { record } = running();
    expect(tagDaily(record, '2026-10-12', 'hard', true)).toMatchObject({
      daily: '2026-10-12',
      difficulty: 'hard',
      startedOn: dateKeyOf(NOW),
    });
    expect(tagDaily(record, '2026-10-12', 'hard', false)).not.toHaveProperty('startedOn');
  });
});

describe('resumeSession and the start date', () => {
  const DAY = 86_400_000;

  it('dates a daily attempt when its clock first runs, not when it was opened', () => {
    // Opened from a link the evening before its day, and left behind Start.
    const waiting = asDaily(
      newSession(PUZZLE, {
        source: 'shared',
        challenge: null,
        now: at(NOW),
        autoCandidates: false,
        start: 'ready',
      }),
      '2026-10-13',
      'hard',
    );
    const started = resumeSession(waiting, at(NOW + DAY));
    expect(started.record.startedOn).toBe(dateKeyOf(NOW + DAY));
    // Resumed again later, it keeps the date it was first started on.
    const paused = pauseSession(started, 'user', NOW + DAY + 1000);
    expect(resumeSession(paused, at(NOW + 3 * DAY)).record.startedOn).toBe(dateKeyOf(NOW + DAY));
  });

  it('dates an attempt that has run before, its date never written down, by the day it was created', () => {
    const { startedOn: _, ...undated } = asDaily(running(), '2026-10-12', 'hard').record;
    const paused = pauseSession({ ...running(), record: undated }, 'user', NOW + 1000);
    expect(resumeSession(paused, at(NOW + 3 * DAY)).record.startedOn).toBe(dateKeyOf(NOW));
  });

  it('dates no other game', () => {
    const held = newSession(PUZZLE, {
      source: 'generated',
      challenge: null,
      now: at(NOW),
      autoCandidates: false,
      start: 'dialog',
    });
    expect(resumeSession(held, at(NOW + DAY)).record).not.toHaveProperty('startedOn');
  });
});

describe('pausing and resuming', () => {
  it('banks the running time on a pause, and starts a new segment on resume', () => {
    const paused = pauseSession(running(), 'hidden', NOW + 61_000);
    expect(paused.clock).toEqual({ bankedMs: 61_000, runningSince: null });
    expect(paused.pause).toBe('hidden');
    const resumed = resumeSession(paused, at(NOW + 100_000));
    expect(resumed.clock).toEqual({ bankedMs: 61_000, runningSince: NOW + 100_000 });
    expect(resumed.pause).toBeNull();
  });

  it('marks a game resumed from behind a dialog as seen', () => {
    const held = newSession(PUZZLE, {
      source: 'generated',
      challenge: null,
      now: at(NOW),
      autoCandidates: false,
      start: 'dialog',
    });
    expect(resumeSession(held, at(NOW + 1000)).isSeen).toBe(true);
  });

  it('leaves a stopped session alone, keeping the reason it was stopped for', () => {
    // A dialog opened over a game the player paused must not relabel the
    // pause, or closing it would resume a game the player meant to keep paused.
    const paused = pauseSession(running(), 'user', NOW + 1000);
    expect(pauseSession(paused, 'dialog', NOW + 2000)).toBe(paused);
  });
});

describe('the move log', () => {
  const answer = answerAt(FIRST_EMPTY) as Digit;
  const place = { type: 'enter', digit: answer } as const;
  /** Another empty cell's answer, for a move after `place`. */
  const second = PUZZLE.givens.indexOf('0', FIRST_EMPTY + 1);
  const placeSecond = { type: 'enter', digit: answerAt(second) as Digit, index: second } as const;

  it('starts empty with every new game, saying whether it began in auto candidate mode', () => {
    expect(running().moves).toEqual({ autoCandidates: false, moves: [], truncated: false });
    const auto = newSession(PUZZLE, {
      source: 'generated',
      challenge: null,
      now: at(NOW),
      autoCandidates: true,
      start: 'running',
    });
    expect(auto.moves).toEqual(createMoveLog({ autoCandidates: true }));
  });

  describe('advance', () => {
    it('makes the move and logs it at the time on the play clock', () => {
      const next = advance(running(), place, NOW + 12_345);
      expect(next.game.cells[FIRST_EMPTY].value).toBe(answer);
      expect(next.moves?.moves).toEqual([
        { op: 'place', cell: FIRST_EMPTY, digit: answer, clearPeerNotes: false, at: 12_300 },
      ]);
    });

    it('counts play only: time paused adds nothing', () => {
      const paused = pauseSession(running(), 'user', NOW + 5000);
      const resumed = resumeSession(paused, at(NOW + 65_000));
      const next = advance(resumed, place, NOW + 66_000);
      expect(next.moves?.moves[0].at).toBe(6000);
    });

    it('logs a move made while the clock is stopped at the time it stopped at', () => {
      // A reset is confirmed behind its dialog, with the clock held.
      const paused = pauseSession(advance(running(), place, NOW + 1000), 'dialog', NOW + 4000);
      const next = advance(paused, { type: 'reset' }, NOW + 90_000);
      expect(next.moves?.moves.map((move) => move.at)).toEqual([1000, 4000]);
    });

    it('comes back unchanged — the same object — for a move that changes nothing', () => {
      const session = running();
      expect(advance(session, { type: 'erase' }, NOW + 1000)).toBe(session);
    });

    it('changes the game but logs nothing for a selection', () => {
      const session = running();
      const next = advance(session, { type: 'select', index: 80 }, NOW + 1000);
      expect(next.game.selected).toBe(80);
      expect(next.moves).toBe(session.moves);
    });

    it('logs Show me opened again for a cell already counted, which changes nothing', () => {
      const session = running();
      const hint = findHint(valuesOf(session.game), gridValues(PUZZLE.solution));
      const hinted = advance(session, { type: 'hint', hint }, NOW + 1000);
      const index = (hint as { index: number }).index;
      const once = advance(hinted, { type: 'walkthrough', index }, NOW + 2000);
      const twice = advance(once, { type: 'walkthrough', index }, NOW + 3000);
      expect(twice.game).toBe(once.game);
      expect(twice.moves?.moves.map((move) => move.op)).toEqual([
        'hint',
        'walkthrough',
        'walkthrough',
      ]);
    });

    it('plays on without logging a game that is not being recorded', () => {
      const next = advance({ ...running(), moves: null }, place, NOW + 1000);
      expect(next.game.cells[FIRST_EMPTY].value).toBe(answer);
      expect(next.moves).toBeNull();
    });

    it('stops recording a game whose log reaches its limit', () => {
      // Cut off, the log would no longer reach the game.
      let moves: MoveLog = createMoveLog();
      const select = { op: 'erase', cell: 0 } as const;
      for (let i = 0; i < MAX_MOVES; i++) moves = appendMove(moves, select, 0);
      const next = advance({ ...running(), moves }, place, NOW + 1000);
      expect(next.game.cells[FIRST_EMPTY].value).toBe(answer);
      expect(next.moves).toBeNull();
    });
  });

  describe('saved and restored', () => {
    /** A game a few moves in, as the hook leaves it: every move through `advance`. */
    function played(): Session {
      let session = running();
      session = advance(session, place, NOW + 2000);
      session = advance(
        session,
        { type: 'enter', digit: 1, index: 2, mode: 'candidate' },
        NOW + 3500,
      );
      return advance(session, { type: 'undo' }, NOW + 4000);
    }

    it('saves the log with the game, under its own key, and nowhere else', () => {
      const storage = memoryStorage();
      const session = played();
      saveSession(storage, session, at(NOW + 5000));
      const encoded = encodeMoveLog(session.moves!);
      expect(loadEncodedMoveLog(storage, session.record.id)).toBe(encoded);
      expect(storage.getItem('sudoku.history')).not.toContain(encoded);
      expect(JSON.stringify(loadGameBlob(storage, session.record.id))).not.toContain(encoded);
    });

    it('reopens the log with its game when it replays to the board saved, and goes on with it', () => {
      const storage = memoryStorage();
      const session = played();
      const { records } = saveSession(storage, session, at(NOW + 5000));
      const restored = restoreSession(storage, records, session.record.id, NOW + 9000)!;
      expect(restored.moves).toEqual(session.moves);

      const resumed = resumeSession(restored, at(NOW + 20_000));
      const next = advance(resumed, placeSecond, NOW + 21_000);
      expect(next.moves?.moves.at(-1)?.at).toBe(6000);
      const again = saveSession(storage, next, at(NOW + 22_000)).records;
      expect(restoreSession(storage, again, session.record.id, NOW + 30_000)?.moves).toEqual(
        next.moves,
      );
    });

    it('does not record a game saved without a log — one begun before logs were kept', () => {
      const storage = memoryStorage();
      const session = played();
      saveGameBlob(storage, session.record.id, serialiseGame(session.game));
      upsertRecord(storage, recordOf(session, at(NOW + 5000)));
      const restored = restoreSession(storage, loadHistory(storage), session.record.id, NOW)!;
      expect(restored.moves).toBeNull();
      expect(restored.game.cells[FIRST_EMPTY].value).toBe(answer);
    });

    it('does not record a game whose log does not decode', () => {
      const storage = memoryStorage();
      const session = played();
      const { records } = saveSession(storage, session, at(NOW + 5000));
      storage.setItem(`sudoku.moves.${session.record.id}`, 'garbled');
      expect(restoreSession(storage, records, session.record.id, NOW)?.moves).toBeNull();
    });

    it('stops recording a game played on without its log, and deletes the log left behind', () => {
      // A tab still on a version from before logs were kept plays on: the
      // board moves, the log stays where it was.
      const storage = memoryStorage();
      const session = played();
      saveSession(storage, session, at(NOW + 5000));
      const game = reduce(session.game, placeSecond);
      saveGameBlob(storage, session.record.id, serialiseGame(game));

      const restored = restoreSession(storage, loadHistory(storage), session.record.id, NOW)!;
      expect(restored.moves).toBeNull();
      saveSession(storage, restored, at(NOW + 6000));
      expect(loadEncodedMoveLog(storage, session.record.id)).toBeNull();
    });

    it('takes up the clock from the log when its last move is later than the record’s time', () => {
      // The record's write was refused after the log's went through: the
      // time played since must not be lost.
      const storage = memoryStorage();
      const session = played();
      const { records } = saveSession(storage, session, at(NOW + 5000));
      const later = advance(session, placeSecond, NOW + 25_050);
      saveGameBlob(storage, session.record.id, serialiseGame(later.game));
      saveGameMoves(storage, session.record.id, later.moves);
      const restored = restoreSession(storage, records, session.record.id, NOW)!;
      expect(restored.moves).toEqual(later.moves);
      expect(restored.clock.bankedMs).toBe(25_000);
    });

    it('saves the log before the board and the record', () => {
      const storage = memoryStorage();
      const session = played();
      const set = vi.spyOn(storage, 'setItem');
      saveSession(storage, session, at(NOW + 5000));
      const keys = set.mock.calls.map(([key]) => key);
      const log = keys.indexOf(`sudoku.moves.${session.record.id}`);
      expect(log).toBeGreaterThanOrEqual(0);
      expect(log).toBeLessThan(keys.indexOf(`sudoku.game.${session.record.id}`));
      expect(log).toBeLessThan(keys.indexOf('sudoku.history'));
    });

    it('reopens a log saved ahead of its board trimmed back to the board', () => {
      // The log went through, the board after it did not (refused for space,
      // or lost to a crash): the moves the board never got go with it, and
      // what is left is the whole log of the game as saved.
      const storage = memoryStorage();
      const session = played();
      const { records } = saveSession(storage, session, at(NOW + 5000));
      const later = advance(session, placeSecond, NOW + 25_050);
      saveGameMoves(storage, session.record.id, later.moves);
      const restored = restoreSession(storage, records, session.record.id, NOW)!;
      expect(restored.moves).toEqual(session.moves);
      expect(restored.game.cells[second].value).toBe(0);
      // The record's time, not the dropped move's.
      expect(restored.clock.bankedMs).toBe(5000);
      saveSession(storage, restored, at(NOW + 6000));
      expect(loadMoveLog(storage, session.record.id)).toEqual(session.moves);
    });

    it.each([
      ['a later format', LOG_IN_A_LATER_FORMAT],
      ['a later rules version', logFromAnotherBuild(MOVES_VERSION + 1, 2754)],
      ['a move code added since', logFromAnotherBuild(MOVES_VERSION, 2759)],
    ])(
      'leaves a log of %s alone as it reopens the game, for the build that wrote it',
      (_, newer) => {
        // A newer build in another tab recorded the game; this tab cannot read
        // its log, so it does not record the game, nor throw the log away.
        const storage = memoryStorage();
        const session = played();
        const { records } = saveSession(storage, session, at(NOW + 5000));
        storage.setItem(`sudoku.moves.${session.record.id}`, newer);
        const restored = restoreSession(storage, records, session.record.id, NOW)!;
        expect(restored.moves).toBeNull();
        const resumed = resumeSession(restored, at(NOW + 6000));
        saveSession(storage, resumed, at(NOW + 7000));
        saveSession(storage, pauseSession(resumed, 'user', NOW + 8000), at(NOW + 8000));
        expect(loadEncodedMoveLog(storage, session.record.id)).toBe(newer);
      },
    );

    it('takes up the clock from the record when it is later than the log', () => {
      const storage = memoryStorage();
      const session = played();
      const { records } = saveSession(storage, session, at(NOW + 50_000));
      expect(restoreSession(storage, records, session.record.id, NOW)?.clock.bankedMs).toBe(50_000);
    });

    it('reopens paused, not behind Start, a game whose time only its log kept', () => {
      // Auto candidates on and off leave the board as it began; with the
      // record's time lost, only the log says the game was ever started.
      const storage = memoryStorage();
      let session = running();
      session = advance(session, { type: 'setAutoCandidates', enabled: true }, NOW + 3000);
      session = advance(session, { type: 'setAutoCandidates', enabled: false }, NOW + 4000);
      saveGameBlob(storage, session.record.id, serialiseGame(session.game));
      saveGameMoves(storage, session.record.id, session.moves);
      const restored = restoreSession(storage, [], session.record.id, NOW + 5000)!;
      expect(restored.clock.bankedMs).toBe(4000);
      expect(restored.pause).toBe('restored');
    });

    it('keeps a solved game’s log once its board has gone', () => {
      const storage = memoryStorage();
      const near = running(nearlySolved([0]));
      const solved = advance(
        near,
        { type: 'enter', digit: answerAt(0) as Digit, index: 0 },
        NOW + 9000,
      );
      saveCurrentId(storage, near.record.id);
      saveSession(storage, solved, at(NOW + 9000));
      saveCurrentId(storage, null);
      upsertRecord(storage, recordOf(running(), at(NOW + 10_000)));
      expect(loadGameBlob(storage, near.record.id)).toBeNull();
      expect(loadMoveLog(storage, near.record.id)).toEqual(solved.moves);
    });
  });
});

describe('recordOf', () => {
  it('brings the status, time and help taken up to date', () => {
    const session = running();
    const game = reduce(session.game, { type: 'check', scope: 'puzzle' });
    const record = recordOf({ ...session, game }, at(NOW + 5000));
    expect(record.elapsedMs).toBe(5000);
    expect(record.updatedAt).toBe(NOW + 5000);
    expect(record.status).toBe('playing');
    // Nothing to check yet, so no check was counted — and none recorded.
    expect(record.assists.checks).toBe(game.assists.checks);
  });

  it('takes the time from the play clock and the date from the wall clock', () => {
    // The system clock set back an hour mid-game: the time is unaffected.
    const session = { ...running(), clock: { bankedMs: 0, runningSince: 500 } };
    const record = recordOf(session, { wall: NOW + 3_600_000, clock: 8500.75 });
    // In whole milliseconds.
    expect(record.elapsedMs).toBe(8000);
    expect(record.updatedAt).toBe(NOW + 3_600_000);
  });

  it('never dates an update before the game was created', () => {
    // A clock set back after the game began must not make the record older
    // than itself — the history would drop it as malformed.
    expect(recordOf(running(), at(NOW - 60_000)).updatedAt).toBe(NOW);
  });
});

describe('saveSession and restoreSession', () => {
  it('saves the board and the record together, and reopens them paused', () => {
    const storage = memoryStorage();
    const session = running();
    const game = reduce(session.game, { type: 'enter', digit: answerAt(FIRST_EMPTY) as 1 });
    const { records, isBoardSaved } = saveSession(storage, { ...session, game }, at(NOW + 42_000));
    expect(records).toHaveLength(1);
    expect(isBoardSaved).toBe(true);
    expect(loadGameBlob(storage, session.record.id)).toEqual(serialiseGame(game));

    const restored = restoreSession(storage, records, session.record.id, NOW + 99_000)!;
    expect(restored.game.cells[FIRST_EMPTY].value).toBe(answerAt(FIRST_EMPTY));
    expect(restored.clock).toEqual({ bankedMs: 42_000, runningSince: null });
    expect(restored.pause).toBe('restored');
    expect(restored.isCelebrating).toBe(false);
    expect(restored.isSeen).toBe(true);
  });

  it('says when the board could not be saved, though the record was', () => {
    const inner = memoryStorage();
    const storage: StorageLike = {
      ...inner,
      setItem: (key, value) => {
        if (key.startsWith('sudoku.game')) throw new DOMException('Full', 'QuotaExceededError');
        inner.setItem(key, value);
      },
    };
    const { records, isBoardSaved } = saveSession(storage, running(), at(NOW));
    expect(isBoardSaved).toBe(false);
    expect(records).toHaveLength(1);
  });

  it('reopens a game that was never started behind its Start button, not paused at 0:00', () => {
    const storage = memoryStorage();
    const ready = newSession(PUZZLE, {
      source: 'shared',
      challenge: DAN,
      now: at(NOW),
      autoCandidates: false,
      start: 'ready',
    });
    const { records } = saveSession(storage, ready, at(NOW));
    const restored = restoreSession(storage, records, ready.record.id, NOW + 1000)!;
    expect(restored.pause).toBe('ready');
    expect(phaseOf(restored, false)).toBe('ready');
    expect(restored.record.challenge).toEqual(DAN);
  });

  it.each([
    ['a number entered', (game: Session['game']) => reduce(game, { type: 'enter', digit: 1 })],
    [
      'a candidate noted',
      (game: Session['game']) => reduce(game, { type: 'enter', digit: 1, mode: 'candidate' }),
    ],
  ])('reopens a game with %s paused, even with no time on it', (_, change) => {
    const storage = memoryStorage();
    const session = running();
    const { records } = saveSession(storage, { ...session, game: change(session.game) }, at(NOW));
    expect(restoreSession(storage, records, session.record.id, NOW)?.pause).toBe('restored');
  });

  it('reopens a game with time on it paused, even with nothing entered', () => {
    const storage = memoryStorage();
    const session = running();
    const { records } = saveSession(storage, session, at(NOW + 3000));
    expect(restoreSession(storage, records, session.record.id, NOW)?.pause).toBe('restored');
  });

  it('reopens a solved game on show, stopped, with no pause to lift', () => {
    const storage = memoryStorage();
    const near = running(nearlySolved([0]));
    const game = reduce(near.game, { type: 'enter', digit: answerAt(0) as 1 });
    const solved: Session = {
      ...near,
      game,
      clock: { bankedMs: 90_000, runningSince: null },
      record: { ...near.record, completedAt: NOW + 90_000 },
    };
    // Current first: a finished game's state is only kept while it is on screen.
    saveCurrentId(storage, near.record.id);
    const { records } = saveSession(storage, solved, at(NOW + 90_000));
    const restored = restoreSession(storage, records, near.record.id, NOW + 200_000)!;
    expect(restored.game.status).toBe('solved');
    expect(restored.pause).toBeNull();
    expect(restored.record.completedAt).toBe(NOW + 90_000);
  });

  it('is null when there is nothing saved, or it does not validate', () => {
    const storage = memoryStorage();
    expect(restoreSession(storage, [], 'missing-0000', NOW)).toBeNull();
    saveGameBlob(storage, 'junk-0000', { v: 1, nonsense: true });
    expect(restoreSession(storage, [], 'junk-0000', NOW)).toBeNull();
  });

  it('refuses a saved game whose record names another puzzle', () => {
    // One of the two is corrupt; resuming either would contradict the other.
    const storage = memoryStorage();
    const session = running();
    saveSession(storage, session, at(NOW));
    const [record] = loadHistory(storage);
    const other = { ...record, givens: nearlySolved([0, 1]).givens };
    expect(restoreSession(storage, [other], record.id, NOW)).toBeNull();
  });

  it('keeps a saved game whose record went missing, starting its time again', () => {
    const storage = memoryStorage();
    const session = running();
    saveGameBlob(storage, session.record.id, serialiseGame(session.game));
    const restored = restoreSession(storage, [], session.record.id, NOW + 5000)!;
    expect(restored.record).toMatchObject({
      id: session.record.id,
      givens: PUZZLE.givens,
      elapsedMs: 0,
      createdAt: NOW + 5000,
      completedAt: null,
      challenge: null,
    });
  });

  it('dates a solve whose record never heard of it as finished when it is found', () => {
    // The board was saved solved, but the record's own write failed.
    const storage = memoryStorage();
    const near = running(nearlySolved([0]));
    const game = reduce(near.game, { type: 'enter', digit: answerAt(0) as 1 });
    saveGameBlob(storage, near.record.id, serialiseGame(game));
    const restored = restoreSession(
      storage,
      [recordOf(near, at(NOW))],
      near.record.id,
      NOW + 5000,
    )!;
    expect(restored.record).toMatchObject({ status: 'solved', completedAt: NOW + 5000 });
  });

  describe('in a tab still open on this version after a newer one is deployed', () => {
    /** Storage as a newer version leaves it after saving `session`: new fields on the record and the board. */
    function savedByNewer(session: Session, isOnBoard: boolean): StorageLike {
      const storage = memoryStorage();
      saveSession(storage, session, at(NOW));
      const [record] = loadHistory(storage);
      storage.setItem(
        'sudoku.history',
        JSON.stringify([
          {
            ...record,
            mistakes: { values: 1, candidates: 0 },
            assists: { ...record.assists, checkGuesses: true },
          },
        ]),
      );
      const blob = loadGameBlob(storage, session.record.id) as Record<string, object>;
      const assists = isOnBoard ? { ...blob.assists, checkGuesses: true } : blob.assists;
      saveGameBlob(storage, session.record.id, { ...blob, assists, undo: 'ab' });
      return storage;
    }

    /** Restore the game, play a move and save it, as the old tab would. */
    function playOn(storage: StorageLike, id: string): void {
      const restored = restoreSession(storage, loadHistory(storage), id, NOW + 1000)!;
      const game = reduce(restored.game, { type: 'enter', digit: answerAt(FIRST_EMPTY) as 1 });
      saveSession(storage, { ...restored, game }, at(NOW + 2000));
    }

    it('keeps what the newer version added to the record and the board through a restore and a save', () => {
      const session = running();
      const storage = savedByNewer(session, true);
      playOn(storage, session.record.id);
      const [record] = loadHistory(storage);
      expect(record).toMatchObject({
        mistakes: { values: 1, candidates: 0 },
        assists: { checkGuesses: true },
      });
      expect(loadGameBlob(storage, session.record.id)).toMatchObject({
        undo: 'ab',
        assists: { checkGuesses: true },
      });
    });

    it('keeps a new kind of help on the record even when the board does not carry it', () => {
      const session = running();
      const storage = savedByNewer(session, false);
      playOn(storage, session.record.id);
      expect(loadHistory(storage)[0].assists).toMatchObject({ checkGuesses: true });
    });
  });

  it('dates a solved orphan as finished when it is found', () => {
    const storage = memoryStorage();
    const near = running(nearlySolved([0]));
    const game = reduce(near.game, { type: 'enter', digit: answerAt(0) as 1 });
    saveGameBlob(storage, near.record.id, serialiseGame(game));
    const restored = restoreSession(storage, [], near.record.id, NOW + 5000)!;
    expect(restored.record.completedAt).toBe(NOW + 5000);
  });
});

describe('puzzleOf', () => {
  it('solves a record afresh from its givens', () => {
    const record = createRecord(PUZZLE, 'generated', NOW, null, NO_HELP);
    expect(puzzleOf(record)).toEqual(PUZZLE);
  });

  it('is null for givens that no longer make a puzzle', () => {
    // Two cells emptied from a full grid in a rectangle can leave two solutions.
    const record = {
      ...createRecord(PUZZLE, 'generated', NOW, null, NO_HELP),
      givens: '0'.repeat(81),
    };
    expect(puzzleOf(record)).toBeNull();
  });
});

describe('share targets', () => {
  it('shares the puzzle alone mid-game, and the time once solved', () => {
    const session = running(nearlySolved([0]));
    expect(shareTargetOf(session)).toEqual({
      daily: null,
      givens: session.record.givens,
      difficulty: session.record.difficulty,
      result: null,
    });
    const game = reduce(session.game, { type: 'enter', digit: answerAt(0) as 1 });
    const solved = { ...session, game, clock: { bankedMs: 83_900, runningSince: null } };
    expect(shareTargetOf(solved).result).toEqual({ seconds: 83, assists: NO_HELP });
  });

  it('names the daily a game was played as, puzzle alone or with its time', () => {
    const session = asDaily(running(nearlySolved([0])), '2026-10-12', 'easy');
    expect(shareTargetOf(session).daily).toBe('2026-10-12');
    expect(shareTargetOfRecord(session.record).daily).toBe('2026-10-12');
  });

  it('shares a history entry the same way', () => {
    const record = createRecord(PUZZLE, 'generated', NOW, null, NO_HELP);
    expect(shareTargetOfRecord(record).result).toBeNull();
    const solved: GameRecord = { ...record, status: 'solved', elapsedMs: 61_500 };
    expect(shareTargetOfRecord(solved).result).toEqual({ seconds: 61, assists: NO_HELP });
  });

  it('shares a solved replay as the puzzle alone: its time was set on a board seen before', () => {
    const session = running(nearlySolved([0]));
    const game = reduce(session.game, { type: 'enter', digit: answerAt(0) as 1 });
    const replay: Session = {
      ...session,
      game,
      record: { ...session.record, source: 'replay' },
      clock: { bankedMs: 4000, runningSince: null },
    };
    expect(shareTargetOf(replay).result).toBeNull();
    const record: GameRecord = { ...replay.record, status: 'solved', elapsedMs: 4000 };
    expect(shareTargetOfRecord(record)).toEqual({
      daily: null,
      givens: record.givens,
      difficulty: record.difficulty,
      result: null,
    });
  });
});

describe('planStartup', () => {
  it('asks for a new puzzle on a first visit', () => {
    const plan = planStartup(memoryStorage(), '', at(NOW), false);
    expect(plan).toMatchObject({
      session: null,
      offer: null,
      isBadLink: false,
      isLinkConsumed: false,
      isNewCurrent: false,
    });
  });

  it('reopens the game that was on screen, paused', () => {
    const storage = memoryStorage();
    const session = running();
    saveAsCurrent(storage, session, NOW + 5000);
    const plan = planStartup(storage, '', at(NOW + 9000), false);
    expect(plan.session?.record.id).toBe(session.record.id);
    expect(plan.session?.pause).toBe('restored');
    expect(plan.isNewCurrent).toBe(false);
  });

  it.each([
    ['a code that does not decode', '?p=!!!'],
    ['givens that are not a puzzle', linkFor('0'.repeat(80) + '1')],
  ])('reports %s and otherwise starts as usual', (_, search) => {
    const plan = planStartup(memoryStorage(), search, at(NOW), false);
    expect(plan.isBadLink).toBe(true);
    expect(plan.isLinkConsumed).toBe(true);
    expect(plan.session).toBeNull();
  });

  it('opens a new link as a game waiting behind Start, graded afresh', () => {
    const near = nearlySolved([0, 1, 2]);
    const plan = planStartup(
      memoryStorage(),
      linkFor(near.givens, { t: '323', n: 'Dan' }),
      at(NOW),
      false,
    );
    expect(plan.session?.pause).toBe('ready');
    expect(plan.session?.record).toMatchObject({
      givens: near.givens,
      source: 'shared',
      difficulty: near.difficulty,
      challenge: { name: 'Dan', seconds: 323 },
    });
    expect(plan.isNewCurrent).toBe(true);
    expect(plan.isLinkConsumed).toBe(true);
  });

  it('reopens an unfinished attempt at a linked puzzle rather than starting it again', () => {
    const storage = memoryStorage();
    const attempt = running();
    saveSession(storage, attempt, at(NOW + 4000));
    const plan = planStartup(storage, linkFor(PUZZLE.givens, { t: '300' }), at(NOW + 1000), false);
    expect(plan.session?.record.id).toBe(attempt.record.id);
    expect(plan.session?.pause).toBe('restored');
    // The link's challenge is the one this attempt is now racing.
    expect(plan.session?.record.challenge?.seconds).toBe(300);
    expect(plan.isNewCurrent).toBe(true);
  });

  it('keeps an attempt’s own challenge when the link carries none', () => {
    const storage = memoryStorage();
    const attempt = newSession(PUZZLE, {
      source: 'shared',
      challenge: DAN,
      now: at(NOW),
      autoCandidates: false,
      start: 'running',
    });
    saveAsCurrent(storage, attempt);
    const plan = planStartup(storage, linkFor(PUZZLE.givens), at(NOW + 1000), false);
    expect(plan.session?.record.challenge).toEqual(DAN);
  });

  it('opens a link to a puzzle seen in an attempt since deleted as a replay', () => {
    const storage = memoryStorage();
    const studied = running();
    saveAsCurrent(storage, pauseSession(studied, 'user', NOW + 6000), NOW + 6000);
    deleteRecord(storage, studied.record.id);
    const plan = planStartup(storage, linkFor(PUZZLE.givens), at(NOW + 9000), false);
    expect(plan.session?.record.source).toBe('replay');
    expect(plan.session?.pause).toBe('ready');
  });

  it('leaves the game on screen behind when a link’s game takes its place', () => {
    const storage = memoryStorage();
    const onScreen = running(nearlySolved([5, 6]));
    saveAsCurrent(storage, onScreen);
    const plan = planStartup(storage, linkFor(PUZZLE.givens), at(NOW + 1000), false);
    expect(plan.left?.record.id).toBe(onScreen.record.id);
    // Not when the link reopens the game on screen itself.
    const same = planStartup(storage, linkFor(onScreen.record.givens), at(NOW + 1000), false);
    expect(same.session?.record.id).toBe(onScreen.record.id);
    expect(same.left).toBeNull();
  });

  it('starts afresh when an unfinished attempt can no longer be resumed — as a replay', () => {
    const storage = memoryStorage();
    const attempt = running();
    upsertRecord(storage, recordOf(attempt, at(NOW)));
    const plan = planStartup(storage, linkFor(PUZZLE.givens), at(NOW + 1000), false);
    expect(plan.session?.record.id).not.toBe(attempt.record.id);
    expect(plan.session?.pause).toBe('ready');
    // The earlier attempt may have studied the board.
    expect(plan.session?.record.source).toBe('replay');
  });

  it('reopens a linked attempt that was never started behind its Start button again', () => {
    const storage = memoryStorage();
    const first = planStartup(
      storage,
      linkFor(PUZZLE.givens, { t: '95', n: 'Dan' }),
      at(NOW),
      false,
    );
    saveAsCurrent(storage, first.session!);
    // Reloaded, or the link opened a second time, before Start.
    for (const search of ['', linkFor(PUZZLE.givens, { t: '95', n: 'Dan' })]) {
      const plan = planStartup(storage, search, at(NOW + 1000), false);
      expect(plan.session?.record.id).toBe(first.session?.record.id);
      expect(plan.session?.pause).toBe('ready');
      expect(plan.session?.record.challenge).toMatchObject({ name: 'Dan', seconds: 95 });
    }
  });

  it('offers a fresh attempt at a puzzle already solved, keeping the game on screen', () => {
    const storage = memoryStorage();
    const onScreen = running(nearlySolved([5, 6]));
    saveAsCurrent(storage, onScreen);
    const solved: GameRecord = {
      ...recordOf(running(), at(NOW)),
      status: 'solved',
      elapsedMs: 290_000,
      completedAt: NOW,
    };
    upsertRecord(storage, solved);
    const plan = planStartup(storage, linkFor(PUZZLE.givens, { t: '323' }), at(NOW + 1000), false);
    expect(plan.offer?.previous.id).toBe(solved.id);
    expect(plan.offer?.challenge?.seconds).toBe(323);
    expect(plan.offer?.puzzle.solution).toBe(PUZZLE.solution);
    expect(plan.session?.record.id).toBe(onScreen.record.id);
    expect(plan.isNewCurrent).toBe(false);
  });

  it('compares with the newest solve that counted, not a replay set from memory', () => {
    const storage = memoryStorage();
    const base = recordOf(running(), at(NOW));
    const counted: GameRecord = {
      ...base,
      id: 'counted-0001',
      status: 'solved',
      elapsedMs: 180_000,
      completedAt: NOW,
    };
    const replay: GameRecord = {
      ...counted,
      id: 'replay-0001',
      source: 'replay',
      elapsedMs: 40_000,
      createdAt: NOW + 1000,
      updatedAt: NOW + 1000,
      completedAt: NOW + 1000,
    };
    upsertRecord(storage, counted);
    upsertRecord(storage, replay);
    const search = linkFor(PUZZLE.givens, { t: '60', n: 'Zed' });
    expect(planStartup(storage, search, at(NOW + 2000), false).offer?.previous.id).toBe(
      'counted-0001',
    );
    // With no other solve, the replay's is all there is to show.
    deleteRecord(storage, 'counted-0001');
    expect(planStartup(storage, search, at(NOW + 2000), false).offer?.previous.id).toBe(
      'replay-0001',
    );
  });

  it('passes on a link’s daily date to be checked, opening it as any shared puzzle meanwhile', () => {
    const plan = planStartup(
      memoryStorage(),
      `${linkFor(PUZZLE.givens)}&d=2026-10-12`,
      at(NOW),
      false,
    );
    expect(plan.dailyHint).toEqual({
      date: '2026-10-12',
      givens: PUZZLE.givens,
      tier: PUZZLE.difficulty,
    });
    expect(plan.session?.record.source).toBe('shared');
    expect(plan.session?.record).not.toHaveProperty('daily');
  });

  it('passes on a link’s daily date for an attempt reopened or a puzzle already solved too', () => {
    const storage = memoryStorage();
    const unfinished = running();
    saveSession(storage, unfinished, at(NOW));
    const reopened = planStartup(storage, `${linkFor(PUZZLE.givens)}&d=2026-10-12`, at(NOW), false);
    expect(reopened.session?.record.id).toBe(unfinished.record.id);
    expect(reopened.dailyHint?.date).toBe('2026-10-12');

    const solved = memoryStorage();
    upsertRecord(solved, { ...running().record, status: 'solved', completedAt: NOW });
    const offered = planStartup(solved, `${linkFor(PUZZLE.givens)}&d=2026-10-12`, at(NOW), false);
    expect(offered.offer).not.toBeNull();
    expect(offered.dailyHint?.date).toBe('2026-10-12');
  });

  it('has no daily date to check for a link without one, or a broken link', () => {
    expect(planStartup(memoryStorage(), linkFor(PUZZLE.givens), at(NOW), false).dailyHint).toBe(
      null,
    );
    expect(planStartup(memoryStorage(), '?p=nope&d=2026-10-12', at(NOW), false).dailyHint).toBe(
      null,
    );
  });

  describe('for a daily of 1–6 October, played on the launch morning before Daily #1 moved to the 7th', () => {
    /** 08:30 UTC on 7 October: dailies had launched, with Daily #1 on the 1st. */
    const LAUNCH_MORNING = Date.UTC(2026, 9, 7, 8, 30);

    /** Storage as the app left it that morning: the 3rd's Hard daily on screen, unfinished. */
    function savedThatMorning(): { storage: StorageLike; session: Session } {
      const storage = memoryStorage();
      const session = running(PUZZLE, LAUNCH_MORNING);
      saveAsCurrent(storage, session, LAUNCH_MORNING + 90_000);
      // Written as that morning's app wrote it, before dates before the 7th were refused.
      const [record] = JSON.parse(storage.getItem('sudoku.history')!) as object[];
      storage.setItem(
        'sudoku.history',
        JSON.stringify([
          {
            ...record,
            source: 'daily',
            difficulty: 'hard',
            daily: '2026-10-03',
            startedOn: '2026-10-07',
          },
        ]),
      );
      return { storage, session };
    }

    it('resumes the unfinished game as an ordinary one, its time kept, with no daily to share', () => {
      const { storage, session } = savedThatMorning();
      expect(storage.getItem('sudoku.history')).toContain('"daily":"2026-10-03"');
      const plan = planStartup(storage, '', at(NOW), false);
      expect(plan.session?.record.id).toBe(session.record.id);
      expect(plan.session?.game.status).toBe('playing');
      expect(plan.session?.pause).toBe('restored');
      expect(plan.session?.clock.bankedMs).toBe(90_000);
      expect(plan.session?.record).not.toHaveProperty('daily');
      expect(plan.session?.record).not.toHaveProperty('startedOn');
      expect(shareTargetOf(plan.session!).daily).toBeNull();
      expect(plan.dailyHint).toBeNull();
    });

    it('opens a link to such a daily as any shared puzzle, its date only a claim still to check', () => {
      const plan = planStartup(
        memoryStorage(),
        `${linkFor(PUZZLE.givens)}&d=2026-10-03`,
        at(NOW),
        false,
      );
      expect(plan.isBadLink).toBe(false);
      expect(plan.session?.record.source).toBe('shared');
      expect(plan.session?.record).not.toHaveProperty('daily');
      // Which the daily store refuses: the 3rd has no daily now (see useSudoku's tests).
      expect(plan.dailyHint?.date).toBe('2026-10-03');
    });
  });

  it('uses the start-in-auto-candidates setting for a linked puzzle', () => {
    const plan = planStartup(memoryStorage(), linkFor(PUZZLE.givens), at(NOW), true);
    expect(plan.session?.game.autoCandidates).toBe(true);
  });

  it('ignores a game left in storage that is not a game', () => {
    const storage = memoryStorage();
    saveCurrentId(storage, 'gone-0000');
    expect(planStartup(storage, '', at(NOW), false).session).toBeNull();
  });

  it('builds games the reducer accepts', () => {
    // A guard against the plan drifting from what createGame makes.
    const plan = planStartup(memoryStorage(), linkFor(PUZZLE.givens), at(NOW), false);
    expect(plan.session?.game.cells).toEqual(createGame(PUZZLE).cells);
  });
});
