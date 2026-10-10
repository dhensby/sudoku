import { THEME_COLOUR } from '../ui/theme';
import {
  CONTRAST,
  CONTRAST_FORCED,
  DARK,
  DARK_FORCED,
  FORCED,
  LIGHT,
  contrast,
  parseHex,
  readStyles,
  rule,
} from '../test/css';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The stylesheets' own promises, checked from their source: jsdom applies no
 * CSS, so the palette's structure and a handful of rules that fixed real
 * defects are held here instead (the palette's contrast, pair by pair, is
 * contrast.test.ts). Layout (what fits, what scrolls) needs a real browser
 * and is the end-to-end suite's job.
 */

const INDEX = readStyles('index.css');
const BOARD = readStyles('board.css');
const CONTROLS = readStyles('controls.css');
const DIALOGS = readStyles('dialogs.css');
const LAYOUT = readStyles('layout.css');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PALETTES = [
  ['light', LIGHT],
  ['dark', DARK],
  ['High contrast', CONTRAST],
] as const;

/** A palette's own tokens: all but the fonts and the radius, which belong to none (light declares them). */
const themed = (tokens: Record<string, string>): string[] =>
  Object.keys(tokens)
    .filter((name) => !/^(font|radius)/.test(name))
    .sort();

describe('the palette', () => {
  it.each(PALETTES)(
    'gives each %s key state a shade of its own, pressed past hover',
    (_, tokens) => {
      const [rest, hover, pressed] = ['key-bg', 'key-bg-active', 'key-bg-pressed'].map((name) =>
        parseHex(tokens[name]),
      );
      expect(contrast(pressed, hover)).toBeGreaterThan(1.1);
      expect(contrast(pressed, rest)).toBeGreaterThan(contrast(hover, rest));
    },
  );

  it.each(PALETTES)('rings the %s selection in the box lines’ own ink', (_, tokens) => {
    // Where the selected block meets a box line, the ring is what the line
    // touches, so the box line is held to no contrast against the block.
    expect(tokens['hl-ring']).toBe(tokens['grid-thick']);
  });

  it('keeps the system dark palette and the forced dark one identical', () => {
    expect(DARK_FORCED).toEqual(DARK);
  });

  it('keeps the system High contrast palette and the chosen one identical', () => {
    expect(CONTRAST_FORCED).toEqual(CONTRAST);
  });

  it.each([
    ['dark', DARK],
    ['High contrast', CONTRAST],
    ['forced-colours', FORCED],
  ] as const)(
    'defines every token light does in the %s palette, the ones that are not colours too',
    (_, tokens) => {
      // A token one palette left out would keep whichever palette's value
      // matched before it: High contrast's ring, say, under dark.
      expect(themed(tokens)).toEqual(themed(LIGHT));
    },
  );

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)(
    'turns High contrast’s ring, lit candidates and heavier lines off in %s',
    (_, tokens) => {
      expect(tokens['hl-same-ring']).toBe('transparent');
      expect(tokens['hl-same-ring-width']).toBe('0px');
      expect(tokens['line-boost']).toBe('0px');
      expect(tokens['candidate-same']).toBe(tokens.candidate);
    },
  );

  it('rings the same numbers and thickens the lines in High contrast', () => {
    expect(CONTRAST['hl-same-ring-width']).toBe('2px');
    expect(CONTRAST['line-boost']).toBe('1px');
    expect(CONTRAST['candidate-same']).toBe(CONTRAST['hl-same-ring']);
  });

  it('leaves forced colours as they were, whatever the theme', () => {
    // The forced block comes last at the same weight, so it overrides High
    // contrast's extras too.
    expect(FORCED['hl-same-ring']).toBe('transparent');
    expect(FORCED['hl-same-ring-width']).toBe('0px');
    expect(FORCED['line-boost']).toBe('0px');
    expect(FORCED['candidate-same']).toBe(FORCED.candidate);
  });

  it('puts High contrast after dark, and forced colours after both', () => {
    // Each wins over the one before it by order alone: the specificity is
    // the same, (0,2,0), in every block.
    const at = (opener: string) => INDEX.indexOf(opener);
    const dark = Math.max(
      at(":root:not([data-theme='light']) {"),
      at(":root[data-theme='dark'] {"),
    );
    const contrast = [at(":root[data-theme='contrast'] {"), at(':root:not([data-theme]) {')];
    expect(Math.min(...contrast)).toBeGreaterThan(dark);
    expect(at(':root:root {')).toBeGreaterThan(Math.max(...contrast));
  });

  it('applies High contrast under System only on a dark device asking for more contrast', () => {
    expect(INDEX).toMatch(
      /@media \(prefers-color-scheme: dark\) and \(prefers-contrast: more\) \{\s*:root:not\(\[data-theme\]\) \{/,
    );
  });

  it('paints the browser chrome in the page colour, in the page, script and manifest', () => {
    expect(THEME_COLOUR).toEqual({ light: LIGHT.bg, dark: DARK.bg, contrast: CONTRAST.bg });
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain(`<meta name="theme-color" content="${LIGHT.bg}" />`);
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'),
    ) as Record<string, string>;
    expect(manifest.theme_color).toBe(LIGHT.bg);
    expect(manifest.background_color).toBe(LIGHT.bg);
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

  it('edges the conflict dot and the slash in the paper, or the selected block', () => {
    // The edges keep the red clear of the digit it crosses, which a
    // colour-blind player can see as the same shade.
    expect(rule(BOARD, '.cell__conflict')).toMatch(/background:\s*var\(--mark\)/);
    expect(rule(BOARD, '.cell__conflict')).toMatch(/box-shadow:[^;]*var\(--mark-halo\)/);
    expect(rule(BOARD, '.cell--wrong::after')).toContain('var(--mark-halo)');
    expect(rule(BOARD, '.cell')).toMatch(/--mark:\s*var\(--danger\)/);
    expect(rule(BOARD, '.cell')).toMatch(/--mark-halo:\s*var\(--cell-bg\)/);
    // On the block, plain red would fail 3:1: a light coral, edged in the block.
    expect(rule(BOARD, '.cell--selected')).toMatch(/--mark:\s*var\(--danger-selected\)/);
    expect(rule(BOARD, '.cell--selected')).toMatch(/--mark-halo:\s*var\(--hl-selected\)/);
    expect(rule(BOARD, '.cell--selected.cell--given')).toMatch(
      /--mark-halo:\s*var\(--hl-selected-given\)/,
    );
  });

  it.each([
    ['.cell--peer', 'hl-peer'],
    ['.cell--given.cell--peer', 'hl-peer-given'],
    ['.cell--same', 'hl-same'],
    ['.cell--given.cell--same', 'hl-same-given'],
    ['.cell--selected', 'hl-selected'],
    ['.cell--selected.cell--given', 'hl-selected-given'],
  ])('fills %s with its own opaque colour, --%s', (selector, token) => {
    expect(rule(BOARD, selector)).toMatch(new RegExp(`background:\\s*var\\(--${token}\\)`));
  });

  it('knocks every ink on the selected block out to its -selected twin', () => {
    expect(rule(BOARD, '.cell--selected')).toMatch(/color:\s*var\(--digit-player-selected\)/);
    expect(rule(BOARD, '.cell--selected.cell--given')).toMatch(
      /color:\s*var\(--digit-given-selected\)/,
    );
    expect(rule(BOARD, '.cell--selected .cell__candidates')).toMatch(
      /color:\s*var\(--candidate-selected\)/,
    );
    // The hover ghosts too: the text colour at 40% all but vanishes on the block.
    expect(rule(BOARD, '.cell--selected .cell__ghost')).toMatch(
      /color:\s*var\(--candidate-selected\)/,
    );
  });

  it('draws keyboard focus on the selected block in its own colour, inside the ring', () => {
    expect(rule(BOARD, '.cell:focus-visible')).toMatch(/outline-offset:\s*-4px/);
    expect(rule(BOARD, '.cell--selected:focus-visible')).toMatch(
      /outline-color:\s*var\(--cell-focus\)/,
    );
  });

  it('keeps the tick and the conflict dot on the selected block clear of its ring and focus line', () => {
    // The ring and the line take the block's outer 4px; the dot's halo is
    // 1.5px more. In a small cell the percentages alone fall inside that.
    const dot = rule(BOARD, '.cell--selected .cell__conflict');
    expect(dot).toMatch(/right:\s*max\(8%, 6px\)/);
    expect(dot).toMatch(/bottom:\s*max\(8%, 6px\)/);
    const tick = rule(BOARD, '.cell--selected .cell__tick');
    expect(tick).toMatch(/top:\s*max\(12%, 6px\)/);
    expect(tick).toMatch(/left:\s*max\(11%, 6px\)/);
  });

  it('rings a same-number cell inside its edge, where High contrast gives the ring a width', () => {
    expect(rule(BOARD, '.cell--same')).toMatch(
      /box-shadow:\s*inset 0 0 0 var\(--hl-same-ring-width\) var\(--hl-same-ring\)/,
    );
  });

  it('keeps the conflict dot and the tick clear of the same-number ring', () => {
    // Twice the ring for the dot (the ring, then the halo's 1.5px), three
    // times for the tick, as on the selected block; with no ring, the
    // percentages stand.
    const dot = rule(BOARD, '.cell--same .cell__conflict');
    expect(dot).toMatch(/right:\s*max\(8%, calc\(2 \* var\(--hl-same-ring-width\)\)\)/);
    expect(dot).toMatch(/bottom:\s*max\(8%, calc\(2 \* var\(--hl-same-ring-width\)\)\)/);
    const tick = rule(BOARD, '.cell--same .cell__tick');
    expect(tick).toMatch(/top:\s*max\(12%, calc\(3 \* var\(--hl-same-ring-width\)\)\)/);
    expect(tick).toMatch(/left:\s*max\(11%, calc\(3 \* var\(--hl-same-ring-width\)\)\)/);
  });

  it('inks a candidate of the selected number in its own token', () => {
    expect(rule(BOARD, '.cell__candidate--same')).toMatch(/color:\s*var\(--candidate-same\)/);
  });

  it('tells givens, entries and revealed digits apart by more than colour', () => {
    // Givens are typeset in the slab; entries in the grotesque; a revealed
    // digit in its italic (and a correct one carries a tick, Cell.tsx).
    expect(rule(BOARD, '.cell--given')).toMatch(/font-family:\s*var\(--font-digits\)/);
    expect(rule(BOARD, '.cell')).toMatch(/font-family:\s*var\(--font\)/);
    expect(rule(BOARD, '.cell--revealed')).toMatch(/font-style:\s*italic/);
  });

  it('sets candidates at 28% of the cell, and 9–11px on a small board, as large as fits', () => {
    // 11px from a 32⅓px cell up; below that, 34% of the cell, down to 9px
    // at a 26½px cell, and below a 23.7px cell, 38% of it. Three rows of
    // lines 0.8 high then fit inside the padding of any cell — at 24px,
    // 3 × 7.2px + 2 × 0.96px is 23.5px — where a 1-high line at 9px
    // spilled out of it.
    const candidates = rule(BOARD, '.cell__candidates');
    expect(candidates).toMatch(
      /font-size:\s*max\(\s*calc\(var\(--cell\) \* 0\.28\),\s*clamp\(min\(9px, calc\(var\(--cell\) \* 0\.38\)\), calc\(var\(--cell\) \* 0\.34\), 11px\)\s*\)/,
    );
    expect(candidates).toMatch(/line-height:\s*0\.8/);
    expect(candidates).toMatch(/padding:\s*calc\(var\(--cell\) \* 0\.04\)/);
  });

  it('sets candidates heavier on a board under 400px', () => {
    expect(rule(BOARD, '.cell__candidates')).toMatch(/font-weight:\s*500/);
    expect(BOARD).toMatch(
      /@container board-column \(max-width: 399\.98px\)\s*\{\s*\.cell__candidates,\s*\.cell__ghosts\s*\{\s*font-weight:\s*600;/,
    );
  });
});

describe('the controls', () => {
  it('rules every key round, so its shape holds 3:1 without its fill', () => {
    expect(rule(CONTROLS, '.numpad__key')).toMatch(/border:\s*1px solid var\(--key-border\)/);
    expect(rule(CONTROLS, '.mode-toggle')).toMatch(/inset 0 0 0 1px var\(--key-border\)/);
    // Neutral buttons too: their fill is only a shade off the dialog.
    expect(rule(DIALOGS, '.button')).toMatch(/border:\s*1px solid var\(--key-border\)/);
  });

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

  it('breaks "Candidate" onto a second line rather than clip it, under a reader’s own spacing', () => {
    // WCAG 1.4.12: wider letter and word spacing must not cost any letters.
    const option = rule(CONTROLS, '.mode-toggle__option');
    expect(option).toMatch(/overflow-wrap:\s*anywhere/);
    expect(option).not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it.each([
    [CONTROLS, ".more-button[aria-expanded='true']"],
    [CONTROLS, '.icon-button:active:not(:disabled)'],
    [CONTROLS, ".mode-toggle__option[aria-pressed='false']:active:not(:disabled)"],
    [LAYOUT, '.hint-bar__dismiss:active'],
  ])('rings %#: %s in forced colours, rather than filling it with Highlight', (css, selector) => {
    // The fill would sit under ButtonText, under 2.5:1 in either scheme.
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
    expect(rule(forced, selector)).toMatch(/background:\s*ButtonFace/);
    expect(rule(forced, selector)).toMatch(/outline:\s*2px solid Highlight/);
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
  it('frames the board more heavily than its box lines, each a pixel lighter on a small board', () => {
    // And a pixel heavier in High contrast (--line-boost): its box lines
    // are never under 3px, nor its frame under 4px.
    const app = rule(LAYOUT, '.app');
    expect(app).toMatch(/--frame:\s*calc\(clamp\(3px,[^;]*4px\) \+ var\(--line-boost\)\)/);
    expect(app).toMatch(/--thick:\s*calc\(clamp\(2px,[^;]*3px\) \+ var\(--line-boost\)\)/);
  });

  it('rules off the header in ink, as under a masthead', () => {
    expect(LAYOUT).toMatch(/\.header\s*\{\s*border-bottom:\s*2px solid var\(--text\)/);
  });

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

describe('the tally: help taken and the error counter', () => {
  it('counts its line above a phone’s controls into the column, only while it is on', () => {
    const app = rule(LAYOUT, '.app');
    expect(app).toMatch(/--tally-height:\s*0px/);
    expect(app).toMatch(/--tally-gap:\s*0px/);
    expect(app).toMatch(/--chrome:[^;]*var\(--tally-height\)\s*\+\s*var\(--tally-gap\)/);
    const on = rule(LAYOUT, '.app--tally');
    expect(on).toMatch(/--tally-height:\s*18px/);
    expect(on).toMatch(/--tally-gap:\s*var\(--play-gap\)/);
    // A line of exactly that height, however it is filled.
    expect(rule(LAYOUT, '.tally--play')).toMatch(/height:\s*var\(--tally-height\)/);
  });

  it('takes the line out of the column until it is counted in, so it adds no gap of its own', () => {
    expect(rule(LAYOUT, '.app:not(.app--tally) .tally--play')).toMatch(/display:\s*none/);
    // The controls give up their foot-of-the-screen margin to it only while it shows.
    expect(LAYOUT).toMatch(/\.app--tally \.play > \.tally--play \+ \.controls \{\s*margin-top: 0;/);
    // And a short phone gives it its line as any other does.
    expect(LAYOUT).not.toMatch(/\.app--counter/);
  });

  it('sits beside the timer where the header has room, and above the controls where it has not', () => {
    expect(rule(LAYOUT, '.tally--header')).toMatch(/display:\s*none/);
    expect(LAYOUT).toMatch(
      /@media \(min-width: 850px\), \(orientation: landscape\) and \(max-height: 500px\) \{\s*\.tally--header \{\s*display: flex;\s*\}\s*\.tally--header:empty \{\s*display: none;\s*\}[^@]*\.tally--play \{\s*display: none;/,
    );
  });

  it('stacks help taken over the counter beside the timer, and sets them apart on a phone’s line', () => {
    const header = rule(LAYOUT, '.tally--header');
    expect(header).toMatch(/flex-direction:\s*column/);
    expect(header).toMatch(/align-items:\s*flex-end/);
    expect(rule(LAYOUT, '.tally--play .error-counter')).toMatch(/margin-left:\s*auto/);
    // Help taken gives way on the line; the counter never does.
    expect(rule(LAYOUT, '.help-taken')).toMatch(/min-width:\s*0/);
    expect(rule(LAYOUT, '.tally--play .error-counter')).toMatch(/flex:\s*none/);
  });

  it('holds help taken in the header to the counter’s widest, so the header’s breakpoints hold for both', () => {
    // 173.5px and 186.8px, measured: no wider, in the header's ems.
    expect(rule(LAYOUT, '.help-taken--header')).toMatch(/max-width:\s*10\.8rem/);
    expect(LAYOUT).toMatch(
      /@media \(min-width: 850px\) \{\s*\.help-taken--header \{\s*max-width: 11\.6rem;/,
    );
  });

  it('lays the three wordings of help taken in one cell, sized by the full words', () => {
    for (const form of ['full', 'counts', 'total']) {
      expect(rule(LAYOUT, `.help-taken__${form}`)).toMatch(/grid-area:\s*1 \/ 1/);
    }
    expect(rule(LAYOUT, '.help-taken__face')).toMatch(
      /grid-template-columns:\s*minmax\(0, max-content\)/,
    );
    // Measured at their own widths, whatever the box's.
    expect(rule(LAYOUT, '.help-taken__full')).toMatch(/width:\s*max-content/);
    expect(rule(LAYOUT, '.help-taken__counts')).toMatch(/width:\s*max-content/);
    // One on show at a time.
    expect(rule(LAYOUT, '.help-taken__counts')).toMatch(/visibility:\s*hidden/);
    expect(rule(LAYOUT, '.help-taken__total')).toMatch(/visibility:\s*hidden/);
    for (const form of ['counts', 'total']) {
      expect(rule(LAYOUT, `.help-taken__face--${form} .help-taken__full`)).toMatch(
        /visibility:\s*hidden/,
      );
      expect(rule(LAYOUT, `.help-taken__face--${form} .help-taken__${form}`)).toMatch(
        /visibility:\s*visible/,
      );
    }
    // Only the last, for a switch alone, can ever be cut short.
    expect(rule(LAYOUT, '.help-taken__total')).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(LAYOUT, '.help-taken__counts')).not.toMatch(/ellipsis/);
  });

  it('ticks underlined in the accent, fading back, or under reduced motion held still', () => {
    const tick = rule(LAYOUT, '.help-taken__face--tick');
    expect(tick).toMatch(/text-decoration:\s*underline/);
    expect(tick).toMatch(/animation:\s*help-taken-tick 1200ms/);
    // Nothing grows or moves, so nothing is drawn over what is beside it.
    const keyframes = LAYOUT.slice(LAYOUT.indexOf('@keyframes help-taken-tick'));
    expect(keyframes.slice(0, keyframes.indexOf('\n}'))).not.toMatch(/transform|scale/);
    expect(LAYOUT).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.help-taken__face--tick,\s*\.help-taken__face--tick \.help-taken__count \{\s*color: var\(--accent\);/,
    );
    // And the global rule stops the pop itself.
    expect(INDEX).toMatch(
      /prefers-reduced-motion: reduce[^}]*animation-duration: 0\.01ms !important/,
    );
  });

  it('moves the timer off the end of the header only where the tally takes its place', () => {
    // Everywhere else, the tally is not shown, and the timer stays at the end.
    const beside = [...LAYOUT.matchAll(/\.tally--header:not\(:empty\) \+ \.header__timer/g)];
    expect(beside).toHaveLength(1);
    const media = LAYOUT.lastIndexOf('@media', beside[0].index);
    expect(LAYOUT.slice(media, beside[0].index)).toMatch(
      /^@media \(min-width: 850px\), \(orientation: landscape\) and \(max-height: 500px\) \{/,
    );
  });

  it('makes the wordmark give way for it sooner where it shares the header', () => {
    expect(LAYOUT).toMatch(
      /@container header \(max-width: calc\(432px \+ 26em\)\) \{\s*\.header--tally \.header__title/,
    );
    expect(LAYOUT).toMatch(
      /@container header \(max-width: calc\(173px \+ 23\.6em\)\) \{\s*\.header--tally \.header__title/,
    );
  });

  it('makes the wordmark give way for a daily’s "Daily ·" sooner still, as without it', () => {
    // 3.3em more, as `.header--daily .header__title` takes over the plain row.
    expect(LAYOUT).toMatch(
      /@container header \(max-width: calc\(165px \+ 15\.4em\)\) \{\s*\.header--daily \.header__title/,
    );
    expect(LAYOUT).toMatch(
      /@container header \(max-width: calc\(173px \+ 26\.9em\)\) \{\s*\.header--tally\.header--daily \.header__title \{[^}]*clip-path: inset\(50%\);/,
    );
    expect(LAYOUT).toMatch(
      /@container header \(max-width: calc\(432px \+ 29\.3em\)\) \{\s*\.header--tally\.header--daily \.header__title \{[^}]*clip-path: inset\(50%\);/,
    );
  });

  it('makes the row of seven buttons give way for it too, folding them into the Menu last', () => {
    // Inside the desktop's block, where the seven buttons show.
    const fold = LAYOUT.indexOf('@container header (max-width: calc(419px + 18.4em))');
    expect(LAYOUT.slice(LAYOUT.lastIndexOf('@media', fold), fold)).toMatch(
      /^@media \(min-width: 850px\) \{/,
    );
    const block = LAYOUT.slice(LAYOUT.lastIndexOf('@media', fold));
    // "Daily ·" first, then the tier, each only while the seven buttons show.
    expect(block).toMatch(
      /@container header \(min-width: calc\(419px \+ 18\.4em\)\) and \(max-width: calc\(419px \+ 23\.4em\)\) \{\s*\.header--tally\.header--daily \.header__daily \{\s*display: none;/,
    );
    expect(block).toMatch(
      /@container header \(min-width: calc\(419px \+ 18\.4em\)\) and \(max-width: calc\(419px \+ 20\.1em\)\) \{\s*\.header--tally \.header__tier \{[^}]*clip-path: inset\(50%\);[^}]*\}\s*\.header--tally \.header__tier-short \{\s*display: inline;/,
    );
    // Then the five less-used actions fold into the Menu, as on a phone.
    expect(block).toMatch(
      /@container header \(max-width: calc\(419px \+ 18\.4em\)\) \{\s*\.header--tally \.header__actions \.header__wide \{\s*display: none;\s*\}\s*\.header--tally \.header__actions \.header__narrow \{\s*display: inline-flex;/,
    );
  });
});

describe('the dialogs', () => {
  it('spells out the primary button and the "Current" badge in forced colours', () => {
    // Left to their tokens, they are HighlightText on Highlight — which the
    // browser keeps, then hides behind its Canvas backplate for the text.
    const forced = DIALOGS.slice(DIALOGS.indexOf('@media (forced-colors: active)'));
    expect(rule(forced, '.button--primary')).toMatch(/color:\s*ButtonText/);
    expect(rule(forced, '.button--primary')).toMatch(/background:\s*ButtonFace/);
    expect(rule(forced, '.history-item__current')).toMatch(/color:\s*CanvasText/);
  });

  it.each([
    '.button--primary:hover:not(:disabled)',
    '.button--primary:active:not(:disabled)',
    '.button--danger:hover:not(:disabled)',
    '.button--danger:active:not(:disabled)',
  ])('keeps %s on its forced-colours face', (selector) => {
    // Their usual shades are mixed from system colours here, and the board's
    // cards paint themselves: the mix would show as it is, under ButtonText.
    const forced = DIALOGS.slice(DIALOGS.indexOf('@media (forced-colors: active)'));
    expect(rule(forced, selector)).toMatch(/background:\s*ButtonFace/);
    expect(rule(forced, selector)).toMatch(/border-color:\s*Highlight/);
  });

  it('rules off every footer from the body that scrolls under it', () => {
    expect(rule(DIALOGS, '.dialog__footer')).toMatch(/border-top:\s*1px solid var\(--border\)/);
  });

  it('rings a scrollable body when the keyboard focuses it', () => {
    expect(rule(DIALOGS, '.dialog__body--scrollable:focus-visible')).toMatch(/outline:\s*2px/);
  });

  it('gives a filter tab at least a finger’s width', () => {
    expect(rule(DIALOGS, '.tabs__tab')).toMatch(/min-width:\s*44px/);
  });

  it('leaves a History row room for its buttons’ focus rings, which it would otherwise clip', () => {
    // content-visibility contains the row's paint; a ring reaches 4px out.
    const row = rule(DIALOGS, '.history-item');
    expect(row).toMatch(/content-visibility:\s*auto/);
    expect(row).toMatch(/padding:\s*12px 4px/);
    expect(row).toMatch(/margin:\s*0 -4px/);
  });

  it.each([
    ['.result__mistakes', 'text'],
    ['.challenge__mistakes', 'text-muted'],
  ])('sets %s in --%s, a pair the contrast guard holds on every dialog', (selector, token) => {
    // contrast.test.ts holds text and muted text at 4.5:1 on every surface;
    // a colour of its own would be a pair it never checks.
    expect(rule(DIALOGS, selector)).toMatch(new RegExp(`color:\\s*var\\(--${token}\\)`));
  });

  it('puts every History row’s actions on a line of their own, however many it has', () => {
    expect(rule(DIALOGS, '.history-item')).toMatch(/flex-direction:\s*column/);
    expect(rule(DIALOGS, '.history-item__actions')).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe('the technique guide', () => {
  it('draws its worked examples itself in forced colours, outlining the shaded houses', () => {
    expect(DIALOGS).toMatch(
      /\.technique-diagram__board,\s*\.technique-diagram__swatch\s*\{\s*forced-color-adjust:\s*none/,
    );
    expect(rule(DIALOGS, '.technique-diagram__outlines rect')).toMatch(/stroke-dasharray/);
    // Hidden until then: the shading says it in colour.
    expect(rule(DIALOGS, '.technique-diagram__outlines')).toMatch(/display:\s*none/);
  });

  it('keeps a hint’s question in one piece, and swaps it for an icon on the narrowest bars', () => {
    expect(rule(LAYOUT, '.hint-bar__question')).toMatch(/white-space:\s*nowrap/);
    expect(LAYOUT).toMatch(/@container hint-bar \(max-width: 21em\)/);
    expect(rule(LAYOUT, '.hint-bar')).toMatch(/container:\s*hint-bar \/ inline-size/);
  });

  it('fits the list of entries to the card, whatever its scrim and header', () => {
    // Every part of the height the list gives up is a property that the
    // short screen and the touch screen change, so no rule can override it.
    expect(rule(DIALOGS, '.guide__nav')).toMatch(
      /max-height:\s*calc\(\s*100dvh - var\(--guide-scrim\) - 2px - var\(--guide-header-top\) - var\(--guide-close\)/,
    );
    const values = (property: string) =>
      [...DIALOGS.matchAll(new RegExp(`--guide-${property}:\\s*(\\d+px)`, 'g'))].map(([, v]) => v);
    // As the overlay's padding, the header's top padding and the close button.
    expect(values('scrim')).toEqual(['48px', '24px']);
    expect(values('header-top')).toEqual(['14px', '10px']);
    expect(values('close')).toEqual(['36px', '44px']);
  });

  it('gives a hint’s question a finger’s 44px on a touch screen', () => {
    const touch = LAYOUT.slice(LAYOUT.lastIndexOf('@media (pointer: coarse)'));
    // The words: 17px tall, plus 20px above and 7px below.
    expect(touch).toMatch(/\.hint-bar__question::after\s*\{\s*inset:\s*-20px -8px -7px/);
    // The 16px icon on the narrowest bars: 16 + 21 + 7 tall, 16 + 2 × 14 wide.
    expect(touch).toMatch(/\.hint-bar__question::after\s*\{\s*inset:\s*-21px -14px -7px/);
  });

  it('gives the list of entries a finger’s height on a touch screen', () => {
    expect(rule(DIALOGS, '.guide__link')).toMatch(/min-height:\s*44px/);
  });

  it('sizes the picker’s text at 16px, below which iOS zooms the page on focus', () => {
    expect(rule(DIALOGS, '.guide__select')).toMatch(/font-size:\s*16px/);
  });
});

describe('Show me', () => {
  it('sets Show me a line high, rule and all, so the hint bar keeps its height', () => {
    expect(rule(LAYOUT, '.hint-bar__show')).toMatch(
      /line-height:\s*calc\(var\(--hint-line\) \* 1em - 2px\)/,
    );
    expect(rule(LAYOUT, '.hint-bar__show')).toMatch(/white-space:\s*nowrap/);
  });

  it('gives the question way to its icon sooner beside Show me, then the hint’s mark, then Show me’s words', () => {
    expect(LAYOUT).toMatch(
      /@container hint-bar \(max-width: 22\.75em\)\s*\{\s*\.hint-bar__question:has\(\+ \.hint-bar__show\) \.hint-bar__question-text/,
    );
    // On a 320×568 phone's 268px bar, and a phone on its side's 288px, the
    // mark goes and Show me keeps its words; the question stays.
    expect(LAYOUT).toMatch(
      /@container hint-bar \(max-width: 18\.75em\)\s*\{\s*\.hint-bar__message:has\(\.hint-bar__show\) \.hint-bar__icon\s*\{\s*display:\s*none/,
    );
    expect(LAYOUT).toMatch(/@container hint-bar \(max-width: 16\.5em\)\s*\{\s*\.hint-bar__show \{/);
    expect(LAYOUT).not.toMatch(
      /\.hint-bar__question:has\(\+ \.hint-bar__show\)\s*\{\s*display:\s*none/,
    );
  });

  it('gives Show me, and the question beside it, a finger’s 44px on a touch screen', () => {
    const touch = LAYOUT.slice(LAYOUT.lastIndexOf('@media (pointer: coarse)'));
    // Inside its rule, 15px tall, plus 22px above and 8px below.
    expect(touch).toMatch(/\.hint-bar__show::after\s*\{\s*inset:\s*-22px -8px -8px -1px/);
    // The question's 16px icon beside it: 16 + 28 + 1 wide.
    expect(touch).toMatch(
      /\.hint-bar__question:has\(\+ \.hint-bar__show\)::after\s*\{\s*inset:\s*-21px -1px -7px -28px/,
    );
    // Show me's play mark alone: 6 + 11 + 6 inside its rule, and 1 and 21 either side.
    expect(touch).toMatch(/\.hint-bar__show::after\s*\{\s*inset:\s*-22px -21px -8px -1px/);
    // Both kept on the hint's last line, where an area reaching up is clear of the board.
    expect(rule(LAYOUT, '.hint-bar__actions')).toMatch(/white-space:\s*nowrap/);
  });

  it('draws its marks itself in forced colours, swatches and all', () => {
    expect(DIALOGS).toMatch(
      /\.technique-diagram__target-swatch,\s*\.technique-diagram__ruled-out-swatch\s*\{\s*forced-color-adjust:\s*none/,
    );
    // A shape no other mark has: square corners, and a dashed strike.
    expect(rule(DIALOGS, '.technique-diagram__target path')).toMatch(/stroke-linecap:\s*square/);
    expect(rule(DIALOGS, '.technique-diagram__ruled-out line')).toMatch(/stroke-dasharray/);
  });

  it('gives Previous and Next a finger’s height', () => {
    expect(rule(DIALOGS, '.walkthrough__page')).toMatch(/min-height:\s*44px/);
  });

  it('sizes a step’s board to the body on a phone on its side, its words beside it', () => {
    const short = DIALOGS.slice(
      DIALOGS.lastIndexOf('@media (max-height: 500px) and (min-width: 500px)'),
    );
    expect(short).toMatch(/^@media[^{]*\{\s*\.dialog--walkthrough\s*\{\s*height:/);
    // The body is what the board is measured by...
    expect(short).toMatch(
      /\.dialog--walkthrough \.dialog__body\s*\{\s*container:\s*walkthrough-body \/ size/,
    );
    expect(short).toMatch(/grid-template-columns:\s*min\(360px, 100cqh\) minmax\(0, 1fr\)/);
    // ...and the board stays put while its words scroll past.
    expect(short).toMatch(
      /\.walkthrough__step \.technique-diagram__board\s*\{\s*position:\s*sticky;\s*top:\s*0/,
    );
    // A container would be laid out on its own, and could not be a subgrid.
    expect(short).toMatch(
      /\.walkthrough__step\s*\{\s*container-type:\s*normal;[^}]*grid-template-columns:\s*subgrid/,
    );
  });
});

describe('Watch your solve', () => {
  it('draws the played-back board with the game’s own geometry, from a size of its own', () => {
    const board = rule(DIALOGS, '.playback__board');
    for (const name of ['--frame', '--thick', '--thin', '--lines', '--board-outer']) {
      const own = new RegExp(`${name}:\\s*([^;]+);`).exec(rule(LAYOUT, '.app'))![1];
      expect(board, name).toContain(`${name}: ${own};`);
    }
    // Whole-pixel cells where round() is known, as the game's are.
    expect(DIALOGS).toMatch(
      /@supports \(width: round\(down, 10\.5px, 1px\)\) \{\s*\.playback__board \{\s*--cell: round\(down/,
    );
  });

  it('rings the move on show’s cell in the accent, as an outline forced colours keep', () => {
    const current = rule(BOARD, '.cell--current');
    // Sized from the cell: 2px on a phone's small board, 3px on a large one.
    expect(current).toMatch(/--current-ring:\s*clamp\(2px, calc\(var\(--cell\) \* 0\.06\), 3px\)/);
    expect(current).toMatch(/outline:\s*var\(--current-ring\) solid var\(--accent\)/);
    expect(current).toMatch(/outline-offset:\s*calc\(-1 \* var\(--current-ring\)\)/);
  });

  it('keeps what the caption is about clear of the ring, on the smallest board too', () => {
    // The candidates inset by the ring, the tick a pixel past it.
    expect(rule(BOARD, '.cell--current .cell__candidates')).toMatch(
      /padding:\s*max\(calc\(var\(--cell\) \* 0\.04\), var\(--current-ring\)\)/,
    );
    expect(rule(BOARD, '.cell--current .cell__tick')).toMatch(
      /top:\s*max\(12%, calc\(var\(--current-ring\) \+ 1px\)\)/,
    );
    // The conflict dot keeps its corner: moved in by a fixed 6px, as on the
    // selected block, it would sit on a 20px cell's digit.
    expect(BOARD).not.toContain('.cell--current .cell__conflict');
  });

  it('gives a played-back board no hover and no pointer, as nothing on it can be pressed', () => {
    expect(BOARD).toMatch(/\.board:not\(\[aria-readonly='true'\], \.board--read-only\)/);
    expect(rule(BOARD, '.board--read-only .cell')).toMatch(/cursor:\s*default/);
  });

  it('tells the scrubber’s marks apart by place and shape, and draws them itself in forced colours', () => {
    expect(rule(DIALOGS, '.playback__tick--mistake')).toMatch(/background:\s*var\(--danger\)/);
    expect(rule(DIALOGS, '.playback__tick--slip')).toMatch(
      /border:\s*1\.5px solid var\(--danger\)/,
    );
    expect(rule(DIALOGS, '.playback__tick--help')).toMatch(/bottom:/);
    expect(DIALOGS).toMatch(
      /\.playback__ticks,\s*\.playback__key \.playback__tick\s*\{\s*forced-color-adjust:\s*none/,
    );
  });

  it('gives the scrubber and the speeds a finger’s height on a touch screen', () => {
    const touch = DIALOGS.slice(
      DIALOGS.indexOf('@media (pointer: coarse)', DIALOGS.indexOf('Touch support')),
    );
    expect(touch).toMatch(/\.playback__scrubber\s*\{\s*--thumb:\s*24px;\s*height:\s*44px/);
    expect(touch).toMatch(/\.playback__speed\s*\{\s*min-height:\s*40px/);
  });

  it('marks the buttons past an end unavailable, still and faded, without disabling them', () => {
    expect(rule(DIALOGS, ".playback__button[aria-disabled='true']:hover")).toMatch(
      /opacity:\s*0\.5/,
    );
  });

  it('puts the board beside the controls on a phone on its side', () => {
    const short = DIALOGS.slice(
      DIALOGS.indexOf(
        '@media (max-height: 500px) and (min-width: 500px)',
        DIALOGS.indexOf('a playback'),
      ),
    );
    expect(short).toMatch(/\.dialog--playback \.dialog__body\s*\{\s*display:\s*grid/);
    expect(short).toMatch(/\.playback\s*\{\s*display:\s*contents/);
    expect(short).toMatch(/--board-size:\s*clamp\(160px, calc\(100dvh - 104px\), 400px\)/);
  });
});

describe('the daily calendar', () => {
  it('draws a daily’s marks in ink, the empty one muted', () => {
    expect(rule(DIALOGS, '.daily-mark')).toMatch(/color:\s*var\(--text\)/);
    expect(rule(DIALOGS, '.daily-mark--not-started')).toMatch(/color:\s*var\(--text-muted\)/);
  });

  it('prints the chosen day as the board prints its selection, every mark knocked out', () => {
    const chosen = rule(DIALOGS, '.calendar__day.calendar__day--selected');
    expect(chosen).toMatch(/background:\s*var\(--accent\)/);
    expect(chosen).toMatch(/color:\s*var\(--accent-text\)/);
    expect(rule(DIALOGS, '.calendar__day--selected .daily-mark')).toMatch(
      /color:\s*var\(--accent-text\)/,
    );
    // Today's ring, on the block, is a paper line inside it.
    expect(rule(DIALOGS, '.calendar__day--selected.calendar__day--today')).toMatch(
      /box-shadow:\s*inset 0 0 0 2px var\(--accent-text\)/,
    );
  });

  it('never lets hover cover the chosen day', () => {
    expect(DIALOGS).toMatch(
      /\.calendar__day:not\(\s*\.calendar__day--outside,\s*\.calendar__day--unavailable,\s*\.calendar__day--selected\s*\):hover/,
    );
  });

  it('keeps every day a finger’s 44px on the narrowest phone', () => {
    const narrow = DIALOGS.slice(DIALOGS.indexOf('@media (max-width: 374px)'));
    expect(narrow).toMatch(/\.calendar__grid\s*\{\s*border-spacing:\s*0/);
    expect(rule(DIALOGS, '.calendar__day')).toMatch(/height:\s*(4[4-9]|5\d)px/);
  });

  it('keeps the chosen day and today in Windows High Contrast', () => {
    const forced = DIALOGS.slice(DIALOGS.lastIndexOf('@media (forced-colors: active) {'));
    expect(forced).toMatch(
      /\.calendar__day\.calendar__day--selected\s*\{\s*forced-color-adjust:\s*none;\s*background:\s*Highlight/,
    );
    expect(forced).toMatch(/\.calendar__day--today\s*\{\s*outline:\s*2px solid CanvasText/);
  });
});
