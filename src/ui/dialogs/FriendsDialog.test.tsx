import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Friend } from '../../storage/friends';
import { FriendsDialog, type FriendsDialogProps } from './FriendsDialog';

/** 14:30 local on 12 Oct 2026 — local, because the dialog dates links in local time. */
const NOW = new Date(2026, 9, 12, 14, 30).getTime();
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).getTime();

/** As stored: oldest first, which the dialog turns round. */
const FRIENDS: readonly Friend[] = [
  // Unnamed, and their links have never given a name.
  { devices: [{ id: 'z8c2m5r1to', lastAt: at(10, 18, 0) }] },
  // Named here, on two devices; the latest link to give a name called them "Al".
  {
    name: 'Ally',
    devices: [
      { id: 'k3x9q7za2m', sentAs: 'Rude McRudeface', lastAt: at(11, 9, 12) },
      { id: 'p0d4wq81xe', sentAs: 'Al', lastAt: at(12, 13, 0) },
    ],
  },
  // Unnamed, going by their latest link's name: right to left.
  { devices: [{ id: 'q1w2e3r4t5', sentAs: 'אלכסנדרה', lastAt: at(12, 14, 5) }] },
  // Named here as their links name them.
  { name: 'Dan', devices: [{ id: 'd4n5h3n5by', sentAs: 'Dan', lastAt: at(1, 9, 0) }] },
];

function renderFriends(overrides: Partial<FriendsDialogProps> = {}) {
  const props: FriendsDialogProps = {
    friends: FRIENDS,
    now: NOW,
    onRename: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<FriendsDialog {...props} />);
  return { ...view, props };
}

const dialog = () => screen.getByRole('dialog', { name: 'Friends' });
const list = () => screen.getByRole('list', { name: 'Friends, latest first' });
const rows = () => within(list()).getAllByRole('listitem');
const row = (name: string) =>
  rows().find((item) => item.querySelector('.friends-item__name')?.textContent === name)!;
const status = () => dialog().querySelector('[role="status"]')!;

describe('FriendsDialog', () => {
  it('says what it is for, read with its name as focus moves in', () => {
    renderFriends();
    expect(dialog()).toHaveAccessibleDescription(
      "Everyone who has sent you a time, latest first. The name you give someone is the one you'll see on all their times, past ones too; until you do, each time shows the name its link gave.",
    );
  });

  it('lists everyone, the latest link first, each dated by it', () => {
    renderFriends();
    expect(
      rows().map((item) => [
        item.querySelector('.friends-item__name')?.textContent,
        item.querySelector('.history-item__date')?.textContent,
      ]),
    ).toEqual([
      ['אלכסנדרה', 'Today 14:05'],
      ['Ally', 'Today 13:00'],
      ['No name', '10 Oct'],
      ['Dan', '1 Oct'],
    ]);
  });

  it('keeps every name in its own direction, and says "No name" plainly', () => {
    renderFriends();
    expect(within(row('אלכסנדרה')).getByText('אלכסנדרה').tagName).toBe('BDI');
    expect(within(row('Ally')).getByText('Ally').tagName).toBe('BDI');
    expect(row('No name').querySelector('bdi')).toBeNull();
  });

  it('says where an unnamed friend’s name comes from, or that their links give none', () => {
    renderFriends();
    expect(row('אלכסנדרה').querySelector('.history-item__status')).toHaveTextContent(
      'Name from their latest link',
    );
    expect(row('No name').querySelector('.history-item__status')).toHaveTextContent(
      'Their links give no name',
    );
  });

  it("says what a named friend's latest link calls them, and how many devices they send from", () => {
    renderFriends();
    const status = row('Ally').querySelector('.history-item__status')!;
    expect(status).toHaveTextContent('Their latest link says Al · 2 devices');
    expect(within(status as HTMLElement).getByText('Al').tagName).toBe('BDI');
    // Named as their link names them: nothing more to say.
    expect(row('Dan').querySelector('.history-item__status')).toBeNull();
  });

  it('names every Rename after its friend, so a list of buttons makes sense alone', () => {
    renderFriends();
    expect(
      within(list())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Rename אלכסנדרה, latest link Today 14:05',
      'Rename Ally, latest link Today 13:00',
      'Rename friend with no name, latest link 10 Oct',
      'Rename Dan, latest link 1 Oct',
    ]);
  });

  it('opens on the first Rename', () => {
    renderFriends();
    expect(within(rows()[0]).getByRole('button', { name: /^Rename/ })).toHaveFocus();
  });

  describe('renaming', () => {
    const field = () => screen.getByRole('textbox', { name: 'Their name' });

    function open(name: string) {
      fireEvent.click(within(row(name)).getByRole('button', { name: /^Rename/ }));
    }

    it('opens in place of Rename, the name it goes by now focused and selected', () => {
      renderFriends();
      open('Ally');
      const group = within(row('Ally')).getByRole('group', {
        name: 'Rename Ally, latest link Today 13:00',
      });
      expect(within(group).getByRole('textbox')).toBe(field());
      expect(field()).toHaveValue('Ally');
      expect(field()).toHaveFocus();
      const input = field() as HTMLInputElement;
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
      expect(field()).toHaveAccessibleDescription(
        'Leave it empty to go by the names in their links.',
      );
      expect(field()).toHaveAttribute('maxLength', '64');
      expect(field()).toHaveAttribute('autoComplete', 'off');
      expect(
        within(group).getByRole('button', { name: 'Save name, Ally, latest link Today 13:00' }),
      ).toBeVisible();
      expect(
        within(group).getByRole('button', {
          name: 'Cancel renaming Ally, latest link Today 13:00',
        }),
      ).toBeVisible();
      expect(within(row('Ally')).queryByRole('button', { name: /^Rename/ })).toBeNull();
    });

    it("fills in an unnamed friend's latest link name, or nothing for none", () => {
      renderFriends();
      open('אלכסנדרה');
      expect(field()).toHaveValue('אלכסנדרה');
      open('No name');
      expect(field()).toHaveValue('');
    });

    it('opens one at a time', () => {
      renderFriends();
      open('Ally');
      open('Dan');
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(field()).toHaveValue('Dan');
      expect(within(row('Ally')).getByRole('button', { name: /^Rename/ })).toBeVisible();
    });

    it('saves on Save, by the friend’s key, then gives focus back to their Rename and says so', () => {
      const { props } = renderFriends();
      open('Ally');
      fireEvent.change(field(), { target: { value: '  Ally  Bee ' } });
      fireEvent.click(screen.getByRole('button', { name: /^Save name, Ally/ }));
      expect(props.onRename).toHaveBeenCalledExactlyOnceWith('k3x9q7za2m', '  Ally  Bee ');
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(within(row('Ally')).getByRole('button', { name: /^Rename/ })).toHaveFocus();
      expect(status()).toHaveTextContent("Renamed: you'll see them as Ally Bee.");
    });

    it('saves on Enter in the field, but not on the Enter that picks a composed character', () => {
      const { props } = renderFriends();
      open('No name');
      fireEvent.change(field(), { target: { value: 'Zed' } });
      fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
      expect(props.onRename).not.toHaveBeenCalled();
      fireEvent.keyDown(field(), { key: 'Enter' });
      expect(props.onRename).toHaveBeenCalledExactlyOnceWith('z8c2m5r1to', 'Zed');
      expect(within(row('No name')).getByRole('button', { name: /^Rename/ })).toHaveFocus();
    });

    it('saves an empty name as one, and says each time shows its link’s name again', () => {
      const { props } = renderFriends();
      open('Ally');
      fireEvent.change(field(), { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: /^Save name/ }));
      expect(props.onRename).toHaveBeenCalledExactlyOnceWith('k3x9q7za2m', '   ');
      expect(status()).toHaveTextContent(
        'Name cleared: each of their times shows the name its link gave.',
      );
    });

    it('tidies the name as the field loses focus', () => {
      renderFriends();
      open('Ally');
      fireEvent.change(field(), { target: { value: ' Ally ‮ Bee ' } });
      fireEvent.blur(field());
      expect(field()).toHaveValue('Ally Bee');
    });

    it.each(['the field', 'Save', 'Cancel'])(
      'backs out on Escape from %s, without closing the dialog, focus back on Rename',
      (where) => {
        const { props } = renderFriends();
        open('Dan');
        fireEvent.change(field(), { target: { value: 'Daniel' } });
        const target =
          where === 'the field'
            ? field()
            : screen.getByRole('button', { name: new RegExp(`^${where}`) });
        fireEvent.keyDown(target, { key: 'Escape' });
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(props.onClose).not.toHaveBeenCalled();
        expect(props.onRename).not.toHaveBeenCalled();
        expect(within(row('Dan')).getByRole('button', { name: /^Rename/ })).toHaveFocus();
        expect(dialog()).toBeInTheDocument();
      },
    );

    it('backs out on Cancel, saying nothing', () => {
      const { props } = renderFriends();
      open('Dan');
      fireEvent.click(screen.getByRole('button', { name: /^Cancel renaming Dan/ }));
      expect(props.onRename).not.toHaveBeenCalled();
      expect(within(row('Dan')).getByRole('button', { name: /^Rename/ })).toHaveFocus();
      expect(status()).toBeEmptyDOMElement();
    });

    it('ignores other keys in the field', () => {
      const { props } = renderFriends();
      open('Dan');
      fireEvent.keyDown(field(), { key: 'a' });
      fireEvent.keyDown(screen.getByRole('button', { name: /^Save name/ }), { key: 'a' });
      expect(field()).toBeInTheDocument();
      expect(props.onRename).not.toHaveBeenCalled();
    });

    it('says the same thing again as a new message, so it is announced again', () => {
      renderFriends();
      for (let i = 0; i < 2; i++) {
        open('Dan');
        fireEvent.click(screen.getByRole('button', { name: /^Save name/ }));
      }
      const said = status().firstElementChild;
      open('Dan');
      fireEvent.click(screen.getByRole('button', { name: /^Save name/ }));
      expect(status()).toHaveTextContent("Renamed: you'll see them as Dan.");
      expect(status().firstElementChild).not.toBe(said);
    });

    it('shows the new name once the list it is given has it, in the same place', () => {
      const { rerender, props } = renderFriends();
      open('No name');
      fireEvent.change(field(), { target: { value: 'Zed' } });
      fireEvent.click(screen.getByRole('button', { name: /^Save name/ }));
      const renamed = FRIENDS.map((friend, i) => (i === 0 ? { ...friend, name: 'Zed' } : friend));
      rerender(<FriendsDialog {...props} friends={renamed} />);
      expect(rows()[2].querySelector('.friends-item__name')).toHaveTextContent('Zed');
      expect(within(rows()[2]).getByRole('button', { name: /^Rename Zed/ })).toHaveFocus();
    });
  });

  it('closes from its close button', () => {
    const { props } = renderFriends();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
