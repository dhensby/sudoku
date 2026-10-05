import {
  ALL_DIGITS,
  BOX,
  COL,
  PEERS,
  POPCOUNT,
  ROW,
  UNITS,
  bit,
  cellAt,
  computeCandidates,
  conflictingUnits,
  countFilled,
  digitsOf,
  findConflicts,
  formatGrid,
  gridValues,
  hasDigit,
  isGridString,
  isPeer,
  lowestDigit,
  maskOf,
  parseGrid,
  unitCells,
} from './grid';
import { EMPTY_GRID, WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';

describe('geometry tables', () => {
  it('places each cell in its row, column and box', () => {
    expect([ROW[0], COL[0], BOX[0]]).toEqual([0, 0, 0]);
    expect([ROW[40], COL[40], BOX[40]]).toEqual([4, 4, 4]);
    expect([ROW[80], COL[80], BOX[80]]).toEqual([8, 8, 8]);
    expect([ROW[26], COL[26], BOX[26]]).toEqual([2, 8, 2]);
    expect([ROW[54], COL[54], BOX[54]]).toEqual([6, 0, 6]);
  });

  it('lists 27 units of 9 distinct cells: rows, then columns, then boxes', () => {
    expect(UNITS).toHaveLength(27);
    for (const unit of UNITS) expect(new Set(unit).size).toBe(9);
    expect(UNITS[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(UNITS[9]).toEqual([0, 9, 18, 27, 36, 45, 54, 63, 72]);
    expect(UNITS[18]).toEqual([0, 1, 2, 9, 10, 11, 18, 19, 20]);
    expect(UNITS[26]).toEqual([60, 61, 62, 69, 70, 71, 78, 79, 80]);
  });

  it('looks up a unit by kind and index', () => {
    expect(unitCells({ kind: 'row', index: 1 })).toBe(UNITS[1]);
    expect(unitCells({ kind: 'column', index: 1 })).toBe(UNITS[10]);
    expect(unitCells({ kind: 'box', index: 1 })).toBe(UNITS[19]);
  });

  it('gives every cell 20 peers, never itself', () => {
    for (let i = 0; i < 81; i++) {
      expect(PEERS[i]).toHaveLength(20);
      expect(PEERS[i]).not.toContain(i);
      expect(isPeer(i, i)).toBe(false);
    }
    expect(isPeer(0, 8)).toBe(true); // row
    expect(isPeer(0, 72)).toBe(true); // column
    expect(isPeer(0, 20)).toBe(true); // box
    expect(isPeer(0, 40)).toBe(false);
  });

  it('indexes cells by row and column', () => {
    expect(cellAt(0, 0)).toBe(0);
    expect(cellAt(4, 5)).toBe(41);
    expect(cellAt(8, 8)).toBe(80);
  });
});

describe('masks', () => {
  it('counts bits', () => {
    expect(POPCOUNT[0]).toBe(0);
    expect(POPCOUNT[ALL_DIGITS]).toBe(9);
    expect(POPCOUNT[0b101]).toBe(2);
  });

  it('converts between digits and masks', () => {
    expect(bit(1)).toBe(1);
    expect(bit(9)).toBe(256);
    expect(maskOf([1, 5, 9])).toBe(0b100010001);
    expect(digitsOf(0b100010001)).toEqual([1, 5, 9]);
    expect(digitsOf(0)).toEqual([]);
    expect(lowestDigit(0b110000)).toBe(5);
    expect(hasDigit(0b10, 2)).toBe(true);
    expect(hasDigit(0b10, 3)).toBe(false);
  });
});

describe('parseGrid / formatGrid', () => {
  it('reads layouts with dots, zeros and whitespace', () => {
    const values = parseGrid(WIKIPEDIA_PUZZLE);
    expect(values[0]).toBe(5);
    expect(values[2]).toBe(0);
    expect(parseGrid(formatGrid(values))).toEqual(values);
    expect(formatGrid(values)).toMatch(/^530070000600195000/);
  });

  it('rejects the wrong number of cells or stray characters', () => {
    expect(() => parseGrid('123')).toThrow(/81 cells/);
    expect(() => parseGrid(`x${'.'.repeat(80)}`)).toThrow(/Unexpected character 'x'/);
  });

  it('formats plain arrays too', () => {
    expect(formatGrid(new Array(81).fill(0))).toBe('0'.repeat(81));
  });
});

describe('isGridString / gridValues', () => {
  it('accepts only 81 digit characters', () => {
    expect(isGridString('0'.repeat(81))).toBe(true);
    expect(isGridString('0'.repeat(80))).toBe(false);
    expect(isGridString(`${'0'.repeat(80)}.`)).toBe(false);
    expect(isGridString(42)).toBe(false);
    expect(isGridString(null)).toBe(false);
  });

  it('turns a grid string into numbers', () => {
    const grid = formatGrid(parseGrid(WIKIPEDIA_SOLUTION));
    expect(gridValues(grid)).toEqual(parseGrid(WIKIPEDIA_SOLUTION));
  });
});

describe('countFilled', () => {
  it('counts the non-empty cells', () => {
    expect(countFilled(parseGrid(EMPTY_GRID))).toBe(0);
    expect(countFilled(parseGrid(WIKIPEDIA_PUZZLE))).toBe(30);
    expect(countFilled(parseGrid(WIKIPEDIA_SOLUTION))).toBe(81);
  });
});

describe('computeCandidates', () => {
  it('offers every digit on an empty grid', () => {
    expect([...computeCandidates(parseGrid(EMPTY_GRID))].every((m) => m === ALL_DIGITS)).toBe(true);
  });

  it('removes digits placed in the row, column and box, and clears filled cells', () => {
    const candidates = computeCandidates(parseGrid(WIKIPEDIA_PUZZLE));
    expect(candidates[0]).toBe(0); // filled
    // r0c2 sees 5,3,7 (row), 8 (column), 6,9 (box) — leaving 1, 2 and 4.
    expect(digitsOf(candidates[2])).toEqual([1, 2, 4]);
  });

  it('trusts wrong entries, as NYT does', () => {
    const values = parseGrid(EMPTY_GRID);
    values[0] = 9;
    const candidates = computeCandidates(values);
    expect(hasDigit(candidates[1], 9)).toBe(false);
    expect(hasDigit(candidates[40], 9)).toBe(true);
  });
});

describe('findConflicts / conflictingUnits', () => {
  it('reports nothing for a valid grid', () => {
    expect(findConflicts(parseGrid(WIKIPEDIA_PUZZLE)).some(Boolean)).toBe(false);
    expect(conflictingUnits(parseGrid(WIKIPEDIA_PUZZLE), 0)).toEqual([]);
  });

  it('flags both cells of a clash, in every unit it happens in', () => {
    const values = parseGrid(EMPTY_GRID);
    values[0] = 4;
    values[10] = 4; // same box as cell 0
    values[8] = 4; // same row as cell 0
    const conflicts = findConflicts(values);
    expect(conflicts[0]).toBe(true);
    expect(conflicts[8]).toBe(true);
    expect(conflicts[10]).toBe(true);
    expect(conflicts.filter(Boolean)).toHaveLength(3);
    expect(conflictingUnits(values, 0)).toEqual([
      { kind: 'row', index: 0 },
      { kind: 'box', index: 0 },
    ]);
    expect(conflictingUnits(values, 10)).toEqual([{ kind: 'box', index: 0 }]);
  });

  it('describes an empty cell as conflicting with nothing', () => {
    expect(conflictingUnits(parseGrid(EMPTY_GRID), 0)).toEqual([]);
  });

  it('reports a column clash', () => {
    const values = parseGrid(EMPTY_GRID);
    values[0] = 2;
    values[72] = 2;
    expect(conflictingUnits(values, 72)).toEqual([{ kind: 'column', index: 0 }]);
  });
});
