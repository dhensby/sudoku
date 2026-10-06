import {
  createGame,
  formatGrid,
  parseGrid,
  reduce,
  type GameState,
  type Hint,
  type Puzzle,
} from '../core';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import {
  cellLabel,
  describeCell,
  describeChange,
  describeHint,
  describePosition,
  describeUnit,
  type CellLabelParams,
  type DescribedAction,
} from './announce';

const PUZZLE: Puzzle = {
  givens: formatGrid(parseGrid(WIKIPEDIA_PUZZLE)),
  solution: formatGrid(parseGrid(WIKIPEDIA_SOLUTION)),
  difficulty: 'easy',
};

// Row 1 of the puzzle is `53. .7. ...` and of its solution `534 678 912`:
// cell 2 (row 1, column 3) is the first empty one, and takes a 4.
const R1C3 = 2;
const R1C4 = 3;
// Row 2 is `6.. 195 ...`: a 9 at row 2, column 2 clashes with the 9 in its
// row, the 9 below it in column 2 and the same 9 in its box.
const R2C2 = 10;

/** Run actions from a fresh game, returning every state along the way. */
function play(...actions: DescribedAction[]): GameState[] {
  const states = [createGame(PUZZLE)];
  for (const action of actions) states.push(reduce(states.at(-1)!, action));
  return states;
}

/** What the status region says about the last of `actions`. */
function spoken(...actions: DescribedAction[]): string | null {
  const states = play(...actions);
  return describeChange(states.at(-2)!, states.at(-1)!, actions.at(-1)!);
}

const enter = (digit: number, extra: Partial<Extract<DescribedAction, { type: 'enter' }>> = {}) =>
  ({ type: 'enter', digit, ...extra }) as DescribedAction;
const select = (index: number): DescribedAction => ({ type: 'select', index });

describe('describePosition', () => {
  it.each([
    [0, 'row 1, column 1'],
    [8, 'row 1, column 9'],
    [22, 'row 3, column 5'],
    [80, 'row 9, column 9'],
  ])('names cell %i "%s", counting from one', (index, text) => {
    expect(describePosition(index)).toBe(text);
  });
});

describe('describeUnit', () => {
  it.each([
    ['row', 3, 'row 4'],
    ['column', 7, 'column 8'],
    ['box', 4, 'box 5'],
  ] as const)('names %s %i "%s", counting from one, boxes included', (kind, index, text) => {
    expect(describeUnit({ kind, index })).toBe(text);
  });
});

describe('cellLabel', () => {
  const blank: CellLabelParams = {
    value: 0,
    given: false,
    candidates: 0,
    conflict: false,
    mark: 'none',
  };

  it.each<[Partial<CellLabelParams>, string]>([
    [{ value: 5, given: true }, '5, given'],
    [{ value: 7 }, '7'],
    [{}, 'empty'],
    [{ candidates: 0b1001001 }, 'empty, candidates 1 4 7'],
    [{ value: 5, given: true, conflict: true }, '5, given, conflict'],
    [{ value: 3, mark: 'wrong' }, '3, incorrect'],
    [{ value: 3, mark: 'wrong', conflict: true }, '3, conflict, incorrect'],
    [{ value: 8, mark: 'correct' }, '8, correct'],
    [{ value: 6, mark: 'revealed' }, '6, revealed'],
    // A filled cell's notes are hidden underneath it, so never spoken.
    [{ value: 2, candidates: 0b11 }, '2'],
  ])('labels %o as "%s"', (params, text) => {
    expect(cellLabel({ ...blank, ...params })).toBe(text);
  });
});

describe('describeCell', () => {
  it('names the position and then the state', () => {
    const [game] = play();
    expect(describeCell(game, 0)).toBe('Row 1, column 1: 5, given.');
    expect(describeCell(game, R1C3)).toBe('Row 1, column 3: empty.');
  });

  it('includes the candidates on show and any conflict', () => {
    const notes = play(
      select(R2C2),
      enter(1, { mode: 'candidate' }),
      enter(4, { mode: 'candidate' }),
    );
    expect(describeCell(notes.at(-1)!, R2C2)).toBe('Row 2, column 2: empty, candidates 1 4.');
    const clash = play(select(R2C2), enter(9)).at(-1)!;
    expect(describeCell(clash, R2C2)).toBe('Row 2, column 2: 9, conflict.');
    expect(describeCell(clash, R2C2, { conflicts: false })).toBe('Row 2, column 2: 9.');
  });
});

describe('describeChange', () => {
  it('says nothing when nothing changed', () => {
    const [game] = play();
    expect(describeChange(game, game, enter(5))).toBeNull();
  });

  it('says nothing about moving the selection, which focus already announces', () => {
    expect(spoken(select(40))).toBeNull();
    expect(spoken({ type: 'move', direction: 'right' })).toBeNull();
  });

  describe('entering digits', () => {
    it('reports a placed digit and where', () => {
      expect(spoken(enter(4))).toBe('4 in row 1, column 3.');
    });

    it('names every kind of unit a placed digit clashes in, never by number', () => {
      // "Row 2, column 2" would sound like the cell's own position.
      expect(spoken(select(R2C2), enter(9))).toBe(
        '9 in row 2, column 2. Clashes with another 9 in its row, column and box.',
      );
      // Row 1 already has a 5 and so does its box; column 3 does not.
      expect(spoken(enter(5))).toBe(
        '5 in row 1, column 3. Clashes with another 5 in its row and box.',
      );
      // The 7 in row 1 sits in the next box along.
      expect(spoken(enter(7))).toBe('7 in row 1, column 3. Clashes with another 7 in its row.');
    });

    it('keeps quiet about conflicts the player has chosen not to see', () => {
      const states = play(select(R2C2), enter(9));
      expect(describeChange(states[1], states[2], enter(9), { conflicts: false })).toBe(
        '9 in row 2, column 2.',
      );
    });

    it('reports a candidate added and removed', () => {
      const add = enter(4, { mode: 'candidate' });
      expect(spoken(add)).toBe('Candidate 4 added.');
      expect(spoken(add, add)).toBe('Candidate 4 removed.');
    });

    it('says the value went too when a candidate is entered over it', () => {
      expect(spoken(enter(4), enter(7, { mode: 'candidate' }))).toBe(
        'Erased row 1, column 3. Candidate 7 added.',
      );
    });

    it('reports auto-mode eliminations in terms of what is on show', () => {
      // Row 1 column 3 can take 1, 2 or 4; striking 4 out removes it.
      const auto: DescribedAction = { type: 'setAutoCandidates', enabled: true };
      const strike = enter(4, { mode: 'candidate' });
      expect(spoken(auto, strike)).toBe('Candidate 4 removed.');
      expect(spoken(auto, strike, strike)).toBe('Candidate 4 added.');
    });

    it('says only that the value went when an auto-mode candidate has nothing to toggle', () => {
      // 9 is not a computed candidate of row 1, column 3 (its box has one).
      const auto: DescribedAction = { type: 'setAutoCandidates', enabled: true };
      expect(spoken(auto, enter(4), enter(9, { mode: 'candidate' }))).toBe(
        'Erased row 1, column 3.',
      );
    });

    it('describes the cell an entry names, not the selected one', () => {
      expect(spoken(enter(7, { index: R2C2 }))).toBe('7 in row 2, column 2.');
    });
  });

  describe('erasing', () => {
    it('reports the value going, then the notes', () => {
      expect(spoken(enter(4), { type: 'erase' })).toBe('Erased row 1, column 3.');
      expect(spoken(enter(1, { mode: 'candidate' }), { type: 'erase' })).toBe('Notes cleared.');
    });

    it('describes the cell an erase names', () => {
      expect(spoken(enter(7, { index: R2C2 }), { type: 'erase', index: R2C2 })).toBe(
        'Erased row 2, column 2.',
      );
    });
  });

  it('announces mode changes', () => {
    expect(spoken({ type: 'toggleMode' })).toBe('Candidate mode.');
    expect(spoken({ type: 'toggleMode' }, { type: 'setMode', mode: 'normal' })).toBe(
      'Normal mode.',
    );
    expect(spoken({ type: 'setMode', mode: 'candidate' })).toBe('Candidate mode.');
  });

  it('announces auto candidates being switched', () => {
    const on: DescribedAction = { type: 'setAutoCandidates', enabled: true };
    expect(spoken(on)).toBe('Auto candidates on.');
    expect(spoken(on, { type: 'setAutoCandidates', enabled: false })).toBe('Auto candidates off.');
  });

  describe('undo and redo', () => {
    it('say what the selected cell now holds', () => {
      expect(spoken(enter(4), { type: 'undo' })).toBe('Undone. Row 1, column 3: empty.');
      expect(spoken(enter(4), { type: 'undo' }, { type: 'redo' })).toBe(
        'Redone. Row 1, column 3: 4.',
      );
    });

    it('bring the notes back into the description', () => {
      const note = (d: number) => enter(d, { mode: 'candidate' });
      expect(spoken(note(1), note(4), { type: 'erase' }, { type: 'undo' })).toBe(
        'Undone. Row 1, column 3: empty, candidates 1 4.',
      );
    });

    it('mention a conflict the restored digit brings back', () => {
      expect(spoken(enter(5), enter(4), { type: 'undo' })).toBe(
        'Undone. Row 1, column 3: 5, conflict.',
      );
    });

    it('name the auto-candidate switch they flip back', () => {
      const on: DescribedAction = { type: 'setAutoCandidates', enabled: true };
      expect(spoken(on, { type: 'undo' })).toBe('Undone. Auto candidates off.');
      expect(spoken(on, { type: 'undo' }, { type: 'redo' })).toBe('Redone. Auto candidates on.');
    });

    it('say only the verb when the selected cell is locked and could not be put back', () => {
      // A note in row 1 column 4, then a 4 beside it that clears that note
      // too. Checking locks the 4, so undo restores only the note.
      const states = play(
        select(R1C4),
        enter(4, { mode: 'candidate' }),
        select(R1C3),
        enter(4, { clearPeerNotes: true }),
        { type: 'check', scope: 'cell' },
        { type: 'undo' },
      );
      const [before, after] = states.slice(-2);
      expect(after.cells[R1C4].notes).not.toBe(0);
      expect(describeChange(before, after, { type: 'undo' })).toBe('Undone.');
    });
  });

  describe('hints', () => {
    it('speak the hint and say which cell it points at', () => {
      const hint: Hint = { kind: 'single', index: R1C3, technique: 'nakedSingle', unit: null };
      expect(spoken({ type: 'hint', hint })).toBe(
        'Naked single: only one number fits in this cell. Row 1, column 3.',
      );
    });

    it('have no cell to point at once the puzzle is complete', () => {
      expect(spoken({ type: 'hint', hint: { kind: 'none' } })).toBe('The puzzle is complete.');
    });
  });

  describe('checks', () => {
    it('report a single checked cell by position', () => {
      expect(spoken(enter(4), { type: 'check', scope: 'cell' })).toBe(
        'Row 1, column 3 is correct.',
      );
      expect(spoken(enter(1), { type: 'check', scope: 'cell' })).toBe(
        'Row 1, column 3 is incorrect.',
      );
    });

    it('report a cell already marked wrong when it is checked again', () => {
      const check: DescribedAction = { type: 'check', scope: 'cell' };
      expect(spoken(enter(1), check, check)).toBe('Row 1, column 3 is incorrect.');
    });

    it('count what a puzzle check looked at and found', () => {
      const check: DescribedAction = { type: 'check', scope: 'puzzle' };
      expect(spoken(enter(4), enter(1, { index: R1C4 }), check)).toBe(
        '2 cells checked: 1 incorrect.',
      );
      expect(spoken(enter(4), enter(6, { index: R1C4 }), check)).toBe(
        '2 cells checked: all correct.',
      );
    });

    it('leave out cells already locked by an earlier check', () => {
      const states = play(enter(4), { type: 'check', scope: 'puzzle' }, enter(1, { index: R1C4 }), {
        type: 'check',
        scope: 'puzzle',
      });
      expect(describeChange(states[3], states[4], { type: 'check', scope: 'puzzle' })).toBe(
        'Row 1, column 4 is incorrect.',
      );
    });

    it('say nothing about a check that found nothing to check', () => {
      // The reducer returns the same state for that; this guards a caller
      // that hands over a changed state anyway.
      const [game] = play();
      const changed = { ...game, hint: null };
      expect(describeChange(game, changed, { type: 'check', scope: 'cell' })).toBeNull();
    });
  });

  it('reports a revealed digit', () => {
    expect(spoken({ type: 'reveal' })).toBe('Revealed 4 in row 1, column 3.');
  });
});

describe('describeHint', () => {
  it.each<[Hint, string]>([
    [{ kind: 'mistake', index: 4 }, 'This number is incorrect.'],
    [
      { kind: 'single', index: 4, technique: 'fullHouse', unit: { kind: 'row', index: 3 } },
      'Full house: row 4 has one cell left.',
    ],
    [
      { kind: 'single', index: 4, technique: 'fullHouse', unit: { kind: 'box', index: 0 } },
      'Full house: this box has one cell left.',
    ],
    [
      { kind: 'single', index: 4, technique: 'fullHouse', unit: null },
      'Full house: this is the last empty cell in its row, column or box.',
    ],
    [
      { kind: 'single', index: 4, technique: 'hiddenSingleBox', unit: { kind: 'box', index: 4 } },
      "Hidden single: there's only one place for a number in this box.",
    ],
    [
      {
        kind: 'single',
        index: 4,
        technique: 'hiddenSingleLine',
        unit: { kind: 'column', index: 6 },
      },
      "Hidden single: there's only one place for a number in column 7.",
    ],
    [
      { kind: 'single', index: 4, technique: 'hiddenSingleLine', unit: null },
      'Hidden single: a number fits only here in its row, column or box.',
    ],
    [
      { kind: 'single', index: 4, technique: 'nakedSingle', unit: null },
      'Naked single: only one number fits in this cell.',
    ],
    [
      { kind: 'deduction', index: 4, technique: 'pointing' },
      'Look here — a pointing pair or triple will unlock this cell.',
    ],
    [
      { kind: 'deduction', index: 4, technique: 'claiming' },
      'Look here — a box/line reduction will unlock this cell.',
    ],
    // "An X-Wing": the article follows the sound, and X is said "ex".
    [
      { kind: 'deduction', index: 4, technique: 'xWing' },
      'Look here — an X-Wing will unlock this cell.',
    ],
    [
      { kind: 'deduction', index: 4, technique: 'xyzWing' },
      'Look here — an XYZ-Wing will unlock this cell.',
    ],
    [
      { kind: 'deduction', index: 4, technique: 'swordfish' },
      'Look here — a Swordfish will unlock this cell.',
    ],
    [
      { kind: 'deduction', index: 4, technique: null },
      'Try this cell — it has the fewest candidates.',
    ],
    [{ kind: 'none' }, 'The puzzle is complete.'],
  ])('describes %o', (hint, text) => {
    expect(describeHint(hint)).toBe(text);
  });
});
