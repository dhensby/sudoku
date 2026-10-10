// @vitest-environment node
import { generateDaily } from '../daily/generate';
import { BEYOND_THE_SET, STUCK_ON_AN_XY_CHAIN } from '../test/logic-fixtures';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import { decodeGivens } from './codec';
import { addDays } from './dates';
import { createGame, hintBoardOf, reduce, valuesOf, type GameAction, type GameState } from './game';
import {
  ALL_DIGITS,
  bit,
  computeCandidates,
  digitsOf,
  formatGrid,
  gridValues,
  parseGrid,
} from './grid';
import { findHint } from './hint';
import { mulberry32, seedFromString } from './rng';
import { createBoard, type SolveStep, type SolverBoard } from './techniques';
import type { Difficulty, Digit, Hint, Puzzle } from './types';
import { explainCell, explainHint } from './walkthrough';

/*
 * Hint and Show me reason from the candidates the player has (see
 * `hintBoardOf`), so that a step they have taken is not the one named again.
 * The report that asked for it: on the Expert daily of 10 October 2026, the
 * hint for row 2, column 1 named an XY-Chain, and Show me began with a
 * box/line reduction — column 8's 2s all lie in box 9, so remove 2 from row
 * 8, column 9 and row 9, column 9. Striking those 2s changed nothing.
 */

const { givens, solution: answer, entries, target, strikes } = STUCK_ON_AN_XY_CHAIN;
/** An Expert puzzle, for the stalls below. */
const EXPERT = generateDaily('2026-10-07', 'expert');
const REPORTED: Puzzle = { givens, solution: answer, difficulty: 'expert' };
const SOLUTION = gridValues(answer);

const cellAt = (row: number, col: number) => (row - 1) * 9 + col - 1;

const place = (index: number, digit: number): GameAction => ({
  type: 'enter',
  digit: digit as Digit,
  index,
  mode: 'normal',
});
const pencil = (index: number, digit: number): GameAction => ({
  type: 'enter',
  digit: digit as Digit,
  index,
  mode: 'candidate',
});

type Mode = 'auto' | 'notes';

/** A new game, in auto candidate mode, or with every candidate pencilled into every empty cell. */
function begin(puzzle: Puzzle, mode: Mode): GameState {
  let game = createGame(puzzle, { autoCandidates: mode === 'auto' });
  if (mode === 'auto') return game;
  const candidates = computeCandidates(valuesOf(game));
  for (let i = 0; i < 81; i++) {
    for (const digit of digitsOf(candidates[i])) game = reduce(game, pencil(i, digit));
  }
  return game;
}

/** The hint the game would give now. */
function hintOf(game: GameState, solution = SOLUTION): Hint {
  return findHint(hintBoardOf(game), solution);
}

/**
 * A step taken as a player takes it: each candidate it removes struck out (a
 * candidate-mode entry, in either mode), and its digit placed.
 */
function take(game: GameState, step: SolveStep): GameState {
  let next = game;
  for (const { index, mask } of step.eliminations) {
    for (const digit of digitsOf(mask)) next = reduce(next, pencil(index, digit));
  }
  return step.placement === null
    ? next
    : reduce(next, place(step.placement.index, step.placement.digit));
}

/** The reported position: the six hinted cells filled, following the hints. */
function stuck(mode: Mode): GameState {
  let game = begin(REPORTED, mode);
  for (const [row, col, digit] of entries) {
    expect((hintOf(game) as { index: number }).index).toBe(cellAt(row, col));
    game = reduce(game, place(cellAt(row, col), digit));
  }
  return game;
}

/** The reported position with the 2s the first step of Show me removes struck out. */
function struckOut(mode: Mode): GameState {
  return strikes.reduce(
    (game, [row, col, digit]) => reduce(game, pencil(cellAt(row, col), digit)),
    stuck(mode),
  );
}

const techniquesOf = (board: SolverBoard, cell = target) =>
  explainCell(board, cell, SOLUTION)!.steps.map(({ step }) => step.technique);

describe('the reported position', () => {
  it('is the Expert daily of 10 October 2026', () => {
    expect(generateDaily(STUCK_ON_AN_XY_CHAIN.date, 'expert')).toEqual(REPORTED);
    expect(decodeGivens(STUCK_ON_AN_XY_CHAIN.code)).toBe(givens);
  });
});

describe.each<Mode>(['auto', 'notes'])('hints from the player’s candidates (%s)', (mode) => {
  it('point at row 2, column 1, naming an XY-Chain, with Show me opening on the box/line reduction', () => {
    const game = stuck(mode);
    expect(hintOf(game)).toEqual({ kind: 'deduction', index: target, technique: 'xyChain' });
    const [first] = explainCell(hintBoardOf(game), target, SOLUTION)!.steps;
    expect(first.step).toMatchObject({
      technique: 'claiming',
      houses: [
        { kind: 'column', index: 7 },
        { kind: 'box', index: 8 },
      ],
      eliminations: strikes.map(([row, col, digit]) => ({
        index: cellAt(row, col),
        mask: bit(digit),
      })),
    });
  });

  it('move Show me on once the 2s are struck: it starts from the next step', () => {
    const game = struckOut(mode);
    expect(hintOf(game)).toMatchObject({ kind: 'deduction', index: target });
    expect(techniquesOf(hintBoardOf(game))).toEqual([
      'hiddenTriple',
      'pointing',
      'nakedPair',
      'xWing',
      'xyChain',
      'hiddenSingleBox',
    ]);
    // From the placed digits alone, as before, the strikes count for nothing.
    expect(techniquesOf(createBoard(valuesOf(game)))[0]).toBe('claiming');
  });

  it('turn into a hidden single in box 1 once every step on the route is taken', () => {
    let game = struckOut(mode);
    let steps = explainCell(hintBoardOf(game), target, SOLUTION)!.steps;
    while (steps.length > 1) {
      game = take(game, steps[0].step);
      const next = explainCell(hintBoardOf(game), target, SOLUTION)!.steps;
      // One step on each time: the one taken is never shown again.
      expect(next.map(({ step }) => step.technique)).toEqual(
        steps.slice(1).map(({ step }) => step.technique),
      );
      steps = next;
    }
    expect(hintOf(game)).toEqual({
      kind: 'single',
      index: target,
      technique: 'hiddenSingleBox',
      unit: { kind: 'box', index: 0 },
    });
  });
});

describe('the wrong-marks hint', () => {
  const EASY: Puzzle = {
    givens: formatGrid(parseGrid(WIKIPEDIA_PUZZLE)),
    solution: formatGrid(parseGrid(WIKIPEDIA_SOLUTION)),
    difficulty: 'easy',
  };
  const EASY_SOLUTION = parseGrid(WIKIPEDIA_SOLUTION);
  // Cell 2 (row 1, column 3): answer 4, candidates 1 2 4. Cell 3: answer 6,
  // candidates 2 6. Cell 40: answer 5.
  const easyHint = (game: GameState) => findHint(hintBoardOf(game), EASY_SOLUTION);

  it('points at the first cell whose answer is struck out, without the digit, before any single', () => {
    const game = reduce(createGame(EASY, { autoCandidates: true }), pencil(40, 5));
    expect(easyHint(game)).toEqual({ kind: 'struck', index: 40 });
    // The first in reading order.
    expect(easyHint(reduce(game, pencil(3, 6)))).toEqual({ kind: 'struck', index: 3 });
  });

  it('comes after a wrong digit, which every deduction would rest on too', () => {
    const game = reduce(
      reduce(createGame(EASY, { autoCandidates: true }), pencil(3, 6)),
      place(40, 9),
    );
    expect(easyHint(game)).toEqual({ kind: 'mistake', index: 40 });
  });

  it('is not given for a struck candidate that is not the answer', () => {
    const game = reduce(createGame(EASY, { autoCandidates: true }), pencil(2, 1));
    expect(easyHint(game).kind).toBe('single');
  });

  it('is given for notes that leave the answer out, and never for a cell with no notes', () => {
    const base = createGame(EASY);
    // No notes anywhere: every cell counts as having every candidate.
    expect(easyHint(base)).toEqual(findHint(createBoard(valuesOf(base)), EASY_SOLUTION));
    expect(easyHint(reduce(base, pencil(2, 1)))).toEqual({ kind: 'struck', index: 2 });
    expect(easyHint(reduce(reduce(base, pencil(2, 1)), pencil(2, 4))).kind).toBe('single');
  });

  it('takes notes a placed digit rules out as no candidates at all', () => {
    // 9 is no candidate of cell 2 (a 9 is placed in its box): the note leaves it nothing.
    const game = reduce(createGame(EASY), pencil(2, 9));
    expect(hintBoardOf(game).candidates[2]).toBe(0);
    expect(easyHint(game)).toEqual({ kind: 'struck', index: 2 });
  });

  it('holds Show me to the candidates once the solution has its say, and not before', () => {
    const game = reduce(createGame(EASY, { autoCandidates: true }), pencil(3, 6));
    const board = hintBoardOf(game);
    const hint: Hint = { kind: 'single', index: 40, technique: 'nakedSingle', unit: null };
    // Offered without the solution, whatever another cell's candidates hold…
    expect(explainHint(board, hint)).not.toBeNull();
    // …held to it when pressed.
    expect(explainCell(board, 40, EASY_SOLUTION)).toBeNull();
    // A wrong-marks hint has no walkthrough: its Show me is a page of its own.
    expect(explainHint(board, { kind: 'struck', index: 3 })).toBeNull();
  });
});

describe('when the techniques stall on the player’s candidates', () => {
  /** Every digit in every empty cell: no single, and nothing for a technique to find. */
  const everything = (values: Uint8Array): SolverBoard => ({
    values,
    candidates: Uint16Array.from(values, (value) => (value === 0 ? ALL_DIGITS : 0)),
  });

  it.each([
    ['a single', EXPERT],
    ['a cell with the fewest candidates, where the placed digits stall too', BEYOND_THE_SET],
  ])('gives the hint the placed digits alone give: %s', (_name, { givens, solution }) => {
    const values = gridValues(givens);
    const answers = gridValues(solution);
    const placed = findHint(createBoard(values), answers);
    expect(findHint(everything(values), answers)).toEqual(placed);
  });
});

describe('following hints from the player’s candidates', () => {
  /**
   * Play as a player who leans on hints: fill a single's cell, and for a
   * deduction take the first step of its Show me — every step from the
   * board as they have it. Every strike and every digit is checked against
   * the solution; the game must end solved, with no wrong-marks hint ever
   * needed.
   */
  function followHints(puzzle: Puzzle, mode: Mode): { steps: number; problems: string[] } {
    const solution = gridValues(puzzle.solution);
    let game = begin(puzzle, mode);
    const problems: string[] = [];
    let steps = 0;
    while (game.status === 'playing' && steps < 400 && problems.length === 0) {
      steps++;
      const hint = hintOf(game, solution);
      if (hint.kind !== 'single' && hint.kind !== 'deduction') {
        problems.push(`step ${steps}: ${JSON.stringify(hint)}`);
        break;
      }
      const walkthrough = explainCell(hintBoardOf(game), hint.index, solution);
      if (walkthrough === null || walkthrough.digit !== solution[hint.index]) {
        problems.push(`step ${steps}: no sound walkthrough for ${hint.index}`);
        break;
      }
      const { step } = walkthrough.steps[0];
      for (const { index, mask } of step.eliminations) {
        if ((mask & bit(solution[index])) !== 0) problems.push(`step ${steps}: struck an answer`);
      }
      game = take(game, step);
    }
    if (game.status !== 'solved') problems.push(`unsolved after ${steps} steps`);
    return { steps, problems };
  }

  it.each<[Difficulty, Mode, number]>([
    ['expert', 'auto', 31],
    ['expert', 'notes', 4],
    ['hard', 'notes', 4],
    ['medium', 'auto', 4],
  ])(
    'never strikes an answer and always solves: %s dailies, %s',
    (tier, mode, days) => {
      const problems: string[] = [];
      for (let day = 0; day < days; day++) {
        const date = addDays('2026-10-07', day);
        const puzzle = generateDaily(date, tier);
        problems.push(...followHints(puzzle, mode).problems.map((p) => `${date}: ${p}`));
      }
      expect(problems).toEqual([]);
    },
    120_000,
  );
});

describe('Show me on candidates with answers struck out', () => {
  it('never fails, whatever is struck: it is offered before the solution has its say', () => {
    // Show me is worked out on every change, from the board as the player
    // has it — wrong marks and all — so it must never throw on one.
    const rng = mulberry32(seedFromString('struck/robust'));
    let walkthroughs = 0;
    for (const start of [stuck('auto'), begin(EXPERT, 'auto')]) {
      let game = start;
      for (let round = 0; round < 40; round++) {
        const empties = game.cells.flatMap((cell, i) => (cell.value === 0 ? [i] : []));
        const index = empties[Math.floor(rng() * empties.length)];
        const digits = digitsOf(hintBoardOf(game).candidates[index]);
        if (digits.length > 0) {
          game = reduce(game, pencil(index, digits[Math.floor(rng() * digits.length)]));
        }
        const board = hintBoardOf(game);
        for (const target of empties) {
          if (explainCell(board, target) !== null) walkthroughs++;
        }
      }
    }
    expect(walkthroughs).toBeGreaterThan(0);
  });
});
