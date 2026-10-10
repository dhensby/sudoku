import { describe, expect, it } from 'vitest';
import type { GameAction } from './game';
import {
  MAX_MOVES,
  MOVES_VERSION,
  appendMove,
  createMoveLog,
  decodeMoveLog,
  encodeMoveLog,
  replayMoves,
} from './moves';
import {
  INITIAL_CURSOR,
  LONGEST_PAUSE_MS,
  PLAYBACK_SPEEDS,
  SHORTEST_PAUSE_MS,
  clampPosition,
  frameAt,
  isPlayable,
  lengthOf,
  pauseBefore,
  playTimeAt,
  preparePlayback,
  stateAt,
  steer,
  tickFraction,
  type Playback,
  type PlaybackCursor,
} from './playback';
import { createRng } from './rng';
import type { Digit, Puzzle } from './types';
import {
  EASY_PUZZLE,
  LOG_IN_A_LATER_FORMAT,
  act,
  checkGuessesTour,
  logFromAnotherBuild,
  playWithHelp,
  solveByPlacing,
  startPlaying,
  tourTheRules,
  type Played,
} from '../test/movePlayers';

/*
 * The Wikipedia puzzle solved but for five cells, each a full house — so a
 * wrong digit in one is an obvious slip — played by a script that makes a
 * move of every kind the log holds on the way to the solve.
 */
const BLANKS = [0, 40, 80, 12, 24] as const;
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
const UNDO: GameAction = { type: 'undo' };
const REDO: GameAction = { type: 'redo' };

/** A step of the script: wait `gapMs` of play, then act. */
type Step = readonly [gapMs: number, action: GameAction];

const SCRIPT: readonly Step[] = [
  [1000, place(0, wrong(0))], // 1: a mistake, left 4 s before it is put right
  [4000, place(0, answer(0))], // 2
  [1000, place(40, wrong(40))], // 3: a slip, put right within the grace
  [500, place(40, answer(40))], // 4
  [
    2000,
    {
      type: 'hint',
      hint: {
        kind: 'single',
        index: 80,
        technique: 'fullHouse',
        unit: { kind: 'row', index: 8 },
      },
    },
  ], // 5: help
  [1000, { type: 'walkthrough', index: 80 }], // 6: help
  [1000, pencil(12, 3)], // 7: pencilled in
  [500, pencil(12, 3)], // 8: struck out
  [500, place(12, answer(12))], // 9
  [500, { type: 'erase', index: 12 }], // 10
  [500, UNDO], // 11: the erase taken back, at cell 12
  [0, REDO], // 12: within a tick of the last
  [500, UNDO], // 13
  [500, select(12)],
  [500, { type: 'check', scope: 'cell' }], // 14: help, at cell 12
  [500, { type: 'check', scope: 'puzzle' }], // 15: help, about no one cell
  [500, { type: 'setAutoCandidates', enabled: true }], // 16: every cell
  [500, UNDO], // 17: taking back a change to every cell
  [500, REDO], // 18
  [500, { type: 'setAutoCandidates', enabled: false }], // 19
  [500, { type: 'setCheckGuesses', enabled: true }], // 20
  [500, { type: 'setCheckGuesses', enabled: false }], // 21
  [500, { type: 'hint', hint: { kind: 'deduction', index: -1, technique: null } }], // 22: off the grid
  [500, select(24)],
  [500, { type: 'reveal' }], // 23: help, at cell 24
  [30_000, place(80, answer(80))], // 24: the solve, after a long think
];

function play(steps: readonly Step[], puzzle = PUZZLE): Played {
  return steps.reduce(
    (played, [gapMs, action]) => act(played, action, gapMs),
    startPlaying(puzzle),
  );
}

const PLAYED = play(SCRIPT);
const ENCODED = encodeMoveLog(PLAYED.log);

function prepared(givens = PUZZLE.givens, encoded: unknown = ENCODED): Playback {
  const result = preparePlayback(givens, 'easy', encoded);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.playback;
}

const PLAYBACK = prepared();

/** The position of the first move of `op` (from `from`), as the scrubber counts. */
function positionOf(op: string, from = 0): number {
  const index = PLAYBACK.frames.findIndex((frame, i) => i >= from && frame.change.op === op);
  if (index === -1) throw new Error(`no ${op}`);
  return index + 1;
}

describe('preparePlayback', () => {
  it('plays a solved game back from its givens and log alone', () => {
    expect(PLAYBACK.puzzle).toEqual({ ...PUZZLE, difficulty: 'easy' });
    expect(lengthOf(PLAYBACK)).toBe(PLAYED.log.moves.length);
    expect(lengthOf(PLAYBACK)).toBe(24);
    expect(PLAYBACK.start.cells.map((cell) => cell.value).join('')).toBe(PUZZLE.givens);
    expect(PLAYBACK.frames.at(-1)!.state.status).toBe('solved');
    // Each frame is the game after its move, exactly as it was played.
    expect(PLAYBACK.frames.at(-1)!.state.cells).toEqual(PLAYED.game.cells);
    expect(PLAYBACK.frames.map((frame) => frame.index)).toEqual([...Array(24).keys()]);
  });

  it('carries the tier it is given', () => {
    const result = preparePlayback(PUZZLE.givens, 'expert', ENCODED);
    expect(result.ok && result.playback.puzzle.difficulty).toBe('expert');
  });

  it('starts a game begun in auto candidate mode with its candidates on show', () => {
    let played = startPlaying(PUZZLE, true);
    for (const cell of BLANKS) played = act(played, place(cell, answer(cell)), 1000);
    const playback = prepared(PUZZLE.givens, encodeMoveLog(played.log));
    expect(playback.start.autoCandidates).toBe(true);
  });

  it('says which cell each move acted on, and none for a move about the whole board', () => {
    const cells = PLAYBACK.frames.map((frame) => frame.cell);
    expect(cells).toEqual([
      0, // place
      0,
      40,
      40,
      80, // a hint about cell 80
      80, // Show me for it
      12, // pencil
      12, // strike
      12, // place
      12, // erase
      12, // Undo of the erase: its cell
      12, // Redo
      12, // Undo
      12, // check the cell
      null, // check the puzzle
      null, // auto candidates on
      null, // Undo of a change to every cell
      null, // Redo of it
      null, // auto candidates off
      null, // Check guesses on
      null, // and off
      null, // a hint off the grid
      24, // reveal
      80, // the solve
    ]);
  });

  it('says whether a candidate move pencilled the digit in or struck it out', () => {
    const pencilled = frameAt(PLAYBACK, positionOf('candidate'))!;
    const struck = frameAt(PLAYBACK, positionOf('candidate', pencilled.index + 1))!;
    expect(pencilled.change).toMatchObject({ op: 'candidate', effect: 'pencilled', cleared: null });
    expect(struck.change).toMatchObject({ op: 'candidate', effect: 'struck', cleared: null });
    // Only candidate moves say.
    expect(frameAt(PLAYBACK, 1)!.change).not.toHaveProperty('effect');
  });

  it('strikes a candidate in auto candidate mode from what was on show', () => {
    let played = startPlaying(PUZZLE, true);
    // Cell 0's candidates in auto mode: its answer alone, as a full house.
    played = act(played, pencil(0, answer(0)), 1000);
    played = act(played, pencil(0, answer(0)), 1000);
    for (const cell of BLANKS) played = act(played, place(cell, answer(cell)), 1000);
    const playback = prepared(PUZZLE.givens, encodeMoveLog(played.log));
    expect(playback.frames.slice(0, 2).map((frame) => frame.change)).toMatchObject([
      { op: 'candidate', effect: 'struck', cleared: null },
      { op: 'candidate', effect: 'pencilled', cleared: null },
    ]);
  });

  describe('a candidate entry on a filled cell, which clears its value first', () => {
    /** The first move of `steps` played on `PUZZLE`, then the solve, as played back. */
    function firstChange(steps: readonly GameAction[], isAuto = false) {
      let played = startPlaying(PUZZLE, isAuto);
      for (const action of steps) played = act(played, action, 1000);
      for (const cell of BLANKS) played = act(played, place(cell, answer(cell)), 1000);
      return prepared(PUZZLE.givens, encodeMoveLog(played.log)).frames[steps.length - 1];
    }

    it('strikes the answer in auto mode, where nothing was on show over the value', () => {
      const frame = firstChange([place(0, wrong(0)), pencil(0, answer(0))], true);
      expect(frame.change).toMatchObject({ effect: 'struck', cleared: wrong(0) });
      // As mistakes.ts sees it too: the answer struck, a slip put right by the solve.
      expect(frame.mistakes).toMatchObject([{ kind: 'candidate', cell: 0 }]);
    });

    it('only clears the value in auto mode when the digit is not a candidate to strike', () => {
      // Cell 0's only computed candidate is its answer: the wrong digit is ruled out.
      const frame = firstChange([place(0, wrong(0)), pencil(0, wrong(0))], true);
      expect(frame.change).toMatchObject({ effect: 'unchanged', cleared: wrong(0) });
    });

    it('strikes a note left under the value in manual mode', () => {
      const frame = firstChange([pencil(0, answer(0)), place(0, wrong(0)), pencil(0, answer(0))]);
      expect(frame.change).toMatchObject({ effect: 'struck', cleared: wrong(0) });
      expect(frame.mistakes).toMatchObject([{ kind: 'candidate', cell: 0 }]);
    });

    it('pencils a digit that was not among the notes in manual mode', () => {
      const frame = firstChange([place(0, wrong(0)), pencil(0, answer(0))]);
      expect(frame.change).toMatchObject({ effect: 'pencilled', cleared: wrong(0) });
    });
  });

  it('gives each move the mistakes it made, as they came out by the solve', () => {
    const [mistake, , slip] = PLAYBACK.frames;
    expect(mistake.mistakes).toMatchObject([{ kind: 'value', cell: 0, outcome: 'counted' }]);
    expect(slip.mistakes).toMatchObject([{ kind: 'value', cell: 40, outcome: 'forgiven' }]);
    expect(
      PLAYBACK.frames.filter((frame) => frame.mistakes.length > 0).map((frame) => frame.index),
    ).toEqual([0, 2]);
  });

  it('marks the scrubber at each counted mistake, forgiven slip and move of help', () => {
    expect(PLAYBACK.ticks).toEqual([
      { position: 1, kind: 'mistake' },
      { position: 3, kind: 'slip' },
      { position: 5, kind: 'help' }, // hint
      { position: 6, kind: 'help' }, // Show me
      { position: 14, kind: 'help' }, // check the cell
      { position: 15, kind: 'help' }, // check the puzzle
      { position: 22, kind: 'help' }, // a hint off the grid
      { position: 23, kind: 'help' }, // reveal
    ]);
  });

  it('works with logs of every kind of game, help, rules and all', () => {
    const rng = createRng('playback');
    for (const played of [
      solveByPlacing(EASY_PUZZLE, rng),
      playWithHelp(EASY_PUZZLE, rng),
      tourTheRules(rng),
      checkGuessesTour(rng),
    ]) {
      const result = preparePlayback(EASY_PUZZLE.givens, 'easy', encodeMoveLog(played.log));
      if (!result.ok) throw new Error(result.reason);
      expect(isPlayable(EASY_PUZZLE.givens, encodeMoveLog(played.log))).toBe(true);
      // At most one mark of a kind at a position, in order.
      const marks = result.playback.ticks.map((tick) => `${tick.position}:${tick.kind}`);
      expect(new Set(marks).size).toBe(marks.length);
      const positions = result.playback.ticks.map((tick) => tick.position);
      expect(positions).toEqual([...positions].sort((x, y) => x - y));
    }
  });

  it('plays back a log whose Undo had nothing to take back, as one from a link might hold', () => {
    let log = appendMove(createMoveLog(), { op: 'undo' }, 0);
    let at = 0;
    for (const cell of BLANKS) {
      at += 1000;
      log = appendMove(log, { op: 'place', cell, digit: answer(cell), clearPeerNotes: false }, at);
    }
    const playback = prepared(PUZZLE.givens, encodeMoveLog(log));
    expect(playback.frames[0].cell).toBeNull();
  });

  describe('refuses what it cannot play back, saying why', () => {
    const unsolved = encodeMoveLog(play(SCRIPT.slice(0, 5)).log);
    let truncated = createMoveLog();
    for (let i = 0; i <= MAX_MOVES; i++) truncated = appendMove(truncated, { op: 'undo' }, i);
    // Play logs nothing after the solve; a log from a link could.
    const solvedAt = PLAYED.log.moves.at(-1)!.at;
    const afterTheSolve = encodeMoveLog(
      appendMove(
        appendMove(PLAYED.log, { op: 'undo' }, solvedAt + 1000),
        { op: 'place', cell: 1, digit: answer(1), clearPeerNotes: false },
        solvedAt + 2000,
      ),
    );

    it.each([
      ['givens that make no puzzle', '0'.repeat(81), ENCODED, 'puzzle'],
      ['givens that are not a grid', 'nonsense', ENCODED, 'puzzle'],
      ['no log at all', PUZZLE.givens, null, 'broken'],
      ['a string that is no log', PUZZLE.givens, 'not a log!', 'broken'],
      ['a log cut short', PUZZLE.givens, ENCODED.slice(0, -4), 'broken'],
      ['a log from an older rules version', PUZZLE.givens, logFromAnotherBuild(0, 0), 'older'],
      [
        'a log from a newer rules version',
        PUZZLE.givens,
        logFromAnotherBuild(MOVES_VERSION + 1, 0),
        'newer',
      ],
      [
        'a log holding a move added since',
        PUZZLE.givens,
        logFromAnotherBuild(MOVES_VERSION, 4000),
        'newer',
      ],
      ['a log in a later format', PUZZLE.givens, LOG_IN_A_LATER_FORMAT, 'newer'],
      ['an empty log', PUZZLE.givens, encodeMoveLog(createMoveLog()), 'unsolved'],
      ['a log that stops short of the solve', PUZZLE.givens, unsolved, 'unsolved'],
      ['a log cut off at its limit', PUZZLE.givens, encodeMoveLog(truncated), 'unsolved'],
      ['another puzzle’s log', EASY_PUZZLE.givens, ENCODED, 'unsolved'],
      ['a log that goes on after the solve', PUZZLE.givens, afterTheSolve, 'broken'],
    ] as const)('%s', (_, givens, encoded, reason) => {
      expect(preparePlayback(givens, 'easy', encoded)).toEqual({ ok: false, reason });
      expect(isPlayable(givens, encoded)).toBe(false);
    });

    it('refuses moves after the solve though the log itself reads, and replays to a solve', () => {
      const log = decodeMoveLog(afterTheSolve);
      expect(log?.moves).toHaveLength(lengthOf(PLAYBACK) + 2);
      expect(replayMoves(PUZZLE, log!).status).toBe('solved');
    });
  });
});

describe('isPlayable', () => {
  it('agrees with preparePlayback on a solve', () => {
    expect(isPlayable(PUZZLE.givens, ENCODED)).toBe(true);
  });
});

describe('positions and times', () => {
  it('keeps a position within the playback, as a whole number', () => {
    expect(clampPosition(PLAYBACK, -3)).toBe(0);
    expect(clampPosition(PLAYBACK, 2.4)).toBe(2);
    expect(clampPosition(PLAYBACK, 999)).toBe(24);
    expect(clampPosition(PLAYBACK, Number.NaN)).toBe(0);
  });

  it('shows the givens at the start and the game after k moves at position k', () => {
    expect(stateAt(PLAYBACK, 0)).toBe(PLAYBACK.start);
    expect(stateAt(PLAYBACK, 1)).toBe(PLAYBACK.frames[0].state);
    expect(stateAt(PLAYBACK, 1).cells[0].value).toBe(wrong(0));
    expect(stateAt(PLAYBACK, 99)).toBe(PLAYBACK.frames[23].state);
    expect(frameAt(PLAYBACK, 0)).toBeNull();
    expect(frameAt(PLAYBACK, 24)).toBe(PLAYBACK.frames[23]);
  });

  it('gives the real play time each move was made at', () => {
    expect(playTimeAt(PLAYBACK, 0)).toBe(0);
    expect(playTimeAt(PLAYBACK, 1)).toBe(1000);
    expect(playTimeAt(PLAYBACK, 2)).toBe(5000);
    expect(playTimeAt(PLAYBACK, 24)).toBe(PLAYED.log.moves.at(-1)!.at);
  });

  it('waits the player’s own pause before each move, long ones shortened', () => {
    // 1 s before the first move, 4 s (shortened) before the second, then 1 s.
    expect(pauseBefore(PLAYBACK, 1, 1)).toBe(1000);
    expect(pauseBefore(PLAYBACK, 2, 1)).toBe(LONGEST_PAUSE_MS);
    expect(pauseBefore(PLAYBACK, 4, 1)).toBe(500);
    // The solve came after a 30 s think.
    expect(pauseBefore(PLAYBACK, 24, 1)).toBe(LONGEST_PAUSE_MS);
  });

  it('spreads moves made within a tick, so each still shows', () => {
    // The Redo at position 12 was logged at the same time as the Undo before it.
    expect(playTimeAt(PLAYBACK, 12)).toBe(playTimeAt(PLAYBACK, 11));
    expect(pauseBefore(PLAYBACK, 12, 1)).toBe(SHORTEST_PAUSE_MS);
  });

  it('divides every pause by the speed', () => {
    for (const speed of PLAYBACK_SPEEDS) {
      expect(pauseBefore(PLAYBACK, 2, speed)).toBe(LONGEST_PAUSE_MS / speed);
      expect(pauseBefore(PLAYBACK, 12, speed)).toBe(SHORTEST_PAUSE_MS / speed);
    }
  });

  it('waits for ever outside the playback: there is nothing to show', () => {
    expect(pauseBefore(PLAYBACK, 0, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(pauseBefore(PLAYBACK, 25, 1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('places a mark along the scrubber by its move', () => {
    expect(tickFraction(PLAYBACK, { position: 0, kind: 'help' })).toBe(0);
    expect(tickFraction(PLAYBACK, { position: 6, kind: 'help' })).toBe(0.25);
    expect(tickFraction(PLAYBACK, { position: 24, kind: 'mistake' })).toBe(1);
  });
});

describe('steer', () => {
  const at = (position: number, isPlaying = false, speed: PlaybackCursor['speed'] = 1) => ({
    position,
    isPlaying,
    speed,
  });

  it('opens at the start, paused, at 1×', () => {
    expect(INITIAL_CURSOR).toEqual(at(0));
  });

  it('plays, pauses and toggles between them', () => {
    expect(steer(PLAYBACK, at(3), { type: 'play' })).toEqual(at(3, true));
    expect(steer(PLAYBACK, at(3, true), { type: 'pause' })).toEqual(at(3));
    expect(steer(PLAYBACK, at(3), { type: 'toggle' })).toEqual(at(3, true));
    expect(steer(PLAYBACK, at(3, true), { type: 'toggle' })).toEqual(at(3));
  });

  it('plays from the start again once at the solve', () => {
    expect(steer(PLAYBACK, at(24), { type: 'play' })).toEqual(at(0, true));
    expect(steer(PLAYBACK, at(24), { type: 'toggle' })).toEqual(at(0, true));
  });

  it('steps a move either way, pausing, and never past either end', () => {
    expect(steer(PLAYBACK, at(3, true), { type: 'step', by: 1 })).toEqual(at(4));
    expect(steer(PLAYBACK, at(3, true), { type: 'step', by: -1 })).toEqual(at(2));
    expect(steer(PLAYBACK, at(0), { type: 'step', by: -1 })).toEqual(at(0));
    expect(steer(PLAYBACK, at(24), { type: 'step', by: 1 })).toEqual(at(24));
  });

  it('jumps to the start and the solve, pausing', () => {
    expect(steer(PLAYBACK, at(9, true), { type: 'start' })).toEqual(at(0));
    expect(steer(PLAYBACK, at(9, true), { type: 'end' })).toEqual(at(24));
  });

  it('seeks, playing on if it was, but not from the solve', () => {
    expect(steer(PLAYBACK, at(9), { type: 'seek', position: 4 })).toEqual(at(4));
    expect(steer(PLAYBACK, at(9, true), { type: 'seek', position: 4 })).toEqual(at(4, true));
    expect(steer(PLAYBACK, at(9, true), { type: 'seek', position: 24 })).toEqual(at(24));
    expect(steer(PLAYBACK, at(9), { type: 'seek', position: 400 })).toEqual(at(24));
  });

  it('shows the next move as a pause ends, stopping at the solve', () => {
    expect(steer(PLAYBACK, at(9, true), { type: 'advance' })).toEqual(at(10, true));
    expect(steer(PLAYBACK, at(23, true), { type: 'advance' })).toEqual(at(24));
    // A pause that ends after the viewer paused shows nothing.
    const paused = at(9);
    expect(steer(PLAYBACK, paused, { type: 'advance' })).toBe(paused);
  });

  it('changes speed, keeping its place and whether it plays', () => {
    expect(steer(PLAYBACK, at(9, true), { type: 'speed', speed: 8 })).toEqual(at(9, true, 8));
  });
});
