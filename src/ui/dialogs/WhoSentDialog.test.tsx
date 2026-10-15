import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Friend } from '../../storage/friends';
import type { LinkSharer } from '../session';
import { WhoSentDialog, type WhoSentDialogProps } from './WhoSentDialog';

const SHARER: LinkSharer = {
  id: 'k3x9q7za2m',
  sentAs: 'Rude McRudeface',
  at: new Date(2026, 9, 12, 14, 30).getTime(),
  isNew: true,
};

/** The sender, noted as their link opened: a friend of their own, unnamed. */
const SENDER: Friend = {
  devices: [{ id: SHARER.id, sentAs: 'Rude McRudeface', lastAt: SHARER.at }],
};

const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).getTime();

/** Friends from before, as stored: oldest first. */
const FRIENDS: readonly Friend[] = [
  { devices: [{ id: 'z8c2m5r1to', lastAt: at(3, 18, 0) }] },
  {
    name: 'Ally',
    devices: [
      { id: 'p0d4wq81xe', sentAs: 'Al', lastAt: at(11, 9, 0) },
      { id: 'q1w2e3r4t5', lastAt: at(10, 9, 0) },
    ],
  },
  SENDER,
];

function renderWhoSent(overrides: Partial<WhoSentDialogProps> = {}) {
  const props: WhoSentDialogProps = {
    sharer: SHARER,
    friends: [SENDER],
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<WhoSentDialog {...props} />);
  return { ...view, props };
}

const dialog = () => screen.getByRole('dialog', { name: 'Who sent this?' });
const field = () => screen.getByRole('textbox', { name: 'Their name' }) as HTMLInputElement;
const picker = () =>
  screen.getByRole('combobox', { name: 'Or is it a friend you have already, on another device?' });

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
    // Safari's, confirming it: the composition already over, the key still the input method's.
    expect(fireEvent.keyDown(field(), { key: 'Enter', keyCode: 229 })).toBe(true);
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

  describe('a friend already, on another device', () => {
    it('is not asked while the sender is the only friend here', () => {
      renderWhoSent();
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('offers everyone else, latest first and dated, below the field, someone new to begin with', () => {
      renderWhoSent({ friends: FRIENDS });
      expect(
        within(picker())
          .getAllByRole('option')
          .map((option) => [option.getAttribute('value'), option.textContent]),
      ).toEqual([
        ['', 'No — someone new'],
        ['p0d4wq81xe', 'Ally · Yesterday 09:00'],
        ['z8c2m5r1to', 'No name · 3 Oct'],
      ]);
      expect(picker()).toHaveValue('');
      expect(picker()).toHaveAccessibleDescription(
        'Choose them, and both devices become one friend, under the name you gave them.',
      );
      // Below the field, which keeps the focus.
      expect(field().compareDocumentPosition(picker())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(field()).toHaveFocus();
      expect(field()).toBeEnabled();
    });

    it('never chooses one for them, however alike the names', () => {
      const twin: Friend = {
        name: 'Rude McRudeface',
        devices: [{ id: 'z8c2m5r1to', sentAs: 'Rude McRudeface', lastAt: at(3, 18, 0) }],
      };
      renderWhoSent({ friends: [twin, SENDER] });
      expect(picker()).toHaveValue('');
      expect(within(picker()).getAllByRole('option')).toHaveLength(2);
    });

    it('saves the friend chosen, the field set aside while one is', () => {
      const { props } = renderWhoSent({ friends: FRIENDS });
      fireEvent.change(picker(), { target: { value: 'p0d4wq81xe' } });
      expect(field()).toBeDisabled();
      // Disabled, not hidden: nothing moves under the pointer.
      expect(field()).toHaveValue('Rude McRudeface');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      expect(props.onSave).toHaveBeenCalledExactlyOnceWith({
        kind: 'sameAs',
        friendId: 'p0d4wq81xe',
      });
    });

    it('takes the field again once someone new is chosen back', () => {
      const { props } = renderWhoSent({ friends: FRIENDS });
      fireEvent.change(picker(), { target: { value: 'z8c2m5r1to' } });
      fireEvent.change(picker(), { target: { value: '' } });
      expect(field()).toBeEnabled();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      expect(props.onSave).toHaveBeenCalledExactlyOnceWith({
        kind: 'name',
        name: 'Rude McRudeface',
      });
    });
  });
});
