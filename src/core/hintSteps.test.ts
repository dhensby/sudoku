// @vitest-environment node
import { generateDaily } from '../daily/generate';
import { BEYOND_THE_SET, STUCK_ON_AN_XY_CHAIN } from '../test/logic-fixtures';
import { addDays } from './dates';
import { createGame, hintBoardOf, reduce, valuesOf, type GameAction, type GameState } from './game';
import { ALL_DIGITS, bit, computeCandidates, digitsOf, gridValues } from './grid';
import { findHint, findStepHint } from './hint';
import { createBoard, type SolveStep, type SolverBoard } from './techniques';
import type { Digit, Hint, Puzzle } from './types';
import {
  explainCell,
  explainHint,
  showMeRoute,
  stepHint,
  stepId,
  stepNumbering,
} from './walkthrough';

/*
 * A hint names the next step towards a cell (see `findStepHint`): the owner's
 * report, on the Expert daily of 10 October 2026 — row 2, column 1, seven
 * steps away, the first a box/line reduction in column 8 — paged through a
 * hint at a time, each step taken as the player would take it.
 */

const { givens, solution: answer, entries, target, strikes } = STUCK_ON_AN_XY_CHAIN;
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

/** A new game, in auto candidate mode, or with every candidate pencilled in. */
function begin(puzzle: Puzzle, mode: Mode): GameState {
  let game = createGame(puzzle, { autoCandidates: mode === 'auto' });
  if (mode === 'auto') return game;
  const candidates = computeCandidates(valuesOf(game));
  for (let i = 0; i < 81; i++) {
    for (const digit of digitsOf(candidates[i])) game = reduce(game, pencil(i, digit));
  }
  return game;
}

/** The reported position: the six hinted cells filled. */
function stuck(mode: Mode): GameState {
  return entries.reduce(
    (game, [row, col, digit]) => reduce(game, place(cellAt(row, col), digit)),
    begin(REPORTED, mode),
  );
}

/** A step taken as a player takes it: what it removes struck out, its digit placed. */
function take(game: GameState, step: SolveStep): GameState {
  let next = game;
  for (const { index, mask } of step.eliminations) {
    for (const digit of digitsOf(mask)) next = reduce(next, pencil(index, digit));
  }
  return step.placement === null
    ? next
    : reduce(next, place(step.placement.index, step.placement.digit));
}

/** The hint the game would give, as the app asks for it: on from the last hint about `prefer`. */
function stepOf(game: GameState, prefer = -1, solution = SOLUTION): Hint {
  return findStepHint(hintBoardOf(game), solution, {
    prefer,
    previous: (index) => game.cellHints.get(index)?.fill ?? null,
  });
}

/** Ask for the hint, as the app does, and record it. */
function ask(game: GameState, prefer = -1, solution = SOLUTION): GameState {
  return reduce(game, { type: 'hint', hint: stepOf(game, prefer, solution) });
}

describe.each<Mode>(['auto', 'notes'])('the next step towards a cell (%s)', (mode) => {
  it('names the first step of seven for row 2, column 1, and the hardest of them', () => {
    const game = stuck(mode);
    const [first] = explainCell(hintBoardOf(game), target, SOLUTION)!.steps;
    expect(stepOf(game)).toEqual<Hint>({
      kind: 'step',
      index: target,
      technique: 'claiming',
      unit: { kind: 'column', index: 7 },
      step: 1,
      of: 7,
      hardest: 'xyChain',
      id: stepId(first.step),
    });
  });

  it('moves on as each step is made, numbered against the route as first shown, to the single', () => {
    let game = ask(stuck(mode));
    for (const [row, col, digit] of strikes) game = reduce(game, pencil(cellAt(row, col), digit));
    const named: string[] = [];
    for (;;) {
      game = ask(game, target);
      const hint = game.hint!;
      if (hint.kind !== 'step') throw new Error(JSON.stringify(hint));
      named.push(`${hint.step} of ${hint.of}: ${hint.technique}`);
      if (hint.step === hint.of) break;
      game = take(game, explainCell(hintBoardOf(game), target, SOLUTION)!.steps[0].step);
    }
    expect(named).toEqual([
      '2 of 7: hiddenTriple',
      '3 of 7: pointing',
      '4 of 7: nakedPair',
      '5 of 7: xWing',
      '6 of 7: xyChain',
      '7 of 7: hiddenSingleBox',
    ]);
    // One for the first step, and one for each step after it.
    expect(game.assists.hints).toBe(7);
    expect(game.hint).toMatchObject({
      unit: { kind: 'box', index: 0 },
      hardest: 'hiddenSingleBox',
    });
  });
});

describe('findStepHint', () => {
  it('leaves a mistake, a missing candidate and a full board to findHint', () => {
    const game = stuck('auto');
    const wrong = reduce(game, place(cellAt(1, 2), 1));
    expect(stepOf(wrong)).toEqual(findHint(hintBoardOf(wrong), SOLUTION));
    expect(stepOf(wrong).kind).toBe('mistake');
    const struck = reduce(game, pencil(target, 9));
    expect(stepOf(struck)).toEqual({ kind: 'struck', index: target });
    const full = createBoard(SOLUTION);
    expect(findStepHint(full, SOLUTION)).toEqual({ kind: 'none' });
  });

  it('numbers a route afresh, and stays nowhere, when asked with nothing but the board', () => {
    expect(findStepHint(hintBoardOf(stuck('auto')), SOLUTION)).toMatchObject({
      index: target,
      step: 1,
      of: 7,
    });
  });

  it('puts a single as a route of one step', () => {
    const game = begin(REPORTED, 'auto');
    const single = findHint(hintBoardOf(game), SOLUTION);
    expect(single.kind).toBe('single');
    expect(stepOf(game)).toMatchObject({
      kind: 'step',
      index: (single as { index: number }).index,
      technique: (single as { technique: string }).technique,
      step: 1,
      of: 1,
    });
  });

  describe('when the techniques stall on the player’s candidates', () => {
    /** Every digit in every empty cell: no single, and nothing for a technique to find. */
    const everything = (values: Uint8Array): SolverBoard => ({
      values,
      candidates: Uint16Array.from(values, (value) => (value === 0 ? ALL_DIGITS : 0)),
    });

    it.each([
      ['the placed digits’ own hint', generateDaily('2026-10-07', 'expert')],
      ['the cell with the fewest candidates, with no technique', BEYOND_THE_SET],
    ])('gives findHint’s: %s', (_name, { givens: start, solution }) => {
      const values = gridValues(start);
      const answers = gridValues(solution);
      expect(findStepHint(everything(values), answers)).toEqual(
        findHint(everything(values), answers),
      );
    });
  });

  describe('staying on the cell the last hint was about', () => {
    const hinted = ask(stuck('auto'));

    it('stays while its route is no longer than the steps it had left', () => {
      // An 8 at row 4, column 1: from scratch, a naked pair for row 4, column 2.
      const game = reduce(hinted, place(cellAt(4, 1), 8));
      expect(findHint(hintBoardOf(game), SOLUTION)).toMatchObject({ index: cellAt(4, 2) });
      expect(stepOf(game, target)).toMatchObject({ index: target, step: 1, of: 7 });
      // Asked for without it, the hint goes where findHint points.
      expect(stepOf(game)).toMatchObject({ index: cellAt(4, 2) });
    });

    it('goes elsewhere once its route is longer than the steps it had left', () => {
      // A 2 at row 1, column 9: row 2, column 9 a hidden single, and row 2,
      // column 1 seventeen steps away.
      const game = reduce(hinted, place(cellAt(1, 9), 2));
      expect(explainCell(hintBoardOf(game), target)!.steps).toHaveLength(17);
      expect(stepOf(game, target)).toMatchObject({ index: cellAt(2, 9), step: 1, of: 1 });
    });

    it.each<[string, (game: GameState) => GameState, number]>([
      ['a cell with no step hint', (game) => game, cellAt(4, 2)],
      ['a cell that is filled', (game) => reduce(game, place(target, 9)), target],
      ['a cell off the grid', (game) => game, 81],
    ])('stays on nothing for %s', (_name, change, prefer) => {
      const game = change(reduce(hinted, place(cellAt(4, 1), 8)));
      expect(stepOf(game, prefer)).toEqual(stepOf(game));
    });
  });
});

describe('stepNumbering', () => {
  const previous: Hint = {
    kind: 'step',
    index: 9,
    technique: 'pointing',
    unit: null,
    step: 3,
    of: 7,
    hardest: 'xyChain',
    id: 1,
  };

  it('numbers a route against the route as first shown for its cell', () => {
    expect(stepNumbering(previous, 9, 4)).toEqual({ step: 4, of: 7 });
    expect(stepNumbering(previous, 9, 5)).toEqual({ step: 3, of: 7 });
    // A step or two taken a shorter way.
    expect(stepNumbering(previous, 9, 2)).toEqual({ step: 6, of: 7 });
    expect(stepNumbering(previous, 9, 7)).toEqual({ step: 1, of: 7 });
  });

  it.each<[string, Hint | null, number, number]>([
    ['with no hint before', null, 9, 4],
    ['after a hint of another kind', { kind: 'deduction', index: 9, technique: null }, 9, 4],
    ['for another cell', previous, 10, 4],
    ['for a route longer than the first plan', previous, 9, 8],
  ])('starts afresh %s', (_name, before, index, length) => {
    expect(stepNumbering(before, index, length)).toEqual({ step: 1, of: length });
  });
});

describe('showMeRoute', () => {
  it('walks the cell’s route from the board Hint reasons from, numbered on from its step hint', () => {
    const hinted = reduce(stuck('auto'), {
      type: 'hint',
      hint: findStepHint(hintBoardOf(stuck('auto')), SOLUTION),
    });
    expect(showMeRoute(hinted, target, SOLUTION)?.numbering).toEqual({ step: 1, of: 7 });
    // The first step taken: six steps left, still counted against seven.
    const taken = strikes.reduce(
      (game, [row, col, digit]) => reduce(game, pencil(cellAt(row, col), digit)),
      hinted,
    );
    const route = showMeRoute(taken, target, SOLUTION)!;
    expect(route.walkthrough).toEqual(explainCell(hintBoardOf(taken), target, SOLUTION));
    expect(route.walkthrough.steps).toHaveLength(6);
    expect(route.numbering).toEqual({ step: 2, of: 7 });
  });

  it('numbers afresh for a cell with no step hint', () => {
    expect(showMeRoute(stuck('auto'), target, SOLUTION)?.numbering).toEqual({ step: 1, of: 7 });
  });

  it('finds none from a mistake, as Show me then points at it instead', () => {
    // Row 2, column 2's 3 changed to a 4.
    const cell = cellAt(2, 2);
    const game = reduce(stuck('auto'), place(cell, (SOLUTION[cell] % 9) + 1));
    expect(showMeRoute(game, target, SOLUTION)).toBeNull();
  });
});

describe('stepId', () => {
  const steps = () =>
    explainCell(hintBoardOf(stuck('auto')), target, SOLUTION)!.steps.map(({ step }) => step);

  it('tells every step of a route from the others, and fits 24 bits', () => {
    const ids = steps().map(stepId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id >>> 24).toBe(0);
  });

  it('is what a step is, not what is left of it to do', () => {
    const [first] = steps();
    expect(stepId({ ...first, eliminations: first.eliminations.slice(1) })).toBe(stepId(first));
    // Half the step made: read again on that board, it is still that step.
    const half = reduce(stuck('auto'), pencil(cellAt(8, 9), 2));
    const [again] = explainCell(hintBoardOf(half), target, SOLUTION)!.steps;
    expect(again.step.eliminations).toHaveLength(1);
    expect(stepId(again.step)).toBe(stepId(first));
  });

  it.each<[string, Partial<SolveStep>]>([
    ['technique', { technique: 'pointing' }],
    ['houses', { houses: [{ kind: 'column', index: 6 }] }],
    ['digit', { digit: 3 }],
  ])('changes with its %s', (_name, change) => {
    const [first] = steps();
    expect(stepId({ ...first, ...change })).not.toBe(stepId(first));
  });

  /** The reported position with its first step made: next, a hidden triple in row 4. */
  const struck = () =>
    strikes.reduce(
      (game, [row, col, digit]) => reduce(game, pencil(cellAt(row, col), digit)),
      stuck('auto'),
    );
  const firstOf = (game: GameState) =>
    explainCell(hintBoardOf(game), target, SOLUTION)!.steps[0].step;

  it('stays the same step when a candidate of its pattern goes that the deduction does not need', () => {
    // A box/line reduction: its digit's cells in column 8, one fewer, still locked in box 9.
    const [first] = steps();
    expect(first.technique).toBe('claiming');
    expect(stepId({ ...first, pattern: first.pattern.slice(1) })).toBe(stepId(first));
    // The hidden triple in row 4 (r4c4 3 7 9, r4c6 7 9, r4c9 3 9): r4c4's 9,
    // which is not its answer, struck out — the same triple, the same id.
    const triple = firstOf(struck());
    expect(triple.technique).toBe('hiddenTriple');
    expect(SOLUTION[cellAt(4, 4)]).not.toBe(9);
    const lesser = firstOf(reduce(struck(), pencil(cellAt(4, 4), 9)));
    expect(lesser.technique).toBe('hiddenTriple');
    expect(lesser.pattern).not.toEqual(triple.pattern);
    expect(stepId(lesser)).toBe(stepId(triple));
  });

  it('so a hint asked again once such a candidate is struck names the same step, for free', () => {
    const named = ask(
      strikes.reduce(
        (game, [row, col, digit]) => reduce(game, pencil(cellAt(row, col), digit)),
        ask(stuck('auto')),
      ),
      target,
    );
    expect(named.hint).toMatchObject({ technique: 'hiddenTriple', step: 2, of: 7 });
    const again = ask(reduce(named, pencil(cellAt(4, 4), 9)), target);
    expect(again.hint).toEqual(named.hint);
    expect(again.assists.hints).toBe(named.assists.hints);
  });

  it('changes with a subset’s cells or digits, and with any candidate of a wing’s or chain’s pattern', () => {
    const triple = firstOf(struck());
    const [a, b, c] = triple.pattern;
    expect(stepId({ ...triple, pattern: [a, b] })).not.toBe(stepId(triple));
    expect(stepId({ ...triple, pattern: [a, b, { ...c, mask: c.mask | bit(1) }] })).not.toBe(
      stepId(triple),
    );
    const chain = steps().find(({ technique }) => technique === 'xyChain')!;
    const [end, ...rest] = chain.pattern;
    expect(stepId({ ...chain, pattern: [{ ...end, mask: bit(9) }, ...rest] })).not.toBe(
      stepId(chain),
    );
  });
});

describe('stepHint', () => {
  it('puts the last step, the single, as the last of the route', () => {
    let game = stuck('auto');
    let walkthrough = explainCell(hintBoardOf(game), target, SOLUTION)!;
    const first = stepHint(walkthrough);
    while (walkthrough.steps.length > 1) {
      game = take(game, walkthrough.steps[0].step);
      walkthrough = explainCell(hintBoardOf(game), target, SOLUTION)!;
    }
    expect(stepHint(walkthrough, first)).toMatchObject({
      technique: 'hiddenSingleBox',
      step: 7,
      of: 7,
      hardest: 'hiddenSingleBox',
    });
  });

  it('is shown by Show me, as the other fill hints are', () => {
    const board = hintBoardOf(stuck('auto'));
    const hint = stepHint(explainCell(board, target, SOLUTION)!);
    expect(explainHint(board, hint)).toEqual(explainCell(board, target));
  });
});

describe('following step hints on the dailies', () => {
  /**
   * Play as a player who leans on hints: a hint, then the step it names,
   * taken — from the board as they have it — then a hint again, on from the
   * last. Every hint is a step whose route Show me walks; the steps left are
   * always that route's length; no answer is ever struck; and the game ends
   * solved.
   */
  it.each<[Mode, number]>([
    ['auto', 6],
    ['notes', 2],
  ])(
    'always names the step Show me starts with, and always solves: Expert dailies, %s',
    (mode, days) => {
      const problems: string[] = [];
      for (let day = 0; day < days; day++) {
        const date = addDays('2026-10-07', day);
        const puzzle = generateDaily(date, 'expert');
        const solution = gridValues(puzzle.solution);
        let game = begin(puzzle, mode);
        let prefer = -1;
        for (let n = 0; game.status === 'playing' && n < 600; n++) {
          game = ask(game, prefer, solution);
          const hint = game.hint!;
          const walkthrough = explainHint(hintBoardOf(game), hint, solution);
          if (hint.kind !== 'step' || walkthrough === null) {
            problems.push(`${date}: ${JSON.stringify(hint)}`);
            break;
          }
          const [{ step }] = walkthrough.steps;
          if (stepId(step) !== hint.id || hint.of - hint.step + 1 !== walkthrough.steps.length) {
            problems.push(`${date}: ${JSON.stringify(hint)} is not its walkthrough's`);
          }
          for (const { index, mask } of step.eliminations) {
            if ((mask & bit(solution[index])) !== 0) problems.push(`${date}: struck an answer`);
          }
          prefer = hint.index;
          game = take(game, step);
        }
        if (game.status !== 'solved') problems.push(`${date}: unsolved`);
      }
      expect(problems).toEqual([]);
    },
    120_000,
  );
});
