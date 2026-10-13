import { memo, useId, useMemo, useState, type ReactNode } from 'react';
import {
  formatDuration,
  overlayAt,
  preparePlayback,
  progressOf,
  sampleSeconds,
  solvedAt,
  type Level,
  type OverlayCell,
  type Playback,
  type ProgressMark,
  type SolveProgress,
} from '../../core';
import { Board, type BoardSettings } from '../Board';
import type { CellOverlay } from '../Cell';
import { CompareChart } from '../CompareChart';
import { markName, overlayCellLabel, readoutText, shortName } from '../compareText';
import { REFUSAL_TEXT } from '../playbackText';
import { Dialog } from './Dialog';

/**
 * What to compare: a puzzle's givens and two solves of it — the player's own
 * and a friend's, each as its encoded move log — with the words to head them.
 * Nothing of the player's own record beyond its time: like watching, comparing
 * changes nothing.
 */
export interface CompareSource {
  givens: string;
  /** The puzzle's tier, carried with it. */
  difficulty: Level;
  /** The puzzle as the line under the heading names it: "Hard", "Daily · 13 Oct · Hard". */
  puzzleName: string;
  /** The player's solve, and its time in whole seconds — null for one recorded without a time. */
  mine: { log: string; seconds: number | null };
  /** The friend's solve, their name (null for a link with none) and the time their link claims. */
  theirs: { log: string; name: string | null; seconds: number };
}

export interface CompareDialogProps extends CompareSource {
  onClose: () => void;
}

/** A board to look at only: nothing on it is highlighted, and its conflicts are not the point. */
const BOARD_SETTINGS: BoardSettings = {
  highlightRowColumn: false,
  highlightBox: false,
  highlightIdentical: false,
  highlightConflicts: false,
};

/** Never called: the board takes no input. */
const ignore = () => {};

/** How many rows the table of progress lists, at most (and the end). */
const TABLE_ROWS = 12;

/** A friend's name for the page: isolated in a <bdi>, or "Your friend" / "your friend". */
function Friend({ name, isCapital = false }: { name: string | null; isCapital?: boolean }) {
  if (name !== null) return <bdi>{name}</bdi>;
  return <>{isCapital ? 'Your friend' : 'your friend'}</>;
}

/** A digit of one player's, or of both, drawn in their colour and style. */
function Digit({ who, digit }: { who: 'both' | 'mine' | 'theirs'; digit: number }) {
  return <span className={`compare-digit compare-digit--${who}`}>{digit}</span>;
}

/** What a cell of the overlaid board draws (see `OverlayCell`). */
function overlayContent(cell: Exclude<OverlayCell, { kind: 'given' | 'empty' }>): ReactNode {
  if (cell.kind === 'different') {
    return (
      <span className="compare-split" aria-hidden="true">
        <Digit who="mine" digit={cell.mine} />
        <Digit who="theirs" digit={cell.theirs} />
      </span>
    );
  }
  return (
    <span className="cell__value compare-cell__value" aria-hidden="true">
      <Digit who={cell.kind} digit={cell.digit} />
    </span>
  );
}

/** The overlaid board's cells, for Board's overlay (givens drawn as the board draws them). */
function overlayOf(cells: readonly OverlayCell[], name: string | null): (CellOverlay | null)[] {
  return cells.map((cell) => {
    if (cell.kind === 'given') return null;
    return {
      content: cell.kind === 'empty' ? null : overlayContent(cell),
      label: overlayCellLabel(cell, name),
      className: `cell--compare cell--compare-${cell.kind}`,
    };
  });
}

/** A row of the table of mistakes and help: when, whose, and what. */
interface EventRow {
  second: number;
  who: 'mine' | 'theirs';
  mark: ProgressMark;
}

/**
 * The chart as tables, behind a toggle: the cells each player had solved at
 * round times to the end, and every mistake that counted and move of help,
 * when and whose. After the board, so the toggle and an open table never
 * come between the chart and the board it drives. Memoised: it depends on
 * the solves, not the cursor, so moving the cursor never redraws it.
 */
const CompareTables = memo(function CompareTables({
  mine,
  theirs,
  maxSecond,
  name,
}: {
  mine: SolveProgress;
  theirs: SolveProgress;
  maxSecond: number;
  name: string | null;
}) {
  const tableId = `${useId()}-table`;
  const [isTableShown, setTableShown] = useState(false);
  const events: EventRow[] = [
    ...mine.marks.map((mark) => ({ second: mark.second, who: 'mine' as const, mark })),
    ...theirs.marks.map((mark) => ({ second: mark.second, who: 'theirs' as const, mark })),
  ].sort((a, b) => a.second - b.second);

  return (
    <div className="compare__tables">
      <p className="compare__table-toggle">
        <button
          type="button"
          className="button button--small"
          aria-expanded={isTableShown}
          aria-controls={tableId}
          onClick={() => setTableShown((shown) => !shown)}
        >
          {isTableShown ? 'Hide table' : 'Show as table'}
        </button>
      </p>
      <div className="compare-tables" id={tableId} hidden={!isTableShown}>
        <table className="compare-table">
          <caption className="compare-table__caption">Cells solved, of {mine.total}</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">You</th>
              <th scope="col">
                <Friend name={name} isCapital />
              </th>
            </tr>
          </thead>
          <tbody>
            {sampleSeconds(maxSecond, TABLE_ROWS).map((at) => (
              <tr key={at}>
                <th scope="row">{formatDuration(at * 1000)}</th>
                <td>{solvedAt(mine, at)}</td>
                <td>{solvedAt(theirs, at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 ? (
          <p className="compare-tables__none">
            Neither of you made a mistake that counted, or took a hint, a check or a reveal.
          </p>
        ) : (
          <table className="compare-table">
            <caption className="compare-table__caption">Mistakes and help</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
              </tr>
            </thead>
            <tbody>
              {events.map(({ second: at, who, mark }, i) => (
                <tr key={i}>
                  <th scope="row">{formatDuration(at * 1000)}</th>
                  <td>{who === 'mine' ? 'You' : <Friend name={name} isCapital />}</td>
                  <td>{markName(mark)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});

/**
 * The chart, the board it drives, and the tables after them. The cursor
 * opens where the faster solve finished — the moment one of them had it
 * done, and the other had some way to go.
 */
function Comparer({
  mine,
  theirs,
  mySeconds,
  theirSeconds,
  name,
  subtitle,
}: {
  mine: Playback;
  theirs: Playback;
  mySeconds: number | null;
  theirSeconds: number;
  name: string | null;
  /** The line under the heading: the puzzle and both times, set over the chart. */
  subtitle: ReactNode;
}) {
  // A long name is cut short where it shares a narrow line with others —
  // the legend, the readout, the board's key — as in the chart's labels.
  // The heading, the times, the tables and every spoken name keep it whole.
  const chartName = name === null ? null : shortName(name);
  const myProgress = useMemo(() => progressOf(mine), [mine]);
  const theirProgress = useMemo(() => progressOf(theirs), [theirs]);
  const maxSecond = Math.max(myProgress.end, theirProgress.end);
  const [second, setSecond] = useState(() => Math.min(myProgress.end, theirProgress.end));
  const overlay = useMemo(
    () => overlayOf(overlayAt(mine, theirs, second), name),
    [mine, theirs, second, name],
  );

  const mineNow = solvedAt(myProgress, second);
  const theirsNow = solvedAt(theirProgress, second);
  const readout = readoutText(second, mineNow, theirsNow, name);

  return (
    <div className="compare">
      <div className="compare__chart">
        {subtitle}
        <ul className="compare-legend" aria-label="Key to the chart">
          <li className="compare-legend__item">
            <svg className="compare-legend__key" viewBox="0 0 28 12" aria-hidden="true">
              <line
                className="compare-chart__line compare-chart__line--mine"
                x1="1"
                x2="27"
                y1="6"
                y2="6"
              />
              <circle
                className="compare-chart__shape compare-chart__shape--mine"
                cx="22"
                cy="6"
                r="4"
              />
            </svg>
            You
          </li>
          <li className="compare-legend__item">
            <svg className="compare-legend__key" viewBox="0 0 28 12" aria-hidden="true">
              <line
                className="compare-chart__line compare-chart__line--theirs"
                x1="1"
                x2="27"
                y1="6"
                y2="6"
              />
              <circle className="compare-chart__halo" cx="22" cy="6" r="4" />
              <circle
                className="compare-chart__shape compare-chart__shape--theirs"
                cx="22"
                cy="6"
                r="4"
              />
            </svg>
            <Friend name={chartName} isCapital />
          </li>
          <li className="compare-legend__item">
            <svg
              className="compare-legend__key compare-legend__key--mark"
              viewBox="0 0 14 14"
              aria-hidden="true"
            >
              <path className="compare-legend__mark" d="M7,0.5L13,11L1,11Z" />
            </svg>
            Mistake
          </li>
          <li className="compare-legend__item">
            <svg
              className="compare-legend__key compare-legend__key--mark"
              viewBox="0 0 14 14"
              aria-hidden="true"
            >
              <path className="compare-legend__mark" d="M7,1L13,7L7,13L1,7Z" />
            </svg>
            Help
          </li>
        </ul>

        {/* For the eye: the slider below speaks the same as its value. */}
        <p className="compare-chart__readout" aria-hidden="true">
          <strong>{formatDuration(second * 1000)}</strong> — You <strong>{mineNow}</strong>{' '}
          {mineNow === 1 ? 'cell' : 'cells'}, <Friend name={chartName} />{' '}
          <strong>{theirsNow}</strong> {theirsNow === 1 ? 'cell' : 'cells'}
        </p>

        <CompareChart
          mine={myProgress}
          theirs={theirProgress}
          mySeconds={mySeconds}
          theirSeconds={theirSeconds}
          name={name}
          second={second}
          maxSecond={maxSecond}
          readout={readout}
          onSeek={setSecond}
        />
      </div>

      <div className="compare__board">
        <div className="board-area">
          <Board
            game={mine.start}
            settings={BOARD_SETTINGS}
            isPlaying={false}
            isCelebrating={false}
            onSelect={ignore}
            onToggleCandidate={ignore}
            isReadOnly
            overlay={overlay}
          />
        </div>
        <ul className="compare-key" aria-label="Key to the board">
          <li className="compare-key__item">
            <span className="compare-key__cell" aria-hidden="true">
              <Digit who="both" digit={5} />
            </span>
            Both of you
          </li>
          <li className="compare-key__item">
            <span className="compare-key__cell" aria-hidden="true">
              <Digit who="mine" digit={5} />
            </span>
            You
          </li>
          <li className="compare-key__item">
            <span className="compare-key__cell" aria-hidden="true">
              <Digit who="theirs" digit={5} />
            </span>
            <Friend name={chartName} isCapital />
          </li>
          <li className="compare-key__item">
            <span className="compare-key__cell" aria-hidden="true">
              <span className="compare-split">
                <Digit who="mine" digit={3} />
                <Digit who="theirs" digit={7} />
              </span>
            </span>
            Different
          </li>
        </ul>
      </div>

      <CompareTables mine={myProgress} theirs={theirProgress} maxSecond={maxSecond} name={name} />
    </div>
  );
}

/**
 * "Compare solves": the player's solve against a friend's, from the two move
 * logs (see `src/core/compare.ts`) — a chart of the cells each had solved
 * over play time, with their mistakes and help marked, and one board that
 * shows, at the moment the chart's cursor is on, who had filled each cell and
 * with what. Nothing plays by itself: the viewer moves the cursor.
 *
 * Offered only once the player has solved the puzzle themselves, so it gives
 * nothing away; it changes nothing — no record, count or time — and the game
 * behind it stays paused, as for any dialog. A log it cannot play back, which
 * the game never offers, says why in place of the chart.
 */
export function CompareDialog({
  givens,
  difficulty,
  puzzleName,
  mine,
  theirs,
  onClose,
}: CompareDialogProps) {
  const subtitleId = useId();
  const myPlayback = useMemo(
    () => preparePlayback(givens, difficulty, mine.log),
    [givens, difficulty, mine.log],
  );
  const theirPlayback = useMemo(
    () => preparePlayback(givens, difficulty, theirs.log),
    [givens, difficulty, theirs.log],
  );
  const { name } = theirs;
  const refusal = !myPlayback.ok
    ? myPlayback.reason
    : !theirPlayback.ok
      ? theirPlayback.reason
      : null;

  // The puzzle and both times: over the chart, so a phone on its side keeps
  // it in the chart's column; on its own over a refusal.
  const subtitle = (
    <p className="compare__subtitle" id={subtitleId}>
      {puzzleName} · You
      {mine.seconds === null
        ? ': no time recorded'
        : ` ${formatDuration(mine.seconds * 1000)}`} · <Friend name={name} isCapital />{' '}
      {formatDuration(theirs.seconds * 1000)}
    </p>
  );

  return (
    <Dialog
      title={
        <>
          You vs <Friend name={name} />
        </>
      }
      onClose={onClose}
      className="dialog--compare"
      describedBy={subtitleId}
    >
      {refusal === null && myPlayback.ok && theirPlayback.ok ? (
        <Comparer
          mine={myPlayback.playback}
          theirs={theirPlayback.playback}
          mySeconds={mine.seconds}
          theirSeconds={theirs.seconds}
          name={name}
          subtitle={subtitle}
        />
      ) : (
        <>
          {subtitle}
          <p className="compare__refusal">{REFUSAL_TEXT[refusal!]}</p>
        </>
      )}
    </Dialog>
  );
}
