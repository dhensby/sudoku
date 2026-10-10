import {
  MOVES_VERSION,
  createRng,
  decodeMoveLog,
  digitsOf,
  encodeMoveLog,
  formatGrid,
  replayMoveSteps,
  replayMoves,
  seedFromString,
  valuesOf,
  type CellState,
  type Difficulty,
  type GameState,
  type MoveLog,
  type Puzzle,
  type ReplayStep,
  type UndoEntry,
} from '../core';
import {
  EASY_PUZZLE,
  EXPERT_PUZZLES,
  act,
  checkGuessesTour,
  playWithHelp,
  randomAction,
  solveByPlacing,
  solveWithAutoCandidates,
  solveWithNotes,
  startPlaying,
  thinking,
  tourTheRules,
  type Played,
} from './movePlayers';

/*
 * The golden move logs, `src/core/fixtures/moveLogs.json`: real games, each
 * with the game its replay must end in and a hash of every step on the way.
 * They hold the reducer to the rules a log was recorded by. Replaying an old
 * log under changed rules would rebuild a different game — wrong mistake
 * counts, a playback that goes astray — so a change to `reduce` that moves any
 * of these fails the build until `MOVES_VERSION` is bumped and the logs are
 * regenerated (`npm run moves:golden`, which refuses to rewrite drifted logs
 * under an unchanged version).
 *
 * A guard only reaches the rules its logs exercise, so `GOLDEN_SITUATIONS`
 * names every situation in which `reduce` treats a move its own way, and a
 * test fails unless the golden logs pass through each one. A new rule in the
 * reducer needs a situation here and a step in `tourTheRules` that reaches it.
 */

/** The fixture file as stored. */
export interface GoldenFile {
  $comment: string;
  /** The `MOVES_VERSION` the logs were recorded under. */
  rules: number;
  games: GoldenGame[];
}

export interface GoldenGame {
  name: string;
  givens: string;
  solution: string;
  difficulty: Difficulty;
  /** The encoded log. */
  log: string;
  /** The game the log replays to (see `pinnedState`). */
  end: PinnedState;
  /** A hash of every step's `pinnedState`, in order, as 8 hex digits. */
  trace: string;
}

/** A game in a few readable, diffable strings. */
export interface PinnedState {
  values: string;
  marks: string;
  /** Each cell with notes, as `cell:digits`, space-separated. */
  notes: string;
  /** Each cell with eliminations, as `cell:digits`. */
  autoRemoved: string;
  autoCandidates: boolean;
  /**
   * Whether Check guesses is on: left out when it is off, so the logs pinned
   * before it existed — none of which can switch it on — pin as they did.
   */
  checkGuesses?: true;
  status: string;
  assists: string;
  /** Each cell's remembered hints, as `cell:fill:mistake value:walkthrough`. */
  cellHints: string;
  undo: number;
  redo: number;
}

const COMMENT =
  'Golden move logs: each replays to its "end" through every step hashed in "trace". A change to the reducer that moves one needs MOVES_VERSION bumped (src/core/moves.ts). Do not edit by hand: npm run moves:golden writes this file (README, "The move log").';

const MARK_CODES = { none: '.', wrong: 'w', correct: 'c', revealed: 'r' } as const;

function masks(state: GameState, field: 'notes' | 'autoRemoved'): string {
  return state.cells
    .flatMap((cell, i) => (cell[field] === 0 ? [] : [`${i}:${digitsOf(cell[field]).join('')}`]))
    .join(' ');
}

/** The game as a guard compares it: the board, the help, the hints and the depth of both stacks. */
export function pinnedState(state: GameState): PinnedState {
  const { autoCandidates, hints, checks, reveals, checkGuesses } = state.assists;
  // Said only once it was ever on, for the same reason as `checkGuesses`.
  const checked = checkGuesses === true ? ' checkGuesses:true' : '';
  return {
    values: formatGrid(valuesOf(state)),
    marks: state.cells.map((cell) => MARK_CODES[cell.mark]).join(''),
    notes: masks(state, 'notes'),
    autoRemoved: masks(state, 'autoRemoved'),
    autoCandidates: state.autoCandidates,
    ...(state.checkGuesses ? { checkGuesses: true as const } : {}),
    status: state.status,
    assists: `auto:${autoCandidates} hints:${hints} checks:${checks} reveals:${reveals}${checked}`,
    cellHints: [...state.cellHints]
      .sort(([a], [b]) => a - b)
      .map(([index, { fill, mistake, walkthrough }]) => {
        const unit =
          fill?.kind === 'single' && fill.unit ? `${fill.unit.kind}${fill.unit.index}` : '';
        const filled = fill === null ? '-' : `${fill.kind}/${fill.technique}/${unit}`;
        return `${index}:${filled}:${mistake?.value ?? 0}:${walkthrough}`;
      })
      .join(' '),
    undo: state.undoStack.length,
    redo: state.redoStack.length,
  };
}

/** An Undo or Redo entry in full: each cell it puts back, its focus, and the auto switch it undoes. */
function entryKey(entry: UndoEntry | undefined): string {
  if (entry === undefined) return '';
  const cells = entry.cells.map(
    ([index, cell]) => `${index}=${cell.value}/${cell.notes}/${cell.autoRemoved}/${cell.mark}`,
  );
  return `${cells.join(',')}@${entry.focus}${entry.autoCandidates === undefined ? '' : `:${entry.autoCandidates}`}`;
}

/**
 * A hash of every step of the replay: the game as pinned, and the top entry
 * of each stack — every entry is on top when it is pushed, so step by step
 * that pins what the stacks hold, which a reload's Undo will one day rely on.
 */
export function traceOf(puzzle: Puzzle, log: MoveLog): string {
  let hash = seedFromString('');
  for (const { after } of replayMoveSteps(puzzle, log)) {
    const stacks = `${entryKey(after.undoStack.at(-1))}|${entryKey(after.redoStack.at(-1))}`;
    hash = seedFromString(`${hash}${JSON.stringify(pinnedState(after))}${stacks}`);
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// The checklist
// ---------------------------------------------------------------------------

function isLocked(cell: CellState): boolean {
  return cell.mark === 'correct' || cell.mark === 'revealed';
}

function answerOf(state: GameState, index: number): number {
  return state.puzzle.solution.charCodeAt(index) - 48;
}

/** The cell a move acted on, if it names one. */
function cellOf({ move }: ReplayStep): number | null {
  if ('cell' in move) return move.cell;
  return move.op === 'hint' && move.hint.index >= 0 ? move.hint.index : null;
}

/** The cell a step's move acted on, before and after; null for a move that names none. */
function cellPair(step: ReplayStep): [before: CellState, after: CellState, index: number] | null {
  const index = cellOf(step);
  return index === null ? null : [step.before.cells[index], step.after.cells[index], index];
}

/** The entry an Undo or Redo puts back. */
function entryOf({ move, before }: ReplayStep): UndoEntry | undefined {
  if (move.op === 'undo') return before.undoStack.at(-1);
  return move.op === 'redo' ? before.redoStack.at(-1) : undefined;
}

const hintsTaken = ({ before, after }: ReplayStep) => after.assists.hints - before.assists.hints;
const checksTaken = ({ before, after }: ReplayStep) => after.assists.checks - before.assists.checks;

/** A move that placed or pencilled `digit` at a cell, with that cell before and after. */
function entered(step: ReplayStep, op: 'place' | 'candidate') {
  const cells = cellPair(step);
  if (step.move.op !== op || cells === null) return null;
  const [before, after, index] = cells;
  return { before, after, index, mask: 1 << (step.move.digit - 1), digit: step.move.digit };
}

/** A hint step about a cell, with its remembered hints before and after. */
function hinted(step: ReplayStep, kind: 'fill' | 'mistake') {
  if (step.move.op !== 'hint' || step.move.hint.index < 0) return null;
  if ((step.move.hint.kind === 'mistake') !== (kind === 'mistake')) return null;
  const { index } = step.move.hint;
  return {
    cell: step.before.cells[index],
    after: step.after.cells[index],
    index,
    was: step.before.cellHints.get(index),
    is: step.after.cellHints.get(index),
  };
}

/** A Reset: whether the board changed, and what the game held before. */
function resetOf({ move, before, after }: ReplayStep) {
  return move.op === 'reset' ? { isBoardSame: after.cells === before.cells, before } : null;
}

/**
 * Every situation in which `reduce` treats a move its own way. The golden
 * logs must pass through each one between them, so that changing what the
 * reducer does in any of them changes a golden replay — and fails the build
 * until `MOVES_VERSION` is bumped.
 */
export const GOLDEN_SITUATIONS: readonly {
  name: string;
  occurs: (step: ReplayStep) => boolean;
}[] = [
  // Notes and placing
  {
    name: 'a note pencilled in',
    occurs: (step) => {
      const e = entered(step, 'candidate');
      return !!e && !step.before.autoCandidates && (e.after.notes & ~e.before.notes) !== 0;
    },
  },
  {
    name: 'a note taken out',
    occurs: (step) => {
      const e = entered(step, 'candidate');
      return !!e && !step.before.autoCandidates && (e.before.notes & ~e.after.notes) !== 0;
    },
  },
  {
    name: 'a digit placed over notes, which stay underneath',
    occurs: (step) => {
      const e = entered(step, 'place');
      return !!e && e.before.notes !== 0 && e.after.notes === e.before.notes;
    },
  },
  {
    name: 'a digit typed over a cell checked wrong, with its answer',
    occurs: (step) => {
      const e = entered(step, 'place');
      return !!e && e.before.mark === 'wrong' && e.digit === answerOf(step.before, e.index);
    },
  },
  {
    name: 'a digit typed over a cell checked wrong, with another wrong digit',
    occurs: (step) => {
      const e = entered(step, 'place');
      return !!e && e.before.mark === 'wrong' && e.digit !== answerOf(step.before, e.index);
    },
  },
  {
    name: 'a note entered in a filled cell, which clears it',
    occurs: (step) => {
      const e = entered(step, 'candidate');
      return !!e && !step.before.autoCandidates && e.before.value !== 0;
    },
  },
  {
    name: 'a placement clearing a peer’s notes',
    occurs: (step) => {
      const e = entered(step, 'place');
      if (!e || step.move.op !== 'place' || !step.move.clearPeerNotes) return false;
      return step.after.cells.some(
        (cell, i) => i !== e.index && cell.notes !== step.before.cells[i].notes,
      );
    },
  },
  {
    name: 'a placement clearing peers’ notes that leaves a locked peer’s hidden notes',
    occurs: (step) => {
      const e = entered(step, 'place');
      if (!e || step.move.op !== 'place' || !step.move.clearPeerNotes) return false;
      return step.before.cells.some(
        (cell, i) => i !== e.index && isLocked(cell) && (cell.notes & e.mask) !== 0,
      );
    },
  },
  {
    name: 'a placement that completes the grid',
    occurs: ({ move, after }) => move.op === 'place' && after.status === 'solved',
  },
  // Auto candidates
  {
    name: 'a candidate struck out in auto candidate mode',
    occurs: (step) => {
      const e = entered(step, 'candidate');
      return (
        !!e && step.before.autoCandidates && (e.after.autoRemoved & ~e.before.autoRemoved) !== 0
      );
    },
  },
  {
    name: 'a struck candidate brought back in auto candidate mode',
    occurs: (step) => {
      const e = entered(step, 'candidate');
      return (
        !!e && step.before.autoCandidates && (e.before.autoRemoved & ~e.after.autoRemoved) !== 0
      );
    },
  },
  {
    name: 'a digit that is no candidate entered in a filled cell in auto candidate mode',
    occurs: (step) => {
      const e = entered(step, 'candidate');
      return (
        !!e &&
        step.before.autoCandidates &&
        e.before.value !== 0 &&
        e.after.autoRemoved === e.before.autoRemoved
      );
    },
  },
  { name: 'auto candidates switched on', occurs: ({ move }) => move.op === 'autoOn' },
  { name: 'auto candidates switched off', occurs: ({ move }) => move.op === 'autoOff' },
  // Erasing
  {
    name: 'a value erased, its notes coming back',
    occurs: (step) => {
      const cells = cellPair(step);
      return step.move.op === 'erase' && !!cells && cells[0].value !== 0 && cells[0].notes !== 0;
    },
  },
  {
    name: 'the notes taken by a second Erase',
    occurs: (step) => {
      const cells = cellPair(step);
      return step.move.op === 'erase' && !!cells && cells[0].value === 0 && cells[0].notes !== 0;
    },
  },
  // Check and Reveal
  {
    name: 'a Check that marks a value wrong',
    occurs: ({ move, before, after }) =>
      (move.op === 'checkCell' || move.op === 'checkPuzzle') &&
      after.cells.some((cell, i) => cell.mark === 'wrong' && before.cells[i].mark !== 'wrong'),
  },
  {
    name: 'a Check that marks a value right, locking it',
    occurs: ({ move, before, after }) =>
      (move.op === 'checkCell' || move.op === 'checkPuzzle') &&
      after.cells.some((cell, i) => cell.mark === 'correct' && before.cells[i].mark !== 'correct'),
  },
  {
    name: 'a Check of a cell already marked wrong, which still counts',
    occurs: (step) => {
      const cells = cellPair(step);
      return step.move.op === 'checkCell' && cells?.[0].mark === 'wrong' && checksTaken(step) === 1;
    },
  },
  {
    name: 'a Check that drops Undo entries spent on cells it locked',
    occurs: ({ move, before, after }) =>
      (move.op === 'checkCell' || move.op === 'checkPuzzle') &&
      after.undoStack.length < before.undoStack.length,
  },
  {
    name: 'a Reveal of a cell holding a wrong value',
    occurs: (step) => {
      const cells = cellPair(step);
      return (
        step.move.op === 'reveal' &&
        !!cells &&
        cells[0].value !== 0 &&
        cells[0].value !== answerOf(step.before, cells[2]) &&
        cells[1].mark === 'revealed'
      );
    },
  },
  {
    name: 'a Reveal that completes the grid',
    occurs: ({ move, after }) => move.op === 'reveal' && after.status === 'solved',
  },
  {
    name: 'a Reveal of an empty cell',
    occurs: (step) => {
      const cells = cellPair(step);
      return (
        step.move.op === 'reveal' && !!cells && cells[0].value === 0 && cells[1].mark === 'revealed'
      );
    },
  },
  // Undo and Redo
  {
    name: 'an Undo or Redo that skips a cell locked since',
    occurs: (step) =>
      entryOf(step)?.cells.some(([index]) => isLocked(step.before.cells[index])) ?? false,
  },
  {
    name: 'an Undo or Redo that keeps the mark a Check gave a value it leaves alone',
    occurs: (step) =>
      entryOf(step)?.cells.some(([index, previous]) => {
        const current = step.before.cells[index];
        return (
          !isLocked(current) &&
          previous.value === current.value &&
          previous.mark !== current.mark &&
          current.mark !== 'none'
        );
      }) ?? false,
  },
  {
    name: 'an Undo of the auto candidate switch',
    occurs: (step) => step.move.op === 'undo' && entryOf(step)?.autoCandidates !== undefined,
  },
  {
    name: 'a Redo of the auto candidate switch',
    occurs: (step) => step.move.op === 'redo' && entryOf(step)?.autoCandidates !== undefined,
  },
  {
    name: 'an Undo or Redo that completes the grid',
    occurs: ({ move, after }) =>
      (move.op === 'undo' || move.op === 'redo') && after.status === 'solved',
  },
  // Hints and Show me
  {
    name: 'a fill hint, counted and remembered',
    occurs: (step) => {
      const h = hinted(step, 'fill');
      return !!h && hintsTaken(step) === 1 && h.is?.fill != null;
    },
  },
  {
    name: 'a fill hint seen again, for free',
    occurs: (step) => !!hinted(step, 'fill') && hintsTaken(step) === 0,
  },
  {
    name: 'a fill hint about a cell holding its answer: counted, not remembered',
    occurs: (step) => {
      const h = hinted(step, 'fill');
      return (
        !!h &&
        h.cell.value === answerOf(step.before, h.index) &&
        hintsTaken(step) === 1 &&
        !h.is?.fill
      );
    },
  },
  {
    name: 'a mistake hint about a wrong value, which marks it',
    occurs: (step) => {
      const h = hinted(step, 'mistake');
      return !!h && h.cell.mark === 'none' && h.after.mark === 'wrong' && hintsTaken(step) === 1;
    },
  },
  {
    name: 'a mistake hint seen again, for free',
    occurs: (step) => !!hinted(step, 'mistake') && hintsTaken(step) === 0,
  },
  {
    name: 'a mistake hint about a cell with no mistake: counted, not remembered',
    occurs: (step) => {
      const h = hinted(step, 'mistake');
      return !!h && !h.is?.mistake && hintsTaken(step) === 1 && h.after.mark === h.cell.mark;
    },
  },
  {
    name: 'a hint off the grid, counted',
    occurs: (step) => step.move.op === 'hint' && step.move.hint.index < 0 && hintsTaken(step) === 1,
  },
  {
    name: 'a fill hint and its Show me kept while a wrong value goes in',
    occurs: (step) => {
      const e = entered(step, 'place');
      return (
        !!e &&
        e.digit !== answerOf(step.before, e.index) &&
        step.before.cellHints.get(e.index)?.walkthrough === true &&
        step.after.cellHints.get(e.index)?.walkthrough === true &&
        step.after.cellHints.get(e.index)?.fill != null
      );
    },
  },
  {
    name: 'a mistake hint forgotten as its value changes, the fill hint and its Show me kept',
    occurs: (step) => {
      const index = cellOf(step);
      if (index === null) return false;
      const was = step.before.cellHints.get(index);
      const is = step.after.cellHints.get(index);
      return !!was?.mistake && !!was.fill && !!is?.fill && is.walkthrough && !is.mistake;
    },
  },
  {
    name: 'every hint about a cell forgotten as its answer goes in',
    occurs: (step) => {
      const e = entered(step, 'place');
      return (
        !!e &&
        e.digit === answerOf(step.before, e.index) &&
        step.before.cellHints.get(e.index)?.walkthrough === true &&
        !step.after.cellHints.has(e.index)
      );
    },
  },
  {
    name: 'Show me, counted',
    occurs: (step) => step.move.op === 'walkthrough' && hintsTaken(step) === 1,
  },
  {
    name: 'Show me opened again, for free',
    occurs: ({ move, before, after }) => move.op === 'walkthrough' && after === before,
  },
  // Check guesses when entered
  {
    name: 'Check guesses switched on, judging nothing already entered',
    occurs: ({ move, before, after }) =>
      move.op === 'checkGuessesOn' &&
      after.checkGuesses &&
      after.cells === before.cells &&
      before.cells.some((cell, i) => cell.value !== 0 && cell.value !== answerOf(before, i)),
  },
  {
    name: 'Check guesses switched off',
    occurs: ({ move, before, after }) =>
      move.op === 'checkGuessesOff' && before.checkGuesses && !after.checkGuesses,
  },
  {
    name: 'a wrong digit placed while Check guesses is on, marked wrong',
    occurs: (step) => {
      const e = entered(step, 'place');
      return (
        !!e && step.before.checkGuesses && e.after.mark === 'wrong' && e.before.mark !== 'wrong'
      );
    },
  },
  {
    name: 'the answer placed while Check guesses is on, unmarked',
    occurs: (step) => {
      const e = entered(step, 'place');
      return (
        !!e &&
        step.before.checkGuesses &&
        e.digit === answerOf(step.before, e.index) &&
        e.after.mark === 'none'
      );
    },
  },
  {
    name: 'an Undo or Redo bringing back a wrong digit entered before Check guesses came on, unmarked',
    occurs: (step) =>
      step.before.checkGuesses &&
      (entryOf(step)?.cells.some(([index, previous]) => {
        const after = step.after.cells[index];
        return (
          previous.mark === 'none' &&
          after.value === previous.value &&
          after.value !== step.before.cells[index].value &&
          after.value !== 0 &&
          after.value !== answerOf(step.after, index) &&
          after.mark === 'none'
        );
      }) ??
        false),
  },
  {
    name: 'an Undo or Redo bringing back a digit marked by Check guesses while it is on, marked',
    occurs: (step) =>
      step.before.checkGuesses &&
      (entryOf(step)?.cells.some(([index, previous]) => {
        const after = step.after.cells[index];
        return (
          previous.mark === 'wrong' &&
          after.mark === 'wrong' &&
          after.value === previous.value &&
          after.value !== step.before.cells[index].value
        );
      }) ??
        false),
  },
  {
    name: 'a value marked by Check guesses cleared by a candidate entry',
    occurs: (step) => {
      const e = entered(step, 'candidate');
      return !!e && e.before.mark === 'wrong' && e.after.value === 0 && step.before.checkGuesses;
    },
  },
  {
    name: 'a wrong digit placed once Check guesses is off again, unmarked',
    occurs: (step) => {
      const e = entered(step, 'place');
      return (
        !!e &&
        !step.before.checkGuesses &&
        step.before.assists.checkGuesses === true &&
        e.digit !== answerOf(step.before, e.index) &&
        e.after.mark === 'none'
      );
    },
  },
  {
    name: 'an Undo or Redo bringing back a digit marked by Check guesses once it is off',
    occurs: (step) =>
      !step.before.checkGuesses &&
      (entryOf(step)?.cells.some(([index, previous]) => {
        const after = step.after.cells[index];
        return (
          previous.mark === 'wrong' && after.mark === 'wrong' && after.value === previous.value
        );
      }) ??
        false),
  },
  // Reset
  {
    name: 'a Reset of a board in play',
    occurs: (step) => resetOf(step)?.isBoardSame === false,
  },
  {
    name: 'a Reset of an untouched board that still has Undo history',
    occurs: (step) => {
      const r = resetOf(step);
      return !!r && r.isBoardSame && r.before.undoStack.length + r.before.redoStack.length > 0;
    },
  },
  {
    name: 'a Reset of an untouched board with only hints remembered',
    occurs: (step) => {
      const r = resetOf(step);
      return (
        !!r &&
        r.isBoardSame &&
        r.before.undoStack.length + r.before.redoStack.length === 0 &&
        r.before.cellHints.size > 0
      );
    },
  },
];

/** The checklist's situations that none of `logs` passes through. */
export function situationsMissed(logs: readonly { puzzle: Puzzle; log: MoveLog }[]): string[] {
  const missed = new Set(GOLDEN_SITUATIONS);
  for (const { puzzle, log } of logs) {
    for (const step of replayMoveSteps(puzzle, log)) {
      for (const situation of missed) if (situation.occurs(step)) missed.delete(situation);
    }
  }
  return [...missed].map(({ name }) => name);
}

/** Random play for the length of a game, every kind of action included. */
function playAtRandom(puzzle: Puzzle, seed: string): Played {
  const rng = createRng(seed);
  let played = startPlaying(puzzle);
  for (let i = 0; i < 400; i++) {
    played = act(played, randomAction(played.game, rng, 0.75), thinking(rng, 200, 9000));
  }
  return played;
}

/** The golden games: how each is played, from a fixed seed. */
const GOLDEN_GAMES: readonly { name: string; puzzle: Puzzle; play: () => Played }[] = [
  {
    name: 'Easy, placing digits only, with slips',
    puzzle: EASY_PUZZLE,
    play: () => solveByPlacing(EASY_PUZZLE, createRng('golden/placing'), 0.15),
  },
  {
    name: 'Expert, in auto candidate mode',
    puzzle: EXPERT_PUZZLES[0],
    play: () => solveWithAutoCandidates(EXPERT_PUZZLES[0], createRng('golden/auto')),
  },
  {
    name: 'Expert, every candidate pencilled in',
    puzzle: EXPERT_PUZZLES[1],
    play: () => solveWithNotes(EXPERT_PUZZLES[1], createRng('golden/notes')),
  },
  {
    name: 'Easy, with every kind of help and a reset',
    puzzle: EASY_PUZZLE,
    play: () => playWithHelp(EASY_PUZZLE, createRng('golden/help')),
  },
  {
    name: 'Easy, a tour of the rules, solved by a Redo after a Reveal',
    puzzle: EASY_PUZZLE,
    play: () => tourTheRules(createRng('golden/tour')),
  },
  {
    name: 'Expert, random play',
    puzzle: EXPERT_PUZZLES[0],
    play: () => playAtRandom(EXPERT_PUZZLES[0], 'golden/random'),
  },
  {
    name: 'Easy, with Check guesses when entered switched on and off',
    puzzle: EASY_PUZZLE,
    play: () => checkGuessesTour(createRng('golden/check-guesses')),
  },
];

/** The golden logs, played afresh by the current engine. */
export function playGoldenLogs(): GoldenFile {
  return {
    $comment: COMMENT,
    rules: MOVES_VERSION,
    games: GOLDEN_GAMES.map(({ name, puzzle, play }) => {
      const { game, log } = play();
      return {
        name,
        ...puzzle,
        log: encodeMoveLog(log),
        end: pinnedState(game),
        trace: traceOf(puzzle, log),
      };
    }),
  };
}

/**
 * What is wrong with a golden file under the engine in the code: nothing,
 * or one message per problem, each saying what to do.
 */
export function goldenProblems(file: GoldenFile): string[] {
  if (file.rules !== MOVES_VERSION) {
    return [
      `The golden move logs were recorded under rules version ${file.rules}, but MOVES_VERSION is ${MOVES_VERSION}. Run npm run moves:golden to record them again.`,
    ];
  }
  const problems: string[] = [];
  for (const game of file.games) {
    const puzzle: Puzzle = {
      givens: game.givens,
      solution: game.solution,
      difficulty: game.difficulty,
    };
    const log = decodeMoveLog(game.log);
    if (log === null) {
      problems.push(`"${game.name}": the log no longer decodes.`);
      continue;
    }
    const end = pinnedState(replayMoves(puzzle, log));
    const differs = Object.keys(end).filter(
      (key) =>
        JSON.stringify(end[key as keyof PinnedState]) !==
        JSON.stringify(game.end[key as keyof PinnedState]),
    );
    if (differs.length > 0 || traceOf(puzzle, log) !== game.trace) {
      const where =
        differs.length > 0
          ? `ends differently (${differs.join(', ')})`
          : 'takes a different path to the same end';
      problems.push(`"${game.name}": the replay ${where}.`);
    }
  }
  if (problems.length === 0) return [];
  return [
    ...problems,
    `The reducer now replays the golden move logs differently, so a player's saved logs would replay into games they never played. If the change to the rules is meant, bump MOVES_VERSION in src/core/moves.ts (logs recorded under the old rules will then read as not recorded) and run npm run moves:golden to regenerate the fixtures deliberately. (A move of a new kind needs no bump: it takes an unused code, and cannot move these logs.) If it is not meant, the change to reduce is a bug.`,
  ];
}
