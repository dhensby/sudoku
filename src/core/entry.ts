import { MIN_GIVENS, checkGivens, type CheckOptions, type GivensProblem } from './codec';
import { rate } from './grader';
import { countFilled, gridValues, unitCells } from './grid';
import type { Digit, GridString, Puzzle, Unit, UnitKind, Values } from './types';

/*
 * Puzzles from outside the game: a link's, or one the player types in from
 * the paper (Enter a puzzle). Either way the givens are checked by
 * `checkGivens` and labelled by the grader, the one way (`puzzleFromGivens`),
 * so the player who typed a puzzle in and the friend who opens their link
 * can never see it labelled differently.
 *
 * Typed in, the givens are also assessed as they grow (`assessGivens`): what
 * stands between them and a puzzle to play, one thing at a time, for the
 * editor to say in a line; pasted in, they are read from the text copied
 * (`readGrid`). Nothing here is English.
 */

/** What the givens typed in so far make (see `assessGivens`). */
export type GivensAssessment =
  /** Not a number yet. */
  | { kind: 'empty' }
  /**
   * `count` of `digit` in `unit`: the first unit, rows then columns then
   * boxes (as `UNITS` holds them), to hold a number more than once.
   */
  | { kind: 'clash'; digit: Digit; unit: Unit; count: number }
  /** Fewer numbers than any puzzle with one solution has (`MIN_GIVENS`), none clashing. */
  | { kind: 'too-few' }
  /** Every cell filled, none clashing: a solution, with nothing left to solve. */
  | { kind: 'full' }
  /** More than one solution. */
  | { kind: 'multiple' }
  /** No solution, though no two numbers clash. */
  | { kind: 'none' }
  /** The search ran out of nodes before it could tell (see `checkGivens`). */
  | { kind: 'too-complex' }
  /** A puzzle with one solution, labelled as its link will be (see `puzzleFromGivens`). */
  | { kind: 'ok'; puzzle: Puzzle };

/** Each kind of unit, in the order `UNITS` holds them. */
const UNIT_KINDS: readonly UnitKind[] = ['row', 'column', 'box'];

/**
 * Givens from outside the game as a puzzle to play: checked (see
 * `checkGivens`), with the solution the check found, and labelled as the
 * grader rates them (see `rate`) — never as anything the outside world says
 * of them. A link opens through here, and a puzzle typed in is played from
 * here, so the two are always labelled alike.
 */
export function puzzleFromGivens(
  givens: string,
  options: CheckOptions = {},
): { ok: true; puzzle: Puzzle } | { ok: false; problem: GivensProblem } {
  const check = checkGivens(givens, options);
  if (!check.ok) return check;
  return {
    ok: true,
    puzzle: { givens, solution: check.solution, difficulty: rate(gridValues(givens)) },
  };
}

/**
 * The first unit, in `UNITS` order, to hold a number more than once: that
 * number — the first in the unit's reading order, should it hold two — and
 * how many times it holds it. Null when nothing clashes.
 */
function firstClash(values: Values): { digit: Digit; unit: Unit; count: number } | null {
  for (const kind of UNIT_KINDS) {
    for (let index = 0; index < 9; index++) {
      const unit: Unit = { kind, index };
      const cells = unitCells(unit);
      const counts = new Uint8Array(10);
      for (const cell of cells) counts[values[cell]]++;
      for (const cell of cells) {
        const digit = values[cell];
        if (digit !== 0 && counts[digit] > 1) {
          return { digit: digit as Digit, unit, count: counts[digit] };
        }
      }
    }
  }
  return null;
}

/**
 * What the givens typed in so far make — the first of these that holds:
 *   1. no numbers yet: 'empty';
 *   2. a number twice in a row, column or box: 'clash', for the first such
 *      unit — whatever else is wrong, and however few numbers there are, as
 *      it is the mistake to put right first;
 *   3. fewer than `MIN_GIVENS`: 'too-few';
 *   4. every cell filled: 'full';
 *   5. more than one solution, none, or a search that ran out of nodes
 *      before it could tell (see `checkGivens`): 'multiple', 'none' or
 *      'too-complex';
 *   6. otherwise 'ok', with the puzzle, labelled as its link will be.
 * Quick enough to run as every number goes in: the search, bounded as
 * `checkGivens` bounds it, runs only once the rest have passed, and the
 * grading only for a single solution.
 */
export function assessGivens(cells: GridString, options: CheckOptions = {}): GivensAssessment {
  const values = gridValues(cells);
  const count = countFilled(values);
  if (count === 0) return { kind: 'empty' };
  const clash = firstClash(values);
  if (clash !== null) return { kind: 'clash', ...clash };
  if (count < MIN_GIVENS) return { kind: 'too-few' };
  if (count === 81) return { kind: 'full' };
  const opened = puzzleFromGivens(cells, options);
  if (opened.ok) return { kind: 'ok', puzzle: opened.puzzle };
  // Givens typed in are always well formed, and the checks above are the
  // rest `checkGivens` makes before it searches: what it reports is the
  // search's answer.
  if (opened.problem === 'multiple-solutions') return { kind: 'multiple' };
  if (opened.problem === 'no-solution') return { kind: 'none' };
  return { kind: 'too-complex' };
}

/**
 * The grid in text pasted into the editor: its digits in reading order, a 0
 * or a dot for each blank cell, and everything else — the spaces, line
 * breaks, bars and dashes a grid is laid out with — passed over; null unless
 * exactly 81 cells are left. So a grid copied from a page or a file reads as
 * it is laid out, on one line or nine, and text that leaves any other count —
 * a grid under a numbered heading, a link — reads as none: only a grid
 * written out is read, never a link's code. What the grid makes, clashes and
 * all, is `assessGivens`'s to say.
 */
export function readGrid(text: string): GridString | null {
  const cells = text.replace(/[^0-9.]/g, '');
  return cells.length === 81 ? cells.replaceAll('.', '0') : null;
}
