import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { versionTag } from '../src/update/stamp.ts';

/** Every file under `dir`, as forward-slashed paths relative to it. */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => name.split(sep).join('/'));
}

/**
 * Stamps the built page with the build's version, for a page left open to
 * tell when a newer one has been deployed (src/update/check.ts).
 *
 * The version is a hash of the finished bundle's files, names and contents,
 * and of the public files — so it changes exactly when something a player
 * would load does. A merge that changes only the docs or the tests builds
 * the same files (builds are deterministic), and offers no update. It cannot
 * be compiled into the script, whose own contents it hashes, so it goes in
 * the page instead.
 */
export function version(): Plugin {
  let config: ResolvedConfig;

  return {
    name: 'sudoku:version',
    apply: 'build',
    // After the HTML and CSS plugins have put index.html and the stylesheet
    // into the bundle.
    enforce: 'post',

    configResolved(resolved) {
      config = resolved;
    },

    generateBundle(_options, bundle) {
      const page = bundle['index.html'];
      if (page?.type !== 'asset') return this.error('there is no index.html to stamp');
      const html =
        typeof page.source === 'string' ? page.source : new TextDecoder().decode(page.source);
      if (!html.includes('</head>')) return this.error('index.html has no <head> to stamp');

      const contents = new Map<string, string | Uint8Array>();
      for (const [name, output] of Object.entries(bundle)) {
        contents.set(name, output.type === 'chunk' ? output.code : output.source);
      }
      // public/ is copied as it is, and never enters the bundle.
      if (config.build.copyPublicDir && config.publicDir) {
        for (const name of filesIn(config.publicDir)) {
          contents.set(name, readFileSync(join(config.publicDir, name)));
        }
      }

      const hash = createHash('sha256');
      for (const name of [...contents.keys()].sort()) {
        hash.update(name).update('\0').update(contents.get(name)!).update('\0');
      }
      const stamp = versionTag(hash.digest('hex').slice(0, 16));
      page.source = html.replace('</head>', `  ${stamp}\n  </head>`);
    },
  };
}
