import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The stylesheets' own promises, checked from their source: jsdom applies no
 * CSS, so the contrast of the palette and a handful of rules that fixed real
 * defects are held here instead. Layout (what fits, what scrolls) needs a
 * real browser and is the end-to-end suite's job.
 */

// A path rather than `new URL(name, import.meta.url)`, which Vite rewrites
// as an asset import.
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name: string) =>
  readFileSync(join(HERE, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const INDEX = read('index.css');
const BOARD = read('board.css');
const CONTROLS = read('controls.css');
const DIALOGS = read('dialogs.css');
const LAYOUT = read('layout.css');

// ---- Tokens ----

type Tokens = Record<string, string>;

/** The custom properties declared in the first block that opens with `opener`. */
function tokensOf(css: string, opener: string): Tokens {
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`no block opening with ${opener}`);
  const body = css.slice(start + opener.length, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
}

const LIGHT = tokensOf(INDEX, ':root {');
const DARK = tokensOf(INDEX, ":root:not([data-theme='light']) {");
const DARK_FORCED = tokensOf(INDEX, ":root[data-theme='dark'] {");
const FORCED = tokensOf(INDEX, ':root:root {');
const THEMES = { light: LIGHT, dark: DARK } as const;

// ---- Colour arithmetic (sRGB, WCAG 2 relative luminance) ----

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }
  throw new Error(`not a colour: ${value}`);
}

/** `top` laid over the opaque `bottom`, as a tint over a cell. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A theme's colours, with each highlight tint laid over a plain cell and a given. */
function palette(tokens: Tokens) {
  const colour = (name: string) => parse(tokens[name]);
  const cell = colour('cell-bg');
  const given = colour('cell-given-bg');
  const tints = { none: null, peer: 'hl-peer', same: 'hl-same', selected: 'hl-selected' };
  const fills = Object.fromEntries(
    Object.entries(tints).map(([name, tint]) => [
      name,
      tint === null
        ? { cell, given }
        : { cell: over(colour(tint), cell), given: over(colour(tint), given) },
    ]),
  ) as Record<keyof typeof tints, { cell: Rgba; given: Rgba }>;
  return { colour, fills };
}

// ---- Rules ----

/** Every declaration block whose selector list includes `selector`, joined. */
function rule(css: string, selector: string): string {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selectors]) =>
    selectors.split(',').some((s) => s.trim() === selector),
  );
  if (blocks.length === 0) throw new Error(`no rule for ${selector}`);
  return blocks.map(([, , body]) => body).join(';');
}

describe('the palette', () => {
  describe.each(Object.entries(THEMES))('%s', (_, tokens) => {
    const { colour, fills } = palette(tokens);

    it.each(['none', 'peer', 'same', 'selected'] as const)(
      'keeps every digit at 4.5:1 on a %s cell',
      (tint) => {
        const selected = tint === 'selected';
        const { cell, given } = fills[tint];
        expect(contrast(colour('digit-given'), given)).toBeGreaterThanOrEqual(4.5);
        for (const kind of ['player', 'correct', 'revealed']) {
          const ink = colour(selected ? `digit-${kind}-selected` : `digit-${kind}`);
          expect(contrast(ink, cell), kind).toBeGreaterThanOrEqual(4.5);
        }
        // Candidates darken to the text colour in the selected cell.
        expect(contrast(colour(selected ? 'text' : 'candidate'), cell)).toBeGreaterThanOrEqual(4.5);
      },
    );

    it('sets the selected cell 1.5:1 apart from a same-number cell, given or not', () => {
      const { selected, same } = fills;
      for (const a of [selected.cell, selected.given]) {
        for (const b of [same.cell, same.given]) {
          expect(contrast(a, b)).toBeGreaterThanOrEqual(1.5);
        }
      }
    });

    it('draws the selection ring at 3:1 against every neighbour', () => {
      const ring = colour('hl-ring');
      for (const tint of ['none', 'peer', 'same'] as const) {
        expect(contrast(ring, fills[tint].cell), tint).toBeGreaterThanOrEqual(3);
        expect(contrast(ring, fills[tint].given), `${tint} given`).toBeGreaterThanOrEqual(3);
      }
    });

    it('keeps the red of a conflict or a wrong answer at 3:1 against its halo', () => {
      expect(contrast(colour('danger'), colour('cell-bg'))).toBeGreaterThanOrEqual(3);
    });

    it('keeps a done pad digit at 4.5:1 on its key', () => {
      expect(contrast(colour('text-muted'), colour('key-bg'))).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps an off switch at 3:1: its track on the page, its knob on the track', () => {
      expect(contrast(colour('text-muted'), colour('bg'))).toBeGreaterThanOrEqual(3);
      expect(contrast(colour('bg'), colour('text-muted'))).toBeGreaterThanOrEqual(3);
    });

    it('gives each pressed key a shade of its own, past the hover one', () => {
      const [rest, hover, pressed] = ['key-bg', 'key-bg-active', 'key-bg-pressed'].map(colour);
      expect(contrast(pressed, hover)).toBeGreaterThan(1.1);
      expect(contrast(pressed, rest)).toBeGreaterThan(contrast(hover, rest));
    });

    it('reads neutral button labels at 4.5:1', () => {
      expect(contrast(colour('text'), colour('button-bg'))).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('lifts neutral buttons off a dark raised sheet, where the pad grey vanishes', () => {
    const { colour } = palette(DARK);
    expect(contrast(colour('key-bg'), colour('surface-raised'))).toBeLessThan(1.1);
    expect(contrast(colour('button-bg'), colour('surface-raised'))).toBeGreaterThanOrEqual(1.3);
  });

  it('keeps the system dark palette and the forced dark one identical', () => {
    expect(DARK_FORCED).toEqual(DARK);
  });

  it('maps every colour token to a system colour in forced-colours mode', () => {
    const colours = Object.keys(LIGHT).filter((name) => !['radius', 'font'].includes(name));
    expect(Object.keys(FORCED).sort()).toEqual(colours.sort());
  });
});

describe('the board', () => {
  it('rings the selected cell however it was selected, not only on keyboard focus', () => {
    expect(rule(BOARD, '.cell--selected')).toMatch(
      /box-shadow:\s*inset 0 0 0 2px var\(--hl-ring\)/,
    );
  });

  it('runs the wrong-answer slash bottom-left to top-right, clear of the conflict dot', () => {
    // A gradient's stripes cross its direction: "to bottom right" draws '/'.
    expect(rule(BOARD, '.cell--wrong::after')).toMatch(/linear-gradient\(\s*to bottom right/);
  });

  it('edges the conflict dot and the slash in the cell colour', () => {
    expect(rule(BOARD, '.cell__conflict')).toMatch(/box-shadow:[^;]*var\(--cell-bg\)/);
    expect(rule(BOARD, '.cell--wrong::after')).toContain('var(--cell-bg)');
  });
});

describe('the controls', () => {
  it('marks a done pad digit without fading the whole key', () => {
    expect(rule(CONTROLS, '.numpad__key--done')).not.toMatch(/opacity/);
  });

  it('draws the off switch track in a colour that holds 3:1', () => {
    expect(rule(CONTROLS, '.switch__track')).toMatch(/background:\s*var\(--text-muted\)/);
  });

  it('keeps a real ring on a menu item with keyboard focus', () => {
    expect(rule(CONTROLS, '.menu__item:focus-visible')).toMatch(
      /outline:\s*2px solid var\(--accent\)/,
    );
  });

  it('keeps the switch clear of the "…" button, whatever the size of its label', () => {
    // A phone gives each its own grid area; the desktop column, where they
    // share one, stops the switch short of the button.
    expect(rule(CONTROLS, '.switch')).toMatch(/grid-area:\s*switch/);
    expect(rule(CONTROLS, '.menu--more')).toMatch(/grid-area:\s*more/);
    expect(rule(CONTROLS, '.controls > .switch')).toMatch(/max-width:\s*calc\(100% - 48px - 8px\)/);
  });

  it.each([
    [CONTROLS, '.numpad__key'],
    [CONTROLS, '.icon-button'],
    [CONTROLS, '.timer'],
    [DIALOGS, '.button'],
    [DIALOGS, '.button--primary'],
    [DIALOGS, '.button--danger'],
  ])('shows %#: %s pressed under the mouse, after its hover rule', (css, selector) => {
    // Equal weight, so whichever comes later wins while both apply.
    const hover = css.indexOf(`${selector}:hover:not(:disabled)`);
    const pressed = css.indexOf(`${selector}:active:not(:disabled)`);
    expect(hover).toBeGreaterThan(-1);
    expect(pressed).toBeGreaterThan(hover);
  });
});

describe('the layout', () => {
  it('sits a phone’s controls at the foot of a tall screen, but at the top beside the board', () => {
    // The first rule is the phone's; the later ones, the desktop's and a phone
    // on its side, put them back.
    const blocks = [...LAYOUT.matchAll(/\.play (?:>\s*)?\.controls\s*\{([^}]*)\}/g)].map(
      ([, body]) => body,
    );
    expect(blocks[0]).toMatch(/margin-top:\s*auto/);
    expect(blocks.slice(1).every((body) => /margin-top:\s*0/.test(body))).toBe(true);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the dialogs', () => {
  it('rules off every footer from the body that scrolls under it', () => {
    expect(rule(DIALOGS, '.dialog__footer')).toMatch(/border-top:\s*1px solid var\(--border\)/);
  });

  it('rings a scrollable body when the keyboard focuses it', () => {
    expect(rule(DIALOGS, '.dialog__body--scrollable:focus-visible')).toMatch(/outline:\s*2px/);
  });

  it('gives a filter tab at least a finger’s width', () => {
    expect(rule(DIALOGS, '.tabs__tab')).toMatch(/min-width:\s*44px/);
  });

  it('puts every History row’s actions on a line of their own, however many it has', () => {
    expect(rule(DIALOGS, '.history-item')).toMatch(/flex-direction:\s*column/);
    expect(rule(DIALOGS, '.history-item__actions')).toMatch(/flex-wrap:\s*wrap/);
  });
});
