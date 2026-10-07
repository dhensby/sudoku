import {
  DARK,
  DEFICIENCIES,
  LIGHT,
  contrast,
  luminance,
  mix,
  parseHex,
  simulate,
  type Rgb,
  type Tokens,
} from '../test/css';

/*
 * The palette's accessibility, as a table: every pair of colours a player
 * reads, in both themes, with the contrast it must hold (WCAG 2 relative
 * luminance). The tokens are read from index.css itself, so an edit there
 * that weakens a pair fails here, naming the pair, rather than in a
 * player's eyes.
 *
 * The targets:
 * - 7:1 (AAA) for given and player digits on every cell they can sit on;
 *   4.5:1 for checked and revealed digits, candidates and all text;
 * - 3:1 for what is not text but must be seen: the thin rules, the
 *   selection's fill and ring, conflict dots and wrong slashes, the edges of
 *   keys, switches and fields, and focus rings; 7:1 for the box lines;
 * - the steps between cell fills: selected 1.6:1 from same-number, same
 *   1.3:1 from peer, peer and given 1.25:1 from plain — steps of lightness
 *   that colour-blind players keep too (the simulated ladders, below).
 */

const AAA = 7;
const TEXT = 4.5;
const NON_TEXT = 3;

/** A token, or a colour the stylesheets compose from tokens. */
type Colour = string | { mix: [Colour, number, Colour] };

/** `color-mix(in srgb, a p, b)` — or `a` at opacity `p` over `b`, which is the same sum. */
const mixed = (a: Colour, p: number, b: Colour): Colour => ({ mix: [a, p, b] });

function resolve(tokens: Tokens, colour: Colour): Rgb {
  if (typeof colour === 'string') {
    if (!(colour in tokens)) throw new Error(`no token --${colour}`);
    return parseHex(tokens[colour]);
  }
  const [a, p, b] = colour.mix;
  return mix(resolve(tokens, a), p, resolve(tokens, b));
}

/** [what, foreground, background, minimum] */
type Pair = [string, Colour, Colour, number];

/** The cell fills a digit can sit on, plain and given, with their names. */
const PLAIN_FILLS = [
  ['plain', 'cell-bg'],
  ['peer (and hover)', 'hl-peer'],
  ['same-number', 'hl-same'],
] as const;
const GIVEN_FILLS = [
  ['given', 'cell-given-bg'],
  ['peer given', 'hl-peer-given'],
  ['same-number given', 'hl-same-given'],
] as const;
const ALL_FILLS = [...PLAIN_FILLS, ...GIVEN_FILLS];

const PAIRS: Pair[] = [
  // ---- Digits and candidates, on every cell they can sit on ----
  ...GIVEN_FILLS.map(([name, fill]): Pair => [
    `given digit on a ${name}`,
    'digit-given',
    fill,
    AAA,
  ]),
  ['given digit on the selected given', 'digit-given-selected', 'hl-selected-given', AAA],
  ...(
    [
      ['player', AAA],
      ['correct', TEXT],
      ['revealed', TEXT],
    ] as const
  ).flatMap(([kind, minimum]): Pair[] => [
    ...PLAIN_FILLS.map(([name, fill]): Pair => [
      `${kind} digit on a ${name} cell`,
      `digit-${kind}`,
      fill,
      minimum,
    ]),
    [`${kind} digit on the selected cell`, `digit-${kind}-selected`, 'hl-selected', minimum],
  ]),
  ...PLAIN_FILLS.map(([name, fill]): Pair => [
    `candidate on a ${name} cell`,
    'candidate',
    fill,
    TEXT,
  ]),
  ['candidate on the selected cell', 'candidate-selected', 'hl-selected', TEXT],

  // ---- Lines ----
  ['thin rule against a plain cell', 'grid-thin', 'cell-bg', NON_TEXT],
  ['box line against a plain cell', 'grid-thick', 'cell-bg', AAA],
  ['board frame against the page', 'grid-thick', 'bg', AAA],

  // ---- The ladders of cell fills ----
  ['selected against plain', 'hl-selected', 'cell-bg', NON_TEXT],
  ['selected against same-number', 'hl-selected', 'hl-same', 1.6],
  ['same-number against peer', 'hl-same', 'hl-peer', 1.3],
  ['peer against plain', 'hl-peer', 'cell-bg', 1.25],
  ['given against plain', 'cell-given-bg', 'cell-bg', 1.25],
  ['selected given against given', 'hl-selected-given', 'cell-given-bg', NON_TEXT],
  ['selected given against same-number given', 'hl-selected-given', 'hl-same-given', 1.6],
  ['same-number given against peer given', 'hl-same-given', 'hl-peer-given', 1.3],
  ['peer given against given', 'hl-peer-given', 'cell-given-bg', 1.25],
  // A selected cell beside a same-number cell of the other kind.
  ['selected against same-number given', 'hl-selected', 'hl-same-given', 1.6],
  ['selected given against same-number', 'hl-selected-given', 'hl-same', 1.6],
  ['selected against given', 'hl-selected', 'cell-given-bg', NON_TEXT],
  ['selected given against plain', 'hl-selected-given', 'cell-bg', NON_TEXT],

  // ---- The selection's ring, and keyboard focus inside it ----
  ...ALL_FILLS.map(([name, fill]): Pair => [
    `selection ring against a ${name} neighbour`,
    'hl-ring',
    fill,
    NON_TEXT,
  ]),
  ['focus line on the selected cell', 'cell-focus', 'hl-selected', NON_TEXT],
  ['focus line on the selected given', 'cell-focus', 'hl-selected-given', NON_TEXT],
  ['focus line against the ring beside it', 'cell-focus', 'hl-ring', NON_TEXT],
  ['focus line on any other cell', 'text', 'cell-bg', NON_TEXT],

  // ---- Conflict dots and wrong slashes ----
  ...ALL_FILLS.map(([name, fill]): Pair => [
    `danger mark on a ${name} cell`,
    'danger',
    fill,
    NON_TEXT,
  ]),
  ['danger mark on the selected cell', 'danger-selected', 'hl-selected', NON_TEXT],
  ['danger mark on the selected given', 'danger-selected', 'hl-selected-given', NON_TEXT],

  // ---- Text, on every surface and key ----
  ...(
    [
      'bg',
      'surface',
      'surface-raised',
      'key-bg',
      'key-bg-active',
      'key-bg-pressed',
      'button-bg',
    ] as const
  ).flatMap((surface): Pair[] => [
    [`text on ${surface}`, 'text', surface, TEXT],
    // Muted text includes a done pad digit, on every state of its key.
    [`muted text on ${surface}`, 'text-muted', surface, TEXT],
  ]),
  ['neutral button label, hovered', 'text', mixed('button-bg', 0.9, 'text'), TEXT],
  ['neutral button label, pressed', 'text', mixed('button-bg', 0.8, 'text'), TEXT],
  ['latched mode, selected tab and open guide entry (page on ink)', 'bg', 'text', TEXT],
  ['success text on a dialog', 'success', 'surface-raised', TEXT],
  [
    '"New best!" badge',
    mixed('success', 0.8, 'text'),
    mixed('success', 0.12, 'surface-raised'),
    TEXT,
  ],
  ['a winning time', mixed('success', 0.8, 'text'), 'surface-raised', TEXT],
  ['History’s Delete', mixed('danger', 0.85, 'text'), 'surface-raised', TEXT],

  // ---- The accent ----
  ['primary button label', 'accent-text', 'accent', TEXT],
  ['primary button label, hovered', 'accent-text', mixed('accent', 0.9, 'text'), TEXT],
  ['primary button label, pressed', 'accent-text', mixed('accent', 0.8, 'text'), TEXT],
  ['danger button label', 'accent-text', mixed('danger', 0.85, 'text'), TEXT],
  ['danger button label, hovered', 'accent-text', mixed('danger', 0.78, 'text'), TEXT],
  ['danger button label, pressed', 'accent-text', mixed('danger', 0.7, 'text'), TEXT],
  ['accent text on the page', 'accent', 'bg', TEXT],
  ['accent text on a dialog', 'accent', 'surface-raised', TEXT],
  ['a hint’s question on the hint bar', mixed('accent', 0.8, 'text'), 'surface', TEXT],
  [
    'a hint’s Show me, hovered',
    mixed('accent', 0.8, 'text'),
    mixed('accent', 0.1, 'surface'),
    TEXT,
  ],
  [
    'a hint’s Show me, pressed',
    mixed('accent', 0.8, 'text'),
    mixed('accent', 0.18, 'surface'),
    TEXT,
  ],

  // ---- Edges of controls, and focus rings ----
  ['key rule against the page', 'key-border', 'bg', NON_TEXT],
  ['key rule against a panel', 'key-border', 'surface', NON_TEXT],
  ['button and field rule against a dialog', 'key-border', 'surface-raised', NON_TEXT],
  ['switch off: track against the page', 'text-muted', 'bg', NON_TEXT],
  ['switch off: knob against the track', 'bg', 'text-muted', NON_TEXT],
  ['switch on: track against the page', 'accent', 'bg', NON_TEXT],
  ['switch on: knob against the track', 'bg', 'accent', NON_TEXT],
  ['switch off, hovered', 'bg', mixed('text-muted', 0.8, 'text'), NON_TEXT],
  ['switch on, hovered', 'bg', mixed('accent', 0.85, 'text'), NON_TEXT],
  ['settings switch off: track against a dialog', 'text-muted', 'surface-raised', NON_TEXT],
  ['settings switch off: knob against the track', 'surface-raised', 'text-muted', NON_TEXT],
  ['settings switch on: track against a dialog', 'accent', 'surface-raised', NON_TEXT],
  ['settings switch on: knob against the track', 'accent-text', 'accent', NON_TEXT],
  ...(['bg', 'surface', 'surface-raised', 'key-bg', 'key-bg-active', 'button-bg'] as const).map(
    (surface): Pair => [`focus ring against ${surface}`, 'accent', surface, NON_TEXT],
  ),

  // ---- The technique guide's worked examples ----
  ['placed digit on where to look', 'digit-given', 'hl-same', TEXT],
  ['placed digit on where it clears', 'digit-given', 'hl-peer', TEXT],
  ['copy of the lone digit (always on paper)', 'accent', 'cell-bg', TEXT],
  ['pattern ring or pivot frame on where to look', 'accent', 'hl-same', NON_TEXT],
  ['pattern ring or pivot frame on where it clears', 'accent', 'hl-peer', NON_TEXT],
  ['pattern ring against its own fill', 'accent', mixed('accent', 0.22, 'cell-bg'), NON_TEXT],
  ['ringed candidate', 'text', mixed('accent', 0.22, 'cell-bg'), TEXT],
  ['forced digit on its disc', 'accent-text', 'accent', TEXT],
  ['chain link on where to look', 'accent', 'hl-same', NON_TEXT],
  ['chain link on paper', 'accent', 'cell-bg', NON_TEXT],
  ...(['cell-bg', 'hl-same', 'hl-peer'] as const).map((fill): Pair => [
    `removed candidate on ${fill}`,
    mixed('danger', 0.8, 'text'),
    fill,
    TEXT,
  ]),
  ['answer frame against its fill', 'success', mixed('success', 0.14, 'cell-bg'), NON_TEXT],
  ['answer frame against where to look', 'success', 'hl-same', NON_TEXT],
  ['answer digit', mixed('success', 0.85, 'text'), mixed('success', 0.14, 'cell-bg'), TEXT],

  // ---- The daily puzzles: their marks, the calendar and the streaks ----
  // A daily's mark is told by its shape, and each shape must be seen: in
  // ink, or the muted ink for one not started, on every surface it sits on
  // (a dialog, a menu, a day under the pointer or a menu item under focus).
  ...(['surface-raised', 'surface'] as const).flatMap((surface): Pair[] => [
    [`a daily's mark on ${surface}`, 'text', surface, NON_TEXT],
    [`a daily not started, its empty mark on ${surface}`, 'text-muted', surface, NON_TEXT],
  ]),
  ['a calendar day’s date on a dialog', 'text', 'surface-raised', TEXT],
  ['a day still to come, its date muted on a dialog', 'text-muted', 'surface-raised', TEXT],
  ['a day under the pointer, its date', 'text', 'surface', TEXT],
  ['today’s ring against a dialog', 'text', 'surface-raised', NON_TEXT],
  // The chosen day is the board's selection: a solid block, knocked out.
  ['the chosen day against a dialog', 'accent', 'surface-raised', NON_TEXT],
  ['the chosen day’s date on its block', 'accent-text', 'accent', TEXT],
  ['the chosen day’s marks, and today’s ring, on its block', 'accent-text', 'accent', NON_TEXT],
  ['a streak’s count on its tile', 'text', 'surface', TEXT],
  ['a streak’s tier and best on its tile', 'text-muted', 'surface', TEXT],
  ['History’s daily label and its rule', 'text', 'surface-raised', TEXT],

  // ---- Show me: the walkthrough ----
  ...(['cell-bg', 'hl-same', 'hl-peer'] as const).flatMap((fill): Pair[] => [
    [`corner marks of the cell being solved on ${fill}`, 'text', fill, NON_TEXT],
    [`dashed strike of an earlier step's removal on ${fill}`, 'text-muted', fill, NON_TEXT],
  ]),
  ['the answer’s digit, under the caption', mixed('success', 0.85, 'text'), 'surface', TEXT],
  ['the answer’s rule against its box', 'success', 'surface', NON_TEXT],
];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
] as const)('the %s palette', (_, tokens) => {
  it.each(PAIRS)('holds %s', (_what, foreground, background, minimum) => {
    const ratio = contrast(resolve(tokens, foreground), resolve(tokens, background));
    expect(ratio).toBeGreaterThanOrEqual(minimum);
  });

  /*
   * The cell fills tell selected, same-number, peer and plain apart by
   * lightness, not hue alone: simulated for each kind of colour-blindness,
   * each ladder (plain cells, and givens) keeps its order and its steps, and
   * a conflict dot or wrong slash keeps its 3:1.
   */
  describe.each(DEFICIENCIES)('seen with %s', (deficiency) => {
    const seen = (colour: Colour) => simulate(resolve(tokens, colour), deficiency);
    const STEPS = [1.25, 1.3, 1.6];

    it.each([
      ['plain', ['cell-bg', 'hl-peer', 'hl-same', 'hl-selected']],
      ['given', ['cell-given-bg', 'hl-peer-given', 'hl-same-given', 'hl-selected-given']],
    ])('keeps the %s ladder in order, a clear step apart', (_ladder, fills) => {
      const colours = fills.map(seen);
      // Light cells darken up the ladder; dark ones lighten.
      const direction = tokens === LIGHT ? -1 : 1;
      const lum = colours.map(luminance);
      for (let i = 1; i < fills.length; i++) {
        expect(Math.sign(lum[i] - lum[i - 1]), `${fills[i - 1]} → ${fills[i]}`).toBe(direction);
        expect(contrast(colours[i], colours[i - 1])).toBeGreaterThanOrEqual(STEPS[i - 1]);
      }
      expect(contrast(colours[3], colours[0])).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it('keeps a danger mark at 3:1 on every cell', () => {
      for (const [name, fill] of ALL_FILLS) {
        expect(contrast(seen('danger'), seen(fill)), name).toBeGreaterThanOrEqual(NON_TEXT);
      }
      for (const fill of ['hl-selected', 'hl-selected-given']) {
        expect(contrast(seen('danger-selected'), seen(fill)), fill).toBeGreaterThanOrEqual(
          NON_TEXT,
        );
      }
    });
  });
});
