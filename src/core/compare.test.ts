import { describe, expect, it } from 'vitest';
import {
  countTicks,
  emptyCellCount,
  invertLinear,
  overlayAt,
  placeEndLabels,
  positionAtSecond,
  progressOf,
  sampleSeconds,
  scaleLinear,
  secondOf,
  solvedAt,
  solvedCells,
  stateAtSecond,
  timeTicks,
  type ProgressMark,
} from './compare';
import { createGame, reduce, type GameAction } from './game';
import { encodeMoveLog } from './moves';
import { preparePlayback, type Playback } from './playback';
import type { Digit, Puzzle } from './types';
import { EASY_PUZZLE, act, startPlaying, type Played } from '../test/movePlayers';

/*
 * The Wikipedia puzzle solved but for five cells, each a full house, played
 * two ways: "mine", with a mistake that counted, help, and two moves in one
 * second; and "theirs", with an Undo and a Redo, a slip put right in time, a
 * Reset, a candidate mistake, a check and a reveal.
 */
const BLANKS = [0, 12, 24, 40, 80] as const;
const PUZZLE: Puzzle = (() => {
  const cells = EASY_PUZZLE.solution.split('');
  for (const index of BLANKS) cells[index] = '0';
  return { ...EASY_PUZZLE, givens: cells.join('') };
})();

const answer = (cell: number): Digit => Number(PUZZLE.solution[cell]) as Digit;
const wrong = (cell: number): Digit => ((answer(cell) % 9) + 1) as Digit;
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
const select = (index: number): GameAction => ({ type: 'select', index });

type Step = readonly [gapMs: number, action: GameAction];

function play(steps: readonly Step[]): Played {
  return steps.reduce(
    (played, [gapMs, action]) => act(played, action, gapMs),
    startPlaying(PUZZLE),
  );
}

function playback(steps: readonly Step[]): Playback {
  const result = preparePlayback(PUZZLE.givens, 'easy', encodeMoveLog(play(steps).log));
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.playback;
}

const MINE = playback([
  [1000, place(0, wrong(0))], // 0:01 a mistake, left four seconds: it counts
  [4000, place(0, answer(0))], // 0:05
  [1000, place(40, answer(40))], // 0:06
  [200, place(80, answer(80))], // 0:06 too
  [
    2000,
    {
      type: 'hint',
      hint: { kind: 'single', index: 12, technique: 'fullHouse', unit: { kind: 'row', index: 1 } },
    },
  ], // 0:08.2 help
  [1000, place(12, answer(12))], // 0:09.2
  [1000, place(24, answer(24))], // 0:10.2 the solve
]);

const THEIRS = playback([
  [500, place(24, answer(24))], // 0:00.5
  [1500, place(12, answer(12))], // 0:02
  [1000, { type: 'undo' }], // 0:03 back to one
  [1000, { type: 'redo' }], // 0:04 two again
  [1000, place(40, wrong(40))], // 0:05 a slip…
  [500, place(40, answer(40))], // 0:05.5 …put right in time: forgiven
  [1000, { type: 'reset' }], // 0:06.5 nothing
  [1000, place(24, answer(24))], // 0:07.5
  [1000, pencil(80, answer(80))], // 0:08.5 pencilled
  [500, pencil(80, answer(80))], // 0:09 struck: a candidate mistake, left
  [4000, place(80, answer(80))], // 0:13
  [1000, place(12, wrong(12))], // 0:14 wrong, and checked
  [500, select(12)],
  [500, { type: 'check', scope: 'cell' }], // 0:15 help
  [1000, place(12, answer(12))], // 0:16
  [1000, select(40)],
  [0, { type: 'reveal' }], // 0:17 help, and a cell solved
  [1000, place(0, answer(0))], // 0:18 the solve
]);

describe('counting cells', () => {
  it('counts the cells a puzzle leaves to solve', () => {
    expect(emptyCellCount(PUZZLE.givens)).toBe(5);
    expect(emptyCellCount(EASY_PUZZLE.givens)).toBe(51);
  });

  it('counts empty cells holding their answer, never a given or a wrong number', () => {
    let game = createGame(PUZZLE);
    expect(solvedCells(game)).toBe(0);
    game = reduce(game, place(0, answer(0)));
    game = reduce(game, place(12, wrong(12)));
    expect(solvedCells(game)).toBe(1);
  });

  it('reads a time as the second it falls in', () => {
    expect([0, 999, 1000, 5_399].map(secondOf)).toEqual([0, 0, 1, 5]);
  });
});

describe('progressOf', () => {
  it('steps up a cell at a time, ending at the solve with every cell solved', () => {
    const progress = progressOf(MINE);
    expect(progress.points).toEqual([
      { second: 0, solved: 0 },
      { second: 5, solved: 1 },
      { second: 6, solved: 3 },
      { second: 9, solved: 4 },
      { second: 10, solved: 5 },
    ]);
    expect(progress.end).toBe(10);
    expect(progress.total).toBe(5);
  });

  it('keeps where each second ended, and falls with an Undo and a Reset', () => {
    expect(progressOf(THEIRS).points).toEqual([
      { second: 0, solved: 1 }, // a cell solved within the first second
      { second: 2, solved: 2 },
      { second: 3, solved: 1 }, // Undo
      { second: 4, solved: 2 }, // Redo
      { second: 5, solved: 3 }, // the slip and its fix, in one second
      { second: 6, solved: 0 }, // Reset
      { second: 7, solved: 1 },
      { second: 13, solved: 2 },
      { second: 16, solved: 3 },
      { second: 17, solved: 4 }, // the reveal fills a cell
      { second: 18, solved: 5 },
    ]);
  });

  it('adds no step for a second that ends where the step before it ended', () => {
    const progress = progressOf(
      playback([
        [1000, place(0, answer(0))], // 0:01 one
        [6200, place(40, answer(40))], // 0:07.2 two…
        [400, { type: 'erase', index: 40 }], // 0:07.6 …and one again by the end of 0:07
        [1400, place(40, answer(40))], // 0:09
        [1000, place(12, answer(12))],
        [1000, place(24, answer(24))],
        [1000, place(80, answer(80))], // 0:12 the solve
      ]),
    );
    expect(progress.points).toEqual([
      { second: 0, solved: 0 },
      { second: 1, solved: 1 },
      { second: 9, solved: 2 },
      { second: 10, solved: 3 },
      { second: 11, solved: 4 },
      { second: 12, solved: 5 },
    ]);
  });

  it('marks each mistake that counted and each move of help, on the line', () => {
    expect(progressOf(MINE).marks).toEqual<ProgressMark[]>([
      { kind: 'mistake', what: 'value', second: 1, solved: 0 },
      { kind: 'help', what: 'hint', second: 8, solved: 3 },
    ]);
    // The slip put right in time is left off; the candidate mistake and the
    // wrong number left standing count.
    expect(progressOf(THEIRS).marks).toEqual<ProgressMark[]>([
      { kind: 'mistake', what: 'candidate', second: 9, solved: 1 },
      { kind: 'mistake', what: 'value', second: 14, solved: 2 },
      { kind: 'help', what: 'checkCell', second: 15, solved: 2 },
      { kind: 'help', what: 'reveal', second: 17, solved: 4 },
    ]);
  });

  it('marks every kind of help', () => {
    const helped = playback([
      [1000, place(0, answer(0))],
      [
        1000,
        {
          type: 'hint',
          hint: {
            kind: 'single',
            index: 12,
            technique: 'fullHouse',
            unit: { kind: 'row', index: 1 },
          },
        },
      ],
      [1000, { type: 'walkthrough', index: 12 }],
      [1000, { type: 'check', scope: 'puzzle' }],
      [1000, place(12, answer(12))],
      [1000, place(24, answer(24))],
      [1000, place(40, answer(40))],
      [1000, place(80, answer(80))],
    ]);
    expect(progressOf(helped).marks.map((mark) => mark.what)).toEqual([
      'hint',
      'walkthrough',
      'checkPuzzle',
    ]);
  });

  it('marks a page of Show me revealed as help, as a step hint charges it', () => {
    const stepped = playback([
      [1000, place(0, answer(0))],
      [
        1000,
        {
          type: 'hint',
          hint: {
            kind: 'step',
            index: 12,
            technique: 'fullHouse',
            unit: { kind: 'row', index: 1 },
            step: 1,
            of: 1,
            hardest: 'fullHouse',
            id: 1,
          },
        },
      ],
      [1000, { type: 'showStep', index: 12, id: 1, opens: true }],
      [1000, place(12, answer(12))],
      [1000, place(24, answer(24))],
      [1000, place(40, answer(40))],
      [1000, place(80, answer(80))],
    ]);
    expect(progressOf(stepped).marks.map((mark) => mark.what)).toEqual(['hint', 'page']);
  });

  it('starts a line at the cells the game began with solved', () => {
    // A game begun with auto candidates still starts with nothing placed.
    const played = [0, 12, 24, 40, 80].reduce(
      (game, cell) => act(game, place(cell, answer(cell)), 1000),
      startPlaying(PUZZLE, true),
    );
    const result = preparePlayback(PUZZLE.givens, 'easy', encodeMoveLog(played.log));
    expect(result.ok && progressOf(result.playback).points[0]).toEqual({ second: 0, solved: 0 });
  });
});

describe('looking up a moment', () => {
  const progress = progressOf(MINE);

  it('reads the cells solved at any second, between steps and past the end', () => {
    expect([0, 4, 5, 6, 7, 9, 10, 60].map((second) => solvedAt(progress, second))).toEqual([
      0, 0, 1, 3, 3, 4, 5, 5,
    ]);
  });

  it('reads the start for a time before it', () => {
    expect(solvedAt(progress, -1)).toBe(0);
  });

  it('finds how many moves had been made by the end of a second', () => {
    expect([-1, 0, 1, 5, 6, 8, 10, 99].map((second) => positionAtSecond(MINE, second))).toEqual([
      0, 0, 1, 2, 4, 5, 7, 7,
    ]);
  });

  it('gives the game as it stood at the end of a second', () => {
    expect(stateAtSecond(MINE, 0)).toBe(MINE.start);
    expect(stateAtSecond(MINE, 1).cells[0].value).toBe(wrong(0));
    expect(stateAtSecond(MINE, 10).status).toBe('solved');
  });
});

describe('overlayAt', () => {
  const cellsAt = (second: number) => overlayAt(MINE, THEIRS, second);

  it('shows the givens as they are, and nothing where neither has played', () => {
    const board = cellsAt(0);
    expect(board[1]).toEqual({ kind: 'given', digit: Number(PUZZLE.givens[1]) });
    expect(board[40]).toEqual({ kind: 'empty' });
  });

  it('tells a digit only one player had from one both had', () => {
    // At 0:00 they alone have cell 24.
    expect(cellsAt(0)[24]).toEqual({ kind: 'theirs', digit: answer(24) });
    // At 0:05 I have cell 0, and they have 40, their slip put right.
    const at5 = cellsAt(5);
    expect(at5[0]).toEqual({ kind: 'mine', digit: answer(0) });
    expect(at5[40]).toEqual({ kind: 'theirs', digit: answer(40) });
    expect(cellsAt(10)[24]).toEqual({ kind: 'both', digit: answer(24) });
  });

  it('shows both digits where each had a different one', () => {
    // At 0:01 I had a wrong number in cell 0; they had nothing there.
    expect(cellsAt(1)[0]).toEqual({ kind: 'mine', digit: wrong(0) });
    // At 0:14 their wrong 12 stands against my answer.
    expect(cellsAt(14)[12]).toEqual({ kind: 'different', mine: answer(12), theirs: wrong(12) });
  });

  it('takes a number away with an Undo, and every number with a Reset', () => {
    expect(cellsAt(2)[12]).toEqual({ kind: 'theirs', digit: answer(12) });
    expect(cellsAt(3)[12]).toEqual({ kind: 'empty' });
    expect(cellsAt(4)[12]).toEqual({ kind: 'theirs', digit: answer(12) });
    const afterReset = cellsAt(6);
    expect(afterReset[24]).toEqual({ kind: 'empty' });
    expect(afterReset[40]).toEqual({ kind: 'mine', digit: answer(40) });
  });

  it('agrees everywhere once both have solved it', () => {
    const board = cellsAt(18);
    for (const cell of BLANKS) expect(board[cell]).toEqual({ kind: 'both', digit: answer(cell) });
  });
});

describe('ticks', () => {
  it('ticks the time at round steps, as many as asked for at most', () => {
    expect(timeTicks(10, 5)).toEqual([0, 5, 10]);
    expect(timeTicks(323, 4)).toEqual([0, 120, 240]);
    expect(timeTicks(323, 6)).toEqual([0, 60, 120, 180, 240, 300]);
    expect(timeTicks(3 * 3600, 4)).toEqual([0, 3600, 7200, 10800]);
  });

  it('doubles whole hours past the longest step', () => {
    expect(timeTicks(20 * 3600, 4)).toEqual([0, 28_800, 57_600]);
  });

  it('ticks a solve of no time at its start, and always allows two ticks', () => {
    expect(timeTicks(0, 4)).toEqual([0]);
    expect(timeTicks(10, 1)).toEqual([0, 10]);
  });

  it('ticks the cells at round steps, and the top, dropping a round tick too close to it', () => {
    expect(countTicks(51, 4)).toEqual([0, 20, 40, 51]);
    expect(countTicks(5, 4)).toEqual([0, 2, 5]);
    expect(countTicks(60, 4)).toEqual([0, 20, 40, 60]);
    expect(countTicks(0, 4)).toEqual([0]);
  });

  it('counts the top among the cell ticks asked for, stepping up until they keep to it', () => {
    // 20 would tick 0, 20, 40 and the top: four; 25 ticks 0, 25 and the top.
    expect(countTicks(51, 3)).toEqual([0, 25, 51]);
    expect(countTicks(51, 2)).toEqual([0, 51]);
    // Past the longest round step, it doubles: 100 would tick 0, 100 and the top.
    expect(countTicks(160, 2)).toEqual([0, 160]);
  });

  it('samples a table at the time ticks and the end', () => {
    expect(sampleSeconds(18, 4)).toEqual([0, 5, 10, 15, 18]);
    expect(sampleSeconds(20, 5)).toEqual([0, 5, 10, 15, 20]);
  });
});

describe('scales', () => {
  it('maps a domain onto a range, and back', () => {
    const x = scaleLinear([0, 100], [20, 220]);
    expect([0, 50, 100].map(x)).toEqual([20, 120, 220]);
    const back = invertLinear([0, 100], [20, 220]);
    expect([20, 120, 220].map(back)).toEqual([0, 50, 100]);
  });

  it('maps a domain of no width to the start of the range', () => {
    expect(scaleLinear([5, 5], [20, 220])(5)).toBe(20);
  });
});

describe('placeEndLabels', () => {
  it('ends each label above the chart where its line ends, where they have room', () => {
    expect(
      placeEndLabels(
        [
          { x: 100, width: 40 },
          { x: 300, width: 50 },
        ],
        0,
        8,
        9,
      ),
    ).toEqual([
      { at: 'above', right: 100 },
      { at: 'above', right: 300 },
    ]);
  });

  it('moves a label that would run into the next one beside its own line’s end', () => {
    expect(
      placeEndLabels(
        [
          { x: 290, width: 40 },
          { x: 300, width: 50 },
        ],
        0,
        8,
        9,
      ),
    ).toEqual([
      { at: 'beside', side: 'left', x: 281 },
      { at: 'above', right: 300 },
    ]);
    // Within the gap is too close.
    expect(
      placeEndLabels(
        [
          { x: 245, width: 40 },
          { x: 300, width: 50 },
        ],
        0,
        8,
        9,
      )[0],
    ).toEqual({ at: 'beside', side: 'left', x: 236 });
    expect(
      placeEndLabels(
        [
          { x: 242, width: 40 },
          { x: 300, width: 50 },
        ],
        0,
        8,
        9,
      )[0],
    ).toEqual({ at: 'above', right: 242 });
  });

  it('sets a label moved beside its dot to the right where the left has no room', () => {
    expect(
      placeEndLabels(
        [
          { x: 60, width: 40 },
          { x: 70, width: 50 },
        ],
        30,
        8,
        9,
      ),
    ).toEqual([
      { at: 'beside', side: 'right', x: 69 },
      { at: 'above', right: 80 },
    ]);
  });

  it('keeps a label on the chart, its left edge no further left than the chart', () => {
    expect(placeEndLabels([{ x: 10, width: 40 }], 30, 8, 9)).toEqual([{ at: 'above', right: 70 }]);
  });

  it('places lines ending together in the order given, the first above', () => {
    expect(
      placeEndLabels(
        [
          { x: 300, width: 40 },
          { x: 300, width: 40 },
        ],
        0,
        10,
        9,
      ),
    ).toEqual([
      { at: 'above', right: 300 },
      { at: 'beside', side: 'left', x: 291 },
    ]);
  });
});
