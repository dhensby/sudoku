import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  countTicks,
  formatDuration,
  invertLinear,
  placeEndLabels,
  scaleLinear,
  solvedAt,
  timeTicks,
  type ProgressMark,
  type ProgressPoint,
  type SolveProgress,
} from '../core';
import { endLabelText, isolate, shortName } from './compareText';

/*
 * The chart of "Compare solves": the cells each player had solved over play
 * time, a step line each, with the mistakes that counted and the help they
 * took marked on their lines, and a cursor at the moment on show — which the
 * chart itself sets, as a slider: a press or a tap puts it there, a drag
 * scrubs, and the keys move it a second, or ten, at a time.
 *
 * Drawn to a few fixed specs, so that the data is the only loud thing on it:
 * 2px lines, marks of 10px or more ringed in the surface where they cross a
 * line, hairline gridlines a step off the surface, axis text in the muted
 * ink and labels in the text's (never the series colour). Who is who never
 * rests on colour alone: the player's own line is solid and its marks
 * filled, the friend's dashed and theirs open; each line is labelled at its
 * end, and the legend says the same.
 *
 * Drawn in two parts: what stays put — the axes, the lines, their marks and
 * labels — worked out once for the solves and the size, and the cursor,
 * redrawn as it moves, so a drag across a long solve redraws two dots and a
 * line rather than every mark.
 */

const MARGIN = { top: 26, right: 12, bottom: 24, left: 30 } as const;
/**
 * The size drawn at until the chart has been measured (and in a test, which
 * lays nothing out). Its height is the stylesheet's (`--chart-height`), lower
 * on a phone on its side: the plot, the band its end labels sit in above it,
 * and its time axis.
 */
const DEFAULT_SIZE: Size = { width: 320, height: 196 };
/** The width of a character of a label, at its 12px, near enough to keep labels apart. */
const CHAR_WIDTH = 6.8;
/** The room the time axis gives each tick. */
const TICK_ROOM = 64;
/** A plot lower than this ticks fewer cell counts. */
const SHORT_PLOT = 110;
/** How far the slider's Page Up and Page Down move, in seconds. */
const PAGE_STEP = 10;
/** How far a label moved beside its line's end dot sits from the dot's centre. */
const LABEL_INSET = 10;
/**
 * How far a finger must move before it is taken for a drag along the chart
 * or a scroll past it — less is a tap.
 */
const TOUCH_SLOP = 8;

interface Size {
  readonly width: number;
  readonly height: number;
}

export interface CompareChartProps {
  mine: SolveProgress;
  theirs: SolveProgress;
  /** The player's time in whole seconds, or null for a solve recorded without one. */
  mySeconds: number | null;
  /** The friend's time, as their link claimed it. */
  theirSeconds: number;
  /** The friend's name from their link, or null for none. */
  name: string | null;
  /** The cursor: the moment on show, in whole seconds of play. */
  second: number;
  /** The last moment there is: the end of the longer solve. */
  maxSecond: number;
  /** What the chart says at the cursor (see `readoutText`): the slider's value, spoken. */
  readout: string;
  onSeek: (second: number) => void;
}

/** A number for an SVG path, to a tenth of a pixel. */
const px = (n: number): string => String(Math.round(n * 10) / 10);

/** The size the chart has to draw in, measured, and measured again as it changes. */
function useSize(ref: React.RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState(DEFAULT_SIZE);
  useLayoutEffect(() => {
    const element = ref.current!;
    const measure = () => {
      const width = element.clientWidth > 0 ? element.clientWidth : DEFAULT_SIZE.width;
      const height = element.clientHeight > 0 ? element.clientHeight : DEFAULT_SIZE.height;
      setSize((last) =>
        last.width === width && last.height === height ? last : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** A step line through `points`, carried on to `end`: across to each change, then up or down to it. */
function stepPath(
  points: readonly ProgressPoint[],
  end: number,
  x: (second: number) => number,
  y: (solved: number) => number,
): string {
  let d = `M${px(x(points[0].second))},${px(y(points[0].solved))}`;
  for (const point of points.slice(1)) d += `H${px(x(point.second))}V${px(y(point.solved))}`;
  if (points[points.length - 1].second < end) d += `H${px(x(end))}`;
  return d;
}

/** A mark's shape about its centre: a triangle for a mistake, a diamond for help. */
function markPath(kind: ProgressMark['kind'], cx: number, cy: number): string {
  if (kind === 'mistake') {
    return `M${px(cx)},${px(cy - 6.5)}L${px(cx + 6)},${px(cy + 4)}L${px(cx - 6)},${px(cy + 4)}Z`;
  }
  return `M${px(cx)},${px(cy - 6)}L${px(cx + 6)},${px(cy)}L${px(cx)},${px(cy + 6)}L${px(cx - 6)},${px(cy)}Z`;
}

/** One mark of each kind a second at most: several hints in a second read as one. */
function distinctMarks(marks: readonly ProgressMark[]): ProgressMark[] {
  const seen = new Map<string, ProgressMark>();
  for (const mark of marks) {
    const key = `${mark.kind}:${mark.second}`;
    if (!seen.has(key)) seen.set(key, mark);
  }
  return [...seen.values()];
}

type Who = 'mine' | 'theirs';

/** A shape to draw for one player: a mark, or a dot. */
interface ShapeSpec {
  readonly key: string;
  readonly who: Who;
  readonly d: string;
}

/**
 * Shapes for both players, drawn in three layers: the surface halos behind
 * the friend's open shapes, then the player's filled ones (ringed in the
 * surface), then the friend's outlines, which are open. Where the two fall
 * on the same spot — both at 0 cells at the start, both done at the end, a
 * mistake each in the same second — the player's fill shows through the
 * friend's ring, reading as both, rather than one hiding the other.
 */
function layered(shapes: readonly ShapeSpec[]): ReactNode {
  const theirs = shapes.filter((shape) => shape.who === 'theirs');
  return (
    <>
      {theirs.map(({ key, d }) => (
        <path key={`halo-${key}`} className="compare-chart__halo" d={d} />
      ))}
      {shapes
        .filter((shape) => shape.who === 'mine')
        .map(({ key, d }) => (
          <path key={key} className="compare-chart__shape compare-chart__shape--mine" d={d} />
        ))}
      {theirs.map(({ key, d }) => (
        <path key={key} className="compare-chart__shape compare-chart__shape--theirs" d={d} />
      ))}
    </>
  );
}

/** A dot for one player, at a line's end or where the cursor crosses it. */
function dotPath(cx: number, cy: number): string {
  const r = 4.5;
  return `M${px(cx - r)},${px(cy)}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`;
}

/** A press on the chart, followed until it lifts: a mouse's or a pen's scrubs at once; a finger's waits to see which way it goes. */
interface Press {
  readonly id: number;
  readonly startX: number;
  readonly startY: number;
  isScrubbing: boolean;
}

/**
 * The progress chart, as a slider for the moment on show (see the module
 * comment). Its keys: the arrows a second either way, Page Up and Page Down
 * ten, Home and End to the start and the end of the longer solve.
 *
 * A mouse or a pen sets the cursor where it presses and scrubs as it drags.
 * A finger is let alone until it shows what it is doing — a tap sets the
 * cursor, a drag along the chart scrubs, and a swipe up or down scrolls the
 * dialog (the browser's, under `touch-action: pan-y`) and leaves the cursor
 * where it was, so the board scrolled to still shows the moment chosen.
 */
export function CompareChart({
  mine,
  theirs,
  mySeconds,
  theirSeconds,
  name,
  second,
  maxSecond,
  readout,
  onSeek,
}: CompareChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const press = useRef<Press | null>(null);
  const { width, height } = useSize(plotRef);
  const total = mine.total;

  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const top = MARGIN.top;
  const bottom = height - MARGIN.bottom;
  // A domain of at least a second, so a solve of no time still has an axis.
  const domain: [number, number] = [0, Math.max(maxSecond, 1)];
  const x = scaleLinear(domain, [left, right]);
  const toSecond = invertLinear(domain, [left, right]);
  const y = scaleLinear([0, Math.max(total, 1)], [bottom, top]);

  // What stays put as the cursor moves (see the module comment).
  const { under, labels } = useMemo(() => {
    const xOf = scaleLinear([0, Math.max(maxSecond, 1)], [left, right]);
    const yOf = scaleLinear([0, Math.max(total, 1)], [bottom, top]);
    const times = timeTicks(maxSecond, Math.max(2, Math.floor((right - left) / TICK_ROOM)));
    // Fewer cell counts on a chart lowered to fit a phone on its side, so
    // they never crowd each other.
    const counts = countTicks(total, bottom - top < SHORT_PLOT ? 3 : 4);
    const lines: readonly { who: Who; progress: SolveProgress; label: string }[] = [
      { who: 'mine', progress: mine, label: endLabelText('You', mySeconds) },
      {
        who: 'theirs',
        progress: theirs,
        label: endLabelText(name === null ? 'Your friend' : isolate(shortName(name)), theirSeconds),
      },
    ];
    // The labels' widths, near enough, counting characters (not the isolates).
    const widths = lines.map(({ label }) => label.replace(/[⁨⁩]/g, '').length * CHAR_WIDTH);
    const places = placeEndLabels(
      lines.map(({ progress }, i) => ({ x: xOf(progress.end), width: widths[i] })),
      // Into the cell-count axis's margin if they must, but never off the chart.
      2,
      10,
      LABEL_INSET,
    );
    const marks = lines.flatMap(({ who, progress }) =>
      distinctMarks(progress.marks).map((mark) => ({
        key: `${who}-${mark.kind}-${mark.second}`,
        who,
        d: markPath(mark.kind, xOf(mark.second), yOf(mark.solved)),
      })),
    );
    const ends = lines.map(({ who, progress }) => ({
      key: `${who}-end`,
      who,
      d: dotPath(xOf(progress.end), yOf(solvedAt(progress, progress.end))),
    }));

    const under = (
      <>
        <g className="compare-chart__grid">
          {counts.map((count) => (
            <line key={count} x1={left} x2={right} y1={px(yOf(count))} y2={px(yOf(count))} />
          ))}
        </g>
        <line className="compare-chart__axis" x1={left} x2={right} y1={bottom} y2={bottom} />
        <g className="compare-chart__ticks compare-chart__ticks--cells">
          {counts.map((count) => (
            <text key={count} x={left - 10} y={px(yOf(count))} dy="0.32em" textAnchor="end">
              {count}
            </text>
          ))}
        </g>
        <g className="compare-chart__ticks compare-chart__ticks--time">
          {times.map((time, i) => (
            <text
              key={time}
              x={px(xOf(time))}
              y={bottom + 16}
              // The first tick sits at the axis's start, so it reads from there.
              textAnchor={i === 0 ? 'start' : 'middle'}
            >
              {formatDuration(time * 1000)}
            </text>
          ))}
        </g>
        {lines.map(({ who, progress }) => (
          <path
            key={who}
            className={`compare-chart__line compare-chart__line--${who}`}
            d={stepPath(progress.points, progress.end, xOf, yOf)}
          />
        ))}
        <g className="compare-chart__marks">{layered(marks)}</g>
        <g className="compare-chart__ends">{layered(ends)}</g>
      </>
    );
    const labels = lines.map(({ who, progress, label }, i) => {
      const place = places[i];
      return (
        <g key={who} className={`compare-chart__label compare-chart__label--${place.at}`}>
          {place.at === 'above' ? (
            <text x={px(place.right)} y={top - 12} textAnchor="end">
              {label}
            </text>
          ) : (
            <text
              x={px(place.x)}
              y={px(yOf(solvedAt(progress, progress.end)))}
              dy="0.32em"
              textAnchor={place.side === 'left' ? 'end' : 'start'}
            >
              {label}
            </text>
          )}
        </g>
      );
    });
    return { under, labels };
  }, [mine, theirs, mySeconds, theirSeconds, name, maxSecond, total, left, right, top, bottom]);

  const clamp = (value: number) => Math.min(Math.max(value, 0), maxSecond);
  const seek = (value: number) => {
    const next = clamp(value);
    if (next !== second) onSeek(next);
  };
  /** The second under a pointer, from where it is across the chart. */
  const secondAt = (clientX: number): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = rect.width > 0 ? width / rect.width : 1;
    return Math.round(toSecond((clientX - rect.left) * scale));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Readonly<Record<string, number>> = {
      ArrowLeft: second - 1,
      ArrowDown: second - 1,
      ArrowRight: second + 1,
      ArrowUp: second + 1,
      PageDown: second - PAGE_STEP,
      PageUp: second + PAGE_STEP,
      Home: 0,
      End: maxSecond,
    };
    const target = moves[event.key];
    if (target === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    seek(target);
  };
  /** Take the cursor to the pointer, the chart focused so the keys carry on from there. */
  const seekTo = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.focus({ preventScroll: true });
    seek(secondAt(event.clientX));
  };
  const startScrubbing = (event: PointerEvent<HTMLDivElement>, current: Press) => {
    current.isScrubbing = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekTo(event);
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const current: Press = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isScrubbing: false,
    };
    press.current = current;
    // A finger waits: it may be the start of a scroll (see above).
    if (event.pointerType !== 'touch') startScrubbing(event, current);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (current === null || current.id !== event.pointerId) return;
    if (current.isScrubbing) {
      seek(secondAt(event.clientX));
      return;
    }
    const across = Math.abs(event.clientX - current.startX);
    const down = Math.abs(event.clientY - current.startY);
    if (Math.max(across, down) < TOUCH_SLOP) return;
    // Up or down is a scroll, the browser's: nothing for the cursor.
    if (down >= across) press.current = null;
    else startScrubbing(event, current);
  };
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    press.current = null;
    // A finger lifted where it landed: a tap.
    if (current !== null && current.id === event.pointerId && !current.isScrubbing) seekTo(event);
  };
  const stopPressing = () => {
    press.current = null;
  };

  const cursorX = x(second);
  const cursorDots = [
    { key: 'mine-cursor', who: 'mine' as const, d: dotPath(cursorX, y(solvedAt(mine, second))) },
    {
      key: 'theirs-cursor',
      who: 'theirs' as const,
      d: dotPath(cursorX, y(solvedAt(theirs, second))),
    },
  ];

  return (
    <div className="compare-chart">
      <div
        className="compare-chart__plot"
        ref={plotRef}
        role="slider"
        tabIndex={0}
        aria-label="Time"
        aria-valuemin={0}
        aria-valuemax={maxSecond}
        aria-valuenow={second}
        aria-valuetext={readout}
        data-autofocus="keep-scroll"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={stopPressing}
        onLostPointerCapture={stopPressing}
      >
        {/* For the eye: the slider says where the cursor is, and the table
            what the lines show. */}
        <svg
          className="compare-chart__svg"
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          aria-hidden="true"
          focusable="false"
        >
          {under}
          <line
            className="compare-chart__cursor"
            x1={px(cursorX)}
            x2={px(cursorX)}
            y1={top - 4}
            y2={bottom}
          />
          <g className="compare-chart__cursor-dots">{layered(cursorDots)}</g>
          {labels}
        </svg>
      </div>
    </div>
  );
}
