import { techniqueExample } from './examples';
import { TECHNIQUE_ORDER } from './grader';
import { ALL_DIGITS, BOX, ROW, bit, isPeer, lowestDigit, unitCells } from './grid';
import { isStepValid, reliance, stepOn } from './patterns';
import {
  TECHNIQUES,
  cloneBoard,
  createBoard,
  type SolveStep,
  type SolverBoard,
} from './techniques';
import type { Digit, TechniqueId, Unit } from './types';
import { HARDEST, minimalPuzzles, solvedPuzzle } from '../test/logic-fixtures';

/** A technique's worked example, as a board and a step that are safe to change. */
function example(id: TechniqueId): { board: SolverBoard; step: SolveStep } {
  const { values, candidates, step } = techniqueExample(id);
  return {
    board: { values: values.slice(), candidates: candidates.slice() },
    step: JSON.parse(JSON.stringify(step)) as SolveStep,
  };
}

/** The first cell, in reading order, that passes `test`. */
function firstCell(test: (index: number) => boolean): number {
  const index = Array.from({ length: 81 }, (_, i) => i).find(test);
  if (index === undefined) throw new Error('No cell fits');
  return index;
}

/** A digit a cell does not hold on `board`, added to its candidates; returns its bit. */
function addDigit(board: SolverBoard, index: number, avoiding = 0): number {
  const extra = bit(lowestDigit(ALL_DIGITS & ~(board.candidates[index] | avoiding)));
  board.candidates[index] |= extra;
  return extra;
}

const isIn = (index: number, unit: Unit) => unitCells(unit).includes(index);
const union = (step: SolveStep) => step.pattern.reduce((mask, p) => mask | p.mask, 0);
const cellsOf = (step: SolveStep) => step.pattern.map((p) => p.index);

/** Every step the grader takes solving `givens`, with the board just before it. */
function solveSteps(givens: Uint8Array): { before: SolverBoard; step: SolveStep }[] {
  const board = createBoard(givens);
  const found: { before: SolverBoard; step: SolveStep }[] = [];
  for (;;) {
    const before = cloneBoard(board);
    let step: SolveStep | null = null;
    for (const id of TECHNIQUE_ORDER) {
      step = TECHNIQUES[id](board);
      if (step) break;
    }
    if (step === null) return found;
    found.push({ before, step });
  }
}

/*
 * Real steps for the properties below: a few dozen random minimal puzzles,
 * stalled ones included, and a puzzle that needs each technique — so every
 * technique turns up.
 */
const CORPUS = [...minimalPuzzles(40), ...Object.values(HARDEST).map(solvedPuzzle)].flatMap(
  ({ givens }) => solveSteps(givens),
);

describe('isStepValid', () => {
  it.each(TECHNIQUE_ORDER)('accepts the worked example of %s', (id) => {
    const { board, step } = example(id);
    expect(isStepValid(board, step)).toBe(true);
  });

  it('accepts every step the grader makes, on the board it made it on', () => {
    const rejected = CORPUS.filter(({ before, step }) => !isStepValid(before, step));
    expect(rejected.map(({ step }) => step.technique)).toEqual([]);
    expect(new Set(CORPUS.map(({ step }) => step.technique)).size).toBe(TECHNIQUE_ORDER.length);
  });

  /*
   * Each case misdescribes a worked example — or changes the board under it —
   * in one way, and the step must no longer pass.
   */
  it.each<[TechniqueId, string, (step: SolveStep, board: SolverBoard) => void]>([
    // Any step
    ['pointing', 'describes no pattern', (step) => (step.pattern = [])],
    ['pointing', 'lists a pattern cell twice', (step) => step.pattern.push(step.pattern[0])],
    [
      'pointing',
      'puts a filled cell in its pattern',
      (step, board) => (board.values[step.pattern[0].index] = 1),
    ],
    ['pointing', 'claims a cell holds no digit', (step) => (step.pattern[0].mask = 0)],
    [
      'nakedPair',
      'claims a candidate its cell lacks',
      (step) => (step.pattern[0].mask = ALL_DIGITS),
    ],
    ['pointing', 'names a unit other than its first house', (step) => (step.unit = step.houses[1])],
    ['xWing', 'names a unit, which no fish has', (step) => (step.unit = step.houses[0])],
    ['hiddenSingleBox', 'names no unit', (step) => (step.unit = null)],

    // Singles
    ['fullHouse', 'places nothing', (step) => (step.placement = null)],
    [
      'nakedSingle',
      'removes candidates as well as placing',
      (step) => (step.eliminations = [{ index: step.placement!.index, mask: 1 }]),
    ],
    ['hiddenSingleLine', 'says it is about another digit', (step) => (step.digit = 10 as never)],
    [
      'fullHouse',
      'describes a second cell',
      (step, board) => {
        const other = firstCell((i) => board.values[i] === 0 && i !== step.placement!.index);
        step.pattern.push({ index: other, mask: board.candidates[other] });
      },
    ],
    [
      'hiddenSingleBox',
      'describes a cell other than the one it fills',
      (step) => (step.placement!.index = (step.placement!.index + 1) % 81),
    ],
    [
      'hiddenSingleBox',
      'shows more of its cell than the digit',
      (step, board) => (step.pattern[0].mask = board.candidates[step.pattern[0].index]),
    ],
    [
      'nakedSingle',
      'gives a naked single a house',
      (step) => {
        const unit: Unit = { kind: 'row', index: ROW[step.placement!.index] };
        step.unit = unit;
        step.houses = [unit];
      },
    ],
    [
      'nakedSingle',
      'fills a cell that has another candidate',
      (step, board) => void addDigit(board, step.placement!.index),
    ],
    [
      'hiddenSingleBox',
      'names a second house',
      (step) => step.houses.push({ kind: 'row', index: ROW[step.placement!.index] }),
    ],
    [
      'hiddenSingleLine',
      'names a house its cell is not in',
      (step) => {
        const unit = { ...step.houses[0], index: (step.houses[0].index + 1) % 9 };
        step.unit = unit;
        step.houses = [unit];
      },
    ],
    [
      'fullHouse',
      'leaves another gap in its house',
      (step, board) => {
        const other = unitCells(step.houses[0]).find((i) => i !== step.placement!.index)!;
        board.values[other] = 0;
      },
    ],
    [
      'hiddenSingleBox',
      'finds its single in a row',
      (step) => {
        const unit: Unit = { kind: 'row', index: ROW[step.placement!.index] };
        step.unit = unit;
        step.houses = [unit];
      },
    ],
    [
      'hiddenSingleLine',
      'finds its single in a box',
      (step) => {
        const unit: Unit = { kind: 'box', index: BOX[step.placement!.index] };
        step.unit = unit;
        step.houses = [unit];
      },
    ],
    [
      'hiddenSingleBox',
      'places a digit with another place in its house',
      (step, board) => {
        const other = unitCells(step.houses[0]).find((i) => i !== step.placement!.index)!;
        board.candidates[other] |= bit(step.digit!);
      },
    ],

    // Any elimination step
    [
      'pointing',
      'places a digit as well',
      (step) => (step.placement = { index: step.pattern[0].index, digit: step.digit! }),
    ],
    ['claiming', 'removes nothing', (step) => (step.eliminations = [])],
    ['claiming', 'lists a cell twice', (step) => step.eliminations.push(step.eliminations[0])],
    ['claiming', 'removes no digit from a cell', (step) => (step.eliminations[0].mask = 0)],
    [
      'pointing',
      'removes a candidate that is not there',
      (step) => (step.eliminations[0].mask = ALL_DIGITS),
    ],

    // Locked candidates
    ['pointing', 'names one house', (step) => (step.houses = [step.houses[0]])],
    ['claiming', 'is about no digit', (step) => (step.digit = null)],
    ...(['pointing', 'claiming'] as const).map(
      (id): [TechniqueId, string, (step: SolveStep) => void] => [
        id,
        'names its houses the wrong way round',
        (step) => {
          step.houses.reverse();
          step.unit = step.houses[0];
        },
      ],
    ),
    ['pointing', 'finds a single cell', (step) => (step.pattern = [step.pattern[0]])],
    [
      'pointing',
      'has one place left in its box',
      (step, board) => {
        // A hidden single, really: the pattern is every place the box has
        // for the digit, so only the rule of two can turn it down.
        for (const { index } of step.pattern.slice(1)) board.candidates[index] &= ~bit(step.digit!);
        step.pattern = [step.pattern[0]];
      },
    ],
    [
      'claiming',
      'leaves a candidate out of its pattern',
      (step, board) => {
        const other = unitCells(step.houses[0]).find((i) => !cellsOf(step).includes(i))!;
        board.candidates[other] |= bit(step.digit!);
      },
    ],
    [
      'pointing',
      'shows another digit in a pattern cell',
      (step, board) => {
        const [first] = step.pattern;
        addDigit(board, first.index);
        first.mask = board.candidates[first.index];
      },
    ],
    [
      'pointing',
      'strays out of its line',
      (step) => (step.houses[1] = { ...step.houses[1], index: (step.houses[1].index + 1) % 9 }),
    ],
    [
      'claiming',
      'removes another digit',
      (step, board) => {
        const [first] = step.eliminations;
        addDigit(board, first.index);
        first.mask = board.candidates[first.index];
      },
    ],
    [
      'pointing',
      'strikes its own box',
      (step) => step.eliminations.push({ index: step.pattern[0].index, mask: bit(step.digit!) }),
    ],
    [
      'pointing',
      'strikes outside its line',
      (step, board) => {
        const [from, to] = step.houses;
        const index = firstCell((i) => board.values[i] === 0 && !isIn(i, from) && !isIn(i, to));
        board.candidates[index] |= bit(step.digit!);
        step.eliminations.push({ index, mask: bit(step.digit!) });
      },
    ],

    // Subsets
    ['nakedPair', 'names a second house', (step) => step.houses.push({ kind: 'box', index: 0 })],
    ['hiddenPair', 'is about one digit', (step) => (step.digit = 1)],
    ['nakedTriple', 'describes too few cells', (step) => step.pattern.pop()],
    [
      'hiddenPair',
      'holds more digits than cells',
      (step, board) => (step.pattern[0].mask = board.candidates[step.pattern[0].index]),
    ],
    [
      'nakedPair',
      'strays out of its house',
      (step) => {
        const unit = { ...step.houses[0], index: (step.houses[0].index + 1) % 9 };
        step.unit = unit;
        step.houses = [unit];
      },
    ],
    [
      'nakedPair',
      'leaves out a candidate of a cell',
      (step, board) => void addDigit(board, step.pattern[0].index),
    ],
    [
      'nakedTriple',
      'strikes its own cells',
      (step) => step.eliminations.push({ ...step.pattern[0] }),
    ],
    [
      'nakedPair',
      'strikes outside its house',
      (step, board) => {
        const index = firstCell((i) => board.values[i] === 0 && !isIn(i, step.houses[0]));
        board.candidates[index] |= union(step);
        step.eliminations.push({ index, mask: union(step) });
      },
    ],
    [
      'nakedPair',
      'strikes a digit outside the pair',
      (step, board) => {
        const [first] = step.eliminations;
        first.mask |= addDigit(board, first.index, union(step));
      },
    ],
    [
      'hiddenTriple',
      'hides digits that have other places',
      (step, board) => {
        const other = unitCells(step.houses[0]).find((i) => !cellsOf(step).includes(i))!;
        board.candidates[other] |= union(step);
      },
    ],
    [
      'hiddenPair',
      'leaves out a digit of the pair',
      (step) => (step.pattern[0].mask = bit(lowestDigit(step.pattern[0].mask))),
    ],
    [
      'hiddenPair',
      'strikes outside its cells',
      (step, board) => {
        const index = unitCells(step.houses[0]).find((i) => !cellsOf(step).includes(i))!;
        const mask = addDigit(board, index, union(step));
        step.eliminations.push({ index, mask });
      },
    ],
    [
      'hiddenTriple',
      'strikes a digit of the triple',
      (step, board) => {
        const [first] = step.eliminations;
        first.mask |= board.candidates[first.index] & union(step);
      },
    ],

    // Fish
    ['xWing', 'is about no digit', (step) => (step.digit = null)],
    ['swordfish', 'forgets a cover line', (step) => step.houses.pop()],
    [
      'xWing',
      'takes a box for a base line',
      (step) => (step.houses[0] = { kind: 'box', index: 0 }),
    ],
    [
      'xWing',
      'mixes rows and columns in its base',
      (step) => (step.houses[1] = { ...step.houses[2] }),
    ],
    [
      'xWing',
      'covers with a line like its base lines',
      (step) => (step.houses[2] = { ...step.houses[0], index: (step.houses[0].index + 4) % 9 }),
    ],
    ['swordfish', 'covers with a box', (step) => (step.houses[3] = { kind: 'box', index: 0 })],
    ['xWing', 'names a line twice', (step) => (step.houses[1] = { ...step.houses[0] })],
    ...([0, 1] as const).map(
      (left): [TechniqueId, string, (step: SolveStep, board: SolverBoard) => void] => [
        'xWing',
        left === 0
          ? 'has no place left for the digit in a base line (it is placed there already)'
          : 'has one place left for the digit in a base line',
        (step, board) => {
          // The other base line and the eliminations are left as they were:
          // with no place in the first line, nothing stops the digit taking
          // a cover line's place outside the base lines.
          const first = step.pattern.filter((p) => isIn(p.index, step.houses[0]));
          for (const { index } of first.slice(left)) board.candidates[index] &= ~bit(step.digit!);
          step.pattern = step.pattern.filter((p) => !first.slice(left).includes(p));
        },
      ],
    ),
    [
      'swordfish',
      'leaves a candidate out of its base lines',
      (step, board) => {
        const other = unitCells(step.houses[0]).find((i) => !cellsOf(step).includes(i))!;
        board.candidates[other] |= bit(step.digit!);
      },
    ],
    [
      'xWing',
      'shows another digit in a pattern cell',
      (step, board) => {
        const [first] = step.pattern;
        addDigit(board, first.index);
        first.mask = board.candidates[first.index];
      },
    ],
    [
      'xWing',
      'strays out of its cover lines',
      (step) => {
        const taken = step.houses.slice(2).map((u) => u.index);
        const index = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((i) => !taken.includes(i))!;
        step.houses[2] = { ...step.houses[2], index };
      },
    ],
    [
      'swordfish',
      'names a cover line it has no cell in',
      (step, board) => {
        const cover = step.houses[3];
        for (const { index } of step.pattern) {
          if (isIn(index, cover)) board.candidates[index] &= ~bit(step.digit!);
        }
        step.pattern = step.pattern.filter((p) => !isIn(p.index, cover));
      },
    ],
    [
      'swordfish',
      'removes another digit',
      (step, board) => {
        const [first] = step.eliminations;
        addDigit(board, first.index);
        first.mask = board.candidates[first.index];
      },
    ],
    [
      'xWing',
      'strikes its own base line',
      (step) => step.eliminations.push({ index: step.pattern[0].index, mask: bit(step.digit!) }),
    ],
    [
      'xWing',
      'strikes outside its cover lines',
      (step, board) => {
        const index = firstCell(
          (i) => board.values[i] === 0 && !step.houses.some((unit) => isIn(i, unit)),
        );
        board.candidates[index] |= bit(step.digit!);
        step.eliminations.push({ index, mask: bit(step.digit!) });
      },
    ],

    // Wings
    [
      'xyWing',
      'names a house',
      (step) => {
        const unit: Unit = { kind: 'row', index: ROW[step.pattern[0].index] };
        step.unit = unit;
        step.houses = [unit];
      },
    ],
    ['xyzWing', 'is about one digit', (step) => (step.digit = 1)],
    ['xyWing', 'describes two cells', (step) => step.pattern.pop()],
    [
      'xyzWing',
      'leaves out a candidate of a cell',
      (step, board) => void addDigit(board, step.pattern[0].index),
    ],
    [
      'xyWing',
      'has a pivot of three digits',
      (step, board) => {
        const [pivot] = step.pattern;
        pivot.mask |= addDigit(board, pivot.index, union(step));
      },
    ],
    [
      'xyWing',
      'has a pincer the pivot cannot see',
      (step, board) => {
        const [pivot, first] = step.pattern;
        const index = firstCell(
          (i) => board.values[i] === 0 && !isPeer(pivot.index, i) && !cellsOf(step).includes(i),
        );
        board.candidates[index] = first.mask;
        step.pattern[1] = { index, mask: first.mask };
      },
    ],
    [
      'xyzWing',
      'has a pincer sharing one digit with the pivot',
      (step, board) => {
        const [pivot, first] = step.pattern;
        const outsider = bit(lowestDigit(ALL_DIGITS & ~pivot.mask));
        first.mask = bit(lowestDigit(first.mask & pivot.mask)) | outsider;
        board.candidates[first.index] = first.mask;
      },
    ],
    [
      'xyWing',
      'has pincers alike',
      (step, board) => {
        const [, first, second] = step.pattern;
        second.mask = first.mask;
        board.candidates[second.index] = first.mask;
      },
    ],
    [
      'xyWing',
      'has pincers with nothing in common outside the pivot',
      (step, board) => {
        const [pivot, , second] = step.pattern;
        const outsider = bit(lowestDigit(ALL_DIGITS & ~union(step)));
        second.mask = (second.mask & pivot.mask) | outsider;
        board.candidates[second.index] = second.mask;
      },
    ],
    [
      'xyzWing',
      'removes another digit',
      (step, board) => {
        const [first] = step.eliminations;
        addDigit(board, first.index);
        first.mask = board.candidates[first.index];
      },
    ],
    [
      'xyWing',
      'strikes a cell that does not see both pincers',
      (step, board) => {
        const [, first, second] = step.pattern;
        const z = first.mask & second.mask;
        const index = firstCell(
          (i) =>
            board.values[i] === 0 &&
            !cellsOf(step).includes(i) &&
            !(isPeer(first.index, i) && isPeer(second.index, i)),
        );
        board.candidates[index] |= z;
        step.eliminations.push({ index, mask: z });
      },
    ],
    // Chains
    ['skyscraper', 'names a unit, which no chain has', (step) => (step.unit = step.houses[0])],
    ['skyscraper', 'is about no digit', (step) => (step.digit = null)],
    ['skyscraper', 'describes three cells', (step) => step.pattern.pop()],
    [
      'skyscraper',
      'gives its strong links the wrong way round',
      (step) => step.houses.splice(0, 2, step.houses[1], step.houses[0]),
    ],
    [
      'skyscraper',
      'joins its bases through a box',
      (step) => (step.houses[2] = { kind: 'box', index: BOX[step.pattern[1].index] }),
    ],
    [
      'skyscraper',
      'strikes a cell that sees one end only',
      (step, board) => {
        const [first, , , last] = cellsOf(step);
        const index = firstCell(
          (i) =>
            board.values[i] === 0 &&
            isPeer(first, i) &&
            !isPeer(last, i) &&
            !cellsOf(step).includes(i),
        );
        board.candidates[index] |= bit(step.digit!);
        step.eliminations.push({ index, mask: bit(step.digit!) });
      },
    ],
    [
      'twoStringKite',
      'ties its strings together in a line rather than a box',
      (step) => (step.houses[2] = { kind: 'row', index: ROW[step.pattern[1].index] }),
    ],
    [
      'twoStringKite',
      'gives its strong links the wrong way round',
      (step) => step.houses.splice(0, 2, step.houses[1], step.houses[0]),
    ],
    [
      'xyChain',
      'names a house, which no XY-Chain has',
      (step) => (step.houses = [{ kind: 'row', index: ROW[step.pattern[0].index] }]),
    ],
    ['xyChain', 'is about no digit', (step) => (step.digit = null)],
    ['xyChain', 'describes three cells', (step) => step.pattern.pop()],
    [
      'xyChain',
      'starts from a digit its first cell would not leave the next',
      (step) => (step.digit = lowestDigit(step.pattern[0].mask & ~bit(step.digit!)) as Digit),
    ],
    [
      'xyChain',
      'counts a cell with a third candidate',
      (step, board) => (step.pattern[1].mask |= addDigit(board, step.pattern[1].index)),
    ],
    [
      'xyChain',
      'links two cells that do not see each other',
      (step, board) => {
        const [, , third, last] = step.pattern;
        const index = firstCell(
          (i) => board.values[i] === 0 && !isPeer(third.index, i) && !cellsOf(step).includes(i),
        );
        board.candidates[index] = last.mask;
        step.pattern[3] = { index, mask: last.mask };
      },
    ],
    [
      'xyChain',
      'ends on a cell that would not be its digit',
      (step, board) => {
        const last = step.pattern[3];
        const mask = (last.mask & ~bit(step.digit!)) | bit(lowestDigit(ALL_DIGITS & ~union(step)));
        board.candidates[last.index] = mask;
        last.mask = mask;
      },
    ],
    [
      'xyChain',
      'strikes a cell that sees one end only',
      (step, board) => {
        const [first, last] = [step.pattern[0].index, step.pattern[3].index];
        const index = firstCell(
          (i) =>
            board.values[i] === 0 &&
            isPeer(first, i) &&
            !isPeer(last, i) &&
            !cellsOf(step).includes(i),
        );
        board.candidates[index] |= bit(step.digit!);
        step.eliminations.push({ index, mask: bit(step.digit!) });
      },
    ],
  ])('rejects a %s step that %s', (id, _name, misdescribe) => {
    const { board, step } = example(id);
    misdescribe(step, board);
    expect(isStepValid(board, step)).toBe(false);
  });
});

describe('stepOn', () => {
  it('reads every step the grader makes exactly as the technique found it, on its own board', () => {
    const misread = CORPUS.filter(
      ({ before, step }) => JSON.stringify(stepOn(before, step)) !== JSON.stringify(step),
    );
    expect(misread.map(({ step }) => step.technique)).toEqual([]);
  });

  it('returns a single as it is', () => {
    const { board, step } = example('hiddenSingleLine');
    expect(stepOn(board, step)).toBe(step);
  });

  it('removes whatever else the pattern rules out on a board that kept more candidates', () => {
    // A hidden pair clears every other candidate from its cells.
    const { board, step } = example('hiddenPair');
    const [first] = step.pattern;
    const extra = addDigit(board, first.index, union(step));
    const read = stepOn(board, step);
    expect(isStepValid(board, read)).toBe(true);
    expect(read.pattern).toEqual(step.pattern);
    const struck = read.eliminations.find((e) => e.index === first.index)!;
    expect(struck.mask & extra).toBe(extra);
  });

  it('reads a pattern that no longer holds as it stands, for isStepValid to turn down', () => {
    // Another place for one of the pair's digits, and the pair is no more.
    const { board, step } = example('hiddenPair');
    const other = unitCells(step.houses[0]).find(
      (i) => board.values[i] === 0 && !cellsOf(step).includes(i),
    )!;
    board.candidates[other] |= union(step);
    const read = stepOn(board, step);
    expect(read.pattern.map((p) => p.index)).toContain(other);
    expect(isStepValid(board, read)).toBe(false);
  });
});

describe('reliance', () => {
  /** The facts a step relies on, one by one: a candidate that must be gone, or a cell that must be filled. */
  function factsOf(step: SolveStep): ({ index: number; digit: number } | { filled: number })[] {
    const { absent, filled } = reliance(step);
    return [
      ...absent.flatMap(({ index, mask }) =>
        [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => mask & bit(d)).map((digit) => ({ index, digit })),
      ),
      ...filled.map((index) => ({ filled: index })),
    ];
  }

  /**
   * The loosest board the step relies on: every cell it needs filled kept as
   * it was, and every other cell empty, with every candidate it does not
   * need gone — which keeps every candidate the step's own board had, and
   * then some.
   */
  function loosestBoard(before: SolverBoard, step: SolveStep): SolverBoard {
    const { absent, filled } = reliance(step);
    const gone = new Uint16Array(81);
    for (const { index, mask } of absent) gone[index] |= mask;
    const board: SolverBoard = { values: new Uint8Array(81), candidates: new Uint16Array(81) };
    for (let i = 0; i < 81; i++) {
      if (filled.includes(i)) board.values[i] = before.values[i];
      else board.candidates[i] = ALL_DIGITS & ~gone[i];
    }
    return board;
  }

  it('is all true on the board each step was made on', () => {
    const untrue = CORPUS.filter(({ before, step }) =>
      factsOf(step).some((fact) =>
        'filled' in fact
          ? before.values[fact.filled] === 0
          : (before.candidates[fact.index] & bit(fact.digit)) !== 0,
      ),
    );
    expect(untrue.map(({ step }) => step.technique)).toEqual([]);
  });

  it('is all a step needs: read on the loosest board it allows, every step still holds', () => {
    const failed = CORPUS.filter(({ before, step }) => {
      const board = loosestBoard(before, step);
      return !isStepValid(board, stepOn(board, step));
    });
    expect(failed.map(({ step }) => step.technique)).toEqual([]);
  });

  it('is nothing a step can do without: undo any one of it, and the step no longer holds', () => {
    const spared: string[] = [];
    for (const { before, step } of CORPUS) {
      for (const fact of factsOf(step)) {
        const board = loosestBoard(before, step);
        if ('filled' in fact) {
          board.values[fact.filled] = 0;
          board.candidates[fact.filled] = ALL_DIGITS;
        } else {
          board.candidates[fact.index] |= bit(fact.digit);
        }
        if (isStepValid(board, stepOn(board, step))) spared.push(step.technique);
      }
    }
    expect(spared).toEqual([]);
  });

  it.each<[TechniqueId, (step: SolveStep) => number[]]>([
    ['nakedSingle', (step) => [step.placement!.index]],
    [
      'hiddenSingleBox',
      (step) => unitCells(step.houses[0]).filter((i) => i !== step.placement!.index),
    ],
    ['pointing', (step) => unitCells(step.houses[0]).filter((i) => !isIn(i, step.houses[1]))],
    ['claiming', (step) => unitCells(step.houses[0]).filter((i) => !isIn(i, step.houses[1]))],
    ['nakedPair', (step) => cellsOf(step)],
    ['hiddenTriple', (step) => unitCells(step.houses[0]).filter((i) => !cellsOf(step).includes(i))],
    [
      'xWing',
      (step) =>
        step.houses
          .slice(0, 2)
          .flatMap((u) => unitCells(u))
          .filter((i) => !step.houses.slice(2).some((u) => isIn(i, u))),
    ],
    ['xyzWing', (step) => cellsOf(step)],
  ])('asks %s for candidates gone from the cells its pattern turns on', (id, cellsFor) => {
    const { step } = example(id);
    expect(reliance(step).absent.map((a) => a.index)).toEqual(cellsFor(step));
    expect(reliance(step).filled).toEqual([]);
  });

  it('asks a full house for the rest of its house filled', () => {
    const { step } = example('fullHouse');
    const others = unitCells(step.houses[0]).filter((i) => i !== step.placement!.index);
    expect(reliance(step)).toEqual({ absent: [], filled: others });
  });
});
