import { STOPPED_CLOCK, createGame, reduce, serialiseGame, type Puzzle } from '../core';
import {
  deleteRecord,
  loadGameBlob,
  loadHistory,
  markSeen,
  saveCurrentId,
  saveGameBlob,
  upsertRecord,
  type Challenge,
  type GameRecord,
} from '../storage/history';
import { memoryStorage, type StorageLike } from '../storage/storage';
import {
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

const NOW = Date.UTC(2026, 9, 5, 12);
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
    expect(hasBoardShown(resumeSession(session, NOW + 1000))).toBe(true);
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
  it('copies the assists, so the game and its record never share an object', () => {
    const assists = { ...NO_HELP };
    const record = createRecord(PUZZLE, 'replay', NOW, null, assists);
    assists.hints = 5;
    expect(record.assists.hints).toBe(0);
  });
});

describe('pausing and resuming', () => {
  it('banks the running time on a pause, and starts a new segment on resume', () => {
    const paused = pauseSession(running(), 'hidden', NOW + 61_000);
    expect(paused.clock).toEqual({ bankedMs: 61_000, runningSince: null });
    expect(paused.pause).toBe('hidden');
    const resumed = resumeSession(paused, NOW + 100_000);
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
    expect(resumeSession(held, NOW + 1000).isSeen).toBe(true);
  });

  it('leaves a stopped session alone, keeping the reason it was stopped for', () => {
    // A dialog opened over a game the player paused must not relabel the
    // pause, or closing it would resume a game the player meant to keep paused.
    const paused = pauseSession(running(), 'user', NOW + 1000);
    expect(pauseSession(paused, 'dialog', NOW + 2000)).toBe(paused);
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
      givens: session.record.givens,
      difficulty: session.record.difficulty,
      result: null,
    });
    const game = reduce(session.game, { type: 'enter', digit: answerAt(0) as 1 });
    const solved = { ...session, game, clock: { bankedMs: 83_900, runningSince: null } };
    expect(shareTargetOf(solved).result).toEqual({ seconds: 83, assists: NO_HELP });
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
