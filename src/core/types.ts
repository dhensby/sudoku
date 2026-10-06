/** A Sudoku digit. Bitmasks elsewhere use bit `d - 1` for digit `d`. */
export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * The four puzzle tiers. Easy, Medium and Hard are calibrated against the NYT
 * puzzles of the same names; Expert goes past them into fish, wings and chains.
 */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

/**
 * A whole grid as an 81-character string in row-major order: '1'–'9' for a
 * digit and '0' for an empty cell. This is the form puzzles are stored, keyed
 * and compared in — strings are immutable, cheap to compare and survive JSON.
 */
export type GridString = string;

/**
 * Cell values as numbers in row-major order, 0 for empty. Algorithms take any
 * array-like so callers can pass a `Uint8Array` scratch buffer or a plain array.
 */
export type Values = ArrayLike<number>;

/** A playable puzzle: its givens, its unique solution and the tier it was graded at. */
export interface Puzzle {
  givens: GridString;
  solution: GridString;
  difficulty: Difficulty;
}

/**
 * The logical techniques the grader knows, in the order it tries them —
 * easiest first. The tier a technique belongs to lives in `TECHNIQUE_TIER`.
 */
export type TechniqueId =
  | 'fullHouse'
  | 'hiddenSingleBox'
  | 'hiddenSingleLine'
  | 'nakedSingle'
  | 'pointing'
  | 'claiming'
  | 'nakedPair'
  | 'hiddenPair'
  | 'nakedTriple'
  | 'hiddenTriple'
  | 'xWing'
  | 'swordfish'
  | 'xyWing'
  | 'xyzWing'
  | 'skyscraper'
  | 'twoStringKite'
  | 'xyChain'
  | 'wWing'
  | 'alternatingChain';

/** Which kind of unit a row/column/box index refers to. */
export type UnitKind = 'row' | 'column' | 'box';

/** A row, column or box, each numbered 0–8 (boxes in reading order). */
export interface Unit {
  kind: UnitKind;
  index: number;
}

/** The single-placement techniques, which a hint can point straight at. */
export type SingleTechniqueId = Extract<
  TechniqueId,
  'fullHouse' | 'hiddenSingleBox' | 'hiddenSingleLine' | 'nakedSingle'
>;

/**
 * What the Hint button found. Produced by `findHint` from the board as it
 * stands; the reducer only records it. Language-free on purpose — the UI turns
 * it into words.
 */
export type Hint =
  /** A placed value disagrees with the solution. Pointed at before anything else. */
  | { kind: 'mistake'; index: number }
  /**
   * A cell that can be filled right now from the placed digits alone. `unit` is
   * the row, column or box the single lives in (null for a naked single, which
   * is about the cell itself).
   */
  | { kind: 'single'; index: number; technique: SingleTechniqueId; unit: Unit | null }
  /**
   * No single is available yet: `index` is the next cell a logical solve fills,
   * and `technique` the hardest step needed to get there (null when the board is
   * beyond the techniques the grader knows).
   */
  | { kind: 'deduction'; index: number; technique: TechniqueId | null }
  /** Nothing to suggest — the board is already complete. */
  | { kind: 'none' };

/**
 * Help a player took during a game. Recorded so that times can be compared
 * fairly: a share link and the history both say what help a time came with.
 */
export interface Assists {
  /** Whether auto-candidate mode was ever switched on during this game. */
  autoCandidates: boolean;
  /** How many hints were shown. */
  hints: number;
  /** How many check-cell / check-puzzle actions found something to check. */
  checks: number;
  /** How many cells were revealed. A game with reveals never sets a best time. */
  reveals: number;
}
