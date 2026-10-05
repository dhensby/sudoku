import {
  ALL_DIGITS,
  BOX,
  COL,
  PEERS,
  POPCOUNT,
  ROW,
  UNITS,
  bit,
  computeCandidates,
  isPeer,
  lowestDigit,
} from './grid';
import type { Digit, TechniqueId, Unit, Values } from './types';

/*
 * The human-style solving techniques the grader and the hint are built from.
 *
 * Every technique works on a mutable `SolverBoard`: it looks for one instance
 * of its pattern, applies it and describes what it did as a `SolveStep`, or
 * returns null and leaves the board exactly as it found it. A step only counts
 * if it changed something — placed a digit or removed at least one candidate.
 * A pattern that is present but removes nothing is skipped and the search goes
 * on, because counting it is the classic way a grader ends up calling an easy
 * puzzle hard.
 *
 * Each one scans in a fixed order (units 0–26, cells 0–80, digits 1–9), so a
 * solve path is a pure function of the board. The grader is far less hot
 * than the brute-force solver, so these favour clarity over shaving
 * allocations; they still use masks and the shared lookup tables throughout.
 */

/**
 * The working state of a logical solve. Typed arrays so a solve allocates two
 * buffers rather than 81 objects.
 */
export interface SolverBoard {
  /** Placed digit per cell, 0 when empty. */
  values: Uint8Array;
  /** Remaining candidates per cell as a digit mask; always 0 for a filled cell. */
  candidates: Uint16Array;
}

/** Candidates one step removed from one cell. */
export interface Elimination {
  /** The cell the candidates were removed from. */
  index: number;
  /** The digits removed, as a mask. Never 0. */
  mask: number;
}

/** One deduction: what was found, and what it changed. */
export interface SolveStep {
  /** Which technique found the step. */
  technique: TechniqueId;
  /** Set for single-placement steps. */
  placement: { index: number; digit: Digit } | null;
  /** Candidates removed by elimination steps: per cell, a mask of removed digits. */
  eliminations: Elimination[];
  /**
   * The house the step was found in, when it has one (full house, hidden
   * single, locked candidates, subsets).
   */
  unit: Unit | null;
}

/**
 * Find one instance of a technique, apply it to the board and describe it — or
 * return null, changing nothing.
 */
export type Technique = (board: SolverBoard) => SolveStep | null;

/**
 * A board for `values`, with candidates from naked elimination of the placed
 * digits only. That is where every logical solve starts: from the givens (and
 * any correct player values), never from the player's own notes.
 */
export function createBoard(values: Values): SolverBoard {
  return { values: Uint8Array.from(values), candidates: computeCandidates(values) };
}

/** An independent copy of a board. */
export function cloneBoard(board: SolverBoard): SolverBoard {
  return { values: board.values.slice(), candidates: board.candidates.slice() };
}

/** Place a digit and strike it from the candidates of every peer. */
export function place(board: SolverBoard, index: number, digit: Digit): void {
  const digitBit = bit(digit);
  board.values[index] = digit;
  board.candidates[index] = 0;
  for (const peer of PEERS[index]) board.candidates[peer] &= ~digitBit;
}

/** Remove candidates from a cell. Returns the digits actually removed (0 if none were there). */
export function eliminate(board: SolverBoard, index: number, mask: number): number {
  const removed = board.candidates[index] & mask;
  board.candidates[index] ^= removed;
  return removed;
}

/** The `Unit` for a `UNITS` index (rows 0–8, columns 9–17, boxes 18–26). */
function unitOf(u: number): Unit {
  if (u < 9) return { kind: 'row', index: u };
  if (u < 18) return { kind: 'column', index: u - 9 };
  return { kind: 'box', index: u - 18 };
}

/** The index (0–8) of the single set bit in a mask. */
function bitIndex(mask: number): number {
  return 31 - Math.clz32(mask);
}

/** Remove `mask` from a cell, noting what actually went. */
function strike(
  board: SolverBoard,
  eliminations: Elimination[],
  index: number,
  mask: number,
): void {
  const removed = eliminate(board, index, mask);
  if (removed !== 0) eliminations.push({ index, mask: removed });
}

function placementStep(
  board: SolverBoard,
  technique: TechniqueId,
  index: number,
  digit: Digit,
  unit: Unit | null,
): SolveStep {
  place(board, index, digit);
  return { technique, placement: { index, digit }, eliminations: [], unit };
}

/** An elimination step, or null when the pattern removed nothing — such a step never counts. */
function eliminationStep(
  technique: TechniqueId,
  eliminations: Elimination[],
  unit: Unit | null,
): SolveStep | null {
  return eliminations.length === 0 ? null : { technique, placement: null, eliminations, unit };
}

/**
 * Visit each `k`-combination of `0 … n - 1` (ascending, in lexicographic order)
 * until `visit` returns something other than null, and return that. The
 * subset and fish searches only need k = 2 or 3, so recursion depth is tiny.
 */
function findCombination<T>(
  n: number,
  k: number,
  visit: (picked: readonly number[]) => T | null,
): T | null {
  const picked: number[] = [];
  const extend = (start: number): T | null => {
    if (picked.length === k) return visit(picked);
    for (let i = start; i <= n - (k - picked.length); i++) {
      picked.push(i);
      const found = extend(i + 1);
      if (found !== null) return found;
      picked.pop();
    }
    return null;
  };
  return extend(0);
}

// ---------------------------------------------------------------------------
// Singles
// ---------------------------------------------------------------------------

/** A unit with exactly one empty cell: it takes the one digit the unit is missing. */
const fullHouse: Technique = (board) => {
  for (let u = 0; u < 27; u++) {
    let empty = -1;
    let emptyCount = 0;
    for (const i of UNITS[u]) {
      if (board.values[i] === 0) {
        empty = i;
        emptyCount++;
      }
    }
    if (emptyCount !== 1) continue;
    // A contradictory board (reachable only from inconsistent input) can leave
    // the last cell with no candidate; there is nothing sound to place then.
    const mask = board.candidates[empty];
    if (POPCOUNT[mask] === 1) {
      return placementStep(board, 'fullHouse', empty, lowestDigit(mask), unitOf(u));
    }
  }
  return null;
};

/**
 * A digit with only one possible cell left in a unit. One pass per unit: a bit
 * seen a second time moves into `twice`, so `once & ~twice` is exactly the
 * digits that appear in a single cell's candidates.
 */
function hiddenSingleIn(
  board: SolverBoard,
  technique: TechniqueId,
  from: number,
  to: number,
): SolveStep | null {
  for (let u = from; u < to; u++) {
    let once = 0;
    let twice = 0;
    for (const i of UNITS[u]) {
      const mask = board.candidates[i];
      twice |= once & mask;
      once |= mask;
    }
    const only = once & ~twice;
    if (only === 0) continue;
    const digitBit = only & -only;
    // `only` came from these very cells, so one of them holds the bit.
    const index = UNITS[u].find((i) => (board.candidates[i] & digitBit) !== 0)!;
    return placementStep(board, technique, index, lowestDigit(digitBit), unitOf(u));
  }
  return null;
}

/** Hidden single in a box — the easiest kind to spot, so it is tried before rows and columns. */
const hiddenSingleBox: Technique = (board) => hiddenSingleIn(board, 'hiddenSingleBox', 18, 27);

/** Hidden single in a row or column. */
const hiddenSingleLine: Technique = (board) => hiddenSingleIn(board, 'hiddenSingleLine', 0, 18);

/** A cell with only one candidate left. */
const nakedSingle: Technique = (board) => {
  for (let i = 0; i < 81; i++) {
    if (board.values[i] === 0 && POPCOUNT[board.candidates[i]] === 1) {
      return placementStep(board, 'nakedSingle', i, lowestDigit(board.candidates[i]), null);
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Locked candidates
// ---------------------------------------------------------------------------

/**
 * Pointing: inside a box, a digit's candidates all lie in one row or column,
 * so the digit can go nowhere else in that line.
 */
const pointing: Technique = (board) => {
  for (let b = 0; b < 9; b++) {
    const box = UNITS[18 + b];
    for (let d = 1; d <= 9; d++) {
      const digitBit = bit(d);
      let rows = 0;
      let cols = 0;
      let count = 0;
      for (const i of box) {
        if (board.candidates[i] & digitBit) {
          rows |= 1 << ROW[i];
          cols |= 1 << COL[i];
          count++;
        }
      }
      // One cell is a hidden single, not a pointing pair — counting it here
      // would rate the puzzle harder than it is.
      if (count < 2) continue;
      let line: readonly number[];
      if (POPCOUNT[rows] === 1) line = UNITS[bitIndex(rows)];
      else if (POPCOUNT[cols] === 1) line = UNITS[9 + bitIndex(cols)];
      else continue;
      const eliminations: Elimination[] = [];
      for (const i of line) if (BOX[i] !== b) strike(board, eliminations, i, digitBit);
      const step = eliminationStep('pointing', eliminations, unitOf(18 + b));
      if (step) return step;
    }
  }
  return null;
};

/**
 * Claiming (box/line reduction): inside a row or column, a digit's candidates
 * all lie in one box, so the digit can go nowhere else in that box.
 */
const claiming: Technique = (board) => {
  for (let u = 0; u < 18; u++) {
    for (let d = 1; d <= 9; d++) {
      const digitBit = bit(d);
      let boxes = 0;
      let count = 0;
      for (const i of UNITS[u]) {
        if (board.candidates[i] & digitBit) {
          boxes |= 1 << BOX[i];
          count++;
        }
      }
      // As with pointing, a lone cell is a hidden single.
      if (count < 2 || POPCOUNT[boxes] !== 1) continue;
      const eliminations: Elimination[] = [];
      for (const i of UNITS[18 + bitIndex(boxes)]) {
        const isInLine = u < 9 ? ROW[i] === u : COL[i] === u - 9;
        if (!isInLine) strike(board, eliminations, i, digitBit);
      }
      const step = eliminationStep('claiming', eliminations, unitOf(u));
      if (step) return step;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Subsets
// ---------------------------------------------------------------------------

/**
 * Naked subset: `size` cells of a unit whose candidates, together, are exactly
 * `size` digits. Those digits must fill those cells, so no other cell of the
 * unit can hold them.
 */
function nakedSubset(board: SolverBoard, technique: TechniqueId, size: number): SolveStep | null {
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u];
    const empties = unit.filter((i) => board.values[i] === 0);
    // With `size` or fewer empty cells the "subset" is the whole remainder of
    // the unit: true, but it says nothing.
    if (empties.length <= size) continue;
    // A cell with one candidate is a naked single, not part of a subset.
    const cells = empties.filter((i) => {
      const count = POPCOUNT[board.candidates[i]];
      return count >= 2 && count <= size;
    });
    const step = findCombination(cells.length, size, (picked) => {
      let digits = 0;
      for (const p of picked) digits |= board.candidates[cells[p]];
      if (POPCOUNT[digits] !== size) return null;
      const members = picked.map((p) => cells[p]);
      const eliminations: Elimination[] = [];
      for (const i of empties) if (!members.includes(i)) strike(board, eliminations, i, digits);
      return eliminationStep(technique, eliminations, unitOf(u));
    });
    if (step) return step;
  }
  return null;
}

/**
 * Hidden subset: `size` digits whose remaining places in a unit are exactly
 * `size` cells. Those cells must hold those digits, so every other candidate
 * in them can go.
 */
function hiddenSubset(board: SolverBoard, technique: TechniqueId, size: number): SolveStep | null {
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u];
    // As for naked subsets: the whole remainder of a unit is no subset.
    if (unit.filter((i) => board.values[i] === 0).length <= size) continue;
    // Where each digit can still go, as a mask of positions 0–8 in the unit.
    // Placed digits have no positions; a digit with one is a hidden single.
    const digits: number[] = [];
    const places: number[] = [];
    for (let d = 1; d <= 9; d++) {
      let positions = 0;
      for (let p = 0; p < 9; p++) if (board.candidates[unit[p]] & bit(d)) positions |= 1 << p;
      const count = POPCOUNT[positions];
      if (count >= 2 && count <= size) {
        digits.push(d);
        places.push(positions);
      }
    }
    const step = findCombination(digits.length, size, (picked) => {
      let positions = 0;
      let kept = 0;
      for (const x of picked) {
        positions |= places[x];
        kept |= bit(digits[x]);
      }
      if (POPCOUNT[positions] !== size) return null;
      const eliminations: Elimination[] = [];
      for (let p = 0; p < 9; p++) {
        if (positions & (1 << p)) strike(board, eliminations, unit[p], ALL_DIGITS & ~kept);
      }
      return eliminationStep(technique, eliminations, unitOf(u));
    });
    if (step) return step;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------

/**
 * Basic fish of `size` (2 = X-Wing, 3 = Swordfish) for one digit and one
 * orientation: `size` base lines whose candidates for the digit all fall in
 * `size` cross lines. The digit must take one cell of each cross line inside
 * the base lines, so it can be struck from the rest of the cross lines.
 */
function fishIn(
  board: SolverBoard,
  technique: TechniqueId,
  size: number,
  digitBit: number,
  isRowBase: boolean,
): SolveStep | null {
  const cell = (line: number, cross: number) => (isRowBase ? line * 9 + cross : cross * 9 + line);
  const lines: number[] = [];
  const covers: number[] = [];
  for (let line = 0; line < 9; line++) {
    let cover = 0;
    for (let cross = 0; cross < 9; cross++) {
      if (board.candidates[cell(line, cross)] & digitBit) cover |= 1 << cross;
    }
    // A line with the digit in one cell is a hidden single; with more than
    // `size` it cannot be part of this fish.
    const count = POPCOUNT[cover];
    if (count >= 2 && count <= size) {
      lines.push(line);
      covers.push(cover);
    }
  }
  return findCombination(lines.length, size, (picked) => {
    let cover = 0;
    let base = 0;
    for (const x of picked) {
      cover |= covers[x];
      base |= 1 << lines[x];
    }
    if (POPCOUNT[cover] !== size) return null;
    const eliminations: Elimination[] = [];
    for (let cross = 0; cross < 9; cross++) {
      if ((cover & (1 << cross)) === 0) continue;
      for (let line = 0; line < 9; line++) {
        if ((base & (1 << line)) === 0) strike(board, eliminations, cell(line, cross), digitBit);
      }
    }
    return eliminationStep(technique, eliminations, null);
  });
}

function fish(board: SolverBoard, technique: TechniqueId, size: number): SolveStep | null {
  for (let d = 1; d <= 9; d++) {
    const step =
      fishIn(board, technique, size, bit(d), true) ?? fishIn(board, technique, size, bit(d), false);
    if (step) return step;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wings
// ---------------------------------------------------------------------------

/**
 * XY-Wing: a pivot with candidates {x, y} sees two pincers {x, z} and {y, z}.
 * Whichever digit the pivot takes, one pincer becomes z — so z can be struck
 * from every cell that sees both pincers.
 */
const xyWing: Technique = (board) => {
  const { candidates } = board;
  for (let pivot = 0; pivot < 81; pivot++) {
    const pivotMask = candidates[pivot];
    if (POPCOUNT[pivotMask] !== 2) continue;
    const pincers = PEERS[pivot].filter(
      (q) => POPCOUNT[candidates[q]] === 2 && POPCOUNT[candidates[q] & pivotMask] === 1,
    );
    for (let a = 0; a < pincers.length; a++) {
      for (let b = a + 1; b < pincers.length; b++) {
        const first = pincers[a];
        const second = pincers[b];
        // The pincers must hang off different pivot digits and share the
        // same outside digit z ({x, z} and {y, z}, not {x, z} and {x, w}).
        if ((candidates[first] & pivotMask) === (candidates[second] & pivotMask)) continue;
        const z = candidates[first] & candidates[second] & ~pivotMask;
        if (z === 0) continue;
        // A cell is not its own peer, so neither pincer is ever a target; the
        // pivot can be one, but it has no z to lose.
        const eliminations: Elimination[] = [];
        for (const t of PEERS[first]) if (isPeer(second, t)) strike(board, eliminations, t, z);
        const step = eliminationStep('xyWing', eliminations, null);
        if (step) return step;
      }
    }
  }
  return null;
};

/**
 * XYZ-Wing: a pivot {x, y, z} sees two pincers {x, z} and {y, z}. One of the
 * three cells must be z, so z can be struck from every cell that sees all
 * three.
 */
const xyzWing: Technique = (board) => {
  const { candidates } = board;
  for (let pivot = 0; pivot < 81; pivot++) {
    const pivotMask = candidates[pivot];
    if (POPCOUNT[pivotMask] !== 3) continue;
    const pincers = PEERS[pivot].filter(
      (q) => POPCOUNT[candidates[q]] === 2 && (candidates[q] & ~pivotMask) === 0,
    );
    for (let a = 0; a < pincers.length; a++) {
      for (let b = a + 1; b < pincers.length; b++) {
        const first = pincers[a];
        const second = pincers[b];
        // Two different pairs drawn from three digits always share exactly
        // one digit, and that digit is z.
        if (candidates[first] === candidates[second]) continue;
        const z = candidates[first] & candidates[second];
        // A cell is not its own peer, so the pincers rule themselves out.
        const eliminations: Elimination[] = [];
        for (const t of PEERS[pivot]) {
          if (isPeer(first, t) && isPeer(second, t)) strike(board, eliminations, t, z);
        }
        const step = eliminationStep('xyzWing', eliminations, null);
        if (step) return step;
      }
    }
  }
  return null;
};

/**
 * Every technique, by id. Each applies one step to the board, or returns null
 * and changes nothing.
 */
export const TECHNIQUES: Readonly<Record<TechniqueId, Technique>> = {
  fullHouse,
  hiddenSingleBox,
  hiddenSingleLine,
  nakedSingle,
  pointing,
  claiming,
  nakedPair: (board) => nakedSubset(board, 'nakedPair', 2),
  hiddenPair: (board) => hiddenSubset(board, 'hiddenPair', 2),
  nakedTriple: (board) => nakedSubset(board, 'nakedTriple', 3),
  hiddenTriple: (board) => hiddenSubset(board, 'hiddenTriple', 3),
  xWing: (board) => fish(board, 'xWing', 2),
  swordfish: (board) => fish(board, 'swordfish', 3),
  xyWing,
  xyzWing,
};
