import { execFileSync } from 'node:child_process';
import { parseArchive, type Archive } from './archive';

/*
 * The daily archive as released: the copy on main, read through git — for
 * the guard test and `npm run dailies:switch`, never the app. Whether that
 * copy exists is what says whether dailies have been released at all (see
 * `checkAgainstRelease` and `switchEngine` in `archive.ts`).
 */

/** Where the archive lives, as git names it from the top of the repository. */
const ARCHIVE_PATH = 'src/daily/archive.json';

/** Run git with these arguments: what it printed, or null if it failed (or is not there). */
export type GitRunner = (args: readonly string[]) => string | null;

/** The real git, in the working directory, quietly. */
export const runGit: GitRunner = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};

/**
 * The archive as `ref` holds it:
 *   - `released`, with the archive, when the file is there;
 *   - `unreleased` when `ref` is there but the file is not — dailies have
 *     not been released, so no player has been dealt one;
 *   - `unknown` when `ref` itself is not there (a shallow clone that never
 *     fetched it), with the reason, as nothing can be told then.
 * Throws if the file is there but is not a well-formed archive.
 */
export type Release =
  | { kind: 'released'; archive: Archive }
  | { kind: 'unreleased' }
  | { kind: 'unknown'; reason: string };

/** Read the archive as `ref` (`origin/main`, say) holds it (see `Release`). */
export function readRelease(ref: string, git: GitRunner = runGit): Release {
  if (git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === null) {
    return { kind: 'unknown', reason: `${ref} is not a commit in this clone; fetch it first` };
  }
  const text = git(['show', `${ref}:${ARCHIVE_PATH}`]);
  if (text === null) return { kind: 'unreleased' };
  try {
    // Whatever Daily #1 main's code had: a change may move it (see `checkAgainstRelease`).
    return { kind: 'released', archive: parseArchive(JSON.parse(text), null) };
  } catch (error) {
    // JSON.parse and parseArchive throw nothing but Errors.
    throw new Error(`${ARCHIVE_PATH} on ${ref}: ${(error as Error).message}`, { cause: error });
  }
}
