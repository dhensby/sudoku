import { grade, harderTechnique } from './grader';
import { POPCOUNT, computeCandidates, formatGrid, gridValues, parseGrid } from './grid';
import { findHint } from './hint';
import { cloneBoard, createBoard } from './techniques';
import type { Hint, TechniqueId } from './types';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import { ALL_FIXTURES, HARDEST, solvedPuzzle } from '../test/logic-fixtures';

/*
 * Positions along the solve of the pointing fixture (HARDEST.pointing), each
 * the givens plus the placements the grader had made by then — so every one
 * agrees with the solution.
 */
const POINTING_SOLUTION = gridValues(HARDEST.pointing.solution);

/** No box has a hidden single here, but row 6 does: only r6c2 can take a 5. */
const LINE_SINGLE_POSITION =
  '800175402107000385502000107000684700000512000008000520080090010309000200000000000';

/** No hidden single anywhere, but r5c4 sees every digit except 3. */
const NAKED_SINGLE_POSITION =
  '800175402107020385502000107250684700000512000008000520085290010309000200020000000';

/** No single at all: the next placement needs a pointing pair first. */
const DEDUCTION_POSITION =
  '800175402107020385502000107250684700000512000008030520085290610309000200020000000';

/*
 * Where a puzzle beyond the technique set stalls (seed 18 of `minimalPuzzles`,
 * after every placement the grader could make). r0c4 is the first cell with
 * only two naked candidates; r0c3 shows three, but the grader's eliminations
 * take it down to two as well — so a pick made after those would land on
 * r0c3, earlier in reading order, for no reason the player can see.
 */
const STALLED_POSITION =
  '025000679070609000906070000260450000514090006000061524000936240300000860602708003';
const STALLED_SOLUTION =
  '825314679471689352936572418268457931514293786793861524187936245349125867652748193';

describe('findHint', () => {
  it('points at the first wrong value in reading order, before anything else', () => {
    const values = parseGrid(WIKIPEDIA_PUZZLE);
    values[72] = 1; // should be 3
    values[2] = 1; // should be 4
    expect(findHint(createBoard(values), parseGrid(WIKIPEDIA_SOLUTION))).toEqual({
      kind: 'mistake',
      index: 2,
    });
  });

  it('points at a mistake on a full board rather than calling it complete', () => {
    const values = parseGrid(WIKIPEDIA_SOLUTION);
    values[40] = 9;
    expect(findHint(createBoard(values), parseGrid(WIKIPEDIA_SOLUTION))).toEqual({
      kind: 'mistake',
      index: 40,
    });
  });

  it('has nothing to suggest on a complete, correct board', () => {
    const solution = parseGrid(WIKIPEDIA_SOLUTION);
    expect(findHint(createBoard(solution), solution)).toEqual({ kind: 'none' });
  });

  it('names a full house with its unit', () => {
    const values = parseGrid(WIKIPEDIA_SOLUTION);
    values[40] = 0;
    expect(findHint(createBoard(values), parseGrid(WIKIPEDIA_SOLUTION))).toEqual<Hint>({
      kind: 'single',
      index: 40,
      technique: 'fullHouse',
      unit: { kind: 'row', index: 4 },
    });
  });

  it('names a hidden single in a box with its box', () => {
    expect(
      findHint(createBoard(gridValues(HARDEST.pointing.givens)), POINTING_SOLUTION),
    ).toEqual<Hint>({
      kind: 'single',
      index: 0,
      technique: 'hiddenSingleBox',
      unit: { kind: 'box', index: 0 },
    });
  });

  it('names a hidden single in a row with its row', () => {
    expect(
      findHint(createBoard(gridValues(LINE_SINGLE_POSITION)), POINTING_SOLUTION),
    ).toEqual<Hint>({
      kind: 'single',
      index: 56,
      technique: 'hiddenSingleLine',
      unit: { kind: 'row', index: 6 },
    });
  });

  it('names a naked single, which belongs to no unit', () => {
    expect(
      findHint(createBoard(gridValues(NAKED_SINGLE_POSITION)), POINTING_SOLUTION),
    ).toEqual<Hint>({
      kind: 'single',
      index: 49,
      technique: 'nakedSingle',
      unit: null,
    });
  });

  it('points past the singles to the next cell a deduction unlocks', () => {
    expect(findHint(createBoard(gridValues(DEDUCTION_POSITION)), POINTING_SOLUTION)).toEqual<Hint>({
      kind: 'deduction',
      index: 35,
      technique: 'pointing',
    });
  });

  it('falls back to the cell showing the fewest candidates when the techniques stall', () => {
    const values = gridValues(STALLED_POSITION);
    // The preconditions: from here the grader makes no placement at all, but
    // it does strike candidates from r0c3, which shows three to r0c5's two.
    const { steps, solveOrder } = grade(values);
    expect(solveOrder).toEqual([]);
    expect(steps.some((step) => step.eliminations.some(({ index }) => index === 3))).toBe(true);
    const naked = computeCandidates(values);
    expect([POPCOUNT[naked[3]], POPCOUNT[naked[5]]]).toEqual([3, 2]);
    // The pick goes by what the board shows, not by eliminations the hint
    // never explains (going by those would make it r0c3).
    expect(findHint(createBoard(values), gridValues(STALLED_SOLUTION))).toEqual<Hint>({
      kind: 'deduction',
      index: 5,
      technique: null,
    });
  });

  it('leaves the board it is given untouched', () => {
    const board = createBoard(gridValues(DEDUCTION_POSITION));
    const copy = cloneBoard(board);
    findHint(board, POINTING_SOLUTION);
    expect(formatGrid(board.values)).toBe(DEDUCTION_POSITION);
    expect(board).toEqual(copy);
  });

  it('accepts plain arrays', () => {
    expect(
      findHint(
        createBoard(Array.from(gridValues(LINE_SINGLE_POSITION))),
        Array.from(POINTING_SOLUTION),
      ),
    ).toMatchObject({ kind: 'single', index: 56 });
  });

  /*
   * The hint and the grader have to agree. Walking each fixture's solve while
   * it is still placing singles, the hint must name exactly the single the
   * grader takes next; where the grader first needs an elimination, the hint
   * must point at the grader's next placement, with the hardest technique it
   * took to get there.
   */
  it.each(ALL_FIXTURES)('agrees with the grader along the solve (%s)', (_, fixture) => {
    const { givens: values, solution } = solvedPuzzle(fixture);
    const { steps } = grade(values);
    for (let k = 0; k < steps.length; k++) {
      const step = steps[k];
      if (step.placement) {
        expect(findHint(createBoard(values), solution)).toEqual({
          kind: 'single',
          index: step.placement.index,
          technique: step.technique,
          unit: step.unit,
        });
        values[step.placement.index] = step.placement.digit;
        continue;
      }
      let hardest: TechniqueId | null = null;
      for (const later of steps.slice(k)) {
        hardest = harderTechnique(hardest, later.technique);
        if (later.placement) {
          expect(findHint(createBoard(values), solution)).toEqual({
            kind: 'deduction',
            index: later.placement.index,
            technique: hardest,
          });
          return;
        }
      }
      expect(findHint(createBoard(values), solution)).toMatchObject({
        kind: 'deduction',
        technique: null,
      });
      return;
    }
  });
});
