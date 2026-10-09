import type { ReactNode } from 'react';
import { formatDuration, type Assists } from '../../core';
import type { Challenge } from '../../storage/history';

/** How one time compares with another. */
export interface TimeComparison {
  /** From the first time's point of view. */
  result: 'faster' | 'slower' | 'tie';
  /** The gap in whole seconds; 0 for a tie. */
  differenceSeconds: number;
}

/**
 * Compare the player's time with a challenger's, in whole seconds — the unit
 * times are shared in, so a link's 5:23 and a clock's 5:23.9 are a dead heat
 * rather than a defeat by a fraction nobody was shown. Inputs are floored to
 * hold that even for a caller that passes raw seconds.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, unit-tested directly
export function compareTimes(mySeconds: number, theirSeconds: number): TimeComparison {
  const difference = Math.floor(theirSeconds) - Math.floor(mySeconds);
  if (difference > 0) return { result: 'faster', differenceSeconds: difference };
  if (difference < 0) return { result: 'slower', differenceSeconds: -difference };
  return { result: 'tie', differenceSeconds: 0 };
}

/** One player's column of the head-to-head: what they did, row by row. */
interface ComparisonSide {
  assists: Assists;
}

/**
 * A row of the head-to-head below the times. Rows are data rather than
 * markup so a new kind of thing to compare (mistakes, say) is one more entry
 * in a list, with the table, its order and its hiding rules untouched.
 */
interface ComparisonRow {
  /** The row's heading, which a screen reader reads before each cell. */
  label: string;
  /**
   * What a player's cell says: a node rather than a string, so a cell can
   * carry words for a screen reader alone (a dash a sighted player reads as
   * "not recorded", say).
   */
  value: (side: ComparisonSide) => ReactNode;
  /** Whether the row is worth a line: help neither player took is not. */
  shows: (mine: ComparisonSide, theirs: ComparisonSide) => boolean;
}

/**
 * A run of rows about one kind of thing, in the order they're read. When
 * none of a group's rows shows, its `none` line stands in their place, so
 * "no help" is said where the help would have been — and stays there, not
 * at the foot of the table, once another group follows it.
 */
interface ComparisonGroup {
  /** A key for the group's rows, unique in the table. */
  key: string;
  rows: readonly ComparisonRow[];
  /** Said across both columns when none of the rows shows. */
  none: string;
}

/** A count of some help, shown only when either player took any. */
function helpCount(label: string, of: (assists: Assists) => number): ComparisonRow {
  return {
    label,
    value: (side) => String(of(side.assists)),
    shows: (mine, theirs) => of(mine.assists) > 0 || of(theirs.assists) > 0,
  };
}

/**
 * The help a time can come with, in the order the rest of the game lists it
 * (see `describeAssists`), so the table and the share text read alike.
 */
const HELP_ROWS: readonly ComparisonRow[] = [
  {
    label: 'Auto candidates',
    value: (side) => (side.assists.autoCandidates ? 'Yes' : 'No'),
    shows: (mine, theirs) => mine.assists.autoCandidates || theirs.assists.autoCandidates,
  },
  helpCount('Hints', (assists) => assists.hints),
  helpCount('Checks', (assists) => assists.checks),
  helpCount('Reveals', (assists) => assists.reveals),
];

/** The groups under the times, top to bottom. */
const GROUPS: readonly ComparisonGroup[] = [
  { key: 'help', rows: HELP_ROWS, none: 'Neither of you took any help.' },
];

/**
 * A time, with a place to break after the hours. A link can claim thousands
 * of hours, which can't fit a phone's column on one line; given somewhere
 * sensible to break, the browser never splits the minutes and seconds
 * themselves (a colon between digits is no break point of its own).
 */
function timeText(seconds: number): ReactNode {
  const text = formatDuration(seconds * 1000);
  const [hours, rest] = text.split(/:(?=\d\d:)/);
  if (rest === undefined) return text;
  return (
    <>
      {hours}:<wbr />
      {rest}
    </>
  );
}

export interface ComparisonProps {
  /** The player's time in whole seconds. */
  mySeconds: number;
  /** The help the player's time came with. */
  myAssists: Assists;
  challenge: Challenge;
  /** An id for the verdict line, so a dialog can point `aria-describedby` at it. */
  verdictId?: string;
}

/** Who won, in words; `name` is null for a challenger whose link gave none. */
function verdictFor(comparison: TimeComparison, name: ReactNode | null): ReactNode {
  const gap = formatDuration(comparison.differenceSeconds * 1000);
  if (comparison.result === 'faster') {
    return (
      <>
        You were {gap} faster than {name ?? 'your friend'}!
      </>
    );
  }
  if (comparison.result === 'slower') {
    return (
      <>
        {name ?? 'Your friend'} was {gap} faster.
      </>
    );
  }
  return 'A dead heat!';
}

/**
 * The two results as a table — a column for each player, a row for the time
 * and for each kind of help either of them took — so each kind of help sits
 * on one line and reads straight across. The verdict under it is on time
 * alone: help is shown for fairness, never scored.
 *
 * Names come from links strangers can write, so they sit inside <bdi>: a
 * right-to-left name would otherwise pull the punctuation and time beside it
 * into its own direction.
 */
export function Comparison({ mySeconds, myAssists, challenge, verdictId }: ComparisonProps) {
  const comparison = compareTimes(mySeconds, challenge.seconds);
  const { result } = comparison;
  const name = challenge.name === null ? null : <bdi>{challenge.name}</bdi>;
  const mine: ComparisonSide = { assists: myAssists };
  const theirs: ComparisonSide = { assists: challenge.assists };

  // The faster time is marked by weight and a rule as well as by colour, so
  // it still stands out without colour (and in Windows High Contrast).
  const timeClass = (won: boolean) =>
    `comparison__value comparison__time${won ? ' comparison__time--winner' : ''}`;

  return (
    <section className="comparison" aria-label="Head to head">
      <table className="comparison__table">
        {/* Names the table for a screen reader; sighted, the columns say it. */}
        <caption className="visually-hidden">Your time and help, and your friend&apos;s</caption>
        <thead>
          <tr>
            {/* The corner over the row headings; a <td>, as it heads nothing. */}
            <td className="comparison__corner" />
            <th className="comparison__who" scope="col">
              You
            </th>
            {/* A long name is cut short with an ellipsis, and on a tie the
                verdict doesn't repeat it, so a pointer can read it here. */}
            <th className="comparison__who" scope="col" title={challenge.name ?? undefined}>
              {name ?? 'Your friend'}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="comparison__label" scope="row">
              Time
            </th>
            <td className={timeClass(result === 'faster')}>{timeText(mySeconds)}</td>
            <td className={timeClass(result === 'slower')}>{timeText(challenge.seconds)}</td>
          </tr>
          {GROUPS.map(({ key, rows, none }) => {
            const shown = rows.filter((row) => row.shows(mine, theirs));
            if (shown.length === 0) {
              return (
                <tr key={key}>
                  <td className="comparison__none" colSpan={3}>
                    {none}
                  </td>
                </tr>
              );
            }
            return shown.map((row) => (
              <tr key={`${key}:${row.label}`}>
                <th className="comparison__label" scope="row">
                  {row.label}
                </th>
                <td className="comparison__value">{row.value(mine)}</td>
                <td className="comparison__value">{row.value(theirs)}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
      <p className="comparison__verdict" id={verdictId}>
        {verdictFor(comparison, name)}
      </p>
    </section>
  );
}
