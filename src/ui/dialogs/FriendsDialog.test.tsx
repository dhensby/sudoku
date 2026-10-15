import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { mergeFriends, splitDevice, type Friend } from '../../storage/friends';
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
    onMerge: vi.fn(),
    onSplit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<FriendsDialog {...props} />);
  return { ...view, props };
}

/**
 * Friends as the app holds it: a merge or a split changes the list it is
 * given, in the same render as the dialog's own — so the rows have moved by
 * the time focus follows them.
 */
function renderLive(overrides: Partial<FriendsDialogProps> = {}) {
  const onMerge = vi.fn();
  const onSplit = vi.fn();
  function Live() {
    const [friends, setFriends] = useState(overrides.friends ?? FRIENDS);
    return (
      <FriendsDialog
        now={NOW}
        onRename={vi.fn()}
        onClose={vi.fn()}
        friends={friends}
        onMerge={(fromId, intoId) => {
          onMerge(fromId, intoId);
          setFriends((list) => mergeFriends(list, fromId, intoId));
        }}
        onSplit={(deviceId) => {
          onSplit(deviceId);
          setFriends((list) => splitDevice(list, deviceId));
        }}
      />
    );
  }
  render(<Live />);
  return { onMerge, onSplit };
}

const dialog = () => screen.getByRole('dialog', { name: 'Friends' });
const list = () => screen.getByRole('list', { name: 'Friends, latest first' });
/** The friends' rows — not the devices listed inside a merged friend's. */
const rows = () => Array.from(list().querySelectorAll<HTMLElement>(':scope > li'));
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

  it('names every button after its friend, so a list of buttons makes sense alone', () => {
    renderFriends();
    expect(
      within(list())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Rename אלכסנדרה, latest link Today 14:05',
      'Merge אלכסנדרה, latest link Today 14:05 with another friend',
      'Split off Rude McRudeface, latest link Yesterday 09:12, from Ally',
      'Split off Al, latest link Today 13:00, from Ally',
      'Rename Ally, latest link Today 13:00',
      'Merge Ally, latest link Today 13:00 with another friend',
      'Rename friend with no name, latest link 10 Oct',
      'Merge friend with no name, latest link 10 Oct with another friend',
      'Rename Dan, latest link 1 Oct',
      'Merge Dan, latest link 1 Oct with another friend',
    ]);
    // Visible labels never hold a name, so none needs room to wrap.
    expect([
      ...new Set(
        within(list())
          .getAllByRole('button')
          .map((button) => button.textContent),
      ),
    ]).toEqual(['Rename', 'Merge…', 'Split off']);
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
      // Safari's, confirming it: the composition already over, the key still the input method's.
      fireEvent.keyDown(field(), { key: 'Enter', keyCode: 229 });
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

  describe("a merged friend's devices", () => {
    it('lists them, once there are two, each by the name its links gave and dated', () => {
      renderFriends();
      const devices = within(row('Ally')).getByRole('list', {
        name: 'Devices, Ally, latest link Today 13:00',
      });
      expect(
        within(devices)
          .getAllByRole('listitem')
          .map((item) => item.querySelector('span')?.textContent),
      ).toEqual(['Rude McRudeface · latest link Yesterday 09:12', 'Al · latest link Today 13:00']);
      // Names from links anyone can write, kept in their own direction.
      expect(within(devices).getByText('Rude McRudeface').tagName).toBe('BDI');
      // One device: nothing to split off.
      for (const name of ['אלכסנדרה', 'No name', 'Dan']) {
        expect(within(row(name)).queryByRole('list')).toBeNull();
        expect(within(row(name)).queryByRole('button', { name: /^Split off/ })).toBeNull();
      }
    });

    it('says "No name" plainly for a device whose links give none', () => {
      renderFriends({
        friends: [
          {
            devices: [
              { id: 'z8c2m5r1to', lastAt: at(10, 18, 0) },
              { id: 'q1w2e3r4t5', lastAt: at(12, 14, 5) },
            ],
          },
        ],
      });
      const devices = within(rows()[0]).getByRole('list', {
        name: /^Devices, friend with no name/,
      });
      expect(devices.querySelector('bdi')).toBeNull();
      expect(devices).toHaveTextContent('No name · latest link 10 Oct');
      expect(
        within(devices).getByRole('button', {
          name: 'Split off the device with no name, latest link Today 14:05, from friend with no name',
        }),
      ).toBeVisible();
    });

    it('splits one off on Split off, focus on the Rename of the friend it now is, and says so', () => {
      const { onSplit } = renderLive();
      fireEvent.click(within(row('Ally')).getByRole('button', { name: /^Split off Al,/ }));
      expect(onSplit).toHaveBeenCalledExactlyOnceWith('p0d4wq81xe');
      // A row of its own, by the name its links gave, latest first.
      expect(rows().map((item) => item.querySelector('.friends-item__name')?.textContent)).toEqual([
        'אלכסנדרה',
        'Al',
        'Ally',
        'No name',
        'Dan',
      ]);
      expect(row('Al').querySelector('.history-item__status')).toHaveTextContent(
        'Name from their latest link',
      );
      expect(within(row('Al')).getByRole('button', { name: /^Rename Al,/ })).toHaveFocus();
      // The friend left keeps their name, on the one device left.
      expect(within(row('Ally')).queryByRole('list')).toBeNull();
      expect(row('Ally').querySelector('.history-item__status')).toHaveTextContent(
        'Their latest link says Rude McRudeface',
      );
      expect(status()).toHaveTextContent('Split off: a friend of their own now.');
    });

    it("finds the friend's Rename, keyed afresh, when their first device is the one split off", () => {
      const { onSplit } = renderLive();
      fireEvent.click(within(row('Ally')).getByRole('button', { name: /^Split off Rude/ }));
      expect(onSplit).toHaveBeenCalledExactlyOnceWith('k3x9q7za2m');
      expect(row('Ally')).toHaveAttribute('data-friend', 'p0d4wq81xe');
      expect(row('Rude McRudeface')).toHaveAttribute('data-friend', 'k3x9q7za2m');
      expect(
        within(row('Rude McRudeface')).getByRole('button', { name: /^Rename Rude McRudeface,/ }),
      ).toHaveFocus();
    });
  });

  describe('merging', () => {
    const picker = () => screen.getByRole('combobox', { name: 'Same person as' });

    function open(name: string) {
      fireEvent.click(within(row(name)).getByRole('button', { name: /^Merge/ }));
    }

    it('is offered only once there is someone else to merge with', () => {
      renderFriends({ friends: [FRIENDS[1]] });
      expect(within(list()).getAllByRole('button', { name: /^Split off/ })).toHaveLength(2);
      expect(within(list()).queryByRole('button', { name: /^Merge/ })).toBeNull();
    });

    it('opens in place of the buttons, everyone else to choose from, latest first, the latest chosen', () => {
      renderFriends();
      open('Dan');
      const group = within(row('Dan')).getByRole('group', { name: 'Merge Dan, latest link 1 Oct' });
      expect(within(group).getByRole('combobox')).toBe(picker());
      expect(picker()).toHaveFocus();
      expect(
        within(picker())
          .getAllByRole('option')
          .map((option) => [option.getAttribute('value'), option.textContent]),
      ).toEqual([
        ['q1w2e3r4t5', 'אלכסנדרה · Today 14:05'],
        ['k3x9q7za2m', 'Ally · Today 13:00'],
        ['z8c2m5r1to', 'No name · 10 Oct'],
      ]);
      expect(picker()).toHaveValue('q1w2e3r4t5');
      expect(picker()).toHaveAccessibleDescription(
        "They become one friend, under the name you gave the one you choose, or else this one's. You can split them apart again.",
      );
      expect(
        within(group).getByRole('button', { name: 'Confirm merge, Dan, latest link 1 Oct' }),
      ).toHaveTextContent('Merge');
      expect(
        within(group).getByRole('button', { name: 'Cancel merging Dan, latest link 1 Oct' }),
      ).toHaveTextContent('Cancel');
      expect(within(row('Dan')).queryByRole('button', { name: /^Rename/ })).toBeNull();
    });

    it('opens one edit at a time, a rename or a merge', () => {
      renderFriends();
      fireEvent.click(within(row('Ally')).getByRole('button', { name: /^Rename/ }));
      open('Dan');
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getAllByRole('group')).toHaveLength(1);
      fireEvent.click(within(row('No name')).getByRole('button', { name: /^Rename/ }));
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(within(row('Dan')).getByRole('button', { name: /^Merge/ })).toBeVisible();
    });

    it('merges into the friend chosen, focus on their Rename, and says how many devices they have', () => {
      const { onMerge } = renderLive();
      open('No name');
      fireEvent.change(picker(), { target: { value: 'k3x9q7za2m' } });
      fireEvent.click(screen.getByRole('button', { name: /^Confirm merge/ }));
      expect(onMerge).toHaveBeenCalledExactlyOnceWith('z8c2m5r1to', 'k3x9q7za2m');
      // One row fewer: the chosen friend's, under their name, with every device.
      expect(rows().map((item) => item.querySelector('.friends-item__name')?.textContent)).toEqual([
        'אלכסנדרה',
        'Ally',
        'Dan',
      ]);
      expect(
        within(row('Ally'))
          .getAllByRole('listitem')
          .map((item) => item.querySelector('bdi')?.textContent ?? 'No name'),
      ).toEqual(['Rude McRudeface', 'Al', 'No name']);
      expect(within(row('Ally')).getByRole('button', { name: /^Rename Ally,/ })).toHaveFocus();
      expect(status()).toHaveTextContent('Merged into one friend, on 3 devices.');
    });

    it('merges into the friend chosen as it stands, before any choice is changed', () => {
      const { props } = renderFriends();
      open('Ally');
      fireEvent.click(screen.getByRole('button', { name: /^Confirm merge/ }));
      expect(props.onMerge).toHaveBeenCalledExactlyOnceWith('k3x9q7za2m', 'q1w2e3r4t5');
      expect(status()).toHaveTextContent('Merged into one friend, on 3 devices.');
    });

    it.each(['the picker', 'Merge', 'Cancel'])(
      'backs out on Escape from %s, without closing the dialog, focus back on Merge…',
      (where) => {
        const { props } = renderFriends();
        open('Dan');
        const target =
          where === 'the picker'
            ? picker()
            : screen.getByRole('button', {
                name: new RegExp(`^${where === 'Merge' ? 'Confirm merge' : 'Cancel merging'}`),
              });
        fireEvent.keyDown(target, { key: 'Escape' });
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(props.onClose).not.toHaveBeenCalled();
        expect(props.onMerge).not.toHaveBeenCalled();
        expect(within(row('Dan')).getByRole('button', { name: /^Merge/ })).toHaveFocus();
        expect(dialog()).toBeInTheDocument();
      },
    );

    it('backs out on Cancel, saying nothing', () => {
      const { props } = renderFriends();
      open('Dan');
      fireEvent.click(screen.getByRole('button', { name: /^Cancel merging Dan/ }));
      expect(props.onMerge).not.toHaveBeenCalled();
      expect(within(row('Dan')).getByRole('button', { name: /^Merge/ })).toHaveFocus();
      expect(status()).toBeEmptyDOMElement();
    });
  });

  it('closes from its close button', () => {
    const { props } = renderFriends();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
