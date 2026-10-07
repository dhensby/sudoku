import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Assists, DateKey, Difficulty, GridString } from '../../core';
import { normaliseName } from '../../storage/storage';
import {
  buildShareText,
  buildShareUrl,
  canNativeShare,
  copyToClipboard,
  messageWithLink,
  nativeShare,
  shareBaseUrl,
} from '../share';
import { CopyIcon, ShareIcon } from '../icons';
import { Dialog } from './Dialog';

export interface ShareDialogProps {
  givens: GridString;
  difficulty: Difficulty;
  /** The player's result to include, or null to share the puzzle alone (mid-game, or an unsolved history entry). */
  result: { seconds: number; assists: Assists } | null;
  /** The date of the daily the puzzle is, if it was played as one: the message names it, and the link says so. */
  daily?: DateKey | null;
  /** The remembered name, already normalised. */
  playerName: string;
  /**
   * Called with the raw text of the name field when it loses focus and before
   * anything is shared. The parent normalises and remembers it.
   */
  onPlayerNameChange: (name: string) => void;
  onClose: () => void;
}

/**
 * How much the name field takes while typing. Generous on purpose: the name
 * is tidied and, past 24 characters, cut short with an ellipsis on the way out
 * (`normaliseName`), and a
 * field that stops accepting keys mid-emoji, or mid-paste of a name with
 * stray spaces, feels broken. This matches the tidier's own UTF-16 ceiling.
 */
const NAME_INPUT_MAX = 64;

interface Status {
  text: string;
  id: number;
}

/**
 * Whether the device is driven by touch: no hover, or a coarse pointer. A
 * phone has no Ctrl+C to press, so the copy-by-hand field explains the long
 * press instead. jsdom (and any very old browser) has no matchMedia.
 */
function isTouchDevice(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none), (pointer: coarse)').matches
  );
}

/** How to copy the selected message by hand, for the device in use. */
function copyHint(isTouch: boolean): string {
  return isTouch ? 'Touch and hold the text, then choose Copy.' : 'Press Ctrl+C / ⌘C to copy.';
}

/**
 * Share a puzzle, or a solved time to race. The link carries everything a
 * friend needs, so there is nothing to upload: the dialog only builds the
 * message and hands it to the native share sheet or the clipboard — and, when
 * neither works, shows it selected for copying by hand.
 */
export function ShareDialog({
  givens,
  difficulty,
  result,
  daily = null,
  playerName,
  onPlayerNameChange,
  onClose,
}: ShareDialogProps) {
  const ids = useId();
  // The field's own copy, tidied only when it loses focus: tidying on every
  // keystroke would eat the space typed between a first and last name before
  // the last name could follow it.
  const [name, setName] = useState(playerName);
  const [status, setStatus] = useState<Status | null>(null);
  // How many copies have failed, which reveals the copy-by-hand field (and
  // selects it afresh each time).
  const [failures, setFailures] = useState(0);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const isSharing = useRef(false);
  // Fixed at opening, like the buttons: the device does not change mid-dialog.
  const [isTouch] = useState(isTouchDevice);

  const url = buildShareUrl(
    shareBaseUrl(),
    givens,
    result === null
      ? undefined
      : { seconds: result.seconds, name: normaliseName(name), assists: result.assists },
    daily,
  );
  const text = buildShareText({ difficulty, result: result ?? undefined, daily });
  const message = messageWithLink(text, url);
  const payload: ShareData = { title: 'Sudoku', text, url };

  // Fixed at opening, so the buttons — and which one has focus — never shift
  // under the person using them. Desktop browsers have share sheets too, so
  // this is a feature check, not a phone check.
  const [canShare] = useState(() => canNativeShare(payload));

  // The copy-by-hand field is as tall as its message, wrapped lines and all,
  // so the end of the link is never hidden behind a scroll inside it. Before
  // paint, so it never shows at the wrong height first.
  useLayoutEffect(() => {
    const field = fallbackRef.current;
    if (field === null) return;
    field.style.height = '';
    // Nothing is laid out (jsdom): the rows it was given will do.
    if (field.scrollHeight === 0) return;
    const borders = field.offsetHeight - field.clientHeight;
    field.style.height = `${field.scrollHeight + borders}px`;
  }, [failures, message]);

  // Revealed (or re-failed): put the text under the keyboard, selected, so
  // the next keystroke can be the copy.
  useEffect(() => {
    if (failures === 0) return;
    fallbackRef.current?.focus();
    fallbackRef.current?.select();
  }, [failures]);

  const say = (next: string | null) =>
    setStatus((previous) => (next === null ? null : { text: next, id: (previous?.id ?? 0) + 1 }));

  /** Show the name as it will be used, and hand it up if it changed. */
  const commitName = () => {
    const tidy = normaliseName(name);
    if (tidy !== name) setName(tidy);
    if (tidy !== playerName) onPlayerNameChange(name);
  };

  const close = () => {
    // Closing with Escape or the scrim never blurs the field first.
    commitName();
    onClose();
  };

  const share = async () => {
    // A ref rather than disabling the button: a disabled button drops focus to
    // the page, stranding a keyboard or screen-reader user.
    if (isSharing.current) return;
    isSharing.current = true;
    commitName();
    try {
      const outcome = await nativeShare(payload);
      if (outcome === 'shared') say('Shared');
      // Dismissing the sheet is a choice, not an error.
      else if (outcome === 'cancelled') say(null);
      else say("Couldn't open the share sheet. Copy the message instead.");
    } finally {
      isSharing.current = false;
    }
  };

  const copy = async () => {
    commitName();
    // The clipboard before any other await: Safari and Firefox only allow the
    // write while the click that asked for it is still under way.
    const outcome = await copyToClipboard(message);
    if (outcome === 'copied') {
      say('Copied to clipboard');
      return;
    }
    say("Couldn't copy automatically.");
    setFailures((n) => n + 1);
  };

  const selectAll = () => fallbackRef.current?.select();

  const nameId = `${ids}-name`;
  const fallbackId = `${ids}-fallback`;
  const fallbackHintId = `${ids}-fallback-hint`;
  return (
    <Dialog
      title={result === null ? 'Share this puzzle' : 'Share your time'}
      onClose={close}
      className="dialog--share"
      footer={
        <>
          {canShare && (
            <button
              type="button"
              className="button button--primary"
              data-autofocus
              onClick={() => void share()}
            >
              <ShareIcon />
              Share…
            </button>
          )}
          <button
            type="button"
            className={canShare ? 'button' : 'button button--primary'}
            data-autofocus={canShare ? undefined : true}
            onClick={() => void copy()}
          >
            <CopyIcon />
            Copy
          </button>
        </>
      }
    >
      <div className="share">
        {/* A name only travels with a result: a bare puzzle link has no time
            for it to sit next to. */}
        {result !== null && (
          <div className="field">
            <label className="field__label" htmlFor={nameId}>
              Your name (optional)
            </label>
            <input
              id={nameId}
              className="field__input"
              type="text"
              value={name}
              maxLength={NAME_INPUT_MAX}
              autoComplete="nickname"
              spellCheck={false}
              enterKeyHint="done"
              onChange={(event) => setName(event.target.value)}
              onBlur={commitName}
            />
            <p className="field__hint">Shown next to your time when a friend opens the link.</p>
          </div>
        )}

        <figure className="share__preview">
          <figcaption className="field__label">Preview</figcaption>
          <p className="share__text">{text}</p>
          <p className="share__url">{url}</p>
        </figure>

        {failures > 0 && (
          <div className="field">
            <label className="field__label" htmlFor={fallbackId}>
              Message and link
            </label>
            <textarea
              id={fallbackId}
              ref={fallbackRef}
              className="field__input share__fallback"
              readOnly
              // A first guess, before the layout effect measures the wrapping.
              rows={message.split('\n').length}
              value={message}
              spellCheck={false}
              aria-describedby={fallbackHintId}
              onFocus={selectAll}
              onClick={selectAll}
              // WebKit places the caret when the button comes up, after the
              // click has selected everything, and the selection collapses.
              onMouseUp={(event) => event.preventDefault()}
            />
            <p className="field__hint" id={fallbackHintId}>
              {copyHint(isTouch)}
            </p>
          </div>
        )}

        {/* Mounted from the start, so its first message is a change it
            announces; keyed, so the same message twice is announced twice. */}
        <p className="share__status" role="status">
          {status && <span key={status.id}>{status.text}</span>}
        </p>
      </div>
    </Dialog>
  );
}
