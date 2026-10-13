import { MIN_GIVENS } from './codec';
import { assessGivens, puzzleFromGivens } from './entry';
import { rate } from './grader';
import { formatGrid, gridValues, parseGrid } from './grid';
import type { Level } from './types';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import { BEYOND_THE_SET, HARDEST, type PuzzleFixture } from '../test/logic-fixtures';

const PUZZLE = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
const SOLUTION = formatGrid(parseGrid(WIKIPEDIA_SOLUTION));
const EMPTY = '0'.repeat(81);

/** `grid` — empty, unless another is given — with the digits of `cells` put in, by index. */
function gridOf(cells: Readonly<Record<number, number>>, grid = EMPTY): string {
  return [...grid].map((ch, i) => String(cells[i] ?? ch)).join('');
}

/** A cell by its row and column, counted from one as the game shows them. */
const at = (row: number, column: number) => (row - 1) * 9 + column - 1;

/** The first `count` givens of a grid, the rest left empty. */
function firstGivens(grid: string, count: number): string {
  let left = count;
  return [...grid].map((ch) => (ch !== '0' && left-- > 0 ? ch : '0')).join('');
}

describe('puzzleFromGivens', () => {
  it.each<[Level, PuzzleFixture]>([
    ['easy', HARDEST.hiddenSingleBox],
    ['hard', HARDEST.nakedPair],
    ['expert', HARDEST.xWing],
    ['beyond', BEYOND_THE_SET],
  ])('checks a puzzle, with its solution, and labels it %s as rate does', (level, fixture) => {
    expect(puzzleFromGivens(fixture.givens)).toEqual({
      ok: true,
      puzzle: { givens: fixture.givens, solution: fixture.solution, difficulty: level },
    });
    expect(rate(gridValues(fixture.givens))).toBe(level);
  });

  it('passes on what the check found wrong', () => {
    expect(puzzleFromGivens('530070000')).toEqual({ ok: false, problem: 'malformed' });
    expect(puzzleFromGivens(gridOf({ 0: 5, 1: 5 }, PUZZLE))).toEqual({
      ok: false,
      problem: 'clash',
    });
  });

  it('spends no more of the search than it is given', () => {
    expect(puzzleFromGivens(BEYOND_THE_SET.givens, { maxNodes: 0 })).toEqual({
      ok: false,
      problem: 'too-complex',
    });
  });
});

describe('assessGivens', () => {
  it('has nothing to say of a grid with no numbers yet', () => {
    expect(assessGivens(EMPTY)).toEqual({ kind: 'empty' });
  });

  it('reports a clash however few numbers there are', () => {
    // Two 5s in row 3, in different columns and boxes.
    expect(assessGivens(gridOf({ [at(3, 1)]: 5, [at(3, 9)]: 5 }))).toEqual({
      kind: 'clash',
      digit: 5,
      unit: { kind: 'row', index: 2 },
      count: 2,
    });
  });

  it('says how many of the number the unit holds', () => {
    const three = gridOf({ [at(1, 7)]: 5, [at(5, 7)]: 5, [at(9, 7)]: 5 });
    expect(assessGivens(three)).toEqual({
      kind: 'clash',
      digit: 5,
      unit: { kind: 'column', index: 6 },
      count: 3,
    });
  });

  it('reports a clash in a box alone as the box', () => {
    expect(assessGivens(gridOf({ [at(7, 7)]: 5, [at(9, 9)]: 5 }))).toEqual({
      kind: 'clash',
      digit: 5,
      unit: { kind: 'box', index: 8 },
      count: 2,
    });
  });

  it('reports the first unit to clash, rows before columns before boxes', () => {
    // Two 5s sharing a row and a box: the row.
    expect(assessGivens(gridOf({ [at(1, 1)]: 5, [at(1, 2)]: 5 }))).toMatchObject({
      unit: { kind: 'row', index: 0 },
    });
    // Sharing a column and a box: the column.
    expect(assessGivens(gridOf({ [at(1, 1)]: 5, [at(2, 1)]: 5 }))).toMatchObject({
      unit: { kind: 'column', index: 0 },
    });
    // Two 5s in column 1, and two 7s in row 9: the row, though its clash is
    // further down the grid.
    const both = gridOf({ [at(1, 1)]: 5, [at(8, 1)]: 5, [at(9, 4)]: 7, [at(9, 6)]: 7 });
    expect(assessGivens(both)).toEqual({
      kind: 'clash',
      digit: 7,
      unit: { kind: 'row', index: 8 },
      count: 2,
    });
  });

  it("names the number in a unit that holds two clashes by the first in the unit's order", () => {
    // Row 1 reads 5 3 3 5: the 5 is first, though the 3s are side by side.
    const row = gridOf({ [at(1, 1)]: 5, [at(1, 2)]: 3, [at(1, 3)]: 3, [at(1, 4)]: 5 });
    expect(assessGivens(row)).toMatchObject({ kind: 'clash', digit: 5, count: 2 });
  });

  it('reports a clash ahead of a full grid', () => {
    const clashing = gridOf({ 0: Number(SOLUTION[1]) }, SOLUTION);
    expect(assessGivens(clashing)).toMatchObject({ kind: 'clash', unit: { kind: 'row' } });
  });

  it(`asks for at least ${MIN_GIVENS} numbers`, () => {
    expect(assessGivens(firstGivens(PUZZLE, MIN_GIVENS - 1))).toEqual({ kind: 'too-few' });
    // Enough to go on to the search, which finds more than one way to finish them.
    expect(assessGivens(firstGivens(PUZZLE, MIN_GIVENS))).toEqual({ kind: 'multiple' });
  });

  it('has nothing to solve in a grid every cell of which is filled', () => {
    expect(assessGivens(SOLUTION)).toEqual({ kind: 'full' });
  });

  it('reports more than one solution', () => {
    // The top two rows of a solved grid blank: they can swap wholesale.
    expect(assessGivens('0'.repeat(18) + SOLUTION.slice(18))).toEqual({ kind: 'multiple' });
  });

  it('reports no solution for numbers that clash with none', () => {
    // Row 1, column 3 could hold a 1 as far as its peers go, but its answer is a 4.
    expect(assessGivens(gridOf({ 2: 1 }, PUZZLE))).toEqual({ kind: 'none' });
  });

  it('reports a grid the search ran out of nodes on as too complex', () => {
    expect(assessGivens(BEYOND_THE_SET.givens, { maxNodes: 0 })).toEqual({ kind: 'too-complex' });
  });

  it.each<[Level, PuzzleFixture]>([
    ['easy', { givens: PUZZLE, solution: SOLUTION }],
    ['hard', HARDEST.nakedPair],
    ['expert', HARDEST.xWing],
    ['beyond', BEYOND_THE_SET],
  ])('hands back a puzzle with one solution, labelled %s as its link will be', (level, fixture) => {
    expect(assessGivens(fixture.givens)).toEqual({
      kind: 'ok',
      puzzle: { givens: fixture.givens, solution: fixture.solution, difficulty: level },
    });
  });
});
