import { isDeepStrictEqual } from 'node:util';
import { decodeGivens } from './codec';
import { EXAMPLE_PUZZLES } from './examples';
import { TECHNIQUE_TIER, grade } from './grader';
import { bit, computeCandidates, gridValues, maskOf, parseGrid } from './grid';
import { findHint } from './hint';
import { isStepValid } from './patterns';
import { solve } from './solver';
import {
  TECHNIQUES,
  createBoard,
  eliminate,
  place,
  type SolveStep,
  type Technique,
} from './techniques';
import type { Hint, SingleTechniqueId, TechniqueId, Unit } from './types';
import {
  explainCell,
  explainHint,
  replaySteps,
  sliceSolve,
  solveToCell,
  walkthroughHint,
  type Walkthrough,
} from './walkthrough';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import {
  BEYOND_THE_SET,
  EXPERT_SAMPLE,
  STUCK_ON_A_HIDDEN_PAIR,
  minimalPuzzles,
  solvedPuzzle,
  stuckOnAHiddenPair,
  tierPuzzles,
  type SolvedPuzzle,
} from '../test/logic-fixtures';

const row = (index: number): Unit => ({ kind: 'row', index });
const column = (index: number): Unit => ({ kind: 'column', index });
const box = (index: number): Unit => ({ kind: 'box', index });
/** A cell by its row and column, counted from one as the game shows them. */
const rc = (r: number, c: number) => (r - 1) * 9 + c - 1;

/** `givens` plus the first `count` placements the grader makes solving it. */
function afterPlacements(givens: Uint8Array, count: number): Uint8Array {
  const values = givens.slice();
  const placements = grade(givens).steps.filter((step) => step.placement !== null);
  for (const { placement } of placements.slice(0, count))
    values[placement!.index] = placement!.digit;
  return values;
}

/** The minimal puzzle of one seed — `digMinimal(randomSolution(mulberry32(seed)))`. */
function seeded(seed: number): SolvedPuzzle {
  return minimalPuzzles(1, seed)[0];
}

/**
 * Everything wrong with a walkthrough, checked from scratch: replayed from
 * `values`, every step must be drawn on exactly the board the earlier ones
 * leave, hold there, agree with the solution and never strike it, and the
 * last must fill `target` with its solution digit.
 */
function problemsWith(
  walkthrough: Walkthrough,
  values: Uint8Array,
  solution: Uint8Array,
  target: number,
): string[] {
  const problems: string[] = [];
  const board = createBoard(values);
  walkthrough.steps.forEach(({ values: shown, candidates, step }, k) => {
    const at = `step ${k + 1} (${step.technique})`;
    if (!shown.every((v, i) => v === board.values[i])) problems.push(`${at} shows other values`);
    if (!candidates.every((m, i) => m === board.candidates[i])) {
      problems.push(`${at} shows other candidates`);
    }
    if (!isStepValid(board, step)) problems.push(`${at} does not hold`);
    if (step.placement) {
      const { index, digit } = step.placement;
      if (digit !== solution[index]) problems.push(`${at} places ${digit} at ${index}`);
      place(board, index, digit);
    }
    for (const { index, mask } of step.eliminations) {
      if (mask & bit(solution[index])) problems.push(`${at} strikes the answer at ${index}`);
      eliminate(board, index, mask);
    }
  });
  const last = walkthrough.steps.at(-1)?.step.placement;
  if (last?.index !== target || last.digit !== solution[target]) problems.push('ends elsewhere');
  if (walkthrough.target !== target || walkthrough.digit !== solution[target]) {
    problems.push('names another cell or digit');
  }
  return problems;
}

describe('the stored Expert sample', () => {
  // The sweeps below read their Expert puzzles from EXPERT_SAMPLE instead of
  // generating them. Make sure each is still a sound Expert: one solution,
  // the one stored, and a fish or wing needed with 40 cells still open.
  it.each(EXPERT_SAMPLE.map((fixture, k) => [k, fixture] as const))(
    'holds a genuine Expert puzzle at %i',
    (_k, fixture) => {
      const { givens, solution } = solvedPuzzle(fixture);
      expect(solve(givens)).toEqual(solution);
      const result = grade(givens);
      expect(result.difficulty).toBe('expert');
      let empty = givens.filter((v) => v === 0).length;
      for (const step of result.steps) {
        if (TECHNIQUE_TIER[step.technique] === 'expert') break;
        if (step.placement) empty--;
      }
      expect(empty).toBeGreaterThanOrEqual(40);
    },
  );
});

describe('explainCell', () => {
  describe('where the player got stuck on a hidden pair', () => {
    const { values, solution } = stuckOnAHiddenPair();
    const { target } = STUCK_ON_A_HIDDEN_PAIR;

    it('is the puzzle of the shared link, with the hint the player saw', () => {
      expect(decodeGivens(STUCK_ON_A_HIDDEN_PAIR.code)).toBe(STUCK_ON_A_HIDDEN_PAIR.givens);
      expect(solve(gridValues(STUCK_ON_A_HIDDEN_PAIR.givens))).toEqual(solution);
      expect(findHint(values, solution)).toEqual<Hint>({
        kind: 'deduction',
        index: target,
        technique: 'hiddenPair',
      });
    });

    it('shows exactly the hidden pair, the pointing pair it opens and the single that leaves', () => {
      const walkthrough = explainCell(values, target, solution)!;
      expect(walkthrough.target).toBe(target);
      expect(walkthrough.digit).toBe(8);
      expect(walkthrough.steps.map((trace) => trace.step)).toEqual<SolveStep[]>([
        {
          // 1 and 7 fit only r4c6 and r6c6 of column 6, which lose a 5, a 2 and an 8.
          technique: 'hiddenPair',
          placement: null,
          eliminations: [
            { index: rc(4, 6), mask: bit(5) },
            { index: rc(6, 6), mask: maskOf([2, 8]) },
          ],
          unit: column(5),
          pattern: [
            { index: rc(4, 6), mask: maskOf([1, 7]) },
            { index: rc(6, 6), mask: maskOf([1, 7]) },
          ],
          houses: [column(5)],
          digit: null,
        },
        {
          // Box 5's 5s are then all in row 5, which clears them from r5c2 and r5c3.
          technique: 'pointing',
          placement: null,
          eliminations: [
            { index: rc(5, 2), mask: bit(5) },
            { index: rc(5, 3), mask: bit(5) },
          ],
          unit: box(4),
          pattern: [
            { index: rc(5, 5), mask: bit(5) },
            { index: rc(5, 6), mask: bit(5) },
          ],
          houses: [box(4), row(4)],
          digit: 5,
        },
        {
          // Which leaves r5c2 only an 8.
          technique: 'nakedSingle',
          placement: { index: target, digit: 8 },
          eliminations: [],
          unit: null,
          pattern: [{ index: target, mask: bit(8) }],
          houses: [],
          digit: 8,
        },
      ]);
    });

    it('draws each step on the real board, with the candidates the earlier steps leave', () => {
      const [first, second, third] = explainCell(values, target, solution)!.steps;
      for (const trace of [first, second, third]) expect(trace.values).toEqual(values);
      // The digits on the board allow these — not the player's own notes.
      const naked = computeCandidates(values);
      expect(first.candidates).toEqual(naked);
      naked[rc(4, 6)] &= ~bit(5);
      naked[rc(6, 6)] &= ~maskOf([2, 8]);
      expect(second.candidates).toEqual(naked);
      naked[rc(5, 2)] &= ~bit(5);
      naked[rc(5, 3)] &= ~bit(5);
      expect(third.candidates).toEqual(naked);
    });

    it('leaves out the five steps the grader took first about other cells', () => {
      expect(solveToCell(values, target)!.steps.map((step) => step.technique)).toEqual([
        'pointing',
        'pointing',
        'pointing',
        'nakedPair',
        'nakedPair',
        'hiddenPair',
        'pointing',
      ]);
      expect(sliceSolve(solveToCell(values, target)!).kept).toEqual([5, 6]);
    });

    it('is the same for the hint, and without the solution on a board with no mistakes', () => {
      const walkthrough = explainCell(values, target, solution);
      expect(explainHint(values, findHint(values, solution), solution)).toEqual(walkthrough);
      expect(explainCell(values, target)).toEqual(walkthrough);
    });

    it('leaves the board it was given as it was', () => {
      const copy = values.slice();
      explainCell(values, target, solution);
      expect(values).toEqual(copy);
    });
  });

  describe('for a single', () => {
    it.each<SingleTechniqueId>(['fullHouse', 'hiddenSingleBox', 'hiddenSingleLine', 'nakedSingle'])(
      'is the %s the hint names, alone',
      (technique) => {
        // Each technique's worked example has a hint naming that technique.
        const values = gridValues(EXAMPLE_PUZZLES[technique]);
        const solution = solve(values)!;
        const hint = findHint(values, solution);
        if (hint.kind !== 'single') throw new Error(`No single on the ${technique} example`);
        expect(hint.technique).toBe(technique);
        const walkthrough = explainHint(values, hint, solution)!;
        expect(walkthrough.steps).toHaveLength(1);
        const [{ step, candidates }] = walkthrough.steps;
        expect(step.technique).toBe(technique);
        expect(step.unit).toEqual(hint.unit);
        expect(step.placement).toEqual({ index: hint.index, digit: solution[hint.index] });
        expect(candidates).toEqual(computeCandidates(values));
      },
    );

    it('fills the cell asked about, even where the grader would find another single first', () => {
      const values = parseGrid(WIKIPEDIA_PUZZLE);
      const solution = parseGrid(WIKIPEDIA_SOLUTION);
      const hint = findHint(values, solution) as Extract<Hint, { index: number }>;
      const other = Array.from({ length: 81 }, (_, i) => i).find(
        (i) => i !== hint.index && solveToCell(values, i)?.steps.length === 0,
      )!;
      const walkthrough = explainCell(values, other, solution)!;
      expect(walkthrough.steps).toHaveLength(1);
      expect(walkthrough.steps[0].step.placement).toEqual({ index: other, digit: solution[other] });
    });
  });

  describe('slicing', () => {
    it.each<[string, number, number, number, number, TechniqueId[]]>([
      ['a naked pair', 217, 9, 39, 10, ['nakedPair', 'hiddenSingleBox']],
      ['a hidden pair', 368, 9, 55, 8, ['hiddenPair', 'hiddenSingleBox']],
    ])(
      'cuts a long road to a hint’s cell down to %s and the single it opens',
      (_name, seed, placed, target, solveLength, techniques) => {
        const { givens, solution } = seeded(seed);
        const values = afterPlacements(givens, placed);
        expect(findHint(values, solution)).toMatchObject({ kind: 'deduction', index: target });
        expect(solveToCell(values, target)!.steps).toHaveLength(solveLength);
        const walkthrough = explainCell(values, target, solution)!;
        expect(walkthrough.steps.map((trace) => trace.step.technique)).toEqual(techniques);
        expect(problemsWith(walkthrough, values, solution, target)).toEqual([]);
      },
    );

    it.each<[string, string, string, number, TechniqueId, TechniqueId[], TechniqueId[]]>([
      [
        'a hidden triple',
        'KUw0eLMVOgDdSIEp1UURAqhKtbfOwiI',
        '000200090002000043089600271950810320803709060400300009090407000000100030001060002',
        rc(5, 9),
        'hiddenTriple',
        ['nakedPair', 'hiddenPair', 'pointing', 'hiddenTriple', 'nakedPair', 'nakedSingle'],
        ['hiddenTriple', 'nakedPair', 'nakedSingle'],
      ],
      [
        'a naked pair',
        'nVekpKrf0Q29GwMMBGaCADeyjFI',
        '000300106000710004010062037960580000000000070000040960054000600000001700002800000',
        rc(7, 6),
        'nakedPair',
        ['pointing', 'nakedPair', 'nakedSingle'],
        ['nakedPair', 'nakedSingle'],
      ],
    ])(
      'drops what the slice kept for %s that strikes it for itself, read on the board without it',
      (_name, code, grid, target, technique, sliced, techniques) => {
        const values = parseGrid(grid);
        const solution = solve(values)!;
        expect(decodeGivens(code)).toBe(grid);
        expect(findHint(values, solution)).toEqual<Hint>({
          kind: 'deduction',
          index: target,
          technique,
        });
        const cellSolve = solveToCell(values, target)!;
        const { final, kept } = sliceSolve(cellSolve);
        expect(
          [...kept.map((k) => cellSolve.steps[k]), final].map((step) => step.technique),
        ).toEqual(sliced);
        const walkthrough = explainCell(values, target, solution)!;
        expect(walkthrough.steps.map((trace) => trace.step.technique)).toEqual(techniques);
        expect(problemsWith(walkthrough, values, solution, target)).toEqual([]);
      },
    );

    it('has the hidden triple strike, for itself, the 6 the steps before it were for', () => {
      // In box 9, 4, 7 and 9 fit only r8c7, r8c9 and r9c7; on the board as
      // it stands, before any other step, that clears a 6 from r8c9 too.
      const values = parseGrid(
        '000200090002000043089600271950810320803709060400300009090407000000100030001060002',
      );
      const [first] = explainCell(values, rc(5, 9))!.steps;
      expect(first.step.houses).toEqual([box(8)]);
      expect(first.step.eliminations).toEqual([
        { index: rc(8, 7), mask: maskOf([5, 6, 8]) },
        { index: rc(8, 9), mask: maskOf([5, 6, 8]) },
        { index: rc(9, 7), mask: maskOf([5, 8]) },
      ]);
    });

    it('ends with whichever single needs the fewest steps', () => {
      // From the givens, row 8, column 2 ends the solve as a full house, a
      // hidden single in row 8 and a naked single; the full house needs the
      // most of the solve, the naked single the least.
      const { givens, solution } = seeded(1);
      const target = rc(8, 2);
      const solve = solveToCell(givens, target)!;
      expect(solve.steps).toHaveLength(47);
      const lengths = solve.finals.map((final) => sliceSolve({ ...solve, finals: [final] }).kept);
      expect(solve.finals.map((final) => final.technique)).toEqual([
        'fullHouse',
        'hiddenSingleLine',
        'nakedSingle',
      ]);
      expect(lengths.map((kept) => kept.length)).toEqual([44, 43, 42]);
      const { final, kept } = sliceSolve(solve);
      expect(final.technique).toBe('nakedSingle');
      expect(kept).toEqual(lengths[2]);
      const walkthrough = explainCell(givens, target, solution)!;
      expect(walkthrough.steps).toHaveLength(43);
      expect(walkthrough.steps.at(-1)!.step.technique).toBe('nakedSingle');
      expect(problemsWith(walkthrough, givens, solution, target)).toEqual([]);
    });

    it('ends, among singles that need as few, with the first the grader would try', () => {
      const { givens, solution } = seeded(1);
      const values = afterPlacements(givens, 21);
      const target = rc(8, 7);
      const solve = solveToCell(values, target)!;
      expect(solve.steps).toHaveLength(0);
      expect(solve.finals.map((final) => final.technique)).toEqual([
        'fullHouse',
        'hiddenSingleBox',
        'hiddenSingleLine',
        'nakedSingle',
      ]);
      expect(explainCell(values, target, solution)!.steps[0].step.technique).toBe('fullHouse');
    });

    /*
     * The properties the walkthrough rests on: the slice alone always holds,
     * so the fallback to the whole solve never has to step in; pruned, it
     * keeps nothing it can do without; and for the hint's cell it says what
     * the hint says. Positions part way through random minimal puzzles
     * (stalled ones included) and through Hard and Expert puzzles, for the
     * hint's cell and a spread of others.
     */
    it('never drops a step a cell needs, nor keeps one it does not, from hundreds of positions part-way through real puzzles', () => {
      const puzzles = [
        ...minimalPuzzles(30, 500),
        ...tierPuzzles('hard', 6, 700),
        // Stored, not generated: an Expert takes about a hundred attempts.
        ...EXPERT_SAMPLE.map(solvedPuzzle),
      ];
      const problems: string[] = [];
      let explained = 0;
      let shortened = 0;
      let hinted = 0;
      for (const [p, { givens, solution }] of puzzles.entries()) {
        const placements = grade(givens).solveOrder.length;
        for (const fraction of [0, 0.25, 0.5, 0.75]) {
          const values = afterPlacements(givens, Math.floor(placements * fraction));
          const hint = findHint(values, solution);
          const targets = Array.from({ length: 81 }, (_, i) => i).filter(
            (i) => values[i] === 0 && (i % 5 === p % 5 || ('index' in hint && i === hint.index)),
          );
          for (const target of targets) {
            const at = `puzzle ${p}, ${fraction} in, cell ${target}`;
            const solve = solveToCell(values, target);
            const walkthrough = explainCell(values, target, solution);
            if (solve === null) {
              if (walkthrough !== null) problems.push(`${at}: explained past a stall`);
              continue;
            }
            const { final, kept } = sliceSolve(solve);
            if (replaySteps(values, [...kept.map((k) => solve.steps[k]), final]) === null) {
              problems.push(`${at}: the slice does not hold`);
            }
            if (walkthrough === null) {
              problems.push(`${at}: no walkthrough`);
              continue;
            }
            explained++;
            if (walkthrough.steps.length < solve.steps.length + 1) shortened++;
            problems.push(
              ...problemsWith(walkthrough, values, solution, target).map((x) => `${at}: ${x}`),
            );
            // Nothing in it can go: without any one step but the last, the
            // rest no longer hold.
            const chain = walkthrough.steps.map((trace) => trace.step);
            for (let k = 0; k < chain.length - 1; k++) {
              if (
                replaySteps(
                  values,
                  chain.filter((_, j) => j !== k),
                ) !== null
              ) {
                problems.push(`${at}: step ${k + 1} is not needed`);
              }
            }
            // For the hint's cell, it says what the hint says.
            if ('index' in hint && target === hint.index) {
              hinted++;
              if (!isDeepStrictEqual(walkthroughHint(walkthrough), hint)) {
                problems.push(`${at}: says other than the hint`);
              }
            }
          }
        }
      }
      expect(problems).toEqual([]);
      // Enough to mean something, and slicing earning its keep on most of them.
      expect(explained).toBeGreaterThan(1000);
      expect(hinted).toBeGreaterThan(100);
      expect(shortened / explained).toBeGreaterThan(0.5);
    }, 60_000);
  });

  describe('has no walkthrough', () => {
    const { values, solution } = stuckOnAHiddenPair();

    it.each<[string, number]>([
      ['a cell before the grid', -1],
      ['a cell past the grid', 81],
      ['a fractional cell', 1.5],
      ['a cell that is not a number', Number.NaN],
      ['a filled cell', rc(1, 9)],
    ])('for %s', (_name, target) => {
      expect(explainCell(values, target, solution)).toBeNull();
    });

    it('for a cell the techniques stall before reaching', () => {
      // Every placement the grader can make, and then it is stuck.
      const values = afterPlacements(gridValues(BEYOND_THE_SET.givens), 81);
      const answer = gridValues(BEYOND_THE_SET.solution);
      const hint = findHint(values, answer);
      expect(hint).toMatchObject({ kind: 'deduction', technique: null });
      expect(explainHint(values, hint, answer)).toBeNull();
    });

    it('from a board with a mistake on it, when the solution is given', () => {
      const mistaken = values.slice();
      mistaken[rc(1, 1)] = 1; // should be 9
      expect(explainCell(mistaken, STUCK_ON_A_HIDDEN_PAIR.target, solution)).toBeNull();
    });

    it.each<Hint>([{ kind: 'mistake', index: 0 }, { kind: 'none' }])(
      'for a hint that fills nothing: %o',
      (hint) => {
        expect(explainHint(values, hint, solution)).toBeNull();
      },
    );
  });

  describe('when a step does not hold as recorded', () => {
    const { values, solution } = stuckOnAHiddenPair();
    const { target } = STUCK_ON_A_HIDDEN_PAIR;
    const techniques = TECHNIQUES as Record<TechniqueId, Technique>;

    /** Run `test` with a technique whose steps are changed by `misreport`. */
    function withMisreported(
      id: TechniqueId,
      misreport: (step: SolveStep) => void,
      test: () => void,
    ) {
      const original = techniques[id];
      const spy = vi.spyOn(techniques, id).mockImplementation((board) => {
        const step = original(board);
        if (step) misreport(step);
        return step;
      });
      try {
        test();
      } finally {
        spy.mockRestore();
      }
    }

    it('falls back to the whole solve, which still holds, rather than show a broken slice', () => {
      // The hidden pair strikes the 5 from r4c6 but leaves it out of its
      // report, so the slice cannot see that the pointing pair needs it.
      withMisreported(
        'hiddenPair',
        (step) => (step.eliminations = step.eliminations.filter((e) => e.index !== rc(4, 6))),
        () => {
          const solve = solveToCell(values, target)!;
          const { final, kept } = sliceSolve(solve);
          expect(kept).toEqual([6]);
          expect(replaySteps(values, [...kept.map((k) => solve.steps[k]), final])).toBeNull();
          // The whole solve, pruned, comes to the same three steps as ever.
          const walkthrough = explainCell(values, target, solution)!;
          expect(walkthrough.steps.map((trace) => trace.step.technique)).toEqual([
            'hiddenPair',
            'pointing',
            'nakedSingle',
          ]);
          expect(problemsWith(walkthrough, values, solution, target)).toEqual([]);
          // Read afresh on its board, the hidden pair strikes the 5 after all.
          expect(walkthrough.steps[0].step.eliminations).toContainEqual({
            index: rc(4, 6),
            mask: bit(5),
          });
        },
      );
    });

    it('has none when even the whole solve does not hold', () => {
      withMisreported(
        'pointing',
        (step) => step.houses.reverse(),
        () => {
          expect(explainCell(values, target, solution)).toBeNull();
        },
      );
    });
  });
});

describe('walkthroughHint', () => {
  const { values, solution } = stuckOnAHiddenPair();
  const { target } = STUCK_ON_A_HIDDEN_PAIR;

  it('puts a walkthrough of several steps as a deduction, naming the hardest of them', () => {
    expect(walkthroughHint(explainCell(values, target, solution)!)).toEqual<Hint>(
      findHint(values, solution),
    );
  });

  it('puts the hint afresh once the board has moved on, as the single it now takes', () => {
    // Two right digits later — row 5's 9 and 5 — the hidden pair is no
    // longer needed: row 5, column 2 has only its 8 left.
    const later = values.slice();
    later[rc(5, 5)] = 9;
    later[rc(5, 6)] = 5;
    expect(walkthroughHint(explainCell(later, target, solution)!)).toEqual<Hint>({
      kind: 'single',
      index: target,
      technique: 'nakedSingle',
      unit: null,
    });
  });

  it.each<SingleTechniqueId>(['fullHouse', 'hiddenSingleBox', 'hiddenSingleLine', 'nakedSingle'])(
    'puts a walkthrough of one step as the %s it is, in its house',
    (technique) => {
      const values = gridValues(EXAMPLE_PUZZLES[technique]);
      const solution = solve(values)!;
      const hint = findHint(values, solution);
      expect(walkthroughHint(explainHint(values, hint, solution)!)).toEqual(hint);
    },
  );
});
