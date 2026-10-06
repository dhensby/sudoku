import {
  TECHNIQUE_ORDER,
  TECHNIQUE_TIER,
  bit,
  explainCell,
  grade,
  maskOf,
  type SolveStep,
  type TechniqueId,
  type TechniqueTrace,
} from '../core';
import { STUCK_ON_A_HIDDEN_PAIR, stuckOnAHiddenPair, tierPuzzles } from '../test/logic-fixtures';
import { DIFFICULTY_LABEL, TECHNIQUE_LABEL, capitalise } from './format';
import {
  GUIDE,
  GUIDE_ORDER,
  creditsFor,
  guideExamples,
  guideIdFor,
  guideTier,
  guideTiers,
  techniqueQuestion,
  walkthroughCaption,
} from './techniqueGuide';

/** A trace made up for a caption's less common shapes; only what captions read matters. */
function madeUp(
  step: Partial<SolveStep> & Pick<SolveStep, 'technique'>,
  values: ArrayLike<number> = new Uint8Array(81),
  candidates: ArrayLike<number> = new Uint16Array(81),
): TechniqueTrace {
  return {
    values: Uint8Array.from(values),
    candidates: Uint16Array.from(candidates),
    step: {
      placement: null,
      eliminations: [],
      unit: null,
      pattern: [],
      houses: [],
      digit: null,
      ...step,
    },
  };
}

/** A grid from a sparse map of cell → digit. */
function grid(cells: Record<number, number>): Uint8Array {
  const values = new Uint8Array(81);
  for (const [index, digit] of Object.entries(cells)) values[Number(index)] = digit;
  return values;
}

describe('the entries', () => {
  it('cover every technique the grader knows, once each, easiest first', () => {
    const techniques = GUIDE_ORDER.flatMap((id) => GUIDE[id].examples.map((e) => e.technique));
    expect(techniques).toEqual(TECHNIQUE_ORDER);
  });

  it('are named as hints name them', () => {
    for (const id of GUIDE_ORDER) {
      for (const { technique } of GUIDE[id].examples) {
        expect(GUIDE[id].title).toBe(capitalise(TECHNIQUE_LABEL[technique]));
      }
    }
    expect(GUIDE.xWing.title).toBe('X-Wing');
    expect(GUIDE.claiming.title).toBe('Box/line reduction');
  });

  it.each(GUIDE_ORDER)('%s says what it is, why it works and how to spot it', (id) => {
    const entry = GUIDE[id];
    expect(entry.id).toBe(id);
    expect(entry.summary).toMatch(/^[A-Z].+\.$/);
    expect(entry.explanation.length).toBeGreaterThan(0);
    for (const paragraph of [...entry.explanation, entry.spot]) {
      expect(paragraph).toMatch(/^[A-Z“].+[.)]$/);
    }
    // Plain words: "house" is jargon the guide never uses.
    expect([entry.summary, ...entry.explanation, entry.spot].join(' ')).not.toMatch(/\bhouse/);
  });

  it('gives the other names players will meet elsewhere', () => {
    expect(GUIDE.xyWing.aka).toContain('Y-Wing');
    expect(GUIDE.pointing.aka).toContain('locked candidates (pointing)');
    expect(GUIDE.claiming.aka).toContain('claiming');
    // As sudoku.com names them: its "last remaining cell" is a hidden single,
    // and a full house its "last free cell".
    expect(GUIDE.fullHouse.aka).toContain('last free cell');
    expect(GUIDE.hiddenSingle.aka).toContain('last remaining cell');
    expect(GUIDE.nakedSingle.aka).toContain('last possible number');
    expect(GUIDE.hiddenPair.aka).toEqual([]);
  });

  it('never gives a name that means something else elsewhere', () => {
    const names = (id: keyof typeof GUIDE) => GUIDE[id].aka;
    // A conjugate pair is a digit's last two places in a row, column or box.
    expect(names('nakedPair')).not.toContain('conjugate pair');
    expect(names('fullHouse')).not.toContain('last remaining cell');
    // Box/line interaction names pointing and box/line reduction together:
    // said in the explanations, not given as either one's other name.
    expect(names('pointing')).not.toContain('box/line interaction');
    expect(GUIDE.pointing.explanation.join(' ')).toContain('box/line interactions');
    expect(GUIDE.claiming.explanation.join(' ')).toContain('box/line interactions');
  });

  it('asks for wing pincers that hang off different digits of the pivot', () => {
    expect(GUIDE.xyWing.spot).toContain(
      "one shares one of the pivot's digits, the other its other",
    );
    expect(GUIDE.xyzWing.spot).toContain("two different pairs of the pivot's digits");
  });

  it("takes its tiers from the grader's table, in words and in badges", () => {
    // The hidden single's explanation names both tiers; neither is written
    // into the text by hand.
    const text = GUIDE.hiddenSingle.explanation.join(' ');
    expect(text).toContain(
      `In a box it counts as ${DIFFICULTY_LABEL[TECHNIQUE_TIER.hiddenSingleBox]}`,
    );
    expect(text).toContain(
      `Along a line it counts as ${DIFFICULTY_LABEL[TECHNIQUE_TIER.hiddenSingleLine]}`,
    );
    expect(GUIDE.nakedSingle.explanation.join(' ')).toContain(
      `It counts as ${DIFFICULTY_LABEL[TECHNIQUE_TIER.nakedSingle]}`,
    );
  });
});

describe('guideIdFor', () => {
  it.each(TECHNIQUE_ORDER)('finds the entry that explains %s', (technique) => {
    const id = guideIdFor(technique);
    expect(GUIDE[id].examples.map((e) => e.technique)).toContain(technique);
  });

  it('sends both hidden singles to one entry', () => {
    expect(guideIdFor('hiddenSingleBox')).toBe('hiddenSingle');
    expect(guideIdFor('hiddenSingleLine')).toBe('hiddenSingle');
  });
});

describe('techniqueQuestion', () => {
  it.each<[TechniqueId, string]>([
    ['hiddenSingleBox', "What's a hidden single?"],
    ['xWing', "What's an X-Wing?"],
    ['xyzWing', "What's an XYZ-Wing?"],
    ['skyscraper', "What's a Skyscraper?"],
    ['twoStringKite', "What's a 2-String Kite?"],
    ['claiming', "What's a box/line reduction?"],
    ['pointing', "What's a pointing pair or triple?"],
  ])('asks about %s by its name', (technique, question) => {
    expect(techniqueQuestion(technique)).toBe(question);
  });
});

describe('guideTiers', () => {
  it('gives most entries one tier', () => {
    expect(guideTiers('xWing')).toEqual([{ difficulty: 'expert', label: null }]);
    expect(guideTiers('pointing')).toEqual([{ difficulty: 'medium', label: null }]);
  });

  it('gives the hidden single both of its tiers, saying which is which', () => {
    expect(guideTiers('hiddenSingle')).toEqual([
      { difficulty: 'easy', label: 'In a box' },
      { difficulty: 'medium', label: 'In a row or column' },
    ]);
    expect(guideTier('hiddenSingle')).toBe('easy');
  });

  it.each(GUIDE_ORDER)('lists %s at the tier of its easiest technique', (id) => {
    expect(guideTier(id)).toBe(TECHNIQUE_TIER[GUIDE[id].examples[0].technique]);
  });
});

describe('the worked examples', () => {
  it('trace each stored board once, and hand back the same trace after', () => {
    const [first] = guideExamples('xWing');
    const [again] = guideExamples('xWing');
    expect(again.trace).toBe(first.trace);
    expect(first.trace.step.technique).toBe('xWing');
  });

  it('show the hidden single in a box and along a line, labelled', () => {
    expect(guideExamples('hiddenSingle').map(({ technique, label }) => [technique, label])).toEqual(
      [
        ['hiddenSingleBox', 'In a box'],
        ['hiddenSingleLine', 'In a row or column'],
      ],
    );
  });

  /*
   * Each caption pinned against its stored example (see examples.test.ts,
   * which pins the boards): the words must say exactly what the diagram
   * beside them shows.
   */
  it.each<[TechniqueId, string]>([
    [
      'fullHouse',
      'Row 5 has one empty cell left, at column 8, and one digit missing: 6. So row 5, column 8 ' +
        'must be 6.',
    ],
    [
      'hiddenSingleBox',
      "Every other empty cell in box 7 already sees a 7 — at row 3, column 1 or row 9, column 5 — so box 7's 7 can only go in row 7, column 2.",
    ],
    [
      'hiddenSingleLine',
      "Every other empty cell in row 4 already sees a 3 — at row 3, column 9 or row 6, column 1 — so row 4's 3 can only go in row 4, column 5. Box 5 still has two places for a 3, so only the row gives it away.",
    ],
    [
      'nakedSingle',
      'Row 7, column 3 already sees every digit but 3: 2, 5 and 6 in its row; 1, 4, 8 and 9 in ' +
        'its column; and 7 in its box. So 3 is all it can be.',
    ],
    [
      'pointing',
      "In box 1, the only places left for an 8 are in row 1, at columns 2 and 3. Box 1's 8 must be one of them, and so it is also row 1's 8: no other cell in row 1 can be an 8. Remove it from row 1, column 4.",
    ],
    [
      'claiming',
      "In row 6, the only places left for a 4 are in box 4, at columns 2 and 3. Row 6's 4 must be one of them, and so it is also box 4's 4: no other cell in box 4 can be a 4. Remove it from row 5, column 2.",
    ],
    [
      'nakedPair',
      'In row 7, columns 3 and 5 can each only be 1 or 2. One is the 1 and the other the 2, so ' +
        'no other cell in row 7 can be either: remove 2 from row 7, column 4; and 1 from row 7, ' +
        'column 6.',
    ],
    [
      'hiddenPair',
      'In row 1, the 5 and 7 can only go in columns 3 and 4. Those two cells must hold the 5 and ' +
        '7, one each, so nothing else fits in them: remove 9 from both.',
    ],
    [
      'nakedTriple',
      "In column 6, rows 3, 4 and 5 can only be 3 or 5, 1 or 5, and 1 or 3: three cells with just 1, 3 and 5 between them, though none can be all three. Whatever order they go in, those cells take column 6's 1, 3 and 5, so remove 1 and 5 from row 1, column 6; and 1 from row 8, column 6.",
    ],
    [
      'hiddenTriple',
      'In column 8, the 6, 8 and 9 can only go in rows 6, 7 and 8. Those three cells must hold ' +
        'the 6, 8 and 9, one each, so nothing else fits in them: remove 5 from row 6, column 8; ' +
        'and 4 from row 7, column 8.',
    ],
    [
      'xWing',
      "In rows 2 and 7, the 3 can only go in columns 4 and 9. Each row's 3 is in one of those columns, and the two rows can't use the same one, so they take the 3s of both columns between them. Remove 3 from the rest of those columns: row 1, column 4.",
    ],
    [
      'swordfish',
      "In rows 2, 4 and 7, the 8 can only go in columns 2, 3 and 4. Each row's 8 is in one of those columns, and no two rows can use the same one, so they take the 8s of all three columns between them. Remove 8 from the rest of those columns: row 6, column 4.",
    ],
    [
      'xyWing',
      "The pivot, row 7, column 4, can only be 5 or 7. If it's 5, the pincer at row 6, column 4 must be 3; if it's 7, the pincer at row 7, column 2 must be 3. Either way one pincer is 3, so a cell that sees both can't be: remove 3 from row 6, column 2.",
    ],
    [
      'xyzWing',
      "The pivot, row 1, column 6, can only be 3, 8 or 9. If it's 8, the pincer at row 1, column 7 must be 9; if it's 3, the pincer at row 2, column 6 must be 9; otherwise it's 9 itself. Either way one of the three is 9, so a cell that sees all three can't be: remove 9 from row 1, column 5.",
    ],
    [
      'skyscraper',
      "Column 3's 7 can only go in rows 2 and 6, and column 4's in rows 2 and 5. Row 2 can't hold both columns' 7s, so at least one of them is in its other place: column 3's at row 6, or column 4's at row 5. Either way one of those two cells is a 7, so a cell that sees both can't be: remove 7 from row 5, column 1.",
    ],
    [
      'twoStringKite',
      "Row 2's 1 can only go in columns 6 and 7, and column 4's in rows 3 and 4. Their cells in box 2 — row 2, column 6 and row 3, column 4 — can't both be 1s, so either row 2's 1 is at column 7, or column 4's is at row 4. Either way one of those two cells is a 1, so a cell that sees both can't be: remove 1 from row 4, column 7.",
    ],
  ])('walk through the %s example', (technique, caption) => {
    const example = guideExamples(guideIdFor(technique)).find((e) => e.technique === technique)!;
    expect(example.caption).toBe(caption);
  });
});

/*
 * Shapes the stored examples happen not to have, so the wording is right
 * whatever a trace holds — and a better example can be stored later without
 * the captions breaking.
 */
describe('captions in other shapes', () => {
  it('name a lone blocking copy, and a full house in a box', () => {
    // Box 1 holds 1–7; an 8 in column 3 rules out its other empty cell.
    const values = grid({ 0: 1, 1: 2, 2: 3, 9: 4, 10: 5, 11: 6, 18: 7, 29: 8 });
    const hidden = madeUp(
      {
        technique: 'hiddenSingleBox',
        placement: { index: 19, digit: 8 },
        unit: { kind: 'box', index: 0 },
      },
      values,
    );
    expect(GUIDE.hiddenSingle.caption(hidden)).toBe(
      "Every other empty cell in box 1 already sees the 8 at row 4, column 3, so box 1's 8 can " +
        'only go in row 3, column 2.',
    );

    const full = madeUp({
      technique: 'fullHouse',
      placement: { index: 40, digit: 3 },
      unit: { kind: 'box', index: 4 },
    });
    expect(GUIDE.fullHouse.caption(full)).toBe(
      'Box 5 has one empty cell left, at row 5, column 5, and one digit missing: 3. So row 5, ' +
        'column 5 must be 3.',
    );
  });

  it('leave out the box when a single down a column is a single in its box too', () => {
    // Column 1 is full but for rows 1 and 9; a 5 in row 9 rules out the
    // other, and box 1 has no other place for a 5 either.
    const values = grid({ 9: 1, 18: 2, 27: 3, 36: 4, 45: 6, 54: 7, 63: 8, 75: 5 });
    const candidates = new Uint16Array(81);
    candidates[0] = bit(5) | bit(9);
    const trace = madeUp(
      {
        technique: 'hiddenSingleLine',
        placement: { index: 0, digit: 5 },
        unit: { kind: 'column', index: 0 },
      },
      values,
      candidates,
    );
    expect(GUIDE.hiddenSingle.caption(trace)).toBe(
      "Every other empty cell in column 1 already sees the 5 at row 9, column 4, so column 1's " +
        '5 can only go in row 1, column 1.',
    );
  });

  it('say so when a naked single sees all eight digits in one house', () => {
    const values = grid({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 });
    const trace = madeUp({ technique: 'nakedSingle', placement: { index: 0, digit: 9 } }, values);
    expect(GUIDE.nakedSingle.caption(trace)).toBe(
      'Row 1, column 1 already sees every digit but 9: 1, 2, 3, 4, 5, 6, 7 and 8 in its row. ' +
        'So 9 is all it can be.',
    );
  });

  it('fall back on the candidates when the placed copies alone do not rule a cell out', () => {
    // Box 1 holds 1–4 and 6–8; r1c2 is open, and no 5 anywhere sees it —
    // an earlier step must have ruled it out. Said plainly, not looped over.
    const values = grid({ 2: 1, 9: 2, 10: 3, 11: 4, 18: 6, 19: 7, 20: 8 });
    const trace = madeUp(
      {
        technique: 'hiddenSingleBox',
        placement: { index: 0, digit: 5 },
        unit: { kind: 'box', index: 0 },
      },
      values,
    );
    expect(GUIDE.hiddenSingle.caption(trace)).toBe(
      "No other empty cell in box 1 can be a 5, so box 1's 5 can only go in row 1, column 1.",
    );
  });

  it('name removals from several cells of a column by the column, then its rows', () => {
    const trace = madeUp({
      technique: 'nakedPair',
      unit: { kind: 'column', index: 3 },
      pattern: [
        { index: 48, mask: maskOf([5, 9]) },
        { index: 57, mask: maskOf([5, 9]) },
      ],
      eliminations: [
        { index: 21, mask: bit(5) },
        { index: 30, mask: bit(5) },
      ],
    });
    expect(GUIDE.nakedPair.caption(trace)).toBe(
      'In column 4, rows 6 and 7 can each only be 5 or 9. One is the 5 and the other the 9, so ' +
        'no other cell in column 4 can be either: remove 5 from column 4, rows 3 and 4.',
    );
  });

  it('list removals over two rows clause by clause', () => {
    const trace = madeUp({
      technique: 'claiming',
      digit: 4,
      houses: [
        { kind: 'row', index: 0 },
        { kind: 'box', index: 0 },
      ],
      pattern: [
        { index: 0, mask: bit(4) },
        { index: 1, mask: bit(4) },
      ],
      eliminations: [
        { index: 9, mask: bit(4) },
        { index: 10, mask: bit(4) },
        { index: 19, mask: bit(4) },
      ],
    });
    expect(GUIDE.claiming.caption(trace)).toMatch(
      /Remove it from row 2, columns 1 and 2; and row 3, column 2\.$/,
    );
  });

  it('drop "though none can be all three" when one cell can be', () => {
    const trace = madeUp({
      technique: 'nakedTriple',
      unit: { kind: 'row', index: 0 },
      pattern: [
        { index: 0, mask: maskOf([1, 2, 3]) },
        { index: 1, mask: maskOf([1, 2]) },
        { index: 2, mask: maskOf([1, 3]) },
      ],
      eliminations: [{ index: 5, mask: maskOf([1, 2]) }],
    });
    expect(GUIDE.nakedTriple.caption(trace)).toBe(
      "In row 1, columns 1, 2 and 3 can only be 1, 2 or 3; 1 or 2; and 1 or 3: three cells with just 1, 2 and 3 between them. Whatever order they go in, those cells take row 1's 1, 2 and 3, so remove 1 and 2 from row 1, column 6.",
    );
  });

  it('remove the same digit "from all three" in a box', () => {
    const trace = madeUp({
      technique: 'hiddenTriple',
      unit: { kind: 'box', index: 0 },
      pattern: [
        { index: 0, mask: maskOf([1, 2]) },
        { index: 10, mask: maskOf([2, 3]) },
        { index: 20, mask: maskOf([1, 3]) },
      ],
      eliminations: [0, 10, 20].map((index) => ({ index, mask: bit(9) })),
    });
    expect(GUIDE.hiddenTriple.caption(trace)).toBe(
      'In box 1, the 1, 2 and 3 can only go in row 1, column 1; row 2, column 2; and row 3, ' +
        'column 3. Those three cells must hold the 1, 2 and 3, one each, so nothing else fits ' +
        'in them: remove 9 from all three.',
    );
  });

  it('turn a fish on its side when its base lines are columns', () => {
    const trace = madeUp({
      technique: 'xWing',
      digit: 7,
      houses: [
        { kind: 'column', index: 1 },
        { kind: 'column', index: 4 },
        { kind: 'row', index: 2 },
        { kind: 'row', index: 6 },
      ],
      eliminations: [{ index: 26, mask: bit(7) }],
    });
    expect(GUIDE.xWing.caption(trace)).toBe(
      "In columns 2 and 5, the 7 can only go in rows 3 and 7. Each column's 7 is in one of those rows, and the two columns can't use the same one, so they take the 7s of both rows between them. Remove 7 from the rest of those rows: row 3, column 9.",
    );
  });
});

/** Every step of a walkthrough in words, each crediting the steps before it. */
function captionsOf(steps: readonly TechniqueTrace[]): string[] {
  return steps.map((trace, k) => walkthroughCaption(trace, steps.slice(0, k)));
}

/** A cell by its row and column, counted from one as the captions count them. */
const rc = (row: number, col: number) => (row - 1) * 9 + col - 1;

describe('walkthrough captions', () => {
  it('walk through the hidden pair a player was stuck on, each step crediting what it rests on', () => {
    const { values, solution } = stuckOnAHiddenPair();
    const { steps } = explainCell(values, STUCK_ON_A_HIDDEN_PAIR.target, solution)!;
    expect(captionsOf(steps)).toEqual([
      'In column 6, the 1 and 7 can only go in rows 4 and 6. Those two cells must hold the 1 ' +
        'and 7, one each, so nothing else fits in them: remove 5 from row 4, column 6; and 2 ' +
        'and 8 from row 6, column 6.',
      "Step 1 removed 5 from row 4, column 6. In box 5, the only places left for a 5 are in row 5, at columns 5 and 6. Box 5's 5 must be one of them, and so it is also row 5's 5: no other cell in row 5 can be a 5. Remove it from row 5, columns 2 and 3.",
      'Row 5, column 2 sees 1, 3, 6 and 7 in its row; and 2, 4 and 9 in its column. Step 2 ' +
        'ruled out its 5. So 8 is all it can be.',
    ]);
  });

  it('credit an earlier step only with what a later one relies on', () => {
    const { values, solution } = stuckOnAHiddenPair();
    const { steps } = explainCell(values, STUCK_ON_A_HIDDEN_PAIR.target, solution)!;
    const [pair, pointing, single] = steps;
    expect(creditsFor(pair.step, [])).toEqual([]);
    // The hidden pair also struck 2 and 8 from row 6, column 6, which the
    // pointing pair does not need.
    expect(creditsFor(pointing.step, [pair])).toEqual([
      { step: 0, eliminations: [{ index: rc(4, 6), mask: bit(5) }] },
    ]);
    expect(creditsFor(single.step, [pair, pointing])).toEqual([
      { step: 1, eliminations: [{ index: rc(5, 2), mask: bit(5) }] },
    ]);
  });

  it.each(GUIDE_ORDER)(
    'leave the %s example as the guide words it, with nothing to credit',
    (id) => {
      for (const example of guideExamples(id)) {
        expect(walkthroughCaption(example.trace, [])).toBe(example.caption);
        expect(creditsFor(example.trace.step, [])).toEqual([]);
      }
    },
  );

  describe('for a single that rests on an earlier step', () => {
    // Box 1 holds 1–4 and 6–8, leaving row 1, columns 1 and 2 open; no 5
    // sees row 1, column 2, so only an earlier step can have ruled it out.
    const values = grid({ 2: 1, 9: 2, 10: 3, 11: 4, 18: 6, 19: 7, 20: 8 });
    const single = madeUp(
      {
        technique: 'hiddenSingleBox',
        placement: { index: 0, digit: 5 },
        unit: { kind: 'box', index: 0 },
        houses: [{ kind: 'box', index: 0 }],
      },
      values,
    );
    const struck = (index: number, mask: number) =>
      madeUp({ technique: 'pointing', eliminations: [{ index, mask }] });

    it('says which step took the digit from a cell no placed copy sees', () => {
      expect(walkthroughCaption(single, [struck(40, bit(5)), struck(1, bit(5))])).toBe(
        "Every other empty cell in box 1 lost its 5 in step 2, so box 1's 5 can only go in " +
          'row 1, column 1.',
      );
    });

    it('names the placed copies that rule out the rest', () => {
      // Row 2, column 1 opened up, and a 5 in column 1 sees it.
      const opened = values.slice();
      opened[9] = 0;
      opened[63] = 5;
      const trace = { ...single, values: opened };
      expect(walkthroughCaption(trace, [struck(1, bit(5))])).toBe(
        'Every other empty cell in box 1 either sees the 5 at row 8, column 1 or lost its 5 ' +
          "in step 1, so box 1's 5 can only go in row 1, column 1.",
      );
      expect(walkthroughCaption(trace, [struck(1, bit(5)), struck(1, bit(5))])).toContain(
        'or lost its 5 in steps 1 and 2,',
      );
    });

    it('says which step ruled out the digits a naked single does not see', () => {
      // Row 1 holds 1–4 and 7; columns 1 holds nothing; so 5, 6, 8 and 9
      // are not seen, and two earlier steps struck three of them.
      const row = grid({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 7 });
      const trace = madeUp({ technique: 'nakedSingle', placement: { index: 0, digit: 9 } }, row);
      expect(
        walkthroughCaption(trace, [
          struck(0, maskOf([5, 6])),
          struck(40, bit(8)),
          struck(0, bit(8)),
        ]),
      ).toBe(
        'Row 1, column 1 sees 1, 2, 3, 4 and 7 in its row. Step 1 ruled out its 5 and 6. ' +
          'Step 3 ruled out its 8. So 9 is all it can be.',
      );
      // Without the steps to credit, it says so plainly.
      expect(GUIDE.nakedSingle.caption(trace)).toBe(
        'Row 1, column 1 sees 1, 2, 3, 4 and 7 in its row. Earlier steps ruled out its 5, 6 ' +
          'and 8. So 9 is all it can be.',
      );
    });

    it('needs no placed digit to explain a naked single the steps alone account for', () => {
      const trace = madeUp({ technique: 'nakedSingle', placement: { index: 0, digit: 9 } });
      expect(walkthroughCaption(trace, [struck(0, 0xff)])).toBe(
        'Step 1 ruled out its 1, 2, 3, 4, 5, 6, 7 and 8. So 9 is all it can be.',
      );
    });
  });

  // Deals Hard and Expert puzzles and walks through hundreds of cells: a few
  // seconds on its own, but coverage instrumentation on a CI runner can make
  // it many times slower, so it gets the walkthrough tests' generous timeout.
  it('leave no candidate unexplained and credit only earlier steps, over many walkthroughs', () => {
    // Every empty cell of Hard and Expert puzzles, from the givens and part
    // way through: a walkthrough can run to dozens of steps.
    let walkthroughs = 0;
    let credited = 0;
    for (const { givens, solution } of [
      ...tierPuzzles('hard', 3, 700),
      ...tierPuzzles('expert', 3, 800),
    ]) {
      const placements = grade(givens).steps.filter((step) => step.placement !== null);
      for (const count of [0, 12, 24]) {
        const values = givens.slice();
        for (const { placement } of placements.slice(0, count)) {
          values[placement!.index] = placement!.digit;
        }
        for (let target = 0; target < 81; target++) {
          const walkthrough = explainCell(values, target, solution);
          if (walkthrough === null) continue;
          walkthroughs++;
          captionsOf(walkthrough.steps).forEach((caption, k) => {
            // Said plainly only when there is no step to credit.
            expect(caption).not.toMatch(/No other empty cell|Earlier steps/);
            for (const [, numbers] of caption.matchAll(/[Ss]teps? ((?:\d+(?:, | and )?)+)/g)) {
              credited++;
              for (const n of numbers.split(/, | and /)) expect(Number(n)).toBeLessThanOrEqual(k);
            }
          });
        }
      }
    }
    expect(walkthroughs).toBeGreaterThan(500);
    expect(credited).toBeGreaterThan(50);
  }, 60_000);
});
