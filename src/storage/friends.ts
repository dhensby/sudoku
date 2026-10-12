import { fieldsOf, newerFields } from '../core';
import type { Challenge, GameRecord } from './history';
import { isObject, isPlayerId, normaliseName } from './storage';

/*
 * The friends whose links have been opened here, or in a browser whose
 * History was imported here, and the names given them.
 *
 * A link with a time carries the player ID of the browser it came from (see
 * `Challenge.playerId`), whatever name it gives — and a link's name is free
 * text anyone can type, so the same friend can send "Dan" one day and "Rude
 * McRudeface" the next. What the player calls them is kept here instead: a
 * friend is a name given them here, if one has been, and the devices (the
 * browsers, each known by its player ID) they share from. Each device
 * arrives as a friend of its own — a phone and a laptop are two friends
 * until the player says they are one (see `mergeFriends`) — and any device
 * can be split off again (see `splitDevice`).
 *
 *   sudoku.friends  [ { "name": "Ally", "devices": [
 *                       { "id": "k3x9q7za2m", "sentAs": "Rude McRudeface", "lastAt": 1791763200000 },
 *                       { "id": "p0d4wq81xe", "sentAs": "Al", "lastAt": 1791849600000 } ] },
 *                     { "devices": [ { "id": "z8c2m5r1to", "lastAt": 1791676800000 } ] } ]
 *
 * A list of friends, each holding its devices, rather than an object keyed by
 * ID: which devices are one friend is the structure itself, so there are no
 * pointers between entries to go stale or repair on reading back. Every
 * lookup by ID goes through a `Map` (see `indexFriends`), so no ID — not
 * even `constructor` — is ever a key on a plain object.
 *
 * Names are resolved as they are drawn, never written into the history: a
 * race keeps the name its link gave (`Challenge.name`), and shows the name
 * given its friend here in its place (see `challengerName`). So naming a
 * friend renames every race of theirs at once, past ones too, and clearing
 * the name gives each race back the name its own link gave.
 *
 * Pure: the I/O lives in `history.ts` (`loadFriends`, `updateFriends`),
 * beside the other small stores (the puzzles seen and watched, the dailies'
 * ledger), and so does History's export, which carries the list to another
 * browser (see `mergeFriendLists`). Every operation here returns the list it
 * was given when nothing changes, which is how `updateFriends` knows to write
 * nothing; and every object it changes is spread rather than rebuilt, so the
 * small fields a newer version added (see `newerFields`) survive a rename, a
 * merge, a split or an import.
 */

/** The most devices kept. Past it, the one heard from longest ago is forgotten (see `meetDevice`). */
export const MAX_FRIEND_DEVICES = 200;

/** One browser a friend shares from, known by the player ID its links carry. */
export interface FriendDevice {
  id: string;
  /** The latest name its links gave, tidied; left off while none has. A link with no name keeps the one before. */
  sentAs?: string;
  /**
   * When a link from it was last opened here — or, for a device an import
   * brought, in the browser it came from (epoch ms, wall clock).
   */
  lastAt: number;
}

/** Someone who sends links: their devices, and the name given them here. */
export interface Friend {
  /** The name given them here, tidied and never ''; left off until then — their links' names show. */
  name?: string;
  /** Never empty. The first device's ID is the friend's key (see `friendKey`). */
  devices: readonly FriendDevice[];
}

/** Each device ID → the friend holding it. A Map, so no ID is ever a key on a plain object. */
export type FriendIndex = ReadonlyMap<string, Friend>;

/** A link from a device, opened at `at`: what `meetDevice` records. */
export interface Sighting {
  id: string;
  /** The name the link gave, or null. */
  sentAs: string | null;
  at: number;
}

/** The fields of a friend this version knows; anything else is kept if small (see `newerFields`). */
const FRIEND_FIELDS = fieldsOf<Friend>({ name: true, devices: true });

/** The fields of a device this version knows. */
const DEVICE_FIELDS = fieldsOf<FriendDevice>({ id: true, sentAs: true, lastAt: true });

// ---------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------

/**
 * A device read back, or null for one that cannot be kept: anything but an
 * object with a player ID, and one with no time it was last heard from — a
 * device that cannot be ordered cannot be weighed against the cap.
 */
function normaliseDevice(value: unknown): FriendDevice | null {
  if (!isObject(value) || !isPlayerId(value.id)) return null;
  const { lastAt } = value;
  if (typeof lastAt !== 'number' || !Number.isFinite(lastAt) || lastAt < 0) return null;
  const sentAs = normaliseName(value.sentAs);
  return {
    ...newerFields(value, DEVICE_FIELDS),
    id: value.id,
    ...(sentAs === '' ? {} : { sentAs }),
    lastAt: Math.floor(lastAt),
  };
}

/**
 * The friends list as storage, or a file exported from History, held it.
 * Junk costs only its own entry: a friend that is not an object, or has no
 * list of devices, is dropped, as is a device that cannot be kept (see
 * `normaliseDevice`), and then a friend left with none. A name is tidied
 * (see `normaliseName`), and left off if nothing is left of it. One rule
 * crosses entries: a device whose ID a device kept earlier in the list
 * already has is dropped, so no device is ever two friends'. Never capped
 * here (see `meetDevice`): a newer version may keep more, and its list is
 * not this one's to trim on every read.
 */
export function normaliseFriends(value: unknown): Friend[] {
  if (!Array.isArray(value)) return [];
  const kept = new Set<string>();
  const friends: Friend[] = [];
  for (const entry of value) {
    if (!isObject(entry) || !Array.isArray(entry.devices)) continue;
    const devices: FriendDevice[] = [];
    for (const item of entry.devices) {
      const device = normaliseDevice(item);
      if (device === null || kept.has(device.id)) continue;
      kept.add(device.id);
      devices.push(device);
    }
    if (devices.length === 0) continue;
    const name = normaliseName(entry.name);
    friends.push({
      ...newerFields(entry, FRIEND_FIELDS),
      ...(name === '' ? {} : { name }),
      devices,
    });
  }
  return friends;
}

/** Each device's friend, by the device's ID (see `FriendIndex`). */
export function indexFriends(friends: readonly Friend[]): FriendIndex {
  const index = new Map<string, Friend>();
  for (const friend of friends) {
    for (const device of friend.devices) index.set(device.id, friend);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

/** `items` with the one at `at` replaced: a new list, the rest shared. */
function replaced<T>(items: readonly T[], at: number, item: T): T[] {
  return items.map((existing, i) => (i === at ? item : existing));
}

/** Where the device `id` is: its friend's place in the list, and its own in theirs; null if nowhere. */
function findDevice(friends: readonly Friend[], id: string): [number, number] | null {
  for (let f = 0; f < friends.length; f++) {
    const d = friends[f].devices.findIndex((device) => device.id === id);
    if (d !== -1) return [f, d];
  }
  return null;
}

/**
 * The list held to MAX_FRIEND_DEVICES devices: the ones heard from longest
 * ago go first (ties in list order), but never `spared`, the device just met
 * — a link must never forget its own sender. A friend left with no devices
 * goes too, and the name given them with it.
 */
function capDevices(friends: readonly Friend[], spared: string): readonly Friend[] {
  const devices = friends.flatMap((friend) => friend.devices);
  const excess = devices.length - MAX_FRIEND_DEVICES;
  if (excess <= 0) return friends;
  const forgotten = new Set(
    devices
      .filter((device) => device.id !== spared)
      // Stable, so a tie goes to the device earlier in the list.
      .sort((a, b) => a.lastAt - b.lastAt)
      .slice(0, excess)
      .map((device) => device.id),
  );
  return friends.flatMap((friend) => {
    if (!friend.devices.some((device) => forgotten.has(device.id))) return [friend];
    const left = friend.devices.filter((device) => !forgotten.has(device.id));
    return left.length === 0 ? [] : [{ ...friend, devices: left }];
  });
}

/**
 * A link from `sighting.id` was opened: noted, whoever sent it.
 *
 * A device known here has when it was last heard from moved on, and the name
 * its link gave kept as its latest — unless the link gave none, when the
 * name before stays. Nothing else moves: not the friend it belongs to, nor
 * the name given them, nor anyone's place in the list.
 *
 * A device new here joins as a friend of its own, unnamed — their links'
 * names show until the player names them — at the end of the list, which is
 * then held to MAX_FRIEND_DEVICES (see `capDevices`).
 */
export function meetDevice(friends: readonly Friend[], sighting: Sighting): readonly Friend[] {
  const sentAs = normaliseName(sighting.sentAs);
  const found = findDevice(friends, sighting.id);
  if (found === null) {
    const device: FriendDevice = {
      id: sighting.id,
      ...(sentAs === '' ? {} : { sentAs }),
      lastAt: sighting.at,
    };
    return capDevices([...friends, { devices: [device] }], sighting.id);
  }
  const [f, d] = found;
  const friend = friends[f];
  const device = friend.devices[d];
  const met: FriendDevice = {
    ...device,
    ...(sentAs === '' ? {} : { sentAs }),
    lastAt: sighting.at,
  };
  if (met.sentAs === device.sentAs && met.lastAt === device.lastAt) return friends;
  return replaced(friends, f, { ...friend, devices: replaced(friend.devices, d, met) });
}

/**
 * The friend holding `deviceId` — any of their devices will do — is called
 * `name` from now on, tidied (see `normaliseName`). A name that tidies to
 * nothing takes the name off, and each of their races shows the name its own
 * link gave again. Saving the very name a link gave still stores it: it then
 * stands whatever their later links call themselves.
 */
export function renameFriend(
  friends: readonly Friend[],
  deviceId: string,
  name: string,
): readonly Friend[] {
  const found = findDevice(friends, deviceId);
  if (found === null) return friends;
  const [f] = found;
  const friend = friends[f];
  const tidy = normaliseName(name);
  if ((friend.name ?? '') === tidy) return friends;
  const { name: _previous, ...unnamed } = friend;
  return replaced(friends, f, tidy === '' ? unnamed : { ...unnamed, name: tidy });
}

/**
 * The friend holding `fromId` is the friend holding `intoId`, on another
 * device: from's devices join into's, after into's own — so into keeps its
 * key (see `friendKey`), and its place in the list — and from leaves the
 * list. The name given into stands, or else the one given from: a merge
 * never makes a name up, and never loses the one name given. Into's newer
 * fields are kept, and from's go with it.
 *
 * The same list back for a device not in it, or for two devices that are
 * one friend's already.
 */
export function mergeFriends(
  friends: readonly Friend[],
  fromId: string,
  intoId: string,
): readonly Friend[] {
  const from = findDevice(friends, fromId);
  const into = findDevice(friends, intoId);
  if (from === null || into === null || from[0] === into[0]) return friends;
  const source = friends[from[0]];
  const target = friends[into[0]];
  const name = target.name ?? source.name;
  const merged: Friend = {
    ...target,
    ...(name === undefined ? {} : { name }),
    devices: [...target.devices, ...source.devices],
  };
  return friends.flatMap((friend, i) => (i === from[0] ? [] : [i === into[0] ? merged : friend]));
}

/**
 * `deviceId` is not the friend it was with after all: it leaves them, to be
 * a friend of its own, unnamed — so each of its races shows the name its own
 * link gave again — straight after them in the list. It takes its own fields
 * with it (the name its links gave, when it was last heard from, a newer
 * version's); the friend keeps their name, their other devices and their
 * newer fields, and their key unless it was the device split off.
 *
 * The same list back for a device not in it, or one that is a friend on its
 * own already.
 */
export function splitDevice(friends: readonly Friend[], deviceId: string): readonly Friend[] {
  const found = findDevice(friends, deviceId);
  if (found === null) return friends;
  const [f, d] = found;
  const friend = friends[f];
  if (friend.devices.length === 1) return friends;
  const left: Friend = { ...friend, devices: friend.devices.filter((_, i) => i !== d) };
  return [...friends.slice(0, f), left, { devices: [friend.devices[d]] }, ...friends.slice(f + 1)];
}

/**
 * The friends a file exported from History brings (see `importHistory`),
 * added to these — where every decision made here stands. Nothing records
 * when a friend was named, merged or split, so there is no telling whose
 * decision is the newer, and an import never undoes one: a device already
 * here stays just as it is — its friend, the name given them, the name its
 * links last gave and when.
 *
 * Only the file's devices new here are added, into the room left under
 * MAX_FRIEND_DEVICES, the most recently heard from first (a tie in the file's
 * order): none here is forgotten to make room for them. Each file friend's
 * new devices join the friend here holding the first of its devices — in
 * the file's order — that this list knows, as the file has them together;
 * one with none known here joins the end of the list as a friend of its own,
 * under the name the file gives it, its newer fields and all.
 *
 * The same list back when the file adds nothing: importing the same file
 * twice, or this browser's own export.
 */
export function mergeFriendLists(
  local: readonly Friend[],
  incoming: readonly Friend[],
): readonly Friend[] {
  const known = indexFriends(local);
  // None when a newer version's longer list is over the cap already.
  const room = Math.max(0, MAX_FRIEND_DEVICES - known.size);
  const taken = new Set(
    incoming
      .flatMap((friend) => friend.devices)
      .filter((device) => !known.has(device.id))
      // Stable, so a tie goes to the device earlier in the file.
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, room)
      .map((device) => device.id),
  );
  if (taken.size === 0) return local;
  const joining = new Map<Friend, FriendDevice[]>();
  const added: Friend[] = [];
  for (const friend of incoming) {
    const devices = friend.devices.filter((device) => taken.has(device.id));
    if (devices.length === 0) continue;
    const into = friend.devices
      .map((device) => known.get(device.id))
      .find((found) => found !== undefined);
    if (into === undefined) added.push({ ...friend, devices });
    else joining.set(into, [...(joining.get(into) ?? []), ...devices]);
  }
  return [
    ...local.map((friend) => {
      const more = joining.get(friend);
      return more === undefined ? friend : { ...friend, devices: [...friend.devices, ...more] };
    }),
    ...added,
  ];
}

// ---------------------------------------------------------------------------
// Names, resolved as they are drawn
// ---------------------------------------------------------------------------

/**
 * The name to show for a challenger: the one given the friend whose device
 * the link came from, if they have been named here; otherwise the name the
 * link itself gave (null for none — "Your friend" where it is drawn). A link
 * without a player ID, from before them or with a garbled one, is known by
 * its own name alone.
 */
export function challengerName(index: FriendIndex, challenge: Challenge): string | null {
  if (challenge.playerId === undefined) return challenge.name;
  return index.get(challenge.playerId)?.name ?? challenge.name;
}

/**
 * A challenge as it is drawn: under the name its friend has been given (see
 * `challengerName`). The same object when that is the link's own name, so
 * what is drawn from it — a memoised row — need not draw again.
 */
export function namedChallenge(index: FriendIndex, challenge: Challenge): Challenge {
  const name = challengerName(index, challenge);
  return name === challenge.name ? challenge : { ...challenge, name };
}

/**
 * A record as History draws it: its challenge named (see `namedChallenge`).
 * The same record unless its challenger's name resolves to another, so only
 * the rows of a friend just renamed draw again. A copy for drawing only,
 * never to be written back.
 */
export function namedRecord(index: FriendIndex, record: GameRecord): GameRecord {
  if (record.challenge === null) return record;
  const challenge = namedChallenge(index, record.challenge);
  return challenge === record.challenge ? record : { ...record, challenge };
}

// ---------------------------------------------------------------------------
// For the Friends dialog
// ---------------------------------------------------------------------------

/** What a friend is known by in the list: their first device's ID. */
export function friendKey(friend: Friend): string {
  return friend.devices[0].id;
}

/** When a link from any of their devices was last opened — here, or where an import brought it from. */
export function lastLinkAt(friend: Friend): number {
  return Math.max(...friend.devices.map((device) => device.lastAt));
}

/** The name their most recent link to give one gave, or null if none ever has. */
export function latestSentAs(friend: Friend): string | null {
  let latest: FriendDevice | null = null;
  for (const device of friend.devices) {
    if (device.sentAs !== undefined && (latest === null || device.lastAt > latest.lastAt)) {
      latest = device;
    }
  }
  return latest?.sentAs ?? null;
}

/** What to call a friend in the list: the name given them, else their latest link's; null for neither. */
export function friendLabel(friend: Friend): string | null {
  return friend.name ?? latestSentAs(friend);
}

/** The friends, the one heard from most recently first; a tie keeps the list's order. */
export function byRecency(friends: readonly Friend[]): Friend[] {
  return [...friends].sort((a, b) => lastLinkAt(b) - lastLinkAt(a));
}
