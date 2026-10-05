import { ALL_DIGITS, BOX, COL, POPCOUNT, ROW } from './grid';
import type { Values } from './types';

/*
 * A brute-force solver: bitmask backtracking that always branches on the cell
 * with the fewest candidates. It is what proves a puzzle has exactly one
 * solution, and it runs thousands of times while a puzzle is being dug out, so
 * it allocates nothing per search node — the state lives in module scratch
 * buffers and every call resets them first.
 *
 * Measured at 2µs for an NYT Easy and ~60µs for an NYT Hard on V8; the
 * notorious "world's hardest" puzzles take around a millisecond.
 */

const rows = new Uint16Array(9);
const cols = new Uint16Array(9);
const boxes = new Uint16Array(9);
const empty = new Uint8Array(81);
const work = new Uint8Array(81);
let emptyCount = 0;
let found = 0;
let limit = 2;
let firstSolution: Uint8Array | null = null;

/**
 * Load `values` into the scratch state. Returns false when the givens already
 * clash, which no amount of search can fix.
 */
function load(values: Values): boolean {
  rows.fill(0);
  cols.fill(0);
  boxes.fill(0);
  emptyCount = 0;
  found = 0;
  firstSolution = null;
  for (let i = 0; i < 81; i++) {
    const v = values[i];
    work[i] = v;
    if (v === 0) {
      empty[emptyCount++] = i;
      continue;
    }
    const b = 1 << (v - 1);
    if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) return false;
    rows[ROW[i]] |= b;
    cols[COL[i]] |= b;
    boxes[BOX[i]] |= b;
  }
  return true;
}

function search(depth: number): void {
  if (depth === emptyCount) {
    found++;
    if (firstSolution === null) firstSolution = work.slice();
    return;
  }

  // Minimum remaining values: the most constrained cell is the cheapest to
  // branch on, and a cell with 0 or 1 options ends the scan early.
  let best = depth;
  let bestMask = 0;
  let bestCount = 10;
  for (let k = depth; k < emptyCount; k++) {
    const i = empty[k];
    const mask = ALL_DIGITS & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
    const count = POPCOUNT[mask];
    if (count < bestCount) {
      bestCount = count;
      best = k;
      bestMask = mask;
      if (count <= 1) break;
    }
  }
  if (bestCount === 0) return;

  const cell = empty[best];
  empty[best] = empty[depth];
  empty[depth] = cell;
  const r = ROW[cell];
  const c = COL[cell];
  const b = BOX[cell];
  for (let mask = bestMask; mask !== 0;) {
    const digitBit = mask & -mask;
    mask ^= digitBit;
    rows[r] |= digitBit;
    cols[c] |= digitBit;
    boxes[b] |= digitBit;
    work[cell] = 32 - Math.clz32(digitBit);
    search(depth + 1);
    rows[r] ^= digitBit;
    cols[c] ^= digitBit;
    boxes[b] ^= digitBit;
    work[cell] = 0;
    if (found >= limit) break;
  }
  empty[depth] = empty[best];
  empty[best] = cell;
}

/**
 * Count the solutions of a grid, stopping once `max` have been found.
 *
 * Always capped: a puzzle with too few givens has astronomically many
 * solutions, and uncapped counting would never return. The default of 2 is all
 * a uniqueness check needs. Returns 0 for a grid whose givens clash.
 */
export function countSolutions(values: Values, max = 2): number {
  if (!load(values)) return 0;
  limit = max;
  search(0);
  return found;
}

/** Whether a grid has exactly one solution. */
export function hasUniqueSolution(values: Values): boolean {
  return countSolutions(values, 2) === 1;
}

/**
 * A solution of the grid — the first the search reaches — or null if it has
 * none. Does not check uniqueness; pair it with `hasUniqueSolution` when that
 * matters.
 */
export function solve(values: Values): Uint8Array | null {
  if (!load(values)) return null;
  limit = 1;
  search(0);
  return firstSolution;
}
