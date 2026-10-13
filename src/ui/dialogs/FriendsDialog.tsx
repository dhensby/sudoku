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
import { NameForm, escapeTo } from './NameForm';
import { NAME_INPUT_MAX, friendOption } from './text';

export interface FriendsDialogProps {
  /**
   * Everyone whose links have been opened here, or brought by an import (see
   * `friends.ts`), in the order stored.
   */
  friends: readonly Friend[];
  /** The time to date links against ("Today 14:05"). */
  now: number;
  /**
   * Call the friend holding `deviceId` — their key — by `name`: the field's
   * raw text, which the parent tidies; '' takes their name off.
   */
  onRename: (deviceId: string, name: string) => void;
  /**
   * The friend keyed `fromId` — the row merged — is the friend keyed
   * `intoId`, the one chosen: one friend from now on, still keyed `intoId`
   * (see `mergeFriends`).
   */
  onMerge: (fromId: string, intoId: string) => void;
  /** `deviceId` leaves its friend, to be a friend of its own, keyed by it (see `splitDevice`). */
  onSplit: (deviceId: string) => void;
  onClose: () => void;
}

interface Status {
  text: string;
  id: number;
}

/** A row open for editing in place of its buttons, by the friend's key: their name, or a merge. */
interface Editing {
  key: string;
  kind: 'rename' | 'merge';
}

/** The button that takes focus once the rows have drawn again, by its friend's key. */
interface PendingFocus {
  key: string;
  control: 'rename' | 'merge';
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
 * devices they share from, once two have been merged (see `Friend.devices`).
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

interface MergeFormProps {
  /** Everyone else, latest first: who this friend may be. Never empty. */
  others: readonly Friend[];
  now: number;
  /** Read out with the row's own words, as its Merge… was. */
  context: string;
  /** Merge, with the friend chosen. */
  onMerge: (into: Friend) => void;
  onCancel: () => void;
}

/**
 * A row's merge, open in place of its buttons: who else they are, chosen
 * from everyone else, latest first — the latest chosen to begin with —
 * focused as it opens, with Merge and Cancel beneath it. Merge asks nothing
 * more: Split off, on the merged friend's row, undoes it.
 */
function MergeForm({ others, now, context, onMerge, onCancel }: MergeFormProps) {
  const ids = useId();
  // The friend chosen, by their place in `others`.
  const [choice, setChoice] = useState(0);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    focusQuietly(selectRef.current);
  }, []);

  // On the picker and both buttons.
  const handleEscape = escapeTo(onCancel);

  const selectId = `${ids}-friend`;
  const hintId = `${ids}-hint`;
  return (
    <div
      className="history-item__actions history-item__actions--edit"
      role="group"
      aria-label={`Merge ${context}`}
    >
      <div className="field">
        <label className="field__label" htmlFor={selectId}>
          Same person as
        </label>
        <div className="friends__picker">
          <select
            id={selectId}
            ref={selectRef}
            className="friends__select"
            value={friendKey(others[choice])}
            aria-describedby={hintId}
            onChange={(event) => setChoice(event.target.selectedIndex)}
            onKeyDown={handleEscape}
          >
            {others.map((other) => (
              <option key={friendKey(other)} value={friendKey(other)}>
                {friendOption(other, now)}
              </option>
            ))}
          </select>
        </div>
        <p className="field__hint" id={hintId}>
          They become one friend, under the name you gave the one you choose, or else this
          one&apos;s. You can split them apart again.
        </p>
      </div>
      <button
        type="button"
        className="button button--primary button--small"
        aria-label={`Confirm merge, ${context}`}
        onClick={() => onMerge(others[choice])}
        onKeyDown={handleEscape}
      >
        Merge
      </button>
      <button
        type="button"
        className="button button--small"
        aria-label={`Cancel merging ${context}`}
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
  /** Everyone, latest first, for a merge to choose from. */
  ordered: readonly Friend[];
  now: number;
  /** The first row: its Rename is where focus lands as the dialog opens. */
  isFirst: boolean;
  /** What the row has open in place of its buttons, if anything. */
  editing: Editing['kind'] | null;
  onEdit: (editing: Editing) => void;
  onSave: (key: string, name: string) => void;
  onMerge: (from: Friend, into: Friend) => void;
  onSplit: (deviceId: string) => void;
  /** Close the edit, focus back on `control`, the button that opened it. */
  onCancel: (key: string, control: PendingFocus['control']) => void;
}

/**
 * One friend: what they go by and when their latest link came; their
 * devices, once they have two, each with Split off; and Rename, with Merge…
 * once there is anyone to merge them with.
 */
function FriendRow({
  friend,
  ordered,
  now,
  isFirst,
  editing,
  onEdit,
  onSave,
  onMerge,
  onSplit,
  onCancel,
}: FriendRowProps) {
  const key = friendKey(friend);
  const label = friendLabel(friend);
  const context = contextOf(friend, now);
  const parts = statusParts(friend);
  const others = ordered.filter((other) => other !== friend);
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
      {/* A merged friend's devices, in the order merged: each known by the
          name its own links last gave — a name given here is the friend's,
          not a device's — kept in its own direction too. */}
      {friend.devices.length > 1 && (
        <ul className="friends-item__devices" aria-label={`Devices, ${context}`}>
          {friend.devices.map((device) => {
            const date = formatDate(device.lastAt, now);
            return (
              <li className="friends-item__device" key={device.id}>
                <span>
                  {device.sentAs === undefined ? 'No name' : <bdi>{device.sentAs}</bdi>}
                  {` · latest link ${date}`}
                </span>
                <button
                  type="button"
                  className="button button--ghost button--small friends-item__split"
                  aria-label={`Split off ${device.sentAs ?? 'the device with no name'}, latest link ${date}, from ${label ?? 'friend with no name'}`}
                  onClick={() => onSplit(device.id)}
                >
                  Split off
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {editing === 'rename' && (
        <NameForm
          initial={friend.name ?? latestSentAs(friend) ?? ''}
          label="Their name"
          hint="Leave it empty to go by the names in their links."
          maxLength={NAME_INPUT_MAX}
          normalise={normaliseName}
          context={context}
          onSave={(name) => onSave(key, name)}
          onCancel={() => onCancel(key, 'rename')}
        />
      )}
      {editing === 'merge' && (
        <MergeForm
          others={others}
          now={now}
          context={context}
          onMerge={(into) => onMerge(friend, into)}
          onCancel={() => onCancel(key, 'merge')}
        />
      )}
      {editing === null && (
        <div className="history-item__actions">
          <button
            type="button"
            className="button button--small friends-item__rename"
            aria-label={`Rename ${context}`}
            data-autofocus={isFirst || undefined}
            onClick={() => onEdit({ key, kind: 'rename' })}
          >
            Rename
          </button>
          {others.length > 0 && (
            <button
              type="button"
              className="button button--small friends-item__merge"
              aria-label={`Merge ${context} with another friend`}
              onClick={() => onEdit({ key, kind: 'merge' })}
            >
              Merge…
            </button>
          )}
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
 * A row's name opens for editing in place of its buttons, as does a merge,
 * one row at a time; Save or Cancel gives focus back to the button that
 * opened it, and what changed is said in the status region — a row whose
 * name changes in front of a sighted player says it for itself. The order is
 * by when each was last heard from, so a rename never moves a row out from
 * under the player.
 *
 * Someone who shares from two devices arrives as two friends: Merge… says
 * one row is the same person as another, chosen from the rest, and the two
 * rows become one — under the name given the one chosen, or else this one's
 * — focus going to its Rename. A merged friend lists their devices, each by
 * the name its links last gave, and Split off takes one back out, to a row
 * of its own, unnamed, focus going to its Rename: so a merge needs no
 * second asking, split off being its undoing.
 */
export function FriendsDialog({
  friends,
  now,
  onRename,
  onMerge,
  onSplit,
  onClose,
}: FriendsDialogProps) {
  const introId = useId();
  // The row open for editing, by key, and for what; one at a time.
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // The button that takes focus once the rows have drawn again: looked up in
  // the list rather than held by the row, as History's rows hold theirs, as
  // it may be another row's — a merge's friend chosen, or a device split off
  // — and found wherever the friend has ended up.
  const pendingFocus = useRef<PendingFocus | null>(null);

  useEffect(() => {
    const focus = pendingFocus.current;
    if (focus === null) return;
    pendingFocus.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-friend="${focus.key}"] .friends-item__${focus.control}`)
      ?.focus();
  });

  const say = (text: string) => setStatus((previous) => ({ text, id: (previous?.id ?? 0) + 1 }));

  /** Close the edit open, and focus `control` on the friend keyed `key` once the rows redraw. */
  const done = (key: string, control: PendingFocus['control']) => {
    pendingFocus.current = { key, control };
    setEditing(null);
  };

  const save = (key: string, name: string) => {
    const tidy = normaliseName(name);
    done(key, 'rename');
    onRename(key, name);
    say(
      tidy === ''
        ? 'Name cleared: each of their times shows the name its link gave.'
        : `Renamed: you'll see them as ${tidy}.`,
    );
  };

  // The friend chosen keeps their key, their devices coming first.
  const merge = (from: Friend, into: Friend) => {
    const intoKey = friendKey(into);
    done(intoKey, 'rename');
    onMerge(friendKey(from), intoKey);
    say(
      `Merged into one friend, on ${count(from.devices.length + into.devices.length, 'device')}.`,
    );
  };

  // The device split off is the new friend's key.
  const split = (deviceId: string) => {
    done(deviceId, 'rename');
    onSplit(deviceId);
    say('Split off: a friend of their own now.');
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
            ordered={ordered}
            now={now}
            isFirst={i === 0}
            editing={editing?.key === friendKey(friend) ? editing.kind : null}
            onEdit={setEditing}
            onSave={save}
            onMerge={merge}
            onSplit={split}
            onCancel={done}
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
