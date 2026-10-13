import { describe, expect, it } from 'vitest';
import { MAX_NEWER_FIELDS, MAX_NEWER_FIELD_JSON, type GridString } from '../core';
import {
  MAX_SAVED_PUZZLES,
  deletePuzzle,
  indexPuzzles,
  mergePuzzleLists,
  normalisePuzzle,
  normalisePuzzles,
  retitlePuzzle,
  savePuzzle,
  titledRecord,
  type SavedPuzzle,
} from './puzzles';
import type { GameRecord } from './history';

/** A grid with `digits` typed in from the first cell, the rest blank. */
const grid = (digits: string): GridString => digits.padEnd(81, '0');

const TIMES = grid('53007');
const HALF = grid('6');
const GUARDIAN = grid('008');

/** The store as the module comment draws it: a named puzzle, and an unnamed one saved earlier. */
const PUZZLES: readonly SavedPuzzle[] = [
  {
    id: 'mbx3k2f0-q7za',
    cells: TIMES,
    title: 'The Times #5,123',
    createdAt: 1_791_763_200_000,
    updatedAt: 1_791_849_600_000,
  },
  { id: 'mbw9a1c4-0d2e', cells: HALF, createdAt: 1_791_676_800_000, updatedAt: 1_791_676_800_000 },
];

/** Through storage and back, as `loadPuzzles` reads what `updatePuzzles` wrote. */
const roundTrip = (puzzles: readonly SavedPuzzle[]) =>
  normalisePuzzles(JSON.parse(JSON.stringify(puzzles)));

/** `count` unnamed puzzles, saved at 1000, 1001…, the latest first, as the list holds them. */
function shelf(count: number): SavedPuzzle[] {
  return Array.from({ length: count }, (_, i) => {
    const at = 1000 + count - 1 - i;
    return { id: `p${at}`, cells: grid(String(at)), createdAt: at, updatedAt: at };
  });
}

describe('normalisePuzzles', () => {
  it('reads the store back exactly as it was written', () => {
    expect(roundTrip(PUZZLES)).toStrictEqual(PUZZLES);
  });

  it.each([
    ['nothing', null],
    ['an object keyed by id', { a: PUZZLES[0] }],
    ['a string', '[]'],
  ])('reads %s as no puzzles at all', (_, value) => {
    expect(normalisePuzzles(value)).toEqual([]);
  });

  it.each([
    ['not an object', TIMES],
    ['without an id', { cells: TIMES, createdAt: 1 }],
    ['with a garbled id', { id: 'not an id', cells: TIMES, createdAt: 1 }],
    ['without a grid', { id: 'a', createdAt: 1 }],
    ['with a grid too short', { id: 'a', cells: '53007', createdAt: 1 }],
    ['with a grid of letters', { id: 'a', cells: 'x'.repeat(81), createdAt: 1 }],
    ['with no time it was first saved', { id: 'a', cells: TIMES }],
    ['first saved before 1970', { id: 'a', cells: TIMES, createdAt: -1 }],
    ['first saved at NaN', { id: 'a', cells: TIMES, createdAt: Number.NaN }],
    ['first saved at a time that is not a number', { id: 'a', cells: TIMES, createdAt: '1' }],
  ])('drops an entry %s, costing no other', (_, junk) => {
    expect(normalisePuzzles([junk, PUZZLES[1]])).toStrictEqual([PUZZLES[1]]);
  });

  it('keeps any grid, a puzzle or not: a clash, too few numbers, every cell filled', () => {
    const clash = grid('55');
    const full = '1'.repeat(81);
    expect(
      normalisePuzzles([
        { id: 'a', cells: clash, createdAt: 2 },
        { id: 'b', cells: full, createdAt: 1 },
      ]).map((entry) => entry.cells),
    ).toEqual([clash, full]);
  });

  it('tidies a name, and leaves off one with nothing left of it', () => {
    const [named, unnamed, odd] = normalisePuzzles([
      { id: 'a', cells: TIMES, title: '  The Times\n#5,123 ', createdAt: 3 },
      { id: 'b', cells: HALF, title: ' ​ ', createdAt: 2 },
      { id: 'c', cells: GUARDIAN, title: 42, createdAt: 1 },
    ]);
    expect(named.title).toBe('The Times #5,123');
    expect(unnamed).not.toHaveProperty('title');
    expect(odd).not.toHaveProperty('title');
  });

  it('reads a time last changed that is missing, broken or too early as the first saved', () => {
    expect(
      normalisePuzzles([
        { id: 'a', cells: TIMES, createdAt: 30 },
        { id: 'b', cells: HALF, createdAt: 20, updatedAt: 'later' },
        { id: 'c', cells: GUARDIAN, createdAt: 10, updatedAt: 5 },
      ]).map((entry) => entry.updatedAt),
    ).toEqual([30, 20, 10]);
  });

  it('lists the latest first saved first, whatever the order stored', () => {
    const shuffled = [PUZZLES[1], PUZZLES[0]];
    expect(normalisePuzzles(shuffled)).toStrictEqual(PUZZLES);
  });

  it('keeps one entry of an id, or of a grid: the one changed later', () => {
    const older = { id: 'a', cells: TIMES, title: 'Older', createdAt: 1, updatedAt: 2 };
    const newer = { id: 'a', cells: GUARDIAN, createdAt: 1, updatedAt: 9 };
    const sameGrid = { id: 'b', cells: GUARDIAN, createdAt: 5, updatedAt: 5 };
    expect(normalisePuzzles([older, sameGrid, newer])).toStrictEqual([newer]);
    // A duplicate dropped claims nothing: an entry sharing only its id is still kept.
    const elsewhere = { id: 'b', cells: HALF, createdAt: 3, updatedAt: 3 };
    expect(normalisePuzzles([older, newer, sameGrid, elsewhere])).toStrictEqual([elsewhere, newer]);
  });

  it('never caps a longer list a newer version kept', () => {
    expect(roundTrip(shelf(MAX_SAVED_PUZZLES + 5))).toHaveLength(MAX_SAVED_PUZZLES + 5);
  });

  it('keeps the small fields a newer version added, and no more than a newer field may take', () => {
    const extra = Object.fromEntries(
      Array.from({ length: MAX_NEWER_FIELDS + 1 }, (_, i) => [`extra${'x'.repeat(i)}`, i]),
    );
    const read = normalisePuzzle({
      ...PUZZLES[0],
      ...extra,
      huge: 'x'.repeat(MAX_NEWER_FIELD_JSON),
    })!;
    expect(read).toMatchObject(PUZZLES[0]);
    expect(Object.keys(read).filter((key) => key.startsWith('extra'))).toHaveLength(
      MAX_NEWER_FIELDS,
    );
    expect(read).not.toHaveProperty('huge');
  });
});

describe('indexPuzzles', () => {
  it('finds each entry by its numbers', () => {
    const index = indexPuzzles(PUZZLES);
    expect(index.get(TIMES)).toBe(PUZZLES[0]);
    expect(index.get(HALF)).toBe(PUZZLES[1]);
    expect(index.get(GUARDIAN)).toBeUndefined();
  });
});

describe('titledRecord', () => {
  /** A game of `givens`, its link's name `title` if given. */
  const game = (givens: GridString, title?: string): GameRecord => ({
    id: 'mbx3k2f0-g4me',
    givens,
    difficulty: 'hard',
    source: 'shared',
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    status: 'playing',
    elapsedMs: 0,
    assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
    challenge: null,
    ...(title === undefined ? {} : { title }),
  });
  const index = indexPuzzles(PUZZLES);

  it('draws a game under the name its puzzle has in Your puzzles, over its link’s', () => {
    expect(titledRecord(index, game(TIMES))).toEqual(game(TIMES, 'The Times #5,123'));
    expect(titledRecord(index, game(TIMES, 'Puzzle 7'))).toEqual(game(TIMES, 'The Times #5,123'));
  });

  it('keeps the link’s name for a puzzle unnamed there, or not there at all', () => {
    const unnamed = game(HALF, 'Puzzle 7');
    expect(titledRecord(index, unnamed)).toBe(unnamed);
    const elsewhere = game(GUARDIAN, 'Puzzle 7');
    expect(titledRecord(index, elsewhere)).toBe(elsewhere);
  });

  it('is the very record when the name it draws is its own, or there is none', () => {
    const same = game(TIMES, 'The Times #5,123');
    expect(titledRecord(index, same)).toBe(same);
    const none = game(GUARDIAN);
    expect(titledRecord(index, none)).toBe(none);
    expect(titledRecord(index, none)).not.toHaveProperty('title');
  });
});

describe('savePuzzle', () => {
  const NOW = 1_791_900_000_000;

  it('adds a grid never saved, unnamed, at the head of the list, under the id given', () => {
    const { list, entry } = savePuzzle(PUZZLES, { id: 'fresh-0001', cells: GUARDIAN }, NOW);
    expect(entry).toStrictEqual({
      id: 'fresh-0001',
      cells: GUARDIAN,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(list).toStrictEqual([entry, ...PUZZLES]);
    expect(roundTrip(list)).toStrictEqual(list);
  });

  it('changes the numbers of the entry being edited, keeping its id, name, place and first save', () => {
    const { list, entry } = savePuzzle(PUZZLES, { id: PUZZLES[1].id, cells: GUARDIAN }, NOW);
    expect(entry).toStrictEqual({ ...PUZZLES[1], cells: GUARDIAN, updatedAt: NOW });
    expect(list).toStrictEqual([PUZZLES[0], entry]);
    const named = savePuzzle(PUZZLES, { id: PUZZLES[0].id, cells: GUARDIAN }, NOW).entry;
    expect(named.title).toBe('The Times #5,123');
  });

  it('keeps a grid saved again as it was just as it was, giving back the same list', () => {
    for (const { id, cells } of PUZZLES) {
      const saved = savePuzzle(PUZZLES, { id, cells }, NOW);
      expect(saved.list).toBe(PUZZLES);
      expect(saved.entry).toBe(PUZZLES.find((entry) => entry.id === id));
    }
  });

  it('takes a grid typed in afresh that is kept already for the entry it is', () => {
    const saved = savePuzzle(PUZZLES, { id: 'fresh-0001', cells: TIMES }, NOW);
    expect(saved.list).toBe(PUZZLES);
    expect(saved.entry).toBe(PUZZLES[0]);
  });

  it('re-creates an entry deleted while it was being edited, by its numbers, under its id', () => {
    const left = deletePuzzle(PUZZLES, PUZZLES[1].id);
    const { list, entry } = savePuzzle(left, { id: PUZZLES[1].id, cells: GUARDIAN }, NOW);
    expect(entry).toStrictEqual({
      id: PUZZLES[1].id,
      cells: GUARDIAN,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(list).toStrictEqual([entry, PUZZLES[0]]);
  });

  it('takes the place of an entry edited into its numbers, and its name if it has none', () => {
    // The unnamed one is edited into the named one's grid: one entry is left, still named.
    const { list, entry } = savePuzzle(PUZZLES, { id: PUZZLES[1].id, cells: TIMES }, NOW);
    expect(entry).toStrictEqual({
      ...PUZZLES[1],
      cells: TIMES,
      title: 'The Times #5,123',
      updatedAt: NOW,
    });
    expect(list).toStrictEqual([entry]);
    // A name of its own stands.
    const renamed = retitlePuzzle(PUZZLES, PUZZLES[1].id, 'Mine', 1);
    expect(savePuzzle(renamed, { id: PUZZLES[1].id, cells: TIMES }, NOW).entry.title).toBe('Mine');
  });

  it('keeps the fields a newer version added to the entry it changes', () => {
    const newer = [{ ...PUZZLES[0], level: 'hard' }];
    expect(savePuzzle(newer, { id: PUZZLES[0].id, cells: GUARDIAN }, NOW).entry).toMatchObject({
      level: 'hard',
      cells: GUARDIAN,
    });
  });

  describe('MAX_SAVED_PUZZLES', () => {
    it('adds one more under the cap, forgetting nothing', () => {
      const full = shelf(MAX_SAVED_PUZZLES - 1);
      expect(savePuzzle(full, { id: 'new', cells: GUARDIAN }, NOW).list).toHaveLength(
        MAX_SAVED_PUZZLES,
      );
    });

    it('forgets the entry changed longest ago to save a new one at the cap', () => {
      const full = shelf(MAX_SAVED_PUZZLES);
      // The one first saved is not the one changed longest ago once it is edited.
      const edited = savePuzzle(full, { id: 'p1000', cells: GUARDIAN }, NOW).list;
      const { list, entry } = savePuzzle(edited, { id: 'new', cells: TIMES }, NOW + 1);
      expect(list).toHaveLength(MAX_SAVED_PUZZLES);
      expect(list[0]).toBe(entry);
      const ids = new Set(list.map((it) => it.id));
      expect(ids.has('p1000')).toBe(true);
      expect(ids.has('p1001')).toBe(false);
    });

    it('forgets the one first saved earlier of two changed at the same time', () => {
      const tied = shelf(MAX_SAVED_PUZZLES).map((it) => ({ ...it, updatedAt: 1 }));
      const { list } = savePuzzle(tied, { id: 'new', cells: TIMES }, NOW);
      expect(list.some((it) => it.id === 'p1000')).toBe(false);
      expect(list.some((it) => it.id === 'p1001')).toBe(true);
    });

    it('forgets only one of a newer version’s longer list, to save one more', () => {
      const long = shelf(MAX_SAVED_PUZZLES + 5);
      expect(savePuzzle(long, { id: 'new', cells: TIMES }, NOW).list).toHaveLength(
        MAX_SAVED_PUZZLES + 5,
      );
    });

    it('forgets nothing to save an entry already kept', () => {
      const full = shelf(MAX_SAVED_PUZZLES);
      expect(savePuzzle(full, { id: 'p1000', cells: GUARDIAN }, NOW).list).toHaveLength(
        MAX_SAVED_PUZZLES,
      );
    });
  });
});

describe('retitlePuzzle', () => {
  it('names an entry, tidied, moving its time last changed but not its place', () => {
    const list = retitlePuzzle(PUZZLES, PUZZLES[1].id, '  Guardian\t4,201 ', 5_000);
    expect(list).toStrictEqual([
      PUZZLES[0],
      { ...PUZZLES[1], title: 'Guardian 4,201', updatedAt: 5_000 },
    ]);
  });

  it('takes a name off with one that tidies to nothing', () => {
    const list = retitlePuzzle(PUZZLES, PUZZLES[0].id, ' ​ ', 5_000);
    expect(list[0]).not.toHaveProperty('title');
    expect(list[0].updatedAt).toBe(5_000);
  });

  it.each([
    ['the name it has already', PUZZLES[0].id, 'The Times #5,123 '],
    ['no name for an entry with none', PUZZLES[1].id, ''],
    ['an entry not in the list', 'gone-0001', 'Gone'],
  ])('gives back the same list for %s', (_, id, title) => {
    expect(retitlePuzzle(PUZZLES, id, title, 5_000)).toBe(PUZZLES);
  });

  it('keeps the fields a newer version added', () => {
    const newer = [{ ...PUZZLES[1], level: 'hard' }];
    expect(retitlePuzzle(newer, PUZZLES[1].id, 'Named', 5)[0]).toMatchObject({
      level: 'hard',
      title: 'Named',
    });
  });
});

describe('deletePuzzle', () => {
  it('takes an entry out, leaving the rest as they were', () => {
    expect(deletePuzzle(PUZZLES, PUZZLES[0].id)).toStrictEqual([PUZZLES[1]]);
  });

  it('gives back the same list for an entry not in it', () => {
    expect(deletePuzzle(PUZZLES, 'gone-0001')).toBe(PUZZLES);
  });
});

describe('mergePuzzleLists', () => {
  /** Another browser's own puzzle, unnamed, kept at `at`. */
  const theirs = (id: string, cells: GridString, at: number): SavedPuzzle => ({
    id,
    cells,
    createdAt: at,
    updatedAt: at,
  });

  it("adds the file's puzzles new here, the list still the latest first saved first", () => {
    const guardian = theirs('mbz0c3d2-g001', GUARDIAN, 1_791_700_000_000);
    const list = mergePuzzleLists(PUZZLES, [guardian]);
    expect(list).toStrictEqual([PUZZLES[0], guardian, PUZZLES[1]]);
    expect(roundTrip(list)).toStrictEqual(list);
    expect(mergePuzzleLists([], PUZZLES)).toStrictEqual(PUZZLES);
  });

  it('gives back the same list for a file that changes nothing', () => {
    // This browser's own export, an empty one, and the same file twice.
    expect(mergePuzzleLists(PUZZLES, roundTrip(PUZZLES))).toBe(PUZZLES);
    expect(mergePuzzleLists(PUZZLES, [])).toBe(PUZZLES);
    const file = [theirs('mbz0c3d2-g001', GUARDIAN, 1), { ...PUZZLES[1], title: 'Half' }];
    const once = mergePuzzleLists(PUZZLES, file);
    expect(mergePuzzleLists(once, file)).toBe(once);
  });

  it('takes the copy of a puzzle changed later, the one here on a tie', () => {
    const edited = { ...PUZZLES[1], cells: GUARDIAN, updatedAt: PUZZLES[1].updatedAt + 1 };
    expect(mergePuzzleLists(PUZZLES, [edited])).toStrictEqual([PUZZLES[0], edited]);
    // Changed here since, or at the same time: the one here stands.
    const older = { ...PUZZLES[0], cells: GUARDIAN, updatedAt: PUZZLES[0].updatedAt - 1 };
    const tied = { ...PUZZLES[1], cells: GUARDIAN };
    expect(mergePuzzleLists(PUZZLES, [older])).toBe(PUZZLES);
    expect(mergePuzzleLists(PUZZLES, [tied])).toBe(PUZZLES);
  });

  it('names the copy kept with the other’s name if it has none of its own', () => {
    // Named there, and edited here since; and named here, edited there since.
    const edited = { ...PUZZLES[1], cells: grid('61'), updatedAt: PUZZLES[1].updatedAt + 2 };
    const named = { ...PUZZLES[1], title: 'Half', updatedAt: PUZZLES[1].updatedAt + 1 };
    const unnamed = { ...PUZZLES[0], cells: GUARDIAN, updatedAt: PUZZLES[0].updatedAt + 1 };
    const { title: _title, ...untitled } = unnamed;
    expect(mergePuzzleLists([PUZZLES[0], edited], [named, untitled])).toStrictEqual([
      { ...untitled, title: 'The Times #5,123' },
      { ...edited, title: 'Half' },
    ]);
    // A name of its own stands.
    const renamed = { ...PUZZLES[0], title: 'Renamed', updatedAt: PUZZLES[0].updatedAt + 1 };
    expect(mergePuzzleLists(PUZZLES, [renamed])[0].title).toBe('Renamed');
  });

  it('keeps one entry of a grid both lists have under two ids: the one changed later, named', () => {
    // Typed in on both sides: the one here was changed later, the file's has a name.
    const twin = { ...theirs('mbz0c3d2-g001', HALF, 1), title: 'Half' };
    expect(mergePuzzleLists(PUZZLES, [twin])).toStrictEqual([
      PUZZLES[0],
      { ...PUZZLES[1], title: 'Half' },
    ]);
    // The file's changed later: it stands in place of the one here, taking its name.
    const later = theirs('mbz0c3d2-g002', TIMES, PUZZLES[0].updatedAt + 1);
    expect(mergePuzzleLists(PUZZLES, [later])).toStrictEqual([
      { ...later, title: 'The Times #5,123' },
      PUZZLES[1],
    ]);
    // At the same time: the one here stands.
    const tied = theirs('mbz0c3d2-g003', HALF, PUZZLES[1].updatedAt);
    expect(mergePuzzleLists(PUZZLES, [tied])).toBe(PUZZLES);
  });

  it('keeps one entry of a grid a puzzle was edited into there, as a save would', () => {
    // The unnamed one edited there into the named one's numbers, later.
    const edited = { ...PUZZLES[1], cells: TIMES, updatedAt: PUZZLES[0].updatedAt + 1 };
    expect(mergePuzzleLists(PUZZLES, [edited])).toStrictEqual([
      { ...edited, title: 'The Times #5,123' },
    ]);
  });

  it('keeps the fields a newer version added to the copy kept', () => {
    const newer = { ...PUZZLES[1], level: 'hard', updatedAt: PUZZLES[1].updatedAt + 1 };
    expect(mergePuzzleLists(PUZZLES, [newer])[1]).toMatchObject({ level: 'hard' });
    const kept = [{ ...PUZZLES[1], level: 'hard' }];
    expect(mergePuzzleLists(kept, [{ ...PUZZLES[1], title: 'Half' }])[0]).toMatchObject({
      level: 'hard',
      title: 'Half',
    });
  });

  describe('MAX_SAVED_PUZZLES', () => {
    const file = [
      theirs('mbz0c3d2-g001', TIMES, 5),
      theirs('mbz0c3d2-g002', HALF, 9),
      theirs('mbz0c3d2-g003', GUARDIAN, 9),
    ];

    it('adds into the room left, the most recently changed first, a tie in the file’s order', () => {
      const list = mergePuzzleLists(shelf(MAX_SAVED_PUZZLES - 1), file);
      expect(list).toHaveLength(MAX_SAVED_PUZZLES);
      expect(list.filter((entry) => entry.id.startsWith('mbz0c3d2'))).toStrictEqual([file[1]]);
    });

    it('forgets none here to make room, adding none to a list at the cap or over it', () => {
      for (const count of [MAX_SAVED_PUZZLES, MAX_SAVED_PUZZLES + 5]) {
        const full = shelf(count);
        expect(mergePuzzleLists(full, file)).toBe(full);
      }
    });

    it('still takes a later copy of a puzzle here at the cap', () => {
      const full = shelf(MAX_SAVED_PUZZLES);
      const edited = { ...full[0], cells: GUARDIAN, updatedAt: full[0].updatedAt + 1 };
      expect(mergePuzzleLists(full, [edited])).toStrictEqual([edited, ...full.slice(1)]);
    });
  });
});
