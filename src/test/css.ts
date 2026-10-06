import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Reading the stylesheets from their source, for the tests that hold them to
 * their promises (src/styles/*.test.ts): jsdom applies no CSS, so the
 * palette's tokens and a handful of rules are checked as text, and colours
 * are worked out here the way a browser composes them.
 */

// A path rather than `new URL(name, import.meta.url)`, which Vite rewrites
// as an asset import.
const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');

/** A stylesheet from src/styles, its comments stripped. */
export const readStyles = (name: string): string =>
  readFileSync(join(STYLES, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

export type Tokens = Record<string, string>;

/** The custom properties declared in the first block that opens with `opener`. */
export function tokensOf(css: string, opener: string): Tokens {
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`no block opening with ${opener}`);
  const body = css.slice(start + opener.length, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
}

const INDEX = readStyles('index.css');

/** The palettes as index.css declares them. */
export const LIGHT = tokensOf(INDEX, ':root {');
export const DARK = tokensOf(INDEX, ":root:not([data-theme='light']) {");
export const DARK_FORCED = tokensOf(INDEX, ":root[data-theme='dark'] {");
export const FORCED = tokensOf(INDEX, ':root:root {');

/** Every declaration block whose selector list includes `selector`, joined. */
export function rule(css: string, selector: string): string {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selectors]) =>
    selectors.split(',').some((s) => s.trim() === selector),
  );
  if (blocks.length === 0) throw new Error(`no rule for ${selector}`);
  return blocks.map(([, , body]) => body).join(';');
}

// ---- Colour arithmetic (sRGB, WCAG 2 relative luminance) ----

/** An opaque colour, each channel 0–255. */
export type Rgb = readonly [number, number, number];

export function parseHex(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) throw new Error(`not an opaque hex colour: ${value}`);
  const n = parseInt(hex[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/**
 * `color-mix(in srgb, a p, b)`, or `a` at opacity `p` laid over `b`: the same
 * sum, worked in gamma-encoded sRGB and rounded to whole channels, as
 * browsers do.
 */
export function mix(a: Rgb, p: number, b: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] * p + b[i] * (1 - p))) as unknown as Rgb;
}

export function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/*
 * Colour-blindness, simulated with the matrices of Machado, Oliveira and
 * Fernandes (2009) at full severity, applied in linear light.
 */
const CVD = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const;

export type Deficiency = keyof typeof CVD;
export const DEFICIENCIES = Object.keys(CVD) as Deficiency[];

/** How `colour` looks to a player with `deficiency`. */
export function simulate(colour: Rgb, deficiency: Deficiency): Rgb {
  const toLinear = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const linear = colour.map(toLinear);
  return CVD[deficiency].map((row) => {
    const c = row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2];
    return toGamma(Math.min(1, Math.max(0, c))) * 255;
  }) as unknown as Rgb;
}
