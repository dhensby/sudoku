import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { dateKeyOf, formatDuration, type Difficulty } from '../../core';
import {
  computeStats,
  recordedMistakes,
  type DifficultyStats,
  type GameRecord,
  type ImportResult,
} from '../../storage/history';
import { DIFFICULTIES } from '../../storage/storage';
import {
  DIFFICULTY_LABEL,
  count,
  describeMistakes,
  describeResult,
  formatDate,
  formatDay,
} from '../format';
import { DownloadIcon, UploadIcon } from '../icons';
import { WATCHED_RECORD_TEXT, watchFriendLabel } from '../watch';
import { WatchFriendText } from '../WatchFriendText';
import { Dialog } from './Dialog';
import { assistChips, formatStat } from './text';

export interface HistoryDialogProps {
  /** Every record, newest first (as `loadHistory` returns them). */
  records: readonly GameRecord[];
  /** The game on screen, marked "Current" and never offered for resuming. */
  currentId: string | null;
  /** Ids whose in-progress state is saved (can be resumed rather than replayed). */
  resumableIds: ReadonlySet<string>;
  /** The time to date records against ("Today 14:05"). */
  now: number;
  onResume: (id: string) => void;
  onReplay: (id: string) => void;
  onShare: (id: string) => void;
  /**
   * Whether a row's game can be watched played back (a solved game with a
   * log this version replays). Asked only of the rows built; keep it stable,
   * as every row is memoised on it.
   */
  canWatch?: (record: GameRecord) => boolean;
  /** Watch a row's solve, from the list as it is now (`place`), to come back to as it closes. */
  onWatch?: (id: string, place: HistoryPlace) => void;
  /**
   * Whether a row offers the solve of the friend its game was raced against
   * (a solved game whose challenge carried one this version plays). Asked
   * only of the rows built; keep it stable, as every row is memoised on it.
   */
  canWatchChallenge?: (record: GameRecord) => boolean;
  /** Watch the friend's solve a row's game was raced against, from the list as it is now. */
  onWatchChallenge?: (id: string, place: HistoryPlace) => void;
  /**
   * The list as it was when a game was watched from it: it opens the same —
   * filtered, as long, and with focus on that row's Watch, scrolled to —
   * rather than back at the top of every game.
   */
  place?: HistoryPlace | null;
  onDelete: (id: string) => void;
  /** Returns the export JSON; the dialog turns it into a download. */
  onExport: () => string;
  onImport: (json: string) => ImportResult;
  onClose: () => void;
}

type Filter = 'all' | Difficulty;

/** Where the list was when a game was watched from it (see `HistoryDialogProps.place`). */
export interface HistoryPlace {
  readonly filter: Filter;
  /** How many rows were built ("Show more" adds a page). */
  readonly limit: number;
  /** The row whose Watch was pressed: focus goes back to it. */
  readonly id: string;
  /** Which of its Watch buttons: the player's own solve (the default), or the friend's. */
  readonly solve?: 'own' | 'friend';
}

const FILTERS: readonly Filter[] = ['all', ...DIFFICULTIES];
const FILTER_LABEL: Readonly<Record<Filter, string>> = { all: 'All', ...DIFFICULTY_LABEL };

/**
 * How long a download's object URL is kept. Revoking it in the same task as
 * the click can cancel the download in some browsers (the fetch starts
 * asynchronously); a few seconds is plenty, and the blob is small.
 */
const REVOKE_DELAY_MS = 10_000;

/**
 * Rows built at first, and added per "Show more". A full history is a
 * thousand games with four buttons each, and building all of that on open
 * makes the dialog visibly slow to appear on a phone — for rows almost nobody
 * scrolls down to.
 */
const PAGE_SIZE = 100;

/** The defaults for a list with no playback: nothing to watch. */
const NEVER = () => false;
const IGNORE = () => {};

/** `sudoku-history-2026-10-05.json`, dated in local time like everything else the player sees. */
function exportFileName(now: number): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `sudoku-history-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

function importMessage(result: ImportResult): string {
  if (!result.ok) return "That file isn't a Sudoku history export.";
  if (result.added === 0 && result.updated === 0) {
    return 'Nothing new to import — those games are already here.';
  }
  return `Imported ${count(result.added, 'new game')}, updated ${result.updated}.`;
}

interface Status {
  text: string;
  id: number;
}

interface HistoryRowProps {
  record: GameRecord;
  now: number;
  isCurrent: boolean;
  /** Unfinished, saved, and not already on screen. */
  isResumable: boolean;
  /** Solved, or unfinished with nothing saved to resume (see `canReplay`). */
  canReplay: boolean;
  /** Solved, with a log that plays back. */
  canWatch: boolean;
  /** Solved, raced against a friend whose link carried a solve that plays back. */
  canWatchChallenge: boolean;
  /**
   * A solve of the row's was just watched — its own, or the friend's: focus
   * goes back to that Watch as the list comes back. Null for every other row.
   */
  watched: 'own' | 'friend' | null;
  isConfirming: boolean;
  onResume: (id: string) => void;
  onReplay: (id: string) => void;
  onShare: (id: string) => void;
  onWatch: (id: string) => void;
  onWatchChallenge: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}

/**
 * One game in the list. Memoised: the list can hold a thousand of these, and
 * opening one row's delete confirmation, or an import message appearing,
 * should re-render that row or nothing — not the whole history.
 */
const HistoryRow = memo(function HistoryRow({
  record,
  now,
  isCurrent,
  isResumable,
  canReplay,
  canWatch,
  canWatchChallenge,
  watched,
  isConfirming,
  onResume,
  onReplay,
  onShare,
  onWatch,
  onWatchChallenge,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: HistoryRowProps) {
  const { id, difficulty, status, elapsedMs, assists, challenge } = record;
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the row has swapped its buttons. Set only by this
  // row's own handlers, so a row that leaves confirmation because another
  // row entered it never takes focus back from that row.
  const pendingFocus = useRef<'delete' | 'cancel' | null>(null);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    (pendingFocus.current === 'cancel' ? cancelRef : deleteRef).current?.focus();
    pendingFocus.current = null;
  });

  const date = formatDate(record.createdAt, now);
  const label = DIFFICULTY_LABEL[difficulty];
  // "13 Oct": the daily's own date, which need not be the day it was played.
  const day = record.daily === undefined ? null : formatDay(record.daily, dateKeyOf(now));
  // Every row has the same few buttons, so each name carries the row: "Delete"
  // alone, read out of context by a screen reader's button list, is a guess.
  const context =
    day === null ? `${label} puzzle from ${date}` : `${label} daily for ${day}, from ${date}`;
  const chips = assistChips(assists);
  // How the friend's time was earned: their help, and their mistakes when
  // their link said them — the line their share text and Ready card had.
  const challengerHelp =
    challenge === null ? null : describeResult(challenge.assists, challenge.mistakes ?? null);
  // Solved games only: an unfinished game's count would work as a free Check.
  const mistakes = recordedMistakes(record);

  const cancel = () => {
    pendingFocus.current = 'delete';
    onCancelDelete();
  };

  // On both confirmation buttons: Escape backs out of the confirmation rather
  // than closing the whole dialog (which skips keys claimed with preventDefault).
  const handleConfirmKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancel();
  };

  return (
    <li className={`history-item${isCurrent ? ' history-item--current' : ''}`}>
      <div className="history-item__info">
        <p className="history-item__heading">
          <span className="history-item__difficulty">{label}</span>
          {day !== null && <span className="history-item__daily">Daily · {day}</span>}
          <span className="history-item__date">{date}</span>
          {isCurrent && <span className="history-item__current">Current</span>}
        </p>
        <p className="history-item__status">
          {status === 'playing' && `In progress · ${formatDuration(elapsedMs)}`}
          {status === 'solved' &&
            (record.watched === true
              ? WATCHED_RECORD_TEXT
              : `Solved in ${formatDuration(elapsedMs)}`)}
          {mistakes !== null && ` · ${describeMistakes(mistakes)}`}
        </p>
        {chips.length > 0 && (
          <ul className="history-item__chips" aria-label="Help used">
            {chips.map((chip) => (
              <li className="history-item__chip" key={chip}>
                {chip}
              </li>
            ))}
          </ul>
        )}
        {challenge !== null && (
          <p className="history-item__challenge">
            vs {challenge.name === null ? 'your friend' : <bdi>{challenge.name}</bdi>}{' '}
            {formatDuration(challenge.seconds * 1000)}
            {/* The friend's help and mistakes, on a quieter line of its own:
                they qualify their time, so they stay with it rather than
                among the chips, which are this game's own help. */}
            {challengerHelp !== null && (
              <>
                {' '}
                <span className="history-item__challenge-help">{challengerHelp}</span>
              </>
            )}
          </p>
        )}
      </div>

      {isConfirming ? (
        <div
          className="history-item__actions history-item__actions--confirm"
          role="group"
          aria-label={`Delete ${context}?`}
        >
          <button
            type="button"
            className="button button--danger button--small"
            aria-label={`Confirm delete, ${context}`}
            onClick={() => onConfirmDelete(id)}
            onKeyDown={handleConfirmKey}
          >
            Confirm delete
          </button>
          {/* Last, where Delete was: a double-click on Delete lands on Cancel. */}
          <button
            type="button"
            className="button button--small"
            ref={cancelRef}
            aria-label={`Cancel deleting ${context}`}
            onClick={cancel}
            onKeyDown={handleConfirmKey}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="history-item__actions">
          {isResumable && (
            <button
              type="button"
              className="button button--primary button--small"
              aria-label={`Resume ${context}`}
              onClick={() => onResume(id)}
            >
              Resume
            </button>
          )}
          {canReplay && (
            <button
              type="button"
              className="button button--small"
              aria-label={`Play again, ${context}`}
              onClick={() => onReplay(id)}
            >
              Play again
            </button>
          )}
          {canWatch && (
            <button
              type="button"
              className="button button--small"
              aria-label={`Watch your solve, ${context}`}
              data-autofocus={watched === 'own' || undefined}
              onClick={() => onWatch(id)}
            >
              Watch
            </button>
          )}
          {canWatchChallenge && challenge !== null && (
            <button
              type="button"
              className="button button--small button--wraps"
              aria-label={`${watchFriendLabel(challenge.name)}, ${context}`}
              data-autofocus={watched === 'friend' || undefined}
              onClick={() => onWatchChallenge(id)}
            >
              <WatchFriendText name={challenge.name} />
            </button>
          )}
          <button
            type="button"
            className="button button--small"
            aria-label={`Share ${context}`}
            onClick={() => onShare(id)}
          >
            Share
          </button>
          <button
            type="button"
            className="button button--ghost button--small history-item__delete"
            ref={deleteRef}
            aria-label={`Delete ${context}`}
            onClick={() => {
              pendingFocus.current = 'cancel';
              onRequestDelete(id);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
});

/**
 * Whether a row offers Play again: a solved game, to start afresh, or an
 * unfinished one whose saved board is gone (pruned), which can only be begun
 * again. An unfinished game that can be resumed offers Resume alone — Play
 * again would only resume it too — and the game on screen, still being
 * played, offers neither: it is already in front of the player.
 */
function canReplay(record: GameRecord, isCurrent: boolean, isSaved: boolean): boolean {
  return record.status === 'solved' || (!isCurrent && !isSaved);
}

/** Played, solved, best and average for one tier, as four tiles. */
function TierStats({ label, stats }: { label: string; stats: DifficultyStats }) {
  return (
    <section className="stats" aria-label={`${label} stats`}>
      <dl className="stats__list">
        <div className="stats__item">
          <dt className="stats__label">Played</dt>
          <dd className="stats__value">{stats.played}</dd>
        </div>
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
  );
}

/** Every tier at once, one row each: the "All" summary. */
function AllStats({ stats }: { stats: Record<Difficulty, DifficultyStats> }) {
  return (
    <table className="stats-table">
      <caption className="stats-table__caption">Stats by level</caption>
      <thead>
        <tr>
          <th scope="col">Level</th>
          <th scope="col">Played</th>
          <th scope="col">Solved</th>
          <th scope="col">Best</th>
          <th scope="col">Average</th>
        </tr>
      </thead>
      <tbody>
        {DIFFICULTIES.map((difficulty) => (
          <tr key={difficulty}>
            <th scope="row">{DIFFICULTY_LABEL[difficulty]}</th>
            <td>{stats[difficulty].played}</td>
            <td>{stats[difficulty].solved}</td>
            <td>{formatStat(stats[difficulty].bestMs)}</td>
            <td>{formatStat(stats[difficulty].averageMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Every game played, finished or not: stats per tier, and a list to resume,
 * replay, watch (a solve played back — the player's own, or the friend's it was raced against),
 * share or delete from — each row's actions on a line of their own
 * under what it says, so the list reads the same whichever a row offers.
 * Export and import keep the history safe from a browser that clears site
 * data (Safari does after a week away).
 */
export function HistoryDialog({
  records,
  currentId,
  resumableIds,
  now,
  onResume,
  onReplay,
  onShare,
  canWatch = NEVER,
  onWatch = IGNORE,
  canWatchChallenge = NEVER,
  onWatchChallenge = IGNORE,
  place = null,
  onDelete,
  onExport,
  onImport,
  onClose,
}: HistoryDialogProps) {
  const ids = useId();
  const [filter, setFilter] = useState<Filter>(place?.filter ?? 'all');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const tabRefs = useRef<Partial<Record<Filter, HTMLButtonElement | null>>>({});
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [limit, setLimit] = useState(place?.limit ?? PAGE_SIZE);
  const listRef = useRef<HTMLOListElement>(null);
  // The row to focus once "Show more" has rendered it.
  const focusRow = useRef<number | null>(null);

  useEffect(() => {
    if (focusRow.current === null) return;
    listRef.current?.children[focusRow.current].querySelector('button')?.focus();
    focusRow.current = null;
  });

  // Stats per tier don't depend on the filter — a tier's own records give the
  // same numbers as the full list — so they are worked out once per history.
  const stats = useMemo(() => computeStats(records), [records]);
  const shown = useMemo(
    () => (filter === 'all' ? records : records.filter((record) => record.difficulty === filter)),
    [records, filter],
  );
  const visible = useMemo(() => shown.slice(0, limit), [shown, limit]);
  const remaining = shown.length - visible.length;

  const choose = (next: Filter) => {
    setFilter(next);
    setConfirmingId(null);
    setLimit(PAGE_SIZE);
  };

  const showMore = () => {
    // Focus moves to the first game added: it is where reading carries on,
    // and on the last page this button is about to go.
    focusRow.current = limit;
    setLimit(limit + PAGE_SIZE);
  };

  const handleTabKey = (event: React.KeyboardEvent) => {
    const at = FILTERS.indexOf(filter);
    let next: number;
    if (event.key === 'ArrowRight') next = (at + 1) % FILTERS.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + FILTERS.length) % FILTERS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = FILTERS.length - 1;
    else return;
    event.preventDefault();
    choose(FILTERS[next]);
    tabRefs.current[FILTERS[next]]?.focus();
  };

  // Kept as stable as the list it is watched from: every row is memoised on it.
  const watch = useCallback(
    (id: string) => onWatch(id, { filter, limit, id }),
    [onWatch, filter, limit],
  );
  const watchChallenge = useCallback(
    (id: string) => onWatchChallenge(id, { filter, limit, id, solve: 'friend' }),
    [onWatchChallenge, filter, limit],
  );
  const requestDelete = useCallback((id: string) => setConfirmingId(id), []);
  const cancelDelete = useCallback(() => setConfirmingId(null), []);
  const confirmDelete = useCallback(
    (id: string) => {
      setConfirmingId(null);
      // The row is about to go, and its focused button with it. The filter
      // tabs stay while any game is left; after the last, only the footer does.
      const target = records.length > 1 ? tabRefs.current[filter] : importButtonRef.current;
      target?.focus();
      onDelete(id);
    },
    [records.length, filter, onDelete],
  );

  const say = (text: string) => setStatus((previous) => ({ text, id: (previous?.id ?? 0) + 1 }));

  const handleExport = () => {
    const blob = new Blob([onExport()], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = exportFileName(now);
    // Firefox only follows a click on a link that is in the document.
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), REVOKE_DELAY_MS);
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Cleared at once, so picking the same file again still fires a change.
    input.value = '';
    if (file === undefined) return;
    let result: ImportResult;
    try {
      result = onImport(await file.text());
    } catch {
      // Unreadable (moved, permission revoked) is as useless as malformed.
      result = { ok: false };
    }
    say(importMessage(result));
  };

  const tabId = (f: Filter) => `${ids}-tab-${f}`;
  const panelId = `${ids}-panel`;

  return (
    <Dialog
      title="History"
      onClose={onClose}
      className="dialog--wide dialog--history"
      footer={
        <>
          <p className="history__status" role="status">
            {status && <span key={status.id}>{status.text}</span>}
          </p>
          <button
            type="button"
            className="button"
            disabled={records.length === 0}
            onClick={handleExport}
          >
            <DownloadIcon />
            Export
          </button>
          <button
            type="button"
            className="button"
            ref={importButtonRef}
            onClick={() => fileRef.current?.click()}
          >
            <UploadIcon />
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => void handleFile(event)}
          />
        </>
      }
    >
      {records.length === 0 ? (
        <p className="history__empty">
          No games yet — your finished and unfinished puzzles will appear here.
        </p>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Filter by level">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                id={tabId(f)}
                className="tabs__tab"
                aria-selected={f === filter}
                aria-controls={panelId}
                // Roving: Tab enters the strip at the selected tab, arrows move.
                tabIndex={f === filter ? 0 : -1}
                ref={(element) => {
                  tabRefs.current[f] = element;
                }}
                onClick={() => choose(f)}
                onKeyDown={handleTabKey}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>

          <div
            className="history__panel"
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId(filter)}
          >
            {filter === 'all' ? (
              <AllStats stats={stats} />
            ) : (
              <TierStats label={FILTER_LABEL[filter]} stats={stats[filter]} />
            )}

            {shown.length === 0 ? (
              <p className="history__empty">No {FILTER_LABEL[filter]} games yet.</p>
            ) : (
              <ol className="history__list" aria-label="Games, newest first" ref={listRef}>
                {visible.map((record) => (
                  <HistoryRow
                    key={record.id}
                    record={record}
                    now={now}
                    isCurrent={record.id === currentId}
                    isResumable={
                      record.status === 'playing' &&
                      record.id !== currentId &&
                      resumableIds.has(record.id)
                    }
                    canReplay={canReplay(
                      record,
                      record.id === currentId,
                      resumableIds.has(record.id),
                    )}
                    canWatch={canWatch(record)}
                    canWatchChallenge={canWatchChallenge(record)}
                    watched={record.id === place?.id ? (place.solve ?? 'own') : null}
                    isConfirming={record.id === confirmingId}
                    onResume={onResume}
                    onReplay={onReplay}
                    onShare={onShare}
                    onWatch={watch}
                    onWatchChallenge={watchChallenge}
                    onRequestDelete={requestDelete}
                    onCancelDelete={cancelDelete}
                    onConfirmDelete={confirmDelete}
                  />
                ))}
              </ol>
            )}
            {remaining > 0 && (
              <button
                type="button"
                className="button button--ghost history__more"
                onClick={showMore}
              >
                Show more ({remaining} left)
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
