import { cpSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { build } from 'vite';
import { versionIn, versionTag } from '../src/update/stamp';

/**
 * A stand-in for GitHub Pages, for the tests that need what `vite preview`
 * does differently: the app under /sudoku/, real 404s where preview falls
 * back to the page, and ten minutes of HTTP caching on everything — which a
 * page left open has to get past to learn of a new version, and a reload to
 * load it. A test can deploy another build to it.
 */

export const BASE = '/sudoku/';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

export interface PagesServer {
  /** The app's address: the origin and BASE. */
  url: string;
  /** Serve this build from now on, as a deploy would. */
  deploy(dir: string): void;
  stop(): Promise<void>;
}

/** Serve the build in `dir` as GitHub Pages would, on a port of its own. */
export async function startPages(dir: string): Promise<PagesServer> {
  let root = dir;
  const sockets = new Set<Socket>();
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://pages').pathname;
    if (path === BASE.slice(0, -1)) {
      response.writeHead(301, { Location: BASE }).end();
      return;
    }
    if (!path.startsWith(BASE)) {
      response.writeHead(404).end();
      return;
    }
    const relative = normalize(path.slice(BASE.length) || 'index.html');
    const file = join(root, relative.endsWith('/') ? `${relative}index.html` : relative);
    if (relative.startsWith('..') || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
      return;
    }
    response
      .writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'max-age=600',
      })
      .end(readFileSync(file));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${BASE}`,
    deploy(next) {
      root = next;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }),
  };
}

/** Build the app for the /sudoku/ base into `outDir`, as the deploy does. */
export async function buildForPages(outDir: string): Promise<void> {
  await build({ base: BASE, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
}

/**
 * The next deploy of the build in `dir`, written to `outDir`: the same files,
 * its page stamped as version `name`, so a test can see which one it loaded.
 */
export function newVersionOf(dir: string, outDir: string, name: string): void {
  cpSync(dir, outDir, { recursive: true });
  const page = join(outDir, 'index.html');
  const html = readFileSync(page, 'utf8');
  const version = versionIn(html);
  if (version === null) throw new Error('no version stamp in index.html to change');
  writeFileSync(page, html.replace(versionTag(version), versionTag(name)));
}
