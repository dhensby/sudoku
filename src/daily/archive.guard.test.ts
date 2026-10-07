// @vitest-environment node
import { readFileSync } from 'node:fs';
import { GENERATOR_VERSION, checkGivens, decodeGivens } from '../core';
import { checkAgainstRelease, checkArchive, parseArchive, serialiseArchive } from './archive';
import { DAILY_TIERS } from './generate';
import { readRelease } from './release';

/*
 * The guard over the committed archive, `archive.json` — what keeps the
 * scheme honest. Every daily from the day after the archive's last frozen
 * day is dealt live by the engine in the code; if that engine changes
 * without the days it dealt being frozen first, every past daily changes
 * under the players who played it. This is where that is caught: in CI,
 * with a message that says exactly what to run (see `checkArchive`, and
 * README, "Changing the engine").
 *
 * And, on a pull request, against the archive already released — the copy
 * on main — at this moment (see `checkAgainstRelease`): a switch merged after
 * the days it hands over have begun, or a live segment re-pointed by hand
 * after its engine has dealt, passes every rule above. CI names the ref to
 * compare with in DAILY_ARCHIVE_BASE, having fetched it; locally it is
 * origin/main if this clone has it. CI on main itself sets none: once
 * merged, the released archive is this one.
 */

const TEXT = readFileSync(new URL('./archive.json', import.meta.url), 'utf8');
/** Read at once: a file broken in shape fails the whole suite here, saying what is wrong with it. */
const ARCHIVE = parseArchive(JSON.parse(TEXT));

const BASE = process.env.DAILY_ARCHIVE_BASE ?? (process.env.CI ? '' : 'origin/main');
const RELEASE = BASE === '' ? null : readRelease(BASE);
/** Asked for by name, as CI does on a pull request: a ref that cannot be read is a failure. */
const IS_REQUIRED = process.env.DAILY_ARCHIVE_BASE !== undefined && BASE !== '';

describe('the daily archive', () => {
  it('fits the engine in the code: frozen up to the day its segment begins, and no further', () => {
    const isReleased =
      RELEASE === null || RELEASE.kind === 'unknown' ? undefined : RELEASE.kind === 'released';
    const problems = checkArchive(ARCHIVE, GENERATOR_VERSION, isReleased);
    // Thrown rather than compared, so the message reads as written, with its
    // steps on lines of their own.
    if (problems.length > 0) throw new Error(`\n\n${problems.join('\n\n')}\n`);
  });

  it('is exactly as the commands write it, so the next freeze changes no frozen line', () => {
    expect(serialiseArchive(ARCHIVE)).toBe(TEXT);
  });

  it('holds only puzzles with exactly one solution', () => {
    const problems: string[] = [];
    for (const day of ARCHIVE.days) {
      day.codes.forEach((code, i) => {
        const givens = decodeGivens(code);
        const checked = givens === null ? null : checkGivens(givens);
        if (checked === null || !checked.ok) {
          problems.push(`${day.date} ${DAILY_TIERS[i]}: ${checked?.problem ?? 'does not decode'}`);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('never holds the same puzzle twice', () => {
    const all = ARCHIVE.days.flatMap((day) => day.codes);
    expect(new Set(all).size).toBe(all.length);
  });

  it.skipIf(RELEASE === null || (RELEASE.kind === 'unknown' && !IS_REQUIRED))(
    `changes nothing ${BASE || 'main'} has already dealt to a player`,
    () => {
      if (RELEASE!.kind === 'unknown') {
        throw new Error(`Cannot hold the archive to ${BASE}: ${RELEASE!.reason}`);
      }
      const released = RELEASE!.kind === 'released' ? RELEASE!.archive : null;
      const problems = checkAgainstRelease(released, ARCHIVE, Date.now());
      if (problems.length > 0) throw new Error(`\n\n${problems.join('\n\n')}\n`);
    },
  );
});
