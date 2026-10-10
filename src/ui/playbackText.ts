import {
  formatDuration,
  lengthOf,
  playTimeAt,
  type CandidateChange,
  type LoggedHint,
  type MistakeEvent,
  type Playback,
  type PlaybackFrame,
  type PlaybackRefusal,
  type PlaybackTickKind,
} from '../core';
import { describePosition, describeUnit } from './announce';
import { capitalise, TECHNIQUE_LABEL } from './format';

/*
 * The words of a playback (see `src/core/playback.ts`): a caption for each
 * move, the scrubber's position as a screen reader hears it, the names of
 * its marks, and why a solve cannot be played back. Short and plain, said
 * the way the rest of the game says them — cells by row and column, help by
 * the name it has in the "…" menu, techniques by their names in the guide.
 */

/** The caption at the start, before any move: the givens on their own. */
export const START_CAPTION = 'Before the first move';

/**
 * A hint's caption: the technique it named and where — the unit a single
 * lives in, else the cell — or the wrong number it pointed at. A hint the
 * grader could not name points at a cell to try. (A hint off the grid,
 * which only a log from outside could hold, names no place.)
 */
function hintCaption(hint: LoggedHint): string {
  const isOnGrid = hint.index >= 0;
  const where = isOnGrid ? ` in ${describePosition(hint.index)}` : '';
  switch (hint.kind) {
    case 'mistake':
      return `Hint: a wrong number${where}`;
    case 'struck':
      // As the hint said it: a candidate missing, never which one.
      return `Hint: a candidate missing${where}`;
    case 'single': {
      const technique = capitalise(TECHNIQUE_LABEL[hint.technique]);
      // A naked single is about its cell alone: it has no unit to name.
      return hint.unit === null
        ? `Hint: ${technique}${where}`
        : `Hint: ${technique} in ${describeUnit(hint.unit)}`;
    }
    case 'deduction':
      if (hint.technique !== null) return `Hint: ${capitalise(TECHNIQUE_LABEL[hint.technique])}`;
      return isOnGrid ? `Hint: try ${describePosition(hint.index)}` : 'Hint';
  }
}

/**
 * A candidate move's caption: "Pencilled 3 in row 3, column 4", "Struck 3 in
 * …" — led by the value it cleared on a filled cell ("Cleared 6, struck 5 in
 * …", or just "Cleared 6 in …" when the digit was not one to strike). An
 * entry that changed nothing, which only a log from outside could hold, is
 * named for what was tried.
 */
function candidateCaption({ effect, cleared, digit, cell }: CandidateChange): string {
  const where = describePosition(cell);
  const verb = effect === 'struck' ? 'struck' : 'pencilled';
  if (cleared !== null) {
    return effect === 'unchanged'
      ? `Cleared ${cleared} in ${where}`
      : `Cleared ${cleared}, ${verb} ${digit} in ${where}`;
  }
  return effect === 'unchanged'
    ? `Candidate ${digit} in ${where}`
    : `${capitalise(verb)} ${digit} in ${where}`;
}

/** What a move did, without its mistakes: "5 in row 3, column 4", "Undo". */
function moveCaption({ change }: PlaybackFrame): string {
  switch (change.op) {
    case 'place':
      return `${change.digit} in ${describePosition(change.cell)}`;
    case 'candidate':
      return candidateCaption(change);
    case 'erase':
      return `Erased ${describePosition(change.cell)}`;
    case 'hint':
      return hintCaption(change.hint);
    case 'walkthrough':
      return `Show me for ${describePosition(change.cell)}`;
    case 'checkCell':
      return `Checked ${describePosition(change.cell)}`;
    case 'checkPuzzle':
      return 'Checked the puzzle';
    case 'reveal':
      return `Revealed ${describePosition(change.cell)}`;
    case 'autoOn':
      return 'Auto candidates on';
    case 'autoOff':
      return 'Auto candidates off';
    case 'checkGuessesOn':
      return 'Check guesses on';
    case 'checkGuessesOff':
      return 'Check guesses off';
    case 'undo':
      return 'Undo';
    case 'redo':
      return 'Redo';
    case 'reset':
      return 'Reset';
  }
}

/**
 * What a move's mistakes came to, after a dash: "a mistake", "a candidate
 * mistake", or a slip forgiven — a counted one first, as it is what the
 * count at the end is made of. Null for a move that made none.
 */
function mistakeNote(mistakes: readonly MistakeEvent[]): string | null {
  const counted = mistakes.find((mistake) => mistake.outcome === 'counted');
  if (counted !== undefined) return counted.kind === 'value' ? 'a mistake' : 'a candidate mistake';
  return mistakes.length > 0 ? 'a slip, put right in time' : null;
}

/**
 * A move's caption: what it did, where — and, if it made one, what its
 * mistake came to ("5 in row 3, column 4 — a mistake"); the solving move
 * says so ("— solved").
 */
export function describeMove(frame: PlaybackFrame): string {
  const notes = [mistakeNote(frame.mistakes)];
  if (frame.state.status === 'solved') notes.push('solved');
  return [moveCaption(frame), ...notes.filter((note) => note !== null)].join(' — ');
}

/** The caption at `position`: the move on show there, or `START_CAPTION`. */
export function captionAt(playback: Playback, position: number): string {
  return position === 0 ? START_CAPTION : describeMove(playback.frames[position - 1]);
}

/**
 * Where the scrubber is, as a screen reader hears it: "Move 42 of 310, 4:12"
 * — the move on show and the play time it was made at — or "Start, 0:00".
 */
export function positionText(playback: Playback, position: number): string {
  const time = formatDuration(playTimeAt(playback, position));
  return position === 0 ? `Start, ${time}` : `Move ${position} of ${lengthOf(playback)}, ${time}`;
}

/** The scrubber's marks, as the key under it names them. */
export const TICK_LABEL: Readonly<Record<PlaybackTickKind, string>> = {
  mistake: 'Mistake',
  slip: 'Slip put right',
  help: 'Help',
};

/** Why a solve cannot be played back, said in its place (see `PlaybackRefusal`). */
export const REFUSAL_TEXT: Readonly<Record<PlaybackRefusal, string>> = {
  puzzle: "This puzzle isn't one the game can play, so its solve can't be played back.",
  older: "This solve was recorded by an older version of the game, so it can't be played back.",
  newer:
    'This solve was recorded by a newer version of the game. Reload the page to update it, then try again.',
  broken: "This solve's record is damaged, so it can't be played back.",
  unsolved: "This record stops short of the solve, so it can't be played back.",
};
