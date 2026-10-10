import { describe, expect, it } from 'vitest';
import { createGame, reduce, type GameAction, type GameState } from './game';
import { bit, gridValues } from './grid';
import { findHint } from './hint';
import {
  GRACE_MS,
  NO_MISTAKES,
  analyseMistakes,
  isObviousAnswer,
  mistakeOutcomeAt,
  tallyMistakes,
  type MistakeTally,
} from './mistakes';
import { appendMove, createMoveLog, replayMoves, type Move, type MoveLog } from './moves';
import { createRng } from './rng';
import type { Digit, Puzzle } from './types';
import { EASY_PUZZLE, act, randomAction, startPlaying, type Played } from '../test/movePlayers';

/*
 * The cells of the Wikipedia puzzle (`EASY_PUZZLE`) the scenarios play in, as
 * the board stands at the start:
 */
/** Its answer, 5, is the only digit left for it: a naked single. Every wrong digit clashes. */
const NAKED = 40;
/** Its answer, 8, is one of 2 4 6 8, but the only place for an 8 in its box: a hidden single. */
const HIDDEN = 5;
/** Its answer, 4, is one of 1 2 4, and the only place for a 4 in none of its houses: not obvious. */
const HARD = 2;
/** A cell sharing no house with any of those, to make a change elsewhere in: its answer is 7. */
const ELSEWHERE = 59;
/** A cell in NAKED's row, whose answer is 2; a 5 here rules NAKED's answer out. */
const NAKED_ROW = 37;
/** A cell in NAKED's box, whose answer is 6. */
const NAKED_BOX = 38;

const answer = (cell: number, puzzle: Puzzle = EASY_PUZZLE): Digit =>
  Number(puzzle.solution[cell]) as Digit;

/** A wrong digit for a cell. */
const wrong = (cell: number, puzzle: Puzzle = EASY_PUZZLE): Digit =>
  ((answer(cell, puzzle) % 9) + 1) as Digit;

const place = (index: number, digit: number, clearPeerNotes = false): GameAction => ({
  type: 'enter',
  digit: digit as Digit,
  index,
  mode: 'normal',
  clearPeerNotes,
});
const pencil = (index: number, digit: number): GameAction => ({
  type: 'enter',
  digit: digit as Digit,
  index,
  mode: 'candidate',
});
const erase = (index: number): GameAction => ({ type: 'erase', index });
const select = (index: number): GameAction => ({ type: 'select', index });
const UNDO: GameAction = { type: 'undo' };
const REDO: GameAction = { type: 'redo' };
const RESET: GameAction = { type: 'reset' };
const AUTO_ON: GameAction = { type: 'setAutoCandidates', enabled: true };
const CHECK_PUZZLE: GameAction = { type: 'check', scope: 'puzzle' };
/** A hint about HIDDEN, as `findHint` gives one, and Show me for it. */
const HIDDEN_HINT: GameAction = {
  type: 'hint',
  hint: {
    kind: 'single',
    index: HIDDEN,
    technique: 'hiddenSingleBox',
    unit: { kind: 'box', index: 1 },
  },
};
const SHOW_ME: GameAction = { type: 'walkthrough', index: HIDDEN };
const hintFor = (game: GameState): GameAction => ({
  type: 'hint',
  hint: findHint(
    game.cells.map((cell) => cell.value),
    gridValues(game.puzzle.solution),
  ),
});

/** A step: wait `gapMs` of play, then act — or work the action out from the game as it stands. */
type Step = readonly [gapMs: number, action: GameAction | ((game: GameState) => GameAction)];

interface Scenario {
  readonly name: string;
  readonly steps: readonly Step[];
  /** What counts once the log is done and every window has settled. */
  readonly expected: MistakeTally;
  readonly puzzle?: Puzzle;
  readonly auto?: boolean;
  readonly checkGuesses?: boolean;
}

function play(steps: readonly Step[], puzzle = EASY_PUZZLE, auto = false): Played {
  return steps.reduce(
    (played, [gapMs, action]) =>
      act(played, typeof action === 'function' ? action(played.game) : action, gapMs),
    startPlaying(puzzle, auto),
  );
}

/** Every mistake counted, all windows settled. */
function finalTally(played: Played, puzzle = EASY_PUZZLE, checkGuesses = false): MistakeTally {
  return tallyMistakes(analyseMistakes(puzzle, played.log, { checkGuesses }), Infinity);
}

/** The puzzle solved but for `blanks`, each a full house. */
function nearlySolved(blanks: readonly number[]): Puzzle {
  const cells = EASY_PUZZLE.solution.split('');
  for (const index of blanks) cells[index] = '0';
  return { ...EASY_PUZZLE, givens: cells.join('') };
}

const NONE = NO_MISTAKES;
const ONE: MistakeTally = { values: 1, candidates: 0 };
const TWO: MistakeTally = { values: 2, candidates: 0 };
const ONE_CANDIDATE: MistakeTally = { values: 0, candidates: 1 };

/*
 * Times are on the play clock: each step's gap is added to the last. The
 * first move is a second in, so a window opened by it runs out at 4,000 ms.
 */
const SCENARIOS: readonly Scenario[] = [
  // ---- The grace window ----
  {
    name: 'an obvious slip put right 2.9 s later is forgiven',
    steps: [
      [1000, place(NAKED, wrong(NAKED))],
      [2900, place(NAKED, answer(NAKED))],
    ],
    expected: NONE,
  },
  {
    name: 'an obvious slip put right 3.1 s later counts',
    steps: [
      [1000, place(NAKED, wrong(NAKED))],
      [3100, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'an obvious slip put right exactly 3 s later counts: the window has closed',
    steps: [
      [1000, place(NAKED, wrong(NAKED))],
      [GRACE_MS, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'an obvious slip never put right counts',
    steps: [[1000, place(NAKED, wrong(NAKED))]],
    expected: ONE,
  },
  {
    name: 'a solved cell overwritten by mistake and put back with Undo is forgiven',
    steps: [
      [1000, place(HARD, answer(HARD))],
      [5000, place(HARD, wrong(HARD))],
      [800, UNDO],
    ],
    expected: NONE,
  },
  {
    name: 'a solved cell overwritten by mistake and typed over again is forgiven',
    steps: [
      [1000, place(HARD, answer(HARD))],
      [5000, place(HARD, wrong(HARD))],
      [1500, place(HARD, answer(HARD))],
    ],
    expected: NONE,
  },
  {
    name: 'a slip in a naked single, put right in time, is forgiven',
    steps: [
      [1000, place(NAKED, 9)],
      [1000, place(NAKED, answer(NAKED))],
    ],
    expected: NONE,
  },
  {
    name: 'a slip in a hidden single, erased and then put right in time, is forgiven',
    steps: [
      [1000, place(HIDDEN, 2)],
      [800, erase(HIDDEN)],
      [800, place(HIDDEN, answer(HIDDEN))],
    ],
    expected: NONE,
  },
  {
    name: 'a slip undone to an empty cell and then typed right in time is forgiven',
    steps: [
      [1000, place(HIDDEN, 2)],
      [800, UNDO],
      [800, place(HIDDEN, answer(HIDDEN))],
    ],
    expected: NONE,
  },
  {
    name: 'a wrong digit where the answer was not obvious counts, though put right at once',
    steps: [
      [1000, place(HARD, 1)],
      [100, place(HARD, answer(HARD))],
    ],
    expected: ONE,
  },
  {
    name: 'an obvious answer a wrong number nearby rules out is not obvious any more',
    steps: [
      [1000, place(NAKED_ROW, answer(NAKED))],
      [5000, place(NAKED, 6)],
      [100, place(NAKED, answer(NAKED))],
    ],
    expected: TWO,
  },
  // ---- What closes the window early ----
  {
    name: 'a clash undone, then another cell solved, counts: an empty cell is not put right',
    steps: [
      [1000, place(NAKED, 6)],
      [500, UNDO],
      [500, place(ELSEWHERE, answer(ELSEWHERE))],
    ],
    expected: ONE,
  },
  {
    name: 'a change to another cell inside the window settles it as it stands',
    steps: [
      [1000, place(NAKED, 6)],
      [500, place(ELSEWHERE, answer(ELSEWHERE))],
      [500, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'a candidate pencilled in another cell is a change elsewhere too',
    steps: [
      [1000, place(NAKED, 6)],
      [500, pencil(ELSEWHERE, 1)],
      [500, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'the slip put right before a change elsewhere is still forgiven',
    steps: [
      [1000, place(NAKED, 6)],
      [500, place(NAKED, answer(NAKED))],
      [500, place(ELSEWHERE, answer(ELSEWHERE))],
    ],
    expected: NONE,
  },
  {
    name: 'clearing the digit from the peers’ notes is no change elsewhere',
    steps: [
      [1000, pencil(NAKED_BOX, 6)],
      [1000, place(NAKED, 6, true)],
      [500, place(NAKED, answer(NAKED))],
    ],
    expected: NONE,
  },
  {
    name: 'switching auto candidates changes every cell, so it closes the window',
    steps: [
      [1000, place(NAKED, 6)],
      [500, AUTO_ON],
      [500, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'Undo reaching back past the slip to another cell is a change elsewhere',
    steps: [
      [1000, place(ELSEWHERE, answer(ELSEWHERE))],
      [5000, place(NAKED, 6)],
      [300, UNDO],
      [300, UNDO],
      [300, place(NAKED, answer(NAKED))],
    ],
    // The first Undo empties NAKED, its own cell; the second takes ELSEWHERE
    // back, which settles NAKED's window with the cell still empty.
    expected: ONE,
  },
  {
    name: 'Undo reaching back past the slip to a switch of auto candidates closes the window',
    steps: [
      [1000, select(NAKED)],
      [0, AUTO_ON],
      [1000, place(NAKED, 6)],
      [300, UNDO],
      [300, UNDO],
      [300, place(NAKED, answer(NAKED))],
    ],
    // The switch was made with NAKED selected, but it changed every cell.
    expected: ONE,
  },
  {
    name: 'a hint inside the window settles it, unfixed: counted',
    steps: [
      [1000, place(NAKED, 6)],
      [500, hintFor],
      [500, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'a check inside the window, the obvious slip already put right: forgiven',
    steps: [
      [1000, place(NAKED, 6)],
      [500, place(NAKED, answer(NAKED))],
      [500, CHECK_PUZZLE],
    ],
    expected: NONE,
  },
  {
    name: 'a check inside the window, a slip that was not obvious put right: counted',
    steps: [
      [1000, place(HARD, 1)],
      [500, place(HARD, answer(HARD))],
      [500, CHECK_PUZZLE],
    ],
    expected: ONE,
  },
  {
    name: 'revealing the slip’s own cell is help: the reveal never forgives it',
    steps: [
      [1000, place(NAKED, 6)],
      [500, select(NAKED)],
      [0, { type: 'reveal' }],
    ],
    expected: ONE,
  },
  {
    name: 'Show me opened again for free is still help seen, and settles the window',
    steps: [
      [1000, HIDDEN_HINT],
      [0, SHOW_ME],
      [500, place(NAKED, 6)],
      [500, SHOW_ME],
      [500, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'a slip that fills the board counts at once: "something isn’t right" is news',
    puzzle: nearlySolved([NAKED, ELSEWHERE]),
    steps: [
      [1000, place(ELSEWHERE, answer(ELSEWHERE))],
      [1000, place(NAKED, 6)],
      [500, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'a slip on a board already full has a window like any other: undone at once, forgiven',
    puzzle: nearlySolved([NAKED, ELSEWHERE]),
    steps: [
      [1000, place(ELSEWHERE, wrong(ELSEWHERE))],
      [5000, place(NAKED, answer(NAKED))],
      // The board is full, but something isn't right; hunting for it, a solved cell is overwritten.
      [5000, place(NAKED, 6)],
      [300, UNDO],
    ],
    // ELSEWHERE's wrong digit only: the board was full before the slip, so it told nothing new.
    expected: ONE,
  },
  {
    name: 'a slip on a board already full, left standing, counts at its deadline',
    puzzle: nearlySolved([NAKED, ELSEWHERE]),
    steps: [
      [1000, place(ELSEWHERE, wrong(ELSEWHERE))],
      [5000, place(NAKED, answer(NAKED))],
      [5000, place(NAKED, 6)],
      [GRACE_MS, place(NAKED, answer(NAKED))],
    ],
    expected: TWO,
  },
  {
    name: 'a slip in one cell settled by filling the last other one',
    puzzle: nearlySolved([NAKED, ELSEWHERE]),
    steps: [
      [1000, place(NAKED, 6)],
      [500, place(ELSEWHERE, answer(ELSEWHERE))],
      [500, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'the solve settles a strike put right by the solving move itself: forgiven',
    puzzle: nearlySolved([NAKED]),
    steps: [
      [1000, pencil(NAKED, answer(NAKED))],
      [5000, pencil(NAKED, answer(NAKED))],
      [500, place(NAKED, answer(NAKED))],
    ],
    expected: NONE,
  },
  {
    name: 'a Reset inside the window never forgives',
    steps: [
      [1000, place(NAKED, 6)],
      [500, RESET],
    ],
    expected: ONE,
  },
  {
    name: 'a slip put right before a Reset is still forgiven',
    steps: [
      [1000, place(NAKED, 6)],
      [500, place(NAKED, answer(NAKED))],
      [500, RESET],
    ],
    expected: NONE,
  },
  // ---- Once a game ----
  {
    name: 'Undo and Redo bringing a counted wrong digit back count it once',
    steps: [
      [1000, place(HARD, 1)],
      [100, UNDO],
      [100, REDO],
      [5000, UNDO],
      [5000, REDO],
    ],
    expected: ONE,
  },
  {
    name: 'a forgiven slip brought back by Redo later is a mistake of its own',
    steps: [
      [1000, place(NAKED, answer(NAKED))],
      [5000, place(NAKED, 6)],
      [500, UNDO],
      [5000, REDO],
    ],
    expected: ONE,
  },
  {
    name: 'the same wrong digit again in a cell counts once',
    steps: [
      [1000, place(HARD, 1)],
      [5000, erase(HARD)],
      [5000, place(HARD, 1)],
    ],
    expected: ONE,
  },
  {
    name: 'two different wrong digits in a cell count twice',
    steps: [
      [1000, place(HARD, 1)],
      [5000, place(HARD, 2)],
    ],
    expected: TWO,
  },
  {
    name: 'a slip put right, then another wrong digit typed over the answer: the second counts',
    steps: [
      [1000, place(NAKED, 6)],
      [500, place(NAKED, answer(NAKED))],
      [500, place(NAKED, 7)],
    ],
    expected: ONE,
  },
  {
    name: 'the same slip again after it was put right has a window of its own: left, counted',
    steps: [
      [1000, place(NAKED, 6)],
      [500, place(NAKED, answer(NAKED))],
      [500, place(NAKED, 6)],
    ],
    expected: ONE,
  },
  {
    name: 'the same slip again after it was put right, put right in its own window: forgiven',
    steps: [
      [1000, place(NAKED, 6)],
      [500, place(NAKED, answer(NAKED))],
      // After the first window's deadline (4,000 ms), inside its own (to 6,500 ms).
      [2000, place(NAKED, 6)],
      [1000, place(NAKED, answer(NAKED))],
    ],
    expected: NONE,
  },
  {
    name: 'Undo past the fix brings the slip back with a window of its own, and Redo puts it right',
    steps: [
      [1000, place(NAKED, answer(NAKED))],
      [5000, place(NAKED, 6)],
      [500, place(NAKED, answer(NAKED))],
      [1000, UNDO],
      // After the first 6's deadline (9,000 ms), inside the second's (to 10,500 ms).
      [2000, REDO],
    ],
    expected: NONE,
  },
  {
    name: 'an obvious slip back by Undo before it was put right, then put right in time: forgiven',
    steps: [
      [1000, place(NAKED, 6)],
      [300, place(NAKED, 7)],
      // 6 is back over the wrong 7, and NAKED's answer is still the only digit left for it.
      [300, UNDO],
      [300, place(NAKED, answer(NAKED))],
    ],
    expected: NONE,
  },
  {
    name: 'a slip back by Undo while a wrong digit stands was not obvious that time: counted',
    steps: [
      [1000, place(HARD, answer(HARD))],
      [5000, place(HARD, 1)],
      [300, place(HARD, 2)],
      // 1 is back over the wrong 2: its answer was not obvious this time it went in.
      [300, UNDO],
      [300, UNDO],
    ],
    // The 2 was not obvious either: the cell held 1, and HARD is no single.
    expected: TWO,
  },
  // ---- Candidates ----
  {
    name: 'striking the answer from your own notes and pencilling it back in time is forgiven',
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [5000, pencil(HARD, answer(HARD))],
      [1000, pencil(HARD, answer(HARD))],
    ],
    expected: NONE,
  },
  {
    name: 'striking the answer from your own notes and pencilling it back late counts',
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [5000, pencil(HARD, answer(HARD))],
      [3100, pencil(HARD, answer(HARD))],
    ],
    expected: ONE_CANDIDATE,
  },
  {
    name: 'an auto candidate strike of the answer taken back in time is forgiven',
    auto: true,
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [1000, pencil(HARD, answer(HARD))],
    ],
    expected: NONE,
  },
  {
    name: 'an auto candidate strike of the answer left standing counts',
    auto: true,
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [3100, pencil(HARD, answer(HARD))],
    ],
    expected: ONE_CANDIDATE,
  },
  {
    name: 'a strike undone in time is forgiven',
    auto: true,
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [1000, UNDO],
    ],
    expected: NONE,
  },
  {
    name: 'a strike Redone after its window is a strike again',
    auto: true,
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [1000, UNDO],
      [5000, REDO],
    ],
    expected: ONE_CANDIDATE,
  },
  {
    name: 'a struck answer placed in time, as after a slip of the mode, is forgiven',
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [5000, pencil(HARD, answer(HARD))],
      [500, place(HARD, answer(HARD))],
    ],
    expected: NONE,
  },
  {
    name: 'the same strike again after it was taken back has a window of its own: left, counted',
    auto: true,
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [500, pencil(HARD, answer(HARD))],
      [500, pencil(HARD, answer(HARD))],
    ],
    expected: ONE_CANDIDATE,
  },
  {
    name: 'the same strike again after it was taken back, taken back in its own window: forgiven',
    auto: true,
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [500, pencil(HARD, answer(HARD))],
      [2000, pencil(HARD, answer(HARD))],
      [1000, pencil(HARD, answer(HARD))],
    ],
    expected: NONE,
  },
  {
    name: 'a strike left standing when another cell changes counts',
    auto: true,
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [500, place(ELSEWHERE, answer(ELSEWHERE))],
      [500, pencil(HARD, answer(HARD))],
    ],
    expected: ONE_CANDIDATE,
  },
  {
    name: 'a cell’s candidate mistakes count once',
    auto: true,
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [5000, pencil(HARD, answer(HARD))],
      [5000, pencil(HARD, answer(HARD))],
    ],
    expected: ONE_CANDIDATE,
  },
  {
    name: 'Undo of an added note is no candidate mistake',
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [5000, UNDO],
    ],
    expected: NONE,
  },
  {
    name: 'Redo of an added note is none either',
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [5000, UNDO],
      [5000, REDO],
    ],
    expected: NONE,
  },
  {
    name: 'the second Erase wiping the notes is no candidate mistake',
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [5000, erase(HARD)],
    ],
    expected: NONE,
  },
  {
    name: 'nor is clearing a placed digit from the peers’ notes',
    steps: [
      [1000, pencil(NAKED_BOX, answer(NAKED_BOX))],
      [5000, place(NAKED, answer(NAKED_BOX), true)],
    ],
    // The 6 in NAKED is a wrong number; striking NAKED_BOX's 6 is its echo.
    expected: ONE,
  },
  {
    name: 'nor is a wrong note, pencilled in and left',
    steps: [[1000, pencil(HARD, 9)]],
    expected: NONE,
  },
  {
    name: 'nor is an auto candidate hidden by a wrong number nearby',
    auto: true,
    steps: [[1000, place(NAKED_ROW, answer(NAKED))]],
    expected: ONE,
  },
  // ---- Check guesses when entered ----
  {
    name: 'with Check guesses on, an obvious slip put right at once counts at once',
    checkGuesses: true,
    steps: [
      [1000, place(NAKED, 6)],
      [100, place(NAKED, answer(NAKED))],
    ],
    expected: ONE,
  },
  {
    name: 'with Check guesses on, a strike undone at once counts at once',
    checkGuesses: true,
    auto: true,
    steps: [
      [1000, pencil(HARD, answer(HARD))],
      [100, UNDO],
    ],
    expected: ONE_CANDIDATE,
  },
  {
    name: 'with Check guesses on, a counted digit brought back counts once',
    checkGuesses: true,
    steps: [
      [1000, place(NAKED, 6)],
      [100, UNDO],
      [100, REDO],
    ],
    expected: ONE,
  },
];

describe('mistakes', () => {
  describe('every rule, at exact play times', () => {
    it.each(SCENARIOS)('$name', ({ steps, expected, puzzle, auto, checkGuesses }) => {
      const played = play(steps, puzzle, auto);
      expect(finalTally(played, puzzle, checkGuesses)).toEqual(expected);
    });
  });

  describe('an obvious answer', () => {
    const start = createGame(EASY_PUZZLE);

    it('is a naked single: the only digit left for the cell', () => {
      expect(isObviousAnswer(start, NAKED)).toBe(true);
    });

    it('is a hidden single: the only place left for the digit in a house', () => {
      expect(isObviousAnswer(start, HIDDEN)).toBe(true);
    });

    it('is not a cell with a choice of digits and of places', () => {
      expect(isObviousAnswer(start, HARD)).toBe(false);
    });

    it('is any cell that holds its answer already', () => {
      const solved = reduce(start, place(HARD, answer(HARD)));
      expect(isObviousAnswer(solved, HARD)).toBe(true);
    });

    it('is judged with the cell taken as empty, whatever wrong digit it holds', () => {
      const slipped = reduce(start, place(NAKED, 6));
      expect(isObviousAnswer(slipped, NAKED)).toBe(true);
    });

    it('is not one a wrong number among the peers rules out', () => {
      const blocked = reduce(start, place(NAKED_ROW, answer(NAKED)));
      expect(isObviousAnswer(blocked, NAKED)).toBe(false);
    });

    it('is never read from notes', () => {
      // HARD's notes narrowed to its answer alone say nothing: the board still offers 1 2 4.
      const noted = reduce(start, pencil(HARD, answer(HARD)));
      expect(isObviousAnswer(noted, HARD)).toBe(false);
    });
  });

  describe('each mistake', () => {
    it('says what it was, when it was made, and how and why it came out', () => {
      const played = play([
        [1000, place(HARD, 1)],
        [500, place(NAKED, 6)],
        [500, place(NAKED, answer(NAKED))],
      ]);
      expect(analyseMistakes(EASY_PUZZLE, played.log).events).toEqual([
        {
          kind: 'value',
          cell: HARD,
          digit: 1,
          move: 0,
          at: 1000,
          deadline: 4000,
          isObvious: false,
          isPutRight: false,
          outcome: 'counted',
          settledAt: 1500,
          settledBy: 'elsewhere',
          why: 'notObvious',
        },
        {
          kind: 'value',
          cell: NAKED,
          digit: 6,
          move: 1,
          at: 1500,
          deadline: 4500,
          isObvious: true,
          isPutRight: true,
          outcome: 'pending',
          settledAt: null,
          settledBy: null,
          why: 'waiting',
        },
      ]);
    });

    it('names a candidate mistake by the answer struck', () => {
      const played = play(
        [
          [1000, pencil(HARD, answer(HARD))],
          [GRACE_MS, place(ELSEWHERE, answer(ELSEWHERE))],
        ],
        EASY_PUZZLE,
        true,
      );
      expect(analyseMistakes(EASY_PUZZLE, played.log).events).toEqual([
        expect.objectContaining({
          kind: 'candidate',
          cell: HARD,
          digit: answer(HARD),
          isObvious: null,
          outcome: 'counted',
          settledAt: 4000,
          settledBy: 'time',
          why: 'notPutRight',
        }),
      ]);
    });

    it('says what settled it: help, a Reset, a full board or the solve', () => {
      const closerOf = (steps: readonly Step[], puzzle?: Puzzle) =>
        analyseMistakes(puzzle ?? EASY_PUZZLE, play(steps, puzzle).log).events.map(
          (event) => event.settledBy,
        );
      expect(
        closerOf([
          [1000, place(NAKED, 6)],
          [100, hintFor],
        ]),
      ).toEqual(['help']);
      expect(
        closerOf([
          [1000, place(NAKED, 6)],
          [100, RESET],
        ]),
      ).toEqual(['reset']);
      expect(closerOf([[1000, place(NAKED, 6)]], nearlySolved([NAKED]))).toEqual(['full']);
      expect(
        closerOf(
          [
            [1000, place(NAKED, 6)],
            [100, place(NAKED, answer(NAKED))],
          ],
          nearlySolved([NAKED, HARD]),
        ),
      ).toEqual([null]);
      const solved = analyseMistakes(
        nearlySolved([NAKED, HARD]),
        play(
          [
            [1000, place(NAKED, 6)],
            [100, place(NAKED, answer(NAKED))],
            [100, select(HARD)],
            [0, place(HARD, answer(HARD))],
          ],
          nearlySolved([NAKED, HARD]),
        ).log,
      );
      // HARD is another cell: the move that solves it settles NAKED's slip first.
      expect(solved.events.map((event) => [event.settledBy, event.outcome])).toEqual([
        ['elsewhere', 'forgiven'],
      ]);
    });

    it('is settled by Show me opened again for free, which the log keeps as help seen', () => {
      const played = play([
        [1000, HIDDEN_HINT],
        [0, SHOW_ME],
        [500, place(NAKED, 6)],
        [500, SHOW_ME],
      ]);
      expect(played.log.moves.map((move) => move.op)).toEqual([
        'hint',
        'walkthrough',
        'place',
        'walkthrough',
      ]);
      expect(analyseMistakes(EASY_PUZZLE, played.log).events).toEqual([
        expect.objectContaining({ settledAt: 2000, settledBy: 'help', outcome: 'counted' }),
      ]);
    });

    it('is settled at once, decided, when made again after it was put right', () => {
      const played = play([
        [1000, place(NAKED, 6)],
        [500, place(NAKED, answer(NAKED))],
        [500, place(NAKED, 6)],
      ]);
      expect(analyseMistakes(EASY_PUZZLE, played.log).events).toEqual([
        expect.objectContaining({ at: 1000, settledAt: 2000, settledBy: 'again', why: 'putRight' }),
        expect.objectContaining({ at: 2000, deadline: 5000, isObvious: true, outcome: 'pending' }),
      ]);
    });

    it('counts a slip that was not obvious at once when it is made again after being put right', () => {
      const played = play([
        [1000, place(HARD, 1)],
        [500, place(HARD, answer(HARD))],
        [500, place(HARD, 1)],
        [500, place(HARD, answer(HARD))],
      ]);
      // Counted once: the second 1 is the same cell and digit.
      expect(analyseMistakes(EASY_PUZZLE, played.log).events).toEqual([
        expect.objectContaining({ settledAt: 2000, settledBy: 'again', outcome: 'counted' }),
      ]);
      expect(finalTally(played)).toEqual(ONE);
    });

    it('is counted the moment it goes in with Check guesses on', () => {
      const played = play([[1000, place(NAKED, 6)]]);
      expect(analyseMistakes(EASY_PUZZLE, played.log, { checkGuesses: true }).events).toEqual([
        expect.objectContaining({
          outcome: 'counted',
          settledAt: 1000,
          settledBy: 'entered',
          why: 'checkGuesses',
        }),
      ]);
    });
  });

  describe('a tally', () => {
    const played = play([
      [1000, place(HARD, 1)],
      [GRACE_MS, place(HARD, answer(HARD))],
    ]);
    const analysis = analyseMistakes(EASY_PUZZLE, played.log);

    it('counts nothing before a mistake is made, nor while its window is open', () => {
      expect(tallyMistakes(analysis, 999)).toEqual(NONE);
      expect(tallyMistakes(analysis, 3900)).toEqual(NONE);
    });

    it('counts it from the moment its window settles', () => {
      expect(tallyMistakes(analysis, 4000)).toEqual(ONE);
      expect(tallyMistakes(analysis, 60_000)).toEqual(ONE);
    });

    it('counts it once its window has closed, and not a moment before', () => {
      // A move made at 3,999 ms is logged at 3,900, inside the window; one
      // made at 4,000 ms or after is too late to put it right.
      expect(tallyMistakes(analysis, 3999)).toEqual(NONE);
      expect(tallyMistakes(analysis, 4000)).toEqual(ONE);
    });

    it('settles a window still open at the end of the log at its deadline', () => {
      const open = play([[1000, place(NAKED, 6)]]);
      const [event] = analyseMistakes(EASY_PUZZLE, open.log).events;
      expect(mistakeOutcomeAt(event, 500)).toBeNull();
      expect(mistakeOutcomeAt(event, 3900)).toBe('pending');
      expect(mistakeOutcomeAt(event, 4000)).toBe('counted');
      const fixed = act(open, place(NAKED, answer(NAKED)), 1000);
      const [forgiven] = analyseMistakes(EASY_PUZZLE, fixed.log).events;
      expect(mistakeOutcomeAt(forgiven, 4000)).toBe('forgiven');
    });

    it('says a settled mistake was pending before it settled', () => {
      const [event] = analysis.events;
      expect(mistakeOutcomeAt(event, 2000)).toBe('pending');
      expect(mistakeOutcomeAt(event, 4000)).toBe('counted');
    });

    it('never counts less for a fix logged in the tick a tally was taken in, after the deadline', () => {
      const open = play([[1000, place(NAKED, 6)]]);
      expect(tallyMistakes(analyseMistakes(EASY_PUZZLE, open.log), 4050)).toEqual(ONE);
      // Made at 4,050 ms, logged at 4,000: the window had closed.
      const fixed = act(open, place(NAKED, answer(NAKED)), 3050);
      expect(tallyMistakes(analyseMistakes(EASY_PUZZLE, fixed.log), 4050)).toEqual(ONE);
    });

    it('is nothing for a log with no moves', () => {
      expect(tallyMistakes(analyseMistakes(EASY_PUZZLE, startPlaying(EASY_PUZZLE).log), 0)).toEqual(
        NONE,
      );
    });
  });

  it('works a log out once, however often it is asked, and again for other rules or another puzzle', () => {
    const played = play([[1000, place(NAKED, 6)]]);
    const analysis = analyseMistakes(EASY_PUZZLE, played.log);
    expect(analyseMistakes(EASY_PUZZLE, played.log)).toBe(analysis);
    const checked = analyseMistakes(EASY_PUZZLE, played.log, { checkGuesses: true });
    expect(checked).not.toBe(analysis);
    expect(analyseMistakes(EASY_PUZZLE, played.log, { checkGuesses: true })).toBe(checked);
    const other = nearlySolved([NAKED]);
    expect(analyseMistakes(other, played.log)).not.toBe(checked);
  });

  describe('a log from elsewhere', () => {
    /** A log of raw moves, as a hand-edited export or a link might hold: none checked against the game. */
    const rawLog = (moves: readonly (readonly [atMs: number, move: Move])[]): MoveLog =>
      moves.reduce((log, [atMs, move]) => appendMove(log, move, atMs), createMoveLog());

    it('is judged, not refused, with an Undo or a Redo that has nothing to act on', () => {
      const solve: (readonly [number, Move])[] = [...EASY_PUZZLE.givens].flatMap((given, cell) =>
        given === '0'
          ? [[1000, { op: 'place', cell, digit: answer(cell), clearPeerNotes: false }] as const]
          : [],
      );
      const log = rawLog([[0, { op: 'undo' }], [0, { op: 'redo' }], ...solve]);
      expect(replayMoves(EASY_PUZZLE, log).status).toBe('solved');
      expect(tallyMistakes(analyseMistakes(EASY_PUZZLE, log), Infinity)).toEqual(NONE);
    });

    it('closes no window with an Undo or a Redo that has nothing to act on', () => {
      const log = rawLog([
        [1000, { op: 'place', cell: NAKED, digit: 6, clearPeerNotes: false }],
        [1500, { op: 'redo' }],
        [2000, { op: 'place', cell: NAKED, digit: answer(NAKED), clearPeerNotes: false }],
      ]);
      expect(tallyMistakes(analyseMistakes(EASY_PUZZLE, log), Infinity)).toEqual(NONE);
    });

    it('takes a candidate entry that changed nothing for no candidate move', () => {
      // A given cell takes no notes; the Undo then takes back the note before it.
      const log = rawLog([
        [1000, { op: 'candidate', cell: HARD, digit: 9 }],
        [1500, { op: 'candidate', cell: 0, digit: 9 }],
        [2000, { op: 'undo' }],
        [2500, { op: 'redo' }],
      ]);
      expect(tallyMistakes(analyseMistakes(EASY_PUZZLE, log), Infinity)).toEqual(NONE);
    });
  });

  describe('over random games', () => {
    /** Each kind's count, never lower than `floor`'s. */
    const expectNoLower = (tally: MistakeTally, floor: MistakeTally) => {
      expect(tally.values).toBeGreaterThanOrEqual(floor.values);
      expect(tally.candidates).toBeGreaterThanOrEqual(floor.candidates);
    };

    it('never counts below zero, and never counts less later, nor for a longer log', () => {
      for (let seed = 1; seed <= 40; seed++) {
        const rng = createRng(`mistakes/${seed}`);
        const options = { checkGuesses: seed % 5 === 0 };
        let played = startPlaying(EASY_PUZZLE, rng() < 0.3);
        let floor: MistakeTally = NONE;
        for (let i = 0; i < 150 && played.game.status === 'playing'; i++) {
          // The clock runs on between moves: a tally taken while it does,
          // then the next move, and a tally of the longer log.
          const gapMs = rng() * 4000;
          const meanwhile = tallyMistakes(
            analyseMistakes(EASY_PUZZLE, played.log, options),
            played.clockMs + rng() * gapMs,
          );
          expectNoLower(meanwhile, floor);
          played = act(played, randomAction(played.game, rng, 0.7), gapMs);
          floor = tallyMistakes(analyseMistakes(EASY_PUZZLE, played.log, options), played.clockMs);
          expectNoLower(floor, meanwhile);
        }
        expect(Math.min(floor.values, floor.candidates)).toBeGreaterThanOrEqual(0);
      }
    });

    it('counts nothing for a game that never enters a wrong digit nor strikes an answer', () => {
      for (let seed = 1; seed <= 30; seed++) {
        const rng = createRng(`no mistakes/${seed}`);
        let played = startPlaying(EASY_PUZZLE, rng() < 0.5);
        for (let i = 0; i < 200 && played.game.status === 'playing'; i++) {
          played = act(played, rightAction(played.game, rng), rng() * 2000);
        }
        expect(finalTally(played)).toEqual(NONE);
      }
    });
  });
});

/**
 * Any action that can never make a mistake: right digits, notes that never
 * strike the answer, and every other control. Answers are pencilled in too, so
 * that Undo and Redo of an added answer note, the second Erase and clearing a
 * digit from the peers' notes all have answer notes to take — none of which is
 * a mistake.
 */
function rightAction(game: GameState, rng: () => number): GameAction {
  const empty = game.cells.flatMap((cell, i) => (cell.value === 0 ? [i] : []));
  const cell = empty.length > 0 ? empty[Math.floor(rng() * empty.length)] : 0;
  const notAnswer = (((answer(cell) + Math.floor(rng() * 8)) % 9) + 1) as Digit;
  const roll = rng() * 100;
  if (roll < 35) return place(cell, answer(cell), rng() < 0.3);
  if (roll < 55) {
    // In auto candidate mode pencilling the answer would strike it; in your
    // own notes, only while it is missing does it add it.
    const isAnswerMissing =
      !game.autoCandidates &&
      game.cells[cell].value === 0 &&
      (game.cells[cell].notes & bit(answer(cell))) === 0;
    return pencil(cell, isAnswerMissing && rng() < 0.6 ? answer(cell) : notAnswer);
  }
  if (roll < 62) return erase(cell);
  if (roll < 65) return { type: 'setAutoCandidates', enabled: rng() < 0.5 };
  if (roll < 77) return UNDO;
  if (roll < 85) return REDO;
  if (roll < 90) return hintFor(game);
  if (roll < 94) return { type: 'check', scope: rng() < 0.5 ? 'cell' : 'puzzle' };
  if (roll < 97) return select(cell);
  if (roll < 99) return { type: 'reveal' };
  return RESET;
}
