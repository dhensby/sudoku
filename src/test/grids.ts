/*
 * Shared fixture grids for tests. Written as 9-line layouts (`.` for empty,
 * spaces between boxes for legibility) and parsed with `parseGrid`.
 */

/** The puzzle from Wikipedia's Sudoku article: unique, and solvable with singles. */
export const WIKIPEDIA_PUZZLE = `
  53. .7. ...
  6.. 195 ...
  .98 ... .6.
  8.. .6. ..3
  4.. 8.3 ..1
  7.. .2. ..6
  .6. ... 28.
  ... 419 ..5
  ... .8. .79
`;

/** Its unique solution. */
export const WIKIPEDIA_SOLUTION = `
  534 678 912
  672 195 348
  198 342 567
  859 761 423
  426 853 791
  713 924 856
  961 537 284
  287 419 635
  345 286 179
`;

/** A grid with no givens at all: valid, and wildly non-unique. */
export const EMPTY_GRID = '.'.repeat(81);

/**
 * 17 clash-free givens with no solution, built to need a search deeper than
 * `checkGivens` allows, which calls it too complex: 1, 2 and 3 can only go in
 * r0c0 and r0c1 of the top-left box — three digits, two cells. Singles alone
 * never see that, so the search must branch until it trips over it.
 */
export const THREE_DIGITS_TWO_CELLS = `
  ... ... ...
  ... 12. 3..
  ... ..3 .12
  4.1 .9. ...
  ..2 ... .3.
  ... ... 6..
  ..3 .7. ...
  .97 5.. ...
  ... ... ...
`;
