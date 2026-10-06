import { ALL_DIGITS, COL, PEERS, POPCOUNT, ROW, bit, isPeer, unitCells } from './grid';
import type { Elimination, PatternCell, SolveStep, SolverBoard } from './techniques';
import type { TechniqueId, Unit } from './types';

/*
 * What the pattern behind a step means, independently of how the technique
 * that found it searched.
 *
 * A step describes its deduction the way a player would see it — the
 * pattern's candidates, the houses it lives in, the digit it is about (see
 * `SolveStep`). Three things follow from that description alone, and they
 * live together here because they have to agree:
 *
 * - `isStepValid`: whether the pattern really is on a board and really
 *   justifies everything the step removes there. The soundness harness holds
 *   every step the grader makes to it, and the walkthrough holds every step
 *   it shows a player to it.
 * - `stepOn`: the same deduction read afresh on another board — the
 *   pattern's cells and digits as they stand there, and every candidate it
 *   removes there.
 * - `reliance`: what the pattern needs to be gone from the board — the
 *   candidates that must have been ruled out, and the cells that must have
 *   been filled — for it to hold.
 *
 * The walkthrough leans on how they fit: on any board that keeps every
 * candidate the step's own board had (it may have more), `stepOn` gives a
 * step that `isStepValid` accepts exactly when everything in `reliance` is
 * gone from that board too. Each technique's comment below says why.
 */

/** The single-placement techniques. */
const SINGLES: ReadonlySet<TechniqueId> = new Set<TechniqueId>([
  'fullHouse',
  'hiddenSingleBox',
  'hiddenSingleLine',
  'nakedSingle',
]);

/** The subset techniques: how many cells, and whether the subset is naked or hidden. */
const SUBSETS: Partial<Record<TechniqueId, { size: number; isNaked: boolean }>> = {
  nakedPair: { size: 2, isNaked: true },
  hiddenPair: { size: 2, isNaked: false },
  nakedTriple: { size: 3, isNaked: true },
  hiddenTriple: { size: 3, isNaked: false },
};

/** The fish techniques, by how many base lines they have. */
const FISH: Partial<Record<TechniqueId, number>> = { xWing: 2, swordfish: 3 };

/** The chains: four cells of one digit, linked strong, weak, strong. */
const CHAINS: ReadonlySet<TechniqueId> = new Set<TechniqueId>(['skyscraper']);

const isLine = (unit: Unit) => unit.kind !== 'box';
const isIn = (index: number, unit: Unit) => unitCells(unit).includes(index);
const isSameSet = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((x) => b.includes(x));
const isSameUnit = (a: Unit | null, b: Unit | null) =>
  a === null || b === null ? a === b : a.kind === b.kind && a.index === b.index;

/** The cells of `cells` whose candidates on `board` include any of `mask`. */
function holders(board: SolverBoard, cells: readonly number[], mask: number): number[] {
  return cells.filter((i) => (board.candidates[i] & mask) !== 0);
}

/** The cells of `cells` that hold any of `mask`, each with the part of `mask` it holds. */
function patternOf(board: SolverBoard, cells: readonly number[], mask: number): PatternCell[] {
  return holders(board, cells, mask).map((index) => ({
    index,
    mask: board.candidates[index] & mask,
  }));
}

/** The digits of `mask` that `cells` hold on `board`: what striking `mask` from them would remove. */
function removable(board: SolverBoard, cells: readonly number[], mask: number): Elimination[] {
  return patternOf(board, cells, mask);
}

/** The union of a pattern's digits. */
function digitsOfPattern(pattern: readonly PatternCell[]): number {
  return pattern.reduce((mask, p) => mask | p.mask, 0);
}

/** The base lines and cover lines of a fish, from its houses. */
function fishLines(step: SolveStep, size: number): { base: Unit[]; cover: Unit[] } {
  return { base: step.houses.slice(0, size), cover: step.houses.slice(size) };
}

/** The cells of `cover` outside every line of `base`, in cover-line order. */
function outside(cover: readonly Unit[], base: readonly Unit[]): number[] {
  return cover.flatMap((u) => unitCells(u).filter((i) => !base.some((b) => isIn(i, b))));
}

/** The cells a wing's z can be struck from: every cell that sees both pincers (and, for an XYZ-Wing, the pivot). */
function wingTargets(isXyz: boolean, pivot: number, first: number, second: number): number[] {
  // The same scan as the techniques', so the eliminations come out in the same order.
  return isXyz
    ? PEERS[pivot].filter((t) => isPeer(first, t) && isPeer(second, t))
    : PEERS[first].filter((t) => isPeer(second, t));
}

/** The cells a chain's digit can be struck from: every cell that sees both its ends, bar its own. */
function chainTargets(cells: readonly number[]): number[] {
  const [first, last] = [cells[0], cells[cells.length - 1]];
  // The same scan as the techniques', so the eliminations come out in the same order.
  return PEERS[first].filter((t) => isPeer(last, t) && !cells.includes(t));
}

/** The digit an XY- or XYZ-Wing strikes, from its three cells' candidates. */
function wingDigit(isXyz: boolean, pivot: number, first: number, second: number): number {
  return first & second & (isXyz ? ALL_DIGITS : ~pivot);
}

// ---------------------------------------------------------------------------
// Validity
// ---------------------------------------------------------------------------

/**
 * Whether a step is sound on `board` exactly as it describes itself: every
 * candidate of its pattern is really there, they really form the technique's
 * pattern, and everything it removes is really there to remove and is
 * justified by that pattern (a subset never strikes its own cells, a fish
 * never its base lines, a wing only cells that see its pincers). A single
 * must place a digit the board allows only there (or only in that cell); an
 * elimination step must remove at least one candidate.
 *
 * This checks the description, not the search: it knows nothing of the scan
 * order a technique uses, only what makes the deduction true.
 */
export function isStepValid(board: SolverBoard, step: SolveStep): boolean {
  const { technique: id, pattern, houses, placement } = step;
  const cells = pattern.map((p) => p.index);
  if (cells.length === 0 || new Set(cells).size !== cells.length) return false;
  for (const { index, mask } of pattern) {
    if (board.values[index] !== 0 || mask === 0 || (board.candidates[index] & mask) !== mask) {
      return false;
    }
  }
  // `unit` is the house a hint names: the first of the houses, bar a fish's
  // or a chain's, none of which is "the" house.
  const unit = FISH[id] || CHAINS.has(id) ? null : (houses[0] ?? null);
  if (!isSameUnit(step.unit, unit)) return false;
  if (SINGLES.has(id)) return placement !== null && isSingleValid(board, step, placement);
  if (placement !== null || !areEliminationsReal(board, step)) return false;
  if (id === 'pointing' || id === 'claiming') return isLockedValid(board, step);
  const subset = SUBSETS[id];
  if (subset) return isSubsetValid(board, step, subset.size, subset.isNaked);
  const fishSize = FISH[id];
  if (fishSize) return isFishValid(board, step, fishSize);
  if (CHAINS.has(id)) return isChainValid(board, step);
  return isWingValid(board, step);
}

/** An elimination step removes something, from each cell once, and only what is there. */
function areEliminationsReal(board: SolverBoard, step: SolveStep): boolean {
  const { eliminations } = step;
  const cells = new Set(eliminations.map((e) => e.index));
  return (
    eliminations.length > 0 &&
    cells.size === eliminations.length &&
    eliminations.every(({ index, mask }) => mask !== 0 && (board.candidates[index] & mask) === mask)
  );
}

/**
 * A single places its own digit in its own cell, its pattern that cell
 * alone: a naked single where that is the cell's only candidate, a full
 * house where the rest of its house is filled, and a hidden single where no
 * other cell of its house (a box, or a row or column) can take the digit.
 */
function isSingleValid(
  board: SolverBoard,
  step: SolveStep,
  placement: NonNullable<SolveStep['placement']>,
): boolean {
  const { technique: id, pattern, houses } = step;
  const { index, digit } = placement;
  if (
    step.eliminations.length !== 0 ||
    step.digit !== digit ||
    pattern.length !== 1 ||
    pattern[0].index !== index ||
    pattern[0].mask !== bit(digit)
  ) {
    return false;
  }
  if (id === 'nakedSingle') return houses.length === 0 && board.candidates[index] === bit(digit);
  const [house] = houses;
  if (houses.length !== 1 || !isIn(index, house)) return false;
  if (id === 'fullHouse')
    return unitCells(house).every((i) => i === index || board.values[i] !== 0);
  return (
    (house.kind === 'box') === (id === 'hiddenSingleBox') &&
    holders(board, unitCells(house), bit(digit)).length === 1
  );
}

/**
 * Pointing: every candidate for the digit in a box, at least two, all in one
 * line, clearing the rest of that line. Claiming: the other way about.
 */
function isLockedValid(board: SolverBoard, step: SolveStep): boolean {
  const { technique: id, pattern, houses, digit } = step;
  if (houses.length !== 2 || digit === null) return false;
  const [from, to] = houses;
  const isRightShape =
    id === 'pointing' ? from.kind === 'box' && isLine(to) : isLine(from) && to.kind === 'box';
  if (!isRightShape) return false;
  const d = bit(digit);
  const cells = pattern.map((p) => p.index);
  return (
    cells.length >= 2 &&
    isSameSet(cells, holders(board, unitCells(from), d)) &&
    pattern.every((p) => p.mask === d && isIn(p.index, to)) &&
    step.eliminations.every((e) => e.mask === d && isIn(e.index, to) && !isIn(e.index, from))
  );
}

/**
 * Naked: `size` cells of one house holding `size` digits between them and
 * nothing else, which go from the rest of the house. Hidden: `size` digits
 * with no place in the house outside `size` cells, which lose everything else.
 */
function isSubsetValid(
  board: SolverBoard,
  step: SolveStep,
  size: number,
  isNaked: boolean,
): boolean {
  const { pattern, houses, digit } = step;
  if (houses.length !== 1 || digit !== null) return false;
  const [house] = houses;
  const cells = pattern.map((p) => p.index);
  const union = digitsOfPattern(pattern);
  if (cells.length !== size || POPCOUNT[union] !== size || cells.some((i) => !isIn(i, house))) {
    return false;
  }
  if (isNaked) {
    return (
      pattern.every((p) => p.mask === board.candidates[p.index]) &&
      step.eliminations.every(
        (e) => !cells.includes(e.index) && isIn(e.index, house) && (e.mask & ~union) === 0,
      )
    );
  }
  return (
    isSameSet(cells, holders(board, unitCells(house), union)) &&
    pattern.every((p) => p.mask === (board.candidates[p.index] & union)) &&
    step.eliminations.every((e) => cells.includes(e.index) && (e.mask & union) === 0)
  );
}

/**
 * `size` base lines of one kind, each with at least two places left for the
 * digit, whose candidates for it all fall in `size` cover lines of the other
 * kind, each cover line holding one of them; the digit goes from the cover
 * lines outside the base lines. A base line with no place left — the digit
 * already placed in it — would take none of the cover lines' places, and
 * leave the rest of them free to hold it; one with a single place is a
 * hidden single, which the techniques find first.
 */
function isFishValid(board: SolverBoard, step: SolveStep, size: number): boolean {
  const { pattern, houses, digit } = step;
  if (digit === null || houses.length !== 2 * size) return false;
  const { base, cover } = fishLines(step, size);
  const baseKind = base[0].kind;
  const isRightShape =
    isLine(base[0]) &&
    base.every((u) => u.kind === baseKind) &&
    cover.every((u) => u.kind !== baseKind && isLine(u)) &&
    new Set(houses.map((u) => `${u.kind}${u.index}`)).size === houses.length;
  if (!isRightShape) return false;
  const d = bit(digit);
  const cells = pattern.map((p) => p.index);
  const inBase = (i: number) => base.some((u) => isIn(i, u));
  const inCover = (i: number) => cover.some((u) => isIn(i, u));
  const places = base.map((u) => holders(board, unitCells(u), d));
  return (
    places.every((p) => p.length >= 2) &&
    isSameSet(cells, places.flat()) &&
    pattern.every((p) => p.mask === d && inCover(p.index)) &&
    cover.every((u) => cells.some((i) => isIn(i, u))) &&
    step.eliminations.every((e) => e.mask === d && !inBase(e.index) && inCover(e.index))
  );
}

/**
 * A chain of four cells holding its digit: the first two its only places in
 * the first house, the last two its only places in the second, and the
 * middle two in the third, which they can't both take it in. One end must
 * be the digit, so it goes from cells that see both. A Skyscraper's first
 * two houses are parallel lines and its third a cross line through both,
 * with its ends in different cross lines (or it would be an X-Wing).
 */
function isChainValid(board: SolverBoard, step: SolveStep): boolean {
  const { pattern, houses, digit } = step;
  if (digit === null || pattern.length !== 4 || houses.length !== 3) return false;
  const d = bit(digit);
  const [strong1, strong2, weak] = houses;
  const cells = pattern.map((p) => p.index);
  const [end1, inner1, inner2, end2] = cells;
  const isRightShape =
    isLine(strong1) &&
    strong2.kind === strong1.kind &&
    isLine(weak) &&
    weak.kind !== strong1.kind &&
    !isIn(end1, weak) &&
    !isIn(end2, weak) &&
    (strong1.kind === 'row' ? COL[end1] !== COL[end2] : ROW[end1] !== ROW[end2]);
  const targets = chainTargets(cells);
  return (
    isRightShape &&
    pattern.every((p) => p.mask === d) &&
    isSameSet(holders(board, unitCells(strong1), d), [end1, inner1]) &&
    isSameSet(holders(board, unitCells(strong2), d), [inner2, end2]) &&
    isIn(inner1, weak) &&
    isIn(inner2, weak) &&
    step.eliminations.every((e) => e.mask === d && targets.includes(e.index))
  );
}

/**
 * XY-Wing: a pivot {x, y} seeing pincers {x, z} and {y, z}; XYZ-Wing: a
 * pivot {x, y, z} seeing pincers {x, z} and {y, z}. Either way z goes from
 * cells that see both pincers (and, for XYZ, the pivot).
 */
function isWingValid(board: SolverBoard, step: SolveStep): boolean {
  const { technique: id, pattern, houses, digit } = step;
  if (houses.length !== 0 || digit !== null || pattern.length !== 3) return false;
  const isXyz = id === 'xyzWing';
  const [pivot, first, second] = pattern;
  const z = wingDigit(isXyz, pivot.mask, first.mask, second.mask);
  const isWing =
    pattern.every((p) => p.mask === board.candidates[p.index]) &&
    POPCOUNT[pivot.mask] === (isXyz ? 3 : 2) &&
    [first, second].every(
      (p) =>
        POPCOUNT[p.mask] === 2 &&
        isPeer(pivot.index, p.index) &&
        POPCOUNT[p.mask & pivot.mask] === (isXyz ? 2 : 1),
    ) &&
    first.mask !== second.mask &&
    POPCOUNT[z] === 1;
  const targets = wingTargets(isXyz, pivot.index, first.index, second.index);
  return isWing && step.eliminations.every((e) => e.mask === z && targets.includes(e.index));
}

// ---------------------------------------------------------------------------
// Reading a step on another board
// ---------------------------------------------------------------------------

/**
 * The deduction `step` describes, as it stands on `board`: the same cells,
 * houses and digits, with the pattern's candidates as `board` has them and
 * every candidate the pattern removes there — which can be more than the
 * step removed on its own board, never less, when `board` keeps candidates
 * that board had lost. Whether it still holds is `isStepValid`'s to say.
 *
 * A single is returned as it is: what it places does not depend on the board.
 */
export function stepOn(board: SolverBoard, step: SolveStep): SolveStep {
  const { technique: id, houses, digit } = step;
  if (step.placement !== null) return step;
  if (id === 'pointing' || id === 'claiming') {
    const [from, to] = houses;
    const d = bit(digit!);
    const pattern = patternOf(board, unitCells(from), d);
    return { ...step, pattern, eliminations: removable(board, outside([to], [from]), d) };
  }
  const subset = SUBSETS[id];
  if (subset) {
    const cells = unitCells(houses[0]);
    if (subset.isNaked) {
      const members = step.pattern.map((p) => p.index);
      const union = members.reduce((mask, i) => mask | board.candidates[i], 0);
      const others = cells.filter((i) => !members.includes(i));
      const pattern = patternOf(board, members, ALL_DIGITS);
      return { ...step, pattern, eliminations: removable(board, others, union) };
    }
    const union = digitsOfPattern(step.pattern);
    const pattern = patternOf(board, cells, union);
    const members = pattern.map((p) => p.index);
    return { ...step, pattern, eliminations: removable(board, members, ALL_DIGITS & ~union) };
  }
  const fishSize = FISH[id];
  if (fishSize) {
    const { base, cover } = fishLines(step, fishSize);
    const d = bit(digit!);
    const pattern = base.flatMap((u) => patternOf(board, unitCells(u), d));
    return { ...step, pattern, eliminations: removable(board, outside(cover, base), d) };
  }
  if (CHAINS.has(id)) {
    const cells = step.pattern.map((p) => p.index);
    const d = bit(digit!);
    const pattern = patternOf(board, cells, d);
    return { ...step, pattern, eliminations: removable(board, chainTargets(cells), d) };
  }
  const isXyz = id === 'xyzWing';
  const [pivot, first, second] = step.pattern.map((p) => p.index);
  const { candidates } = board;
  const z = wingDigit(isXyz, candidates[pivot], candidates[first], candidates[second]);
  return {
    ...step,
    pattern: patternOf(board, [pivot, first, second], ALL_DIGITS),
    eliminations: removable(board, wingTargets(isXyz, pivot, first, second), z),
  };
}

// ---------------------------------------------------------------------------
// Reliance
// ---------------------------------------------------------------------------

/** What a step's pattern needs gone from the board for it to hold. */
export interface Reliance {
  /** Per cell, the digits that must no longer be candidates there (a filled cell has none). */
  absent: Elimination[];
  /** Cells that must hold a value. */
  filled: number[];
}

/**
 * What a step relies on having been ruled out. On a board that keeps every
 * candidate the step's own board had — so every candidate its pattern
 * shows is still there — this is exactly what else must hold for `stepOn`
 * to give a valid step:
 *
 * - naked single: the cell's other digits gone;
 * - hidden single: the digit gone from the rest of its house;
 * - full house: the rest of its house filled (the cell's last digit is then
 *   the only one left);
 * - pointing (claiming): the digit gone from the box (line) outside the line
 *   (box) — the pattern is then every place left for it there, and still at
 *   least the two the step found;
 * - naked subset: every other digit gone from the subset's cells, so they
 *   hold the subset's digits and nothing else;
 * - hidden subset: the subset's digits gone from the rest of the house, so
 *   they have no place there outside the subset's cells;
 * - fish: the digit gone from the base lines outside the cover lines, each
 *   base line keeping its two or more places for it, and each cover line
 *   one, from the step's own board;
 * - chains: the digit gone from the rest of each strong link's house, so
 *   each holds it in its two cells alone;
 * - wings: every other digit gone from the pivot and the pincers.
 *
 * Every candidate a re-read step removes is one its pattern justifies, and
 * every one the original step removed is still there to remove, so the
 * re-read step always removes something.
 */
export function reliance(step: SolveStep): Reliance {
  const { technique: id, pattern, houses, digit } = step;
  const each = (cells: readonly number[], mask: number): Reliance => ({
    absent: cells.map((index) => ({ index, mask })),
    filled: [],
  });
  if (step.placement !== null) {
    const { index, digit: placed } = step.placement;
    if (id === 'nakedSingle') return each([index], ALL_DIGITS & ~bit(placed));
    const others = unitCells(houses[0]).filter((i) => i !== index);
    return id === 'fullHouse' ? { absent: [], filled: others } : each(others, bit(placed));
  }
  if (id === 'pointing' || id === 'claiming') {
    const [from, to] = houses;
    return each(outside([from], [to]), bit(digit!));
  }
  const subset = SUBSETS[id];
  if (subset) {
    const union = digitsOfPattern(pattern);
    const members = pattern.map((p) => p.index);
    if (subset.isNaked) return each(members, ALL_DIGITS & ~union);
    return each(
      unitCells(houses[0]).filter((i) => !members.includes(i)),
      union,
    );
  }
  const fishSize = FISH[id];
  if (fishSize) {
    const { base, cover } = fishLines(step, fishSize);
    return each(outside(base, cover), bit(digit!));
  }
  if (CHAINS.has(id)) {
    const cells = pattern.map((p) => p.index);
    const strong = houses.slice(0, 2).flatMap((u) => unitCells(u));
    return each(
      [...new Set(strong)].filter((i) => !cells.includes(i)),
      bit(digit!),
    );
  }
  return {
    absent: pattern.map(({ index, mask }) => ({ index, mask: ALL_DIGITS & ~mask })),
    filled: [],
  };
}
