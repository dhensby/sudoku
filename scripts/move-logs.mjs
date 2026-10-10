#!/usr/bin/env node
/*
 * Records the golden move logs, src/core/fixtures/moveLogs.json (README, "The
 * move log"):
 *
 *   npm run moves:golden
 *
 * Plays each golden game afresh with the engine in src/core and writes its
 * log, the game it ends in and a hash of every step. The file pins the rules
 * the reducer replays logs by, so this refuses to rewrite logs that no longer
 * replay as pinned while MOVES_VERSION is unchanged: a change to the rules
 * must bump it first, which turns away every log recorded under the old ones
 * rather than replaying them into games nobody played. Rewriting logs that
 * still replay as pinned (to add a game, say) is allowed.
 *
 * Loads the engine through Vite's dev server in middleware mode, as
 * scripts/dailies.mjs does, and formats the file with Prettier, so it passes
 * `prettier --check` as written.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src', 'core', 'fixtures', 'moveLogs.json');

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** The file on disk, or null if there is none yet. */
async function readGolden() {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`src/core/fixtures/moveLogs.json: ${error.message}`, { cause: error });
  }
}

async function main() {
  if (process.argv.length > 2) fail('Usage: npm run moves:golden');
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { MOVES_VERSION } = await server.ssrLoadModule('/src/core/index.ts');
    const golden = await server.ssrLoadModule('/src/test/goldenMoveLogs.ts');
    const current = await readGolden();
    if (current !== null && current.rules === MOVES_VERSION) {
      const problems = golden.goldenProblems(current);
      if (problems.length > 0) {
        fail(
          `${problems.join('\n\n')}\n\nNothing written: bump MOVES_VERSION first, then run this again.`,
        );
      }
    }
    const file = golden.playGoldenLogs();
    const options = await resolveConfig(filePath);
    const text = await format(JSON.stringify(file), { ...options, filepath: filePath });
    // Through a temporary file and a rename, so it is never left half-written.
    await writeFile(`${filePath}.tmp`, text);
    await rename(`${filePath}.tmp`, filePath);
    for (const game of file.games)
      console.log(`${String(game.log.length).padStart(6)}  ${game.name}`);
    console.log(`Wrote src/core/fixtures/moveLogs.json under rules version ${MOVES_VERSION}.`);
  } finally {
    await server.close();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
