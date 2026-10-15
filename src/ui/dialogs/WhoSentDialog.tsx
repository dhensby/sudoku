import { useId, useState } from 'react';
import { byRecency, friendKey, type Friend } from '../../storage/friends';
import { normaliseName } from '../../storage/storage';
import { isPlainEnter } from '../keyboard';
import type { LinkSharer } from '../session';
import { Dialog } from './Dialog';
import { NAME_INPUT_MAX, friendOption } from './text';

/**
 * What "Who sent this?" was answered with, on Save: the field's raw text,
 * which the parent tidies — '' leaves the sender unnamed, going by their
 * links' names, as Skip does — or, with a friend chosen, that friend's key:
 * the sender is them, on another device.
 */
export type WhoSentAnswer = { kind: 'name'; name: string } | { kind: 'sameAs'; friendId: string };

export interface WhoSentDialogProps {
  /** Who the link came from: a device no friend here holds, and the name its link gave. */
  sharer: LinkSharer;
  /** Every friend known here: those not holding `sharer.id` are offered as the sender, on another device. */
  friends: readonly Friend[];
  onSave: (answer: WhoSentAnswer) => void;
  /** Skip, Escape, × or the scrim: nothing more is stored, and nothing asked again. */
  onClose: () => void;
}

/**
 * "Who sent this?": asked of the first link from someone new — a player ID no
 * friend here holds (see `LinkSharer.isNew`) — before anything the link
 * opens, its card waiting veiled and its clock stopped behind it.
 *
 * The name a link gives is whatever its sender typed, so the player says who
 * it is instead: the field opens filled with the link's name, focused and
 * selected, so typing replaces a rude one and Enter keeps a good one — and
 * Enter again, on the card that follows, starts the race. Saved, the name is
 * the one shown on every race of theirs, whatever their later links call
 * themselves; left empty, or skipped, they go by their links' names until
 * they are named in Friends. Their device was noted as the link opened, so
 * the question is never asked again either way.
 *
 * Someone who shares from two devices arrives as two friends, so once there
 * are other friends here the player can say the sender is one of them
 * instead: chosen below the field, the two become one friend, under the name
 * already given them. Never chosen for them, however alike the names: a name
 * is exactly what a stranger can copy. Choosing one disables the field rather
 * than hiding it, so nothing shifts under the pointer.
 */
export function WhoSentDialog({ sharer, friends, onSave, onClose }: WhoSentDialogProps) {
  const ids = useId();
  // The field's own copy, tidied only when it loses focus, as Share's is: on
  // every keystroke it would eat the space between a first and last name.
  const [name, setName] = useState(sharer.sentAs ?? '');
  // The friend chosen as the sender, by key; '' for someone new.
  const [choice, setChoice] = useState('');
  // Everyone else: the sender's own device is noted as the link opens, so
  // its friend — the sender, as yet unnamed — is in the list too.
  const others = byRecency(
    friends.filter((friend) => !friend.devices.some((device) => device.id === sharer.id)),
  );

  const save = () =>
    onSave(choice === '' ? { kind: 'name', name } : { kind: 'sameAs', friendId: choice });

  const handleFieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // An input method's Enter picks or confirms its candidate, and no more.
    if (!isPlainEnter(event.nativeEvent)) return;
    event.preventDefault();
    save();
  };

  const messageId = `${ids}-message`;
  const inputId = `${ids}-name`;
  const hintId = `${ids}-hint`;
  const selectId = `${ids}-friend`;
  const selectHintId = `${ids}-friend-hint`;
  return (
    <Dialog
      title="Who sent this?"
      onClose={onClose}
      className="dialog--confirm"
      // Focus lands on the field, below the message; this has it read on the way in.
      describedBy={messageId}
      footer={
        <>
          <button type="button" className="button button--primary" onClick={save}>
            Save
          </button>
          <button type="button" className="button" onClick={onClose}>
            Skip
          </button>
        </>
      }
    >
      <div className="who-sent">
        <p className="confirm__message" id={messageId}>
          It&apos;s the first link you&apos;ve had from them. The name you give them here is the one
          you&apos;ll see on all their times, whatever their links say. You can change it any time
          in Friends, at the foot of History.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={inputId}>
            Their name
          </label>
          <input
            id={inputId}
            className="field__input"
            type="text"
            value={name}
            maxLength={NAME_INPUT_MAX}
            // Not the player's own nickname, which a browser would offer here.
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="done"
            aria-describedby={hintId}
            // Focused and selected as the dialog opens (see Dialog).
            data-autofocus
            // A friend chosen below names them: the field has no say.
            disabled={choice !== ''}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setName(normaliseName(name))}
            onKeyDown={handleFieldKey}
          />
          <p className="field__hint" id={hintId}>
            {/* A name from a link anyone can write, kept in its own direction. */}
            {sharer.sentAs === null ? (
              "Their link doesn't give a name."
            ) : (
              <>
                Their link says “<bdi>{sharer.sentAs}</bdi>”.
              </>
            )}{' '}
            Leave it empty to go by their links.
          </p>
        </div>
        {others.length > 0 && (
          <div className="field">
            <label className="field__label" htmlFor={selectId}>
              Or is it a friend you have already, on another device?
            </label>
            <div className="friends__picker">
              <select
                id={selectId}
                className="friends__select"
                value={choice}
                aria-describedby={selectHintId}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">No — someone new</option>
                {/* Dated against the link's opening, just now. */}
                {others.map((friend) => (
                  <option key={friendKey(friend)} value={friendKey(friend)}>
                    {friendOption(friend, sharer.at)}
                  </option>
                ))}
              </select>
            </div>
            <p className="field__hint" id={selectHintId}>
              Choose them, and both devices become one friend, under the name you gave them.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
