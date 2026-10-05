import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

function renderConfirm() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Reset puzzle?"
      message="Your progress and the timer go back to the start."
      confirmLabel="Reset"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('asks the question, with the message as its description', () => {
    renderConfirm();
    const dialog = screen.getByRole('dialog', { name: 'Reset puzzle?' });
    expect(dialog).toHaveAccessibleDescription('Your progress and the timer go back to the start.');
  });

  it('opens on Cancel, so a reflexive Enter does no harm', () => {
    renderConfirm();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Reset' })).not.toHaveFocus();
  });

  it('marks the confirm button as dangerous', () => {
    renderConfirm();
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveClass('button--danger');
  });

  it('confirms only from the confirm button', () => {
    const { onConfirm, onCancel } = renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels from Cancel, the close button and Escape', () => {
    const { onConfirm, onCancel } = renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
