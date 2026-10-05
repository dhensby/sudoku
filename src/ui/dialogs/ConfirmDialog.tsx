import { useId } from 'react';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  title: string;
  /** What is about to happen, and what it costs. */
  message: string;
  /** The verb on the dangerous button, e.g. "Reset". */
  confirmLabel: string;
  onConfirm: () => void;
  /** Cancel, Escape, the close button and the scrim all land here. */
  onCancel: () => void;
}

/**
 * Asks before something that cannot be undone (resetting a puzzle). Opens on
 * Cancel, so a reflexive Enter or Space does nothing harmful; the confirm
 * button is styled as the danger it is.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const messageId = useId();
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      className="dialog--confirm"
      // Focus lands on Cancel, below the message; this has it read on the way in.
      describedBy={messageId}
      footer={
        <>
          <button type="button" className="button" data-autofocus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm__message" id={messageId}>
        {message}
      </p>
    </Dialog>
  );
}
