import type { Digit, GridString, Unit, UnitKind, Values } from './types';

/*
 * Geometry and bitmask helpers shared by every part of the engine.
 *
 * Cells are numbered 0–80 in reading order. Units are numbered 0–26: rows
 * 0–8, columns 9–17 and boxes 18–26, so a single loop over `UNITS` visits
 * every house a technique might look at. Candidate sets are 9-bit masks with
 * bit `d - 1` standing for digit `d`.
 *
 * The tables are typed arrays built once at module load; the solver and grader
 * index them in their hottest loops, and that is where allocation would hurt.
 */

/** Every digit, as a mask. */
export const ALL_DIGITS = 0x1ff;

/** Row (0–8) of each cell. */
export const ROW = new Uint8Array(81);
/** Column (0–8) of each cell. */
export const COL = new Uint8Array(81);
/** Box (0–8, reading order) of each cell. */
export const BOX = new Uint8Array(81);

for (let i = 0; i < 81; i++) {
  ROW[i] = Math.floor(i / 9);
  COL[i] = i % 9;
  BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
}

function buildUnits(): number[][] {
  const units: number[][] = [];
  for (let r = 0; r < 9; r++) units.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) units.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const top = Math.floor(b / 3) * 3;
    const left = (b % 3) * 3;
    units.push(Array.from({ length: 9 }, (_, k) => (top + Math.floor(k / 3)) * 9 + left + (k % 3)));
  }
  return units;
}

/** The 27 units: rows 0–8, columns 9–17, boxes 18–26. Each lists its 9 cells in reading order. */
export const UNITS: readonly (readonly number[])[] = buildUnits();

/** Offset of each unit kind within `UNITS`. */
export const UNIT_OFFSET: Readonly<Record<UnitKind, number>> = { row: 0, column: 9, box: 18 };

/** The cells of a row, column or box. */
export function unitCells(unit: Unit): readonly number[] {
  return UNITS[UNIT_OFFSET[unit.kind] + unit.index];
}

function buildPeers(): number[][] {
  return Array.from({ length: 81 }, (_, i) => {
    const peers = new Set([...UNITS[ROW[i]], ...UNITS[9 + COL[i]], ...UNITS[18 + BOX[i]]]);
    peers.delete(i);
    return [...peers].sort((a, b) => a - b);
  });
}

/** The 20 cells sharing a row, column or box with each cell, ascending. */
export const PEERS: readonly (readonly number[])[] = buildPeers();

const PEER_TABLE = new Uint8Array(81 * 81);
for (let i = 0; i < 81; i++) for (const j of PEERS[i]) PEER_TABLE[i * 81 + j] = 1;

/** Whether two distinct cells share a row, column or box. A cell is not its own peer. */
export function isPeer(a: number, b: number): boolean {
  return PEER_TABLE[a * 81 + b] === 1;
}

/** Number of set bits in each 9-bit mask. */
export const POPCOUNT = new Uint8Array(512);
for (let m = 1; m < 512; m++) POPCOUNT[m] = POPCOUNT[m >> 1] + (m & 1);

/** The mask bit for a digit. */
export function bit(digit: number): number {
  return 1 << (digit - 1);
}

/** Whether a mask contains a digit. */
export function hasDigit(mask: number, digit: number): boolean {
  return (mask & bit(digit)) !== 0;
}

/** The smallest digit in a non-empty mask. */
export function lowestDigit(mask: number): Digit {
  return (32 - Math.clz32(mask & -mask)) as Digit;
}

/** The digits in a mask, ascending. */
export function digitsOf(mask: number): Digit[] {
  const digits: Digit[] = [];
  for (let d = 1; d <= 9; d++) if (mask & bit(d)) digits.push(d as Digit);
  return digits;
}

/** A mask holding exactly the given digits. */
export function maskOf(digits: Iterable<number>): number {
  let mask = 0;
  for (const d of digits) mask |= bit(d);
  return mask;
}

/** The cell index at a row and column, both 0–8. */
export function cellAt(row: number, col: number): number {
  return row * 9 + col;
}

/**
 * Parse a grid written for humans into 81 values.
 *
 * Accepts the canonical 81-character `GridString` as well as test-friendly
 * layouts: `.` and `0` both mean empty, and whitespace (including newlines and
 * the spaces people use to separate boxes) is ignored. Anything else, or the
 * wrong number of cells, throws — this is for literals in code and tests, not
 * for input from the outside world, which goes through `isGridString`.
 */
export function parseGrid(text: string): Uint8Array {
  const cells = text.replace(/\s+/g, '');
  if (cells.length !== 81) throw new Error(`Expected 81 cells, got ${cells.length}`);
  const values = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = cells[i];
    if (ch === '.' || ch === '0') continue;
    if (ch < '1' || ch > '9') throw new Error(`Unexpected character '${ch}' at cell ${i}`);
    values[i] = ch.charCodeAt(0) - 48;
  }
  return values;
}

/** Format 81 values as a `GridString`. */
export function formatGrid(values: Values): GridString {
  let out = '';
  for (let i = 0; i < 81; i++) out += String(values[i]);
  return out;
}

/** Whether a value from the outside world (storage, a link) is a well-formed `GridString`. */
export function isGridString(value: unknown): value is GridString {
  return typeof value === 'string' && /^[0-9]{81}$/.test(value);
}

/** The values of a `GridString`, as numbers. */
export function gridValues(grid: GridString): Uint8Array {
  const values = new Uint8Array(81);
  for (let i = 0; i < 81; i++) values[i] = grid.charCodeAt(i) - 48;
  return values;
}

/** How many cells hold a digit. */
export function countFilled(values: Values): number {
  let n = 0;
  for (let i = 0; i < 81; i++) if (values[i] !== 0) n++;
  return n;
}

/**
 * The digits that no placed peer rules out, for each cell; 0 for a filled cell.
 *
 * This is naked elimination only — exactly what NYT's auto-candidates show. It
 * deliberately trusts every placed value, wrong ones included: a wrong entry
 * really does strip a correct candidate from its peers, and hiding that would
 * quietly paper over the mistake.
 */
export function computeCandidates(values: Values): Uint16Array {
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  for (let i = 0; i < 81; i++) {
    const v = values[i];
    if (v === 0) continue;
    const b = bit(v);
    rows[ROW[i]] |= b;
    cols[COL[i]] |= b;
    boxes[BOX[i]] |= b;
  }
  const candidates = new Uint16Array(81);
  for (let i = 0; i < 81; i++) {
    if (values[i] !== 0) continue;
    candidates[i] = ALL_DIGITS & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
  }
  return candidates;
}

/**
 * Which cells hold a digit that a peer also holds. Both cells of a clash are
 * flagged, givens included — matching NYT, which dots every duplicate rather
 * than guessing which of the two the player meant to change.
 */
export function findConflicts(values: Values): boolean[] {
  const conflicts = new Array<boolean>(81).fill(false);
  for (const unit of UNITS) {
    for (let a = 0; a < 9; a++) {
      const va = values[unit[a]];
      if (va === 0) continue;
      for (let b = a + 1; b < 9; b++) {
        if (values[unit[b]] === va) {
          conflicts[unit[a]] = true;
          conflicts[unit[b]] = true;
        }
      }
    }
  }
  return conflicts;
}

/**
 * The units in which a cell's value clashes with a peer, for describing a
 * conflict ("conflicts with row 1 and the box"). Empty when it does not clash.
 */
export function conflictingUnits(values: Values, index: number): Unit[] {
  const value = values[index];
  if (value === 0) return [];
  const units: Unit[] = [];
  const candidates: Unit[] = [
    { kind: 'row', index: ROW[index] },
    { kind: 'column', index: COL[index] },
    { kind: 'box', index: BOX[index] },
  ];
  for (const unit of candidates) {
    if (unitCells(unit).some((j) => j !== index && values[j] === value)) units.push(unit);
  }
  return units;
}
