// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { versionIn } from '../src/update/stamp';
import { version } from './version';

/*
 * The plugin's hooks, driven by hand with a bundle shaped like Vite's: the
 * app's chunk, its stylesheet and a font, and the page.
 */

let publicDir: string;

beforeEach(() => {
  publicDir = mkdtempSync(join(tmpdir(), 'version-public-'));
  writeFileSync(join(publicDir, 'favicon.svg'), '<svg/>');
  mkdirSync(join(publicDir, 'icons'));
  writeFileSync(join(publicDir, 'icons', 'icon.png'), 'png');
});

afterEach(() => {
  rmSync(publicDir, { recursive: true, force: true });
});

const chunk = (fileName: string, code: string) => ({ type: 'chunk' as const, fileName, code });
const asset = (fileName: string, source: string | Uint8Array) => ({
  type: 'asset' as const,
  fileName,
  source,
});
type Output = ReturnType<typeof chunk> | ReturnType<typeof asset>;

const PAGE = '<html><head><title>Sudoku</title></head></html>';

function bundle(overrides: Record<string, Output> = {}): Record<string, Output> {
  return {
    'assets/index-abc.js': chunk('assets/index-abc.js', 'app()'),
    'assets/index-def.css': asset('assets/index-def.css', 'body{}'),
    'assets/font-ghi.woff2': asset('assets/font-ghi.woff2', new Uint8Array([1, 2, 3])),
    'index.html': asset('index.html', PAGE),
    ...overrides,
  };
}

/** Run the plugin's hooks over `files`, as a build would, and return the page it leaves. */
function build(files: Record<string, Output>, copyPublicDir = true): string {
  const plugin = version();
  const context = {
    error: vi.fn((message: string) => {
      throw new Error(message);
    }),
  };
  const hooks = plugin as unknown as {
    configResolved(config: unknown): void;
    generateBundle(this: typeof context, options: unknown, files: unknown): void;
  };
  hooks.configResolved({ publicDir, build: { copyPublicDir } });
  hooks.generateBundle.call(context, {}, files);
  return (files['index.html'] as ReturnType<typeof asset>).source as string;
}

const versionOf = (files: Record<string, Output>, copyPublicDir = true) =>
  versionIn(build(files, copyPublicDir));

describe('the version plugin', () => {
  it('runs only in builds, and after the page and styles are in the bundle', () => {
    const plugin = version();
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('post');
  });

  it('stamps the page with the version, at the end of its head', () => {
    const page = build(bundle());
    expect(page).toMatch(
      /^<html><head><title>Sudoku<\/title> {2}<meta name="version" content="[0-9a-f]{16}">\n {2}<\/head><\/html>$/,
    );
  });

  it('stamps a page that came to it as bytes', () => {
    const page = asset('index.html', new TextEncoder().encode(PAGE));
    expect(versionIn(build(bundle({ 'index.html': page })))).toMatch(/^[0-9a-f]{16}$/);
  });

  describe('the version', () => {
    it('is the same for the same files', () => {
      const first = versionOf(bundle());
      expect(versionOf(bundle())).toBe(first);
    });

    it('changes with what is in any file the build ships', () => {
      const first = versionOf(bundle());
      expect(
        versionOf(bundle({ 'assets/index-abc.js': chunk('assets/index-abc.js', 'app(2)') })),
      ).not.toBe(first);
      expect(
        versionOf(
          bundle({ 'assets/font-ghi.woff2': asset('assets/font-ghi.woff2', new Uint8Array([4])) }),
        ),
      ).not.toBe(first);
      const page = asset('index.html', '<html lang="en-GB"><head></head></html>');
      expect(versionOf(bundle({ 'index.html': page }))).not.toBe(first);
    });

    it('changes with a public file, which is copied rather than bundled', () => {
      const first = versionOf(bundle());
      writeFileSync(join(publicDir, 'icons', 'icon.png'), 'png, redrawn');
      expect(versionOf(bundle())).not.toBe(first);
    });

    it('leaves public files out when the build does not copy them', () => {
      const first = versionOf(bundle(), false);
      writeFileSync(join(publicDir, 'favicon.svg'), '<svg viewBox="0 0 1 1"/>');
      expect(versionOf(bundle(), false)).toBe(first);
    });

    it('changes with a file’s name, though nothing in it does', () => {
      const first = versionOf(bundle());
      const renamed = bundle({ 'assets/index-xyz.css': asset('assets/index-xyz.css', 'body{}') });
      delete renamed['assets/index-def.css'];
      expect(versionOf(renamed)).not.toBe(first);
    });
  });

  it('refuses a build with no page to stamp', () => {
    const files = bundle();
    delete files['index.html'];
    expect(() => build(files)).toThrow(/no index\.html to stamp/);
    expect(() => build(bundle({ 'index.html': asset('index.html', '<html>') }))).toThrow(
      /no <head> to stamp/,
    );
  });
});
