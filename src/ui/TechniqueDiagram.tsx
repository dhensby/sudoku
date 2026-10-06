import { useId, type ReactNode } from 'react';
import {
  BOX,
  COL,
  ROW,
  bit,
  digitsOf,
  unitCells,
  type Digit,
  type TechniqueId,
  type TechniqueTrace,
  type Unit,
} from '../core';

export interface TechniqueDiagramProps {
  /** The board just before the step, and the step. */
  trace: TechniqueTrace;
  /** The example walked through in words: shown beside the board, and its accessible name. */
  caption: string;
  /** What sets this example apart from the entry's others ("In a box"), if it has any. */
  label?: string | null;
}

/*
 * A worked example drawn as a small board: what the trace shows, with the
 * step's working marked on it the way a player would mark up a printed
 * puzzle.
 *
 * - Placed digits, and the candidates of the empty cells. A technique about
 *   one digit (hidden singles, locked candidates, fish) shows that digit's
 *   candidates alone, larger, and sets its placed copies heavier and in the
 *   accent, so the pattern stands out from the noise and the copies that
 *   shape it are easy to follow.
 * - Where to look, shaded: the houses the pattern lies in (a naked
 *   single's own three), or a wing's three cells, which share none — and,
 *   more lightly, the houses a step about one digit clears (the line beyond
 *   a pointing pair, the box beyond a box/line reduction, a fish's cover
 *   lines).
 * - The pattern's candidates ringed, the ones the step removes struck
 *   through, and a single's answer written in and framed.
 * - A wing's shape: its pivot framed, and the digit it forces — the one it
 *   removes, which one of its cells must be — filled in rather than ringed,
 *   so the strike on the cell that sees them all follows from the picture.
 *
 * Rows and columns are numbered round the edge, as the captions count them.
 * Every mark differs in shape as well as colour — ring, disc, slash, frame,
 * bold ink — so the board still reads in forced colours, where the
 * stylesheet swaps the shading for outlines of the houses (and of a wing's
 * pincers; its pivot keeps its frame).
 *
 * One SVG, drawn in user units of a 40-unit cell and scaled by CSS to its
 * container: a role="img" named by the caption, its layers hidden from
 * assistive technology.
 */

/** Techniques about one digit: the diagram shows only that digit's candidates. */
const SINGLE_DIGIT: ReadonlySet<TechniqueId> = new Set<TechniqueId>([
  'hiddenSingleBox',
  'hiddenSingleLine',
  'pointing',
  'claiming',
  'xWing',
  'swordfish',
]);

/** A cell's side, in user units. */
const CELL = 40;
const SIZE = 9 * CELL;
/** Room round the board for the row and column numbers. */
const MARGIN = 17;
/** Inset of the 3×3 candidate grid inside a cell, and one candidate's slot. */
const PAD = 1.5;
const SLOT = (CELL - 2 * PAD) / 3;

/** How candidates are drawn: small in their slots, or larger when they are the only ones. */
const SCALE = {
  all: { pull: 1, ring: 6.1, strike: 5 },
  // Drawn larger, a lone digit is drawn nearer the middle of the cell, still
  // towards its own spot, so its ring stays inside the cell.
  focus: { pull: 0.55, ring: 8.2, strike: 6.4 },
};

const cellX = (index: number) => COL[index] * CELL;
const cellY = (index: number) => ROW[index] * CELL;

/** The centre of a candidate's spot: 1 top left … 9 bottom right, as on the board. */
function spot(index: number, digit: number, pull: number): [number, number] {
  const slot = digit - 1;
  const offset = (n: number) => (PAD + (n + 0.5) * SLOT - CELL / 2) * pull + CELL / 2;
  return [cellX(index) + offset(slot % 3), cellY(index) + offset(Math.floor(slot / 3))];
}

/** How far a house's outline sits inside its edge, clear of the box lines it may share. */
const OUTLINE_INSET = 3.5;

/** A house's outline: its rectangle, inset. */
function houseRect(unit: Unit): { x: number; y: number; width: number; height: number } {
  const [x, y, width, height] =
    unit.kind === 'row'
      ? [0, unit.index * CELL, SIZE, CELL]
      : unit.kind === 'column'
        ? [unit.index * CELL, 0, CELL, SIZE]
        : [(unit.index % 3) * 3 * CELL, Math.floor(unit.index / 3) * 3 * CELL, 3 * CELL, 3 * CELL];
  return {
    x: x + OUTLINE_INSET,
    y: y + OUTLINE_INSET,
    width: width - 2 * OUTLINE_INSET,
    height: height - 2 * OUTLINE_INSET,
  };
}

/** A cell's outline: its square, inset like a house's. */
function cellRect(index: number): { x: number; y: number; width: number; height: number } {
  return {
    x: cellX(index) + OUTLINE_INSET,
    y: cellY(index) + OUTLINE_INSET,
    width: CELL - 2 * OUTLINE_INSET,
    height: CELL - 2 * OUTLINE_INSET,
  };
}

/** The row, column and box of a cell. */
function housesOf(index: number): Unit[] {
  return [
    { kind: 'row', index: ROW[index] },
    { kind: 'column', index: COL[index] },
    { kind: 'box', index: BOX[index] },
  ];
}

/** What to draw, worked out from the trace. */
interface Marks {
  /** The one digit whose candidates are drawn, or null for all of them. */
  focus: Digit | null;
  /** The step's houses, each with its shade: outlined in forced colours. */
  houses: { unit: Unit; shade: Shade }[];
  /**
   * The shading, cell by cell, each cell once: where to look (the houses the
   * pattern lies in, or a wing's cells), then where the step clears.
   */
  shaded: Map<number, Shade>;
  /** Per cell, the candidates ringed and the candidates struck. */
  pattern: Map<number, number>;
  removed: Map<number, number>;
  answer: { index: number; digit: Digit } | null;
  /** A wing's pivot, framed; null for every other technique. */
  pivot: number | null;
  /** A wing's pincers, outlined in forced colours, where their shading goes. */
  pincers: number[];
  /** The digit a wing forces into one of its cells, filled in where they hold it. */
  forced: Digit | null;
}

/** How strongly a cell is shaded: where to look, or where the step clears. */
type Shade = 'look' | 'clear';

/**
 * How many of a step's houses hold its pattern, the rest being where it
 * clears: the box of a pointing pair, the line of a box/line reduction, a
 * fish's base lines. Every other step works within all of its houses.
 */
function lookCount(technique: TechniqueId, houses: readonly Unit[]): number {
  if (technique === 'pointing' || technique === 'claiming') return 1;
  if (technique === 'xWing' || technique === 'swordfish') return houses.length / 2;
  return houses.length;
}

function marksOf({ step }: TechniqueTrace): Marks {
  const answer = step.placement;
  // A naked single is about everything its cell sees: its own three houses.
  const houses =
    step.technique === 'nakedSingle' && answer !== null ? housesOf(answer.index) : step.houses;
  const shaded = new Map<number, Shade>();
  const isWing = step.technique === 'xyWing' || step.technique === 'xyzWing';
  // A wing's cells share no house: shading them is what shows its shape.
  // Its pattern lists the pivot first, and it removes only the digit it
  // forces.
  const [pivot, ...pincers] = isWing ? step.pattern.map((cell) => cell.index) : [];
  if (isWing) for (const cell of step.pattern) shaded.set(cell.index, 'look');
  const looks = lookCount(step.technique, houses);
  const shades = houses.map((unit, i) => ({ unit, shade: i < looks ? 'look' : 'clear' }) as const);
  for (const { unit, shade } of shades) {
    for (const index of unitCells(unit)) if (!shaded.has(index)) shaded.set(index, shade);
  }
  return {
    focus: SINGLE_DIGIT.has(step.technique) ? step.digit : null,
    houses: shades,
    shaded,
    // A single's pattern is its answer, which is drawn as the answer.
    pattern: new Map(answer === null ? step.pattern.map((p) => [p.index, p.mask]) : []),
    removed: new Map(step.eliminations.map((e) => [e.index, e.mask])),
    answer,
    pivot: pivot ?? null,
    pincers,
    forced: isWing ? digitsOf(step.eliminations[0].mask)[0] : null,
  };
}

/** One layer of the drawing, hidden from assistive technology like every layer. */
function Layer({ name, children }: { name: string; children: ReactNode }) {
  return (
    <g className={`technique-diagram__${name}`} aria-hidden="true">
      {children}
    </g>
  );
}

/** The lines between rows (and columns) 1–9; every third is a box's edge. */
const LINES = [1, 2, 3, 4, 5, 6, 7, 8];
const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** A swatch for the key: the mark it stands for, in miniature. */
function Swatch({ kind }: { kind: string }) {
  return <span className={`technique-diagram__swatch technique-diagram__swatch--${kind}`} />;
}

/**
 * A worked example as a mini board with its caption (see the comment
 * above). The caption is the image's name; shown beside it, it is hidden
 * from assistive technology so it is not read out twice, and so is the key,
 * which only explains the drawing.
 */
export function TechniqueDiagram({ trace, caption, label = null }: TechniqueDiagramProps) {
  const captionId = useId();
  const { values, candidates } = trace;
  const marks = marksOf(trace);
  const shown = marks.focus === null ? 0x1ff : bit(marks.focus);
  const scale = marks.focus === null ? SCALE.all : SCALE.focus;
  const size = marks.focus === null ? 'small' : 'large';

  const notes: ReactNode[] = [];
  const rings: ReactNode[] = [];
  const strikes: ReactNode[] = [];
  for (let index = 0; index < 81; index++) {
    if (values[index] !== 0 || marks.answer?.index === index) continue;
    const ringed = marks.pattern.get(index) ?? 0;
    const struck = marks.removed.get(index) ?? 0;
    for (const digit of digitsOf(candidates[index] & (shown | ringed | struck))) {
      const key = `${index}-${digit}`;
      const [x, y] = spot(index, digit, scale.pull);
      const isStruck = (struck & bit(digit)) !== 0;
      const isRinged = (ringed & bit(digit)) !== 0;
      const isForced = isRinged && digit === marks.forced;
      const mark = isStruck ? 'removed' : isForced ? 'forced' : isRinged ? 'pattern' : 'plain';
      if (isRinged) {
        rings.push(
          <circle
            key={key}
            cx={x}
            cy={y}
            r={scale.ring}
            data-ring={isForced ? 'forced' : undefined}
          />,
        );
      }
      notes.push(
        <text
          key={key}
          x={x}
          y={y}
          className={`technique-diagram__candidate technique-diagram__candidate--${size}`}
          data-mark={mark}
        >
          {digit}
        </text>,
      );
      if (isStruck) {
        const d = scale.strike;
        strikes.push(<line key={key} x1={x - d} y1={y + d} x2={x + d} y2={y - d} />);
      }
    }
  }

  const view = `${-MARGIN} ${-MARGIN} ${SIZE + MARGIN + 2} ${SIZE + MARGIN + 2}`;
  return (
    <div className="technique-diagram">
      <svg
        className="technique-diagram__board"
        viewBox={view}
        role="img"
        aria-labelledby={captionId}
      >
        <Layer name="cells">
          <rect x={0} y={0} width={SIZE} height={SIZE} />
        </Layer>
        <Layer name="shading">
          {[...marks.shaded].map(([index, shade]) => (
            <rect
              key={index}
              x={cellX(index)}
              y={cellY(index)}
              width={CELL}
              height={CELL}
              data-mark="shaded"
              data-shade={shade}
            />
          ))}
        </Layer>
        <Layer name="thin">
          {LINES.filter((k) => k % 3 !== 0).map((k) => (
            <g key={k}>
              <line x1={k * CELL} y1={0} x2={k * CELL} y2={SIZE} />
              <line x1={0} y1={k * CELL} x2={SIZE} y2={k * CELL} />
            </g>
          ))}
        </Layer>
        <Layer name="outlines">
          {marks.houses.map(({ unit, shade }) => (
            <rect
              key={`${unit.kind}-${unit.index}`}
              {...houseRect(unit)}
              data-mark="house"
              data-shade={shade}
            />
          ))}
          {marks.pincers.map((index) => (
            <rect key={index} {...cellRect(index)} data-mark="pincer" data-shade="look" />
          ))}
        </Layer>
        {marks.pivot !== null && (
          <Layer name="pivot">
            <rect
              x={cellX(marks.pivot) + 2}
              y={cellY(marks.pivot) + 2}
              width={CELL - 4}
              height={CELL - 4}
              rx={3}
              data-mark="pivot"
            />
          </Layer>
        )}
        <Layer name="rings">{rings}</Layer>
        <Layer name="candidates">{notes}</Layer>
        <Layer name="strikes">{strikes}</Layer>
        <Layer name="digits">
          {Array.from(values, (value, index) =>
            value === 0 ? null : (
              <text
                key={index}
                x={cellX(index) + CELL / 2}
                y={cellY(index) + CELL / 2}
                data-mark={value === marks.focus ? 'copy' : undefined}
              >
                {value}
              </text>
            ),
          )}
        </Layer>
        {marks.answer !== null && (
          <Layer name="answer">
            <rect
              x={cellX(marks.answer.index) + 2.5}
              y={cellY(marks.answer.index) + 2.5}
              width={CELL - 5}
              height={CELL - 5}
              rx={3}
            />
            <text
              x={cellX(marks.answer.index) + CELL / 2}
              y={cellY(marks.answer.index) + CELL / 2}
              data-mark="answer"
            >
              {marks.answer.digit}
            </text>
          </Layer>
        )}
        <Layer name="thick">
          {[3, 6].map((k) => (
            <g key={k}>
              <line x1={k * CELL} y1={0} x2={k * CELL} y2={SIZE} />
              <line x1={0} y1={k * CELL} x2={SIZE} y2={k * CELL} />
            </g>
          ))}
          <rect x={0} y={0} width={SIZE} height={SIZE} />
        </Layer>
        <Layer name="labels">
          {NUMBERS.map((n) => (
            <g key={n}>
              <text x={(n - 0.5) * CELL} y={-MARGIN / 2}>
                {n}
              </text>
              <text x={-MARGIN / 2} y={(n - 0.5) * CELL}>
                {n}
              </text>
            </g>
          ))}
        </Layer>
      </svg>
      <div className="technique-diagram__text">
        <p className="technique-diagram__caption" id={captionId} aria-hidden="true">
          {label !== null && (
            <>
              <strong className="technique-diagram__label">{label}.</strong>{' '}
            </>
          )}
          {caption}
        </p>
        <ul className="technique-diagram__key" aria-hidden="true">
          {marks.shaded.size > 0 && (
            <li>
              <Swatch kind="look" />
              Where to look
            </li>
          )}
          {[...marks.shaded.values()].includes('clear') && (
            <li>
              <Swatch kind="clear" />
              Where it clears
            </li>
          )}
          {marks.pivot !== null && (
            <li>
              <Swatch kind="pivot" />
              The pivot
            </li>
          )}
          {marks.pattern.size > 0 && (
            <li>
              <Swatch kind="pattern" />
              The pattern
            </li>
          )}
          {marks.forced !== null && (
            <li>
              <Swatch kind="forced" />
              At least one of these is {marks.forced}
            </li>
          )}
          {marks.removed.size > 0 && (
            <li>
              <Swatch kind="removed" />
              Removed
            </li>
          )}
          {marks.answer !== null && (
            <li>
              <Swatch kind="answer" />
              The answer
            </li>
          )}
          {marks.focus !== null && (
            <>
              <li>
                <span className="technique-diagram__copy">{marks.focus}</span>
                The {marks.focus}s already placed
              </li>
              <li>Candidates shown: {marks.focus}s only</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}
