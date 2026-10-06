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
  digitsOf,
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

/** Candidates in one cell that make up the pattern behind a step. */
export interface PatternCell {
  /** The cell, empty when the step was found. */
  index: number;
  /** The digits of the pattern in that cell, as a mask. Never 0. */
  mask: number;
}

/**
 * One deduction: what was found, why, and what it changed.
 *
 * `pattern`, `houses` and `digit` describe the deduction the way a player
 * would see it, for showing a technique at work; the solve itself only ever
 * needs `placement` and `eliminations`.
 */
export interface SolveStep {
  /** Which technique found the step. */
  technique: TechniqueId;
  /** Set for single-placement steps. */
  placement: { index: number; digit: Digit } | null;
  /** Candidates removed by elimination steps: per cell, a mask of removed digits. */
  eliminations: Elimination[];
  /**
   * The house the step was found in, when it has one (full house, hidden
   * single, locked candidates, subsets): the first of `houses`.
   */
  unit: Unit | null;
  /**
   * The candidates that make up the pattern, as they stood when it was found
   * — what a player has to see to make the deduction:
   *
   * - singles: the cell and the digit it takes;
   * - pointing: the box's cells for the digit, all in one line;
   * - claiming: the line's cells for the digit, all in one box;
   * - naked and hidden subsets: the subset's cells, each with the subset
   *   digits it holds;
   * - fish: the base lines' cells for the digit, line by line;
   * - XY-Wing and XYZ-Wing: the pivot, then the two pincers, each with every
   *   candidate it holds;
   * - chains (Skyscraper, 2-String Kite): the chain's candidates from end to
   *   end, linked in turn strongly (one or other must be the digit), weakly
   *   (they can't both be), strongly — so one end or the other is the digit;
   * - XY-Chain: its cells from end to end, each with both its candidates;
   * - W-Wing: the first two-candidate cell, with both its candidates; the
   *   two places of the digit that joins them, the first seen by that cell
   *   and the second by the other; and the other two-candidate cell.
   */
  pattern: PatternCell[];
  /**
   * The houses involved, most telling first: singles and subsets → their
   * unit (none for a naked single, which is about the cell alone); pointing →
   * the box, then the line; claiming → the line, then the box; fish → the
   * base lines, then the cover lines; XY- and XYZ-Wings → none; chains →
   * the houses of their strong links, then the house of the weak link
   * between them (none for an XY-Chain, whose links are between cells);
   * W-Wing → the house of the digit that joins its cells.
   */
  houses: Unit[];
  /**
   * The one digit the step is about: the digit placed by a single, or the
   * digit of locked candidates, fish and chains (for an XY-Chain or a
   * W-Wing, the digit at both its ends, which it removes). Null for subsets
   * and the other wings, which work with several.
   */
  digit: Digit | null;
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

/** Place a single and describe it: the pattern is the cell itself, with the digit it takes. */
function placementStep(
  board: SolverBoard,
  technique: TechniqueId,
  index: number,
  digit: Digit,
  unit: Unit | null,
): SolveStep {
  place(board, index, digit);
  return {
    technique,
    placement: { index, digit },
    eliminations: [],
    unit,
    pattern: [{ index, mask: bit(digit) }],
    houses: unit ? [unit] : [],
    digit,
  };
}

/** What lies behind an elimination step: its `pattern`, `houses` and `digit`. */
type Finding = Pick<SolveStep, 'pattern' | 'houses' | 'digit'>;

/**
 * An elimination step, or null when the pattern removed nothing — such a step
 * never counts. `describe` runs only for a step that does count, so a search
 * that walks past dozens of empty patterns builds no descriptions for them.
 * Every technique strikes only outside its own pattern's candidates, so
 * describing it after the strikes sees the pattern exactly as it was found.
 */
function eliminationStep(
  technique: TechniqueId,
  eliminations: Elimination[],
  unit: Unit | null,
  describe: () => Finding,
): SolveStep | null {
  if (eliminations.length === 0) return null;
  return { technique, placement: null, eliminations, unit, ...describe() };
}

/** The cells of `cells` that hold any of `mask`, each with the part of `mask` it holds. */
function patternOf(board: SolverBoard, cells: readonly number[], mask: number): PatternCell[] {
  const pattern: PatternCell[] = [];
  for (const index of cells) {
    const held = board.candidates[index] & mask;
    if (held !== 0) pattern.push({ index, mask: held });
  }
  return pattern;
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
      let line: number;
      if (POPCOUNT[rows] === 1) line = bitIndex(rows);
      else if (POPCOUNT[cols] === 1) line = 9 + bitIndex(cols);
      else continue;
      const eliminations: Elimination[] = [];
      for (const i of UNITS[line]) if (BOX[i] !== b) strike(board, eliminations, i, digitBit);
      const step = eliminationStep('pointing', eliminations, unitOf(18 + b), () => ({
        pattern: patternOf(board, box, digitBit),
        houses: [unitOf(18 + b), unitOf(line)],
        digit: d as Digit,
      }));
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
      const box = 18 + bitIndex(boxes);
      const eliminations: Elimination[] = [];
      for (const i of UNITS[box]) {
        const isInLine = u < 9 ? ROW[i] === u : COL[i] === u - 9;
        if (!isInLine) strike(board, eliminations, i, digitBit);
      }
      const step = eliminationStep('claiming', eliminations, unitOf(u), () => ({
        pattern: patternOf(board, UNITS[u], digitBit),
        houses: [unitOf(u), unitOf(box)],
        digit: d as Digit,
      }));
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
      return eliminationStep(technique, eliminations, unitOf(u), () => ({
        pattern: patternOf(board, members, digits),
        houses: [unitOf(u)],
        digit: null,
      }));
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
      // The kept digits appear in exactly the subset's cells, nowhere else in the unit.
      return eliminationStep(technique, eliminations, unitOf(u), () => ({
        pattern: patternOf(board, unit, kept),
        houses: [unitOf(u)],
        digit: null,
      }));
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
  // Where the base and cross lines sit in `UNITS`.
  const baseOffset = isRowBase ? 0 : 9;
  const crossOffset = isRowBase ? 9 : 0;
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
    return eliminationStep(technique, eliminations, null, () => {
      const baseLines = picked.map((x) => lines[x]);
      const crossLines = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((cross) => cover & (1 << cross));
      return {
        pattern: baseLines.flatMap((line) => patternOf(board, UNITS[baseOffset + line], digitBit)),
        houses: [
          ...baseLines.map((line) => unitOf(baseOffset + line)),
          ...crossLines.map((cross) => unitOf(crossOffset + cross)),
        ],
        digit: lowestDigit(digitBit),
      };
    });
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
        const step = eliminationStep('xyWing', eliminations, null, () => ({
          pattern: patternOf(board, [pivot, first, second], ALL_DIGITS),
          houses: [],
          digit: null,
        }));
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
        const step = eliminationStep('xyzWing', eliminations, null, () => ({
          pattern: patternOf(board, [pivot, first, second], ALL_DIGITS),
          houses: [],
          digit: null,
        }));
        if (step) return step;
      }
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

/**
 * The lines among units `from`–`to` that hold `digitBit` in exactly two
 * cells, each as [unit, first cell, second cell]. Those two cells are a
 * strong link: one or other of them must be the digit.
 */
function conjugatePairs(
  board: SolverBoard,
  digitBit: number,
  from: number,
  to: number,
): [unit: number, first: number, second: number][] {
  const pairs: [number, number, number][] = [];
  for (let u = from; u < to; u++) {
    const holders = UNITS[u].filter((i) => (board.candidates[i] & digitBit) !== 0);
    if (holders.length === 2) pairs.push([u, holders[0], holders[1]]);
  }
  return pairs;
}

/**
 * A single-digit chain of four cells — strong link, weak link, strong link —
 * found and applied: one of its ends is the digit, so the digit goes from
 * every cell that sees both, the chain's own cells aside. Null when that
 * removes nothing.
 */
function chainStep(
  board: SolverBoard,
  technique: TechniqueId,
  digit: Digit,
  chain: readonly number[],
  houses: Unit[],
): SolveStep | null {
  const digitBit = bit(digit);
  const [first, last] = [chain[0], chain[chain.length - 1]];
  const eliminations: Elimination[] = [];
  for (const t of PEERS[first]) {
    if (isPeer(last, t) && !chain.includes(t)) strike(board, eliminations, t, digitBit);
  }
  return eliminationStep(technique, eliminations, null, () => ({
    pattern: chain.map((index) => ({ index, mask: digitBit })),
    houses,
    digit,
  }));
}

/**
 * Skyscraper: two parallel lines that each hold a digit in just two cells,
 * with one cell of each (the base) in the same cross line. The two base
 * cells can't both be the digit, so one of the other two (the tops) is —
 * and the digit goes from every cell that sees both tops. With the tops in
 * one cross line too, it would be an X-Wing.
 */
const skyscraper: Technique = (board) => {
  for (let d = 1; d <= 9; d++) {
    for (const isRowBase of [true, false]) {
      const cross = isRowBase ? COL : ROW;
      const crossOffset = isRowBase ? 9 : 0;
      const pairs = conjugatePairs(board, bit(d), isRowBase ? 0 : 9, isRowBase ? 9 : 18);
      for (let a = 0; a < pairs.length; a++) {
        for (let b = a + 1; b < pairs.length; b++) {
          const [u1, ...one] = pairs[a];
          const [u2, ...two] = pairs[b];
          // The cross line they share, if exactly one: sharing both is an X-Wing.
          const shared = one.filter((i) => two.some((j) => cross[j] === cross[i]));
          if (shared.length !== 1) continue;
          const base1 = shared[0];
          const base2 = two.find((j) => cross[j] === cross[base1])!;
          const top1 = one.find((i) => i !== base1)!;
          const top2 = two.find((j) => j !== base2)!;
          const step = chainStep(
            board,
            'skyscraper',
            d as Digit,
            [top1, base1, base2, top2],
            [unitOf(u1), unitOf(u2), unitOf(crossOffset + cross[base1])],
          );
          if (step) return step;
        }
      }
    }
  }
  return null;
};

/**
 * 2-String Kite: a row and a column that each hold a digit in just two
 * cells, with one cell of each in the same box. Those two can't both be the
 * digit, so one of the far ends — one along the row, one down the column —
 * is, and the digit goes from every cell that sees both: the cell in the
 * row of one and the column of the other.
 */
const twoStringKite: Technique = (board) => {
  for (let d = 1; d <= 9; d++) {
    const rows = conjugatePairs(board, bit(d), 0, 9);
    const columns = conjugatePairs(board, bit(d), 9, 18);
    for (const [r, ...inRow] of rows) {
      for (const [c, ...inColumn] of columns) {
        // A cell on both strings would tie them together at one end.
        if (inRow.some((i) => inColumn.includes(i))) continue;
        for (const rowIn of inRow) {
          for (const columnIn of inColumn) {
            const b = BOX[rowIn];
            const rowEnd = inRow.find((i) => i !== rowIn)!;
            const columnEnd = inColumn.find((i) => i !== columnIn)!;
            // The strings meet in one box, and both leave it.
            if (BOX[columnIn] !== b || BOX[rowEnd] === b || BOX[columnEnd] === b) continue;
            const step = chainStep(
              board,
              'twoStringKite',
              d as Digit,
              [rowEnd, rowIn, columnIn, columnEnd],
              [unitOf(r), unitOf(c), unitOf(18 + b)],
            );
            if (step) return step;
          }
        }
      }
    }
  }
  return null;
};

/** The longest XY-Chain looked for, in cells: longer ones are hard to follow by eye. */
export const MAX_XY_CHAIN = 6;

/**
 * Grow an XY-Chain from `cells` to `length` cells and apply the first that
 * removes something, or return null. Each cell is the digit `carried` would
 * leave it if the chain's first cell isn't `digit`; the next cell must see
 * the last, hold just two candidates, and include `carried`, which it then
 * can't be.
 */
function growXyChain(
  board: SolverBoard,
  cells: number[],
  carried: number,
  digit: Digit,
  length: number,
): SolveStep | null {
  for (const peer of PEERS[cells[cells.length - 1]]) {
    const mask = board.candidates[peer];
    if (POPCOUNT[mask] !== 2 || (mask & carried) === 0 || cells.includes(peer)) continue;
    const chain = [...cells, peer];
    const step =
      chain.length < length
        ? growXyChain(board, chain, mask & ~carried, digit, length)
        : (mask & ~carried) === bit(digit)
          ? xyChainStep(board, chain, digit)
          : null;
    if (step) return step;
  }
  return null;
}

/** An XY-Chain found and applied: its digit goes from every cell that sees both ends. */
function xyChainStep(board: SolverBoard, chain: readonly number[], digit: Digit): SolveStep | null {
  const [first, last] = [chain[0], chain[chain.length - 1]];
  const eliminations: Elimination[] = [];
  for (const t of PEERS[first]) {
    if (isPeer(last, t) && !chain.includes(t)) strike(board, eliminations, t, bit(digit));
  }
  return eliminationStep('xyChain', eliminations, null, () => ({
    pattern: patternOf(board, chain, ALL_DIGITS),
    houses: [],
    digit,
  }));
}

/**
 * XY-Chain: cells with just two candidates, each seeing the next and sharing
 * a digit with it, whose two ends both hold another digit, x. If the first
 * end isn't x, it is its other digit — which the next cell then can't be,
 * so that cell is its own other digit, and so on down the chain to the last
 * end, which is x. One end or the other is x, so x goes from every cell that
 * sees both.
 *
 * Shortest first, from four cells (three is an XY-Wing) to `MAX_XY_CHAIN`,
 * trying every chain of each length, so whether one is found doesn't depend
 * on where the scan starts.
 */
const xyChain: Technique = (board) => {
  for (let length = 4; length <= MAX_XY_CHAIN; length++) {
    for (let start = 0; start < 81; start++) {
      const mask = board.candidates[start];
      if (POPCOUNT[mask] !== 2) continue;
      for (const digit of digitsOf(mask)) {
        const step = growXyChain(board, [start], mask & ~bit(digit), digit, length);
        if (step) return step;
      }
    }
  }
  return null;
};

/**
 * W-Wing: two cells that don't see each other, each with the same two
 * candidates, x and y, and a house with just two places left for y, one seen
 * by each cell. One of those places is y, so the cell that sees it isn't —
 * and is x. One of the two cells is x, so x goes from every cell that sees
 * both.
 */
const wWing: Technique = (board) => {
  const { candidates } = board;
  for (let first = 0; first < 81; first++) {
    const mask = candidates[first];
    if (POPCOUNT[mask] !== 2) continue;
    for (let second = first + 1; second < 81; second++) {
      if (candidates[second] !== mask || isPeer(first, second)) continue;
      for (const y of digitsOf(mask)) {
        const x = lowestDigit(mask & ~bit(y));
        for (let u = 0; u < 27; u++) {
          const places = UNITS[u].filter((i) => (candidates[i] & bit(y)) !== 0);
          if (places.length !== 2 || places.includes(first) || places.includes(second)) continue;
          // Each cell has to see one of the places, a different one each.
          for (const [near, far] of [places, [places[1], places[0]]]) {
            if (!isPeer(first, near) || !isPeer(second, far)) continue;
            const chain = [first, near, far, second];
            const eliminations: Elimination[] = [];
            for (const t of PEERS[first]) {
              if (isPeer(second, t) && !chain.includes(t)) strike(board, eliminations, t, bit(x));
            }
            const step = eliminationStep('wWing', eliminations, null, () => ({
              pattern: [
                { index: first, mask },
                { index: near, mask: bit(y) },
                { index: far, mask: bit(y) },
                { index: second, mask },
              ],
              houses: [unitOf(u)],
              digit: x,
            }));
            if (step) return step;
          }
        }
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
  skyscraper,
  twoStringKite,
  xyChain,
  wWing,
};
