import { fieldsOf, isGridString, newerFields, type GridString } from '../core';
import { GAME_ID_PATTERN, isObject, normaliseTitle } from './storage';

/*
 * Your puzzles: the grids the player has typed in (Enter a puzzle), kept to
 * play, edit and name again — finished or not, so a puzzle half copied out
 * of the paper can wait for the rest.
 *
 *   sudoku.puzzles  [ { "id": "mbx3k2f0-q7za", "cells": "5300700006001950…",
 *                       "title": "The Times #5,123",
 *                       "createdAt": 1791763200000, "updatedAt": 1791849600000 },
 *                     { "id": "mbw9a1c4-0d2e", "cells": "0000000000000000…",
 *                       "createdAt": 1791676800000, "updatedAt": 1791676800000 } ]
 *
 * A grid is as it was typed, '0' for a blank: one with too few numbers, a
 * clash or more than one solution is kept as readily as a puzzle ready to
 * play, and what it makes is worked out again wherever it is drawn (see
 * `assessmentOf`), so no stored label can go stale under a later grader. No
 * two entries have the same numbers: saving a grid already kept updates that
 * entry (see `savePuzzle`), so a puzzle is one row however it was typed in.
 * Its name is the one the player gave it, if any.
 *
 * Pure: the I/O lives in `history.ts` (`loadPuzzles`, `updatePuzzles`),
 * beside the friends'. Every operation here returns the list it was given
 * when nothing changes, which is how `updatePuzzles` knows to write
 * nothing; and every entry it changes is spread rather than rebuilt, so the
 * small fields a newer version added (see `newerFields`) survive a save, a
 * rename or a delete of another.
 */

/**
 * The most puzzles kept, as many as games (see `MAX_RECORDS`). Past it,
 * saving a new one forgets the one changed longest ago (see `withRoom`).
 */
export const MAX_SAVED_PUZZLES = 1000;

/** A grid typed in and kept (see the module comment). */
export interface SavedPuzzle {
  /** As a game's (see `createGameId`), and as long-lived: an edit keeps it. */
  id: string;
  /** The numbers typed in, in reading order, '0' for a blank. Never all blanks, as saved here. */
  cells: GridString;
  /** The name the player gave it, tidied (see `normaliseTitle`) and never ''; left off while it has none. */
  title?: string;
  /** When it was first saved (epoch ms): the list is in this order, newest first. */
  createdAt: number;
  /** When its numbers last changed, or its name: never before `createdAt`. */
  updatedAt: number;
}

/** The fields of an entry this version knows; anything else is kept if small (see `newerFields`). */
const PUZZLE_FIELDS = fieldsOf<SavedPuzzle>({
  id: true,
  cells: true,
  title: true,
  createdAt: true,
  updatedAt: true,
});

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// ---------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------

/**
 * An entry read back, or null for one that cannot be kept: anything but an
 * object with an id, a grid and a time it was first saved. A name is tidied
 * (see `normaliseTitle`), and left off if nothing is left of it; a time last
 * changed that is missing or before the first is read as the first.
 */
export function normalisePuzzle(value: unknown): SavedPuzzle | null {
  if (!isObject(value)) return null;
  const { id, cells, createdAt } = value;
  if (typeof id !== 'string' || !GAME_ID_PATTERN.test(id)) return null;
  if (!isGridString(cells) || !isTime(createdAt)) return null;
  const title = normaliseTitle(value.title);
  return {
    ...newerFields(value, PUZZLE_FIELDS),
    id,
    cells,
    ...(title === '' ? {} : { title }),
    createdAt,
    updatedAt: isTime(value.updatedAt) ? Math.max(value.updatedAt, createdAt) : createdAt,
  };
}

/**
 * The library as storage, or a file, held it: newest first by when each was
 * first saved. Junk costs only its own entry (see `normalisePuzzle`). One
 * rule crosses entries: no two have the same id, nor the same numbers, so of
 * two that do, the one changed later is kept. Never capped here (see
 * `savePuzzle`): a newer version may keep more, and its list is not this
 * one's to trim on every read.
 */
export function normalisePuzzles(value: unknown): SavedPuzzle[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const grids = new Set<GridString>();
  return (
    value
      .map(normalisePuzzle)
      .filter((entry) => entry !== null)
      // Stable, so a tie keeps the list's order.
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((entry) => {
        if (ids.has(entry.id) || grids.has(entry.cells)) return false;
        ids.add(entry.id);
        grids.add(entry.cells);
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  );
}

/** Each entry by its numbers. A Map, so no grid is ever a key on a plain object. */
export function indexPuzzles(
  puzzles: readonly SavedPuzzle[],
): ReadonlyMap<GridString, SavedPuzzle> {
  return new Map(puzzles.map((entry) => [entry.cells, entry]));
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

/** `items` with the one at `at` replaced: a new list, the rest shared. */
function replaced<T>(items: readonly T[], at: number, item: T): T[] {
  return items.map((existing, i) => (i === at ? item : existing));
}

/**
 * The list with room for one more: as it is under MAX_SAVED_PUZZLES, and
 * otherwise without the entry changed longest ago (of two, the one first
 * saved earlier) — one only, so a newer version's longer list is left as
 * long as it was.
 */
function withRoom(puzzles: readonly SavedPuzzle[]): readonly SavedPuzzle[] {
  if (puzzles.length < MAX_SAVED_PUZZLES) return puzzles;
  const stalest = puzzles.reduce((stale, entry) =>
    entry.updatedAt <= stale.updatedAt ? entry : stale,
  );
  return puzzles.filter((entry) => entry !== stalest);
}

/**
 * Keep `cells` in the library, at `now` — the one rule for Save, for the
 * save as Play starts a game of it, and for the save as the editor closes:
 *
 *   - the entry `id` is updated, if it is still there — the one being
 *     edited; else the entry with these numbers, if there is one; else a
 *     new one is added, unnamed, under `id` — a fresh one, for a grid never
 *     saved, or the id of an entry deleted since (in another tab) — at the
 *     head of the list, the list making room for it first (see
 *     `withRoom`), so the entry saved is never the one to go;
 *   - its time last changed moves only when its numbers do;
 *   - any other entry with these numbers goes — an entry edited into
 *     another's grid takes its place — and the entry kept takes its name if
 *     it has none, so a save never loses a name.
 *
 * Returns the list, and the entry as saved: the same list when nothing
 * changes (a grid saved again as it was). Never given a grid of blanks: the
 * editor saves nothing until a number is in.
 */
export function savePuzzle(
  puzzles: readonly SavedPuzzle[],
  { id, cells }: { id: string; cells: GridString },
  now: number,
): { list: readonly SavedPuzzle[]; entry: SavedPuzzle } {
  const at = puzzles.findIndex((entry) => entry.id === id);
  const target = at === -1 ? puzzles.findIndex((entry) => entry.cells === cells) : at;
  if (target === -1) {
    const entry: SavedPuzzle = { id, cells, createdAt: now, updatedAt: now };
    return { list: [entry, ...withRoom(puzzles)], entry };
  }
  const kept = puzzles[target];
  if (kept.cells === cells) return { list: puzzles, entry: kept };
  // Edited into another entry's numbers: that one goes, leaving its name.
  const twin = puzzles.find((entry) => entry.cells === cells);
  const title = kept.title ?? twin?.title;
  const entry: SavedPuzzle = {
    ...kept,
    cells,
    ...(title === undefined ? {} : { title }),
    updatedAt: now,
  };
  return { list: replaced(puzzles, target, entry).filter((other) => other !== twin), entry };
}

/**
 * The entry `id` is called `title` from now on, tidied (see
 * `normaliseTitle`); one that tidies to nothing takes the name off. Its time
 * last changed moves with it, but never its place in the list, which is by
 * when it was first saved. The same list back for an entry not in it, or for
 * the name it has already.
 */
export function retitlePuzzle(
  puzzles: readonly SavedPuzzle[],
  id: string,
  title: string,
  now: number,
): readonly SavedPuzzle[] {
  const at = puzzles.findIndex((entry) => entry.id === id);
  if (at === -1) return puzzles;
  const tidy = normaliseTitle(title);
  const { title: previous, ...untitled } = puzzles[at];
  if ((previous ?? '') === tidy) return puzzles;
  return replaced(puzzles, at, {
    ...untitled,
    ...(tidy === '' ? {} : { title: tidy }),
    updatedAt: now,
  });
}

/** The list without the entry `id`; the same list back for an entry not in it. */
export function deletePuzzle(puzzles: readonly SavedPuzzle[], id: string): readonly SavedPuzzle[] {
  const left = puzzles.filter((entry) => entry.id !== id);
  return left.length === puzzles.length ? puzzles : left;
}
