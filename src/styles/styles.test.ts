import { THEME_COLOUR } from '../ui/theme';
import {
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

const BOARD = readStyles('board.css');
const CONTROLS = readStyles('controls.css');
const DIALOGS = readStyles('dialogs.css');
const LAYOUT = readStyles('layout.css');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the palette', () => {
  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)('gives each %s key state a shade of its own, pressed past hover', (_, tokens) => {
    const [rest, hover, pressed] = ['key-bg', 'key-bg-active', 'key-bg-pressed'].map((name) =>
      parseHex(tokens[name]),
    );
    expect(contrast(pressed, hover)).toBeGreaterThan(1.1);
    expect(contrast(pressed, rest)).toBeGreaterThan(contrast(hover, rest));
  });

  it('keeps the system dark palette and the forced dark one identical', () => {
    expect(DARK_FORCED).toEqual(DARK);
  });

  it('defines every token in both themes', () => {
    // Fonts and the radius belong to no theme; every colour must be in both.
    const colours = Object.keys(LIGHT).filter((name) => !/^(font|radius)/.test(name));
    expect(Object.keys(DARK).sort()).toEqual(colours.sort());
  });

  it('maps every colour token to a system colour in forced-colours mode', () => {
    const colours = Object.keys(LIGHT).filter((name) => !/^(font|radius)/.test(name));
    expect(Object.keys(FORCED).sort()).toEqual(colours.sort());
  });

  it('paints the browser chrome in the page colour, in the page, script and manifest', () => {
    expect(THEME_COLOUR).toEqual({ light: LIGHT.bg, dark: DARK.bg });
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

  it('tells givens, entries and revealed digits apart by more than colour', () => {
    // Givens are typeset in the slab; entries in the grotesque; a revealed
    // digit in its italic (and a correct one carries a tick, Cell.tsx).
    expect(rule(BOARD, '.cell--given')).toMatch(/font-family:\s*var\(--font-digits\)/);
    expect(rule(BOARD, '.cell')).toMatch(/font-family:\s*var\(--font\)/);
    expect(rule(BOARD, '.cell--revealed')).toMatch(/font-style:\s*italic/);
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
    const app = rule(LAYOUT, '.app');
    expect(app).toMatch(/--frame:\s*clamp\(3px,[^;]*4px\)/);
    expect(app).toMatch(/--thick:\s*clamp\(2px,[^;]*3px\)/);
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

describe('the daily marks', () => {
  it('draws a daily’s marks in ink, the empty one muted', () => {
    expect(rule(DIALOGS, '.daily-mark')).toMatch(/color:\s*var\(--text\)/);
    expect(rule(DIALOGS, '.daily-mark--not-started')).toMatch(/color:\s*var\(--text-muted\)/);
  });
});
