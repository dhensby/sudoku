import { TECHNIQUE_ORDER } from './grader';
import { ALL_DIGITS, bit, computeCandidates, isPeer, parseGrid } from './grid';
import {
  MAX_XY_CHAIN,
  TECHNIQUES,
  cloneBoard,
  createBoard,
  eliminate,
  place,
  type Elimination,
  type PatternCell,
  type SolveStep,
  type SolverBoard,
  type Technique,
} from './techniques';
import type { Digit, TechniqueId, Unit } from './types';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import {
  HARDEST,
  checkSoundness,
  minimalPuzzles,
  pencilmarks,
  solvedPuzzle,
} from '../test/logic-fixtures';

const row = (index: number): Unit => ({ kind: 'row', index });
const column = (index: number): Unit => ({ kind: 'column', index });
const box = (index: number): Unit => ({ kind: 'box', index });

/** The same digits in each of `indices`, as cell masks. */
function cellMasks(digits: number[], indices: number[]): { index: number; mask: number }[] {
  const mask = digits.reduce((m, d) => m | bit(d), 0);
  return indices.map((index) => ({ index, mask }));
}

/** The same digits struck from each of `indices`. */
const struck: (digits: number[], indices: number[]) => Elimination[] = cellMasks;

/** The same digits held by each of `indices`, as pattern cells. */
const holding: (digits: number[], indices: number[]) => PatternCell[] = cellMasks;

/** What lies behind an elimination step. */
interface Behind {
  pattern: PatternCell[];
  houses: Unit[];
  digit: Digit | null;
}

function eliminationStep(
  technique: TechniqueId,
  eliminations: Elimination[],
  unit: Unit | null,
  behind: Behind,
): SolveStep {
  return { technique, placement: null, eliminations, unit, ...behind };
}

/** A single: its pattern is the cell and the digit, its houses the one it lives in (if any). */
function placementStep(
  technique: TechniqueId,
  index: number,
  digit: Digit,
  unit: Unit | null,
): SolveStep {
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

/** A row of nine open cells, to keep layouts down to the cells that matter. */
const OPEN = '. . . | . . . | . . .';

/** A board for the Wikipedia solution with the listed cells emptied again. */
function solutionWithGaps(...gaps: number[]): SolverBoard {
  const values = parseGrid(WIKIPEDIA_SOLUTION);
  for (const i of gaps) values[i] = 0;
  return createBoard(values);
}

describe('board helpers', () => {
  it('starts from the naked candidates of the placed digits, on its own copy of the values', () => {
    const values = parseGrid(WIKIPEDIA_PUZZLE);
    const board = createBoard(values);
    expect(board.values).toEqual(values);
    expect(board.values).not.toBe(values);
    expect(board.candidates).toEqual(computeCandidates(values));
  });

  it('accepts plain arrays', () => {
    expect(createBoard(Array.from(parseGrid(WIKIPEDIA_PUZZLE))).values).toEqual(
      parseGrid(WIKIPEDIA_PUZZLE),
    );
  });

  it('clones a board so the copy can be changed independently', () => {
    const board = createBoard(parseGrid(WIKIPEDIA_PUZZLE));
    const copy = cloneBoard(board);
    place(copy, 2, 4);
    expect(board.values[2]).toBe(0);
    expect(board.candidates[2]).not.toBe(0);
  });

  it('places a digit, clearing the cell and striking the digit from every peer', () => {
    const board = pencilmarks(Array(81).fill('.').join(' '));
    place(board, 40, 7);
    expect(board.values[40]).toBe(7);
    expect(board.candidates[40]).toBe(0);
    for (let i = 0; i < 81; i++) {
      if (i === 40) continue;
      expect(board.candidates[i]).toBe(isPeer(40, i) ? ALL_DIGITS & ~bit(7) : ALL_DIGITS);
    }
  });

  it('eliminates only the candidates that are there, and says which went', () => {
    const board = pencilmarks(`127 ${Array(80).fill('.').join(' ')}`);
    expect(eliminate(board, 0, bit(2) | bit(5))).toBe(bit(2));
    expect(board.candidates[0]).toBe(bit(1) | bit(7));
    // Nothing left to remove: a no-op, reported as such.
    expect(eliminate(board, 0, bit(2))).toBe(0);
    expect(board.candidates[0]).toBe(bit(1) | bit(7));
  });
});

describe('fullHouse', () => {
  it('fills the one gap in a row', () => {
    const board = solutionWithGaps(40);
    expect(TECHNIQUES.fullHouse(board)).toEqual(placementStep('fullHouse', 40, 5, row(4)));
    expect(board.values[40]).toBe(5);
  });

  it('names the first unit, in scan order, that has a single gap', () => {
    // Row 0 has two gaps, but column 0 has only one.
    expect(TECHNIQUES.fullHouse(solutionWithGaps(0, 1))).toEqual(
      placementStep('fullHouse', 0, 5, column(0)),
    );
    // Rows 0 and 3 and columns 0 and 3 each have two gaps; box 0 has one.
    expect(TECHNIQUES.fullHouse(solutionWithGaps(0, 3, 27, 30))).toEqual(
      placementStep('fullHouse', 0, 5, box(0)),
    );
  });

  it('does not fire while every unit has at least two gaps', () => {
    const board = solutionWithGaps(0, 1, 9, 10);
    const before = cloneBoard(board);
    expect(TECHNIQUES.fullHouse(board)).toBeNull();
    expect(board).toEqual(before);
  });

  it('places nothing when the last cell has no single candidate on a contradictory board', () => {
    const board = solutionWithGaps(40);
    board.candidates[40] = 0;
    expect(TECHNIQUES.fullHouse(board)).toBeNull();
    board.candidates[40] = bit(5) | bit(6);
    expect(TECHNIQUES.fullHouse(board)).toBeNull();
  });
});

describe('hidden singles', () => {
  // 1s in rows 1 and 2 and columns 1 and 2 leave r0c0 as the only place for a
  // 1 in box 0.
  const BOX_SINGLE = `
    ... ... ...
    ... 1.. ...
    ... ... 1..
    .1. ... ...
    ... ... ...
    ... ... ...
    ..1 ... ...
    ... ... ...
    ... ... ...
  `;

  // Row 0 is filled from c3 and columns 1 and 2 hold 1s lower down, so r0c0 is
  // the only place for a 1 in row 0 — yet box 0 still has three.
  const LINE_SINGLE = `
    ... 234 567
    ... ... ...
    ... ... ...
    ... ... ...
    .1. ... ...
    ... ... ...
    ... ... ...
    ..1 ... ...
    ... ... ...
  `;

  it('finds a digit with one place left in a box', () => {
    const board = createBoard(parseGrid(BOX_SINGLE));
    expect(TECHNIQUES.hiddenSingleBox(board)).toEqual(
      placementStep('hiddenSingleBox', 0, 1, box(0)),
    );
  });

  it('does not fire when the box still has two places for the digit', () => {
    // Without the 1 in column 2, r0c2 is open too.
    const values = parseGrid(BOX_SINGLE);
    values[56] = 0;
    expect(TECHNIQUES.hiddenSingleBox(createBoard(values))).toBeNull();
  });

  it('finds a hidden single in a row that no box shows', () => {
    const board = createBoard(parseGrid(LINE_SINGLE));
    expect(TECHNIQUES.hiddenSingleBox(board)).toBeNull();
    expect(TECHNIQUES.hiddenSingleLine(board)).toEqual(
      placementStep('hiddenSingleLine', 0, 1, row(0)),
    );
  });

  it('does not fire when the row still has two places for the digit', () => {
    const values = parseGrid(LINE_SINGLE);
    values[65] = 0;
    expect(TECHNIQUES.hiddenSingleLine(createBoard(values))).toBeNull();
  });
});

describe('nakedSingle', () => {
  // r0c0 sees 1–4 in its row, 5–7 in its column and 8 in its box: only 9 fits.
  const NAKED = `
    .12 34. ...
    .8. ... ...
    ... ... ...
    5.. ... ...
    6.. ... ...
    7.. ... ...
    ... ... ...
    ... ... ...
    ... ... ...
  `;

  it('fills a cell with one candidate left', () => {
    expect(TECHNIQUES.nakedSingle(createBoard(parseGrid(NAKED)))).toEqual(
      placementStep('nakedSingle', 0, 9, null),
    );
  });

  it('does not fire on a cell with two', () => {
    const values = parseGrid(NAKED);
    values[10] = 0;
    expect(TECHNIQUES.nakedSingle(createBoard(values))).toBeNull();
  });
});

describe('pointing', () => {
  it('removes a digit from the rest of a row when a box confines it there', () => {
    // In box 0, 5 can only go in r0c0 or r0c1.
    const board = pencilmarks(`
      .  .  -5 | . . . | . . .
      -5 -5 -5 | . . . | . . .
      -5 -5 -5 | . . . | . . .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.pointing(board)).toEqual(
      eliminationStep('pointing', struck([5], [3, 4, 5, 6, 7, 8]), box(0), {
        pattern: holding([5], [0, 1]),
        houses: [box(0), row(0)],
        digit: 5,
      }),
    );
    expect(board.candidates[3]).toBe(ALL_DIGITS & ~bit(5));
  });

  it('removes a digit from the rest of a column when a box confines it there', () => {
    const board = pencilmarks(`
      . -5 -5 | . . . | . . .
      . -5 -5 | . . . | . . .
      -5 -5 -5 | . . . | . . .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.pointing(board)).toEqual(
      eliminationStep('pointing', struck([5], [27, 36, 45, 54, 63, 72]), box(0), {
        pattern: holding([5], [0, 9]),
        houses: [box(0), column(0)],
        digit: 5,
      }),
    );
  });

  it('leaves a lone cell to the hidden singles', () => {
    // 5 has one place in box 0: a hidden single, not a pointing "pair".
    const board = pencilmarks(`
      .  -5 -5 | . . . | . . .
      -5 -5 -5 | . . . | . . .
      -5 -5 -5 | . . . | . . .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.pointing(board)).toBeNull();
  });

  it('does not fire when the candidates span two rows and two columns', () => {
    const board = pencilmarks(`
      .  -5 -5 | . . . | . . .
      -5 .  -5 | . . . | . . .
      -5 -5 -5 | . . . | . . .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.pointing(board)).toBeNull();
  });

  it('skips a pattern with nothing to remove and keeps looking', () => {
    // Box 0 points along row 0, but row 0 has no other 5 to remove. Box 4
    // points along row 4, which does.
    const board = pencilmarks(`
      .  .  -5 | -5 -5 -5 | -5 -5 -5
      -5 -5 -5 | .  .  .  | .  .  .
      -5 -5 -5 | .  .  .  | .  .  .
      .  .  .  | -5 -5 -5 | .  .  .
      .  .  .  | .  .  -5 | .  .  .
      .  .  .  | -5 -5 -5 | .  .  .
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.pointing(board)).toEqual(
      eliminationStep('pointing', struck([5], [36, 37, 38, 42, 43, 44]), box(4), {
        pattern: holding([5], [39, 40]),
        houses: [box(4), row(4)],
        digit: 5,
      }),
    );
  });
});

describe('claiming', () => {
  it('removes a digit from the rest of a box when a row confines it there', () => {
    // In row 0, 5 can only go in r0c0 or r0c1 — both in box 0.
    const board = pencilmarks(`
      . . -5 | -5 -5 -5 | -5 -5 -5
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.claiming(board)).toEqual(
      eliminationStep('claiming', struck([5], [9, 10, 11, 18, 19, 20]), row(0), {
        pattern: holding([5], [0, 1]),
        houses: [row(0), box(0)],
        digit: 5,
      }),
    );
  });

  it('removes a digit from the rest of a box when a column confines it there', () => {
    const board = pencilmarks(`
      .  . . | . . . | . . .
      .  . . | . . . | . . .
      -5 . . | . . . | . . .
      -5 . . | . . . | . . .
      -5 . . | . . . | . . .
      -5 . . | . . . | . . .
      -5 . . | . . . | . . .
      -5 . . | . . . | . . .
      -5 . . | . . . | . . .
    `);
    expect(TECHNIQUES.claiming(board)).toEqual(
      eliminationStep('claiming', struck([5], [1, 2, 10, 11, 19, 20]), column(0), {
        pattern: holding([5], [0, 9]),
        houses: [column(0), box(0)],
        digit: 5,
      }),
    );
  });

  it('does not fire when the line reaches into two boxes', () => {
    const board = pencilmarks(`
      . -5 -5 | -5 . -5 | -5 -5 -5
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.claiming(board)).toBeNull();
  });

  it('leaves a lone cell to the hidden singles', () => {
    const board = pencilmarks(`
      . -5 -5 | -5 -5 -5 | -5 -5 -5
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.claiming(board)).toBeNull();
  });

  it('never counts a claim that removes nothing', () => {
    const board = pencilmarks(`
      .  .  -5 | -5 -5 -5 | -5 -5 -5
      -5 -5 -5 | .  .  .  | .  .  .
      -5 -5 -5 | .  .  .  | .  .  .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.claiming(board)).toBeNull();
  });
});

describe('naked subsets', () => {
  it('finds a naked pair and clears its digits from the rest of the row', () => {
    const board = pencilmarks(`
      12 . . | . 12 . | . . .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.nakedPair(board)).toEqual(
      eliminationStep('nakedPair', struck([1, 2], [1, 2, 3, 5, 6, 7, 8]), row(0), {
        pattern: holding([1, 2], [0, 4]),
        houses: [row(0)],
        digit: null,
      }),
    );
  });

  it('does not take two cells covering three digits for a pair', () => {
    const board = pencilmarks(`
      12 . . | . 13 . | . . .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.nakedPair(board)).toBeNull();
  });

  it('never counts a pair that removes nothing', () => {
    const board = pencilmarks(`
      12 -12 -12 | -12 12 -12 | -12 -12 -12
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.nakedPair(board)).toBeNull();
  });

  it('does not build a pair around a naked single', () => {
    // {1} and {1, 2} cover two digits, but the first cell is a single.
    const board = pencilmarks(`
      1 . . | . 12 . | . . .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.nakedPair(board)).toBeNull();
  });

  it('never treats the whole remainder of a unit as a subset', () => {
    // Row 0's two empty cells hold {1, 2} between them — trivially. The step
    // found is the same pair seen in box 0, where it does say something.
    const board = pencilmarks(`
      12 12 =3 | =4 =5 =6 | =7 =8 =9
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.nakedPair(board)).toEqual(
      eliminationStep('nakedPair', struck([1, 2], [9, 10, 11, 18, 19, 20]), box(0), {
        pattern: holding([1, 2], [0, 1]),
        houses: [box(0)],
        digit: null,
      }),
    );
  });

  it('finds a naked triple whose cells hold only two of its digits each', () => {
    const board = pencilmarks(`
      12 . . | . 23 . | . . 13
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.nakedTriple(board)).toEqual(
      eliminationStep('nakedTriple', struck([1, 2, 3], [1, 2, 3, 5, 6, 7]), row(0), {
        // Each cell with the digits it actually holds — none holds all three.
        pattern: [...holding([1, 2], [0]), ...holding([2, 3], [4]), ...holding([1, 3], [8])],
        houses: [row(0)],
        digit: null,
      }),
    );
  });

  it('does not take three cells covering four digits for a triple', () => {
    const board = pencilmarks(`
      12 . . | . 23 . | . . 14
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.nakedTriple(board)).toBeNull();
  });

  it('never counts a triple that removes nothing', () => {
    const board = pencilmarks(`
      12 -123 -123 | -123 23 -123 | -123 -123 13
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.nakedTriple(board)).toBeNull();
  });
});

describe('hidden subsets', () => {
  it('finds a hidden pair and clears every other candidate from its cells', () => {
    // 1 and 2 can only go in r0c0 and r0c4.
    const board = pencilmarks(`
      . -12 -12 | -12 . -12 | -12 -12 -12
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.hiddenPair(board)).toEqual(
      eliminationStep('hiddenPair', struck([3, 4, 5, 6, 7, 8, 9], [0, 4]), row(0), {
        // Just the pair's digits: the rest is what goes.
        pattern: holding([1, 2], [0, 4]),
        houses: [row(0)],
        digit: null,
      }),
    );
  });

  it('does not fire when one of the digits has a third place', () => {
    const board = pencilmarks(`
      . -12 -12 | -12 . -12 | -12 -12 -1
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.hiddenPair(board)).toBeNull();
  });

  it('does not build a hidden pair around a hidden single', () => {
    // 1 can only go in r0c0 and 2 in r0c0 or r0c4: two digits in two cells,
    // but the 1 is a hidden single, and counting it as a pair would rate the
    // puzzle harder than it is.
    const board = pencilmarks(`
      . -12 -12 | -12 -1 -12 | -12 -12 -12
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.hiddenPair(board)).toBeNull();
  });

  it('never counts a hidden pair that is already naked', () => {
    const board = pencilmarks(`
      12 -12 -12 | -12 12 -12 | -12 -12 -12
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.hiddenPair(board)).toBeNull();
  });

  it('never treats the whole remainder of a unit as a subset', () => {
    // An inconsistent board on purpose: with only two empty cells, 1 and 2
    // "can only go" there, and treating that as a hidden pair would strike
    // the stray 8 and 9.
    const board = pencilmarks(`
      128 129 =3 | =4 =5 =6 | =7 =8 =9
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.hiddenPair(board)).toBeNull();
  });

  it('finds a hidden triple whose digits have only two places each', () => {
    // 1 can go in c0/c4, 2 in c4/c8 and 3 in c0/c8.
    const board = pencilmarks(`
      -2 -123 -123 | -123 -3 -123 | -123 -123 -1
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.hiddenTriple(board)).toEqual(
      eliminationStep('hiddenTriple', struck([4, 5, 6, 7, 8, 9], [0, 4, 8]), row(0), {
        pattern: [...holding([1, 3], [0]), ...holding([1, 2], [4]), ...holding([2, 3], [8])],
        houses: [row(0)],
        digit: null,
      }),
    );
  });

  it('does not fire when the digits spread over four cells', () => {
    const board = pencilmarks(`
      -2 -23 -123 | -123 -3 -123 | -123 -123 -1
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.hiddenTriple(board)).toBeNull();
  });

  it('never counts a hidden triple that is already naked', () => {
    const board = pencilmarks(`
      13 -123 -123 | -123 12 -123 | -123 -123 23
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.hiddenTriple(board)).toBeNull();
  });

  it('never treats the three last cells of a unit as a hidden triple', () => {
    // Inconsistent on purpose, as for the pair: the stray 7, 8 and 9 would go.
    const board = pencilmarks(`
      1237 1238 1239 | =4 =5 =6 | =7 =8 =9
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
    `);
    expect(TECHNIQUES.hiddenTriple(board)).toBeNull();
  });
});

describe('fish', () => {
  // Rows 1 and 7 can only hold a 1 in columns 1 and 7.
  const X_WING_ROWS = `
    ${OPEN}
    -1 . -1 | -1 -1 -1 | -1 . -1
    ${OPEN}
    ${OPEN}
    ${OPEN}
    ${OPEN}
    ${OPEN}
    -1 . -1 | -1 -1 -1 | -1 . -1
    ${OPEN}
  `;

  it('finds an X-Wing on rows and clears the digit from the rest of its columns', () => {
    expect(TECHNIQUES.xWing(pencilmarks(X_WING_ROWS))).toEqual(
      eliminationStep(
        'xWing',
        struck([1], [1, 19, 28, 37, 46, 55, 73, 7, 25, 34, 43, 52, 61, 79]),
        null,
        {
          // Base row by base row, then the base rows and the cover columns.
          pattern: holding([1], [10, 16, 64, 70]),
          houses: [row(1), row(7), column(1), column(7)],
          digit: 1,
        },
      ),
    );
  });

  it('finds an X-Wing on columns and clears the digit from the rest of its rows', () => {
    // Columns 1 and 7 can only hold a 1 in rows 1 and 7.
    const board = pencilmarks(`
      . -1 . | . . . | . -1 .
      . .  . | . . . | . .  .
      . -1 . | . . . | . -1 .
      . -1 . | . . . | . -1 .
      . -1 . | . . . | . -1 .
      . -1 . | . . . | . -1 .
      . -1 . | . . . | . -1 .
      . .  . | . . . | . .  .
      . -1 . | . . . | . -1 .
    `);
    expect(TECHNIQUES.xWing(board)).toEqual(
      eliminationStep(
        'xWing',
        struck([1], [9, 11, 12, 13, 14, 15, 17, 63, 65, 66, 67, 68, 69, 71]),
        null,
        {
          pattern: holding([1], [10, 64, 16, 70]),
          houses: [column(1), column(7), row(1), row(7)],
          digit: 1,
        },
      ),
    );
  });

  it('does not fire when a base row has a third place for the digit', () => {
    const board = pencilmarks(`
      ${OPEN}
      -1 . -1 | -1 -1 -1 | -1 . -1
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      -1 . -1 | -1 .  -1 | -1 . -1
      ${OPEN}
    `);
    expect(TECHNIQUES.xWing(board)).toBeNull();
  });

  it('does not build an X-Wing from a line holding the digit once', () => {
    // Row 1 holds its 1 in column 1 alone and row 7 in columns 1 and 7: two
    // rows in two columns, but row 1's is a hidden single, not half a fish.
    const board = pencilmarks(`
      ${OPEN}
      -1 . -1 | -1 -1 -1 | -1 -1 -1
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      -1 . -1 | -1 -1 -1 | -1 .  -1
      ${OPEN}
    `);
    expect(TECHNIQUES.xWing(board)).toBeNull();
  });

  it('does not fire when the base rows use different columns', () => {
    const board = pencilmarks(`
      ${OPEN}
      -1 . -1 | -1 -1 -1 | -1 .  -1
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      ${OPEN}
      -1 . -1 | -1 -1 -1 | .  -1 -1
      ${OPEN}
    `);
    expect(TECHNIQUES.xWing(board)).toBeNull();
  });

  it('never counts an X-Wing that removes nothing', () => {
    // The columns are already clear of 1s outside the base rows.
    const board = pencilmarks(`
      .  -1 .  | .  .  .  | .  -1 .
      -1 .  -1 | -1 -1 -1 | -1 .  -1
      .  -1 .  | .  .  .  | .  -1 .
      .  -1 .  | .  .  .  | .  -1 .
      .  -1 .  | .  .  .  | .  -1 .
      .  -1 .  | .  .  .  | .  -1 .
      .  -1 .  | .  .  .  | .  -1 .
      -1 .  -1 | -1 -1 -1 | -1 .  -1
      .  -1 .  | .  .  .  | .  -1 .
    `);
    expect(TECHNIQUES.xWing(board)).toBeNull();
  });

  it('finds a Swordfish on rows', () => {
    // Rows 0, 4 and 8 hold their 1s in columns {0, 4}, {4, 8} and {0, 8}.
    const board = pencilmarks(`
      .  -1 -1 | -1 .  -1 | -1 -1 -1
      ${OPEN}
      ${OPEN}
      ${OPEN}
      -1 -1 -1 | -1 .  -1 | -1 -1 .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      .  -1 -1 | -1 -1 -1 | -1 -1 .
    `);
    expect(TECHNIQUES.swordfish(board)).toEqual(
      eliminationStep(
        'swordfish',
        struck([1], [9, 18, 27, 45, 54, 63, 13, 22, 31, 49, 58, 67, 17, 26, 35, 53, 62, 71]),
        null,
        {
          pattern: holding([1], [0, 4, 40, 44, 72, 80]),
          houses: [row(0), row(4), row(8), column(0), column(4), column(8)],
          digit: 1,
        },
      ),
    );
  });

  it('finds a Swordfish on columns', () => {
    const board = pencilmarks(`
      .  . . | . -1 . | . . .
      -1 . . | . -1 . | . . -1
      -1 . . | . -1 . | . . -1
      -1 . . | . -1 . | . . -1
      .  . . | . .  . | . . -1
      -1 . . | . -1 . | . . -1
      -1 . . | . -1 . | . . -1
      -1 . . | . -1 . | . . -1
      -1 . . | . .  . | . . .
    `);
    expect(TECHNIQUES.swordfish(board)).toEqual(
      eliminationStep(
        'swordfish',
        struck([1], [1, 2, 3, 5, 6, 7, 37, 38, 39, 41, 42, 43, 73, 74, 75, 77, 78, 79]),
        null,
        {
          pattern: holding([1], [0, 36, 40, 76, 8, 80]),
          houses: [column(0), column(4), column(8), row(0), row(4), row(8)],
          digit: 1,
        },
      ),
    );
  });

  it('does not fire when three rows reach into four columns', () => {
    const board = pencilmarks(`
      .  -1 -1 | -1 .  -1 | -1 -1 -1
      ${OPEN}
      ${OPEN}
      ${OPEN}
      -1 -1 -1 | -1 .  -1 | -1 -1 .
      ${OPEN}
      ${OPEN}
      ${OPEN}
      .  -1 -1 | -1 -1 -1 | -1 .  -1
    `);
    expect(TECHNIQUES.swordfish(board)).toBeNull();
  });

  it('never counts a Swordfish that removes nothing', () => {
    // The same fish, with its columns already clear of 1s outside the base
    // rows — which makes it a fish on the columns too, just as empty.
    const board = pencilmarks(`
      .  -1 -1 | -1 .  -1 | -1 -1 -1
      -1 .  .  | .  -1 .  | .  .  -1
      -1 .  .  | .  -1 .  | .  .  -1
      -1 .  .  | .  -1 .  | .  .  -1
      -1 -1 -1 | -1 .  -1 | -1 -1 .
      -1 .  .  | .  -1 .  | .  .  -1
      -1 .  .  | .  -1 .  | .  .  -1
      -1 .  .  | .  -1 .  | .  .  -1
      .  -1 -1 | -1 -1 -1 | -1 -1 .
    `);
    expect(TECHNIQUES.swordfish(board)).toBeNull();
  });
});

describe('wings', () => {
  // Pivot r0c0 {1, 2}; pincers r0c4 {1, 3} and r4c0 {2, 3}. Only r4c4 sees
  // both pincers.
  const XY_WING = (secondPincer: string, target = '.') => `
    12           . . | . 13      . | . . .
    ${OPEN}
    ${OPEN}
    ${OPEN}
    ${secondPincer} . . | . ${target} . | . . .
    ${OPEN}
    ${OPEN}
    ${OPEN}
    ${OPEN}
  `;

  it('finds an XY-Wing and clears z from the cells that see both pincers', () => {
    expect(TECHNIQUES.xyWing(pencilmarks(XY_WING('23')))).toEqual(
      eliminationStep('xyWing', struck([3], [40]), null, {
        // The pivot first, then the pincers, each with every candidate it holds.
        pattern: [...holding([1, 2], [0]), ...holding([1, 3], [4]), ...holding([2, 3], [36])],
        houses: [],
        digit: null,
      }),
    );
  });

  it('does not fire when the pincers share no digit outside the pivot', () => {
    expect(TECHNIQUES.xyWing(pencilmarks(XY_WING('24')))).toBeNull();
  });

  it('does not fire when both pincers hang off the same pivot digit', () => {
    expect(TECHNIQUES.xyWing(pencilmarks(XY_WING('13')))).toBeNull();
  });

  it('never counts an XY-Wing that removes nothing', () => {
    expect(TECHNIQUES.xyWing(pencilmarks(XY_WING('23', '-3')))).toBeNull();
  });

  // Pivot r0c0 {1, 2, 3}; pincers r0c4 {1, 3} and r1c1 {2, 3}. r0c1 and r0c2
  // see all three.
  const XYZ_WING = (firstPincer: string, targets = '. .') => `
    123 ${targets} | . ${firstPincer} . | . . .
    .   23         . | . .              . | . . .
    ${OPEN}
    ${OPEN}
    ${OPEN}
    ${OPEN}
    ${OPEN}
    ${OPEN}
    ${OPEN}
  `;

  it('finds an XYZ-Wing and clears z from the cells that see all three', () => {
    expect(TECHNIQUES.xyzWing(pencilmarks(XYZ_WING('13')))).toEqual(
      eliminationStep('xyzWing', struck([3], [1, 2]), null, {
        pattern: [...holding([1, 2, 3], [0]), ...holding([1, 3], [4]), ...holding([2, 3], [10])],
        houses: [],
        digit: null,
      }),
    );
  });

  it('does not take a pincer with a digit outside the pivot', () => {
    expect(TECHNIQUES.xyzWing(pencilmarks(XYZ_WING('14')))).toBeNull();
  });

  it('does not take two identical pincers', () => {
    expect(TECHNIQUES.xyzWing(pencilmarks(XYZ_WING('23')))).toBeNull();
  });

  it('never counts an XYZ-Wing that removes nothing', () => {
    expect(TECHNIQUES.xyzWing(pencilmarks(XYZ_WING('13', '-3 -3')))).toBeNull();
  });
});

describe('chains', () => {
  // Rows 1 and 7 hold their 1s in column 1 and one other column each, 4 and
  // 5 — in the same stack, so the cells in its boxes that see both tops are
  // where the 1 goes from.
  const SKYSCRAPER = (secondRow = '-1 . -1 | -1 -1 . | -1 -1 -1', targets = '.') => `
    .  .  .  | .  .  ${targets} | .  .  .
    -1 .  -1 | -1 .  -1 | -1 -1 -1
    .  .  .  | .  .  ${targets} | .  .  .
    ${OPEN}
    ${OPEN}
    ${OPEN}
    .  .  .  | .  ${targets} . | .  .  .
    ${secondRow}
    .  .  .  | .  ${targets} . | .  .  .
  `;

  it('finds a Skyscraper on rows and clears the digit from the cells that see both tops', () => {
    expect(TECHNIQUES.skyscraper(pencilmarks(SKYSCRAPER()))).toEqual(
      eliminationStep('skyscraper', struck([1], [5, 23, 58, 76]), null, {
        // End to end: a top, its base, the other base, the other top.
        pattern: holding([1], [13, 10, 64, 68]),
        houses: [row(1), row(7), column(1)],
        digit: 1,
      }),
    );
  });

  it('finds a Skyscraper on columns', () => {
    // The same pattern, turned on its side.
    const board = pencilmarks(`
      .  -1 .  | .  .  .  | .  -1 .
      .  .  .  | .  .  .  | .  .  .
      .  -1 .  | .  .  .  | .  -1 .
      .  -1 .  | .  .  .  | .  -1 .
      .  .  .  | .  .  .  | .  -1 .
      .  -1 .  | .  .  .  | .  .  .
      .  -1 .  | .  .  .  | .  -1 .
      .  -1 .  | .  .  .  | .  -1 .
      .  -1 .  | .  .  .  | .  -1 .
    `);
    expect(TECHNIQUES.skyscraper(board)).toEqual(
      eliminationStep('skyscraper', struck([1], [42, 44, 45, 47]), null, {
        pattern: holding([1], [37, 10, 16, 52]),
        houses: [column(1), column(7), row(1)],
        digit: 1,
      }),
    );
  });

  it('leaves tops that share a cross line too to the X-Wing', () => {
    const board = pencilmarks(SKYSCRAPER('-1 . -1 | -1 . -1 | -1 -1 -1'));
    expect(TECHNIQUES.skyscraper(board)).toBeNull();
  });

  it('does not fire when a line has a third place for the digit', () => {
    const board = pencilmarks(SKYSCRAPER('-1 . -1 | -1 -1 . | -1 -1 .'));
    expect(TECHNIQUES.skyscraper(board)).toBeNull();
  });

  it('never counts a Skyscraper that removes nothing', () => {
    const board = pencilmarks(SKYSCRAPER(undefined, '-1'));
    expect(TECHNIQUES.skyscraper(board)).toBeNull();
  });

  /**
   * Row 1 holds its 1s in `rowLine`'s open cells, and column 0 in the rows
   * listed; r7c6, where a far end's column meets the other's row, is
   * `target`.
   */
  const KITE = (rowLine = '-1 . -1 | -1 -1 -1 | . -1 -1', columnRows = [2, 7], target = '.') =>
    Array.from({ length: 9 }, (_, r) => {
      if (r === 1) return rowLine;
      const first = columnRows.includes(r) ? '.' : '-1';
      return `${first} . . | . . . | ${r === 7 ? target : '.'} . .`;
    }).join('\n');

  it('finds a 2-String Kite and clears the digit where its far ends cross', () => {
    expect(TECHNIQUES.twoStringKite(pencilmarks(KITE()))).toEqual(
      eliminationStep('twoStringKite', struck([1], [69]), null, {
        // End to end: the row's far end, its cell in the box, the column's
        // cell in the box, the column's far end.
        pattern: holding([1], [15, 10, 18, 63]),
        houses: [row(1), column(0), box(0)],
        digit: 1,
      }),
    );
  });

  it('does not fire when the strings meet in no box', () => {
    expect(TECHNIQUES.twoStringKite(pencilmarks(KITE(undefined, [4, 7])))).toBeNull();
  });

  it('does not fire when a string never leaves the box', () => {
    const board = pencilmarks(KITE('-1 . . | -1 -1 -1 | -1 -1 -1'));
    expect(TECHNIQUES.twoStringKite(board)).toBeNull();
  });

  it('does not tie two strings that share a cell into a kite', () => {
    const board = pencilmarks(KITE('. -1 -1 | -1 -1 -1 | . -1 -1', [1, 7]));
    expect(TECHNIQUES.twoStringKite(board)).toBeNull();
  });

  it('never counts a 2-String Kite that removes nothing', () => {
    expect(TECHNIQUES.twoStringKite(pencilmarks(KITE(undefined, undefined, '-1')))).toBeNull();
  });

  /** Open cells everywhere but the listed ones, given as cell → token. */
  const layout = (cells: Record<number, string>) =>
    Array.from({ length: 81 }, (_, i) => cells[i] ?? '.').join(' ');

  // r0c0 {1, 2} – r0c5 {2, 3} – r4c5 {3, 4} – r4c1 {1, 4}: if r0c0 isn't 1,
  // r4c1 is. Six cells see both ends: three in each end's box.
  const XY_CHAIN = (cells: Record<number, string> = {}) =>
    layout({ 0: '12', 5: '23', 41: '34', 37: '14', ...cells });

  it('finds an XY-Chain and clears its digit from the cells that see both ends', () => {
    expect(TECHNIQUES.xyChain(pencilmarks(XY_CHAIN()))).toEqual(
      eliminationStep('xyChain', struck([1], [1, 10, 19, 27, 36, 45]), null, {
        // End to end, each cell with both its candidates.
        pattern: [
          ...holding([1, 2], [0]),
          ...holding([2, 3], [5]),
          ...holding([3, 4], [41]),
          ...holding([1, 4], [37]),
        ],
        houses: [],
        digit: 1,
      }),
    );
  });

  it('does not fire when the ends share no digit', () => {
    expect(TECHNIQUES.xyChain(pencilmarks(XY_CHAIN({ 37: '45' })))).toBeNull();
  });

  it('does not take a cell with a third candidate', () => {
    expect(TECHNIQUES.xyChain(pencilmarks(XY_CHAIN({ 41: '345' })))).toBeNull();
  });

  it('never counts an XY-Chain that removes nothing', () => {
    const cleared = Object.fromEntries([1, 10, 19, 27, 36, 45].map((i) => [i, '-1']));
    expect(TECHNIQUES.xyChain(pencilmarks(XY_CHAIN(cleared)))).toBeNull();
  });

  it('leaves a chain of three cells to the XY-Wing', () => {
    // r0c0 {1, 2} – r0c5 {2, 3} – r4c5 {1, 3}: an XY-Wing, pivot r0c5.
    const board = pencilmarks(layout({ 0: '12', 5: '23', 41: '13' }));
    expect(TECHNIQUES.xyChain(board)).toBeNull();
    expect(TECHNIQUES.xyWing(board)).not.toBeNull();
  });

  it(`looks no further than ${MAX_XY_CHAIN} cells`, () => {
    // Cells end to end along rows and columns, each sharing a different
    // digit with the next, and only the ends sharing 1: six of them make a
    // chain, seven are too long.
    const path = { 0: '12', 4: '23', 40: '34', 44: '45', 80: '56' };
    const six = pencilmarks(layout({ ...path, 74: '16' }));
    expect(TECHNIQUES.xyChain(six)?.pattern.map((p) => p.index)).toEqual([0, 4, 40, 44, 80, 74]);
    const seven = pencilmarks(layout({ ...path, 74: '67', 78: '17' }));
    expect(TECHNIQUES.xyChain(seven)).toBeNull();
  });

  // r0c0 and r4c4 are both {1, 2}; row 2 holds its 2s at c1, which r0c0
  // sees, and c4, which r4c4 sees. r0c4 and r4c0 see both cells.
  const W_WING = (cells: Record<number, string> = {}) =>
    layout({
      0: '12',
      40: '12',
      ...Object.fromEntries([18, 20, 21, 23, 24, 25, 26].map((i) => [i, '-2'])),
      ...cells,
    });

  it('finds a W-Wing and clears its digit from the cells that see both of its cells', () => {
    expect(TECHNIQUES.wWing(pencilmarks(W_WING()))).toEqual(
      eliminationStep('wWing', struck([1], [4, 36]), null, {
        // A cell, the place it sees, the other place, the other cell.
        pattern: [...holding([1, 2], [0]), ...holding([2], [19, 22]), ...holding([1, 2], [40])],
        houses: [row(2)],
        digit: 1,
      }),
    );
  });

  it('leaves two cells that see each other to the naked pair', () => {
    expect(TECHNIQUES.wWing(pencilmarks(W_WING({ 40: '.', 4: '12' })))).toBeNull();
  });

  it('does not pair cells with different candidates', () => {
    expect(TECHNIQUES.wWing(pencilmarks(W_WING({ 40: '13' })))).toBeNull();
  });

  it('does not fire when a cell sees neither place', () => {
    expect(TECHNIQUES.wWing(pencilmarks(W_WING({ 40: '.', 43: '12' })))).toBeNull();
  });

  it('never counts a W-Wing that removes nothing', () => {
    expect(TECHNIQUES.wWing(pencilmarks(W_WING({ 4: '-1', 36: '-1' })))).toBeNull();
  });

  // r0c0 {1, 2}; column 4's 2s at r0c4 and r4c4 {2, 3}; row 4's 3s at r4c4
  // and r4c0. If r0c0 isn't 1 it's 2, so r0c4 isn't 2, so r4c4 is 2 and
  // isn't 3, so r4c0 is 3: either r0c0 is 1 or r4c0 is 3, and r4c0's 1,
  // which would rule out both, goes.
  const ALTERNATING = (cells: Record<number, string> = {}) =>
    layout({
      ...Object.fromEntries([13, 22, 31, 49, 58, 67, 76].map((i) => [i, '-2'])),
      ...Object.fromEntries([37, 38, 39, 41, 42, 43, 44].map((i) => [i, '-3'])),
      0: '12',
      40: '23',
      ...cells,
    });

  it('finds an alternating chain and clears what would rule out both its ends', () => {
    expect(TECHNIQUES.alternatingChain(pencilmarks(ALTERNATING()))).toEqual(
      eliminationStep('alternatingChain', struck([1], [36]), null, {
        // One digit per candidate, end to end: strong, weak, strong, weak,
        // strong — inside r0c0, from it to r0c4, down column 4, inside
        // r4c4, along row 4.
        pattern: [...holding([1], [0]), ...holding([2], [0, 4, 40]), ...holding([3], [40, 36])],
        // The houses of its strong links between cells, in order.
        houses: [column(4), row(4)],
        digit: null,
      }),
    );
  });

  it('does not take a cell with three candidates for a strong link', () => {
    expect(TECHNIQUES.alternatingChain(pencilmarks(ALTERNATING({ 0: '124' })))).toBeNull();
  });

  it('does not take a digit with three places for a strong link', () => {
    expect(TECHNIQUES.alternatingChain(pencilmarks(ALTERNATING({ 13: '.' })))).toBeNull();
  });

  it('never counts an alternating chain that removes nothing', () => {
    expect(TECHNIQUES.alternatingChain(pencilmarks(ALTERNATING({ 36: '-1' })))).toBeNull();
  });
});

describe('every technique', () => {
  const OPEN_BOARD = Array(81).fill('.').join(' ');

  it.each(TECHNIQUE_ORDER)('%s finds nothing on an open board, and leaves it untouched', (id) => {
    const board = pencilmarks(OPEN_BOARD);
    expect(TECHNIQUES[id](board)).toBeNull();
    expect(board).toEqual(pencilmarks(OPEN_BOARD));
  });

  it.each(TECHNIQUE_ORDER)('%s finds nothing on a solved grid', (id) => {
    const board = createBoard(parseGrid(WIKIPEDIA_SOLUTION));
    expect(TECHNIQUES[id](board)).toBeNull();
  });
});

/*
 * The soundness harness (see `checkSoundness`) over random minimal puzzles —
 * the raw material every tier is picked from, stalled ones included — and
 * the fixtures that need each technique. The generator's tests run the same
 * harness over dozens of puzzles of each tier.
 */
describe('soundness', () => {
  // Digs and grades a hundred puzzles: well under a second on its own, but
  // coverage instrumentation on a busy machine or CI runner can make it many
  // times slower, so it gets the generator property tests' generous timeout.
  it('never places a wrong digit, strikes a right one or misdescribes a pattern across a hundred real puzzles', () => {
    const corpus = [...minimalPuzzles(100), ...Object.values(HARDEST).map(solvedPuzzle)];
    const problems: string[] = [];
    const fired = new Set<TechniqueId>();
    for (const puzzle of corpus) {
      const report = checkSoundness(puzzle);
      problems.push(...report.problems);
      for (const id of report.fired) fired.add(id);
    }
    expect(problems).toEqual([]);
    // Every technique has to have been exercised on real puzzles for the
    // check to mean anything.
    expect([...fired].sort()).toEqual([...TECHNIQUE_ORDER].sort());
  }, 60_000);

  /*
   * The pattern checks only mean something if they can fail. Each case
   * misdescribes the steps of one technique, which is otherwise left alone,
   * and the harness has to notice on a puzzle that needs that technique.
   */
  it.each<[TechniqueId, string, (step: SolveStep) => void]>([
    ['fullHouse', 'says it is about no digit at all', (step) => (step.digit = null)],
    ['pointing', 'leaves a cell out of its pattern', (step) => step.pattern.pop()],
    ['claiming', 'names its houses the wrong way round', (step) => step.houses.reverse()],
    ['nakedPair', 'claims a candidate its cell lacks', (step) => (step.pattern[0].mask = 0x1ff)],
    ['swordfish', 'forgets a cover line', (step) => step.houses.pop()],
    ['xyzWing', 'puts a pincer where the pivot goes', (step) => step.pattern.reverse()],
    ['skyscraper', 'runs its chain backwards', (step) => step.pattern.reverse()],
    [
      'twoStringKite',
      'names the wrong box for its weak link',
      (step) => (step.houses[2] = { kind: 'box', index: (step.houses[2].index + 1) % 9 }),
    ],
  ])('flags a %s step that %s', (id, _, misdescribe) => {
    const techniques = TECHNIQUES as Record<TechniqueId, Technique>;
    const original = techniques[id];
    const spy = vi.spyOn(techniques, id).mockImplementation((board) => {
      const step = original(board);
      if (step) misdescribe(step);
      return step;
    });
    try {
      // Full houses turn up in every solve; the rest have a fixture of their own.
      const fixture = id === 'fullHouse' ? HARDEST.hiddenSingleBox : HARDEST[id];
      const { problems } = checkSoundness(solvedPuzzle(fixture));
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.every((problem) => problem.startsWith(`${id} `))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
