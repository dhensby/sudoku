#!/usr/bin/env node
/*
 * Upkeep of the daily archive, src/daily/archive.json, for an engine change
 * (README, "Changing the engine"):
 *
 *   npm run dailies:freeze [-- --through YYYY-MM-DD]
 *     Before the change, on the engine being replaced: store every day from
 *     the first unfrozen one through the given date (by default the day
 *     after tomorrow), as that engine deals them.
 *
 *   npm run dailies:switch
 *     After bumping GENERATOR_VERSION: hand every day after the last frozen
 *     one to the new engine — or, before dailies are first released, simply
 *     re-point the archive's one segment to it.
 *
 * Whether dailies have been released is whether the archive is on main:
 * origin/main, or the ref in DAILY_ARCHIVE_BASE (src/daily/release.ts). A
 * clone that has not fetched it is treated as released, the stricter case.
 *
 * Every rule — what may be frozen and when, what a switch needs first — is
 * in src/daily/archive.ts, as pure functions with tests of their own; this
 * script only reads the file, runs them and writes the result.
 *
 * The engine is TypeScript with extensionless imports, which Node's own type
 * stripping can't resolve, so this loads it through Vite's dev server in
 * middleware mode — Vite resolves and transforms `src/` exactly as it does for
 * the app — rather than adding a TypeScript runner to the dependencies.
 *
 * A freeze deals each day's four puzzles — some ten times slower here than in
 * the app, as Vite's server-side loading routes every call between modules
 * through an accessor: a few tenths of a second a day — and writes the file
 * after every day, through a temporary file and a rename, so it is never
 * left half-written: a run stopped part-way leaves the days it finished, and
 * the same command carries on from there.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivePath = path.join(root, 'src', 'daily', 'archive.json');
const USAGE =
  'Usage: npm run dailies:freeze [-- --through YYYY-MM-DD]\n       npm run dailies:switch';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'freeze' && command !== 'switch') fail(USAGE);
  let through;
  for (let i = 0; i < rest.length; i++) {
    if (command === 'freeze' && rest[i] === '--through' && rest[i + 1] !== undefined) {
      through = rest[++i];
    } else {
      fail(`Unexpected argument "${rest[i]}".\n\n${USAGE}`);
    }
  }
  return { command, through };
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${Math.round(seconds % 60)}s` : `${seconds.toFixed(1)}s`;
}

/** The archive file as it is on disk, read and checked. */
async function readArchive(archive) {
  const text = await readFile(archivePath, 'utf8');
  try {
    return archive.parseArchive(JSON.parse(text));
  } catch (error) {
    throw new Error(`src/daily/archive.json: ${error.message}`, { cause: error });
  }
}

/**
 * Write the archive, through a temporary file and a rename — and only as an
 * extension of what was there (belt and braces: the pure functions already
 * refuse anything else).
 */
async function writeArchive(archive, before, after) {
  if (!archive.isExtensionOf(before, after)) {
    throw new Error('Refusing to write src/daily/archive.json: that would change what is in it');
  }
  await writeFile(`${archivePath}.tmp`, archive.serialiseArchive(after));
  await rename(`${archivePath}.tmp`, archivePath);
}

/** Whether dailies have been released (see the comment at the top), saying so when it cannot tell. */
function isReleased(release) {
  if (release.kind !== 'unknown') return release.kind === 'released';
  console.warn(`Taking dailies as released, as ${release.reason}.`);
  return true;
}

async function freeze(modules, through) {
  const { core, archive, generate, release } = modules;
  if (!isReleased(release)) {
    console.log(
      'Dailies have not been released yet (src/daily/archive.json is not on main), so no ' +
        'player has been dealt one and there is nothing to freeze. After an engine change, ' +
        `${archive.SWITCH_COMMAND} on its own re-points the archive to the new engine.`,
    );
    return;
  }
  let current = await readArchive(archive);
  const plan = archive.planFreeze(current, core.GENERATOR_VERSION, through, Date.now());
  if (plan.count === 0) {
    console.log(`Already frozen through ${current.frozenThrough}; nothing to do.`);
    return;
  }
  console.log(
    `Freezing ${plan.count} day${plan.count === 1 ? '' : 's'} of dailies, ${plan.from} to ` +
      `${plan.through}, as version ${core.GENERATOR_VERSION} deals them.`,
  );
  const began = performance.now();
  for (let done = 0; done < plan.count; done++) {
    const date = core.addDays(plan.from, done);
    const next = archive.freezeDays(current, [generate.generateDay(date)], core.GENERATOR_VERSION);
    await writeArchive(archive, current, next);
    current = next;
    const perDay = (performance.now() - began) / 1000 / (done + 1);
    console.log(
      `Daily #${core.dailyNumber(date)} ${date} frozen (${done + 1}/${plan.count}, ` +
        `${perDay.toFixed(2)}s a day, ${formatDuration(perDay * (plan.count - done - 1))} to go)`,
    );
  }
  console.log(
    `Done: frozen through ${current.frozenThrough}. Now make the engine change, bump ` +
      `GENERATOR_VERSION and run ${archive.SWITCH_COMMAND}.`,
  );
}

async function switchEngine(modules) {
  const { core, archive, release } = modules;
  const current = await readArchive(archive);
  const next = archive.switchEngine(
    current,
    core.GENERATOR_VERSION,
    Date.now(),
    isReleased(release),
  );
  await writeArchive(archive, current, next);
  const live = archive.liveSegment(next);
  const before =
    next.frozenThrough === null ? 'no day before it has been dealt' : 'the days before are frozen';
  console.log(
    `Version ${live.version} now deals the dailies from ${live.from}; ${before}. Commit ` +
      'src/daily/archive.json with the engine change.',
  );
}

async function main() {
  const { command, through } = parseArgs(process.argv.slice(2));
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { readRelease } = await server.ssrLoadModule('/src/daily/release.ts');
    const modules = {
      core: await server.ssrLoadModule('/src/core/index.ts'),
      archive: await server.ssrLoadModule('/src/daily/archive.ts'),
      generate: await server.ssrLoadModule('/src/daily/generate.ts'),
      release: readRelease(process.env.DAILY_ARCHIVE_BASE || 'origin/main'),
    };
    if (command === 'freeze') await freeze(modules, through);
    else await switchEngine(modules);
  } finally {
    await server.close();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
