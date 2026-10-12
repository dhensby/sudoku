import {
  BOX,
  COL,
  ROW,
  conflictingUnits,
  digitsOf,
  harderTechnique,
  hasDigit,
  isEditable,
  unitCells,
  valuesOf,
  visibleCandidates,
  type Assists,
  type CellMark,
  type CellState,
  type Digit,
  type GameAction,
  type GameState,
  type Hint,
  type SingleTechniqueId,
  type StepHint,
  type TechniqueId,
  type Unit,
} from '../core';
import {
  CHECK_GUESSES_LABEL,
  TECHNIQUE_LABEL,
  capitalise,
  count,
  joinList,
  withArticle,
} from './format';

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
  /**
   * The houses of the step a step hint names (see `describeStep`), to say
   * where it is when the hint's one house can't: an X-Wing's rows. None by
   * default.
   */
  stepHouses?: readonly Unit[];
}

/**
 * The actions `describeChange` speaks for. A reset is not one of them: it
 * goes through a confirmation, and the hook says "Puzzle reset." as it
 * closes. Nor is switching Check guesses: that is a setting, switched in
 * Settings, whose switch speaks for itself.
 */
export type DescribedAction = Exclude<GameAction, { type: 'reset' | 'setCheckGuesses' }>;

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
    // Marked wrong as it went in: "Check guesses when entered" is on, and
    // the mark is said as the board shows it, after anything else.
    const verdict = after.mark === 'wrong' ? ' Incorrect.' : '';
    const placed = `${after.value} in ${position}.`;
    if (!(options.conflicts ?? true)) return placed + verdict;
    const units = conflictingUnits(valuesOf(next), index);
    if (units.length === 0) return placed + verdict;
    // The units by kind alone, never by number: heard aloud, "row 1, column
    // 3" is a cell's position, and would sound like one.
    const kinds = joinList(units.map((unit) => unit.kind));
    return `${placed} Clashes with another ${after.value} in its ${kinds}.${verdict}`;
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
    case 'showStep':
      // Opening "Show me", or turning its page, says nothing here: focus
      // moves into its dialog, which speaks for itself.
      return null;
    case 'hint': {
      // The visible message points at the highlighted cell ("this cell");
      // spoken, it needs to say which one that is.
      const message = describeHint(action.hint, options.stepHouses);
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

const SINGLES: readonly unknown[] = [
  'fullHouse',
  'hiddenSingleBox',
  'hiddenSingleLine',
  'nakedSingle',
] satisfies SingleTechniqueId[];

/** Whether a step's technique is a single: one that fills a cell. */
export function isSingle(technique: TechniqueId): technique is SingleTechniqueId {
  return SINGLES.includes(technique);
}

/**
 * Whether a step hint's step is a single on the way to its cell that fills
 * another cell in `unit`, a house the hinted cell is in too: said as
 * "elsewhere in" that house, so it can't be taken for the cell's own.
 */
export function isSingleElsewhere(hint: StepHint, unit: Unit): boolean {
  const { technique, index, step, of } = hint;
  return isSingle(technique) && step < of && unitCells(unit).includes(index);
}

/**
 * A house a step is in, on the hint bar: "row 4", "column 8", "box 9" —
 * numbered, as Show me's captions number them, for the step is often half
 * a board from the cell (its houses are tinted on the board as well) — but
 * the hinted cell's own box is "this box", as a single's is.
 */
function stepHouse(unit: Unit, index: number): string {
  return unit.kind === 'box' && unit.index === BOX[index] ? 'this box' : describeUnit(unit);
}

/**
 * The houses that say where a step with no one house of its own is, from
 * all its houses (see `SolveStep.houses`): a fish's base lines ("rows 2
 * and 7"), a Skyscraper's or a 2-String Kite's two strong links ("row 3 and
 * column 5"), a W-Wing's one. None for the rest — a wing or a chain whose
 * cells are tinted instead, as their houses are none, or too many to say.
 */
function placesOf(technique: TechniqueId, houses: readonly Unit[], index: number): string {
  let named: readonly Unit[] = [];
  if (technique === 'xWing' || technique === 'swordfish') {
    const end = houses.findIndex((house) => house.kind !== houses[0].kind);
    named = end === -1 ? houses : houses.slice(0, end);
  } else if (technique === 'skyscraper' || technique === 'twoStringKite') {
    named = houses.slice(0, 2);
  } else if (technique === 'wWing') {
    named = houses.slice(0, 1);
  }
  if (named.length === 0) return '';
  if (named.length === 1) return stepHouse(named[0], index);
  if (named.some((house) => house.kind !== named[0].kind)) {
    return joinList(named.map((house) => stepHouse(house, index)));
  }
  // Two or three lines of one kind (fish and Skyscrapers are only ever lines).
  return `${named[0].kind}s ${joinList(named.map((house) => String(house.index + 1)))}`;
}

/**
 * Where a step hint's step is, as " in row 4" — "" when it can't be said.
 * Its unit when it has one; else what its houses say (see `placesOf`). A
 * single on the way, which fills another cell, says "elsewhere in" a house
 * the hinted cell is in, so it can't be taken for that cell's own.
 */
function stepWhere(hint: StepHint, houses: readonly Unit[]): string {
  const { technique, unit, index } = hint;
  if (unit === null) {
    const places = placesOf(technique, houses, index);
    return places === '' ? '' : ` in ${places}`;
  }
  return `${isSingleElsewhere(hint, unit) ? ' elsewhere' : ''} in ${stepHouse(unit, index)}`;
}

/**
 * A step hint's message, without the hardest step (see `describeHardest`):
 * "Step 1 of 7: a box/line reduction in column 8." — or, as the last step,
 * the single that fills the cell, put as a single always is. `houses` are
 * the step's (see `stepWhere`), for one with no single house to name.
 *
 * It says nothing of "this cell": short enough to keep the bar to two lines
 * at every width, and the hint selects the cell — the spoken hint says which
 * after it, and the cell's description is read on the cell itself.
 */
export function describeStep(hint: StepHint, houses: readonly Unit[] = []): string {
  const { technique, unit, step, of } = hint;
  if (step === of && isSingle(technique)) {
    return describeSingle(technique, unit);
  }
  const what = withArticle(TECHNIQUE_LABEL[technique]);
  return `Step ${step} of ${of}: ${what}${stepWhere(hint, houses)}.`;
}

/**
 * A remembered step hint whose cell has moved on to a step the player
 * hasn't seen (see `Sudoku.isHintMovedOn`): said without naming it, which
 * Hint would count.
 */
export const MOVED_ON = "The board has moved on. Ask again for this cell's next step.";

/**
 * The hardest step still ahead on a step hint's route, said after the step
 * when it is harder than that step — "The hardest is an XY-Chain." — so the
 * player knows how deep the cell goes; null otherwise, and for any other
 * hint.
 */
export function describeHardest(hint: Hint): string | null {
  if (hint.kind !== 'step' || harderTechnique(hint.technique, hint.hardest) === hint.technique) {
    return null;
  }
  return `The hardest is ${withArticle(TECHNIQUE_LABEL[hint.hardest])}.`;
}

function describeDeduction(technique: TechniqueId | null): string {
  if (technique === null) return 'Try this cell — it has the fewest candidates.';
  return `Look here — ${withArticle(TECHNIQUE_LABEL[technique])} will unlock this cell.`;
}

/**
 * The hint bar's message, which is also what is spoken: where to look and,
 * where the grader knows, which technique gets you there — "Hidden single:
 * there's only one place for a number in this box." — the next step towards
 * the cell and how far there is to go ("Step 2 of 7: a hidden triple in row
 * 4. The hardest is an XY-Chain."; `stepHouses` say where a step is that
 * its hint's one house can't), or that a candidate the cell needs is
 * missing from it. It refers to "this cell" and "this box" because the hint
 * selects the cell, and it never names the digit: a hint is a nudge, not an
 * answer.
 */
export function describeHint(hint: Hint, stepHouses: readonly Unit[] = []): string {
  switch (hint.kind) {
    case 'mistake':
      return 'This number is incorrect.';
    case 'struck':
      // Gently: a candidate crossed out by eye is often right, just not yet
      // provable — and which one stays unsaid, as a hint never names a digit.
      return "This cell is missing a candidate that can't be ruled out yet.";
    case 'single':
      return describeSingle(hint.technique, hint.unit);
    case 'deduction':
      return describeDeduction(hint.technique);
    case 'step': {
      const step = describeStep(hint, stepHouses);
      const hardest = describeHardest(hint);
      return hardest === null ? step : `${step} ${hardest}`;
    }
    case 'none':
      return 'The puzzle is complete.';
  }
}

/**
 * What a move cost, said after what it did, while "Show help taken" is on:
 * the new count of the help it charged — "2 hints used.", "1 check used.",
 * "1 reveal used." — or, for auto candidates switched on for the first time
 * in the game, "Counts as help." (after the move's own "Auto candidates
 * on."), and for "Check guesses when entered", taken up as Settings closes,
 * "Checked as entered. Counts as help.". Null when it charged nothing, so a
 * hint asked for again, which is free, says only the hint: the count is
 * heard once, with the charge, as a sighted player sees it tick.
 */
export function describeCharge(before: Assists, after: Assists): string | null {
  const parts: string[] = [];
  if (after.autoCandidates && !before.autoCandidates) parts.push('Counts as help.');
  if (after.checkGuesses === true && before.checkGuesses !== true) {
    parts.push(`${CHECK_GUESSES_LABEL}. Counts as help.`);
  }
  if (after.hints > before.hints) parts.push(`${count(after.hints, 'hint')} used.`);
  if (after.checks > before.checks) parts.push(`${count(after.checks, 'check')} used.`);
  if (after.reveals > before.reveals) parts.push(`${count(after.reveals, 'reveal')} used.`);
  return parts.length === 0 ? null : parts.join(' ');
}
