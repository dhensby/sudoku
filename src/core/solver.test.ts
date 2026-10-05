import { formatGrid, parseGrid } from './grid';
import { countSolutions, hasUniqueSolution, solve } from './solver';
import { EMPTY_GRID, WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';

// Two 5s in the top row: no solution can exist.
const CLASHING = `5.5${'.'.repeat(78)}`;

// One of Arto Inkala's "world's hardest" puzzles — deep enough that the
// search has to backtrack in earnest.
const INKALA = `
  8.. ... ...
  ..3 6.. ...
  .7. .9. 2..
  .5. ..7 ...
  ... .45 7..
  ... 1.. .3.
  ..1 ... .68
  ..8 5.. .1.
  .9. ... 4..
`;

describe('countSolutions', () => {
  it('finds exactly one solution for a well-formed puzzle', () => {
    expect(countSolutions(parseGrid(WIKIPEDIA_PUZZLE))).toBe(1);
    expect(countSolutions(parseGrid(INKALA))).toBe(1);
  });

  it('stops counting at the cap', () => {
    expect(countSolutions(parseGrid(EMPTY_GRID))).toBe(2);
    expect(countSolutions(parseGrid(EMPTY_GRID), 5)).toBe(5);
  });

  it('returns 0 when the givens clash', () => {
    expect(countSolutions(parseGrid(CLASHING))).toBe(0);
  });

  it('returns 0 when the givens are consistent but unsolvable', () => {
    // No clash among the givens, but the top-left cell sees 1–8 in its row
    // and 9 in its column, leaving it nothing.
    const values = parseGrid(EMPTY_GRID);
    for (let c = 1; c < 9; c++) values[c] = c;
    values[9 * 4] = 9;
    expect(countSolutions(values)).toBe(0);
  });

  it('counts a solved grid as its own single solution', () => {
    expect(countSolutions(parseGrid(WIKIPEDIA_SOLUTION))).toBe(1);
  });

  it('does not modify its input', () => {
    const values = parseGrid(WIKIPEDIA_PUZZLE);
    const before = formatGrid(values);
    countSolutions(values);
    expect(formatGrid(values)).toBe(before);
  });
});

describe('hasUniqueSolution', () => {
  it('distinguishes unique from non-unique grids', () => {
    expect(hasUniqueSolution(parseGrid(WIKIPEDIA_PUZZLE))).toBe(true);
    expect(hasUniqueSolution(parseGrid(EMPTY_GRID))).toBe(false);
    expect(hasUniqueSolution(parseGrid(CLASHING))).toBe(false);
  });
});

describe('solve', () => {
  it('returns the solution of a unique puzzle', () => {
    expect(formatGrid(solve(parseGrid(WIKIPEDIA_PUZZLE))!)).toBe(
      formatGrid(parseGrid(WIKIPEDIA_SOLUTION)),
    );
    expect(solve(parseGrid(INKALA))).not.toBeNull();
  });

  it('returns some complete, valid grid for a non-unique one', () => {
    const solution = solve(parseGrid(EMPTY_GRID))!;
    expect(countSolutions(solution)).toBe(1);
    expect([...solution].every((v) => v >= 1 && v <= 9)).toBe(true);
  });

  it('returns null when there is no solution', () => {
    expect(solve(parseGrid(CLASHING))).toBeNull();
  });

  it('accepts plain arrays as well as typed ones', () => {
    expect(solve(Array.from(parseGrid(WIKIPEDIA_PUZZLE)))).not.toBeNull();
  });
});
