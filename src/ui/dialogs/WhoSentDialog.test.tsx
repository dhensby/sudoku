import { fireEvent, render, screen, within } from '@testing-library/react';
import type { LinkSharer } from '../session';
import { WhoSentDialog, type WhoSentDialogProps } from './WhoSentDialog';

const SHARER: LinkSharer = {
  id: 'k3x9q7za2m',
  sentAs: 'Rude McRudeface',
  at: new Date(2026, 9, 12, 14, 30).getTime(),
  isNew: true,
};

function renderWhoSent(overrides: Partial<WhoSentDialogProps> = {}) {
  const props: WhoSentDialogProps = {
    sharer: SHARER,
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<WhoSentDialog {...props} />);
  return { ...view, props };
}

const dialog = () => screen.getByRole('dialog', { name: 'Who sent this?' });
const field = () => screen.getByRole('textbox', { name: 'Their name' }) as HTMLInputElement;

describe('WhoSentDialog', () => {
  it('says why it asks, read with its name as focus moves in', () => {
    renderWhoSent();
    expect(dialog()).toHaveAccessibleDescription(
      "It's the first link you've had from them. The name you give them here is the one you'll see on all their times, whatever their links say. You can change it any time in Friends, at the foot of History.",
    );
    expect(dialog()).toHaveClass('dialog--confirm');
  });

  it('opens on the field, filled with the name the link gave and selected, so typing replaces it', () => {
    renderWhoSent();
    expect(field()).toHaveValue('Rude McRudeface');
    expect(field()).toHaveFocus();
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 15]);
    expect(field()).toHaveAttribute('maxLength', '64');
    // Not the player's own nickname, which a browser would offer.
    expect(field()).toHaveAttribute('autoComplete', 'off');
    expect(field()).toHaveAttribute('spellCheck', 'false');
    expect(field()).toHaveAttribute('enterKeyHint', 'done');
  });

  it("quotes the link's name in the field's hint, kept in its own direction", () => {
    renderWhoSent({ sharer: { ...SHARER, sentAs: 'אלכסנדרה' } });
    expect(field()).toHaveAccessibleDescription(
      'Their link says “אלכסנדרה”. Leave it empty to go by their links.',
    );
    const hint = document.getElementById(field().getAttribute('aria-describedby')!)!;
    expect(within(hint).getByText('אלכסנדרה').tagName).toBe('BDI');
  });

  it('says so when the link gives no name, the field starting empty', () => {
    renderWhoSent({ sharer: { ...SHARER, sentAs: null } });
    expect(field()).toHaveValue('');
    expect(field()).toHaveAccessibleDescription(
      "Their link doesn't give a name. Leave it empty to go by their links.",
    );
    expect(dialog().querySelector('bdi')).toBeNull();
  });

  it('tidies the name as the field loses focus, not as it is typed', () => {
    renderWhoSent();
    fireEvent.change(field(), { target: { value: '  Ally   Smith ' } });
    expect(field()).toHaveValue('  Ally   Smith ');
    fireEvent.blur(field());
    expect(field()).toHaveValue('Ally Smith');
  });

  it('saves the field as it stands, for the parent to tidy', () => {
    const { props } = renderWhoSent();
    fireEvent.change(field(), { target: { value: ' Ally ' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith({ kind: 'name', name: ' Ally ' });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("saves the link's name as it came, when left as it was", () => {
    const { props } = renderWhoSent();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith({ kind: 'name', name: 'Rude McRudeface' });
  });

  it('saves on Enter in the field, but not on the Enter that picks a composed character', () => {
    const { props } = renderWhoSent();
    fireEvent.change(field(), { target: { value: 'アリー' } });
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
    expect(props.onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'a' });
    expect(props.onSave).not.toHaveBeenCalled();
    const enter = fireEvent.keyDown(field(), { key: 'Enter' });
    expect(enter).toBe(false);
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith({ kind: 'name', name: 'アリー' });
  });

  it('saves an empty field as empty: they go by their links', () => {
    const { props } = renderWhoSent();
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith({ kind: 'name', name: '' });
  });

  it('closes, saving nothing, from Skip, Escape, the close button and the scrim', () => {
    const { props } = renderWhoSent();
    const footer = dialog().querySelector('.dialog__footer')!;
    // Save first, then Skip: naming is the point of it.
    expect(
      within(footer as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Save', 'Skip']);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Skip' }));
    fireEvent.keyDown(field(), { key: 'Escape' });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    fireEvent.pointerDown(document.querySelector('.dialog-overlay')!);
    expect(props.onClose).toHaveBeenCalledTimes(4);
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
