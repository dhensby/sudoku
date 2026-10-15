import { useEffect, useId, useRef, useState } from 'react';
import { focusQuietly } from '../keepFocus';
import { isPlainEnter } from '../keyboard';

/**
 * For everything in an edit's group that can have focus: Escape backs out of
 * the edit rather than closing the whole dialog (which skips keys claimed
 * with preventDefault), as History's delete does.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a key handler Friends' merge and Your puzzles' delete share
export function escapeTo(onCancel: () => void) {
  return (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onCancel();
  };
}

export interface NameFormProps {
  /** The name it goes by now, to start from; '' for none. */
  initial: string;
  /** The field's label: "Their name", or "Name". */
  label: string;
  /** Under the field, and read with it: what an empty name does. */
  hint: string;
  /** How much the field takes while typing (see `NAME_INPUT_MAX`, `TITLE_INPUT_MAX`). */
  maxLength: number;
  /** How the field tidies what is typed as it loses focus: as the parent does on Save. */
  normalise: (name: string) => string;
  /** Read out with the row's own words, as its Rename was. */
  context: string;
  /** Save `name`: the field's raw text, which the parent tidies. */
  onSave: (name: string) => void;
  onCancel: () => void;
}

/**
 * A row's name, open for editing in place of its buttons: the field, filled
 * with the name it goes by now, focused and selected as it opens — so typing
 * replaces it — with Save and Cancel beneath it.
 */
export function NameForm({
  initial,
  label,
  hint,
  maxLength,
  normalise,
  context,
  onSave,
  onCancel,
}: NameFormProps) {
  const ids = useId();
  // The field's own copy, tidied only when it loses focus, as Share's is: on
  // every keystroke it would eat the space between two words.
  const [name, setName] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    focusQuietly(inputRef.current);
    inputRef.current?.select();
  }, []);

  // On the field and both buttons.
  const handleEscape = escapeTo(onCancel);

  const handleFieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // An input method's Enter picks or confirms its candidate, and no more.
    if (isPlainEnter(event.nativeEvent)) {
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
      className="history-item__actions history-item__actions--edit"
      role="group"
      aria-label={`Rename ${context}`}
    >
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          className="field__input"
          type="text"
          value={name}
          maxLength={maxLength}
          // Not the player's own nickname, which a browser would offer here.
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-describedby={hintId}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setName(normalise(name))}
          onKeyDown={handleFieldKey}
        />
        <p className="field__hint" id={hintId}>
          {hint}
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
