import {
  ALL_DIGITS,
  PEERS,
  POPCOUNT,
  UNITS,
  bit,
  countFilled,
  findConflicts,
  formatGrid,
  gridValues,
  isGridString,
  lowestDigit,
} from './grid';
import type { GridString } from './types';

/*
 * Share codes: a puzzle's givens packed into a short URL-safe string.
 *
 * The givens become one big number, `(digits << 81) | mask`. The low 81 bits
 * are a mask of which cells hold a given; above them sit the given digits in
 * reading order as a base-9 number (digit d stored as d - 1), the first given
 * most significant. Nothing else is needed — the solution and the tier are
 * recomputed on arrival, and a link never gets to vouch for either.
 *
 * The number is written in base64url, most significant character first.
 * That comes to at most 23 characters at the 17-given minimum, about 25–30
 * for the minimal Medium/Hard/Expert puzzles, 34 for a 38-given Easy and at
 * most 57 for a complete grid — short enough to paste anywhere, and illegible
 * enough not to spoil the puzzle at a glance.
 *
 * Decoding is strict, because codes arrive from the outside world: the format
 * is a bijection between non-empty grids and their canonical codes, so
 * anything that is not exactly what `encodeGivens` would write is refused
 * rather than repaired. Strictness only goes so far — a code that has lost a
 * character from its end can still spell some other grid — which is why a
 * decoded puzzle goes through `checkGivens` before anyone plays it.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 1–64 base64url characters. The longest real code is 57 characters (all 81
 * cells given); the cap stops an absurd string from costing a big-number parse
 * before it is turned away, and anything between 58 and 64 is caught by the
 * leftover-digit check anyway.
 */
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const POSITION_BITS = 81n;
const POSITION_MASK = (1n << POSITION_BITS) - 1n;

/** Each alphabet character's value. Every character reaching it has passed `CODE_PATTERN`. */
const CHAR_VALUE = new Map<string, bigint>([...ALPHABET].map((ch, i) => [ch, BigInt(i)]));

/** The fewest givens a uniquely solvable Sudoku can have (McGuire, Tugemann & Civario, 2012). */
const MIN_GIVENS = 17;

/**
 * Compact base64url (A–Z a–z 0–9 - _) code for a puzzle's givens:
 * BigInt `(digitsBase9 << 81) | positionMask`. 25–34 characters for the
 * puzzles the generator makes; see the module comment for the extremes.
 *
 * Throws for anything but a `GridString` with at least one given — a
 * programmer error, as no puzzle the game holds can be either.
 */
export function encodeGivens(givens: GridString): string {
  if (!isGridString(givens) || /^0+$/.test(givens)) {
    throw new Error('Expected an 81-digit grid string with at least one given');
  }
  let mask = 0n;
  let digits = 0n;
  for (let i = 0; i < 81; i++) {
    const digit = givens.charCodeAt(i) - 48;
    if (digit === 0) continue;
    mask |= 1n << BigInt(i);
    digits = digits * 9n + BigInt(digit - 1);
  }
  let n = (digits << POSITION_BITS) | mask;
  let code = '';
  do {
    code = ALPHABET[Number(n & 63n)] + code;
    n >>= 6n;
  } while (n > 0n);
  return code;
}

/**
 * Whether a string is shaped like a share code: 1–64 base64url characters,
 * with no padding `A` in front — the checks `decodeGivens` makes before its
 * big-number parse. Cheap enough to run over thousands of stored codes; one
 * that passes may still fail to decode.
 */
export function looksLikeShareCode(code: string): boolean {
  return CODE_PATTERN.test(code) && code[0] !== 'A';
}

/**
 * The givens back, or null if the code is malformed.
 *
 * Refused: the empty string; any character outside the base64url alphabet
 * (including the `=` padding and the `+`/`/` of plain base64); more than 64
 * characters; a leading `A` (a zero digit `encodeGivens` never writes, so the
 * code has been padded); a mask with no positions; and digit data left over
 * once every position has taken its digit (characters added to the front, or
 * a mask whose positions cannot hold all the digits above it). There is no
 * separate check for bits beyond the 81 positions: by construction every bit
 * above them is digit data, so an over-long code fails the leftover check.
 */
export function decodeGivens(code: string): GridString | null {
  if (!looksLikeShareCode(code)) return null;
  let n = 0n;
  for (const ch of code) n = (n << 6n) | CHAR_VALUE.get(ch)!;

  const mask = n & POSITION_MASK;
  if (mask === 0n) return null;
  let digits = n >> POSITION_BITS;

  // The last given is the least significant digit, so peel them off from the
  // end of the grid backwards.
  const cells = new Array<string>(81).fill('0');
  for (let i = 80; i >= 0; i--) {
    if (((mask >> BigInt(i)) & 1n) === 0n) continue;
    cells[i] = String(Number(digits % 9n) + 1);
    digits /= 9n;
  }
  return digits === 0n ? cells.join('') : null;
}

// ---------------------------------------------------------------------------
// Checking givens from the outside world
// ---------------------------------------------------------------------------

/*
 * Givens from a link are checked by a search of their own rather than by
 * `solver.ts`. That solver is built for throughput on grids the generator
 * made: plain backtracking with no propagation, which notices a dead end only
 * once some cell runs out of candidates. A link can be crafted to exploit
 * that — 17 clash-free givens that leave, say, no room for a 1 in one box,
 * while every cell still has candidates — and it then searches the rest of
 * the grid before giving up. One such link measured 6.6 s, another over two
 * minutes, and the check runs on the main thread the moment the link opens.
 *
 * So this search propagates singles at every node — a cell with one candidate
 * takes it, and so does the only cell in a unit that can hold a digit — and
 * treats a unit with no room for a digit as a dead end straight away. That
 * settles real puzzles in a handful of nodes (at most ~110 for every NYT
 * puzzle we have, under 900 for the hardest known, such as Platinum Blonde
 * and Easter Monster). And because no amount of propagation stops a
 * determined adversary hiding a contradiction one step further away, the
 * whole search has a node budget too, which bounds the cost of any input to
 * tens of milliseconds.
 */

/**
 * The search nodes `checkGivens` may spend: over ten times what the hardest
 * known puzzles need. A grid that runs out is reported as 'too-complex'.
 */
const MAX_SEARCH_NODES = 10_000;

/** Why a set of givens from the outside world cannot be played. */
export type GivensProblem =
  | 'malformed'
  | 'too-few-givens'
  | 'clash'
  | 'no-solution'
  | 'multiple-solutions'
  /** The search ran out of nodes before it could tell. Only contrived grids get here. */
  | 'too-complex';

/** Tuning for `checkGivens`. */
export interface CheckOptions {
  /** Search nodes to spend before giving up (default 10,000). A test seam, mostly. */
  maxNodes?: number;
}

// Search state, in module scope like `solver.ts`'s and reset by every call.
let nodesLeft = 0;
let isOutOfNodes = false;
let solutionCount = 0;
let firstSolution: Uint16Array | null = null;

/**
 * Put a digit (as its mask bit) in a cell and strike it from every peer,
 * following through any peer that this leaves with a single candidate. False
 * if a peer is left with none.
 */
function assign(candidates: Uint16Array, cell: number, digitBit: number): boolean {
  candidates[cell] = digitBit;
  for (const peer of PEERS[cell]) {
    const mask = candidates[peer];
    if ((mask & digitBit) === 0) continue;
    const rest = mask & ~digitBit;
    if (rest === 0) return false;
    candidates[peer] = rest;
    if (POPCOUNT[rest] === 1 && !assign(candidates, peer, rest)) return false;
  }
  return true;
}

/**
 * Place hidden singles until none are left. False on a contradiction: a unit
 * with no room for one of its digits, or a cell that is the only place for two.
 * (`assign` has already followed every naked single.)
 */
function settle(candidates: Uint16Array): boolean {
  for (let isChanged = true; isChanged;) {
    isChanged = false;
    for (const unit of UNITS) {
      let once = 0;
      let twice = 0;
      for (const cell of unit) {
        twice |= once & candidates[cell];
        once |= candidates[cell];
      }
      if (once !== ALL_DIGITS) return false;
      const loners = once & ~twice;
      if (loners === 0) continue;
      for (const cell of unit) {
        const mask = candidates[cell] & loners;
        if (mask === 0) continue;
        if (POPCOUNT[mask] > 1) return false;
        if (mask === candidates[cell]) continue;
        if (!assign(candidates, cell, mask)) return false;
        isChanged = true;
      }
    }
  }
  return true;
}

/** Count solutions below `candidates` (stopping at two), branching on the cell with fewest candidates. */
function search(candidates: Uint16Array): void {
  if (!settle(candidates)) return;
  let cell = -1;
  let fewest = 10;
  for (let i = 0; i < 81; i++) {
    const count = POPCOUNT[candidates[i]];
    if (count > 1 && count < fewest) {
      cell = i;
      fewest = count;
      if (count === 2) break;
    }
  }
  if (cell === -1) {
    solutionCount++;
    firstSolution ??= candidates;
    return;
  }
  for (let mask = candidates[cell]; mask !== 0 && solutionCount < 2;) {
    if (nodesLeft === 0) {
      isOutOfNodes = true;
      return;
    }
    nodesLeft--;
    const digitBit = mask & -mask;
    mask ^= digitBit;
    const next = candidates.slice();
    if (assign(next, cell, digitBit)) search(next);
  }
}

/**
 * Validate givens from the outside world: a well-formed `GridString` with at
 * least 17 givens, no two of them clashing, and exactly one solution — which
 * is returned, so the caller never has to solve the puzzle a second time.
 *
 * The checks run cheapest first. A clash would also come out of the search as
 * "no solution"; it is reported separately because it is the likelier sign of
 * a hand-edited link. The search is bounded (see above), so a grid built to
 * be expensive is refused as 'too-complex' in tens of milliseconds.
 */
export function checkGivens(
  givens: string,
  options: CheckOptions = {},
): { ok: true; solution: GridString } | { ok: false; problem: GivensProblem } {
  if (!isGridString(givens)) return { ok: false, problem: 'malformed' };
  const values = gridValues(givens);
  if (countFilled(values) < MIN_GIVENS) return { ok: false, problem: 'too-few-givens' };
  if (findConflicts(values).some(Boolean)) return { ok: false, problem: 'clash' };

  nodesLeft = options.maxNodes ?? MAX_SEARCH_NODES;
  isOutOfNodes = false;
  solutionCount = 0;
  firstSolution = null;
  const candidates = new Uint16Array(81).fill(ALL_DIGITS);
  let isConsistent = true;
  for (let i = 0; i < 81 && isConsistent; i++) {
    if (values[i] === 0) continue;
    // A given its peers have already ruled out (through a chain of naked
    // singles from the other givens) makes the grid unsolvable.
    const digitBit = bit(values[i]);
    isConsistent = (candidates[i] & digitBit) !== 0 && assign(candidates, i, digitBit);
  }
  if (isConsistent) search(candidates);
  const solution = firstSolution;
  firstSolution = null; // nothing to keep alive between calls

  if (solutionCount > 1) return { ok: false, problem: 'multiple-solutions' };
  if (isOutOfNodes) return { ok: false, problem: 'too-complex' };
  if (solution === null) return { ok: false, problem: 'no-solution' };
  return { ok: true, solution: formatGrid(Array.from(solution, lowestDigit)) };
}
