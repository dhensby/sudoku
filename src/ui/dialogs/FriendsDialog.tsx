import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  byRecency,
  friendKey,
  friendLabel,
  lastLinkAt,
  latestSentAs,
  type Friend,
} from '../../storage/friends';
import { normaliseName } from '../../storage/storage';
import { count, formatDate } from '../format';
import { focusQuietly } from '../keepFocus';
import { Dialog } from './Dialog';
import { NAME_INPUT_MAX } from './text';

export interface FriendsDialogProps {
  /** Everyone whose links have been opened here (see `friends.ts`), in the order stored. */
  friends: readonly Friend[];
  /** The time to date links against ("Today 14:05"). */
  now: number;
  /**
   * Call the friend holding `deviceId` — their key — by `name`: the field's
   * raw text, which the parent tidies; '' takes their name off.
   */
  onRename: (deviceId: string, name: string) => void;
  onClose: () => void;
}

interface Status {
  text: string;
  id: number;
}

/**
 * How a row's buttons name it, so each makes sense read alone from a list
 * of buttons: "Ally, latest link Today 14:05".
 */
function contextOf(friend: Friend, now: number): string {
  return `${friendLabel(friend) ?? 'friend with no name'}, latest link ${formatDate(lastLinkAt(friend), now)}`;
}

/**
 * What a row says under its name, the parts that apply: where an unnamed
 * friend's name comes from, or that their links give none; what the latest
 * link of a named one calls them, when that is something else; and how many
 * devices they share from, once there are two — which a newer version's
 * merged friend can have (see `Friend.devices`).
 */
function statusParts(friend: Friend): ReactNode[] {
  const parts: ReactNode[] = [];
  const latest = latestSentAs(friend);
  if (friend.name === undefined) {
    parts.push(latest === null ? 'Their links give no name' : 'Name from their latest link');
  } else if (latest !== null && latest !== friend.name) {
    parts.push(
      <>
        Their latest link says <bdi>{latest}</bdi>
      </>,
    );
  }
  if (friend.devices.length > 1) parts.push(count(friend.devices.length, 'device'));
  return parts;
}

interface NameFormProps {
  friend: Friend;
  /** Read out with the row's own words, as its Rename was. */
  context: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

/**
 * A row's name, open for editing in place of its buttons: the field, filled
 * with the name it goes by now, focused and selected as it opens — so typing
 * replaces it — with Save and Cancel beneath it.
 */
function NameForm({ friend, context, onSave, onCancel }: NameFormProps) {
  const ids = useId();
  // The field's own copy, tidied only when it loses focus, as Share's is: on
  // every keystroke it would eat the space between a first and last name.
  const [name, setName] = useState(friend.name ?? latestSentAs(friend) ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    focusQuietly(inputRef.current);
    inputRef.current?.select();
  }, []);

  // On the field and both buttons — everything in the group that can have
  // focus: Escape backs out of the edit rather than closing the whole dialog
  // (which skips keys claimed with preventDefault), as History's delete does.
  const handleEscape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onCancel();
  };

  const handleFieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter while composing picks the candidate a keyboard offers, and no more.
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSave(name);
      return;
    }
    handleEscape(event);
  };

  const inputId = `${ids}-name`;
  const hintId = `${ids}-hint`;
  return (
    <div
      className="history-item__actions friends-item__edit"
      role="group"
      aria-label={`Rename ${context}`}
    >
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          Their name
        </label>
        <input
          id={inputId}
          ref={inputRef}
          className="field__input"
          type="text"
          value={name}
          maxLength={NAME_INPUT_MAX}
          // Not the player's own nickname, which a browser would offer here.
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-describedby={hintId}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setName(normaliseName(name))}
          onKeyDown={handleFieldKey}
        />
        <p className="field__hint" id={hintId}>
          Leave it empty to go by the names in their links.
        </p>
      </div>
      <button
        type="button"
        className="button button--primary button--small"
        aria-label={`Save name, ${context}`}
        onClick={() => onSave(name)}
        onKeyDown={handleEscape}
      >
        Save
      </button>
      <button
        type="button"
        className="button button--small"
        aria-label={`Cancel renaming ${context}`}
        onClick={onCancel}
        onKeyDown={handleEscape}
      >
        Cancel
      </button>
    </div>
  );
}

interface FriendRowProps {
  friend: Friend;
  now: number;
  /** The first row: its Rename is where focus lands as the dialog opens. */
  isFirst: boolean;
  isRenaming: boolean;
  onStartRename: (key: string) => void;
  onSave: (key: string, name: string) => void;
  onCancel: (key: string) => void;
}

/** One friend: what they go by and when their latest link came, and Rename. */
function FriendRow({
  friend,
  now,
  isFirst,
  isRenaming,
  onStartRename,
  onSave,
  onCancel,
}: FriendRowProps) {
  const key = friendKey(friend);
  const label = friendLabel(friend);
  const context = contextOf(friend, now);
  const parts = statusParts(friend);
  return (
    <li className="history-item friends-item" data-friend={key}>
      <div className="history-item__info">
        <p className="history-item__heading">
          {/* A name from a link anyone can write, or one given here: either
              way kept in its own direction. */}
          <span className="friends-item__name">
            {label === null ? 'No name' : <bdi>{label}</bdi>}
          </span>
          <span className="history-item__date">{formatDate(lastLinkAt(friend), now)}</span>
        </p>
        {parts.length > 0 && (
          <p className="history-item__status">
            {parts.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && ' · '}
                {part}
              </Fragment>
            ))}
          </p>
        )}
      </div>
      {isRenaming ? (
        <NameForm
          friend={friend}
          context={context}
          onSave={(name) => onSave(key, name)}
          onCancel={() => onCancel(key)}
        />
      ) : (
        <div className="history-item__actions">
          <button
            type="button"
            className="button button--small friends-item__rename"
            aria-label={`Rename ${context}`}
            data-autofocus={isFirst || undefined}
            onClick={() => onStartRename(key)}
          >
            Rename
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Everyone who has sent a time, latest first, to give each the name they will
 * be shown by: on every race of theirs, past ones too, whatever their links
 * call them (see `challengerName`). Opened from History's foot, and back to
 * it as it closes.
 *
 * A row's name opens for editing in place of its Rename, one row at a time;
 * Save or Cancel gives focus back to that Rename, and what changed is said in
 * the status region — a row whose name changes in front of a sighted player
 * says it for itself. The order is by when each was last heard from, so a
 * rename never moves a row out from under the player.
 */
export function FriendsDialog({ friends, now, onRename, onClose }: FriendsDialogProps) {
  const introId = useId();
  // The friend whose name is open for editing, by key; one at a time.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // The friend whose Rename takes focus once the row has swapped back to it:
  // looked up in the list rather than held by the row, as History's rows
  // hold theirs, so that it is found wherever the friend has ended up.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-friend="${key}"] .friends-item__rename`)
      ?.focus();
  });

  const say = (text: string) => setStatus((previous) => ({ text, id: (previous?.id ?? 0) + 1 }));

  const save = (key: string, name: string) => {
    const tidy = normaliseName(name);
    pendingFocus.current = key;
    setRenaming(null);
    onRename(key, name);
    say(
      tidy === ''
        ? 'Name cleared: each of their times shows the name its link gave.'
        : `Renamed: you'll see them as ${tidy}.`,
    );
  };

  const cancel = (key: string) => {
    pendingFocus.current = key;
    setRenaming(null);
  };

  const ordered = byRecency(friends);
  return (
    <Dialog
      title="Friends"
      onClose={onClose}
      className="dialog--wide dialog--friends"
      // Focus lands on the first Rename, below the intro; this has it read on the way in.
      describedBy={introId}
    >
      <p className="friends__intro" id={introId}>
        Everyone who has sent you a time, latest first. The name you give someone is the one
        you&apos;ll see on all their times, past ones too; until you do, each time shows the name
        its link gave.
      </p>
      <ol className="history__list" aria-label="Friends, latest first" ref={listRef}>
        {ordered.map((friend, i) => (
          <FriendRow
            key={friendKey(friend)}
            friend={friend}
            now={now}
            isFirst={i === 0}
            isRenaming={renaming === friendKey(friend)}
            onStartRename={setRenaming}
            onSave={save}
            onCancel={cancel}
          />
        ))}
      </ol>
      {/* Mounted from the start, so its first message is a change it
          announces; keyed, so the same message twice is announced twice. Not
          on show, so a name in it needs no <bdi>. */}
      <p className="visually-hidden" role="status">
        {status && <span key={status.id}>{status.text}</span>}
      </p>
    </Dialog>
  );
}
