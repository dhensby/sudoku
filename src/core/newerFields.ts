/*
 * Fields a newer version of the game added to something it saved, kept by
 * this one when it rewrites that thing.
 *
 * There is no service worker, so after a deploy a tab left open on the
 * previous version carries on running — and it rewrites the history, the
 * saved game and the preferences as it goes. If it rebuilt each of them from
 * the fields it knows, it would quietly wipe whatever the new version had
 * added (a count of mistakes on a record, a new kind of help taken, a new
 * setting) the moment it saved. So a field this version does not know is
 * carried through untouched, as long as it looks like something a later
 * version of this game would have written:
 *
 *   - its key is a short camelCase word (/^[a-z][A-Za-z]{0,23}$/), as every
 *     field this game has ever written is, and is not a name `Object`
 *     already uses (`constructor`, `toString`…), which a later read could
 *     trip over;
 *   - its value is at most 200 characters of JSON — room for a small object
 *     of counts, nowhere near room for a move log (those live under keys of
 *     their own);
 *   - at most 8 of them per object.
 *
 * The caps keep a hand-edited or hostile file from growing every record by
 * kilobytes, which the history would then carry a thousand times over and
 * rewrite every few hundred milliseconds of play. Anything beyond them is
 * dropped, as every unknown field was before. Fields this version knows are
 * never passed through here: each caller validates those exactly as before,
 * and lists them with `fieldsOf`, so that a field added to a type but left
 * off its list fails to compile instead of slipping through unvalidated.
 *
 * A field carried this way is a snapshot. This version never updates it,
 * however much it then changes the status, time, help or board beside it, so
 * a later version must not trust a field whose meaning depends on those
 * without a way to tell that it has gone stale. For example, a count of
 * mistakes on a record should be stamped with the `elapsedMs` it was worked
 * out at, and read as unknown when the stamp no longer matches. Otherwise an
 * old tab that plays on and solves the game would leave a count from before
 * the solve that reads as final, and a record would claim fewer mistakes than
 * were made.
 */

/** The most unknown fields kept on any one object. */
export const MAX_NEWER_FIELDS = 8;

/** The longest unknown field kept, as JSON. */
export const MAX_NEWER_FIELD_JSON = 200;

/** What a newer field's key must look like. */
const NEWER_FIELD_KEY = /^[a-z][A-Za-z]{0,23}$/;

/**
 * The names of every field of `T`, given as an object with each set to true.
 * Written that way so that the compiler checks the list against the type: a
 * field missing from it, or one the type does not have, is an error.
 */
export function fieldsOf<T>(fields: Record<keyof T, true>): readonly (keyof T & string)[] {
  return Object.keys(fields) as (keyof T & string)[];
}

/**
 * The small fields of `source` that are not in `known`, as a fresh object of
 * fresh values (copied through JSON, so the result shares nothing with
 * `source`). Empty when `source` is not a plain object. See the module
 * comment for what counts as small.
 */
export function newerFields(source: unknown, known: readonly string[]): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return kept;
  let count = 0;
  for (const [key, value] of Object.entries(source)) {
    if (count === MAX_NEWER_FIELDS) break;
    if (known.includes(key) || !NEWER_FIELD_KEY.test(key)) continue;
    if (Object.hasOwn(Object.prototype, key)) continue;
    const json = toJson(value);
    if (json === undefined || json.length > MAX_NEWER_FIELD_JSON) continue;
    // Plain assignment is safe: the key pattern rules out `__proto__`.
    kept[key] = JSON.parse(json) as unknown;
    count++;
  }
  return kept;
}

/** A value as JSON; undefined for one JSON cannot hold (a function, a cycle, a BigInt). */
function toJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
