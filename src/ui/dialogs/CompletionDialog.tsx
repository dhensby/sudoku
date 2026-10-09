import { useId } from 'react';
import { formatDuration, toSeconds, type Assists, type DateKey, type Difficulty } from '../../core';
import type { Challenge, DifficultyStats } from '../../storage/history';
import { DailyMark } from '../DailyMark';
import { dailyName, type StreakNote } from '../daily';
import { DIFFICULTY_LABEL } from '../format';
import { Comparison } from './Comparison';
import { Dialog } from './Dialog';
import { assistsSentence, formatStat } from './text';

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
 * A daily is named ("Daily · 13 Oct · Hard") and followed by its tier's
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
        <Comparison
          mySeconds={toSeconds(elapsedMs)}
          myAssists={assists}
          challenge={challenge}
          verdictId={verdictId}
        />
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
