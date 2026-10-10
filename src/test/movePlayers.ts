import {
  MOVE_LOG_FORMAT,
  PEERS,
  appendMove,
  computeCandidates,
  createGame,
  createMoveLog,
  digitsOf,
  findHint,
  formatGrid,
  gridValues,
  moveFor,
  parseGrid,
  reduce,
  seedFromString,
  valuesOf,
  type Digit,
  type Direction,
  type GameAction,
  type GameState,
  type Hint,
  type MoveLog,
  type Puzzle,
  type RandomFn,
  type SingleTechniqueId,
  type TechniqueId,
  type UnitKind,
} from '../core';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from './grids';
import { EXPERT_SAMPLE } from './logic-fixtures';

/*
 * Simulated players for the move log's tests, its golden logs and its size
 * measurements. Each plays through `reduce` and logs through `moveFor` and
 * `appendMove`, as the session will: a random player that tries every action
 * there is, and scripted ones that solve the way people do — placing digits
 * only, with auto candidates, or pencilling every candidate first.
 */

/** The Wikipedia puzzle: unique, and solvable with singles. */
export const EASY_PUZZLE: Puzzle = {
  givens: formatGrid(parseGrid(WIKIPEDIA_PUZZLE)),
  solution: formatGrid(parseGrid(WIKIPEDIA_SOLUTION)),
  difficulty: 'easy',
};

/** Two stored Expert puzzles (see `EXPERT_SAMPLE`). */
export const EXPERT_PUZZLES: readonly Puzzle[] = EXPERT_SAMPLE.slice(0, 2).map((fixture) => ({
  ...fixture,
  difficulty: 'expert',
}));

/** A game in play with its log and its play clock, as a session keeps them. */
export interface Played {
  game: GameState;
  log: MoveLog;
  /** Play-clock time, in ms. */
  clockMs: number;
}

/** A new game of `puzzle` and its empty log. */
export function startPlaying(puzzle: Puzzle, autoCandidates = false): Played {
  return {
    game: createGame(puzzle, { autoCandidates }),
    log: createMoveLog({ autoCandidates }),
    clockMs: 0,
  };
}

/** Make a move `gapMs` after the last, logging it if `moveFor` gives a move for it. */
export function act(played: Played, action: GameAction, gapMs = 0): Played {
  const next = reduce(played.game, action);
  const move = moveFor(played.game, action, next);
  const clockMs = played.clockMs + gapMs;
  return {
    game: next,
    log: move === null ? played.log : appendMove(played.log, move, clockMs),
    clockMs,
  };
}

/** A pause before a move, in ms: mostly short, now and then long, as people think. */
export function thinking(rng: RandomFn, shortestMs = 600, longestMs = 30_000): number {
  return shortestMs + (longestMs - shortestMs) * rng() ** 3;
}

function pick<T>(items: readonly T[], rng: RandomFn): T {
  return items[Math.floor(rng() * items.length)];
}

function randomDigit(rng: RandomFn): Digit {
  return (1 + Math.floor(rng() * 9)) as Digit;
}

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

const select = (index: number): GameAction => ({ type: 'select', index });

function answerAt(puzzle: Puzzle, index: number): Digit {
  return (puzzle.solution.charCodeAt(index) - 48) as Digit;
}

/** The cell a person would fill next: where a hint would point (asked of the board, not the game). */
function nextCell(game: GameState): number {
  const hint = findHint(valuesOf(game), gridValues(game.puzzle.solution));
  // Every scripted player puts its slips right at once, so the hint is a
  // single or a deduction: the board is never full while the game is on.
  return (hint as Exclude<Hint, { kind: 'none' }>).index;
}

/**
 * Solve by placing digits only, in the order singles appear, slipping now
 * and then (a wrong digit, put right by Undo or by typing over it).
 */
export function solveByPlacing(puzzle: Puzzle, rng: RandomFn, slips = 0.06): Played {
  let played = startPlaying(puzzle);
  while (played.game.status === 'playing') {
    const cell = nextCell(played.game);
    const answer = answerAt(puzzle, cell);
    played = act(played, select(cell));
    if (rng() < slips) {
      played = act(played, place(cell, (answer % 9) + 1), thinking(rng));
      played =
        rng() < 0.5
          ? act(played, { type: 'undo' }, thinking(rng, 400, 3000))
          : act(played, place(cell, answer), thinking(rng, 400, 3000));
      if (played.game.cells[cell].value !== answer) {
        played = act(played, place(cell, answer), thinking(rng, 400, 2000));
      }
    } else {
      played = act(played, place(cell, answer), thinking(rng));
    }
  }
  return played;
}

/**
 * Solve in auto candidate mode, striking out a few wrong candidates on the
 * way, as a player working through pairs and pointing does.
 */
export function solveWithAutoCandidates(puzzle: Puzzle, rng: RandomFn): Played {
  let played = startPlaying(puzzle, true);
  while (played.game.status === 'playing') {
    const cell = nextCell(played.game);
    if (rng() < 0.4) {
      const values = valuesOf(played.game);
      const candidates = computeCandidates(values);
      for (const peer of PEERS[cell].filter((i) => values[i] === 0).slice(0, 3)) {
        const wrong = digitsOf(candidates[peer]).filter((d) => d !== answerAt(puzzle, peer));
        if (wrong.length > 0 && rng() < 0.5) {
          played = act(played, pencil(peer, pick(wrong, rng)), thinking(rng, 500, 8000));
        }
      }
    }
    played = act(played, select(cell));
    played = act(played, place(cell, answerAt(puzzle, cell)), thinking(rng));
  }
  return played;
}

/**
 * Solve the heavy way: pencil every candidate into every empty cell first,
 * then strike notes and place digits with "clear peers' notes" on.
 */
export function solveWithNotes(puzzle: Puzzle, rng: RandomFn): Played {
  let played = startPlaying(puzzle);
  const candidates = computeCandidates(valuesOf(played.game));
  for (let cell = 0; cell < 81; cell++) {
    for (const digit of digitsOf(candidates[cell])) {
      played = act(played, pencil(cell, digit), thinking(rng, 300, 2500));
    }
  }
  while (played.game.status === 'playing') {
    const cell = nextCell(played.game);
    for (const peer of PEERS[cell]) {
      const { notes, value } = played.game.cells[peer];
      const wrong = digitsOf(notes).filter((d) => d !== answerAt(puzzle, peer));
      if (value === 0 && wrong.length > 0 && rng() < 0.15) {
        played = act(played, pencil(peer, pick(wrong, rng)), thinking(rng, 500, 6000));
      }
    }
    played = act(played, select(cell));
    played = act(played, place(cell, answerAt(puzzle, cell), true), thinking(rng));
  }
  return played;
}

/**
 * A game that takes every kind of help and uses every control: hints and
 * Show me, Check and Reveal, auto candidates on and off, notes and both
 * erases, Undo and Redo, a Reset — then solves, revealing the last cell.
 */
export function playWithHelp(puzzle: Puzzle, rng: RandomFn): Played {
  const solution = gridValues(puzzle.solution);
  const blanks = [...puzzle.givens].flatMap((ch, i) => (ch === '0' ? [i] : []));
  const [a, b, c, d] = blanks;
  const t = () => thinking(rng);
  let played = startPlaying(puzzle);
  /** A candidate on show at `cell` that is not its answer. */
  const wrongCandidate = (game: GameState, cell: number) =>
    digitsOf(computeCandidates(valuesOf(game))[cell]).find((x) => x !== answerAt(puzzle, cell))!;
  const steps: ((game: GameState) => GameAction)[] = [
    () => place(a, answerAt(puzzle, a)),
    () => place(b, (answerAt(puzzle, b) % 9) + 1),
    () => select(b),
    () => ({ type: 'check', scope: 'cell' }),
    () => ({ type: 'erase', index: b }),
    () => pencil(c, 1),
    () => pencil(c, 2),
    () => ({ type: 'erase', index: c }),
    () => ({ type: 'undo' }),
    () => ({ type: 'redo' }),
    () => ({ type: 'setAutoCandidates', enabled: true }),
    (game) => pencil(d, wrongCandidate(game, d)),
    () => ({ type: 'setAutoCandidates', enabled: false }),
    () => select(d),
    () => ({ type: 'reveal' }),
    () => ({ type: 'check', scope: 'puzzle' }),
    () => ({ type: 'reset' }),
    // No hint `findHint` gives is about no cell, but the reducer counts one,
    // so the log holds it.
    () => ({ type: 'hint', hint: { kind: 'deduction', index: -1, technique: null } }),
  ];
  for (const step of steps) played = act(played, step(played.game), t());
  // A hint about the board as it stands, its walkthrough, and the placement.
  const hint = findHint(valuesOf(played.game), solution);
  played = act(played, { type: 'hint', hint }, t());
  if (hint.kind === 'single' || hint.kind === 'deduction') {
    played = act(played, { type: 'walkthrough', index: hint.index }, t());
  }
  while (played.game.status === 'playing') {
    const cell = nextCell(played.game);
    if (rng() < 0.1)
      played = act(played, { type: 'hint', hint: findHint(valuesOf(played.game), solution) }, t());
    // The last cell revealed, which completes the grid.
    const isLast = played.game.cells.filter(({ value }) => value === 0).length === 1;
    played = isLast
      ? act(act(played, select(cell)), { type: 'reveal' }, t())
      : act(played, place(cell, answerAt(puzzle, cell)), t());
  }
  return played;
}

/**
 * A scripted walk through the reducer's rules, for the golden logs: every
 * situation in which `reduce` treats a move its own way, one after another
 * (the golden guard's checklist, `GOLDEN_SITUATIONS`, says which), then a
 * solve completed by a Redo after a Reveal. Written for the Wikipedia
 * puzzle's landmarks, which the comments name; the checklist's test holds the
 * tour to reaching what it says it does.
 */
export function tourTheRules(rng: RandomFn): Played {
  const puzzle = EASY_PUZZLE;
  const t = () => thinking(rng, 400, 6000);
  let played = startPlaying(puzzle);
  const run = (...actions: GameAction[]) => {
    for (const action of actions) played = act(played, action, t());
  };
  const undo: GameAction = { type: 'undo' };
  const redo: GameAction = { type: 'redo' };
  const checkCell: GameAction = { type: 'check', scope: 'cell' };
  const single = (index: number): GameAction => ({
    type: 'hint',
    hint: { kind: 'single', index, technique: 'nakedSingle', unit: { kind: 'box', index: 4 } },
  });
  const mistake = (index: number): GameAction => ({
    type: 'hint',
    hint: { kind: 'mistake', index },
  });

  // Notes, and typing over a Check, at cell 3 (answer 6).
  run(pencil(3, 2), pencil(3, 6), pencil(3, 2)); // a note in, a note out: notes 6
  run(place(3, 2)); // a wrong digit over the notes, which stay underneath
  run(select(3), checkCell, checkCell); // marked wrong, and checked again
  run(place(3, 7), select(3), checkCell); // typed over with another wrong digit, checked again
  run(place(3, 6)); // typed over with the answer
  run(pencil(3, 1), place(3, 6)); // a note entered in the filled cell clears it
  run({ type: 'erase', index: 3 }); // the value goes, the notes 1 6 come back
  run({ type: 'erase', index: 3 }, undo, redo); // the second Erase takes the notes

  // Hints at cell 40 (answer 5): remembered, seen again, and forgotten.
  run(single(40), { type: 'walkthrough', index: 40 }); // a fill hint and its Show me
  run({ type: 'walkthrough', index: 40 }); // Show me again, for free
  run(place(40, 9)); // both kept while a wrong value stands
  run(mistake(40), mistake(40)); // the mistake marked, then seen again for free
  run(place(40, 8)); // the mistake hint goes with its value; the fill hint and Show me stay
  run({ type: 'erase', index: 40 }, single(40)); // the fill hint again, for free
  run(place(40, 5)); // the answer: every hint forgotten
  run(single(40), mistake(2)); // hints about a solved cell and an empty one: counted, not kept
  run({ type: 'hint', hint: { kind: 'deduction', index: -1, technique: null } });

  // Clearing peers' notes around locked and checked cells, in row 0.
  run(pencil(7, 4), place(7, 1), select(7), checkCell); // cell 7 right, locked, hidden note 4
  run(pencil(8, 4), place(8, 3)); // cell 8 wrong (answer 2), hidden note 4
  run(pencil(6, 4)); // cell 6 empty with a note 4
  run(place(2, 4, true)); // clears 4 from cells 6 and 8, not from locked cell 7
  run({ type: 'check', scope: 'puzzle' }); // cell 8 marked wrong; cells 2 and 40 locked
  run(select(6), { type: 'reveal' }); // cell 6 locked
  run(undo, redo); // skips cells 2 and 6, and keeps cell 8's mark while its note comes back

  // Auto candidates at cell 5 (answer 8).
  run(select(5), { type: 'setAutoCandidates', enabled: true });
  const struck = digitsOf(computeCandidates(valuesOf(played.game))[5]).find(
    (digit) => digit !== answerAt(puzzle, 5),
  )!;
  run(pencil(5, struck), pencil(5, struck)); // struck out, and brought back
  run(pencil(8, 5), undo); // 5 is no candidate of cell 8 (row 0 has it), but its value goes
  run({ type: 'setAutoCandidates', enabled: false }, undo, redo);

  // Resets: of a board in play, of an untouched board with history, and of hints alone.
  run({ type: 'reset' });
  run(place(2, 4), undo, { type: 'reset' });
  run(single(2), { type: 'reset' });

  // A solve completed by a Redo after a Reveal.
  const blanks = [...puzzle.givens].flatMap((ch, i) => (ch === '0' ? [i] : []));
  const [last, revealed, ...rest] = blanks.reverse();
  for (const cell of rest) run(place(cell, answerAt(puzzle, cell)));
  run(place(last, answerAt(puzzle, last)), undo, select(revealed), { type: 'reveal' }, redo);
  return played;
}

// ---------------------------------------------------------------------------
// The random player
// ---------------------------------------------------------------------------

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

const SINGLES: readonly SingleTechniqueId[] = [
  'fullHouse',
  'hiddenSingleBox',
  'hiddenSingleLine',
  'nakedSingle',
];

const DEDUCTIONS: readonly TechniqueId[] = [
  ...SINGLES,
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

/** Any hint the reducer could be handed, the one `findHint` would give now and then. */
function randomHint(game: GameState, rng: RandomFn): Hint {
  const roll = rng();
  // Off the grid now and then: counted, but about no cell.
  const index = rng() < 0.03 ? pick([-1, 81], rng) : Math.floor(rng() * 81);
  if (roll < 0.1) return findHint(valuesOf(game), gridValues(game.puzzle.solution));
  if (roll < 0.15) return { kind: 'none' };
  if (roll < 0.35) return { kind: 'mistake', index };
  if (roll < 0.65) {
    const technique = rng() < 0.1 ? null : pick(DEDUCTIONS, rng);
    return { kind: 'deduction', index, technique };
  }
  const unit = rng() < 0.3 ? null : { kind: pick(UNIT_KINDS, rng), index: Math.floor(rng() * 9) };
  return { kind: 'single', index, technique: pick(SINGLES, rng), unit };
}

/**
 * Any action at all, weighted towards what changes the board, and towards
 * the right digit with probability `accuracy` — so some games get solved.
 * Indexes and modes are left to the state now and then, as the UI leaves them.
 */
export function randomAction(game: GameState, rng: RandomFn, accuracy = 0.6): GameAction {
  const empty = game.cells.flatMap((cell, i) => (cell.value === 0 ? [i] : []));
  const cell = rng() < 0.8 && empty.length > 0 ? pick(empty, rng) : Math.floor(rng() * 81);
  const index = rng() < 0.75 ? cell : undefined;
  const digit = rng() < accuracy ? answerAt(game.puzzle, index ?? game.selected) : randomDigit(rng);
  const roll = rng() * 100;
  if (roll < 30) {
    const mode = rng() < 0.8 ? ('normal' as const) : undefined;
    const clearPeerNotes = rng() < 0.3 ? rng() < 0.5 : undefined;
    return { type: 'enter', digit, index, mode, clearPeerNotes };
  }
  if (roll < 45)
    return {
      type: 'enter',
      digit: randomDigit(rng),
      index,
      mode: rng() < 0.8 ? 'candidate' : undefined,
    };
  if (roll < 50) return { type: 'erase', index };
  if (roll < 56) return { type: 'select', index: cell };
  if (roll < 58) return { type: 'move', direction: pick(DIRECTIONS, rng) };
  if (roll < 60) return { type: 'setMode', mode: rng() < 0.5 ? 'normal' : 'candidate' };
  if (roll < 61) return { type: 'toggleMode' };
  if (roll < 65) return { type: 'setAutoCandidates', enabled: rng() < 0.5 };
  if (roll < 74) return { type: 'undo' };
  if (roll < 80) return { type: 'redo' };
  if (roll < 87) return { type: 'hint', hint: randomHint(game, rng) };
  if (roll < 91) {
    const hinted = [...game.cellHints.keys()];
    return {
      type: 'walkthrough',
      index: hinted.length > 0 && rng() < 0.8 ? pick(hinted, rng) : cell,
    };
  }
  if (roll < 95) return { type: 'check', scope: rng() < 0.7 ? 'cell' : 'puzzle' };
  if (roll < 98) return { type: 'reveal' };
  if (roll < 99.3) return { type: 'reset' };
  return { type: 'hint', hint: { kind: 'none' } };
}

const LOG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * An encoded log as another build would write it, which this one refuses:
 * `rules` (the rules version) and `code` (one move's code, at no time at all)
 * written out by hand in this build's format, with an intact check — a log
 * from an older or a newer rules version, or one holding a move code added
 * since. Written from the format's description (see `src/core/moves.ts`), not
 * by the module, which would refuse to.
 */
export function logFromAnotherBuild(rules: number, code: number): string {
  const body =
    LOG_ALPHABET[MOVE_LOG_FORMAT] +
    LOG_ALPHABET[rules] +
    'A' +
    LOG_ALPHABET[code >> 6] +
    LOG_ALPHABET[code & 63] +
    'A';
  const hash = seedFromString(body);
  return (
    body +
    LOG_ALPHABET[(hash >> 12) & 63] +
    LOG_ALPHABET[(hash >> 6) & 63] +
    LOG_ALPHABET[hash & 63]
  );
}

/** A log in a later format than this build's, which it cannot read at all. */
export const LOG_IN_A_LATER_FORMAT = `${LOG_ALPHABET[MOVE_LOG_FORMAT + 1]}AAAAAAAA`;
