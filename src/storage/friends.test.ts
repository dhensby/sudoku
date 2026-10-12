import { describe, expect, it } from 'vitest';
import { MAX_NEWER_FIELDS, MAX_NEWER_FIELD_JSON } from '../core';
import {
  MAX_FRIEND_DEVICES,
  byRecency,
  challengerName,
  friendKey,
  friendLabel,
  indexFriends,
  lastLinkAt,
  latestSentAs,
  meetDevice,
  namedChallenge,
  namedRecord,
  normaliseFriends,
  renameFriend,
  type Friend,
  type FriendDevice,
} from './friends';
import type { Challenge, GameRecord } from './history';

const ALLY = 'k3x9q7za2m';
const AL = 'p0d4wq81xe';
const ZED = 'z8c2m5r1to';
const NOBODY = 'n0b0dyh3re';
const NO_HELP = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };

/**
 * The store as the module comment draws it: Ally — named here — on two
 * devices (as a later version's merge leaves a friend), and someone whose
 * links have never given a name, on one.
 */
const FRIENDS: readonly Friend[] = [
  {
    name: 'Ally',
    devices: [
      { id: ALLY, sentAs: 'Rude McRudeface', lastAt: 1_791_763_200_000 },
      { id: AL, sentAs: 'Al', lastAt: 1_791_849_600_000 },
    ],
  },
  { devices: [{ id: ZED, lastAt: 1_791_676_800_000 }] },
];

/** A challenge from a link: `name` as the link gave it, from the device `playerId`. */
function challenge(name: string | null, playerId?: string): Challenge {
  return {
    name,
    seconds: 323,
    assists: NO_HELP,
    ...(playerId === undefined ? {} : { playerId }),
  };
}

/** A record raced against `against`. */
function raced(against: Challenge | null): GameRecord {
  return {
    id: 'raced-0001',
    givens: '0'.repeat(81),
    difficulty: 'easy',
    source: 'shared',
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    status: 'playing',
    elapsedMs: 0,
    assists: NO_HELP,
    challenge: against,
  };
}

/** `count` unnamed friends of one device each, heard from at 1000, 1001…, oldest first. */
function crowd(count: number): Friend[] {
  return Array.from({ length: count }, (_, i) => ({
    devices: [{ id: `d${String(i).padStart(9, '0')}`, lastAt: 1000 + i }],
  }));
}

const deviceCount = (friends: readonly Friend[]) =>
  friends.reduce((sum, friend) => sum + friend.devices.length, 0);

/** Through storage and back, as `loadFriends` reads what `updateFriends` wrote. */
const roundTrip = (friends: readonly Friend[]) =>
  normaliseFriends(JSON.parse(JSON.stringify(friends)));

describe('normaliseFriends', () => {
  it('reads the store back exactly as it was written', () => {
    expect(roundTrip(FRIENDS)).toStrictEqual(FRIENDS);
  });

  it.each([
    ['nothing', null],
    ['an object keyed by ID', { [ALLY]: { name: 'Ally' } }],
    ['a string', '[]'],
    ['a number', 42],
  ])('reads %s as no friends at all', (_, value) => {
    expect(normaliseFriends(value)).toEqual([]);
  });

  it('drops a friend that is not one, costing nobody else', () => {
    expect(
      normaliseFriends([
        null,
        'Ally',
        [FRIENDS[0]],
        { name: 'No devices' },
        { name: 'Devices not a list', devices: { [ALLY]: { lastAt: 1 } } },
        { name: 'Nothing left', devices: [{ id: 'BAD ID', lastAt: 1 }] },
        { name: 'No devices at all', devices: [] },
        FRIENDS[1],
      ]),
    ).toStrictEqual([FRIENDS[1]]);
  });

  it.each([
    ['not an object', 'k3x9q7za2m'],
    ['without an ID', { lastAt: 1 }],
    ['with a garbled ID', { id: 'K3X9Q7ZA2M', lastAt: 1 }],
    ['with an ID of __proto__', { id: '__proto__', lastAt: 1 }],
    ['with no time it was last heard from', { id: NOBODY }],
    ['last heard from at NaN', { id: NOBODY, lastAt: Number.NaN }],
    ['last heard from before 1970', { id: NOBODY, lastAt: -1 }],
    ['last heard from at a time that is not a number', { id: NOBODY, lastAt: '1000' }],
  ])('drops a device %s, keeping the rest of its friend', (_, device) => {
    const friends = normaliseFriends([
      { name: 'Ally', devices: [device, { id: ALLY, lastAt: 5 }] },
    ]);
    expect(friends).toStrictEqual([{ name: 'Ally', devices: [{ id: ALLY, lastAt: 5 }] }]);
  });

  it('drops a device whose time is not finite, which JSON cannot even hold', () => {
    expect(
      normaliseFriends([{ devices: [{ id: NOBODY, lastAt: Number.POSITIVE_INFINITY }] }]),
    ).toEqual([]);
  });

  it('floors the time a device was last heard from', () => {
    expect(normaliseFriends([{ devices: [{ id: ALLY, lastAt: 1234.9 }] }])).toStrictEqual([
      { devices: [{ id: ALLY, lastAt: 1234 }] },
    ]);
  });

  it('gives a device to the first friend that has it, dropping a friend left with none', () => {
    expect(
      normaliseFriends([
        { name: 'First', devices: [{ id: ALLY, lastAt: 1 }] },
        { name: 'Second', devices: [{ id: ALLY, lastAt: 2 }] },
        {
          name: 'Third',
          devices: [
            { id: AL, lastAt: 3 },
            { id: AL, lastAt: 4 },
            { id: ALLY, lastAt: 5 },
          ],
        },
      ]),
    ).toStrictEqual([
      { name: 'First', devices: [{ id: ALLY, lastAt: 1 }] },
      { name: 'Third', devices: [{ id: AL, lastAt: 3 }] },
    ]);
  });

  it('lets a device dropped as junk claim nothing: a good copy of it later is kept', () => {
    expect(
      normaliseFriends([
        { devices: [{ id: ALLY, lastAt: 'soon' }] },
        { devices: [{ id: ALLY, lastAt: 7 }] },
      ]),
    ).toStrictEqual([{ devices: [{ id: ALLY, lastAt: 7 }] }]);
  });

  it('tidies the names given and sent, as every name is tidied', () => {
    const [friend] = normaliseFriends([
      {
        name: '‮Dan‬',
        devices: [
          { id: ALLY, sentAs: 'Rude\n\nName', lastAt: 1 },
          { id: AL, sentAs: 'A name far too long to fit on any card at all', lastAt: 2 },
        ],
      },
    ]);
    expect(friend).toStrictEqual({
      name: 'Dan',
      devices: [
        { id: ALLY, sentAs: 'Rude Name', lastAt: 1 },
        { id: AL, sentAs: 'A name far too long to…', lastAt: 2 },
      ],
    });
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['only invisible characters', '​‮'],
    ['not a string', 42],
  ])('leaves off a name or a sent name that is %s', (_, name) => {
    expect(
      normaliseFriends([{ name, devices: [{ id: ALLY, sentAs: name, lastAt: 1 }] }]),
    ).toStrictEqual([{ devices: [{ id: ALLY, lastAt: 1 }] }]);
  });

  it("keeps a newer version's small fields on a friend and a device, round trip and all", () => {
    const stored = [
      {
        name: 'Ally',
        colour: 'teal',
        devices: [{ id: ALLY, lastAt: 1, platform: { kind: 'phone' } }],
      },
    ];
    const friends = normaliseFriends(stored);
    expect(friends).toStrictEqual(stored);
    expect(roundTrip(friends)).toStrictEqual(stored);
  });

  it(`keeps no more than ${MAX_NEWER_FIELDS} of them, none longer than ${MAX_NEWER_FIELD_JSON} characters`, () => {
    const extra = Object.fromEntries(
      Array.from({ length: MAX_NEWER_FIELDS + 2 }, (_, i) => [`extra${'abcdefghij'[i]}`, i]),
    );
    const [friend] = normaliseFriends([
      { ...extra, devices: [{ id: ALLY, lastAt: 1, note: 'x'.repeat(MAX_NEWER_FIELD_JSON) }] },
    ]);
    expect(Object.keys(friend)).toHaveLength(MAX_NEWER_FIELDS + 1);
    expect(friend.devices[0]).toStrictEqual({ id: ALLY, lastAt: 1 });
  });

  it('never takes __proto__ for a field, nor lets one reach the prototype', () => {
    const [friend] = normaliseFriends(
      JSON.parse(
        `[{ "__proto__": { "polluted": true }, "devices": [{ "id": "${ALLY}", "lastAt": 1, "__proto__": { "polluted": true } }] }]`,
      ),
    );
    expect(friend).toStrictEqual({ devices: [{ id: ALLY, lastAt: 1 }] });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps a device whose ID is constructor, and finds its friend by it', () => {
    const stored = [{ name: 'Con', devices: [{ id: 'constructor', lastAt: 1 }] }];
    const friends = normaliseFriends(JSON.parse(JSON.stringify(stored)));
    expect(friends).toStrictEqual(stored);
    const index = indexFriends(friends);
    expect(index.get('constructor')).toBe(friends[0]);
    expect(challengerName(index, challenge('Rude', 'constructor'))).toBe('Con');
    // Nothing else on an object's prototype is a friend.
    expect(index.get('toString')).toBeUndefined();
  });
});

describe('indexFriends', () => {
  it('finds each friend by any of their devices', () => {
    const index = indexFriends(FRIENDS);
    expect(index.get(ALLY)).toBe(FRIENDS[0]);
    expect(index.get(AL)).toBe(FRIENDS[0]);
    expect(index.get(ZED)).toBe(FRIENDS[1]);
    expect(index.get(NOBODY)).toBeUndefined();
    expect(index.size).toBe(3);
  });
});

describe('meetDevice', () => {
  it('adds a device new here as a friend of its own, unnamed, at the end', () => {
    const met = meetDevice(FRIENDS, { id: NOBODY, sentAs: '  New\tName ', at: 9 });
    expect(met).toStrictEqual([
      ...FRIENDS,
      { devices: [{ id: NOBODY, sentAs: 'New Name', lastAt: 9 }] },
    ]);
    // The rest are untouched, so nothing else draws again.
    expect(met[0]).toBe(FRIENDS[0]);
  });

  it.each([
    ['no name', null],
    ['a name that tidies to nothing', ' ​ '],
  ])('adds a device whose link gave %s with no name sent', (_, sentAs) => {
    expect(meetDevice([], { id: NOBODY, sentAs, at: 9 })).toStrictEqual([
      { devices: [{ id: NOBODY, lastAt: 9 }] },
    ]);
  });

  it('notes a known device heard from again, and the name its link gave', () => {
    const met = meetDevice(FRIENDS, { id: ALLY, sentAs: 'Ruder', at: 1_800_000_000_000 });
    expect(met[0]).toStrictEqual({
      name: 'Ally',
      devices: [{ id: ALLY, sentAs: 'Ruder', lastAt: 1_800_000_000_000 }, FRIENDS[0].devices[1]],
    });
    expect(met[1]).toBe(FRIENDS[1]);
  });

  it('keeps the name a device sent before when its new link gives none', () => {
    const met = meetDevice(FRIENDS, { id: AL, sentAs: null, at: 1_800_000_000_000 });
    expect(met[0].devices[1]).toStrictEqual({ id: AL, sentAs: 'Al', lastAt: 1_800_000_000_000 });
  });

  it('never moves a device, nor touches the name given its friend', () => {
    const met = meetDevice(FRIENDS, { id: ZED, sentAs: 'Ally', at: 1_900_000_000_000 });
    expect(met.map(friendKey)).toEqual(FRIENDS.map(friendKey));
    expect(met[1]).toStrictEqual({
      devices: [{ id: ZED, sentAs: 'Ally', lastAt: 1_900_000_000_000 }],
    });
    expect(met[0]).toBe(FRIENDS[0]);
  });

  it('gives back the same list for a link it has noted already', () => {
    const { id, sentAs, lastAt } = FRIENDS[0].devices[0] as Required<FriendDevice>;
    expect(meetDevice(FRIENDS, { id, sentAs, at: lastAt })).toBe(FRIENDS);
    expect(meetDevice(FRIENDS, { id, sentAs: null, at: lastAt })).toBe(FRIENDS);
  });

  it("keeps a newer version's fields on the device it notes", () => {
    const stored = normaliseFriends([{ devices: [{ id: ALLY, lastAt: 1, platform: 'phone' }] }]);
    expect(meetDevice(stored, { id: ALLY, sentAs: 'Al', at: 2 })).toStrictEqual([
      { devices: [{ id: ALLY, lastAt: 2, platform: 'phone', sentAs: 'Al' }] },
    ]);
  });

  describe(`past ${MAX_FRIEND_DEVICES} devices`, () => {
    it('forgets the device heard from longest ago to make room for a new one', () => {
      const full = crowd(MAX_FRIEND_DEVICES);
      const met = meetDevice(full, { id: NOBODY, sentAs: null, at: 5000 });
      expect(deviceCount(met)).toBe(MAX_FRIEND_DEVICES);
      expect(met.map(friendKey)).toEqual([...full.slice(1).map(friendKey), NOBODY]);
    });

    it('keeps them all while there is room', () => {
      const full = crowd(MAX_FRIEND_DEVICES - 1);
      expect(deviceCount(meetDevice(full, { id: NOBODY, sentAs: null, at: 5000 }))).toBe(
        MAX_FRIEND_DEVICES,
      );
    });

    it('never forgets the device just met, even one with the oldest time of all', () => {
      const met = meetDevice(crowd(MAX_FRIEND_DEVICES), { id: NOBODY, sentAs: null, at: 0 });
      expect(met.at(-1)).toStrictEqual({ devices: [{ id: NOBODY, lastAt: 0 }] });
      expect(met[0]).toStrictEqual(crowd(MAX_FRIEND_DEVICES)[1]);
    });

    it('breaks a tie by the list, the earlier device going first', () => {
      const tied = crowd(MAX_FRIEND_DEVICES).map((friend) => ({
        devices: [{ ...friend.devices[0], lastAt: 1000 }],
      }));
      const met = meetDevice(tied, { id: NOBODY, sentAs: null, at: 5000 });
      expect(met.map(friendKey)).toEqual([...tied.slice(1).map(friendKey), NOBODY]);
    });

    it('takes a friend left with no devices out of the list, and their name with them', () => {
      const named: Friend = {
        name: 'Forgotten',
        devices: [
          { id: ALLY, lastAt: 1 },
          { id: AL, lastAt: 2 },
        ],
      };
      const full = [named, ...crowd(MAX_FRIEND_DEVICES - 2)];
      const once = meetDevice(full, { id: NOBODY, sentAs: null, at: 5000 });
      // One device goes; the name stays with the other.
      expect(once[0]).toStrictEqual({ name: 'Forgotten', devices: [{ id: AL, lastAt: 2 }] });
      const twice = meetDevice(once, { id: ZED, sentAs: null, at: 5001 });
      expect(twice.some((friend) => friend.name === 'Forgotten')).toBe(false);
      expect(indexFriends(twice).has(AL)).toBe(false);
      expect(deviceCount(twice)).toBe(MAX_FRIEND_DEVICES);
    });

    it("trims a newer version's longer list only as a new device is met", () => {
      const longer = crowd(MAX_FRIEND_DEVICES + 5);
      expect(normaliseFriends(longer)).toHaveLength(MAX_FRIEND_DEVICES + 5);
      // Hearing from one already known adds nothing, so trims nothing.
      const known = longer[3].devices[0];
      expect(meetDevice(longer, { id: known.id, sentAs: null, at: 9000 })).toHaveLength(
        MAX_FRIEND_DEVICES + 5,
      );
      const met = meetDevice(longer, { id: NOBODY, sentAs: null, at: 9000 });
      expect(deviceCount(met)).toBe(MAX_FRIEND_DEVICES);
      expect(met.map(friendKey)).toEqual([...longer.slice(6).map(friendKey), NOBODY]);
    });
  });
});

describe('renameFriend', () => {
  it('names a friend, tidied, by any of their devices', () => {
    const byFirst = renameFriend(FRIENDS, ALLY, '  Ally ‮Bee ');
    const bySecond = renameFriend(FRIENDS, AL, 'Ally Bee');
    expect(byFirst[0]).toStrictEqual({ ...FRIENDS[0], name: 'Ally Bee' });
    expect(bySecond).toStrictEqual(byFirst);
    expect(byFirst[1]).toBe(FRIENDS[1]);
  });

  it('names a friend who had no name', () => {
    expect(renameFriend(FRIENDS, ZED, 'Zed')[1]).toStrictEqual({ ...FRIENDS[1], name: 'Zed' });
  });

  it.each([
    ['empty', ''],
    ['nothing but spaces', '   '],
  ])('takes the name off when the new one is %s', (_, name) => {
    const renamed = renameFriend(FRIENDS, AL, name);
    expect(renamed[0]).toStrictEqual({ devices: FRIENDS[0].devices });
    expect(renamed[0]).not.toHaveProperty('name');
  });

  it('gives back the same list for the same name, an unknown device, or no name to take off', () => {
    expect(renameFriend(FRIENDS, ALLY, ' Ally ')).toBe(FRIENDS);
    expect(renameFriend(FRIENDS, NOBODY, 'Someone')).toBe(FRIENDS);
    expect(renameFriend(FRIENDS, ZED, '')).toBe(FRIENDS);
  });

  it('stores the very name a link gave, so a later link cannot change it', () => {
    const named = renameFriend(FRIENDS, ZED, 'Zed');
    const later = meetDevice(named, { id: ZED, sentAs: 'Rude', at: 1_900_000_000_000 });
    expect(friendLabel(later[1])).toBe('Zed');
  });

  it("keeps a newer version's fields on the friend it renames", () => {
    const stored = normaliseFriends([{ colour: 'teal', devices: [{ id: ALLY, lastAt: 1 }] }]);
    expect(renameFriend(stored, ALLY, 'Ally')).toStrictEqual([
      { colour: 'teal', name: 'Ally', devices: [{ id: ALLY, lastAt: 1 }] },
    ]);
    expect(renameFriend(renameFriend(stored, ALLY, 'Ally'), ALLY, '')).toStrictEqual(stored);
  });
});

describe('names, resolved as they are drawn', () => {
  const index = indexFriends(FRIENDS);

  it.each([
    ['the name given the friend, from either device', challenge('Rude', AL), 'Ally'],
    ['the name given them, when the link gave none', challenge(null, ALLY), 'Ally'],
    ["the link's own name, for a friend with none given", challenge('Zed', ZED), 'Zed'],
    ["the link's own none, for a friend with none given", challenge(null, ZED), null],
    ["the link's own name, for a device not in the list", challenge('Who', NOBODY), 'Who'],
    ["the link's own name, for a link without an ID", challenge('Ally?', undefined), 'Ally?'],
  ])('shows %s', (_, from, name) => {
    expect(challengerName(index, from)).toBe(name);
    expect(namedChallenge(index, from)).toStrictEqual({ ...from, name });
  });

  it('gives back the same challenge, and the same record, when the name is the same', () => {
    const own = challenge('Zed', ZED);
    expect(namedChallenge(index, own)).toBe(own);
    const record = raced(own);
    expect(namedRecord(index, record)).toBe(record);
    const alone = raced(null);
    expect(namedRecord(index, alone)).toBe(alone);
  });

  it("names a record's challenge afresh, leaving the record it came from as it was", () => {
    const record = raced(challenge('Rude', ALLY));
    const named = namedRecord(index, record);
    expect(named).toStrictEqual({ ...record, challenge: { ...record.challenge, name: 'Ally' } });
    expect(record.challenge?.name).toBe('Rude');
  });
});

describe('for the Friends dialog', () => {
  it("keys a friend by their first device's ID", () => {
    expect(FRIENDS.map(friendKey)).toEqual([ALLY, ZED]);
  });

  it('dates a friend by the latest link from any of their devices', () => {
    expect(lastLinkAt(FRIENDS[0])).toBe(1_791_849_600_000);
    expect(lastLinkAt(FRIENDS[1])).toBe(1_791_676_800_000);
  });

  it('takes the name the most recent link to give one gave', () => {
    expect(latestSentAs(FRIENDS[0])).toBe('Al');
    expect(latestSentAs(FRIENDS[1])).toBeNull();
    const quietLatest: Friend = {
      devices: [
        { id: ALLY, sentAs: 'Older', lastAt: 1 },
        { id: AL, lastAt: 9 },
      ],
    };
    expect(latestSentAs(quietLatest)).toBe('Older');
  });

  it('calls a friend by the name given them, else their latest link’s, else nothing', () => {
    expect(friendLabel(FRIENDS[0])).toBe('Ally');
    expect(friendLabel({ devices: FRIENDS[0].devices })).toBe('Al');
    expect(friendLabel(FRIENDS[1])).toBeNull();
  });

  it('lists the friend heard from most recently first, a tie in the order stored', () => {
    const tied: Friend = { name: 'Tied', devices: [{ id: NOBODY, lastAt: 1_791_849_600_000 }] };
    expect(byRecency([FRIENDS[1], FRIENDS[0], tied])).toEqual([FRIENDS[0], tied, FRIENDS[1]]);
    expect(byRecency([FRIENDS[1], tied, FRIENDS[0]])).toEqual([tied, FRIENDS[0], FRIENDS[1]]);
  });
});

describe('every change reads back exactly as it was written', () => {
  const STORED = normaliseFriends([
    { ...FRIENDS[0], colour: 'teal' },
    { devices: [{ ...FRIENDS[1].devices[0], platform: 'phone' }] },
  ]);

  it.each([
    ['as stored', STORED],
    [
      'with a device noted again',
      meetDevice(STORED, { id: AL, sentAs: 'Ally B', at: 1_900_000_000_000 }),
    ],
    [
      'with a device met for the first time',
      meetDevice(STORED, { id: NOBODY, sentAs: 'New', at: 1 }),
    ],
    [
      'past the cap',
      meetDevice([...STORED, ...crowd(MAX_FRIEND_DEVICES)], { id: NOBODY, sentAs: null, at: 2 }),
    ],
    ['with a friend renamed', renameFriend(STORED, ZED, 'Zed')],
    ['with a name taken off', renameFriend(STORED, ALLY, '')],
  ])('%s', (_, friends) => {
    expect(roundTrip(friends)).toStrictEqual(friends);
  });
});
