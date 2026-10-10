import { useId } from 'react';
import {
  formatDuration,
  toSeconds,
  type Assists,
  type DateKey,
  type Difficulty,
  type MistakeTally,
} from '../../core';
import type { Challenge, DifficultyStats } from '../../storage/history';
import { DailyMark } from '../DailyMark';
import { PlayIcon } from '../icons';
import { dailyName, type StreakNote } from '../daily';
import { DIFFICULTY_LABEL, describeMistakes } from '../format';
import { Comparison } from './Comparison';
import { Dialog } from './Dialog';
import { assistsSentence, formatStat } from './text';
import { WATCHED_SOLVE_TEXT } from '../watch';

/** Whether the solve counted towards the streak, which its note shows with a solid mark. */
function isCounting(note: StreakNote): boolean {
  return note.kind !== 'later' && note.kind !== 'early' && note.kind !== 'watched';
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
    case 'watched':
      return "You watched a solve of it first, so it doesn't count towards your streak";
  }
}

export interface CompletionDialogProps {
  difficulty: Difficulty;
  /** The final time on the clock. */
  elapsedMs: number;
  /** The help taken during the game. */
  assists: Assists;
  /**
   * The wrong numbers and struck answers the game made (see
   * `src/core/mistakes.ts`); null when they are not known, which shows
   * nothing rather than a claim of none.
   */
  mistakes?: MistakeTally | null;
  /** Whether the time beat the tier's previous best (and had no reveals). */
  isNewBest: boolean;
  /**
   * A puzzle the player had seen before (a replay): its time does not count
   * towards their best or average, so it is never a new best, and the dialog
   * says why. Nor is it a time to race: sharing shares the puzzle alone.
   */
  isReplay?: boolean;
  /**
   * Solved after watching a friend's solve of the puzzle (see
   * `GameRecord.watched`): there is no time — the dialog says so in its
   * place, and why — so nothing to beat, to share or to race.
   */
  isWatched?: boolean;
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
  /**
   * Watch the solve played back; given only when it can be (the game was
   * recorded move by move, by this version's rules — see `isWatchable`).
   */
  onWatch?: () => void;
  /**
   * Focus opens on "Watch your solve" rather than on Share: the dialog is
   * back from the playback that button opened, so focus goes back to it.
   */
  isBackFromWatch?: boolean;
  /**
   * Watch the friend's solve the game was raced against, from the
   * head-to-head; given only when their link carried one this build plays.
   */
  onWatchFriend?: () => void;
  /** Focus opens on the friend's Watch: back from the playback it opened. */
  isBackFromFriend?: boolean;
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
 * over. Under the time, how clean the solve was: its mistakes, when known.
 * "Watch your solve" plays the game back, move by move, and brings the
 * dialog back as it closes; the head-to-head offers the friend's solve the
 * same way, when their link carried it.
 *
 * A solve after watching a friend's has no time: the dialog says so where
 * the time would be, and why, and shares the puzzle alone.
 */
export function CompletionDialog({
  difficulty,
  elapsedMs,
  assists,
  mistakes = null,
  isNewBest,
  isReplay = false,
  isWatched = false,
  stats,
  challenge,
  daily = null,
  onShare,
  onWatch,
  isBackFromWatch = false,
  onWatchFriend,
  isBackFromFriend = false,
  onNewGame,
  onClose,
}: CompletionDialogProps) {
  const ids = useId();
  const summaryId = `${ids}-summary`;
  const verdictId = `${ids}-verdict`;
  const statsId = `${ids}-stats`;
  const label = DIFFICULTY_LABEL[difficulty];
  const help = assistsSentence(assists);
  const isWatchFocused = isBackFromWatch && onWatch !== undefined;
  const isFriendFocused = isBackFromFriend && onWatchFriend !== undefined;
  // Only a time can be raced: without one, Share shares the puzzle.
  const isRaceable = !isReplay && !isWatched;

  return (
    <Dialog
      title="Solved!"
      onClose={onClose}
      className="dialog--completion"
      // Focus opens on the Share button (or, back from watching, on Watch your
      // solve), past all of this; the summary and the
      // verdict are what the dialog is for, so they are read on the way in.
      describedBy={challenge === null ? summaryId : `${summaryId} ${verdictId}`}
      footer={
        <>
          <button
            type="button"
            className="button button--primary"
            data-autofocus={isWatchFocused || isFriendFocused ? undefined : true}
            onClick={onShare}
          >
            {isRaceable ? 'Share your time' : 'Share puzzle'}
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
        {isWatched ? (
          <p className="result__note result__note--watched">{WATCHED_SOLVE_TEXT}.</p>
        ) : (
          <p className="result__time">{formatDuration(elapsedMs)}</p>
        )}
        {isNewBest && isRaceable && <p className="result__badge">New best!</p>}
        {mistakes !== null && <p className="result__mistakes">{describeMistakes(mistakes)}</p>}
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
        {isReplay && !isWatched && (
          <p className="result__note">
            You&apos;d played this puzzle before, so this time doesn&apos;t count towards your best
            or average.
          </p>
        )}
      </div>

      {/* Out of the summary the dialog is described by, and out of the
          footer, which keeps to what to do next: a look back at the solve. */}
      {onWatch !== undefined && (
        <p className="result__watch">
          <button
            type="button"
            className="button button--small"
            data-autofocus={isWatchFocused || undefined}
            onClick={onWatch}
          >
            <PlayIcon />
            Watch your solve
          </button>
        </p>
      )}

      {challenge !== null && (
        <Comparison
          mySeconds={isWatched ? null : toSeconds(elapsedMs)}
          myAssists={assists}
          myMistakes={mistakes}
          challenge={challenge}
          verdictId={verdictId}
          onWatch={onWatchFriend}
          isWatchFocused={isFriendFocused}
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
