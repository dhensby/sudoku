import { digMinimal, generatePuzzle, randomSolution } from '../core/generator';
import { TECHNIQUE_ORDER } from '../core/grader';
import {
  ALL_DIGITS,
  PEERS,
  POPCOUNT,
  bit,
  gridValues,
  isPeer,
  maskOf,
  unitCells,
} from '../core/grid';
import { mulberry32 } from '../core/rng';
import {
  TECHNIQUES,
  cloneBoard,
  createBoard,
  type SolveStep,
  type SolverBoard,
} from '../core/techniques';
import type { Difficulty, TechniqueId, Unit } from '../core/types';

/*
 * Fixtures for the technique, grader, generator and hint tests.
 *
 * Every puzzle here was dug by this project's own generator
 * (`digMinimal(randomSolution(mulberry32(seed)))`, seed noted alongside), so
 * the suite carries no third-party puzzle data.
 */

/** A puzzle and its unique solution, as grid strings. */
export interface PuzzleFixture {
  givens: string;
  solution: string;
}

/** A puzzle and its unique solution, as values. */
export interface SolvedPuzzle {
  givens: Uint8Array;
  solution: Uint8Array;
}

/**
 * Build a `SolverBoard` from a pencil-mark layout, for hand-built technique
 * fixtures. One whitespace-separated token per cell in reading order (`|` is
 * ignored, for marking boxes):
 *
 * - `.`     an empty cell with every candidate
 * - `127`   an empty cell with exactly these candidates
 * - `-5`    an empty cell with every candidate except these
 * - `=5`    a placed digit
 *
 * The layout is taken literally — a placed digit does not strip its peers —
 * so a fixture shows exactly the pattern under test and nothing else.
 */
export function pencilmarks(layout: string): SolverBoard {
  const tokens = layout.split(/[\s|]+/).filter(Boolean);
  if (tokens.length !== 81) throw new Error(`Expected 81 cells, got ${tokens.length}`);
  const board: SolverBoard = { values: new Uint8Array(81), candidates: new Uint16Array(81) };
  tokens.forEach((token, i) => {
    if (token === '.') {
      board.candidates[i] = ALL_DIGITS;
      return;
    }
    const match = /^(=[1-9]|-[1-9]+|[1-9]+)$/.exec(token);
    if (match === null) throw new Error(`Unexpected token '${token}' at cell ${i}`);
    const digits = maskOf([...token.replace(/^[=-]/, '')].map(Number));
    if (token.startsWith('=')) board.values[i] = Number(token.slice(1));
    else if (token.startsWith('-')) board.candidates[i] = ALL_DIGITS & ~digits;
    else board.candidates[i] = digits;
  });
  return board;
}

/** Values for a fixture. */
export function solvedPuzzle(fixture: PuzzleFixture): SolvedPuzzle {
  return { givens: gridValues(fixture.givens), solution: gridValues(fixture.solution) };
}

/** Random minimal puzzles from consecutive seeds — the raw material every tier is picked from. */
export function minimalPuzzles(count: number, firstSeed = 1): SolvedPuzzle[] {
  return Array.from({ length: count }, (_, k) => {
    const rng = mulberry32(firstSeed + k);
    const solution = randomSolution(rng);
    return { givens: digMinimal(solution, rng), solution };
  });
}

/** Generated puzzles of one tier from consecutive seeds. */
export function tierPuzzles(difficulty: Difficulty, count: number, firstSeed = 1): SolvedPuzzle[] {
  return Array.from({ length: count }, (_, k) =>
    solvedPuzzle(generatePuzzle(difficulty, mulberry32(firstSeed + k))),
  );
}

/**
 * A minimal puzzle whose hardest step is each technique (bar full house,
 * which no minimal puzzle can get by on). The rarer ones took thousands of
 * seeds to find: about 1 random minimal puzzle in 6,000 needs a swordfish.
 */
export const HARDEST: Readonly<Record<Exclude<TechniqueId, 'fullHouse'>, PuzzleFixture>> = {
  // seed 44
  hiddenSingleBox: {
    givens: '006010002500004000028730000000000000160000009000100006940380700070600250003000000',
    solution: '396518472517924638428736195289463517164857329735192846942385761871649253653271984',
  },
  // seed 1
  hiddenSingleLine: {
    givens: '004003009902010700130005060006109000000070200000000083000000300000906040000030070',
    solution: '854763129962418735137295864326189457598374216471652983615847392783926541249531678',
  },
  // seed 9
  nakedSingle: {
    givens: '001008590002000000000200107007000004034059000000000000000032000063807000900000240',
    solution: '641378592782195436359264187197623854834759621526481379415932768263847915978516243',
  },
  // seed 20
  pointing: {
    givens: '000005400107000380502000007000684700000010000008000520080090010309000200000000000',
    solution: '836175492147926385592348167251684739973512846468739521785293614319467258624851973',
  },
  // seed 22
  claiming: {
    givens: '040890073006000000009007408000500000000000037000041005900000020305074006007006000',
    solution: '142895673786413592539267418678532149451689237293741865964358721325174986817926354',
  },
  // seed 2
  nakedPair: {
    givens: '690420001008010000000030007520000006030000005040000900000000000709001040080040200',
    solution: '693427851278615394154938627527894136936172485841563972412359768769281543385746219',
  },
  // seed 65
  hiddenPair: {
    givens: '070520690000800000600003010060090030390000000400000008910046000005000400000080000',
    solution: '874521693132869547659473812567298134398154726421637958913746285785312469246985371',
  },
  // seed 80
  nakedTriple: {
    givens: '700000300020000071090608000506140000009000006000005000007009003000001008450300000',
    solution: '765214389824593671391678245586147932149832756273965814617489523932751468458326197',
  },
  // seed 550
  hiddenTriple: {
    givens: '000000000700010000040920860007000000300006070002040510000080006089000450060405000',
    solution: '926538741738614295541927863857291634314856972692743518475189326189362457263475189',
  },
  // seed 1291
  xWing: {
    givens: '500460000080001702090000000407620100000009004000000000300000059900200008120506000',
    solution: '532467981684951732791832465457628193863719524219345876376184259945273618128596347',
  },
  // seed 1864
  swordfish: {
    givens: '800100000300050080000000502000500400094000700560030000600020009015080204008000670',
    solution: '852179346349256187176348592783592461294861753561734928637425819915687234428913675',
  },
  // seed 15
  xyWing: {
    givens: '000030140700010060008040309007004090000300004000079200800007003950000020200100000',
    solution: '569738142734912865128645379387264591692351784415879236846527913951483627273196458',
  },
  // seed 178
  xyzWing: {
    givens: '090680003000000400000000086005026070000900100710500060030000905500000000007040030',
    solution: '294687513658213497173459286485126379362978154719534862831762945546391728927845631',
  },
};

/** A minimal puzzle (seed 3) that the technique set stalls on: it needs chains or worse. */
export const BEYOND_THE_SET: PuzzleFixture = {
  givens: '300420080000005000409680300100800096002000000806090000708001000000000803030000067',
  solution: '361429785287135649459687312173842596592716438846593271728361954615974823934258167',
};

/** All the puzzles above, labelled, for table-driven tests. */
export const ALL_FIXTURES: readonly (readonly [label: string, fixture: PuzzleFixture])[] = [
  ...Object.entries(HARDEST),
  ['beyond the set', BEYOND_THE_SET],
];

/*
 * The soundness harness. Solve a real puzzle with the techniques, easiest
 * first as the grader does, checking every attempt against the known solution
 * and against what the step actually did to the board. A grader bug of the
 * classic kind — a no-op step counted, a placement that guesses, an
 * elimination that strikes the answer, a step that changes more than it says,
 * a technique that touches the board and then reports nothing — comes back as
 * a list of violations rather than as a puzzle quietly rated wrong. So does a
 * step whose stated pattern is not really there, or does not really justify
 * what it removed: the technique guide draws those patterns for players.
 *
 * Plain comparisons collected into strings, not `expect` per step: a few
 * hundred puzzles make for hundreds of thousands of checks.
 */

/** The subset techniques: how many cells, and whether the subset is naked or hidden. */
const SUBSETS: Partial<Record<TechniqueId, { size: number; isNaked: boolean }>> = {
  nakedPair: { size: 2, isNaked: true },
  hiddenPair: { size: 2, isNaked: false },
  nakedTriple: { size: 3, isNaked: true },
  hiddenTriple: { size: 3, isNaked: false },
};

/** The fish techniques, by how many base lines they have. */
const FISH: Partial<Record<TechniqueId, number>> = { xWing: 2, swordfish: 3 };

const isLine = (unit: Unit) => unit.kind === 'row' || unit.kind === 'column';
const isIn = (index: number, unit: Unit) => unitCells(unit).includes(index);
const isSameSet = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** The cells of a house whose candidates on `board` include any of `mask`. */
function holders(board: SolverBoard, unit: Unit, mask: number): number[] {
  return unitCells(unit).filter((i) => (board.candidates[i] & mask) !== 0);
}

/**
 * Check what a step says lies behind it — its pattern, houses and digit —
 * against the board it was found on, independently of how the technique
 * searched: the pattern's candidates are really there, they really form the
 * technique's pattern, and every elimination is one that pattern justifies
 * (a subset never strikes its own cells, a fish never its base lines, a wing
 * only cells that see its pincers).
 */
function checkPattern(id: TechniqueId, step: SolveStep, before: SolverBoard): string[] {
  const problems: string[] = [];
  const fail = (what: string) => problems.push(`${id} ${what}`);
  const { pattern, houses, digit } = step;
  const cells = pattern.map((p) => p.index);
  const union = pattern.reduce((m, p) => m | p.mask, 0);

  if (pattern.length === 0) fail('described no pattern');
  if (new Set(cells).size !== cells.length) fail('listed a pattern cell twice');
  for (const { index, mask } of pattern) {
    if (before.values[index] !== 0) fail(`put the filled cell ${index} in its pattern`);
    if (mask === 0 || (before.candidates[index] & mask) !== mask) {
      fail(`claimed cell ${index} held ${mask}`);
    }
  }
  // `unit` is the house a hint names: the first of the houses, bar a fish's
  // lines, none of which is "the" house.
  const unit = FISH[id] ? null : (houses[0] ?? null);
  if (step.unit?.kind !== unit?.kind || step.unit?.index !== unit?.index) {
    fail('named a unit other than its first house');
  }

  if (step.placement) {
    const { index, digit: placed } = step.placement;
    if (digit !== placed) fail(`placed ${placed} but says it is about ${digit}`);
    if (pattern.length !== 1 || cells[0] !== index || pattern[0].mask !== bit(placed)) {
      fail('described a pattern other than the cell it filled');
    }
    if (id === 'nakedSingle') {
      if (houses.length !== 0) fail('gave a naked single a house');
      if (before.candidates[index] !== bit(placed)) fail(`placed at ${index}, which had others`);
      return problems;
    }
    const [house] = houses;
    if (houses.length !== 1 || !isIn(index, house)) return [...problems, `${id} left its house`];
    if (id === 'fullHouse') {
      if (unitCells(house).some((i) => i !== index && before.values[i] === 0)) {
        fail(`filled a house with another gap`);
      }
    } else {
      if ((house.kind === 'box') !== (id === 'hiddenSingleBox')) {
        fail(`found its single in a ${house.kind}`);
      }
      if (holders(before, house, bit(placed)).length !== 1) {
        fail(`placed a digit with other places`);
      }
    }
    return problems;
  }

  const struck = step.eliminations;
  const subset = SUBSETS[id];
  const fishSize = FISH[id];
  if (id === 'pointing' || id === 'claiming') {
    // Pointing: the box's candidates for the digit, all in one line, clear the
    // rest of that line. Claiming: the other way about.
    const [from, to] = houses;
    const isRightShape =
      houses.length === 2 &&
      digit !== null &&
      (id === 'pointing' ? from.kind === 'box' && isLine(to) : isLine(from) && to.kind === 'box');
    if (!isRightShape) return [...problems, `${id} gave the wrong houses or digit`];
    const d = bit(digit);
    if (!isSameSet(cells, holders(before, from, d)) || cells.length < 2) {
      fail(`described other than every candidate for ${digit} in its ${from.kind}`);
    }
    if (pattern.some((p) => p.mask !== d || !isIn(p.index, to))) {
      fail(`strayed out of its ${to.kind}`);
    }
    if (struck.some((e) => e.mask !== d || !isIn(e.index, to) || isIn(e.index, from))) {
      fail('struck outside the rest of its second house');
    }
  } else if (subset) {
    const [house] = houses;
    if (houses.length !== 1 || digit !== null) return [...problems, `${id} gave the wrong houses`];
    if (cells.length !== subset.size || POPCOUNT[union] !== subset.size) {
      fail(`described ${cells.length} cells holding ${POPCOUNT[union]} digits`);
    }
    if (cells.some((i) => !isIn(i, house))) fail('strayed out of its house');
    if (subset.isNaked) {
      // Naked: the cells hold nothing else, and their digits go from the rest of the house.
      if (pattern.some((p) => p.mask !== before.candidates[p.index])) fail('left out a candidate');
      if (struck.some((e) => cells.includes(e.index) || !isIn(e.index, house) || e.mask & ~union)) {
        fail('struck somewhere a naked subset does not reach');
      }
    } else {
      // Hidden: the digits go nowhere else in the house, and everything else goes from the cells.
      if (!isSameSet(cells, holders(before, house, union))) {
        fail('hid digits that have other places');
      }
      if (pattern.some((p) => p.mask !== (before.candidates[p.index] & union))) {
        fail('left out a subset digit');
      }
      if (struck.some((e) => !cells.includes(e.index) || e.mask & union)) {
        fail('struck somewhere a hidden subset does not reach');
      }
    }
  } else if (fishSize) {
    const base = houses.slice(0, fishSize);
    const cover = houses.slice(fishSize);
    const baseKind = base[0]?.kind;
    const isRightShape =
      digit !== null &&
      houses.length === 2 * fishSize &&
      isLine(base[0]) &&
      base.every((u) => u.kind === baseKind) &&
      cover.every((u) => isLine(u) && u.kind !== baseKind) &&
      new Set(houses.map((u) => `${u.kind}${u.index}`)).size === houses.length;
    if (!isRightShape) return [...problems, `${id} gave the wrong houses or digit`];
    const d = bit(digit);
    const inBase = (i: number) => base.some((u) => isIn(i, u));
    const inCover = (i: number) => cover.some((u) => isIn(i, u));
    const baseCells = base.flatMap((u) => holders(before, u, d));
    if (!isSameSet(cells, baseCells)) {
      fail(`described other than every candidate for ${digit} in its base lines`);
    }
    if (pattern.some((p) => p.mask !== d || !inCover(p.index))) {
      fail('strayed out of its cover lines');
    }
    if (cover.some((u) => !cells.some((i) => isIn(i, u)))) fail('named an empty cover line');
    if (struck.some((e) => e.mask !== d || inBase(e.index) || !inCover(e.index))) {
      fail('struck somewhere a fish does not reach');
    }
  } else {
    // XY-Wing: pivot {x, y}, pincers {x, z} and {y, z}; XYZ-Wing: pivot
    // {x, y, z}, pincers {x, z} and {y, z}. Either way z goes from every cell
    // that sees both pincers (and, for XYZ, the pivot).
    const isXyz = id === 'xyzWing';
    if (houses.length !== 0 || digit !== null || pattern.length !== 3) {
      return [...problems, `${id} gave the wrong houses, digit or cells`];
    }
    const [pivot, first, second] = pattern;
    if (pattern.some((p) => p.mask !== before.candidates[p.index])) fail('left out a candidate');
    const z = first.mask & second.mask & (isXyz ? ALL_DIGITS : ~pivot.mask);
    const isWing =
      POPCOUNT[pivot.mask] === (isXyz ? 3 : 2) &&
      [first, second].every(
        (p) =>
          POPCOUNT[p.mask] === 2 &&
          isPeer(pivot.index, p.index) &&
          POPCOUNT[p.mask & pivot.mask] === (isXyz ? 2 : 1),
      ) &&
      first.mask !== second.mask &&
      POPCOUNT[z] === 1;
    if (!isWing) fail('described no wing');
    const sees = (i: number) =>
      isPeer(first.index, i) && isPeer(second.index, i) && (!isXyz || isPeer(pivot.index, i));
    if (struck.some((e) => e.mask !== z || !sees(e.index))) {
      fail('struck somewhere its wing does not reach');
    }
  }
  return problems;
}

function checkStep(
  id: TechniqueId,
  step: SolveStep,
  before: SolverBoard,
  after: SolverBoard,
  solution: Uint8Array,
): string[] {
  const problems: string[] = [];
  if (step.technique !== id) problems.push(`${id} reported itself as ${step.technique}`);
  const expectedValues = before.values.slice();
  const expected = before.candidates.slice();
  if (step.placement) {
    const { index, digit } = step.placement;
    if (step.eliminations.length !== 0) problems.push(`${id} placed and eliminated at once`);
    if (digit !== solution[index]) problems.push(`${id} placed ${digit} at ${index}`);
    if ((before.candidates[index] & bit(digit)) === 0) {
      problems.push(`${id} placed a non-candidate at ${index}`);
    }
    expectedValues[index] = digit;
    expected[index] = 0;
    for (const peer of PEERS[index]) expected[peer] &= ~bit(digit);
  } else {
    if (step.eliminations.length === 0) problems.push(`${id} counted a step that did nothing`);
    const seen = new Set<number>();
    for (const { index, mask } of step.eliminations) {
      if (seen.has(index)) problems.push(`${id} listed cell ${index} twice`);
      seen.add(index);
      if (mask === 0 || (before.candidates[index] & mask) !== mask) {
        problems.push(`${id} claimed to remove ${mask} from ${index}`);
      }
      if (mask & bit(solution[index])) problems.push(`${id} struck the answer at ${index}`);
      expected[index] &= ~mask;
    }
  }
  if (!after.values.every((v, i) => v === expectedValues[i])) {
    problems.push(`${id} changed values it did not report`);
  }
  if (!after.candidates.every((m, i) => m === expected[i])) {
    problems.push(`${id} changed candidates it did not report`);
  }
  problems.push(...checkPattern(id, step, before));
  return problems;
}

/** What the harness found for one puzzle. */
export interface SoundnessReport {
  /** Every violation, described; empty when all is well. */
  problems: string[];
  /** The techniques that fired at least once. */
  fired: Set<TechniqueId>;
}

/** Solve a puzzle with every technique, checking each attempt. */
export function checkSoundness(puzzle: SolvedPuzzle): SoundnessReport {
  const problems: string[] = [];
  const fired = new Set<TechniqueId>();
  const board = createBoard(puzzle.givens);
  for (;;) {
    let step: SolveStep | null = null;
    for (const id of TECHNIQUE_ORDER) {
      const before = cloneBoard(board);
      step = TECHNIQUES[id](board);
      if (step === null) {
        const isUntouched =
          board.values.every((v, i) => v === before.values[i]) &&
          board.candidates.every((m, i) => m === before.candidates[i]);
        if (!isUntouched) problems.push(`${id} changed the board but reported nothing`);
        continue;
      }
      fired.add(id);
      problems.push(...checkStep(id, step, before, board, puzzle.solution));
      break;
    }
    if (step === null) break;
  }
  // Whatever is left, solved or stuck, must still hold the answer.
  for (let i = 0; i < 81; i++) {
    if (board.values[i] === 0 && (board.candidates[i] & bit(puzzle.solution[i])) === 0) {
      problems.push(`the answer at ${i} went missing`);
    }
  }
  return { problems, fired };
}
