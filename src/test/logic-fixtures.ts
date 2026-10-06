import { digMinimal, generatePuzzle, randomSolution } from '../core/generator';
import { TECHNIQUE_ORDER } from '../core/grader';
import { ALL_DIGITS, PEERS, bit, gridValues, maskOf } from '../core/grid';
import { isStepValid } from '../core/patterns';
import { mulberry32 } from '../core/rng';
import {
  TECHNIQUES,
  cloneBoard,
  createBoard,
  type SolveStep,
  type SolverBoard,
} from '../core/techniques';
import type { Difficulty, TechniqueId } from '../core/types';

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

/**
 * Where a player got stuck — the report behind remembering each cell's
 * hint: the puzzle of share code `O3NLgKqUTeam9ygZMBQVALBbgSY`, sixteen
 * right entries in. The hint points at row 5, column 2 and names a hidden
 * pair, but the pair is in column 6, half a board away: a hint worth seeing
 * again without asking for it again.
 */
export const STUCK_ON_A_HIDDEN_PAIR = {
  code: 'O3NLgKqUTeam9ygZMBQVALBbgSY',
  givens: '000810040020000006340720900000430800000000107030000060700000003500100470000009050',
  solution: '956813742827954316341726985675431829284695137139287564712548693593162478468379251',
  /** The player's entries, in the order made: row and column (both from 1), and digit. */
  entries: [
    [1, 9, 2],
    [3, 6, 6],
    [3, 9, 5],
    [4, 8, 2],
    [4, 9, 9],
    [5, 4, 6],
    [5, 8, 3],
    [6, 7, 5],
    [6, 9, 4],
    [7, 4, 5],
    [7, 8, 9],
    [8, 2, 9],
    [8, 5, 6],
    [8, 9, 8],
    [9, 5, 7],
    [9, 9, 1],
  ] as const,
  /** The cell the hint points at: row 5, column 2. */
  target: 37,
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
 * what it removed (`isStepValid`): the technique guide draws those patterns
 * for players.
 *
 * Plain comparisons collected into strings, not `expect` per step: a few
 * hundred puzzles make for hundreds of thousands of checks.
 */

function checkStep(
  id: TechniqueId,
  step: SolveStep,
  before: SolverBoard,
  after: SolverBoard,
  solution: Uint8Array,
): string[] {
  const problems: string[] = [];
  if (step.technique !== id) problems.push(`${id} reported itself as ${step.technique}`);
  if (!isStepValid(before, step))
    problems.push(`${id} described a step its board does not bear out`);
  const expectedValues = before.values.slice();
  const expected = before.candidates.slice();
  if (step.placement) {
    const { index, digit } = step.placement;
    if (digit !== solution[index]) problems.push(`${id} placed ${digit} at ${index}`);
    expectedValues[index] = digit;
    expected[index] = 0;
    for (const peer of PEERS[index]) expected[peer] &= ~bit(digit);
  } else {
    for (const { index, mask } of step.eliminations) {
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
