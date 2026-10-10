import {
  createGame,
  deserialiseGame,
  reduce,
  serialiseGame,
  type GameAction,
  type GameState,
  type RememberedHints,
} from './game';
import { formatGrid, gridValues } from './grid';
import {
  MAX_MOVES,
  MOVES_VERSION,
  MOVE_LOG_FORMAT,
  MOVE_TICK_MS,
  appendMove,
  createMoveLog,
  decodeMoveLog,
  encodeMoveLog,
  moveFor,
  readMoveLogHeader,
  replayMoveSteps,
  replayMoves,
  verifiedMoveCount,
  verifyMoveLog,
  type LoggedHint,
  type Move,
  type MoveLog,
} from './moves';
import { createRng, seedFromString } from './rng';
import { solve } from './solver';
import type { Digit, Hint, Puzzle, SingleTechniqueId, TechniqueId, UnitKind } from './types';
import {
  EASY_PUZZLE,
  EXPERT_PUZZLES,
  act,
  randomAction,
  solveByPlacing,
  solveWithAutoCandidates,
  solveWithNotes,
  startPlaying,
  thinking,
  type Played,
} from '../test/movePlayers';

// The Wikipedia puzzle (EASY_PUZZLE). Landmarks used below:
//   cell 0 is a given 5;
//   cell 2 is the first empty cell: solution 4, candidates 1 2 4;
//   cell 3 is empty: solution 6, candidates 2 6;
//   cell 40 (the centre) is empty: solution 5, and not a peer of cells 2 or 3.
const PUZZLE = EASY_PUZZLE;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/*
 * The format, written out again from its description rather than taken from
 * the module, so that these tests hold the encoder to the spec and not to
 * itself.
 */
const BARE = 34 * 81;
const RESERVED_CHECK_GUESSES = [BARE + 5, BARE + 6];
const HINT_AT = (cell: number) => 28 * 81 + cell;

/*
 * The hint descriptors, written out from the format: a mistake 0, a deduction
 * with no technique 1, a named deduction by its own number, and a single
 * 64 + technique × 28 + unit, the unit 0 for none or 1 + kind × 9 + index.
 * Every number is part of the format, so these are literals: renumbering the
 * module's table, or swapping two of its entries, fails here.
 */
const MISTAKE_DESCRIPTOR = 0;
const UNNAMED_DESCRIPTOR = 1;
const DEDUCTION_DESCRIPTORS: Readonly<Record<TechniqueId, number>> = {
  fullHouse: 2,
  hiddenSingleBox: 3,
  hiddenSingleLine: 4,
  nakedSingle: 5,
  pointing: 6,
  claiming: 7,
  nakedPair: 8,
  hiddenPair: 9,
  nakedTriple: 10,
  hiddenTriple: 11,
  xWing: 12,
  swordfish: 13,
  xyWing: 14,
  xyzWing: 15,
  skyscraper: 16,
  twoStringKite: 17,
  xyChain: 18,
  wWing: 19,
  alternatingChain: 20,
};
const SINGLE_DESCRIPTOR_BASE = 64;
const SINGLE_TECHNIQUE_CODES: Readonly<Record<SingleTechniqueId, number>> = {
  fullHouse: 0,
  hiddenSingleBox: 1,
  hiddenSingleLine: 2,
  nakedSingle: 3,
};
const UNIT_KIND_CODES: Readonly<Record<UnitKind, number>> = { row: 0, column: 1, box: 2 };

/** A hint's descriptor, from the literals above. */
function descriptorOf(hint: LoggedHint): number {
  if (hint.kind === 'mistake') return MISTAKE_DESCRIPTOR;
  if (hint.kind === 'deduction') {
    return hint.technique === null ? UNNAMED_DESCRIPTOR : DEDUCTION_DESCRIPTORS[hint.technique];
  }
  const unit = hint.unit === null ? 0 : 1 + UNIT_KIND_CODES[hint.unit.kind] * 9 + hint.unit.index;
  return SINGLE_DESCRIPTOR_BASE + SINGLE_TECHNIQUE_CODES[hint.technique] * 28 + unit;
}

/** A 12-bit number as two chars. */
const pair = (value: number) => ALPHABET[value >> 6] + ALPHABET[value & 63];

/** A body with its check: the low 18 bits of FNV-1a, in three chars. */
function withCheck(body: string): string {
  const hash = seedFromString(body);
  return body + ALPHABET[(hash >> 12) & 63] + ALPHABET[(hash >> 6) & 63] + ALPHABET[hash & 63];
}

/** A header for this build: format, rules and flags. */
const header = (flags = 0) => ALPHABET[MOVE_LOG_FORMAT] + ALPHABET[MOVES_VERSION] + ALPHABET[flags];

const ALL_SINGLES: readonly SingleTechniqueId[] = [
  'fullHouse',
  'hiddenSingleBox',
  'hiddenSingleLine',
  'nakedSingle',
];
const ALL_TECHNIQUES: readonly TechniqueId[] = [
  ...ALL_SINGLES,
  'pointing',
  'claiming',
  'nakedPair',
  'hiddenPair',
  'nakedTriple',
  'hiddenTriple',
  'xWing',
  'swordfish',
  'xyWing',
  'xyzWing',
  'skyscraper',
  'twoStringKite',
  'xyChain',
  'wWing',
  'alternatingChain',
];
const UNIT_KINDS: readonly UnitKind[] = ['row', 'column', 'box'];

/** Every hint the log can hold, about `index`. */
function everyHint(index: number): LoggedHint[] {
  const singles = ALL_SINGLES.flatMap((technique) => [
    { kind: 'single' as const, index, technique, unit: null },
    ...UNIT_KINDS.flatMap((kind) =>
      Array.from({ length: 9 }, (_, unit) => ({
        kind: 'single' as const,
        index,
        technique,
        unit: { kind, index: unit },
      })),
    ),
  ]);
  return [
    { kind: 'mistake', index },
    { kind: 'deduction', index, technique: null },
    ...ALL_TECHNIQUES.map((technique) => ({ kind: 'deduction' as const, index, technique })),
    ...singles,
  ];
}

/** Every move the log can hold, at a few cells. */
function everyMove(): Move[] {
  const moves: Move[] = [];
  for (const cell of [0, 40, 80]) {
    for (let d = 1; d <= 9; d++) {
      const digit = d as Digit;
      moves.push({ op: 'place', cell, digit, clearPeerNotes: false });
      moves.push({ op: 'place', cell, digit, clearPeerNotes: true });
      moves.push({ op: 'candidate', cell, digit });
    }
    for (const op of [
      'erase',
      'walkthrough',
      'checkCell',
      'reveal',
      'autoOn',
      'autoOff',
    ] as const) {
      moves.push({ op, cell });
    }
    moves.push(...everyHint(cell).map((hint): Move => ({ op: 'hint', hint })));
  }
  moves.push({ op: 'hint', hint: { kind: 'deduction', index: -1, technique: 'xWing' } });
  for (const op of ['undo', 'redo', 'checkPuzzle', 'reset'] as const) moves.push({ op });
  return moves;
}

/** A log of `moves`, `gapMs` apart. */
function logOf(moves: readonly Move[], gapMs = 1000, autoCandidates = false): MoveLog {
  return moves.reduce(
    (log, move, i) => appendMove(log, move, (i + 1) * gapMs),
    createMoveLog({ autoCandidates }),
  );
}

/** Play `actions` from a new game, logging as a session would. */
function playActions(actions: readonly GameAction[], puzzle: Puzzle = PUZZLE): Played {
  return actions.reduce((played, action) => act(played, action, 1500), startPlaying(puzzle));
}

const place = (index: number, digit: number, clearPeerNotes?: boolean): GameAction => ({
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
const select = (index: number): GameAction => ({ type: 'select', index });

/** What a save holds of a game, hints included: what live and replayed games are compared on. */
function boardOf(state: GameState) {
  return {
    cells: state.cells,
    autoCandidates: state.autoCandidates,
    status: state.status,
    assists: state.assists,
    cellHints: state.cellHints,
  };
}

/** A game reloaded from storage: serialised, through JSON and back. */
function reload(state: GameState): GameState {
  return deserialiseGame(JSON.parse(JSON.stringify(serialiseGame(state))))!;
}

// ---------------------------------------------------------------------------

describe('moveFor', () => {
  const game = createGame(PUZZLE);

  it('logs nothing for an action that changed nothing', () => {
    expect(moveFor(game, place(0, 9))).toBeNull(); // a given
    expect(moveFor(game, { type: 'undo' })).toBeNull();
    expect(moveFor(game, { type: 'erase', index: 2 })).toBeNull();
  });

  it('logs nothing for selecting, moving or switching the mode, though they change the state', () => {
    for (const action of [
      select(40),
      { type: 'move', direction: 'right' },
      { type: 'setMode', mode: 'candidate' },
      { type: 'toggleMode' },
    ] satisfies GameAction[]) {
      expect(reduce(game, action)).not.toBe(game);
      expect(moveFor(game, action)).toBeNull();
    }
  });

  it('logs nothing for a hint with nothing to suggest', () => {
    const action: GameAction = { type: 'hint', hint: { kind: 'none' } };
    expect(reduce(game, action)).not.toBe(game);
    expect(moveFor(game, action)).toBeNull();
  });

  it('takes the next state when given it, rather than reducing again', () => {
    expect(moveFor(game, place(2, 4), game)).toBeNull();
    expect(moveFor(game, place(2, 4), reduce(game, place(2, 4)))).toEqual(
      moveFor(game, place(2, 4)),
    );
  });

  it('fills in the selected cell and the latched mode an entry left to the state', () => {
    const at40 = reduce(game, select(40));
    expect(moveFor(at40, { type: 'enter', digit: 5 })).toEqual({
      op: 'place',
      cell: 40,
      digit: 5,
      clearPeerNotes: false,
    });
    const candidates = reduce(at40, { type: 'setMode', mode: 'candidate' });
    expect(moveFor(candidates, { type: 'enter', digit: 5 })).toEqual({
      op: 'candidate',
      cell: 40,
      digit: 5,
    });
    // An explicit mode wins over the latched one.
    expect(moveFor(candidates, place(3, 6))).toMatchObject({ op: 'place', cell: 3 });
    expect(moveFor(game, pencil(3, 6))).toEqual({ op: 'candidate', cell: 3, digit: 6 });
  });

  it('keeps the setting for clearing peers’ notes on a placement', () => {
    expect(moveFor(game, place(2, 4, true))).toMatchObject({ op: 'place', clearPeerNotes: true });
    expect(moveFor(game, place(2, 4, false))).toMatchObject({ op: 'place', clearPeerNotes: false });
  });

  it('fills in the cell an erase defaulted to', () => {
    const filled = reduce(reduce(game, place(40, 5)), select(40));
    expect(moveFor(filled, { type: 'erase' })).toEqual({ op: 'erase', cell: 40 });
    expect(moveFor(reduce(filled, select(2)), { type: 'erase', index: 40 })).toEqual({
      op: 'erase',
      cell: 40,
    });
  });

  it('records the selected cell with Check cell, Reveal and the auto candidate switch', () => {
    const wrong = reduce(reduce(game, place(40, 9)), select(40));
    expect(moveFor(wrong, { type: 'check', scope: 'cell' })).toEqual({ op: 'checkCell', cell: 40 });
    expect(moveFor(wrong, { type: 'check', scope: 'puzzle' })).toEqual({ op: 'checkPuzzle' });
    expect(moveFor(wrong, { type: 'reveal' })).toEqual({ op: 'reveal', cell: 40 });
    const on = { type: 'setAutoCandidates', enabled: true } as const;
    expect(moveFor(wrong, on)).toEqual({ op: 'autoOn', cell: 40 });
    const off = { type: 'setAutoCandidates', enabled: false } as const;
    expect(moveFor(reduce(wrong, on), off)).toEqual({ op: 'autoOff', cell: 40 });
  });

  it('logs Show me opened again for free, though it changes nothing: it is help seen', () => {
    const hinted = reduce(game, {
      type: 'hint',
      hint: { kind: 'deduction', index: 3, technique: 'pointing' },
    });
    const shown = reduce(hinted, { type: 'walkthrough', index: 3 });
    expect(reduce(shown, { type: 'walkthrough', index: 3 })).toBe(shown);
    expect(moveFor(shown, { type: 'walkthrough', index: 3 })).toEqual({
      op: 'walkthrough',
      cell: 3,
    });
  });

  it('logs nothing for a Show me that does not open', () => {
    const hinted = reduce(game, {
      type: 'hint',
      hint: { kind: 'deduction', index: 3, technique: 'pointing' },
    });
    // No fill hint remembered for the cell, or none for any cell off the grid.
    expect(moveFor(hinted, { type: 'walkthrough', index: 2 })).toBeNull();
    expect(moveFor(hinted, { type: 'walkthrough', index: -1 })).toBeNull();
    // A mistake hint has no walkthrough.
    const wrong = reduce(game, place(40, 9));
    const flagged = reduce(wrong, { type: 'hint', hint: { kind: 'mistake', index: 40 } });
    expect(moveFor(flagged, { type: 'walkthrough', index: 40 })).toBeNull();
    // A cell that holds a value, its hint kept while the value is wrong.
    const filled = reduce(hinted, place(3, 2));
    expect(filled.cellHints.get(3)?.fill).not.toBeNull();
    expect(moveFor(filled, { type: 'walkthrough', index: 3 })).toBeNull();
    // A solved game, every cell of which is full.
    const { game: solved } = solveByPlacing(PUZZLE, createRng('moves/show-me'), 0);
    for (let index = 0; index < 81; index++) {
      expect(moveFor(solved, { type: 'walkthrough', index })).toBeNull();
    }
  });

  it('logs Undo, Redo, Reset and Show me', () => {
    const placed = reduce(game, place(40, 5));
    expect(moveFor(placed, { type: 'undo' })).toEqual({ op: 'undo' });
    expect(moveFor(reduce(placed, { type: 'undo' }), { type: 'redo' })).toEqual({ op: 'redo' });
    expect(moveFor(placed, { type: 'reset' })).toEqual({ op: 'reset' });
    const hinted = reduce(game, {
      type: 'hint',
      hint: { kind: 'deduction', index: 3, technique: 'pointing' },
    });
    expect(moveFor(hinted, { type: 'walkthrough', index: 3 })).toEqual({
      op: 'walkthrough',
      cell: 3,
    });
  });

  it('logs a hint whole — kind, technique and unit — and exactly as decoding gives it back', () => {
    const hint = {
      kind: 'single',
      index: 40,
      technique: 'hiddenSingleBox',
      unit: { kind: 'box', index: 4, extra: 'not logged' },
    } as Hint;
    expect(moveFor(game, { type: 'hint', hint })).toStrictEqual({
      op: 'hint',
      hint: {
        kind: 'single',
        index: 40,
        technique: 'hiddenSingleBox',
        unit: { kind: 'box', index: 4 },
      },
    });
  });

  it('logs a hint off the grid, which the reducer counts, as about cell -1', () => {
    for (const index of [-3, 81, 2.5]) {
      const hint: Hint = { kind: 'mistake', index };
      expect(moveFor(game, { type: 'hint', hint })).toEqual({
        op: 'hint',
        hint: { kind: 'mistake', index: -1 },
      });
    }
  });

  it.each([
    ['an unknown technique', { kind: 'deduction', index: 3, technique: 'guessing' }],
    [
      'a single by a technique that is not a single',
      { kind: 'single', index: 3, technique: 'xWing', unit: null },
    ],
    [
      'an unknown unit',
      { kind: 'single', index: 3, technique: 'fullHouse', unit: { kind: 'band', index: 0 } },
    ],
    [
      'a unit off the board',
      { kind: 'single', index: 3, technique: 'fullHouse', unit: { kind: 'row', index: 9 } },
    ],
    [
      'a unit before the board',
      { kind: 'single', index: 3, technique: 'fullHouse', unit: { kind: 'row', index: -1 } },
    ],
    [
      'a fractional unit',
      { kind: 'single', index: 3, technique: 'fullHouse', unit: { kind: 'row', index: 0.5 } },
    ],
  ])('throws for a hint the log has no code for: %s', (_, hint) => {
    const action = { type: 'hint', hint } as GameAction;
    expect(() => moveFor(game, action)).toThrow(RangeError);
  });
});

describe('appendMove', () => {
  const move: Move = { op: 'undo' };

  it('starts a log for a game as it was created', () => {
    expect(createMoveLog()).toEqual({ autoCandidates: false, moves: [], truncated: false });
    expect(createMoveLog({ autoCandidates: true }).autoCandidates).toBe(true);
  });

  it('adds the move at its play-clock time, rounded down to 100 ms, never later than the clock', () => {
    expect(MOVE_TICK_MS).toBe(100);
    expect(appendMove(createMoveLog(), move, 149).moves).toEqual([{ op: 'undo', at: 100 }]);
    for (const [atMs, at] of [
      [150, 100],
      [199.9, 100],
      [200, 200],
      [299_951, 299_900],
      [12_345.6, 12_300],
    ]) {
      expect(appendMove(createMoveLog(), move, atMs).moves[0].at).toBe(at);
    }
  });

  it('never lets time go backwards', () => {
    const log = appendMove(appendMove(createMoveLog(), move, 5000), move, 3000);
    expect(log.moves.map(({ at }) => at)).toEqual([5000, 5000]);
    expect(appendMove(createMoveLog(), move, -2000).moves[0].at).toBe(0);
    expect(appendMove(log, move, Number.NEGATIVE_INFINITY).moves[2].at).toBe(5000);
  });

  it('takes a time that is not a number as the last move’s', () => {
    const log = appendMove(createMoveLog(), move, 4200);
    expect(appendMove(log, move, Number.NaN).moves[1].at).toBe(4200);
    expect(appendMove(createMoveLog(), move, Number.NaN).moves[0].at).toBe(0);
  });

  it('shortens a gap too long to encode to the longest that is', () => {
    const longest = (32 ** 6 - 1) * MOVE_TICK_MS;
    const log = appendMove(appendMove(createMoveLog(), move, 1000), move, Number.POSITIVE_INFINITY);
    expect(log.moves[1].at).toBe(1000 + longest);
    expect(decodeMoveLog(encodeMoveLog(log))).toEqual(log);
  });

  it('leaves the log it was given as it was', () => {
    const log = appendMove(createMoveLog(), move, 1000);
    const longer = appendMove(log, move, 2000);
    expect(longer).not.toBe(log);
    expect(log.moves).toHaveLength(1);
  });

  it('stops at MAX_MOVES and marks the log truncated', () => {
    const full = logOf(
      Array.from({ length: MAX_MOVES }, () => move),
      100,
    );
    expect(full.truncated).toBe(false);
    const truncated = appendMove(full, move, 1e9);
    expect(truncated).toEqual({ ...full, truncated: true });
    expect(appendMove(truncated, move, 2e9)).toBe(truncated);
    expect(decodeMoveLog(encodeMoveLog(truncated))).toEqual(truncated);
  });
});

describe('encodeMoveLog and decodeMoveLog', () => {
  it('round-trip every move the log can hold', () => {
    const log = logOf(everyMove(), 2300, true);
    expect(decodeMoveLog(encodeMoveLog(log))).toEqual(log);
  });

  it('round-trip gaps of every length a varint takes', () => {
    const ticks = [0, 1, 31, 32, 1023, 1024, 32 ** 3, 32 ** 4, 32 ** 5, 32 ** 6 - 1];
    let at = 0;
    let log = createMoveLog();
    for (const gap of ticks) {
      at += gap * MOVE_TICK_MS;
      log = appendMove(log, { op: 'redo' }, at);
    }
    const text = encodeMoveLog(log);
    expect(decodeMoveLog(text)).toEqual(log);
    // Header and check 6, each move 2, its gap 1+1+1+2+2+3+4+5+6+6.
    expect(text).toHaveLength(6 + 2 * ticks.length + 31);
  });

  it('writes an empty log as its header and check alone', () => {
    expect(encodeMoveLog(createMoveLog())).toBe(withCheck('BBA'));
    expect(encodeMoveLog(createMoveLog({ autoCandidates: true }))).toBe(withCheck('BBB'));
    expect(decodeMoveLog(withCheck('BBA'))).toEqual(createMoveLog());
  });

  it('writes moves exactly as the format describes', () => {
    const log = logOf([], 0);
    const moves: [Move, number][] = [
      [{ op: 'place', cell: 2, digit: 4, clearPeerNotes: false }, 1200],
      [{ op: 'candidate', cell: 3, digit: 2 }, 3700],
      [{ op: 'hint', hint: { kind: 'deduction', index: 3, technique: 'pointing' } }, 43_700],
      [{ op: 'undo' }, 43_700],
    ];
    const written = moves.reduce((next, [move, at]) => appendMove(next, move, at), log);
    const body = [
      header(),
      // Place 4 (op 3) at cell 2, 12 ticks in.
      pair(3 * 81 + 2) + ALPHABET[12],
      // Pencil 2 (op 19) at cell 3, 25 ticks later.
      pair(19 * 81 + 3) + ALPHABET[25],
      // A pointing hint (descriptor 6) at cell 3, 400 ticks later: 16 and more, then 12.
      pair(HINT_AT(3)) + pair(6) + ALPHABET[16 | 32] + ALPHABET[12],
      // Undo, at once.
      pair(BARE) + ALPHABET[0],
    ];
    expect(encodeMoveLog(written)).toBe(withCheck(body.join('')));
  });

  it('accepts every code this rules version uses and refuses the rest, Check guesses’ included', () => {
    const accepted: number[] = [];
    for (let code = 0; code < 4096; code++) {
      const isHint = code === BARE + 4 || Math.floor(code / 81) === 28;
      const body = header() + pair(code) + (isHint ? pair(0) : '') + 'A';
      if (decodeMoveLog(withCheck(body)) !== null) accepted.push(code);
    }
    expect(accepted).toEqual(Array.from({ length: BARE + 5 }, (_, code) => code));
    for (const code of RESERVED_CHECK_GUESSES) expect(accepted).not.toContain(code);
  });

  it('accepts every hint descriptor in the table and refuses the rest', () => {
    const accepted: number[] = [];
    for (let descriptor = 0; descriptor < 4096; descriptor++) {
      const body = header() + pair(HINT_AT(40)) + pair(descriptor) + 'A';
      if (decodeMoveLog(withCheck(body)) !== null) accepted.push(descriptor);
    }
    const singles = Array.from({ length: 4 * 28 }, (_, i) => 64 + i);
    expect(accepted).toEqual([...Array.from({ length: 21 }, (_, i) => i), ...singles]);
  });

  it('decodes from the string alone, and replays with the givens alone', () => {
    const { game, log } = solveWithAutoCandidates(EXPERT_PUZZLES[0], createRng('moves/alone'));
    const text = encodeMoveLog(log);
    const { givens } = EXPERT_PUZZLES[0];
    const puzzle: Puzzle = {
      givens,
      solution: formatGrid(solve(gridValues(givens))!),
      difficulty: 'expert',
    };
    expect(boardOf(replayMoves(puzzle, decodeMoveLog(text)!))).toEqual(boardOf(game));
  });

  it.each([
    ['not a string', 42],
    ['null', null],
    ['an object', {}],
    ['empty', ''],
    ['the header alone', 'BBA'],
    ['plain base64', withCheck('BBA') + '+'],
    ['padded', `${withCheck('BBA')}=`],
    ['with a space', withCheck('BB A')],
    ['far too long', 'A'.repeat(3 + MAX_MOVES * 10 + 4)],
  ])('refuses a string that is not a log: %s', (_, text) => {
    expect(decodeMoveLog(text)).toBeNull();
  });

  it('refuses a log with a char changed anywhere, or cut short anywhere — between moves too', () => {
    const { log } = solveByPlacing(PUZZLE, createRng('moves/cut'));
    const text = encodeMoveLog(log);
    for (let length = 0; length < text.length; length++) {
      expect(decodeMoveLog(text.slice(0, length)), `cut to ${length}`).toBeNull();
    }
    for (let i = 0; i < text.length; i++) {
      const changed = ALPHABET[(ALPHABET.indexOf(text[i]) + 1) % 64];
      expect(decodeMoveLog(text.slice(0, i) + changed + text.slice(i + 1)), `char ${i}`).toBeNull();
    }
  });

  it('refuses a log from a format or rules version this build does not know', () => {
    for (const version of ['A', 'C', '_']) {
      expect(decodeMoveLog(withCheck(`${version}BA`))).toBeNull();
      expect(decodeMoveLog(withCheck(`B${version}A`))).toBeNull();
    }
  });

  it('refuses flags this build does not know', () => {
    for (let flags = 4; flags < 64; flags++) {
      expect(decodeMoveLog(withCheck(header(flags)))).toBeNull();
    }
  });

  it('refuses a log marked truncated short of MAX_MOVES, and one longer than MAX_MOVES', () => {
    expect(decodeMoveLog(withCheck(header(2) + pair(BARE) + 'A'))).toBeNull();
    const full = header() + (pair(BARE) + 'A').repeat(MAX_MOVES);
    expect(decodeMoveLog(withCheck(full))?.moves).toHaveLength(MAX_MOVES);
    expect(decodeMoveLog(withCheck(full + pair(BARE) + 'A'))).toBeNull();
  });

  it.each([
    ['a code cut short', header() + 'A'],
    ['a move without its gap', header() + pair(BARE)],
    ['a hint without its descriptor', header() + pair(HINT_AT(0))],
    ['a hint with half a descriptor', header() + pair(HINT_AT(0)) + 'A'],
    ['a hint with a descriptor not in the table', header() + pair(HINT_AT(0)) + pair(21) + 'A'],
    ['a gap that runs out', header() + pair(BARE) + 'g'],
    ['a gap written with a needless char', header() + pair(BARE) + 'gA'],
    ['a gap of more than six chars', header() + pair(BARE) + 'gggggg' + 'B'],
  ])('refuses a body that is not well formed: %s', (_, body) => {
    expect(decodeMoveLog(withCheck(body))).toBeNull();
  });

  it.each([
    ['more than MAX_MOVES moves', MAX_MOVES + 1, false],
    ['more than MAX_MOVES moves, marked truncated', MAX_MOVES + 1, true],
    ['marked truncated short of MAX_MOVES', 1, true],
    ['empty and marked truncated', 0, true],
  ])('throws for a log appendMove could not have built: %s', (_, count, truncated) => {
    const log: MoveLog = {
      autoCandidates: false,
      moves: Array.from({ length: count }, () => ({ op: 'undo', at: 0 })),
      truncated,
    };
    expect(() => encodeMoveLog(log)).toThrow(RangeError);
  });

  it.each([
    ['a move off the grid', { op: 'erase', cell: 81 }],
    ['a digit of 0', { op: 'place', cell: 2, digit: 0, clearPeerNotes: false }],
    ['a digit of 10', { op: 'candidate', cell: 2, digit: 10 }],
    [
      'a hint with no code',
      { op: 'hint', hint: { kind: 'deduction', index: 2, technique: 'guess' } },
    ],
  ])('throws for a log appendMove could not have built: %s', (_, move) => {
    const log: MoveLog = {
      autoCandidates: false,
      moves: [{ ...(move as Move), at: 0 }],
      truncated: false,
    };
    expect(() => encodeMoveLog(log)).toThrow(RangeError);
  });

  it.each([
    ['not a whole tick', [150]],
    ['going backwards', [500, 400]],
    ['leaping further than a varint holds', [32 ** 6 * MOVE_TICK_MS]],
  ])('throws for times appendMove could not have written: %s', (_, times) => {
    const log: MoveLog = {
      autoCandidates: false,
      moves: times.map((at) => ({ op: 'undo', at })),
      truncated: false,
    };
    expect(() => encodeMoveLog(log)).toThrow(RangeError);
  });
});

describe('the hint descriptors', () => {
  it('are written, and read back, exactly as the format numbers them', () => {
    for (const hint of everyHint(40)) {
      const text = withCheck(header() + pair(HINT_AT(40)) + pair(descriptorOf(hint)) + 'A');
      expect(encodeMoveLog(logOf([{ op: 'hint', hint }], 0)), JSON.stringify(hint)).toBe(text);
      expect(decodeMoveLog(text)?.moves, JSON.stringify(hint)).toEqual([
        { op: 'hint', hint, at: 0 },
      ]);
    }
  });

  it('give every hint a descriptor of its own', () => {
    const descriptors = everyHint(40).map(descriptorOf);
    expect(new Set(descriptors).size).toBe(descriptors.length);
  });
});

describe('readMoveLogHeader', () => {
  it('reads the versions of a log this build wrote', () => {
    const text = encodeMoveLog(logOf([{ op: 'undo' }]));
    expect(readMoveLogHeader(text)).toEqual({ format: MOVE_LOG_FORMAT, rules: MOVES_VERSION });
  });

  it('reads the rules version of a log from an older or a newer one, which decoding refuses', () => {
    for (const rules of [MOVES_VERSION - 1, MOVES_VERSION + 1, 63]) {
      const text = withCheck(ALPHABET[MOVE_LOG_FORMAT] + ALPHABET[rules] + 'A');
      expect(decodeMoveLog(text)).toBeNull();
      expect(readMoveLogHeader(text)).toEqual({ format: MOVE_LOG_FORMAT, rules });
    }
  });

  it('reads only the format of a later one, whose layout this build cannot know', () => {
    for (const later of [ALPHABET[MOVE_LOG_FORMAT + 1], '_']) {
      expect(readMoveLogHeader(later)).toEqual({ format: ALPHABET.indexOf(later), rules: null });
      expect(readMoveLogHeader(`${later}anything-at_all`)?.rules).toBeNull();
    }
  });

  it.each([
    ['not a string', 42],
    ['empty', ''],
    ['not base64url', 'BBA+++'],
    ['a format before the first', withCheck('ABA')],
    ['cut short of its check', 'BBAAA'],
    ['a check that fails', `${withCheck('BBA').slice(0, -1)}A`],
    ['a garbled rules version', `BC${withCheck('BBA').slice(2)}`],
  ])('finds no versions in a string that is not a log: %s', (_, text) => {
    expect(readMoveLogHeader(text)).toBeNull();
  });
});

describe('replayMoves', () => {
  it('replays a log from a new game, in auto candidate mode if the game began in it', () => {
    expect(replayMoves(PUZZLE, createMoveLog())).toEqual(createGame(PUZZLE));
    const auto = createMoveLog({ autoCandidates: true });
    expect(replayMoves(PUZZLE, auto)).toEqual(createGame(PUZZLE, { autoCandidates: true }));
  });

  it('stops after the first upTo moves', () => {
    const { log } = playActions([place(2, 4), place(3, 6), place(40, 5)]);
    expect(replayMoves(PUZZLE, log, 0)).toEqual(createGame(PUZZLE));
    expect(replayMoves(PUZZLE, log, -1)).toEqual(createGame(PUZZLE));
    expect(replayMoves(PUZZLE, log, 2).cells[40].value).toBe(0);
    expect(replayMoves(PUZZLE, log, 2).cells[3].value).toBe(6);
    expect(replayMoves(PUZZLE, log, 99)).toEqual(replayMoves(PUZZLE, log));
  });

  it('selects the cell first for the moves that act on the selection, which is not logged', () => {
    const played = playActions([
      place(40, 9),
      select(40),
      { type: 'check', scope: 'cell' },
      select(3),
      { type: 'setAutoCandidates', enabled: true },
      select(2),
      { type: 'reveal' },
      select(60),
      { type: 'undo' },
    ]);
    const replayed = replayMoves(PUZZLE, played.log);
    expect(replayed.cells[40].mark).toBe('wrong');
    expect(replayed.cells[2].mark).toBe('revealed');
    // Undoing the switch selects where it was made, so its entry recorded that.
    expect(replayed.selected).toBe(3);
    expect(replayed.redoStack).toEqual(played.game.redoStack);
  });

  it('steps through the log, each step with the game before and after its move', () => {
    const { log } = solveWithNotes(PUZZLE, createRng('moves/steps'));
    const steps = [...replayMoveSteps(PUZZLE, log)];
    expect(steps).toHaveLength(log.moves.length);
    expect(steps[0].before).toEqual(createGame(PUZZLE));
    steps.forEach((step, i) => {
      expect(step.index).toBe(i);
      expect(step.move).toBe(log.moves[i]);
      if (i > 0) expect(step.before).toBe(steps[i - 1].after);
    });
    expect(steps[20].after).toEqual(replayMoves(PUZZLE, log, 21));
    expect(steps.at(-1)!.after).toEqual(replayMoves(PUZZLE, log));
    expect(steps.at(-1)!.after.status).toBe('solved');
  });
});

describe('verifyMoveLog', () => {
  const played = playActions([
    place(2, 4),
    place(40, 9),
    pencil(3, 2),
    pencil(3, 6),
    { type: 'hint', hint: { kind: 'mistake', index: 40 } },
    {
      type: 'hint',
      hint: {
        kind: 'single',
        index: 10,
        technique: 'hiddenSingleBox',
        unit: { kind: 'box', index: 0 },
      },
    },
    { type: 'hint', hint: { kind: 'deduction', index: 21, technique: 'pointing' } },
    { type: 'walkthrough', index: 21 },
    { type: 'setAutoCandidates', enabled: true },
    pencil(3, 2),
  ]);
  const { game, log } = played;

  /** The game with one cell changed. */
  const withCell = (index: number, change: Partial<GameState['cells'][number]>): GameState => ({
    ...game,
    cells: game.cells.map((cell, i) => (i === index ? { ...cell, ...change } : cell)),
  });

  /** The game with one cell's remembered hints changed (or, for null, forgotten). */
  const withHints = (index: number, change: Partial<RememberedHints> | null): GameState => {
    const cellHints = new Map(game.cellHints);
    if (change === null) cellHints.delete(index);
    else cellHints.set(index, { ...cellHints.get(index)!, ...change });
    return { ...game, cellHints };
  };

  it('vouches for the game the log rebuilds, as played and as reloaded', () => {
    expect(verifyMoveLog(PUZZLE, log, game)).toBe(true);
    expect(verifyMoveLog(PUZZLE, log, reload(game))).toBe(true);
    // Selection and mode are not part of it.
    expect(
      verifyMoveLog(PUZZLE, log, reduce(reduce(game, select(70)), { type: 'toggleMode' })),
    ).toBe(true);
  });

  it('does not vouch for a game of another puzzle', () => {
    const other = { ...PUZZLE, givens: `0${PUZZLE.givens.slice(1)}` };
    expect(verifyMoveLog(other, log, game)).toBe(false);
    expect(verifyMoveLog(PUZZLE, log, { ...game, puzzle: other })).toBe(false);
    const solution = { ...PUZZLE, solution: `9${PUZZLE.solution.slice(1)}` };
    expect(verifyMoveLog(PUZZLE, log, { ...game, puzzle: solution })).toBe(false);
  });

  it('does not vouch for a game the log cannot reach', () => {
    expect(verifyMoveLog(PUZZLE, { ...log, truncated: true }, game)).toBe(false);
    expect(verifyMoveLog(PUZZLE, { ...log, moves: log.moves.slice(0, -1) }, game)).toBe(false);
  });

  it.each([
    ['a value', () => withCell(2, { value: 1 })],
    ['a cell’s notes', () => withCell(3, { notes: 0 })],
    ['a cell’s eliminations', () => withCell(3, { autoRemoved: 0 })],
    ['a mark', () => withCell(40, { mark: 'none' })],
    ['the auto candidate flag', () => ({ ...game, autoCandidates: false })],
    ['the status', () => ({ ...game, status: 'solved' as const })],
    ['the help taken', () => ({ ...game, assists: { ...game.assists, checks: 1 } })],
    ['help of a kind added since', () => ({ ...game, assists: { ...game.assists, later: true } })],
    ['a forgotten hint', () => withHints(10, null)],
    [
      'a hint about another cell',
      () => {
        const cellHints = new Map(game.cellHints);
        cellHints.set(11, cellHints.get(10)!);
        cellHints.delete(10);
        return { ...game, cellHints };
      },
    ],
    ['a Show me opened', () => withHints(10, { walkthrough: true })],
    ['a mistake hint', () => withHints(40, { mistake: null })],
    [
      'a fill hint’s technique',
      () => withHints(21, { fill: { kind: 'deduction', index: 21, technique: 'claiming' } }),
    ],
    [
      'a fill hint’s unit',
      () =>
        withHints(10, {
          fill: {
            kind: 'single',
            index: 10,
            technique: 'hiddenSingleBox',
            unit: { kind: 'row', index: 1 },
          },
        }),
    ],
    [
      'a fill hint where there was none',
      () =>
        withHints(40, {
          fill: { kind: 'single', index: 40, technique: 'nakedSingle', unit: null },
        }),
    ],
  ])('does not vouch for a game that differs in %s', (_, changed) => {
    expect(verifyMoveLog(PUZZLE, log, changed() as GameState)).toBe(false);
  });
});

describe('verifiedMoveCount', () => {
  const { game, log } = playActions([place(2, 4), place(40, 9), pencil(3, 2), pencil(3, 6)]);

  it('counts every move for the game the whole log rebuilds', () => {
    expect(verifiedMoveCount(PUZZLE, log, reload(game))).toBe(4);
  });

  it('counts the moves that rebuild a board saved before the log moved on', () => {
    const saved = replayMoves(PUZZLE, log, 2);
    expect(verifiedMoveCount(PUZZLE, log, reload(saved))).toBe(2);
    expect(verifiedMoveCount(PUZZLE, log, createGame(PUZZLE))).toBe(0);
  });

  it('takes the longest prefix when Undo brought the game back to an earlier point', () => {
    const undone = playActions([place(2, 4), place(40, 9), { type: 'undo' }]);
    // After one move, and again after the Undo: the log that went on to it.
    expect(verifiedMoveCount(PUZZLE, undone.log, reload(undone.game))).toBe(3);
  });

  it('counts none for a game no prefix of the log rebuilds', () => {
    const elsewhere = reduce(game, place(3, 6));
    expect(elsewhere).not.toBe(game);
    expect(verifiedMoveCount(PUZZLE, log, reload(elsewhere))).toBeNull();
  });

  it('does not vouch for a truncated log, nor a game of another puzzle', () => {
    expect(verifiedMoveCount(PUZZLE, { ...log, truncated: true }, game)).toBeNull();
    const other = { ...PUZZLE, givens: `0${PUZZLE.givens.slice(1)}` };
    expect(verifiedMoveCount(other, log, game)).toBeNull();
    const solution = { ...PUZZLE, solution: `9${PUZZLE.solution.slice(1)}` };
    expect(verifiedMoveCount(PUZZLE, log, { ...game, puzzle: solution })).toBeNull();
  });
});

/*
 * The property the whole design rests on: logging only the moves that
 * changed something (and Show me seen again, which replays as the no-op it
 * was), and replaying them through the reducer, rebuilds the
 * live game — after every move, through any number of reloads (the board
 * saved and read back, the log encoded and decoded), with the undo and redo
 * stacks included. A reload empties the live stacks but not the replay's, so
 * after one the live stacks are the top of the replay's (what "Undo survives
 * a reload" will adopt), until a Reset empties both.
 */
describe('replaying a random game', () => {
  const PUZZLES = [PUZZLE, ...EXPERT_PUZZLES];
  const STEPS = 220;

  function expectStacks(replayed: GameState, live: GameState, isExact: boolean, at: string) {
    for (const key of ['undoStack', 'redoStack'] as const) {
      const ours = replayed[key];
      const theirs = live[key];
      if (isExact) expect(ours, `${key} ${at}`).toEqual(theirs);
      else expect(ours.slice(ours.length - theirs.length), `${key} ${at}`).toEqual(theirs);
    }
  }

  it.each(Array.from({ length: 40 }, (_, i) => i + 1))(
    'rebuilds the live game after every step, through reloads (seed %i)',
    (seed) => {
      const rng = createRng(`moves/random/${seed}`);
      const puzzle = PUZZLES[seed % PUZZLES.length];
      const accuracy = 0.5 + rng() * 0.45;
      let played = startPlaying(puzzle, rng() < 0.3);
      let isExact = true;
      for (let step = 0; step < STEPS; step++) {
        const action = randomAction(played.game, rng, accuracy);
        const logged = played.log;
        played = act(played, action, thinking(rng, 0, 12_000));
        if (played.log !== logged && played.log.moves.at(-1)!.op === 'reset') isExact = true;
        if (rng() < 0.05) {
          const decoded = decodeMoveLog(encodeMoveLog(played.log));
          expect(decoded).toEqual(played.log);
          played = { ...played, game: reload(played.game), log: decoded! };
          isExact = false;
        }
        const at = `after step ${step}, ${JSON.stringify(action)}`;
        const replayed = replayMoves(puzzle, played.log);
        expect(boardOf(replayed), at).toEqual(boardOf(played.game));
        expectStacks(replayed, played.game, isExact, at);
        expect(verifyMoveLog(puzzle, played.log, played.game), at).toBe(true);
      }
      expect(decodeMoveLog(encodeMoveLog(played.log))).toEqual(played.log);
    },
  );

  it('rebuilds games played to the end, and logs nothing once they are solved', () => {
    let solved = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const rng = createRng(`moves/solved/${seed}`);
      let played = startPlaying(PUZZLE, seed % 2 === 0);
      for (let step = 0; step < 600 && played.game.status === 'playing'; step++) {
        // Anything but a Reset, which would start the solve again.
        let action = randomAction(played.game, rng, 0.97);
        while (action.type === 'reset') action = randomAction(played.game, rng, 0.97);
        played = act(played, action, thinking(rng));
      }
      if (played.game.status !== 'solved') continue;
      solved++;
      const { log } = played;
      for (let step = 0; step < 30; step++)
        played = act(played, randomAction(played.game, rng), 1000);
      expect(played.log).toBe(log);
      expect(boardOf(replayMoves(PUZZLE, log))).toEqual(boardOf(played.game));
      expect(verifyMoveLog(PUZZLE, log, reload(played.game))).toBe(true);
    }
    expect(solved).toBeGreaterThan(2);
  });
});

describe('the size of a log', () => {
  /*
   * Measured, not just asserted: a solve that only places digits comes to
   * about 4 chars a move, so a share link can carry one. These bounds are
   * loose on purpose; they catch a format that has grown, not a player who
   * thinks slowly.
   */
  it('stays within bounds a link can carry for typical solves', () => {
    const placing = encodeMoveLog(solveByPlacing(PUZZLE, createRng('moves/size')).log);
    const auto = encodeMoveLog(
      solveWithAutoCandidates(EXPERT_PUZZLES[0], createRng('moves/size')).log,
    );
    const notes = encodeMoveLog(solveWithNotes(EXPERT_PUZZLES[1], createRng('moves/size')).log);
    expect(placing.length).toBeLessThan(350);
    expect(auto.length).toBeLessThan(450);
    expect(notes.length).toBeLessThan(1400);
  });
});
