import {
  BOX,
  COL,
  MAX_CHAIN_STRONG_LINKS,
  MAX_XY_CHAIN,
  POPCOUNT,
  ROW,
  TECHNIQUE_TIER,
  bit,
  computeCandidates,
  digitsOf,
  isPeer,
  reliance,
  techniqueExample,
  unitCells,
  type Difficulty,
  type Elimination,
  type SolveStep,
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
 *
 * The same captions walk through "Show me" (see `walkthroughCaption`), where
 * a step can rest on candidates that earlier steps of the walkthrough ruled
 * out — which no placed digit explains, so the caption credits the step —
 * or that the player had ruled out before it began: a walkthrough starts
 * from the player's own candidates.
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
  | 'xyzWing'
  | 'skyscraper'
  | 'twoStringKite'
  | 'xyChain'
  | 'wWing'
  | 'alternatingChain';

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
  /** The worked example walked through in words, from the trace it was drawn from (see `Caption`). */
  caption: Caption;
}

/**
 * A step walked through in words, from the trace it was drawn from. Given
 * `earlier` — the steps before it in a walkthrough — it credits them with
 * what it relies on having been ruled out ("Step 1 removed 5 from row 4,
 * column 6."), and given `yours`, the player with what they had ruled out
 * themselves ("You'd already ruled out 2 from …"; see `ruledOutByYou`).
 * Without them, as in the guide, the placed digits explain every candidate.
 */
export type Caption = (
  trace: TechniqueTrace,
  earlier?: readonly TechniqueTrace[],
  yours?: readonly Elimination[],
) => string;

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
  'skyscraper',
  'twoStringKite',
  'xyChain',
  'wWing',
  'alternatingChain',
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
  skyscraper: 'skyscraper',
  twoStringKite: 'twoStringKite',
  xyChain: 'xyChain',
  wWing: 'wWing',
  alternatingChain: 'alternatingChain',
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

/** "step 2", "steps 1 and 3": walkthrough steps by index, counted from one. */
function stepsPhrase(steps: readonly number[]): string {
  return `step${steps.length === 1 ? '' : 's'} ${joinList(steps.map((k) => String(k + 1)))}`;
}

/** The earlier steps, by index, that removed any of `mask` from any of `cells`. */
function stepsRemoving(
  earlier: readonly TechniqueTrace[],
  cells: readonly number[],
  mask: number,
): number[] {
  return earlier.flatMap(({ step }, k) =>
    step.eliminations.some((e) => cells.includes(e.index) && (e.mask & mask) !== 0) ? [k] : [],
  );
}

/** What one earlier step of a walkthrough removed that a later step relies on. */
export interface Credit {
  /** The earlier step, by index from 0. */
  step: number;
  /** What it removed that the later step relies on having gone. */
  eliminations: Elimination[];
}

/**
 * What earlier steps of a walkthrough removed that `step` relies on having
 * been ruled out (see `reliance`), step by step: the candidates it treats
 * as gone that no placed digit explains. None in the guide, whose examples'
 * candidates follow from the placed digits alone.
 */
export function creditsFor(step: SolveStep, earlier: readonly TechniqueTrace[]): Credit[] {
  if (earlier.length === 0) return [];
  const needed = new Uint16Array(81);
  for (const { index, mask } of reliance(step).absent) needed[index] |= mask;
  return earlier.flatMap((trace, k) => {
    const eliminations = trace.step.eliminations
      .map(({ index, mask }) => ({ index, mask: mask & needed[index] }))
      .filter(({ mask }) => mask !== 0);
    return eliminations.length === 0 ? [] : [{ step: k, eliminations }];
  });
}

/**
 * What a step of a walkthrough relies on having been ruled out (see
 * `reliance`) that the player had ruled out themselves before it began:
 * candidates missing from `first` — the walkthrough's first step, whose
 * board is the player's own candidates — that no placed digit explains,
 * then or at this step. (The steps only ever remove what that board has,
 * so nothing here is theirs.) None in the guide, whose examples are not
 * the player's.
 */
export function ruledOutByYou(trace: TechniqueTrace, first: TechniqueTrace): Elimination[] {
  const computed = computeCandidates(trace.values);
  const gone = new Uint16Array(81);
  for (const { index, mask } of reliance(trace.step).absent) {
    gone[index] |= mask & computed[index] & ~first.candidates[index];
  }
  return Array.from(gone, (mask, index) => ({ index, mask })).filter(({ mask }) => mask !== 0);
}

/**
 * The earlier steps a step relies on (see `creditsFor`), a sentence each:
 * "Step 1 removed 5 from row 4, column 6." — and what the player had ruled
 * out themselves (see `ruledOutByYou`): "You'd already ruled out 2 from
 * column 9, rows 8 and 9." The diagram shows the candidate gone; this says
 * where it went.
 */
function credits(
  step: SolveStep,
  earlier: readonly TechniqueTrace[],
  yours: readonly Elimination[],
): string {
  const sentences = creditsFor(step, earlier).map(
    (credit) => `Step ${credit.step + 1} removed ${removals(credit.eliminations)}.`,
  );
  if (yours.length > 0) sentences.push(`You'd already ruled out ${removals(yours)}.`);
  return sentences.join(' ');
}

/**
 * A caption for a step that removes candidates, led by the earlier steps it
 * relies on and what the player had ruled out (see `credits`). The singles
 * credit them in their own words.
 */
function credited(caption: (trace: TechniqueTrace) => string): Caption {
  return (trace, earlier = [], yours = []) =>
    [credits(trace.step, earlier, yours), caption(trace)].filter((part) => part !== '').join(' ');
}

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
 * The placed copies of `digit` that rule out the other empty cells of
 * `unit`: a few, chosen greedily, each covering as many of the rest as it
 * can — the copies a player's eye would follow — and the cells no copy
 * sees, which some earlier step ruled out. The guide's examples never have
 * any of those (their candidates follow from the placed digits); a
 * walkthrough's can.
 */
function blockersOf(
  values: ArrayLike<number>,
  unit: Unit,
  target: number,
  digit: number,
): { blockers: number[]; unseen: number[] } {
  const copies = Array.from({ length: 81 }, (_, i) => i).filter((i) => values[i] === digit);
  const empty = unitCells(unit).filter((i) => i !== target && values[i] === 0);
  const unseen = empty.filter((i) => !copies.some((copy) => isPeer(i, copy)));
  let open = empty.filter((i) => !unseen.includes(i));
  const blockers: number[] = [];
  while (open.length > 0) {
    let best = copies[0];
    let bestCover = 0;
    for (const copy of copies) {
      const cover = open.filter((i) => isPeer(i, copy)).length;
      if (cover > bestCover) [best, bestCover] = [copy, cover];
    }
    blockers.push(best);
    open = open.filter((i) => !isPeer(i, best));
  }
  return { blockers: blockers.sort((a, b) => a - b), unseen };
}

/**
 * Why no other empty cell of a hidden single's house can take its digit,
 * when the player had ruled the digit out of some of them (`yours`) — the
 * placed copies they see, the steps they lost it in, and the player, as
 * there are any of each — or null when the player had ruled out none.
 */
function hiddenReasonWithYours(
  name: string,
  digit: number,
  blockers: readonly number[],
  copies: string,
  unseen: readonly number[],
  earlier: readonly TechniqueTrace[],
  yours: readonly Elimination[],
): string | null {
  const mine = unseen.filter((i) => yours.some((e) => e.index === i && e.mask & bit(digit)));
  if (mine.length === 0) return null;
  const rest = unseen.filter((i) => !mine.includes(i));
  const lostIn = stepsRemoving(earlier, rest, bit(digit));
  // Some cell neither a copy, a step nor the player explains: said plainly.
  if (rest.length > 0 && lostIn.length === 0) {
    return `No other empty cell in ${name} can be ${aDigit(digit)},`;
  }
  const clauses = [
    ...(blockers.length > 0 ? [`sees ${copies}`] : []),
    ...(lostIn.length > 0 ? [`lost its ${digit} in ${stepsPhrase(lostIn)}`] : []),
    `had its ${digit} ruled out by you`,
  ];
  if (clauses.length === 1) {
    return `You'd already ruled out ${digit} from every other empty cell in ${name},`;
  }
  const either = `${clauses.slice(0, -1).join(', ')} or ${clauses.at(-1)}`;
  return `Every other empty cell in ${name} either ${either},`;
}

function hiddenSingleCaption(
  { step, values, candidates }: TechniqueTrace,
  earlier?: readonly TechniqueTrace[],
  yours: readonly Elimination[] = [],
): string {
  const unit = step.unit!;
  const { index, digit } = step.placement!;
  const name = describeUnit(unit);
  const { blockers, unseen } = blockersOf(values, unit, index, digit);
  const copies =
    blockers.length === 1
      ? `the ${digit} at ${describePosition(blockers[0])}`
      : `${aDigit(digit)} — at ${blockers.map(describePosition).join(' or ')} —`;
  const lostIn = stepsRemoving(earlier ?? [], unseen, bit(digit));
  const lost = `lost its ${digit} in ${stepsPhrase(lostIn)},`;
  const theirs = hiddenReasonWithYours(name, digit, blockers, copies, unseen, earlier ?? [], yours);
  let reason: string;
  if (theirs !== null) {
    reason = theirs;
  } else if (unseen.length === 0) {
    reason = `Every other empty cell in ${name} already sees ${copies}${blockers.length === 1 ? ',' : ''}`;
  } else if (lostIn.length === 0) {
    // No walkthrough to credit: said plainly.
    reason = `No other empty cell in ${name} can be ${aDigit(digit)},`;
  } else if (blockers.length === 0) {
    reason = `Every other empty cell in ${name} ${lost}`;
  } else {
    reason = `Every other empty cell in ${name} either sees ${copies} or ${lost}`;
  }
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

function nakedSingleCaption(
  { step, values }: TechniqueTrace,
  earlier?: readonly TechniqueTrace[],
  yours: readonly Elimination[] = [],
): string {
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
  const position = capitalise(describePosition(index));
  const sees = `${groups.slice(0, -1).join('; ')}${groups.length > 1 ? '; and ' : ''}${groups.at(-1)}`;
  // What the cell sees is not everything it has lost when earlier steps of a
  // walkthrough struck candidates from it, or the player had: each says which.
  const missing = 0x1ff & ~bit(digit) & ~[...seen].reduce((mask, d) => mask | bit(d), 0);
  if (missing === 0) {
    return `${position} already sees every digit but ${digit}: ${sees}. So ${digit} is all it can be.`;
  }
  const struck = (earlier ?? []).flatMap(({ step: before }, k) => {
    const mask =
      before.eliminations.reduce((all, e) => (e.index === index ? all | e.mask : all), 0) & missing;
    return mask === 0 ? [] : [`Step ${k + 1} ruled out its ${digitList(mask)}.`];
  });
  const mine = yours.reduce((all, e) => (e.index === index ? all | e.mask : all), 0) & missing;
  if (mine !== 0) struck.push(`You'd already ruled out its ${digitList(mine)}.`);
  const lost =
    struck.length > 0 ? struck.join(' ') : `Earlier steps ruled out its ${digitList(missing)}.`;
  return [
    groups.length > 0 ? `${position} sees ${sees}.` : '',
    lost,
    `So ${digit} is all it can be.`,
  ]
    .filter((part) => part !== '')
    .join(' ');
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

/**
 * Skyscraper: a chain of four cells, read from one top to the other — each
 * line's two places for the digit, joined by the cross line through the
 * bases.
 */
function skyscraperCaption({ step }: TechniqueTrace): string {
  const digit = step.digit!;
  const [first, second, cross] = step.houses;
  const [top1, base1, base2, top2] = indexesOf(step.pattern);
  const [name1, name2] = [describeUnit(first), describeUnit(second)];
  return (
    `${capitalise(name1)}'s ${digit} can only go in ${withinPhrase(first, [top1, base1])}, and ` +
    `${name2}'s in ${withinPhrase(second, [base2, top2])}. ${capitalise(describeUnit(cross))} ` +
    `can't hold both ${first.kind}s' ${digit}s, so at least one of them is in its other place: ` +
    `${name1}'s at ${withinPhrase(first, [top1])}, or ${name2}'s at ` +
    `${withinPhrase(second, [top2])}. Either way one of those two cells is ${aDigit(digit)}, ` +
    `so a cell that sees both can't be: remove ${digit} from ` +
    `${cellsPhrase(indexesOf(step.eliminations))}.`
  );
}

/**
 * 2-String Kite: a chain of four cells, read from the row's far end to the
 * column's — the row's two places for the digit, joined in the box to the
 * column's.
 */
function kiteCaption({ step }: TechniqueTrace): string {
  const digit = step.digit!;
  const [row, column, box] = step.houses;
  const [rowEnd, rowIn, columnIn, columnEnd] = indexesOf(step.pattern);
  const [rowName, columnName] = [describeUnit(row), describeUnit(column)];
  return (
    `${capitalise(rowName)}'s ${digit} can only go in ${withinPhrase(row, [rowEnd, rowIn])}, ` +
    `and ${columnName}'s in ${withinPhrase(column, [columnIn, columnEnd])}. Their cells in ` +
    `${describeUnit(box)} — ${describePosition(rowIn)} and ${describePosition(columnIn)} — ` +
    `can't both be ${digit}s, so either ${rowName}'s ${digit} is at ` +
    `${withinPhrase(row, [rowEnd])}, or ${columnName}'s is at ` +
    `${withinPhrase(column, [columnEnd])}. Either way one of those two cells is ` +
    `${aDigit(digit)}, so a cell that sees both can't be: remove ${digit} from ` +
    `${cellsPhrase(indexesOf(step.eliminations))}.`
  );
}

/**
 * XY-Chain: its cells end to end, each with its two candidates, and what
 * each must be if the first end isn't the chain's digit.
 */
function xyChainCaption({ step }: TechniqueTrace): string {
  const digit = step.digit!;
  const [first, ...rest] = step.pattern;
  // What each cell must be if the first isn't the digit: whatever the cell
  // before would leave it.
  let carried = bit(digit);
  const forced = step.pattern.map(({ mask }) => (carried = mask & ~carried));
  const later = joinClauses(
    rest.map((cell) => `${describePosition(cell.index)} (${orList(cell.mask)})`),
  );
  const then = joinClauses(
    rest.map((cell, k) => `${describePosition(cell.index)} must be ${digitsOf(forced[k + 1])[0]}`),
  );
  return (
    `${capitalise(describePosition(first.index))} can only be ${orList(first.mask)}, and each ` +
    `cell after it — ${later} — sees the one before and shares a digit with it. If ` +
    `${describePosition(first.index)} isn't ${digit}, it's ${digitsOf(forced[0])[0]}; then ` +
    `${then}. So one end of the chain or the other is ${aDigit(digit)}, and a cell that sees ` +
    `both can't be: remove ${digit} from ${cellsPhrase(indexesOf(step.eliminations))}.`
  );
}

/** W-Wing: the two cells, the house that joins them, and which of its places each sees. */
function wWingCaption({ step }: TechniqueTrace): string {
  const digit = step.digit!;
  const [house] = step.houses;
  const [first, near, far, second] = step.pattern;
  const [y] = digitsOf(near.mask);
  const [a, b] = [describePosition(first.index), describePosition(second.index)];
  return (
    `${capitalise(a)} and ${b} can each only be ${orList(first.mask)}. ` +
    `${capitalise(describeUnit(house))}'s ${y} can only go in ` +
    `${withinPhrase(house, [near.index, far.index])}: ${describePosition(near.index)}, which ` +
    `${a} sees, or ${describePosition(far.index)}, which ${b} sees. Whichever it is, the cell ` +
    `that sees it can't be ${y}, so it's ${digit}. One of the two cells is ${aDigit(digit)}, ` +
    `so a cell that sees both can't be: remove ${digit} from ` +
    `${cellsPhrase(indexesOf(step.eliminations))}.`
  );
}

/**
 * Alternating chain: link by link, what each candidate must be if the first
 * end is wrong — each strong link with its reason, each weak link what it
 * rules out — then what the two ends rule out between them.
 */
function alternatingCaption({ step }: TechniqueTrace): string {
  const nodes = step.pattern.map(({ index, mask }) => ({ index, digit: digitsOf(mask)[0] }));
  const houses = [...step.houses];
  const strong = (k: number) => {
    const [a, b] = [nodes[k], nodes[k + 1]];
    if (a.index === b.index) return `it's ${b.digit}, its only other candidate`;
    return (
      `${describePosition(b.index)} is ${b.digit}, as ${describeUnit(houses.shift()!)} has no ` +
      `other place for ${aDigit(b.digit)}`
    );
  };
  const [first, last] = [nodes[0], nodes[nodes.length - 1]];
  let walk = `If ${describePosition(first.index)} isn't ${first.digit}, ${strong(0)}`;
  for (let k = 2; k < nodes.length; k += 2) {
    walk += `; so ${describePosition(nodes[k].index)} isn't ${nodes[k].digit}, and ${strong(k)}`;
  }
  const conclusion =
    first.digit === last.digit
      ? `So one end or the other is ${aDigit(first.digit)}, and a cell that sees both can't ` +
        `be: remove ${first.digit} from ${cellsPhrase(indexesOf(step.eliminations))}.`
      : `So either ${describePosition(first.index)} is ${first.digit} or ` +
        `${describePosition(last.index)} is ${last.digit}, and nothing that would rule out ` +
        `both can be right: remove ${removals(step.eliminations)}.`;
  return `${capitalise(walk)}. ${conclusion}`;
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
    caption: credited(lockedCaption),
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
    caption: credited(lockedCaption),
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
    caption: credited(nakedPairCaption),
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
    caption: credited(hiddenSubsetCaption),
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
    caption: credited(nakedTripleCaption),
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
    caption: credited(hiddenSubsetCaption),
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
    caption: credited(fishCaption),
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
    caption: credited(fishCaption),
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
    caption: credited(wingCaption),
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
    caption: credited(wingCaption),
  }),

  skyscraper: entry('skyscraper', only('skyscraper'), {
    aka: [],
    summary:
      'Two rows (or columns) that each have just two places for a digit, lined up at one end: ' +
      "one of the other two places must be the digit, so a cell that sees both can't.",
    explanation: [
      'Say columns 3 and 4 can each take their 7 in just two cells, and one of each pair is in ' +
        "row 2 — the base. Row 2 can't hold both 7s, so at least one column has its 7 in its " +
        "other cell, its top. You can't yet tell which, but one of the two tops is a 7 — so " +
        "any cell that sees both of them can't be.",
      "It's an X-Wing that doesn't quite line up: if the tops were in the same row as well, it " +
        'would be one. Out of line, they clear only the cells that see both — never more than ' +
        "four, all in the tops' boxes.",
      "It's also the simplest chain. A digit's last two places in a row, column or box make a " +
        "strong link: if one isn't the digit, the other is. Two cells that see each other make " +
        "a weak link: if one is the digit, the other isn't. Strong, weak, strong: if one top " +
        "isn't the 7, its base is, so the other base isn't, so the other top is. One end or " +
        'the other always is.',
    ],
    spot:
      'Pick a digit and find the rows where it has exactly two places. Two of them with one ' +
      'place in the same column, and the other two in different columns, make a Skyscraper: ' +
      'strike the digit from every cell that sees both of those other two. Then try the same ' +
      'with columns.',
    caption: credited(skyscraperCaption),
  }),

  twoStringKite: entry('twoStringKite', only('twoStringKite'), {
    aka: ['kite'],
    summary:
      'A row and a column that each have just two places for a digit, one of each in the same ' +
      "box: one of the other two places must be the digit, so a cell that sees both can't.",
    explanation: [
      'Say row 2 can take its 1 only in columns 6 and 7, and column 4 only in rows 3 and 4 — ' +
        "and two of those cells, one from each, are in box 2. They can't both be 1s, so at " +
        'least one of the row and the column has its 1 at its far end. One of the two far ' +
        "ends is a 1 — so any cell that sees both of them can't be.",
      'The row and the column are the strings: knotted together in the box, and flying out ' +
        "of it like a kite's. Their far ends are in different boxes, so only one cell that " +
        'could still be the digit sees both: where the row of one meets the column of the ' +
        'other.',
      "Like a Skyscraper, it's a chain of four: a strong link (the row's two places), a weak " +
        "link (the two cells in the box), and a strong link (the column's two places). If the " +
        "row's far end isn't the 1, the row's 1 is in the box, so the column's isn't, so the " +
        "column's far end is.",
    ],
    spot:
      'Pick a digit and look for a row and a column where it has exactly two places each. If ' +
      'one place of each falls in the same box, as different cells, and the other two are ' +
      'outside it, strike the digit from the cell in the row of one far end and the column of ' +
      'the other.',
    caption: credited(kiteCaption),
  }),

  xyChain: entry('xyChain', only('xyChain'), {
    aka: [],
    summary:
      'A chain of two-candidate cells, each seeing the next and sharing a digit with it, whose ' +
      "ends both hold one more digit: one end must be it, so a cell that sees both can't.",
    explanation: [
      "Take a cell that can only be 1 or 6. If it isn't 6, it's 1 — so a cell it sees that " +
        "can only be 1 or 3 isn't 1, and must be 3; a cell that one sees that can only be 3 or " +
        '8 must then be 8; and a cell after that which can only be 8 or 6 must be 6. If the ' +
        "first cell isn't 6, the last one is: one end or the other is a 6, so any cell that " +
        "sees both of them can't be.",
      'An XY-Wing is the shortest XY-Chain, three cells long; a chain just keeps going. Each ' +
        'cell is a strong link — one of its two digits must be right — and each hop to the ' +
        "next cell a weak link: two cells that see each other can't both be the digit they " +
        'share.',
      `The puzzles here never need one longer than ${NUMBER_WORD[MAX_XY_CHAIN]} cells: ` +
        'longer chains exist, but are hard to follow by eye.',
    ],
    spot:
      'With candidates on, look for cells with exactly two. Start at one, choose one of its ' +
      'digits for the end, and hop to a two-candidate cell it sees that shares its other ' +
      'digit, then on from there the same way, keeping track of what each would be. When you ' +
      'reach a cell that would be the digit you started with, strike that digit from every ' +
      'cell that sees both ends.',
    caption: credited(xyChainCaption),
  }),

  wWing: entry('wWing', only('wWing'), {
    aka: [],
    summary:
      'Two cells with the same two candidates, joined through a row, column or box where one ' +
      'of those digits has just two places: the other digit must be in one of the two cells, so ' +
      "a cell that sees both can't.",
    explanation: [
      "Say two cells that don't see each other can each only be 3 or 9, and column 7 has just " +
        "two places left for a 9, one seen by each cell. Column 7's 9 is in one of them, and " +
        "the cell that sees it can't be 9 — so it's 3. Either way one of the two cells is a 3, " +
        "so any cell that sees both of them can't be.",
      'Like an XY-Wing it has two pincers, the cells with the same two candidates; here they ' +
        'are joined by the two places for a digit, where an XY-Wing has a pivot. Read as a ' +
        "chain, it's a strong link in each pincer (one of its two digits), a strong link " +
        'between the two places, and a weak link from each place to the pincer that sees it.',
      "If the two cells saw each other, they'd be a naked pair, and clear both digits from " +
        'everywhere they both see.',
    ],
    spot:
      "Look for two cells with the same two candidates that don't see each other. For each " +
      'of the two digits, look for a row, column or box where it has just two places, one ' +
      'seen by each cell. Then strike the other digit from every cell that sees both of them.',
    caption: credited(wWingCaption),
  }),

  alternatingChain: entry('alternatingChain', only('alternatingChain'), {
    aka: ['alternating inference chain', 'AIC'],
    summary:
      'Candidates linked strongly and weakly in turn — through cells with two candidates and ' +
      'digits with two places — so that one end or the other must be right: anything that ' +
      'would rule out both can go.',
    explanation: [
      'Every chain in this guide is built from two kinds of link. A strong link joins two ' +
        'candidates of which at least one must be right: the two candidates of a cell that ' +
        'has only two, or the two places left for a digit in a row, column or box. A weak ' +
        "link joins two that can't both be right: two digits of the same cell, or the same " +
        'digit in two cells that see each other.',
      'Alternate them, strong at both ends, and if the first candidate is wrong, the next is ' +
        'right, so the one after is wrong, so the next is right — all the way to the last. ' +
        'Either the first end or the last is right, so any candidate that would rule out both ' +
        '— one that sees them both, or shares a cell with one and sees the other — can go.',
      'The Skyscraper, the 2-String Kite, the XY-Chain and the W-Wing are all alternating ' +
        'chains with shapes of their own. This is the general case, free to switch digits ' +
        'inside a cell and run through rows, columns, boxes and cells alike — as the example ' +
        `does. The puzzles here never need one with more than ` +
        `${NUMBER_WORD[MAX_CHAIN_STRONG_LINKS]} strong links.`,
    ],
    spot:
      'The hardest technique here to see, and easiest with candidates on. Start from a cell ' +
      'with two candidates, or a digit with two places in a row, column or box. Suppose one ' +
      'of them is wrong and follow what must then be right (through strong links) and what ' +
      'that rules out (through weak links). Each candidate you reach through a strong link is ' +
      'the end of a chain: anything that would rule out both it and the one you started from ' +
      'can go.',
    caption: credited(alternatingCaption),
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

/**
 * One step of a "Show me" walkthrough in words: the guide's caption for its
 * technique, crediting the earlier steps (`earlier`, in order) — and the
 * player, with `yours` (see `ruledOutByYou`) — with what it relies on
 * having been ruled out.
 */
export function walkthroughCaption(
  trace: TechniqueTrace,
  earlier: readonly TechniqueTrace[],
  yours: readonly Elimination[] = [],
): string {
  return GUIDE[guideIdFor(trace.step.technique)].caption(trace, earlier, yours);
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
