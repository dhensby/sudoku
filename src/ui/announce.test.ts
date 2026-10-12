import {
  createGame,
  formatGrid,
  parseGrid,
  reduce,
  type GameState,
  type Hint,
  type Puzzle,
  type StepHint,
  type Unit,
} from '../core';
import { WIKIPEDIA_PUZZLE, WIKIPEDIA_SOLUTION } from '../test/grids';
import {
  cellLabel,
  describeCell,
  describeCharge,
  describeChange,
  describeHardest,
  describeHint,
  describePosition,
  describeStep,
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

  it('says nothing about opening "Show me", whose dialog speaks for itself', () => {
    const hint: DescribedAction = {
      type: 'hint',
      hint: { kind: 'single', index: R1C3, technique: 'nakedSingle', unit: null },
    };
    const states = play(hint, { type: 'walkthrough', index: R1C3 });
    expect(states.at(-1)).not.toBe(states.at(-2));
    expect(
      describeChange(states.at(-2)!, states.at(-1)!, { type: 'walkthrough', index: R1C3 }),
    ).toBeNull();
  });

  describe('entering digits', () => {
    it('reports a placed digit and where', () => {
      expect(spoken(enter(4))).toBe('4 in row 1, column 3.');
    });

    it('says a wrong number is incorrect, last, when Check guesses marks it as it goes in', () => {
      const checked = reduce(createGame(PUZZLE), { type: 'setCheckGuesses', enabled: true });
      const say = (digit: number, conflicts = true) =>
        describeChange(checked, reduce(checked, enter(digit)), enter(digit), { conflicts });
      expect(say(1)).toBe('1 in row 1, column 3. Incorrect.');
      expect(say(5)).toBe(
        '5 in row 1, column 3. Clashes with another 5 in its row and box. Incorrect.',
      );
      expect(say(5, false)).toBe('5 in row 1, column 3. Incorrect.');
      // The answer is not marked, and not said to be right either.
      expect(say(4)).toBe('4 in row 1, column 3.');
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

    it('speak the next step, how far there is to go, the hardest, and which cell it is for', () => {
      const hint: Hint = {
        kind: 'step',
        index: R1C3,
        technique: 'claiming',
        unit: { kind: 'column', index: 7 },
        step: 1,
        of: 7,
        hardest: 'xyChain',
        id: 1,
      };
      expect(spoken({ type: 'hint', hint })).toBe(
        'Step 1 of 7: a box/line reduction in column 8. ' +
          'The hardest is an XY-Chain. Row 1, column 3.',
      );
    });

    it('speak where a step with no one house is, from the houses it is given', () => {
      const hint: Hint = {
        kind: 'step',
        index: R1C3,
        technique: 'xWing',
        unit: null,
        step: 5,
        of: 7,
        hardest: 'xyChain',
        id: 1,
      };
      const action: DescribedAction = { type: 'hint', hint };
      const [before, after] = play(action);
      const houses: Unit[] = [
        { kind: 'column', index: 1 },
        { kind: 'column', index: 6 },
        { kind: 'row', index: 2 },
        { kind: 'row', index: 7 },
      ];
      expect(describeChange(before, after, action, { stepHouses: houses })).toBe(
        'Step 5 of 7: an X-Wing in columns 2 and 7. The hardest is an XY-Chain. Row 1, column 3.',
      );
    });

    it('say nothing as a page of Show me is turned to: the dialog speaks for itself', () => {
      const [game] = play();
      const turned = { ...game, assists: { ...game.assists, hints: 2 } };
      expect(describeChange(game, turned, { type: 'showStep', index: R1C3, id: 1 })).toBeNull();
    });

    it('have no cell to point at once the puzzle is complete', () => {
      expect(spoken({ type: 'hint', hint: { kind: 'none' } })).toBe('The puzzle is complete.');
      expect(spoken({ type: 'hint', hint: { kind: 'struck', index: R1C3 } })).toBe(
        "This cell is missing a candidate that can't be ruled out yet. Row 1, column 3.",
      );
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
  /** A step towards cell 4 (row 1, column 5): step `step` of `of`. */
  const step = (change: Partial<StepHint>): StepHint => ({
    kind: 'step',
    index: 4,
    technique: 'hiddenTriple',
    unit: { kind: 'row', index: 3 },
    step: 2,
    of: 7,
    hardest: 'xyChain',
    id: 1,
    ...change,
  });

  it.each<[Hint, string]>([
    [step({}), 'Step 2 of 7: a hidden triple in row 4. The hardest is an XY-Chain.'],
    // The hardest said only when it is harder than the step.
    [step({ technique: 'xyChain', unit: null, step: 6 }), 'Step 6 of 7: an XY-Chain.'],
    [
      step({ technique: 'nakedPair', unit: { kind: 'column', index: 1 }, hardest: 'nakedPair' }),
      'Step 2 of 7: a naked pair in column 2.',
    ],
    // Boxes by number, as Show me's captions number them; the cell's own is "this box".
    [
      step({ technique: 'pointing', unit: { kind: 'box', index: 4 }, hardest: 'pointing' }),
      'Step 2 of 7: a pointing pair or triple in box 5.',
    ],
    [
      step({ technique: 'pointing', unit: { kind: 'box', index: 1 }, hardest: 'pointing' }),
      'Step 2 of 7: a pointing pair or triple in this box.',
    ],
    // The last step: the single that fills the cell, said as a single always is.
    [
      step({
        technique: 'hiddenSingleBox',
        unit: { kind: 'box', index: 1 },
        step: 7,
        hardest: 'hiddenSingleBox',
      }),
      "Hidden single: there's only one place for a number in this box.",
    ],
    [
      step({ technique: 'nakedSingle', unit: null, step: 1, of: 1, hardest: 'nakedSingle' }),
      'Naked single: only one number fits in this cell.',
    ],
  ])('describes the step %o', (hint, text) => {
    expect(describeHint(hint)).toBe(text);
  });

  const row = (index: number): Unit => ({ kind: 'row', index });
  const column = (index: number): Unit => ({ kind: 'column', index });
  const box = (index: number): Unit => ({ kind: 'box', index });

  it.each<[string, Partial<StepHint>, Unit[], string]>([
    // A single on the way fills another cell: never to be taken for this one's.
    [
      'a hidden single elsewhere in a house of the cell',
      { technique: 'hiddenSingleBox', unit: box(1), hardest: 'hiddenSingleBox' },
      [box(1)],
      'Step 2 of 7: a hidden single elsewhere in this box.',
    ],
    [
      'a hidden single in another house',
      { technique: 'hiddenSingleLine', unit: row(5), hardest: 'hiddenSingleLine' },
      [row(5)],
      'Step 2 of 7: a hidden single in row 6.',
    ],
    [
      'a naked single elsewhere, named by its box',
      { technique: 'nakedSingle', unit: box(5), hardest: 'nakedSingle' },
      [],
      'Step 2 of 7: a naked single in box 6.',
    ],
    [
      'a naked single elsewhere in the cell’s own box',
      { technique: 'nakedSingle', unit: box(1), hardest: 'nakedSingle' },
      [],
      'Step 2 of 7: a naked single elsewhere in this box.',
    ],
    // A step with no one house says where it is from its houses.
    [
      'an X-Wing, by its base lines',
      { technique: 'xWing', unit: null, hardest: 'xWing' },
      [row(1), row(6), column(2), column(7)],
      'Step 2 of 7: an X-Wing in rows 2 and 7.',
    ],
    [
      'a Swordfish, by its base lines',
      { technique: 'swordfish', unit: null, hardest: 'swordfish' },
      [column(0), column(4), column(8), row(1), row(3), row(5)],
      'Step 2 of 7: a Swordfish in columns 1, 5 and 9.',
    ],
    [
      'a fish whose houses are all one kind',
      { technique: 'xWing', unit: null, hardest: 'xWing' },
      [row(1), row(6)],
      'Step 2 of 7: an X-Wing in rows 2 and 7.',
    ],
    [
      'a 2-String Kite, by its strong links',
      { technique: 'twoStringKite', unit: null, hardest: 'twoStringKite' },
      [row(2), column(4), box(1)],
      'Step 2 of 7: a 2-String Kite in row 3 and column 5.',
    ],
    [
      'a Skyscraper, by its strong links',
      { technique: 'skyscraper', unit: null, hardest: 'skyscraper' },
      [column(0), column(3), row(4)],
      'Step 2 of 7: a Skyscraper in columns 1 and 4.',
    ],
    [
      'a W-Wing, by the house that joins it, the cell’s own box as this box',
      { technique: 'wWing', unit: null, hardest: 'wWing' },
      [box(1)],
      'Step 2 of 7: a W-Wing in this box.',
    ],
    [
      'a chain, whose cells are tinted instead',
      { technique: 'alternatingChain', unit: null, hardest: 'alternatingChain' },
      [row(1), column(2)],
      'Step 2 of 7: an alternating chain.',
    ],
  ])('says where %s is', (_name, change, houses, text) => {
    expect(describeHint(step(change), houses)).toBe(text);
    expect(describeStep(step(change), houses)).toBe(text);
  });

  it('says a step with its houses unknown without them', () => {
    expect(describeStep(step({ technique: 'xWing', unit: null, hardest: 'xWing' }))).toBe(
      'Step 2 of 7: an X-Wing.',
    );
  });

  it('says the hardest step apart, and only for a step hint whose hardest is harder', () => {
    expect(describeHardest(step({}))).toBe('The hardest is an XY-Chain.');
    expect(describeStep(step({}))).toBe('Step 2 of 7: a hidden triple in row 4.');
    expect(describeHardest(step({ hardest: 'hiddenTriple' }))).toBeNull();
    expect(describeHardest({ kind: 'deduction', index: 4, technique: 'xyChain' })).toBeNull();
  });

  it.each<[Hint, string]>([
    [{ kind: 'mistake', index: 4 }, 'This number is incorrect.'],
    // Kind, and no digit: which candidate is missing stays the player's to find.
    [{ kind: 'struck', index: 4 }, "This cell is missing a candidate that can't be ruled out yet."],
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

describe('describeCharge', () => {
  const NONE = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };

  it.each([
    [{ ...NONE, hints: 1 }, { ...NONE, hints: 2 }, '2 hints used.'],
    [NONE, { ...NONE, hints: 1 }, '1 hint used.'],
    [NONE, { ...NONE, checks: 1 }, '1 check used.'],
    [{ ...NONE, checks: 1 }, { ...NONE, checks: 3 }, '3 checks used.'],
    [NONE, { ...NONE, reveals: 1 }, '1 reveal used.'],
    [{ ...NONE, reveals: 1 }, { ...NONE, reveals: 2 }, '2 reveals used.'],
    [NONE, { ...NONE, autoCandidates: true }, 'Counts as help.'],
    [NONE, { ...NONE, checkGuesses: true as const }, 'Checked as entered. Counts as help.'],
  ])('says the new count of what a move charged: %o to %o', (before, after, text) => {
    expect(describeCharge(before, after)).toBe(text);
  });

  it('says nothing for a move that charged nothing', () => {
    const some = { autoCandidates: true, hints: 2, checks: 1, reveals: 1 };
    expect(describeCharge(some, { ...some })).toBeNull();
    // Auto candidates on again, already counted.
    expect(describeCharge(some, some)).toBeNull();
    // Check guesses: on again, or the game's record of it gone, charges nothing.
    const checked = { ...some, checkGuesses: true as const };
    expect(describeCharge(checked, { ...checked })).toBeNull();
    expect(describeCharge(checked, some)).toBeNull();
  });
});
