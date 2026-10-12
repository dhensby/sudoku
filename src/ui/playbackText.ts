import {
  formatDuration,
  lengthOf,
  playTimeAt,
  type CandidateChange,
  type LoggedHint,
  type MistakeEvent,
  type PageChange,
  type Playback,
  type PlaybackFrame,
  type PlaybackRefusal,
  type PlaybackTickKind,
  type StepHint,
} from '../core';
import { describePosition, describeUnit, isSingle, isSingleElsewhere } from './announce';
import { capitalise, TECHNIQUE_LABEL, withArticle } from './format';

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
 * A step hint's caption, put as the hint bar put it but naming every house
 * by number, as there is no "this cell" to measure from: "Hint: step 1 of
 * 7, a box/line reduction in column 8". A single on the way that fills
 * another cell in a house the hinted one shares is "elsewhere in" it, so it
 * can't be taken for the outlined cell's own; the last step, the single
 * that fills the cell, is captioned as a single always is. A step with no
 * house of its own — a wing, a chain, a fish — is named alone: the log
 * holds its technique, not its cells.
 */
function stepCaption(hint: StepHint): string {
  const { technique, unit, index, step, of } = hint;
  if (step === of && isSingle(technique)) {
    return hintCaption({ kind: 'single', index, technique, unit });
  }
  const where =
    unit === null
      ? ''
      : `${isSingleElsewhere(hint, unit) ? ' elsewhere' : ''} in ${describeUnit(unit)}`;
  return `Hint: step ${step} of ${of}, ${withArticle(TECHNIQUE_LABEL[technique])}${where}`;
}

/**
 * A page of Show me's caption: the cell, and the page as Show me headed it
 * ("Show me for row 2, column 1: step 3 of 7"); just the cell for a page
 * the route had none of, which only a log from outside could hold.
 */
function pageCaption({ cell, page }: PageChange): string {
  const where = `Show me for ${describePosition(cell)}`;
  return page === null ? where : `${where}: step ${page.step} of ${page.of}`;
}

/**
 * A hint's caption: the technique it named and where — the unit a single
 * lives in, else the cell — or the wrong number it pointed at; a step hint,
 * which step towards its cell it named (see `stepCaption`). A hint the
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
    case 'step':
      return stepCaption(hint);
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
    case 'page':
      return pageCaption(change);
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
