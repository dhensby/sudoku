import { useId, type ReactNode } from 'react';
import { formatDuration, toSeconds, type Assists, type DateKey, type Difficulty } from '../../core';
import type { Challenge, DifficultyStats } from '../../storage/history';
import { DailyMark } from '../DailyMark';
import { dailyName, type StreakNote } from '../daily';
import { DIFFICULTY_LABEL, describeAssists } from '../format';
import { Dialog } from './Dialog';
import { assistsSentence, formatStat } from './text';

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

export interface ComparisonProps {
  /** The player's time in whole seconds. */
  mySeconds: number;
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
 * Both times side by side and who won. Names come from links strangers can
 * write, so they sit inside <bdi>: a right-to-left name would otherwise pull
 * the punctuation and time beside it into its own direction.
 */
export function Comparison({ mySeconds, challenge, verdictId }: ComparisonProps) {
  const comparison = compareTimes(mySeconds, challenge.seconds);
  const { result } = comparison;
  const name = challenge.name === null ? null : <bdi>{challenge.name}</bdi>;
  const theirAssists = describeAssists(challenge.assists);

  return (
    <section className="comparison" aria-label="Head to head">
      <dl className="comparison__times">
        <div
          className={`comparison__entry${result === 'faster' ? ' comparison__entry--winner' : ''}`}
        >
          <dt className="comparison__who">You</dt>
          <dd className="comparison__time">{formatDuration(mySeconds * 1000)}</dd>
        </div>
        <div
          className={`comparison__entry${result === 'slower' ? ' comparison__entry--winner' : ''}`}
        >
          {/* The name is cut short with an ellipsis when it is long, and on a
              tie the verdict doesn't repeat it, so a pointer can read it here. */}
          <dt className="comparison__who" title={challenge.name ?? undefined}>
            {name ?? 'Your friend'}
          </dt>
          <dd className="comparison__time">{formatDuration(challenge.seconds * 1000)}</dd>
          {theirAssists !== null && <dd className="comparison__assists">With {theirAssists}</dd>}
        </div>
      </dl>
      <p className="comparison__verdict" id={verdictId}>
        {verdictFor(comparison, name)}
      </p>
    </section>
  );
}

/** Whether the solve counted towards the streak, which its note shows with a solid mark. */
function isCounting(note: StreakNote): boolean {
  return note.kind !== 'later' && note.kind !== 'early';
}

/** What the streak note says (see `StreakNote`), with the tier's name in it. */
function streakText(note: StreakNote, label: string): string {
  switch (note.kind) {
    case 'streak':
      return `${label} streak: ${note.days} ${note.days === 1 ? 'day' : 'days'}`;
    case 'started':
      return `That starts a ${label} streak`;
    case 'counted':
      return `Begun on its day, so it counts towards your ${label} streak`;
    case 'later':
      return "Played on a later day, so it doesn't count towards your streak";
    case 'early':
      return "Started before its day began here, so it doesn't count towards your streak";
  }
}

export interface CompletionDialogProps {
  difficulty: Difficulty;
  /** The final time on the clock. */
  elapsedMs: number;
  /** The help taken during the game. */
  assists: Assists;
  /** Whether the time beat the tier's previous best (and had no reveals). */
  isNewBest: boolean;
  /**
   * A puzzle the player had seen before (a replay): its time does not count
   * towards their best or average, so it is never a new best, and the dialog
   * says why. Nor is it a time to race: sharing shares the puzzle alone.
   */
  isReplay?: boolean;
  /** The tier's stats, this game included. */
  stats: DifficultyStats;
  /** The result this game was raced against, from the link it came from. */
  challenge: Challenge | null;
  /**
   * The daily the game was, if it was one: the dialog names it, and says
   * what the solve did for the tier's streak.
   */
  daily?: { date: DateKey; today: DateKey; streak: StreakNote } | null;
  /** Share the time — or, after a replay, the puzzle alone. */
  onShare: () => void;
  onNewGame: () => void;
  onClose: () => void;
}

/**
 * What a solve earns: the time, the help it took, how it went against a
 * friend's link, and the tier's record so far. Opens on "Share your time",
 * the thing most worth doing next — "Share puzzle" after a replay, whose time
 * was set on a board seen before and is no fair one to send a friend.
 * Closing leaves the solved board on show.
 *
 * A daily is named ("Daily · 6 Oct · Hard") and followed by its tier's
 * streak — begun, run on, or not counted, for a day played after it was
 * over.
 */
export function CompletionDialog({
  difficulty,
  elapsedMs,
  assists,
  isNewBest,
  isReplay = false,
  stats,
  challenge,
  daily = null,
  onShare,
  onNewGame,
  onClose,
}: CompletionDialogProps) {
  const ids = useId();
  const summaryId = `${ids}-summary`;
  const verdictId = `${ids}-verdict`;
  const statsId = `${ids}-stats`;
  const label = DIFFICULTY_LABEL[difficulty];
  const help = assistsSentence(assists);

  return (
    <Dialog
      title="Solved!"
      onClose={onClose}
      className="dialog--completion"
      // Focus opens on the Share button, past all of this; the summary and the
      // verdict are what the dialog is for, so they are read on the way in.
      describedBy={challenge === null ? summaryId : `${summaryId} ${verdictId}`}
      footer={
        <>
          <button type="button" className="button button--primary" data-autofocus onClick={onShare}>
            {isReplay ? 'Share puzzle' : 'Share your time'}
          </button>
          <button type="button" className="button" onClick={onNewGame}>
            New game
          </button>
        </>
      }
    >
      <div className="result" id={summaryId}>
        <p className="result__difficulty">
          {daily === null ? label : dailyName(daily.date, difficulty, daily.today)}
        </p>
        <p className="result__time">{formatDuration(elapsedMs)}</p>
        {isNewBest && !isReplay && <p className="result__badge">New best!</p>}
        {daily !== null && (
          <p
            className={
              isCounting(daily.streak) ? 'result__streak' : 'result__streak result__streak--none'
            }
          >
            {isCounting(daily.streak) && <DailyMark status="solved-on-the-day" />}
            {streakText(daily.streak, label)}
          </p>
        )}
        {help !== null && <p className="result__assists">{help}</p>}
        {isReplay && (
          <p className="result__note">
            You&apos;d played this puzzle before, so this time doesn&apos;t count towards your best
            or average.
          </p>
        )}
      </div>

      {challenge !== null && (
        <Comparison mySeconds={toSeconds(elapsedMs)} challenge={challenge} verdictId={verdictId} />
      )}

      <section className="stats" aria-labelledby={statsId}>
        <h3 className="stats__heading" id={statsId}>
          Your {label} record
        </h3>
        <dl className="stats__list">
          <div className="stats__item">
            <dt className="stats__label">Solved</dt>
            <dd className="stats__value">{stats.solved}</dd>
          </div>
          <div className="stats__item">
            <dt className="stats__label">Best</dt>
            <dd className="stats__value">{formatStat(stats.bestMs)}</dd>
          </div>
          <div className="stats__item">
            <dt className="stats__label">Average</dt>
            <dd className="stats__value">{formatStat(stats.averageMs)}</dd>
          </div>
        </dl>
      </section>
    </Dialog>
  );
}
