// @vitest-environment node
import { serialiseArchive, type Archive } from './archive';
import { readRelease, runGit, type GitRunner } from './release';

const RELEASED: Archive = {
  epoch: '2026-10-01',
  segments: [{ version: 4, from: '2026-10-01' }],
  frozenThrough: null,
  days: [],
};

/** A git that knows the refs and files given, and fails at anything else, as git does. */
function fakeGit(refs: readonly string[], files: Readonly<Record<string, string>>): GitRunner {
  return (args) => {
    if (args[0] === 'rev-parse') {
      const ref = args.at(-1)!.replace('^{commit}', '');
      return refs.includes(ref) ? 'c0ffee\n' : null;
    }
    if (args[0] === 'show') return files[args[1]] ?? null;
    return null;
  };
}

describe('readRelease', () => {
  it('reads the archive a ref holds as released', () => {
    const git = fakeGit(['origin/main'], {
      'origin/main:src/daily/archive.json': serialiseArchive(RELEASED),
    });
    expect(readRelease('origin/main', git)).toEqual({ kind: 'released', archive: RELEASED });
  });

  it('takes a ref without the archive as dailies not yet released', () => {
    expect(readRelease('origin/main', fakeGit(['origin/main'], {}))).toEqual({
      kind: 'unreleased',
    });
  });

  it('cannot tell from a ref this clone does not have', () => {
    expect(readRelease('origin/main', fakeGit([], {}))).toEqual({
      kind: 'unknown',
      reason: 'origin/main is not a commit in this clone; fetch it first',
    });
  });

  it('refuses a released archive that is not well formed, saying where it is', () => {
    const git = fakeGit(['origin/main'], { 'origin/main:src/daily/archive.json': '{"epoch":1}' });
    expect(() => readRelease('origin/main', git)).toThrow(
      'src/daily/archive.json on origin/main: "epoch" must be 2026-10-01',
    );
    const broken = fakeGit(['origin/main'], { 'origin/main:src/daily/archive.json': '{' });
    expect(() => readRelease('origin/main', broken)).toThrow(
      'src/daily/archive.json on origin/main',
    );
  });
});

describe('runGit', () => {
  it('hands back what git printed, or null when it fails', () => {
    expect(runGit(['--version'])).toMatch(/^git version /);
    expect(runGit(['no-such-command'])).toBeNull();
  });
});
