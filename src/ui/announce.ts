import {
  COL,
  ROW,
  conflictingUnits,
  digitsOf,
  hasDigit,
  isEditable,
  valuesOf,
  visibleCandidates,
  type CellMark,
  type CellState,
  type Digit,
  type GameAction,
  type GameState,
  type Hint,
  type SingleTechniqueId,
  type TechniqueId,
  type Unit,
} from '../core';
import { TECHNIQUE_LABEL, capitalise, joinList, withArticle } from './format';

/*
 * The words the game speaks: cell names for the grid, a line for the status
 * region after every move, and the hint bar's messages.
 *
 * Pure, and kept out of `src/core` on purpose — the engine is framework-free
 * and language-free, and it should stay that way. Phrasing is short and
 * plain: it is heard after every keystroke, so it says what changed and
 * stops. Positions are spoken as "row 3, column 5", counted from one.
 */

/** Options for the spoken descriptions. */
export interface DescribeOptions {
  /**
   * Mention clashes with peers ("Clashes with another 3 in its row and
   * box."). Pass the player's Highlight conflicts setting, so speech never
   * says more than the board shows. Default true.
   */
  conflicts?: boolean;
}

/**
 * The actions `describeChange` speaks for. A reset is not one of them: it
 * goes through a confirmation, and the hook says "Puzzle reset." as it
 * closes.
 */
export type DescribedAction = Exclude<GameAction, { type: 'reset' }>;

/** What a cell's accessible name is built from. */
export interface CellLabelParams {
  /** The placed digit, 0 when empty. */
  value: number;
  given: boolean;
  /** The candidates on show (a mask), which only an empty cell has. */
  candidates: number;
  /** Whether the value clashes with a peer — and conflicts are being shown. */
  conflict: boolean;
  mark: CellMark;
}

const MARK_WORD: Readonly<Record<CellMark, string | null>> = {
  none: null,
  wrong: 'incorrect',
  correct: 'correct',
  revealed: 'revealed',
};

/**
 * A row, column or box by number, counted from one: "row 4", "column 8",
 * "box 5", boxes in reading order. The technique guide's worked examples
 * speak this way: they have no selected cell to call "this box", and their
 * diagrams are numbered.
 */
export function describeUnit(unit: Unit): string {
  return `${unit.kind} ${unit.index + 1}`;
}

/**
 * A row or column by number, a box as "this box": boxes are numbered for the
 * engine, but no player thinks of "box 5", and the cell a hint is about is
 * selected anyway.
 */
function unitName(unit: Unit): string {
  return unit.kind === 'box' ? 'this box' : describeUnit(unit);
}

/** A cell's position, as spoken: "row 3, column 5". */
export function describePosition(index: number): string {
  return `row ${ROW[index] + 1}, column ${COL[index] + 1}`;
}

/**
 * A cell's accessible name: its state only — "5, given", "7", "empty",
 * "empty, candidates 1 4 7" — then ", conflict" and the Check or Reveal
 * verdict (", incorrect", ", correct", ", revealed"). The position is left to
 * the grid's `aria-rowindex`/`aria-colindex`, so a screen reader announces
 * only the axis that changed as the player arrows around rather than every
 * cell restating its own coordinates.
 */
export function cellLabel({ value, given, candidates, conflict, mark }: CellLabelParams): string {
  const parts: string[] = [];
  if (value !== 0) {
    parts.push(String(value));
    if (given) parts.push('given');
  } else {
    parts.push('empty');
    if (candidates !== 0) parts.push(`candidates ${digitsOf(candidates).join(' ')}`);
  }
  if (conflict) parts.push('conflict');
  const verdict = MARK_WORD[mark];
  if (verdict !== null) parts.push(verdict);
  return parts.join(', ');
}

function isConflicting(state: GameState, index: number, options: DescribeOptions): boolean {
  return (options.conflicts ?? true) && conflictingUnits(valuesOf(state), index).length > 0;
}

/** A cell and what it holds, for speech: "Row 3, column 5: empty, candidates 1 4." */
export function describeCell(
  state: GameState,
  index: number,
  options: DescribeOptions = {},
): string {
  const cell = state.cells[index];
  const label = cellLabel({
    value: cell.value,
    given: cell.given,
    candidates: visibleCandidates(state)[index],
    conflict: isConflicting(state, index, options),
    mark: cell.mark,
  });
  return `${capitalise(describePosition(index))}: ${label}.`;
}

/**
 * Whether a candidate entry added or removed its digit, in whichever layer is
 * on show: the player's notes, or — in auto mode — the computed candidates
 * less the ones struck out. Null when the digit's visibility did not change
 * (an auto-mode digit a placed peer already rules out has nothing to toggle).
 */
function describeToggle(
  before: CellState,
  after: CellState,
  digit: Digit,
  isAuto: boolean,
): string | null {
  const isShown = (cell: CellState) =>
    isAuto ? !hasDigit(cell.autoRemoved, digit) : hasDigit(cell.notes, digit);
  if (isShown(after) === isShown(before)) return null;
  return `Candidate ${digit} ${isShown(after) ? 'added' : 'removed'}.`;
}

/** What an entry did to its cell: a digit placed, or a candidate toggled (clearing the value first). */
function describeEntry(
  prev: GameState,
  next: GameState,
  action: Extract<GameAction, { type: 'enter' }>,
  options: DescribeOptions,
): string | null {
  const index = action.index ?? prev.selected;
  const before = prev.cells[index];
  const after = next.cells[index];
  const position = describePosition(index);
  if (after.value !== 0 && after.value !== before.value) {
    const placed = `${after.value} in ${position}.`;
    if (!(options.conflicts ?? true)) return placed;
    const units = conflictingUnits(valuesOf(next), index);
    if (units.length === 0) return placed;
    // The units by kind alone, never by number: heard aloud, "row 1, column
    // 3" is a cell's position, and would sound like one.
    const kinds = joinList(units.map((unit) => unit.kind));
    return `${placed} Clashes with another ${after.value} in its ${kinds}.`;
  }
  const toggle = describeToggle(before, after, action.digit, next.autoCandidates);
  if (after.value === before.value) return toggle;
  // Candidate entry on a filled cell clears the value as well.
  return toggle === null ? `Erased ${position}.` : `Erased ${position}. ${toggle}`;
}

/**
 * Undo and redo name what they put back: the auto-candidate switch, or the
 * cell they selected, as it now stands. When that cell itself could not be
 * put back — a Check has locked it since — the verb is all there is to say.
 */
function describeReplay(
  verb: string,
  prev: GameState,
  next: GameState,
  options: DescribeOptions,
): string {
  if (next.autoCandidates !== prev.autoCandidates) {
    return `${verb} ${describeAutoCandidates(next)}`;
  }
  const index = next.selected;
  if (prev.cells[index] === next.cells[index]) return verb;
  return `${verb} ${describeCell(next, index, options)}`;
}

function describeAutoCandidates(state: GameState): string {
  return state.autoCandidates ? 'Auto candidates on.' : 'Auto candidates off.';
}

/**
 * What a Check found. A cell can be checked if it is editable and holds a
 * digit — exactly what the reducer checks.
 */
function describeCheck(prev: GameState, next: GameState, scope: 'cell' | 'puzzle'): string | null {
  const indexes = scope === 'cell' ? [prev.selected] : prev.cells.map((_, i) => i);
  const checked = indexes.filter((i) => isEditable(prev, i) && prev.cells[i].value !== 0);
  if (checked.length === 0) return null;
  const wrong = checked.filter((i) => next.cells[i].mark === 'wrong').length;
  if (checked.length === 1) {
    return `${capitalise(describePosition(checked[0]))} is ${wrong === 0 ? 'correct' : 'incorrect'}.`;
  }
  return `${checked.length} cells checked: ${wrong === 0 ? 'all correct' : `${wrong} incorrect`}.`;
}

/**
 * The line for the status region after an action took `prev` to `next`, or
 * null when there is nothing worth saying.
 *
 * Takes the action as well as the two states because the states alone cannot
 * always tell what happened: an undo and a redo can leave identical-looking
 * stacks, and which cells a Check looked at depends on its scope.
 *
 * Selecting and moving say nothing: focus follows the selection on the grid,
 * and the screen reader announces the focused cell itself. A solve is not
 * described here at all: the caller announces it with the time, which only
 * it knows.
 */
export function describeChange(
  prev: GameState,
  next: GameState,
  action: DescribedAction,
  options: DescribeOptions = {},
): string | null {
  if (next === prev) return null;
  switch (action.type) {
    case 'select':
    case 'move':
      return null;
    case 'enter':
      return describeEntry(prev, next, action, options);
    case 'erase': {
      const index = action.index ?? prev.selected;
      return next.cells[index].value === prev.cells[index].value
        ? 'Notes cleared.'
        : `Erased ${describePosition(index)}.`;
    }
    case 'setMode':
    case 'toggleMode':
      return next.mode === 'normal' ? 'Normal mode.' : 'Candidate mode.';
    case 'setAutoCandidates':
      return describeAutoCandidates(next);
    case 'undo':
      return describeReplay('Undone.', prev, next, options);
    case 'redo':
      return describeReplay('Redone.', prev, next, options);
    case 'walkthrough':
      // Opening "Show me" says nothing here: focus moves into its dialog,
      // which speaks for itself.
      return null;
    case 'hint': {
      // The visible message points at the highlighted cell ("this cell");
      // spoken, it needs to say which one that is.
      const message = describeHint(action.hint);
      if (action.hint.kind === 'none') return message;
      return `${message} ${capitalise(describePosition(action.hint.index))}.`;
    }
    case 'check':
      return describeCheck(prev, next, action.scope);
    case 'reveal': {
      const index = prev.selected;
      return `Revealed ${next.cells[index].value} in ${describePosition(index)}.`;
    }
  }
}

function describeSingle(technique: SingleTechniqueId, unit: Unit | null): string {
  switch (technique) {
    case 'fullHouse':
      return unit === null
        ? 'Full house: this is the last empty cell in its row, column or box.'
        : `Full house: ${unitName(unit)} has one cell left.`;
    case 'hiddenSingleBox':
    case 'hiddenSingleLine':
      // Without its unit (the grader always names one) the sentence is
      // turned round: said as the others are, it would be the longest hint
      // of all, and take a phone's hint bar to a third line (layout.css).
      return unit === null
        ? 'Hidden single: a number fits only here in its row, column or box.'
        : `Hidden single: there's only one place for a number in ${unitName(unit)}.`;
    case 'nakedSingle':
      return 'Naked single: only one number fits in this cell.';
  }
}

function describeDeduction(technique: TechniqueId | null): string {
  if (technique === null) return 'Try this cell — it has the fewest candidates.';
  return `Look here — ${withArticle(TECHNIQUE_LABEL[technique])} will unlock this cell.`;
}

/**
 * The hint bar's message, which is also what is spoken: where to look and,
 * where the grader knows, which technique gets you there — "Hidden single:
 * there's only one place for a number in this box." It refers to "this
 * cell" and "this box" because the hint selects the cell, and it never names
 * the digit: a hint is a nudge, not an answer.
 */
export function describeHint(hint: Hint): string {
  switch (hint.kind) {
    case 'mistake':
      return 'This number is incorrect.';
    case 'single':
      return describeSingle(hint.technique, hint.unit);
    case 'deduction':
      return describeDeduction(hint.technique);
    case 'none':
      return 'The puzzle is complete.';
  }
}
