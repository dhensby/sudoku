import {
  BOX,
  COL,
  POPCOUNT,
  ROW,
  TECHNIQUE_TIER,
  bit,
  digitsOf,
  isPeer,
  techniqueExample,
  unitCells,
  type Difficulty,
  type Elimination,
  type TechniqueId,
  type TechniqueTrace,
  type Unit,
  type UnitKind,
} from '../core';
import { describePosition, describeUnit } from './announce';
import { DIFFICULTY_LABEL, TECHNIQUE_LABEL, capitalise, joinList, withArticle } from './format';

/*
 * The technique guide's words: what each technique the grader knows is
 * called, why it works, how to spot it, and a caption that walks through its
 * worked example. Kept out of `src/core`, like the rest of the UI's English;
 * the engine supplies the examples (`techniqueExample`) and the facts each
 * caption is built from (the step's pattern, houses and digit).
 *
 * Written for a keen player who knows the rules and the NYT puzzles, and
 * wants the names behind the hints: the usual terms, the reason a technique
 * is sound, and what to look for. Captions count rows, columns and boxes from
 * one, as the diagrams are labelled, and say only what that example shows.
 */

/** An entry in the guide. The two hidden singles share one, as they share a name. */
export type GuideId =
  | 'fullHouse'
  | 'hiddenSingle'
  | 'nakedSingle'
  | 'pointing'
  | 'claiming'
  | 'nakedPair'
  | 'hiddenPair'
  | 'nakedTriple'
  | 'hiddenTriple'
  | 'xWing'
  | 'swordfish'
  | 'xyWing'
  | 'xyzWing';

/** One worked example an entry shows: a technique, and a label when there is more than one. */
export interface GuideExampleSpec {
  technique: TechniqueId;
  /** What tells this example from the entry's others ("In a box"); null for an entry's only one. */
  label: string | null;
}

/** Everything the guide says about one technique. */
export interface GuideEntry {
  id: GuideId;
  /** The name hints use, capitalised: "Hidden single", "X-Wing". */
  title: string;
  /** Other names it goes by elsewhere, lower case unless a proper name. */
  aka: readonly string[];
  /** One sentence: what it is. */
  summary: string;
  /** A few short paragraphs: how it works, and why it is sound. */
  explanation: readonly string[];
  /** How to look for it. */
  spot: string;
  /** The worked examples, in the order shown — each technique of the entry once. */
  examples: readonly GuideExampleSpec[];
  /** The worked example walked through in words, from the trace it was drawn from. */
  caption: (trace: TechniqueTrace) => string;
}

/** The entries in the order the guide lists them: easiest first, as the grader tries them. */
export const GUIDE_ORDER: readonly GuideId[] = [
  'fullHouse',
  'hiddenSingle',
  'nakedSingle',
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
];

const GUIDE_ID: Readonly<Record<TechniqueId, GuideId>> = {
  fullHouse: 'fullHouse',
  hiddenSingleBox: 'hiddenSingle',
  hiddenSingleLine: 'hiddenSingle',
  nakedSingle: 'nakedSingle',
  pointing: 'pointing',
  claiming: 'claiming',
  nakedPair: 'nakedPair',
  hiddenPair: 'hiddenPair',
  nakedTriple: 'nakedTriple',
  hiddenTriple: 'hiddenTriple',
  xWing: 'xWing',
  swordfish: 'swordfish',
  xyWing: 'xyWing',
  xyzWing: 'xyzWing',
};

/** The guide entry that explains a technique — what a hint's "What's a …?" opens. */
export function guideIdFor(technique: TechniqueId): GuideId {
  return GUIDE_ID[technique];
}

/** "What's a hidden single?", "What's an X-Wing?": the hint bar's way into the guide. */
export function techniqueQuestion(technique: TechniqueId): string {
  return `What's ${withArticle(TECHNIQUE_LABEL[technique])}?`;
}

// ---- Wording ----------------------------------------------------------------

const NUMBER_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** A tier's name, read from the grader so the guide can never disagree with it. */
function tierOf(technique: TechniqueId): string {
  return DIFFICULTY_LABEL[TECHNIQUE_TIER[technique]];
}

/** "a 3", "an 8": eight is the one digit said with a vowel. */
function aDigit(digit: number): string {
  return `${digit === 8 ? 'an' : 'a'} ${digit}`;
}

/** "6", "6 and 8", "1, 3 and 5". */
function digitList(mask: number): string {
  return joinList(digitsOf(mask).map(String));
}

/** "6 or 8", "1, 3 or 5": a cell's candidates, two or more. */
function orList(mask: number): string {
  const digits = digitsOf(mask).map(String);
  return `${digits.slice(0, -1).join(', ')} or ${digits.at(-1)}`;
}

/** Numbers counted from one, in order: "2 and 3". */
function numberList(indexes: Iterable<number>): string {
  return joinList([...new Set(indexes)].sort((a, b) => a - b).map((i) => String(i + 1)));
}

/** "column 4", "columns 2 and 3". */
function numbered(kind: UnitKind, indexes: readonly number[]): string {
  return `${kind}${new Set(indexes).size === 1 ? '' : 's'} ${numberList(indexes)}`;
}

/**
 * Cells as briefly as they can be named: "row 1, column 4", then cells that
 * share a row or a column by it — "row 1, columns 2 and 3", "column 6, rows
 * 3, 4 and 5" — and anything else row by row.
 */
function cellsPhrase(indexes: readonly number[]): string {
  const cells = [...indexes].sort((a, b) => a - b);
  const rows = [...new Set(cells.map((i) => ROW[i]))];
  const columns = cells.map((i) => COL[i]);
  if (cells.length === 1) return describePosition(cells[0]);
  if (rows.length === 1) return `row ${rows[0] + 1}, ${numbered('column', columns)}`;
  if (new Set(columns).size === 1) {
    return `column ${columns[0] + 1}, ${numbered('row', rows)}`;
  }
  return joinClauses(rows.map((row) => cellsPhrase(cells.filter((i) => ROW[i] === row))));
}

/**
 * Cells of a house, named within it: by column along a row ("columns 3 and
 * 4"), by row down a column, and in full in a box, which has no one number
 * that sets its cells apart.
 */
function withinPhrase(unit: Unit, indexes: readonly number[]): string {
  if (unit.kind === 'box') return cellsPhrase(indexes);
  const [kind, of] = unit.kind === 'row' ? (['column', COL] as const) : (['row', ROW] as const);
  return numbered(
    kind,
    indexes.map((i) => of[i]),
  );
}

/**
 * Clauses in a list, each with a comma or an "or" of its own — a cell's
 * position ("row 1, column 4"), a cell's candidates ("3 or 5") — which a
 * plain "a, b and c" would run together. So clauses with commas get
 * semicolons between them, and the rest a comma before the last "and", so
 * each still reads as one item.
 */
function joinClauses(clauses: readonly string[]): string {
  if (clauses.length <= 1) return clauses.join('');
  const [rest, last] = [clauses.slice(0, -1), clauses.at(-1)];
  if (clauses.some((clause) => clause.includes(','))) return `${rest.join('; ')}; and ${last}`;
  return `${rest.join(', ')}, and ${last}`;
}

/**
 * What a step removes, each cell named in full — "3 from row 2, column 9;
 * and 9 from row 5, column 9" — and cells losing the same digits together:
 * "1 from column 6, rows 1 and 8". Never a cell by its row or column alone
 * ("1 from row 8"), which reads as the whole line.
 */
function removals(eliminations: readonly Elimination[]): string {
  const cellsByMask = new Map<number, number[]>();
  for (const { index, mask } of eliminations) {
    cellsByMask.set(mask, [...(cellsByMask.get(mask) ?? []), index]);
  }
  return joinClauses(
    [...cellsByMask].map(([mask, cells]) => `${digitList(mask)} from ${cellsPhrase(cells)}`),
  );
}

/** The digits a set of pattern cells holds between them, as one mask. */
function unionOf(cells: readonly { mask: number }[]): number {
  return cells.reduce((mask, cell) => mask | cell.mask, 0);
}

const indexesOf = (cells: readonly { index: number }[]) => cells.map((cell) => cell.index);

// ---- Captions ---------------------------------------------------------------

/*
 * Each caption reads the facts from the trace — never from the stored board
 * by heart — so it always describes the diagram drawn beside it. The steps
 * they are given are the techniques' own, which is why fields a technique
 * always sets (a single's placement and unit, a step's digit) are taken as
 * set.
 */

function fullHouseCaption({ step }: TechniqueTrace): string {
  const unit = step.unit!;
  const { index, digit } = step.placement!;
  const name = describeUnit(unit);
  return (
    `${capitalise(name)} has one empty cell left, at ${withinPhrase(unit, [index])}, and one ` +
    `digit missing: ${digit}. So ${describePosition(index)} must be ${digit}.`
  );
}

/**
 * The placed copies of `digit` that rule out every other empty cell of
 * `unit`: a few, chosen greedily, each covering as many of the rest as it
 * can — the copies a player's eye would follow. Null when the copies alone
 * don't explain it: a cell some earlier step ruled out, which no placed copy
 * sees. The stored examples never need that (their candidates follow from
 * the placed digits), but a caption must not loop forever looking.
 */
function blockersOf(
  values: ArrayLike<number>,
  unit: Unit,
  target: number,
  digit: number,
): number[] | null {
  let open = unitCells(unit).filter((i) => i !== target && values[i] === 0);
  const copies = Array.from({ length: 81 }, (_, i) => i).filter((i) => values[i] === digit);
  const chosen: number[] = [];
  while (open.length > 0) {
    let best = -1;
    let bestCover = 0;
    for (const copy of copies) {
      const cover = open.filter((i) => isPeer(i, copy)).length;
      if (cover > bestCover) [best, bestCover] = [copy, cover];
    }
    if (best === -1) return null;
    chosen.push(best);
    open = open.filter((i) => !isPeer(i, best));
  }
  return chosen.sort((a, b) => a - b);
}

function hiddenSingleCaption({ step, values, candidates }: TechniqueTrace): string {
  const unit = step.unit!;
  const { index, digit } = step.placement!;
  const name = describeUnit(unit);
  const blockers = blockersOf(values, unit, index, digit);
  const reason =
    blockers === null
      ? `No other empty cell in ${name} can be ${aDigit(digit)},`
      : `Every other empty cell in ${name} already sees ${
          blockers.length === 1
            ? `the ${digit} at ${describePosition(blockers[0])},`
            : `${aDigit(digit)} — at ${blockers.map(describePosition).join(' or ')} —`
        }`;
  let caption = `${reason} so ${name}'s ${digit} can only go in ${describePosition(index)}.`;
  if (unit.kind !== 'box') {
    const box: Unit = { kind: 'box', index: BOX[index] };
    const places = unitCells(box).filter((i) => candidates[i] & bit(digit)).length;
    if (places > 1) {
      caption +=
        ` ${capitalise(describeUnit(box))} still has ${NUMBER_WORD[places]} places for ` +
        `${aDigit(digit)}, so only the ${unit.kind} gives it away.`;
    }
  }
  return caption;
}

function nakedSingleCaption({ step, values }: TechniqueTrace): string {
  const { index, digit } = step.placement!;
  const seen = new Set<number>();
  const groups: string[] = [];
  const houses: [string, (i: number) => boolean][] = [
    ['row', (i) => ROW[i] === ROW[index]],
    ['column', (i) => COL[i] === COL[index]],
    ['box', (i) => BOX[i] === BOX[index]],
  ];
  for (const [kind, isIn] of houses) {
    const fresh = new Set<number>();
    for (let i = 0; i < 81; i++) {
      if (isIn(i) && values[i] !== 0 && !seen.has(values[i])) fresh.add(values[i]);
    }
    for (const d of fresh) seen.add(d);
    if (fresh.size > 0) {
      groups.push(`${joinList([...fresh].sort((a, b) => a - b).map(String))} in its ${kind}`);
    }
  }
  return (
    `${capitalise(describePosition(index))} already sees every digit but ${digit}: ` +
    `${groups.slice(0, -1).join('; ')}${groups.length > 1 ? '; and ' : ''}${groups.at(-1)}. ` +
    `So ${digit} is all it can be.`
  );
}

/** Pointing and claiming: the same sentences, with the box and the line the other way round. */
function lockedCaption({ step }: TechniqueTrace): string {
  const [from, into] = step.houses;
  const digit = step.digit!;
  const cells = indexesOf(step.pattern);
  const line = from.kind === 'box' ? into : from;
  const [fromName, intoName] = [describeUnit(from), describeUnit(into)];
  return (
    `In ${fromName}, the only places left for ${aDigit(digit)} are in ${intoName}, at ` +
    `${withinPhrase(line, cells)}. ${capitalise(fromName)}'s ${digit} must be one of them, ` +
    `and so it is also ${intoName}'s ${digit}: no other cell in ${intoName} can be ` +
    `${aDigit(digit)}. Remove it from ${cellsPhrase(indexesOf(step.eliminations))}.`
  );
}

function nakedPairCaption({ step }: TechniqueTrace): string {
  const unit = step.unit!;
  const name = describeUnit(unit);
  const [a, b] = digitsOf(unionOf(step.pattern));
  return (
    `In ${name}, ${withinPhrase(unit, indexesOf(step.pattern))} can each only be ${a} or ${b}. ` +
    `One is the ${a} and the other the ${b}, so no other cell in ${name} can be either: ` +
    `remove ${removals(step.eliminations)}.`
  );
}

function nakedTripleCaption({ step }: TechniqueTrace): string {
  const unit = step.unit!;
  const name = describeUnit(unit);
  const digits = digitList(unionOf(step.pattern));
  const sets = joinClauses(step.pattern.map((cell) => orList(cell.mask)));
  const hasAll = step.pattern.some((cell) => POPCOUNT[cell.mask] === 3);
  return (
    `In ${name}, ${withinPhrase(unit, indexesOf(step.pattern))} can only be ${sets}: three ` +
    `cells with just ${digits} between them${hasAll ? '' : ', though none can be all three'}. ` +
    `Whatever order they go in, those cells take ${name}'s ${digits}, so remove ` +
    `${removals(step.eliminations)}.`
  );
}

function hiddenSubsetCaption({ step }: TechniqueTrace): string {
  const unit = step.unit!;
  const name = describeUnit(unit);
  const digits = digitList(unionOf(step.pattern));
  const count = NUMBER_WORD[step.pattern.length];
  const eliminations = step.eliminations;
  const isSameEverywhere =
    eliminations.length === step.pattern.length &&
    eliminations.every((e) => e.mask === eliminations[0].mask);
  const removed = isSameEverywhere
    ? `${digitList(eliminations[0].mask)} from ${step.pattern.length === 2 ? 'both' : `all ${count}`}`
    : removals(eliminations);
  return (
    `In ${name}, the ${digits} can only go in ${withinPhrase(unit, indexesOf(step.pattern))}. ` +
    `Those ${count} cells must hold the ${digits}, one each, so nothing else fits in them: ` +
    `remove ${removed}.`
  );
}

function fishCaption({ step }: TechniqueTrace): string {
  const digit = step.digit!;
  const size = step.houses.length / 2;
  const base = step.houses.slice(0, size);
  const cover = step.houses.slice(size);
  const baseKind = base[0].kind;
  const coverKind = cover[0].kind;
  const indexes = (units: readonly Unit[]) => units.map((unit) => unit.index);
  return (
    `In ${numbered(baseKind, indexes(base))}, the ${digit} can only go in ` +
    `${numbered(coverKind, indexes(cover))}. Each ${baseKind}'s ${digit} is in one of those ` +
    `${coverKind}s, and ${size === 2 ? `the two ${baseKind}s can't` : `no two ${baseKind}s can`} ` +
    `use the same one, so they take the ${digit}s of ` +
    `${size === 2 ? 'both' : `all ${NUMBER_WORD[size]}`} ${coverKind}s between them. ` +
    `Remove ${digit} from the rest of those ${coverKind}s: ` +
    `${cellsPhrase(indexesOf(step.eliminations))}.`
  );
}

/** XY-Wing and XYZ-Wing: whichever digit the pivot takes, one of the cells is the eliminated one. */
function wingCaption({ step }: TechniqueTrace): string {
  const [pivot, ...pincers] = step.pattern;
  const z = digitsOf(step.eliminations[0].mask)[0];
  const cases = pincers.map(
    (pincer) =>
      `if it's ${digitsOf(pincer.mask & pivot.mask & ~bit(z))[0]}, the pincer at ` +
      `${describePosition(pincer.index)} must be ${z}`,
  );
  const isXyz = (pivot.mask & bit(z)) !== 0;
  if (isXyz) cases.push(`otherwise it's ${z} itself`);
  return (
    `The pivot, ${describePosition(pivot.index)}, can only be ${orList(pivot.mask)}. ` +
    `${capitalise(cases.join('; '))}. Either way ` +
    `${isXyz ? 'one of the three is' : 'one pincer is'} ${z}, so a cell that sees ` +
    `${isXyz ? 'all three' : 'both'} can't be: remove ${z} from ` +
    `${cellsPhrase(indexesOf(step.eliminations))}.`
  );
}

// ---- Entries ----------------------------------------------------------------

/** An entry whose title is its technique's label, capitalised, as hints word it. */
function entry(
  id: GuideId,
  examples: readonly GuideExampleSpec[],
  content: Omit<GuideEntry, 'id' | 'title' | 'examples'>,
): GuideEntry {
  return { id, title: capitalise(TECHNIQUE_LABEL[examples[0].technique]), examples, ...content };
}

const only = (technique: TechniqueId): readonly GuideExampleSpec[] => [{ technique, label: null }];

/** Every entry, by id. */
export const GUIDE: Readonly<Record<GuideId, GuideEntry>> = {
  fullHouse: entry('fullHouse', only('fullHouse'), {
    aka: ['last free cell', 'last digit'],
    summary: 'A row, column or box with one empty cell left takes the one digit it is missing.',
    explanation: [
      'Every row, column and box holds each digit once. Once eight are in, the ninth has ' +
        "exactly one cell to go in — there's nothing more to it.",
      "It's the simplest step in Sudoku, and the one that finishes every puzzle: each digit " +
        'you place leaves its row, column and box one cell closer to full.',
    ],
    spot:
      'Look for a row, column or box with a single gap, then work out the digit it lacks. ' +
      'They turn up more and more towards the end, often in a run: filling one can leave ' +
      'another row, column or box one short.',
    caption: fullHouseCaption,
  }),

  hiddenSingle: entry(
    'hiddenSingle',
    [
      { technique: 'hiddenSingleBox', label: 'In a box' },
      { technique: 'hiddenSingleLine', label: 'In a row or column' },
    ],
    {
      aka: ['last remaining cell', 'last possible place', 'pinned digit'],
      summary:
        'A digit with only one place left in a row, column or box goes there, whatever else ' +
        'that cell could be.',
      explanation: [
        'Pick a digit and a box. A cell “sees” every other cell in its row, column and box, ' +
          "and can't hold a digit it sees. So follow each copy of the digit already placed " +
          "through the box: if every empty cell but one sees a copy, the box's copy must go " +
          'in that one.',
        "It's called hidden because the cell itself may still look open — several digits " +
          'could fit it, as far as its own row, column and box are concerned. The answer ' +
          'comes from the digit having nowhere else to go.',
        `The same works along a row or column. In a box it counts as ` +
          `${tierOf('hiddenSingleBox')}: nine cells close together, quick to take in at a ` +
          `glance. Along a line it counts as ${tierOf('hiddenSingleLine')}: the cells are spread ` +
          `across three boxes, and the cell's own box usually still has other places for the ` +
          `digit — as in the second example.`,
      ],
      spot:
        "Work one digit at a time, starting with one that is placed often. Trace each copy's " +
        'row and column through the boxes that lack it (cross-hatching) and look for a box ' +
        'with a single gap left. Then try the same along rows and columns that are nearly ' +
        'full.',
      caption: hiddenSingleCaption,
    },
  ),

  nakedSingle: entry('nakedSingle', only('nakedSingle'), {
    aka: ['sole candidate', 'singleton', 'last possible number'],
    summary:
      'A cell that already sees eight different digits in its row, column and box can only ' +
      'be the ninth.',
    explanation: [
      'Rather than asking where a digit can go, ask what a cell can be. A cell “sees” every ' +
        'other cell in its row, column and box, and every digit it sees is ruled out. When ' +
        'eight are ruled out, the one left is the answer.',
      `It counts as ${tierOf('nakedSingle')} because it means holding twenty other cells in ` +
        "mind at once. With candidates pencilled in, it's the easiest thing on the board to " +
        'see: a cell with just one.',
    ],
    spot:
      'With candidates on, look for a cell with a single one left. Without them, try the ' +
      'cells where a busy row, a busy column and a busy box meet.',
    caption: nakedSingleCaption,
  }),

  pointing: entry('pointing', only('pointing'), {
    aka: ['locked candidates (pointing)'],
    summary:
      'When every place left for a digit in a box lies on one row or column, the rest of that ' +
      "line can't have it.",
    explanation: [
      'The box must have the digit somewhere, and every cell that could take it is on the ' +
        "same line. So wherever it goes, that line's copy of the digit is inside the box — and " +
        "the line's cells outside the box can lose it as a candidate.",
      'Two cells make a pointing pair, three a pointing triple. It places nothing by itself; ' +
        'it clears candidates, often the very ones that were hiding a single.',
      'Pointing and its mirror image, box/line reduction, are the two kinds of locked ' +
        'candidates (also called box/line interactions): a box and a line that cross, where ' +
        "a digit's places in one all fall in the other.",
    ],
    spot:
      'Take one digit and look at each box: if its candidates there sit on a single row or ' +
      'column, follow that line out of the box and strike the digit from it.',
    caption: lockedCaption,
  }),

  claiming: entry('claiming', only('claiming'), {
    aka: ['claiming', 'locked candidates (claiming)'],
    summary:
      'When every place left for a digit in a row or column lies in one box, the rest of that ' +
      "box can't have it.",
    explanation: [
      "It's a pointing pair turned round. The row must have the digit somewhere, and every " +
        "cell that could take it is in the same box. So wherever it goes, the box's copy of " +
        "the digit is on that row — and the box's other cells can lose it as a candidate.",
      'The same goes for a column, and for two or three cells. With pointing, it is one of ' +
        'the two kinds of locked candidates (or box/line interactions).',
    ],
    spot:
      'Take one digit and run along each row and column: if its candidates are bunched into ' +
      'the three cells where the line crosses one box, strike the digit from the rest of that ' +
      'box.',
    caption: lockedCaption,
  }),

  nakedPair: entry('nakedPair', only('nakedPair'), {
    aka: [],
    summary:
      'Two cells in a row, column or box with the same two candidates, and no others, take ' +
      'those two digits between them.',
    explanation: [
      'If two cells can each only be 6 or 8, one of them is the 6 and the other the 8. You ' +
        "can't yet tell which way round, but you know both digits are spoken for — so no other " +
        'cell in that row, column or box can have either.',
      'A pair that shares a box as well as a line (sometimes called a locked pair) clears ' +
        'both.',
    ],
    spot:
      'With candidates on, look for two cells in the same row, column or box showing the ' +
      'same two digits and nothing else.',
    caption: nakedPairCaption,
  }),

  hiddenPair: entry('hiddenPair', only('hiddenPair'), {
    aka: [],
    summary:
      'Two digits that fit only the same two cells of a row, column or box claim those cells: ' +
      'their other candidates can go.',
    explanation: [
      'If 5 and 7 can only go in the same two cells of a row, those cells must be the 5 and ' +
        'the 7, one each. That leaves no room for anything else in them, so every other ' +
        'candidate in those two cells can be struck out.',
      "It's the mirror image of a naked pair, and becomes one once it's cleared: it's " +
        "called hidden only because the pair's cells are cluttered with other candidates.",
    ],
    spot:
      'Look along a row, column or box for two digits that each have exactly two places — ' +
      'the same two places.',
    caption: hiddenSubsetCaption,
  }),

  nakedTriple: entry('nakedTriple', only('nakedTriple'), {
    aka: [],
    summary:
      'Three cells in a row, column or box whose candidates, taken together, are just three ' +
      'digits take all three between them.',
    explanation: [
      'Three cells, three digits: whatever order they go in, those digits are used up in that ' +
        'row, column or box, so no other cell in it can have them.',
      "The cells don't each need all three digits. Cells that can be 3 or 5, 1 or 5, and 1 " +
        'or 3 make a naked triple too — the hardest kind to notice, as in the example.',
    ],
    spot:
      'Look along a row, column or box for three cells with only two or three candidates ' +
      'each, all drawn from the same three digits.',
    caption: nakedTripleCaption,
  }),

  hiddenTriple: entry('hiddenTriple', only('hiddenTriple'), {
    aka: [],
    summary:
      'Three digits that fit only the same three cells of a row, column or box claim those ' +
      'cells: their other candidates can go.',
    explanation: [
      'If 6, 8 and 9 can only go in the same three cells of a column, those cells must hold ' +
        'them, one each — so any other candidate in those cells is wrong.',
      "Each digit needn't fit all three cells; between them, they just mustn't fit anywhere " +
        'else in that row, column or box.',
    ],
    spot:
      'The hardest of the four to see. Along a row, column or box, look for three digits ' +
      'with only two or three places each, all within the same three cells.',
    caption: hiddenSubsetCaption,
  }),

  xWing: entry('xWing', only('xWing'), {
    aka: [],
    summary:
      'When a digit has just two places in each of two rows, in the same two columns, the rest ' +
      "of those columns can't have it.",
    explanation: [
      'Each of the two rows must have its copy of the digit in one of the two columns. If the ' +
        "top row's is on the left, the bottom row's is on the right, and the other way about " +
        'too: the copies sit on opposite corners of a rectangle. Either way, both columns get ' +
        'their copy from these two rows — so no other cell in those columns can have it.',
      'It works with rows and columns swapped. The lines you start from are the base; the ' +
        'lines you clear are the cover.',
    ],
    spot:
      'Pick a digit and look for rows (or columns) where it has exactly two places. Two of ' +
      'them whose places line up in the same two columns make an X-Wing.',
    caption: fishCaption,
  }),

  swordfish: entry('swordfish', only('swordfish'), {
    aka: [],
    summary:
      "An X-Wing on three lines: when a digit's places in three rows all fall in the same " +
      "three columns, the rest of those columns can't have it.",
    explanation: [
      'Each of the three rows has its copy of the digit in one of the three columns, and no ' +
        "two rows can use the same column. So the three rows fill all three columns' copies " +
        'between them, and the rest of those columns can lose the digit.',
      "A row may have two places or three; it's the three columns between them that " +
        'matter. As with an X-Wing, rows and columns can swap roles.',
    ],
    spot:
      'Hard to see by eye. With one digit in mind, find the rows where it has only two or ' +
      'three places, and look for three whose places all fall within the same three columns.',
    caption: fishCaption,
  }),

  xyWing: entry('xyWing', only('xyWing'), {
    aka: ['Y-Wing'],
    summary:
      'Three two-candidate cells — a pivot and two pincers — that force a digit into one of ' +
      "the pincers, so a cell that sees both pincers can't have it.",
    explanation: [
      'The pivot can be one of two digits, say 5 or 7. One pincer, which sees the pivot, is ' +
        '5 or 3; the other, which also sees it, is 7 or 3. If the pivot is 5, the first ' +
        "pincer is 3; if it's 7, the second pincer is 3. Either way one pincer is a 3 — so " +
        "any cell that sees both of them can't be.",
      'The pincers must hang off different digits of the pivot: if both were 5 or 3, a pivot ' +
        'of 7 would force neither, and nothing would follow.',
      'The cells that lose the digit are the ones both pincers see — often just one, at the ' +
        'fourth corner of a rectangle with the pivot, as in the example.',
    ],
    spot:
      'Look for cells with exactly two candidates. Find one, the pivot, that sees two others: ' +
      "one shares one of the pivot's digits, the other its other digit, and both share a " +
      'third digit the pivot lacks. Then strike that third digit from every cell that sees ' +
      'both pincers.',
    caption: wingCaption,
  }),

  xyzWing: entry('xyzWing', only('xyzWing'), {
    aka: [],
    summary:
      'An XY-Wing whose pivot can also be the shared digit: one of the three cells must be ' +
      "it, so a cell that sees all three can't.",
    explanation: [
      'The pivot has three candidates — 3, 8 and 9, say — and each pincer two of them: 8 or 9, ' +
        "and 3 or 9. If the pivot is 8, the first pincer is 9; if it's 3, the second is; " +
        'otherwise the pivot is 9 itself. One of the three cells is the 9, so a cell that ' +
        "sees all three can't be.",
      'As with an XY-Wing, the pincers must be different pairs: if both were 8 or 9, a pivot ' +
        'of 3 would force neither.',
      'Because the pivot has to be seen too, the cells that lose the digit are few — usually ' +
        "one or two, in the pivot's own box.",
    ],
    spot:
      'Look for a cell with three candidates, the pivot, that sees two two-candidate cells: ' +
      "two different pairs of the pivot's digits, both including the same one. Strike that " +
      'digit from the cells that see all three.',
    caption: wingCaption,
  }),
};

// ---- Examples ---------------------------------------------------------------

/** A worked example ready to draw: the trace, and the words for it. */
export interface GuideExample extends GuideExampleSpec {
  trace: TechniqueTrace;
  caption: string;
}

const traces = new Map<TechniqueId, TechniqueTrace>();

/** The stored example for a technique, traced once and kept: the board never changes. */
function exampleTrace(technique: TechniqueId): TechniqueTrace {
  let trace = traces.get(technique);
  if (trace === undefined) {
    trace = techniqueExample(technique);
    traces.set(technique, trace);
  }
  return trace;
}

/** An entry's worked examples, traced and captioned. */
export function guideExamples(id: GuideId): GuideExample[] {
  const { examples, caption } = GUIDE[id];
  return examples.map((spec) => {
    const trace = exampleTrace(spec.technique);
    return { ...spec, trace, caption: caption(trace) };
  });
}

/** One tier an entry belongs to, with what puts it there when an entry spans two. */
export interface GuideTier {
  difficulty: Difficulty;
  /** "In a box" — null when the entry has one tier. */
  label: string | null;
}

/**
 * The tiers an entry's techniques belong to, from the grader's own table:
 * one for most entries, two for the hidden single, which is Easy in a box and
 * Medium along a line.
 */
export function guideTiers(id: GuideId): GuideTier[] {
  const { examples } = GUIDE[id];
  const tiers = [...new Set(examples.map((spec) => TECHNIQUE_TIER[spec.technique]))];
  if (tiers.length === 1) return [{ difficulty: tiers[0], label: null }];
  return examples.map((spec) => ({
    difficulty: TECHNIQUE_TIER[spec.technique],
    label: spec.label,
  }));
}

/** The easiest tier an entry belongs to: where the guide lists it. */
export function guideTier(id: GuideId): Difficulty {
  return guideTiers(id)[0].difficulty;
}
