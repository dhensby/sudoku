import { useEffect, useRef, useState } from 'react';
import type { Puzzle } from '../../core';
import type { SavedPuzzle } from '../../storage/puzzles';
import { normaliseTitle } from '../../storage/storage';
import { formatDate } from '../format';
import { assessmentOf } from '../puzzles';
import { Dialog } from './Dialog';
import { NameForm, escapeTo } from './NameForm';
import { TITLE_INPUT_MAX, describeGivens } from './text';

/** Where focus goes back to, back from the editor or Share (see `PuzzlesDialogProps.place`). */
export interface PuzzlesPlace {
  /** The entry the editor was open on, or that was shared. */
  readonly id: string;
  /** Which of its buttons: the Edit or the Share that opened it. */
  readonly control: 'edit' | 'share';
}

export interface PuzzlesDialogProps {
  /** Every puzzle kept (see `puzzles.ts`), the latest first saved first, as stored. */
  puzzles: readonly SavedPuzzle[];
  /**
   * Back from the editor on an entry kept, or from sharing one: focus goes to
   * that row's Edit, or its Share, wherever it is in the list. With none, to
   * Enter a new puzzle.
   */
  place?: PuzzlesPlace;
  /** Open the editor on an empty grid. */
  onNew: () => void;
  /** Play a row's puzzle, as it is drawn: checked, with one solution, and labelled. */
  onPlay: (puzzle: Puzzle) => void;
  /** Share the entry `id`'s puzzle alone, as it is drawn, without a game of it. */
  onShare: (id: string, puzzle: Puzzle) => void;
  /** Open the editor on a row's grid. */
  onEdit: (entry: SavedPuzzle) => void;
  /** Call the entry `id` by `title`: the field's raw text, which the parent tidies; '' takes the name off. */
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

interface Status {
  text: string;
  id: number;
}

/** A row open in place of its buttons, by the entry's id: its name being changed, or its delete confirmed. */
interface Editing {
  id: string;
  kind: 'rename' | 'delete';
}

/** The button that takes focus once the rows have drawn again, by its entry's id. */
interface PendingFocus {
  id: string;
  control: 'rename' | 'delete' | 'cancel';
}

/**
 * How a row's buttons name it, so each makes sense read alone from a list of
 * buttons: "The Times #5,123, from Today 09:12", "untitled puzzle from 11 Oct".
 */
function contextOf(entry: SavedPuzzle, now: number): string {
  const date = formatDate(entry.createdAt, now);
  return entry.title === undefined
    ? `untitled puzzle from ${date}`
    : `${entry.title}, from ${date}`;
}

interface PuzzleRowProps {
  entry: SavedPuzzle;
  now: number;
  /** Back from the editor or Share on this row: the button that takes focus as the list opens. */
  place: PuzzlesPlace['control'] | null;
  /** What the row has open in place of its buttons, if anything. */
  editing: Editing['kind'] | null;
  onPlay: (puzzle: Puzzle) => void;
  onShare: (id: string, puzzle: Puzzle) => void;
  onEdit: (entry: SavedPuzzle) => void;
  onOpen: (editing: Editing) => void;
  onSaveName: (id: string, title: string) => void;
  onConfirmDelete: (id: string) => void;
  /** Close what is open, focus back on `control`, the button that opened it. */
  onCancel: (id: string, control: 'rename' | 'delete') => void;
}

/**
 * One puzzle kept: its name, when it was first saved and what its numbers
 * make, in the editor's own words; then Play and Share, for one ready to
 * play, Edit, Rename and Delete — the next thing to do first, and marked so:
 * Play, or Edit for a grid that is not a puzzle yet.
 */
function PuzzleRow({
  entry,
  now,
  place,
  editing,
  onPlay,
  onShare,
  onEdit,
  onOpen,
  onSaveName,
  onConfirmDelete,
  onCancel,
}: PuzzleRowProps) {
  const { id, title } = entry;
  const assessment = assessmentOf(entry.cells);
  const context = contextOf(entry, now);
  // On both confirmation buttons.
  const handleConfirmKey = escapeTo(() => onCancel(id, 'delete'));
  return (
    <li className="history-item puzzles-item" data-puzzle={id}>
      <div className="history-item__info">
        <p className="history-item__heading">
          {/* Free text: kept in its own direction. */}
          <span className="puzzles-item__name">
            {title === undefined ? 'Untitled puzzle' : <bdi>{title}</bdi>}
          </span>
          <span className="history-item__date">{formatDate(entry.createdAt, now)}</span>
        </p>
        <p className="history-item__status">{describeGivens(assessment)}</p>
      </div>
      {editing === 'rename' && (
        <NameForm
          initial={title ?? ''}
          label="Name"
          hint="Leave it empty for none."
          maxLength={TITLE_INPUT_MAX}
          normalise={normaliseTitle}
          context={context}
          onSave={(name) => onSaveName(id, name)}
          onCancel={() => onCancel(id, 'rename')}
        />
      )}
      {editing === 'delete' && (
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
            className="button button--small puzzles-item__cancel"
            aria-label={`Cancel deleting ${context}`}
            onClick={() => onCancel(id, 'delete')}
            onKeyDown={handleConfirmKey}
          >
            Cancel
          </button>
        </div>
      )}
      {editing === null && (
        <div className="history-item__actions">
          {assessment.kind === 'ok' && (
            <>
              <button
                type="button"
                className="button button--primary button--small"
                aria-label={`Play ${context}`}
                onClick={() => onPlay(assessment.puzzle)}
              >
                Play
              </button>
              <button
                type="button"
                className="button button--small"
                aria-label={`Share ${context}`}
                data-autofocus={place === 'share' || undefined}
                onClick={() => onShare(id, assessment.puzzle)}
              >
                Share
              </button>
            </>
          )}
          <button
            type="button"
            className={
              assessment.kind === 'ok'
                ? 'button button--small'
                : 'button button--primary button--small'
            }
            aria-label={`Edit ${context}`}
            data-autofocus={place === 'edit' || undefined}
            onClick={() => onEdit(entry)}
          >
            Edit
          </button>
          <button
            type="button"
            className="button button--small puzzles-item__rename"
            aria-label={`Rename ${context}`}
            onClick={() => onOpen({ id, kind: 'rename' })}
          >
            Rename
          </button>
          <button
            type="button"
            className="button button--ghost button--small history-item__delete puzzles-item__delete"
            aria-label={`Delete ${context}`}
            onClick={() => onOpen({ id, kind: 'delete' })}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Your puzzles: every grid typed in and kept, finished or not, the latest
 * first saved first, under Enter a new puzzle. Each opens again in the
 * editor (Edit), plays and shares if it is a puzzle (Play, Share), and takes
 * a name (Rename) — or goes (Delete). Opened from New game, and back to it
 * from the editor as that closes, focus on the row's Edit, and from Share,
 * on the row's Share.
 *
 * A row's name opens for editing in place of its buttons, as does a delete's
 * confirmation, one row at a time, as Friends' and History's rows do; Cancel
 * or Save gives focus back to the button that opened it, and a rename is said
 * in the status region. Confirming a delete takes focus to Enter a new
 * puzzle. The order is by when each was first saved, so neither a rename nor
 * an edit ever moves a row out from under the player.
 */
export function PuzzlesDialog({
  puzzles,
  place,
  onNew,
  onPlay,
  onShare,
  onEdit,
  onRename,
  onDelete,
  onClose,
}: PuzzlesDialogProps) {
  // Read once: the dialog is a snapshot, and "today" should not change under it.
  const [now] = useState(() => Date.now());
  // The row open for editing, by id, and for what; one at a time.
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  // The button that takes focus once the rows have drawn again: looked up in
  // the list, as Friends does, wherever the entry is once they have.
  const pendingFocus = useRef<PendingFocus | null>(null);

  useEffect(() => {
    const focus = pendingFocus.current;
    if (focus === null) return;
    pendingFocus.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-puzzle="${focus.id}"] .puzzles-item__${focus.control}`)
      ?.focus();
  });

  const say = (text: string) => setStatus((previous) => ({ text, id: (previous?.id ?? 0) + 1 }));

  const open = (next: Editing) => {
    // A delete's confirmation opens on Cancel, where Delete was; a rename on its field.
    if (next.kind === 'delete') pendingFocus.current = { id: next.id, control: 'cancel' };
    setEditing(next);
  };

  /** Close what is open, and focus `control` on the entry `id` once the rows redraw. */
  const done = (id: string, control: 'rename' | 'delete') => {
    pendingFocus.current = { id, control };
    setEditing(null);
  };

  const rename = (id: string, title: string) => {
    const tidy = normaliseTitle(title);
    done(id, 'rename');
    onRename(id, title);
    say(tidy === '' ? 'Name cleared.' : `Renamed: ${tidy}.`);
  };

  const confirmDelete = (id: string) => {
    setEditing(null);
    // The row is about to go, and its focused button with it.
    newRef.current?.focus();
    onDelete(id);
  };

  return (
    <Dialog title="Your puzzles" onClose={onClose} className="dialog--wide dialog--puzzles">
      <button
        type="button"
        className="button button--primary puzzles__new"
        ref={newRef}
        data-autofocus={place === undefined || undefined}
        onClick={onNew}
      >
        Enter a new puzzle
      </button>
      {puzzles.length === 0 ? (
        <p className="history__empty">
          No puzzles yet — the ones you enter will appear here, finished or not.
        </p>
      ) : (
        <ol className="history__list" aria-label="Your puzzles, latest first" ref={listRef}>
          {puzzles.map((entry) => (
            <PuzzleRow
              key={entry.id}
              entry={entry}
              now={now}
              place={entry.id === place?.id ? place.control : null}
              editing={editing?.id === entry.id ? editing.kind : null}
              onPlay={onPlay}
              onShare={onShare}
              onEdit={onEdit}
              onOpen={open}
              onSaveName={rename}
              onConfirmDelete={confirmDelete}
              onCancel={done}
            />
          ))}
        </ol>
      )}
      {/* Mounted from the start, so its first message is a change it
          announces; keyed, so the same message twice is announced twice. Not
          on show, so a name in it needs no <bdi>. */}
      <p className="visually-hidden" role="status">
        {status && <span key={status.id}>{status.text}</span>}
      </p>
    </Dialog>
  );
}
