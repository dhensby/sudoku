import { useId, useState } from 'react';
import { normaliseName } from '../../storage/storage';
import type { LinkSharer } from '../session';
import { Dialog } from './Dialog';
import { NAME_INPUT_MAX } from './text';

/**
 * What "Who sent this?" was answered with: Save, with the field's raw text,
 * which the parent tidies — '' leaves the sender unnamed, going by their
 * links' names, as Skip does.
 */
export type WhoSentAnswer = { kind: 'name'; name: string };

export interface WhoSentDialogProps {
  /** Who the link came from: a device no friend here holds, and the name its link gave. */
  sharer: LinkSharer;
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
 */
export function WhoSentDialog({ sharer, onSave, onClose }: WhoSentDialogProps) {
  const ids = useId();
  // The field's own copy, tidied only when it loses focus, as Share's is: on
  // every keystroke it would eat the space between a first and last name.
  const [name, setName] = useState(sharer.sentAs ?? '');

  const save = () => onSave({ kind: 'name', name });

  const handleFieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter while composing picks the candidate a keyboard offers, and no more.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    save();
  };

  const messageId = `${ids}-message`;
  const inputId = `${ids}-name`;
  const hintId = `${ids}-hint`;
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
      </div>
    </Dialog>
  );
}
