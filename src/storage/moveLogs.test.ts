import { describe, expect, it, vi } from 'vitest';
import { MOVES_VERSION, appendMove, createMoveLog, encodeMoveLog, type MoveLog } from '../core';
import {
  deleteMoveLog,
  dropMoveLogs,
  isNewerMoveLog,
  loadEncodedMoveLog,
  loadMoveLog,
  moveLogSize,
  readMoveLogIds,
  saveMoveLog,
  storeMoveLog,
  storeMoveLogs,
} from './moveLogs';
import { memoryStorage, type StorageLike } from './storage';
import { quotaStorage } from '../test/misc-storage';
import { LOG_IN_A_LATER_FORMAT, logFromAnotherBuild } from '../test/movePlayers';

const LIST = 'sudoku.moveLogs';

/** A log of `count` erases, a tenth of a second apart. */
function logOf(count = 2): MoveLog {
  let log = createMoveLog();
  for (let i = 0; i < count; i++) log = appendMove(log, { op: 'erase', cell: i }, i * 100);
  return log;
}

/** A storage whose list of logs refuses every write, as a full one would. */
function listRefused(): StorageLike {
  const inner = memoryStorage();
  return {
    getItem: (key) => inner.getItem(key),
    setItem: (key, value) => {
      if (key === LIST) throw new DOMException('Full', 'QuotaExceededError');
      inner.setItem(key, value);
    },
    removeItem: (key) => inner.removeItem(key),
  };
}

describe('readMoveLogIds', () => {
  it('reads the list, skipping junk and repeats', () => {
    const storage = memoryStorage();
    storage.setItem(LIST, JSON.stringify(['a', 7, 'a', 'not an id!', null, 'b']));
    expect(readMoveLogIds(storage)).toEqual(['a', 'b']);
  });

  it.each([
    ['missing', null],
    ['not JSON', '[oops'],
    ['not a list', '{"a":1}'],
  ])('is empty when the list is %s', (_label, raw) => {
    const storage = memoryStorage();
    if (raw !== null) storage.setItem(LIST, raw);
    expect(readMoveLogIds(storage)).toEqual([]);
  });
});

describe('loading', () => {
  it('decodes a stored log, and gives back exactly what was stored', () => {
    const storage = memoryStorage();
    storeMoveLog(storage, 'a', encodeMoveLog(logOf()));
    expect(loadMoveLog(storage, 'a')).toEqual(logOf());
    expect(loadEncodedMoveLog(storage, 'a')).toBe(encodeMoveLog(logOf()));
    expect(moveLogSize(storage, 'a')).toBe('sudoku.moves.a'.length + encodeMoveLog(logOf()).length);
  });

  it('reads a log that does not decode as none at all', () => {
    const storage = memoryStorage();
    storeMoveLog(storage, 'a', encodeMoveLog(logOf()).slice(0, -1));
    expect(loadMoveLog(storage, 'a')).toBeNull();
  });

  it('finds nothing for a game with no log', () => {
    const storage = memoryStorage();
    expect(loadMoveLog(storage, 'a')).toBeNull();
    expect(moveLogSize(storage, 'a')).toBe(0);
  });
});

describe('storeMoveLog', () => {
  it('lists a game once, however often its log is stored', () => {
    const storage = memoryStorage();
    storeMoveLog(storage, 'a', 'one');
    storeMoveLog(storage, 'b', 'two');
    storeMoveLog(storage, 'a', 'three');
    expect(readMoveLogIds(storage)).toEqual(['a', 'b']);
    expect(loadEncodedMoveLog(storage, 'a')).toBe('three');
  });

  it('takes the log back out if it cannot be listed', () => {
    // Stored but unlisted, it would be invisible to every sweep.
    const storage = listRefused();
    expect(storeMoveLog(storage, 'a', 'log')).toBe(false);
    expect(loadEncodedMoveLog(storage, 'a')).toBeNull();
  });

  it('reports a log the storage refuses', () => {
    expect(storeMoveLog(quotaStorage(5), 'a', 'far too long')).toBe(false);
  });
});

describe('storeMoveLogs', () => {
  it('stores and lists many logs at once', () => {
    const storage = memoryStorage();
    storeMoveLog(storage, 'here', 'mine');
    expect(
      storeMoveLogs(storage, [
        ['a', 'one'],
        ['here', 'theirs'],
      ]),
    ).toEqual(['a', 'here']);
    expect(readMoveLogIds(storage)).toEqual(['here', 'a']);
    expect(loadEncodedMoveLog(storage, 'here')).toBe('theirs');
  });

  it('stores what fits and takes the rest off the list', () => {
    const storage = quotaStorage();
    storage.capacity = 100;
    const stored = storeMoveLogs(storage, [
      ['a', 'x'.repeat(30)],
      ['b', 'x'.repeat(60)],
      ['c', 'x'.repeat(10)],
    ]);
    expect(stored).toEqual(['a', 'c']);
    expect(readMoveLogIds(storage)).toEqual(['a', 'c']);
    expect(loadEncodedMoveLog(storage, 'b')).toBeNull();
  });

  it('stores nothing if the list cannot be written', () => {
    const storage = listRefused();
    expect(storeMoveLogs(storage, [['a', 'log']])).toEqual([]);
    expect(loadEncodedMoveLog(storage, 'a')).toBeNull();
  });

  it('writes nothing for nothing', () => {
    const storage = quotaStorage();
    expect(storeMoveLogs(storage, [])).toEqual([]);
    expect(storage.writes()).toBe(0);
  });
});

describe('saveMoveLog', () => {
  it('encodes the log, and skips writing the very same log again', () => {
    const storage = quotaStorage();
    const log = logOf();
    expect(saveMoveLog(storage, 'a', log)).toBe(true);
    expect(loadMoveLog(storage, 'a')).toEqual(log);
    const writes = storage.writes();
    expect(saveMoveLog(storage, 'a', log)).toBe(true);
    expect(storage.writes()).toBe(writes);
    // An equal log that is another object is written: only identity is cheap to check.
    expect(saveMoveLog(storage, 'a', logOf())).toBe(true);
    expect(storage.writes()).toBe(writes + 1);
  });

  it('keeps track per storage', () => {
    const log = logOf();
    const first = memoryStorage();
    const second = memoryStorage();
    saveMoveLog(first, 'a', log);
    saveMoveLog(second, 'a', log);
    expect(loadMoveLog(second, 'a')).toEqual(log);
  });

  it('writes a log again after it was deleted, or dropped', () => {
    const storage = memoryStorage();
    const log = logOf();
    saveMoveLog(storage, 'a', log);
    deleteMoveLog(storage, 'a');
    saveMoveLog(storage, 'a', log);
    expect(loadMoveLog(storage, 'a')).toEqual(log);
    dropMoveLogs(storage, () => true);
    saveMoveLog(storage, 'a', log);
    expect(loadMoveLog(storage, 'a')).toEqual(log);
  });

  it('writes the same log again when another tab has written over it, or deleted it', () => {
    // Otherwise the board saved beside it would no longer go with it.
    const storage = memoryStorage();
    const log = logOf();
    saveMoveLog(storage, 'a', log);
    storage.setItem('sudoku.moves.a', encodeMoveLog(logOf(3)));
    saveMoveLog(storage, 'a', log);
    expect(loadMoveLog(storage, 'a')).toEqual(log);
    storage.removeItem('sudoku.moves.a');
    saveMoveLog(storage, 'a', log);
    expect(loadMoveLog(storage, 'a')).toEqual(log);
  });

  it('deletes a log again when another tab has written one since', () => {
    const storage = memoryStorage();
    saveMoveLog(storage, 'a', null);
    storeMoveLog(storage, 'a', encodeMoveLog(logOf()));
    saveMoveLog(storage, 'a', null);
    expect(loadEncodedMoveLog(storage, 'a')).toBeNull();
  });

  it('writes a log again after another was stored over it', () => {
    const storage = memoryStorage();
    const log = logOf();
    saveMoveLog(storage, 'a', log);
    storeMoveLogs(storage, [['a', 'theirs']]);
    saveMoveLog(storage, 'a', log);
    expect(loadMoveLog(storage, 'a')).toEqual(log);
  });

  it('with null deletes the game’s log', () => {
    const storage = memoryStorage();
    saveMoveLog(storage, 'a', logOf());
    expect(saveMoveLog(storage, 'a', null)).toBe(true);
    expect(loadEncodedMoveLog(storage, 'a')).toBeNull();
    expect(readMoveLogIds(storage)).toEqual([]);
  });

  it.each([
    ['a later format', LOG_IN_A_LATER_FORMAT],
    ['a later rules version', logFromAnotherBuild(MOVES_VERSION + 1, 2754)],
    ['a move code added since', logFromAnotherBuild(MOVES_VERSION, 2761)],
  ])('with null leaves a log of %s alone, for the build that wrote it', (_label, newer) => {
    const storage = memoryStorage();
    storeMoveLog(storage, 'a', newer);
    const remove = vi.spyOn(storage, 'removeItem');
    expect(saveMoveLog(storage, 'a', null)).toBe(true);
    expect(saveMoveLog(storage, 'a', null)).toBe(true);
    expect(loadEncodedMoveLog(storage, 'a')).toBe(newer);
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ['an older rules version', logFromAnotherBuild(MOVES_VERSION - 1, 2754)],
    ['this build’s versions, broken', `${encodeMoveLog(logOf()).slice(0, -1)}A`],
    ['no log at all', 'not a log'],
  ])('with null deletes a log of %s, which this build can judge', (_label, stored) => {
    const storage = memoryStorage();
    storeMoveLog(storage, 'a', stored);
    expect(saveMoveLog(storage, 'a', null)).toBe(true);
    expect(loadEncodedMoveLog(storage, 'a')).toBeNull();
  });

  it('takes the log stored before with it when a write is refused', () => {
    // It stops short of the game now saved beside it.
    const storage = quotaStorage();
    saveMoveLog(storage, 'a', logOf(2));
    storage.capacity = storage.used() + 2;
    expect(saveMoveLog(storage, 'a', logOf(5))).toBe(false);
    expect(loadEncodedMoveLog(storage, 'a')).toBeNull();
    expect(readMoveLogIds(storage)).toEqual([]);
  });

  it('tries again next time when a write is refused', () => {
    const storage = quotaStorage(10);
    const log = logOf();
    expect(saveMoveLog(storage, 'a', log)).toBe(false);
    storage.capacity = Number.POSITIVE_INFINITY;
    expect(saveMoveLog(storage, 'a', log)).toBe(true);
    expect(loadMoveLog(storage, 'a')).toEqual(log);
  });

  it('makes room as it is told to', () => {
    const storage = quotaStorage();
    storage.setItem('junk', 'x'.repeat(100));
    storage.capacity = storage.used() + 10;
    const makeRoom = (s: StorageLike): void => s.removeItem('junk');
    expect(saveMoveLog(storage, 'a', logOf(), makeRoom)).toBe(true);
    expect(storage.keys()).toEqual(['sudoku.moveLogs', 'sudoku.moves.a']);
  });
});

describe('isNewerMoveLog', () => {
  it('tells a newer build’s log from one this build can judge', () => {
    expect(isNewerMoveLog(LOG_IN_A_LATER_FORMAT)).toBe(true);
    expect(isNewerMoveLog(logFromAnotherBuild(MOVES_VERSION + 1, 2754))).toBe(true);
    expect(isNewerMoveLog(logFromAnotherBuild(MOVES_VERSION, 2761))).toBe(true);
    expect(isNewerMoveLog(logFromAnotherBuild(MOVES_VERSION - 1, 2754))).toBe(false);
    // This build's own: one it reads, and one that is broken.
    expect(isNewerMoveLog(logFromAnotherBuild(MOVES_VERSION, 2754))).toBe(false);
    expect(isNewerMoveLog(encodeMoveLog(logOf()).slice(0, -1))).toBe(false);
    expect(isNewerMoveLog('')).toBe(false);
  });
});

describe('dropping and deleting', () => {
  it('drops the logs picked, and the list once it is empty', () => {
    const storage = memoryStorage();
    storeMoveLogs(storage, [
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(dropMoveLogs(storage, (id) => id === 'a')).toBe(true);
    expect(readMoveLogIds(storage)).toEqual(['b']);
    expect(loadEncodedMoveLog(storage, 'a')).toBeNull();
    expect(dropMoveLogs(storage, () => false)).toBe(false);
    expect(dropMoveLogs(storage, () => true)).toBe(true);
    expect(storage.getItem(LIST)).toBeNull();
  });

  it('deletes a log that somehow escaped the list', () => {
    const storage = memoryStorage();
    storage.setItem('sudoku.moves.a', 'stray');
    deleteMoveLog(storage, 'a');
    expect(storage.getItem('sudoku.moves.a')).toBeNull();
  });
});
