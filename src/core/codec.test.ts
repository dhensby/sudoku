import { checkGivens, decodeGivens, encodeGivens, looksLikeShareCode } from './codec';
import { findConflicts, formatGrid, gridValues, isGridString, parseGrid } from './grid';
import { mulberry32, shuffle, type RandomFn } from './rng';
import { countSolutions, solve } from './solver';
import { EMPTY_GRID, WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// A 17-given puzzle — the fewest a uniquely solvable Sudoku can have.
const SEVENTEEN = formatGrid(
  parseGrid(`
    ... ... .1.
    4.. ... ...
    .2. ... ...
    ... .5. 4.7
    ..8 ... 3..
    ..1 .9. ...
    3.. 4.. 2..
    .5. 1.. ...
    ... 8.6 ...
  `),
);
const PUZZLE = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
const SOLUTION = formatGrid(parseGrid(WIKIPEDIA_SOLUTION));

// Two of the hardest puzzles known (Platinum Blonde, Easter Monster): the
// most search a genuine puzzle is likely to ask for.
const PLATINUM_BLONDE = formatGrid(
  parseGrid(`
    ... ... .12
    ... ... ..3
    ..2 3.. 4..
    ..1 8.. ..5
    .6. .7. 8..
    ... ..9 ...
    ..8 5.. ...
    9.. .4. 5..
    47. ..6 ...
  `),
);
const EASTER_MONSTER = formatGrid(
  parseGrid(`
    1.. ... ..2
    .9. 4.. .5.
    ..6 ... 7..
    .5. 9.3 ...
    ... .7. ...
    ... 85. .4.
    7.. ... 6..
    .3. ..9 .8.
    ..2 ... ..1
  `),
);

// Hostile grids: 17 clash-free givens with no solution, where no cell runs
// out of candidates at the start. Here the 1s at r0c5, r1c8, r3c0 and r6c1
// and the 2 at r2c2 leave no room for a 1 in the top-left box — which plain
// backtracking only finds out after searching the rest of the grid (6.6 s,
// from a share link, before checks propagated).
const NO_ROOM_FOR_A_ONE = 'r0zIeMaUoSBClCQIIEgAg';
// Here 1, 2 and 3 can only go in r0c0 and r0c1 of the top-left box: three
// digits, two cells. Singles alone never see that, so the search must branch
// until it trips over it — deeper than the budget allows.
const THREE_DIGITS_TWO_CELLS = formatGrid(
  parseGrid(`
    ... ... ...
    ... 12. 3..
    ... ..3 .12
    4.1 .9. ...
    ..2 ... .3.
    ... ... 6..
    ..3 .7. ...
    .97 5.. ...
    ... ... ...
  `),
);
// The same trap, sprung within a few dozen nodes.
const THREE_DIGITS_TWO_CELLS_SHALLOW = formatGrid(
  parseGrid(`
    ... ... 7..
    ... 12. 3..
    ... 5.3 .12
    ..1 ... ...
    ..2 ... ...
    ... ... ...
    ..3 .1. .5.
    .8. .5. ..3
    ... 7.. ...
  `),
);

/** Write a raw number as base64url, for crafting codes the encoder would never produce. */
function codeOf(n: bigint): string {
  let code = '';
  do {
    code = ALPHABET[Number(n & 63n)] + code;
    n >>= 6n;
  } while (n > 0n);
  return code;
}

/** A random grid: each cell given with probability `density`, any digit, clashes and all. */
function randomGrid(rng: RandomFn, density: number): string {
  let grid = '';
  for (let i = 0; i < 81; i++) grid += rng() < density ? String(1 + Math.floor(rng() * 9)) : '0';
  // The codec needs at least one given; force one where the dice gave none.
  return /^0+$/.test(grid) ? `5${grid.slice(1)}` : grid;
}

/** Replace the cell at `index` of a grid string. */
function withCell(grid: string, index: number, digit: number): string {
  return grid.slice(0, index) + String(digit) + grid.slice(index + 1);
}

describe('encodeGivens', () => {
  it('pins the format, so links already shared keep opening the same puzzle', () => {
    // If either of these changes, every link in the wild breaks. Do not
    // update them — version the format instead.
    expect(encodeGivens(PUZZLE)).toBe('CC_GgjzXW3b6OIR_GQnDCiMpiKGHIT');
    expect(encodeGivens(SEVENTEEN)).toBe('Shk_3VaWAoBRJChEqACAKA');
  });

  it('writes only base64url characters, with no padding', () => {
    for (const grid of [PUZZLE, SOLUTION, SEVENTEEN]) {
      expect(encodeGivens(grid)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('stays short: 23 characters at most for 17 givens, 57 for a full grid', () => {
    expect(encodeGivens(SEVENTEEN).length).toBeLessThanOrEqual(23);
    // All 9s is the largest digit string a full grid can carry.
    expect(encodeGivens('9'.repeat(81))).toHaveLength(57);
    expect(encodeGivens(SOLUTION).length).toBeLessThanOrEqual(57);
  });

  it('encodes a lone 1 in the first cell as the smallest non-zero code', () => {
    expect(encodeGivens(`1${'0'.repeat(80)}`)).toBe('B');
  });

  it.each([
    ['an empty grid', '0'.repeat(81)],
    ['a short string', '123'],
    ['dots for blanks', '.'.repeat(81)],
    ['too many cells', '1'.repeat(82)],
  ])('throws for %s, which no puzzle can be', (_label, givens) => {
    expect(() => encodeGivens(givens)).toThrow(/81-digit grid string/);
  });
});

describe('decodeGivens', () => {
  it.each([
    ['the Wikipedia puzzle', PUZZLE],
    ['a 17-given puzzle', SEVENTEEN],
    ['a complete grid (81 givens)', SOLUTION],
    ['all 9s', '9'.repeat(81)],
    ['all 1s (a digit string of zero)', '1'.repeat(81)],
    ['a single given in the last cell', `${'0'.repeat(80)}7`],
  ])('round-trips %s', (_label, grid) => {
    expect(decodeGivens(encodeGivens(grid))).toBe(grid);
  });

  it('round-trips hundreds of random grids of every density', () => {
    const rng = mulberry32(2024);
    for (let n = 0; n < 500; n++) {
      const grid = randomGrid(rng, rng());
      expect(decodeGivens(encodeGivens(grid))).toBe(grid);
    }
  });

  it.each([
    ['the empty string', ''],
    ['a lone zero character (no givens)', 'A'],
    ['a plain-base64 plus', 'CC+GgjzXW3b6OIR'],
    ['a plain-base64 slash', 'CC/GgjzXW3b6OIR'],
    ['base64 padding', 'CC_GgjzXW3b6OIR_GQnDCiMpiKGHIT=='],
    ['a space', 'CC_GgjzXW3b6 OIR_GQnDCiMpiKGHIT'],
    ['surrounding whitespace', ' CC_GgjzXW3b6OIR_GQnDCiMpiKGHIT\n'],
    ['a dot', 'CC.GgjzXW3b6OIR'],
    ['an accented letter', 'CCéGgjzXW3b6OIR'],
    ['an emoji', 'CC😀GgjzXW3b6OIR'],
    ['a percent-encoded character', 'CC%2BGgjzXW3b6OIR'],
  ])('rejects %s', (_label, code) => {
    expect(decodeGivens(code)).toBeNull();
  });

  it('rejects a leading zero character, so every accepted code is canonical', () => {
    // 'A' is a zero digit: it does not change the number, so without this
    // check two different links would open the same puzzle.
    expect(decodeGivens(`A${encodeGivens(PUZZLE)}`)).toBeNull();
    expect(decodeGivens(`AAA${encodeGivens(PUZZLE)}`)).toBeNull();
  });

  it('rejects a mask with no positions', () => {
    // Digit data with nowhere to put it: one digit, zero givens.
    expect(decodeGivens(codeOf(1n << 81n))).toBeNull();
  });

  it('rejects digit data left over once every position has its digit', () => {
    // One position can hold a base-9 digit of 0–8. 8 decodes (as a 9)...
    expect(decodeGivens(codeOf((8n << 81n) | 1n))).toBe(`9${'0'.repeat(80)}`);
    // ...but 9 needs a second digit the mask has no position for.
    expect(decodeGivens(codeOf((9n << 81n) | 1n))).toBeNull();
    // Characters stuck on the front are the usual way to get here.
    expect(decodeGivens(`_${encodeGivens(SEVENTEEN)}`)).toBeNull();
  });

  it('rejects anything longer than the longest real code', () => {
    // 58–64 characters pass the length cap but carry more digit data than 81
    // positions can hold; beyond 64 the cap turns them away unparsed.
    expect(decodeGivens('_'.repeat(58))).toBeNull();
    expect(decodeGivens('_'.repeat(64))).toBeNull();
    expect(decodeGivens('_'.repeat(65))).toBeNull();
    expect(decodeGivens('B'.repeat(10_000))).toBeNull();
  });

  it('accepts only what encodeGivens would have written', () => {
    // Fuzz: random strings over the alphabet either fail to decode or
    // re-encode to exactly themselves — the format has no second spellings.
    const rng = mulberry32(99);
    let accepted = 0;
    let rejected = 0;
    for (let n = 0; n < 2000; n++) {
      const length = 1 + Math.floor(rng() * 40);
      let code = '';
      for (let k = 0; k < length; k++) code += ALPHABET[Math.floor(rng() * 64)];
      const grid = decodeGivens(code);
      if (grid === null) {
        rejected++;
        continue;
      }
      accepted++;
      expect(isGridString(grid)).toBe(true);
      expect(encodeGivens(grid)).toBe(code);
    }
    // Both branches must actually have been exercised for the test to mean anything.
    expect(accepted).toBeGreaterThan(100);
    expect(rejected).toBeGreaterThan(100);
  });
});

describe('looksLikeShareCode', () => {
  it('passes every code encodeGivens writes', () => {
    expect(looksLikeShareCode(encodeGivens(SEVENTEEN))).toBe(true);
    expect(looksLikeShareCode(encodeGivens(formatGrid(parseGrid(WIKIPEDIA_SOLUTION))))).toBe(true);
  });

  it.each([
    ['the empty string', ''],
    ['a character outside base64url', 'abc+def'],
    ['padding', 'abc='],
    ['a leading zero digit', 'Abcdef'],
    ['more than 64 characters', 'b'.repeat(65)],
  ])('turns away %s', (_label, code) => {
    expect(looksLikeShareCode(code)).toBe(false);
  });
});

describe('checkGivens', () => {
  it('accepts a sound puzzle and hands back its solution', () => {
    expect(checkGivens(PUZZLE)).toEqual({ ok: true, solution: SOLUTION });
  });

  it('accepts a 17-given puzzle', () => {
    const result = checkGivens(SEVENTEEN);
    expect(result.ok).toBe(true);
  });

  it('accepts a complete grid as its own solution', () => {
    expect(checkGivens(SOLUTION)).toEqual({ ok: true, solution: SOLUTION });
  });

  it.each([
    ['the empty string', ''],
    ['a short string', '530070000'],
    ['dots for blanks', PUZZLE.replace(/0/g, '.')],
    ['a layout with whitespace', WIKIPEDIA_PUZZLE],
    ['an extra cell', `${PUZZLE}0`],
    ['a letter', `x${PUZZLE.slice(1)}`],
  ])('reports %s as malformed', (_label, givens) => {
    expect(checkGivens(givens)).toEqual({ ok: false, problem: 'malformed' });
  });

  it('reports fewer than 17 givens', () => {
    const sixteen = withCell(SEVENTEEN, SEVENTEEN.search(/[1-9]/), 0);
    expect(checkGivens(sixteen)).toEqual({ ok: false, problem: 'too-few-givens' });
    expect(checkGivens(EMPTY_GRID.replace(/\./g, '0'))).toEqual({
      ok: false,
      problem: 'too-few-givens',
    });
  });

  it('reports a clash among the givens', () => {
    // r0c2 = 5 repeats the 5 at r0c0.
    expect(checkGivens(withCell(PUZZLE, 2, 5))).toEqual({ ok: false, problem: 'clash' });
  });

  it('reports consistent givens with no solution', () => {
    // r0c2 could hold 1, 2 or 4 as far as its peers go, but the unique
    // solution has a 4 there: a 1 clashes with nothing yet solves nothing.
    expect(checkGivens(withCell(PUZZLE, 2, 1))).toEqual({ ok: false, problem: 'no-solution' });
  });

  it('reports givens with more than one solution', () => {
    // Blank the top two rows of a solved grid: they can be swapped wholesale
    // (rows within a band always can), so at least two solutions remain.
    const twoRowsBlank = '0'.repeat(18) + SOLUTION.slice(18);
    expect(checkGivens(twoRowsBlank)).toEqual({ ok: false, problem: 'multiple-solutions' });
  });

  it('runs the cheap checks first', () => {
    // Sixteen givens with a clash among them: the count is what is reported.
    const sixteen = withCell(SEVENTEEN, SEVENTEEN.search(/[1-9]/), 0);
    const clashing = withCell(sixteen, 31, 4); // r3c4 5 → 4, repeating r3c6's 4
    expect(checkGivens(clashing)).toEqual({ ok: false, problem: 'too-few-givens' });
  });

  it('reads back what decodeGivens produced', () => {
    const givens = decodeGivens(encodeGivens(PUZZLE))!;
    expect(checkGivens(givens)).toEqual({ ok: true, solution: SOLUTION });
  });

  it.each([
    ['Platinum Blonde', PLATINUM_BLONDE],
    ['Easter Monster', EASTER_MONSTER],
  ])('accepts %s, one of the hardest puzzles known, well within its budget', (_label, givens) => {
    // A tenth of the budget is plenty: a genuine puzzle must never be
    // refused as too complex.
    expect(checkGivens(givens, { maxNodes: 1000 })).toEqual({
      ok: true,
      solution: formatGrid(solve(gridValues(givens))!),
    });
  });

  it('refuses a link crafted to freeze the page without searching at all', () => {
    // Propagating singles from the givens alone finds the box with no room
    // for a 1, so not a single search node is spent.
    const givens = decodeGivens(NO_ROOM_FOR_A_ONE)!;
    expect(checkGivens(givens, { maxNodes: 0 })).toEqual({ ok: false, problem: 'no-solution' });
  });

  it('gives up on a grid built to need a deep search, rather than searching for minutes', () => {
    expect(checkGivens(THREE_DIGITS_TWO_CELLS)).toEqual({ ok: false, problem: 'too-complex' });
  });

  it('searches as far as its budget allows', () => {
    expect(checkGivens(THREE_DIGITS_TWO_CELLS_SHALLOW, { maxNodes: 0 })).toEqual({
      ok: false,
      problem: 'too-complex',
    });
    expect(checkGivens(THREE_DIGITS_TWO_CELLS_SHALLOW)).toEqual({
      ok: false,
      problem: 'no-solution',
    });
  });

  it('never vouches for a puzzle whose uniqueness it ran out of budget to prove', () => {
    // One solution found is not enough: a second might lie in the part of
    // the search it never reached.
    expect(checkGivens(PLATINUM_BLONDE, { maxNodes: 5 })).toEqual({
      ok: false,
      problem: 'too-complex',
    });
  });

  it('notices a given that singles from the givens before it have already ruled out', () => {
    // Row 0 holds 2–8 and a 1, leaving r0c0 a naked 9 — which the 9 given at
    // r1c0 then contradicts, though no two givens clash.
    const givens = formatGrid(
      parseGrid(`
        .23 456 781
        9.. ... ...
        ... ... ...
        ... 1.. ...
        ... .2. ...
        ... ..3 ...
        2.. ... 4..
        .3. ... .5.
        ... ... ..6
      `),
    );
    expect(findConflicts(gridValues(givens)).some(Boolean)).toBe(false);
    expect(checkGivens(givens, { maxNodes: 0 })).toEqual({ ok: false, problem: 'no-solution' });
  });

  it('agrees with the engine’s solver on hundreds of random grids', () => {
    // Half are random clash-free grids, which rarely have a solution; half are
    // random subsets of a relabelled solved grid, which always have at least
    // one. 22–41 givens: dense enough for the plain solver to stay quick,
    // sparse enough to land on every outcome.
    const rng = mulberry32(17);
    const tally = { ok: 0, 'no-solution': 0, 'multiple-solutions': 0 };
    for (let n = 0; n < 300; n++) {
      const target = 22 + (n % 20);
      const values = new Uint8Array(81);
      const relabel = [0, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)];
      for (let placed = 0; placed < target;) {
        const i = Math.floor(rng() * 81);
        if (values[i] !== 0) continue;
        values[i] = n % 2 === 0 ? 1 + Math.floor(rng() * 9) : relabel[SOLUTION.charCodeAt(i) - 48];
        if (findConflicts(values).some(Boolean)) values[i] = 0;
        else placed++;
      }
      const result = checkGivens(formatGrid(values));
      const count = countSolutions(values, 2);
      if (count === 1) {
        expect(result).toEqual({ ok: true, solution: formatGrid(solve(values)!) });
        tally.ok++;
      } else {
        const problem = count === 0 ? 'no-solution' : 'multiple-solutions';
        expect(result).toEqual({ ok: false, problem });
        tally[problem]++;
      }
    }
    // Every outcome must actually have come up for the test to mean anything.
    expect(Math.min(...Object.values(tally))).toBeGreaterThan(5);
  });
});
