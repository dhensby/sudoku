import { useId, useState } from 'react';
import { dateKeyOf, formatDuration, toSeconds, type DateKey, type Difficulty } from '../../core';
import {
  hasRecordedTime,
  recordedMistakes,
  type Challenge,
  type GameRecord,
} from '../../storage/history';
import { DIFFICULTY_LABEL, describeMistakes, formatDate, formatDay } from '../format';
import { Comparison } from './Comparison';
import { Dialog } from './Dialog';
import { assistsSentence } from './text';

export interface ChallengeDialogProps {
  difficulty: Difficulty;
  /**
   * The player's earlier solve of the linked puzzle: the newest that counted
   * towards their records, or a replay's only when there is no other (see
   * `planStartup`).
   */
  previous: GameRecord;
  /** The result the link carried, if any. */
  challenge: Challenge | null;
  /** The date of the daily the puzzle is, if it is one (a solved daily chosen from New game, or a link to one). */
  daily?: DateKey | null;
  onPlayAgain: () => void;
  /**
   * Watch the friend's solve the link carried — free, as the puzzle is
   * solved; given only when there is one this build plays back.
   */
  onWatch?: () => void;
  /** Focus opens on that Watch rather than Play again: back from the playback it opened. */
  isBackFromWatch?: boolean;
  onClose: () => void;
}

/**
 * When a puzzle was solved, phrased to sit mid-sentence: "today at 14:05",
 * "yesterday at 09:12", "on 3 Oct". Built on `formatDate`, so the calendar
 * rules (local days, the year only when it differs) stay in one place.
 */
function whenSolved(epochMs: number, now: number): string {
  const date = formatDate(epochMs, now);
  const recent = /^(Today|Yesterday) (.*)$/.exec(date);
  return recent === null ? `on ${date}` : `${recent[1].toLowerCase()} at ${recent[2]}`;
}

/**
 * Opening a puzzle already solved — from a link, or a solved daily chosen
 * from New game: say so, with the help and mistakes it took (the mistakes
 * when known), compare with the link's time if it carried one, and offer a
 * fresh attempt. Closing keeps whatever game was on screen. A link that
 * carried the friend's solve offers it to watch, under the head-to-head:
 * the puzzle is solved, so it gives nothing away. An earlier solve after
 * watching one has no time, and says so.
 */
export function ChallengeDialog({
  difficulty,
  previous,
  challenge,
  daily = null,
  onPlayAgain,
  onWatch,
  isBackFromWatch = false,
  onClose,
}: ChallengeDialogProps) {
  const ids = useId();
  // Read once: the dialog is a snapshot, and "today" should not change under it.
  const [now] = useState(() => Date.now());
  const summaryId = `${ids}-summary`;
  const verdictId = `${ids}-verdict`;
  const help = assistsSentence(previous.assists);
  const mistakes = recordedMistakes(previous);
  // A solved record always has completedAt; the fallback only guards a hand-edited one.
  const solvedAt = previous.completedAt ?? previous.updatedAt;
  const isTimed = hasRecordedTime(previous);
  const isWatchFocused = isBackFromWatch && onWatch !== undefined;

  return (
    <Dialog
      title="You've solved this one"
      onClose={onClose}
      className="dialog--challenge"
      describedBy={challenge === null ? summaryId : `${summaryId} ${verdictId}`}
      footer={
        <>
          <button
            type="button"
            className="button button--primary"
            data-autofocus={isWatchFocused ? undefined : true}
            onClick={onPlayAgain}
          >
            Play again
          </button>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="challenge" id={summaryId}>
        <p className="challenge__summary">
          You solved{' '}
          {daily === null
            ? `this ${DIFFICULTY_LABEL[difficulty]} puzzle`
            : `the ${DIFFICULTY_LABEL[difficulty]} daily for ${formatDay(daily, dateKeyOf(now))}`}{' '}
          {isTimed ? `in ${formatDuration(previous.elapsedMs)}` : 'after watching a solve'}{' '}
          {whenSolved(solvedAt, now)}.
        </p>
        {help !== null && <p className="challenge__assists">{help}.</p>}
        {mistakes !== null && <p className="challenge__mistakes">{describeMistakes(mistakes)}.</p>}
      </div>
      {challenge !== null && (
        <Comparison
          mySeconds={isTimed ? toSeconds(previous.elapsedMs) : null}
          myAssists={previous.assists}
          myMistakes={mistakes}
          challenge={challenge}
          verdictId={verdictId}
          onWatch={onWatch}
          isWatchFocused={isWatchFocused}
        />
      )}
    </Dialog>
  );
}
