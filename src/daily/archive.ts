import {
  DAILY_EPOCH,
  addDays,
  dateKeyOf,
  daysBetween,
  isDateKey,
  latestDateAnywhere,
  looksLikeShareCode,
  type DateKey,
  type Difficulty,
} from '../core';
import { DAILY_SEED_PATTERN, DAILY_TIERS, type NewDay } from './generate';

/*
 * The daily archive: the days an engine dealt before it was replaced, frozen
 * so they never change — `archive.json` in this folder, and the pure rules
 * for reading it, extending it and checking it.
 *
 * Every daily is dealt live from its date's seed (see `generate.ts`), so the
 * repository and the bundle hold no list of upcoming puzzles to read ahead
 * in. But a change to the engine — anything that bumps `GENERATOR_VERSION` —
 * changes what every seed deals, past dates included, and a player's past
 * dailies must not change under them. So just before an engine is replaced,
 * the days it has dealt are frozen into the archive, and the new engine
 * takes over from the day after:
 *
 *   {
 *     "epoch": "2026-10-01",
 *     "seed": "daily/<date>/<tier>",
 *     "tiers": ["easy", "medium", "hard", "expert"],
 *     "segments": [
 *       { "version": 4, "from": "2026-10-01" },
 *       { "version": 5, "from": "2026-11-15" }
 *     ],
 *     "frozenThrough": "2026-11-14",
 *     "days": [
 *       "2026-10-01 v4 <easy> <medium> <hard> <expert>",
 *       …one line a day, through frozenThrough…
 *     ]
 *   }
 *
 * `segments` say which engine deals which dates: each from its `from` until
 * the next begins, the last for good. `days` hold one line per frozen day
 * from the epoch, in order: the date, the version that dealt it (the
 * provenance, which must be its segment's) and its four `encodeGivens` codes
 * in `tiers` order — givens only, as the solver recovers each solution in a
 * fraction of a millisecond. A line a day keeps the file Prettier-clean (four
 * codes overflow the print width, so an array of them would fold onto six
 * lines) and every freeze a diff of whole lines.
 *
 * The rules, which the guard test (`archive.guard.test.ts`) holds the
 * committed file to:
 *   - the last segment is the engine in the code: its version is
 *     `GENERATOR_VERSION`;
 *   - it starts the day after `frozenThrough` (on the epoch while nothing is
 *     frozen), and the frozen days run from the epoch to `frozenThrough`
 *     without a gap — so every day an older engine dealt is in the archive,
 *     and no day is in both.
 * Bumping `GENERATOR_VERSION` without freezing breaks the first rule;
 * freezing without switching, or switching without freezing, the second.
 *
 * Neither rule looks at the clock, so neither can tell a switch made in time
 * from one merged after the days it hands over have begun, nor a live
 * segment re-pointed by hand from one that never dealt a day. For that, a
 * change to the archive is held to the one already released — the file on
 * main — at the moment it is checked (`checkAgainstRelease`): only what no
 * player can have been dealt yet may change. Until dailies are first
 * released, nothing has been dealt to anyone, and the one segment simply
 * follows `GENERATOR_VERSION` (`switchEngine` re-points it).
 *
 * The file is read as a chunk of its own (see `dailies.ts`), so it costs the
 * app's first load nothing; frozen days only ever accumulate up to the last
 * engine change, at about 150 bytes a day.
 */

/** One engine's dates: from `from` until the next segment begins (the last segment, for good). */
export interface Segment {
  /** The `GENERATOR_VERSION` that deals these dates. */
  version: number;
  from: DateKey;
}

/** A day dealt by an engine since replaced, frozen as that engine dealt it. */
export interface FrozenDay {
  date: DateKey;
  /** The `GENERATOR_VERSION` that dealt it — the provenance, which must be its segment's. */
  version: number;
  /** The day's `encodeGivens` codes, in `DAILY_TIERS` order. */
  codes: string[];
}

/** The archive, as read from `archive.json` (see the module comment). */
export interface Archive {
  /** The date of Daily #1: always `DAILY_EPOCH`. */
  epoch: DateKey;
  /** Which engine deals which dates, oldest first; the first starts on the epoch. */
  segments: Segment[];
  /** The last frozen date, or null while nothing is frozen. */
  frozenThrough: DateKey | null;
  /** One per frozen day, from the epoch through `frozenThrough`. */
  days: FrozenDay[];
}

/** How many days ahead of the maintainer's own date a freeze may reach, and does by default. */
export const MAX_FREEZE_AHEAD = 2;

/** The commands that maintain the archive, as the messages spell them out. */
export const FREEZE_COMMAND = 'npm run dailies:freeze';
export const SWITCH_COMMAND = 'npm run dailies:switch';

/** Where the archive lives, as the messages name it. */
const ARCHIVE_PATH = 'src/daily/archive.json';

/** What the file says about itself, for anyone who opens it. */
const FILE_COMMENT =
  'Daily puzzles dealt by engines since replaced, frozen so they never change. Every later day is ' +
  'dealt live, by the engine of the last segment (GENERATOR_VERSION). Each line in "days" is a ' +
  'date, the engine version that dealt it and its encodeGivens codes in "tiers" order. Do not ' +
  `edit by hand: ${FREEZE_COMMAND} and ${SWITCH_COMMAND} maintain it (README, "Changing the engine").`;

const DAY_LINE = /^(\S+) v([1-9]\d*) (\S+) (\S+) (\S+) (\S+)$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

/** The segment that deals a date on or after the epoch: the last to start on or before it. */
export function segmentFor(archive: Pick<Archive, 'segments'>, date: DateKey): Segment {
  let found = archive.segments[0];
  for (const segment of archive.segments) {
    if (daysBetween(segment.from, date) >= 0) found = segment;
  }
  return found;
}

/** The engine in charge now: the last segment. */
export function liveSegment(archive: Archive): Segment {
  return archive.segments[archive.segments.length - 1];
}

/** The first date that is not frozen: the day after `frozenThrough`, or the epoch. */
export function firstUnfrozenDate(archive: Archive): DateKey {
  return archive.frozenThrough === null ? archive.epoch : addDays(archive.frozenThrough, 1);
}

/** A date's frozen codes by tier, or null if the date is not frozen (or not a date). */
export function frozenCodes(archive: Archive, date: DateKey): Record<Difficulty, string> | null {
  if (!isDateKey(date)) return null;
  const day = archive.days[daysBetween(archive.epoch, date)];
  if (day === undefined) return null;
  return Object.fromEntries(DAILY_TIERS.map((tier, i) => [tier, day.codes[i]])) as Record<
    Difficulty,
    string
  >;
}

/** Read one line of `days`, expected to be for `date`. */
function parseDay(line: unknown, date: DateKey): FrozenDay {
  const match = typeof line === 'string' ? DAY_LINE.exec(line) : null;
  if (match === null || match[1] !== date) {
    throw new Error(
      `The line for ${date} in "days" must read "${date} v<version>" and four share codes`,
    );
  }
  const codes = match.slice(3);
  if (!codes.every(looksLikeShareCode)) {
    throw new Error(`The line for ${date} in "days" holds something that is not a share code`);
  }
  return { date, version: Number(match[2]), codes };
}

/**
 * The archive read back and checked against the rules that hold at every
 * step of its upkeep — strictly, because a file hand-edited into another
 * shape must stop the freeze command, fail the tests and keep the app from
 * dealing anything from it, rather than be trusted. Throws an error saying
 * what is wrong. Whether it fits the engine in the code is the guard's
 * business (`checkArchive`).
 */
export function parseArchive(raw: unknown): Archive {
  if (!isObject(raw)) throw new Error('The daily archive must hold a JSON object');
  const { epoch, seed, tiers, segments, frozenThrough, days } = raw;
  if (epoch !== DAILY_EPOCH) {
    throw new Error(`"epoch" must be ${DAILY_EPOCH}, the date of Daily #1`);
  }
  if (seed !== DAILY_SEED_PATTERN) throw new Error(`"seed" must be "${DAILY_SEED_PATTERN}"`);
  if (!Array.isArray(tiers) || tiers.join() !== DAILY_TIERS.join()) {
    throw new Error(`"tiers" must be ${JSON.stringify(DAILY_TIERS)}`);
  }

  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('"segments" must name at least one engine');
  }
  const checkedSegments = segments.map((segment: unknown, i): Segment => {
    if (!isObject(segment) || !isVersion(segment.version) || !isDateKey(segment.from)) {
      throw new Error('Each of "segments" must be a { version, from } pair');
    }
    const previous = i === 0 ? null : (segments[i - 1] as Segment);
    const isInOrder =
      previous === null
        ? segment.from === epoch
        : daysBetween(previous.from, segment.from) > 0 && segment.version > previous.version;
    if (!isInOrder) {
      throw new Error(
        '"segments" must start on the epoch, each later one on a later date with a newer version',
      );
    }
    return { version: segment.version, from: segment.from };
  });

  if (frozenThrough !== null && !isDateKey(frozenThrough)) {
    throw new Error('"frozenThrough" must be a YYYY-MM-DD date, or null');
  }
  if (!Array.isArray(days)) throw new Error('"days" must be a list');
  const checkedDays = days.map((line: unknown, i) => parseDay(line, addDays(epoch, i)));
  const lastDay = checkedDays.at(-1)?.date ?? null;
  if (frozenThrough !== lastDay) {
    throw new Error(
      lastDay === null
        ? '"frozenThrough" must be null while "days" is empty'
        : `"frozenThrough" must be ${lastDay}, the date of the last line in "days"`,
    );
  }
  for (const day of checkedDays) {
    const segment = segmentFor({ segments: checkedSegments }, day.date);
    if (day.version !== segment.version) {
      throw new Error(
        `${day.date} was frozen from version ${day.version}, but version ${segment.version} deals that date`,
      );
    }
  }
  return { epoch, segments: checkedSegments, frozenThrough, days: checkedDays };
}

/** The steps that hand the dailies over from engine `current` to engine `next`, freezing from `from`. */
function handOver(current: number, from: DateKey, next: number): string {
  return [
    `With the engine as it was (GENERATOR_VERSION ${current}, before your change):`,
    `  1. ${FREEZE_COMMAND}`,
    `     stores every day from ${from} through the day after tomorrow, as version ${current} deals them;`,
    `  2. then, with your change back in place, ${SWITCH_COMMAND}`,
    `     hands every later day to version ${next}.`,
    `Commit ${ARCHIVE_PATH} with the engine change (README, "Changing the engine").`,
  ].join('\n');
}

/**
 * Hold the archive to the engine in the code (see the module comment): the
 * problems found, each a message that says how to put it right, or none.
 * This is what the guard test fails with. `isReleased` — whether the archive
 * is on main yet, when that is known — only changes what a GENERATOR_VERSION
 * bump is told to do: before dailies are released nothing needs freezing.
 */
export function checkArchive(
  archive: Archive,
  generatorVersion: number,
  isReleased?: boolean,
): string[] {
  const problems: string[] = [];
  const live = liveSegment(archive);
  const unfrozen = firstUnfrozenDate(archive);

  if (generatorVersion > live.version) {
    const bumped =
      `GENERATOR_VERSION is ${generatorVersion}, but the daily archive still has version ` +
      `${live.version} dealing every day from ${live.from}.\n\n`;
    // Before dailies are first released there is nothing to freeze, which
    // only the file on main can tell (see `checkAgainstRelease`).
    const canRepoint = archive.frozenThrough === null && archive.segments.length === 1;
    if (canRepoint && isReleased === false) {
      problems.push(
        `${bumped}Dailies have not been released yet (${ARCHIVE_PATH} is not on main), so no ` +
          `player has been dealt one and nothing needs freezing: ${SWITCH_COMMAND} re-points ` +
          `the segment to version ${generatorVersion}. Commit ${ARCHIVE_PATH} with the change.`,
      );
    } else {
      const unreleased =
        canRepoint && isReleased === undefined
          ? `\n\nUnless dailies have never been released: while ${ARCHIVE_PATH} is not on ` +
            `main, no player has been dealt a daily, and ${SWITCH_COMMAND} on its own re-points ` +
            `the segment to version ${generatorVersion}, with nothing to freeze.`
          : '';
      problems.push(
        `${bumped}A new engine deals different puzzles from the same seeds, so the days the old ` +
          'one has dealt must be frozen before it is replaced; otherwise every past daily ' +
          `changes under the players who played it. ` +
          `${handOver(live.version, unfrozen, generatorVersion)}${unreleased}`,
      );
    }
  } else if (generatorVersion < live.version) {
    problems.push(
      `GENERATOR_VERSION is ${generatorVersion}, but the daily archive has version ${live.version} ` +
        `dealing every day from ${live.from}: this engine is older than the archive. Bring it up ` +
        'to date (rebase onto main); an engine is never switched back.',
    );
  }

  if (daysBetween(unfrozen, live.from) < 0) {
    problems.push(
      `Days through ${archive.frozenThrough} are frozen, but version ${live.version} still deals ` +
        `every day from ${live.from}. Days are frozen only to hand them over to a new engine, and ` +
        'these put upcoming puzzles in the bundle for nothing. If you are changing the engine, ' +
        `bump GENERATOR_VERSION and run ${SWITCH_COMMAND}; if not, take the freeze back out of ` +
        `${ARCHIVE_PATH}.`,
    );
  } else if (daysBetween(unfrozen, live.from) > 0) {
    const previous = archive.segments[archive.segments.length - 2];
    problems.push(
      `Version ${live.version} takes over the dailies on ${live.from}, but the archive is frozen ` +
        `${archive.frozenThrough === null ? 'on no day at all' : `only through ${archive.frozenThrough}`}: ` +
        `the days from ${unfrozen} to ${addDays(live.from, -1)} were dealt by version ` +
        `${previous.version} and are stored nowhere, so they would be dealt again, differently. ` +
        `Take version ${live.version}'s segment back out of ${ARCHIVE_PATH}. ` +
        handOver(previous.version, unfrozen, live.version),
    );
  }
  return problems;
}

/** The days a freeze is to store: `from` through `through`, `count` of them (none if already frozen). */
export interface FreezePlan {
  from: DateKey;
  through: DateKey;
  count: number;
}

/**
 * What `npm run dailies:freeze` should store, given the date it was asked to
 * freeze through (by default `MAX_FREEZE_AHEAD` days after the maintainer's
 * own date, so players in zones ahead of theirs and tabs left open overnight
 * still match) and the moment it runs. Throws, with the reason, if the
 * engine in the code is not the archive's live one — it has already been
 * changed, and a freeze must store what the old engine dealt — or if the
 * date is not one or is further ahead than that.
 */
export function planFreeze(
  archive: Archive,
  generatorVersion: number,
  through: string | undefined,
  now: number,
): FreezePlan {
  const live = liveSegment(archive);
  const from = firstUnfrozenDate(archive);
  if (generatorVersion !== live.version) {
    throw new Error(
      `GENERATOR_VERSION is ${generatorVersion}, but the archive's live engine is version ` +
        `${live.version}. A freeze stores what the engine being replaced dealt, so it has to run ` +
        `before the change: put the engine back to version ${live.version}, freeze, then put your ` +
        `change back and run ${SWITCH_COMMAND}.`,
    );
  }
  const latest = addDays(dateKeyOf(now), MAX_FREEZE_AHEAD);
  const target = through ?? latest;
  if (!isDateKey(target)) {
    throw new Error(`--through must be a real date written YYYY-MM-DD, not "${target}"`);
  }
  if (daysBetween(target, latest) < 0) {
    throw new Error(
      `Refusing to freeze through ${target}: that stores puzzles for days nobody can have played ` +
        `yet, in the repository and the bundle. ${latest} (${MAX_FREEZE_AHEAD} days ahead) is ` +
        'as far as a freeze goes.',
    );
  }
  return { from, through: target, count: Math.max(0, daysBetween(from, target) + 1) };
}

/**
 * The archive with `days` frozen onto the end, as a new object (the one
 * passed in is never changed). Append-only by construction: the new days must
 * start on the first unfrozen date and run on a day at a time, so no frozen
 * day can be rewritten, reordered or skipped; and they must have been dealt
 * by the live engine, the one being replaced. Throws, changing nothing, at
 * the first thing out of place.
 */
export function freezeDays(
  archive: Archive,
  days: readonly NewDay[],
  generatorVersion: number,
): Archive {
  const live = liveSegment(archive);
  if (generatorVersion !== live.version) {
    throw new Error(
      `Refusing to freeze days dealt by version ${generatorVersion}: the live engine is version ${live.version}`,
    );
  }
  let expected = firstUnfrozenDate(archive);
  const frozen: FrozenDay[] = days.map(({ date, codes }) => {
    if (date !== expected) {
      throw new Error(
        `Refusing to freeze ${date}: the next day to freeze is ${expected}, and frozen days are never rewritten or skipped`,
      );
    }
    if (codes.length !== DAILY_TIERS.length || !codes.every(looksLikeShareCode)) {
      throw new Error(`${date} must hold ${DAILY_TIERS.length} share codes`);
    }
    expected = addDays(date, 1);
    return { date, version: generatorVersion, codes: [...codes] };
  });
  if (frozen.length === 0) return archive;
  return {
    ...archive,
    frozenThrough: frozen[frozen.length - 1].date,
    days: [...archive.days, ...frozen],
  };
}

/**
 * The archive with a new engine's segment added, starting the day after
 * `frozenThrough` — what `npm run dailies:switch` writes once
 * `GENERATOR_VERSION` has been bumped. Refuses unless the version is newer
 * than the live one, at least one of the live engine's days is frozen (so
 * its segment keeps a day, and a bump made without freezing is caught here
 * too), and the first day handed over has not begun anywhere yet at `now` —
 * a day already begun has been dealt by the old engine, and some player may
 * be part-way through it.
 *
 * Except when the live engine has dealt nothing yet, and the new engine
 * simply takes its place, from the same day: one switched in so recently
 * that its first day has still not begun anywhere, or any engine at all
 * before dailies are first released (`isReleased` false: the archive is not
 * on main yet, so no player has been dealt a daily, whatever the date).
 */
export function switchEngine(
  archive: Archive,
  generatorVersion: number,
  now: number,
  isReleased = true,
): Archive {
  const live = liveSegment(archive);
  if (generatorVersion <= live.version) {
    throw new Error(
      `GENERATOR_VERSION is ${generatorVersion}, and the live engine is already version ` +
        `${live.version}: bump GENERATOR_VERSION with the engine change, then switch.`,
    );
  }
  const begun = latestDateAnywhere(now);
  const frozenThrough = archive.frozenThrough;
  if (frozenThrough === null || daysBetween(live.from, frozenThrough) < 0) {
    const hasDealtNothing = !isReleased || daysBetween(begun, live.from) > 0;
    if (firstUnfrozenDate(archive) === live.from && hasDealtNothing) {
      return {
        ...archive,
        segments: [
          ...archive.segments.slice(0, -1),
          { version: generatorVersion, from: live.from },
        ],
      };
    }
    throw new Error(
      `None of the days version ${live.version} has dealt are frozen yet, so switching would ` +
        `deal them all again, differently. ${handOver(live.version, firstUnfrozenDate(archive), generatorVersion)}`,
    );
  }
  if (daysBetween(frozenThrough, begun) > 0) {
    throw new Error(
      `The archive is frozen only through ${frozenThrough}, but ${begun} has already begun ` +
        `somewhere, so version ${live.version} has dealt it and the new engine would deal it ` +
        `again, differently. Freeze further first: with the engine as it was, ${FREEZE_COMMAND}.`,
    );
  }
  return {
    ...archive,
    segments: [...archive.segments, { version: generatorVersion, from: addDays(frozenThrough, 1) }],
  };
}

/**
 * Whether `after` keeps everything `before` holds: every frozen day as it
 * was, and every segment starting where it did, with only days and segments
 * added on the end — and the last segment's version moved on, which is how
 * an engine that never dealt a day is replaced (see `switchEngine`).
 */
export function isExtensionOf(before: Archive, after: Archive): boolean {
  const lastSegment = before.segments.length - 1;
  const keepsSegments =
    before.segments.length <= after.segments.length &&
    before.segments.every(({ version, from }, i) => {
      const kept = after.segments[i];
      const isRepointed = i === lastSegment && kept.version > version;
      return kept.from === from && (kept.version === version || isRepointed);
    });
  const keepsDays =
    before.days.length <= after.days.length &&
    before.days.every((day, i) => JSON.stringify(day) === JSON.stringify(after.days[i]));
  return before.epoch === after.epoch && keepsSegments && keepsDays;
}

/** Whether a date has begun nowhere on Earth yet at `now`, so no player can have been dealt its daily. */
function isAhead(date: DateKey, now: number): boolean {
  return daysBetween(latestDateAnywhere(now), date) > 0;
}

/**
 * Hold a change to the archive to the one already released — the file on
 * main, or null while there is none — at `now` (see the module comment): the
 * problems found, each a message that says how to put it right, or none.
 * Only what no player can have been dealt yet may change: the released
 * archive's days and segments stay as they were; its live segment may be
 * re-pointed to a new engine only while its first day is still ahead
 * everywhere; and a segment added may only start on a day still ahead
 * everywhere, so a switch that waited too long to merge — the old engine
 * dealing on meanwhile — is caught. Once merged, the released archive is
 * this one, and nothing here can fail later just because time has passed.
 */
export function checkAgainstRelease(
  released: Archive | null,
  archive: Archive,
  now: number,
): string[] {
  if (released === null) return [];
  if (!isExtensionOf(released, archive)) {
    return [
      'The daily archive no longer holds everything the released one (on main) does: frozen ' +
        'days and engine segments are only ever added to. Rebase onto main, and if this branch ' +
        'changes the engine, freeze and switch again on top of what main holds (README, ' +
        '"Changing the engine").',
    ];
  }
  const problems: string[] = [];
  const lastReleased = released.segments.length - 1;
  const was = released.segments[lastReleased];
  const kept = archive.segments[lastReleased];
  if (kept.version !== was.version && !isAhead(was.from, now)) {
    problems.push(
      `Version ${was.version} has dealt the dailies from ${was.from}, which has begun, so ` +
        `re-pointing its segment to version ${kept.version} would deal every one of them again, ` +
        `differently. Put it back to version ${was.version}. ` +
        handOver(was.version, firstUnfrozenDate(released), kept.version),
    );
  }
  for (const segment of archive.segments.slice(released.segments.length)) {
    if (isAhead(segment.from, now)) continue;
    problems.push(
      `Version ${segment.version} takes over the dailies on ${segment.from}, but that day has ` +
        `already begun somewhere (it is ${latestDateAnywhere(now)} in UTC+14), so the engine ` +
        'before it has dealt it, and would have it dealt again, differently: the switch has ' +
        'gone stale while it waited to be merged. Rebase onto main, then freeze and switch ' +
        `again (README, "Changing the engine"). ${handOver(was.version, firstUnfrozenDate(released), segment.version)}`,
    );
  }
  return problems;
}

/** Prettier's `printWidth` for this repo (see `.prettierrc.json`); the tests hold the two together. */
const PRINT_WIDTH = 100;

/**
 * The archive as the commands write it: exactly the text Prettier would
 * leave alone, ending in a newline, so the formatting check passes and a
 * freeze changes nothing but the lines it adds (and the comma JSON then
 * needs on the line before them).
 */
export function serialiseArchive(archive: Archive): string {
  const quote = (value: string) => JSON.stringify(value);
  const segment = ({ version, from }: Segment) =>
    `{ ${quote('version')}: ${version}, ${quote('from')}: ${quote(from)} }`;
  // Prettier keeps a lone object on its key's line, and puts each of two or
  // more on a line of its own.
  const segments =
    archive.segments.length === 1
      ? `[${segment(archive.segments[0])}]`
      : `[\n${archive.segments.map((s) => `    ${segment(s)}`).join(',\n')}\n  ]`;
  const lines = archive.days.map(
    ({ date, version, codes }) => `${date} v${version} ${codes.join(' ')}`,
  );
  // And it keeps a list on one line if it fits, which only an empty one does:
  // a single day's line is longer than the print width on its own.
  const inlineDays = `  "days": [${lines.map(quote).join(', ')}]`;
  const days =
    inlineDays.length <= PRINT_WIDTH
      ? [inlineDays]
      : ['  "days": [', lines.map((line) => `    ${quote(line)}`).join(',\n'), '  ]'];
  return [
    '{',
    `  "$comment": ${quote(FILE_COMMENT)},`,
    `  "epoch": ${quote(archive.epoch)},`,
    `  "seed": ${quote(DAILY_SEED_PATTERN)},`,
    `  "tiers": [${DAILY_TIERS.map(quote).join(', ')}],`,
    `  "segments": ${segments},`,
    `  "frozenThrough": ${archive.frozenThrough === null ? 'null' : quote(archive.frozenThrough)},`,
    ...days,
    '}',
    '',
  ].join('\n');
}
