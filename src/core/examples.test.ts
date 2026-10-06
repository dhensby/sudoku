import { EXAMPLE_PUZZLES, techniqueExample } from './examples';
import { TECHNIQUE_ORDER, grade, traceTechnique } from './grader';
import {
  BOX,
  COL,
  POPCOUNT,
  ROW,
  bit,
  computeCandidates,
  digitsOf,
  findConflicts,
  gridValues,
  isGridString,
  unitCells,
} from './grid';
import { findHint } from './hint';
import { hasUniqueSolution, solve } from './solver';
import type { SolveStep } from './techniques';
import type { TechniqueId, Unit } from './types';
import { checkSoundness } from '../test/logic-fixtures';

// Wrapped so a test can make tracing come up empty, which it never does for
// the stored boards — the error guards against a future change, not a known
// bug.
vi.mock('./grader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./grader')>();
  return { ...actual, traceTechnique: vi.fn(actual.traceTechnique) };
});

const cell = (i: number) => `r${ROW[i] + 1}c${COL[i] + 1}`;
const house = (u: Unit) => `${u.kind} ${u.index + 1}`;

/**
 * A step as one line, counting from one as the guide does: digit | houses |
 * pattern | what it did.
 */
function describeStep(step: SolveStep): string {
  const pattern = step.pattern.map((p) => `${cell(p.index)}{${digitsOf(p.mask).join('')}}`);
  const result = step.placement
    ? `${cell(step.placement.index)} = ${step.placement.digit}`
    : step.eliminations.map((e) => `${cell(e.index)} -${digitsOf(e.mask).join('')}`).join(', ');
  const houses = step.houses.map(house).join(', ') || '-';
  return `${step.digit ?? '-'} | ${houses} | ${pattern.join(' ')} | ${result}`;
}

/** Candidates removed by a step, counted digit by digit. */
const removedCount = (step: SolveStep) =>
  step.eliminations.reduce((n, e) => n + POPCOUNT[e.mask], 0);

/** The cells of a house that could still take a digit. */
const placesFor = (candidates: Uint16Array, unit: Unit, digit: number) =>
  unitCells(unit).filter((i) => candidates[i] & bit(digit)).length;

/** The row, column and box of a cell. */
const housesOf = (i: number): Unit[] => [
  { kind: 'row', index: ROW[i] },
  { kind: 'column', index: COL[i] },
  { kind: 'box', index: BOX[i] },
];

describe('EXAMPLE_PUZZLES', () => {
  it('has one board for every technique, in the order the grader tries them', () => {
    expect(Object.keys(EXAMPLE_PUZZLES)).toEqual(TECHNIQUE_ORDER);
  });

  it.each(TECHNIQUE_ORDER)('stores a valid puzzle with exactly one solution for %s', (id) => {
    const grid = EXAMPLE_PUZZLES[id];
    expect(isGridString(grid)).toBe(true);
    const values = gridValues(grid);
    expect(findConflicts(values).some(Boolean)).toBe(false);
    expect(hasUniqueSolution(values)).toBe(true);
  });

  it.each(TECHNIQUE_ORDER)('passes the soundness harness, pattern checks and all (%s)', (id) => {
    const givens = gridValues(EXAMPLE_PUZZLES[id]);
    const report = checkSoundness({ givens, solution: solve(givens)! });
    expect(report.problems).toEqual([]);
    expect(report.fired.has(id)).toBe(true);
  });
});

describe('techniqueExample', () => {
  /*
   * Each worked example pinned exactly, so a change to a technique's scan or
   * to what it reports cannot quietly change what the guide draws or says.
   * Read as: digit | houses | pattern | what it did.
   */
  it.each<[TechniqueId, string]>([
    ['fullHouse', '6 | row 5 | r5c8{6} | r5c8 = 6'],
    ['hiddenSingleBox', '7 | box 7 | r7c2{7} | r7c2 = 7'],
    ['hiddenSingleLine', '3 | row 4 | r4c5{3} | r4c5 = 3'],
    ['nakedSingle', '3 | - | r7c3{3} | r7c3 = 3'],
    ['pointing', '8 | box 1, row 1 | r1c2{8} r1c3{8} | r1c4 -8'],
    ['claiming', '4 | row 6, box 4 | r6c2{4} r6c3{4} | r5c2 -4'],
    ['nakedPair', '- | row 7 | r7c3{12} r7c5{12} | r7c4 -2, r7c6 -1'],
    ['hiddenPair', '- | row 1 | r1c3{57} r1c4{57} | r1c3 -9, r1c4 -9'],
    ['nakedTriple', '- | column 6 | r3c6{35} r4c6{15} r5c6{13} | r1c6 -15, r8c6 -1'],
    ['hiddenTriple', '- | column 8 | r6c8{89} r7c8{68} r8c8{689} | r6c8 -5, r7c8 -4'],
    ['xWing', '3 | row 2, row 7, column 4, column 9 | r2c4{3} r2c9{3} r7c4{3} r7c9{3} | r1c4 -3'],
    [
      'swordfish',
      '8 | row 2, row 4, row 7, column 2, column 3, column 4 | ' +
        'r2c2{8} r2c4{8} r4c3{8} r4c4{8} r7c2{8} r7c3{8} | r6c4 -8',
    ],
    ['xyWing', '- | - | r7c4{57} r6c4{35} r7c2{37} | r6c2 -3'],
    ['xyzWing', '- | - | r1c6{389} r1c7{89} r2c6{39} | r1c5 -9'],
    ['skyscraper', '7 | column 3, column 4, row 2 | r6c3{7} r2c3{7} r2c4{7} r5c4{7} | r5c1 -7'],
  ])('shows a %s exactly as the guide describes it', (id, expected) => {
    const { step } = techniqueExample(id);
    expect(step.technique).toBe(id);
    expect(describeStep(step)).toBe(expected);
  });

  it.each(TECHNIQUE_ORDER)(
    'shows %s as the very first step, on candidates the placed digits alone explain',
    (id) => {
      const values = gridValues(EXAMPLE_PUZZLES[id]);
      const trace = techniqueExample(id);
      expect(trace.values).toEqual(values);
      // No earlier elimination the reader cannot see: what the diagram shows
      // follows from the digits on it.
      expect(trace.candidates).toEqual(computeCandidates(values));
      expect(trace.step).toEqual(grade(values).steps[0]);
    },
  );

  it.each(TECHNIQUE_ORDER)('keeps the %s example small enough to follow', (id) => {
    const { step } = techniqueExample(id);
    const rows = new Set(step.pattern.map((p) => ROW[p.index])).size;
    const cols = new Set(step.pattern.map((p) => COL[p.index])).size;
    if (step.placement) {
      expect(step.pattern).toHaveLength(1);
      return;
    }
    // A few candidates go: enough to see, few enough to follow.
    expect(removedCount(step)).toBeGreaterThanOrEqual(1);
    expect(removedCount(step)).toBeLessThanOrEqual(4);
    const size: Partial<Record<TechniqueId, number>> = {
      pointing: 2,
      claiming: 2,
      nakedPair: 2,
      hiddenPair: 2,
      nakedTriple: 3,
      hiddenTriple: 3,
      xyWing: 3,
      xyzWing: 3,
      skyscraper: 4,
    };
    if (id === 'xWing') {
      expect([step.pattern.length, rows, cols]).toEqual([4, 2, 2]);
    } else if (id === 'swordfish') {
      expect([step.pattern.length, rows, cols]).toEqual([6, 3, 3]);
    } else {
      expect(step.pattern).toHaveLength(size[id]!);
    }
  });

  it('shows a naked single that no house would give away as a hidden one', () => {
    const { step, candidates } = techniqueExample('nakedSingle');
    const { index, digit } = step.placement!;
    for (const unit of housesOf(index)) {
      expect(placesFor(candidates, unit, digit)).toBeGreaterThan(1);
    }
  });

  it.each<[TechniqueId, Unit['kind'][]]>([
    ['hiddenSingleBox', ['box']],
    ['hiddenSingleLine', ['row']],
  ])('shows a %s that is a hidden single in its %s alone', (id, kinds) => {
    const { step, candidates } = techniqueExample(id);
    const { index, digit } = step.placement!;
    // More than one candidate, so it is no naked single either.
    expect(POPCOUNT[candidates[index]]).toBeGreaterThan(1);
    for (const unit of housesOf(index)) {
      expect(placesFor(candidates, unit, digit) === 1).toBe(kinds.includes(unit.kind));
    }
  });

  /*
   * The hint's "What's a …?" on an example's own board opens that example's
   * entry (the e2e suite leans on it). The swordfish is the exception: after
   * it, the next placement needs a skyscraper too, and a hint names the
   * hardest technique on the way.
   */
  it.each(TECHNIQUE_ORDER)('gives a hint on the %s board that names it', (id) => {
    const values = gridValues(EXAMPLE_PUZZLES[id]);
    const hint = findHint(values, solve(values)!);
    expect('technique' in hint ? hint.technique : undefined).toBe(
      id === 'swordfish' ? 'skyscraper' : id,
    );
  });

  it('throws if a stored board stops showing its technique', () => {
    vi.mocked(traceTechnique).mockReturnValueOnce(null);
    expect(() => techniqueExample('xWing')).toThrow('No xWing step in the stored xWing example');
  });
});
