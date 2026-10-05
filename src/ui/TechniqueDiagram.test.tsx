import { render, screen } from '@testing-library/react';
import { COL, POPCOUNT, ROW, bit, type TechniqueId } from '../core';
import { TechniqueDiagram } from './TechniqueDiagram';
import { guideExamples, guideIdFor } from './techniqueGuide';

/** A stored worked example, drawn. */
function draw(technique: TechniqueId, label: string | null = null) {
  const example = guideExamples(guideIdFor(technique)).find((e) => e.technique === technique)!;
  const view = render(
    <TechniqueDiagram trace={example.trace} caption={example.caption} label={label} />,
  );
  const marks = (mark: string) => view.container.querySelectorAll(`[data-mark="${mark}"]`);
  const layer = (name: string) => view.container.querySelector(`.technique-diagram__${name}`)!;
  return { ...view, example, marks, layer };
}

/** The candidates drawn, as their digits. */
const candidateText = (layer: Element) =>
  [...layer.querySelectorAll('text')].map((text) => text.textContent);

/** Marked candidates' digits, in order. */
const digits = (marked: NodeListOf<Element>) => [...marked].map((text) => text.textContent).sort();

/** The cell a mark sits in, from its position (40 units a cell). */
const cellOf = (mark: Element) => {
  const [x, y] = ['x', 'y'].map((axis) => Number(mark.getAttribute(axis)));
  return Math.floor(y / 40) * 9 + Math.floor(x / 40);
};

describe('TechniqueDiagram', () => {
  it('is an image named by its caption, which is not read out a second time', () => {
    const { example } = draw('xWing');
    const image = screen.getByRole('img');
    expect(image).toHaveAccessibleName(example.caption);
    // Shown beside the board, but hidden from assistive technology: the image
    // already says it. The key only explains the drawing.
    expect(screen.getByText(example.caption)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('The pattern').closest('ul')).toHaveAttribute('aria-hidden', 'true');
  });

  it('starts its name with the label when an entry has more than one example', () => {
    const { example } = draw('hiddenSingleBox', 'In a box');
    expect(screen.getByRole('img')).toHaveAccessibleName(`In a box. ${example.caption}`);
  });

  it('hides every layer of the drawing from assistive technology', () => {
    const { container } = draw('pointing');
    const layers = container.querySelectorAll('svg > g');
    expect(layers.length).toBeGreaterThanOrEqual(9);
    for (const layer of layers) expect(layer).toHaveAttribute('aria-hidden', 'true');
  });

  it('numbers the rows and columns round the edge, as the captions count them', () => {
    const { layer } = draw('pointing');
    const numbers = candidateText(layer('labels'));
    expect(numbers).toHaveLength(18);
    expect(new Set(numbers)).toEqual(new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9']));
  });

  it('draws every placed digit', () => {
    const { example, layer } = draw('nakedPair');
    const placed = [...example.trace.values].filter((v) => v !== 0).map(String);
    expect(candidateText(layer('digits'))).toEqual(placed);
  });

  describe('a technique about one digit', () => {
    it("shows only that digit's candidates, and inks its placed copies", () => {
      // Pointing: box 1's 8s lie in row 1, clearing row 1, column 4.
      const { example, layer, marks } = draw('pointing');
      const { values, candidates } = example.trace;
      const eights = [...candidates].filter((mask) => mask & bit(8)).length;
      const drawn = candidateText(layer('candidates'));
      expect(drawn).toHaveLength(eights);
      expect(new Set(drawn)).toEqual(new Set(['8']));
      expect(marks('copy')).toHaveLength([...values].filter((v) => v === 8).length);
      expect(screen.getByText('The 8s already placed')).toBeInTheDocument();
      expect(screen.getByText('Candidates shown: 8s only')).toBeInTheDocument();
    });

    it('rings the pattern, strikes what goes and shades the box and the line', () => {
      const { layer, marks } = draw('pointing');
      expect(marks('pattern')).toHaveLength(2);
      expect(layer('rings').querySelectorAll('circle')).toHaveLength(2);
      expect(marks('removed')).toHaveLength(1);
      expect(layer('strikes').querySelectorAll('line')).toHaveLength(1);
      // Box 1 and row 1, sharing three cells, each shaded once: the box where
      // the pattern lies, and more lightly the rest of the row it clears.
      const shades = [...marks('shaded')].map((rect) => rect.getAttribute('data-shade'));
      expect(shades.filter((shade) => shade === 'look')).toHaveLength(9);
      expect(shades.filter((shade) => shade === 'clear')).toHaveLength(6);
      expect(screen.getByText('Where it clears')).toBeInTheDocument();
      // Outlined, for forced colours, house by house: dashed, then dotted.
      expect([...marks('house')].map((rect) => rect.getAttribute('data-shade'))).toEqual([
        'look',
        'clear',
      ]);
    });

    it("shades a fish's base lines as where to look, and its cover lines as where it clears", () => {
      // Swordfish: rows 2, 4 and 7 hold the 8s in columns 2, 3 and 4.
      const { marks } = draw('swordfish');
      const looks = [...marks('shaded')].filter(
        (rect) => rect.getAttribute('data-shade') === 'look',
      );
      const rows = new Set(looks.map((rect) => Number(rect.getAttribute('y')) / 40));
      expect(rows).toEqual(new Set([1, 3, 6]));
      expect(looks).toHaveLength(27);
      expect(marks('shaded')).toHaveLength(27 + 18);
    });
  });

  describe('a single', () => {
    it('writes in the answer, framed, with no candidates of its own', () => {
      const { example, layer, marks } = draw('hiddenSingleBox');
      const { index, digit } = example.trace.step.placement!;
      const answer = marks('answer');
      expect(answer).toHaveLength(1);
      expect(answer[0]).toHaveTextContent(String(digit));
      expect(layer('answer').querySelector('rect')).not.toBeNull();
      // Its pattern is the answer itself: nothing is ringed.
      expect(marks('pattern')).toHaveLength(0);
      const [x, y] = [COL[index] * 40 + 20, ROW[index] * 40 + 20];
      expect(answer[0]).toHaveAttribute('x', String(x));
      expect(answer[0]).toHaveAttribute('y', String(y));
      expect(screen.getByText('The answer')).toBeInTheDocument();
      expect(screen.queryByText('Removed')).not.toBeInTheDocument();
    });

    it("shades a naked single's row, column and box, and shows every candidate", () => {
      const { example, layer, marks } = draw('nakedSingle');
      expect(marks('shaded')).toHaveLength(21);
      const { candidates, step } = example.trace;
      const shown = [...candidates].reduce(
        (total, mask, i) => total + (i === step.placement!.index ? 0 : POPCOUNT[mask]),
        0,
      );
      expect(layer('candidates').querySelectorAll('text')).toHaveLength(shown);
      expect(screen.queryByText(/Candidates shown/)).not.toBeInTheDocument();
    });
  });

  describe('a technique about several digits', () => {
    it('shows every candidate, ringing the pair and striking what it clears', () => {
      // {1, 2} twice in row 7, clearing a 2 and a 1 from the cells between.
      const { example, layer, marks } = draw('nakedPair');
      const shown = [...example.trace.candidates].reduce((n, mask) => n + POPCOUNT[mask], 0);
      expect(layer('candidates').querySelectorAll('text')).toHaveLength(shown);
      expect([...marks('pattern')].map((text) => text.textContent).sort()).toEqual([
        '1',
        '1',
        '2',
        '2',
      ]);
      expect([...marks('removed')].map((text) => text.textContent).sort()).toEqual(['1', '2']);
      expect(marks('shaded')).toHaveLength(9);
      // A subset works within its one house: there is nowhere else it clears.
      expect(screen.queryByText('Where it clears')).not.toBeInTheDocument();
      expect(marks('copy')).toHaveLength(0);
    });

    it('rings a hidden pair and strikes the other candidates in its own cells', () => {
      const { example, marks } = draw('hiddenPair');
      const cells = example.trace.step.pattern.map((p) => p.index);
      const removed = [...marks('removed')];
      expect(removed.map((text) => text.textContent)).toEqual(['9', '9']);
      // Struck where they are ringed: in the pair's own cells.
      const columns = removed.map((text) => Math.floor(Number(text.getAttribute('x')) / 40));
      expect(columns).toEqual(cells.map((i) => COL[i]));
    });

    it("shades a wing's three cells, which share no house", () => {
      const { example, marks } = draw('xyWing');
      const shaded = [...marks('shaded')].map(
        (rect) => (Number(rect.getAttribute('y')) / 40) * 9 + Number(rect.getAttribute('x')) / 40,
      );
      expect(shaded).toEqual(example.trace.step.pattern.map((p) => p.index));
      expect(marks('house')).toHaveLength(0);
      expect(screen.getByText('Where to look')).toBeInTheDocument();
    });

    it("frames a wing's pivot and fills in the digit it forces into a pincer", () => {
      // Pivot r7c4 {5, 7}; pincers r6c4 {3, 5} and r7c2 {3, 7}; the 3 goes
      // from r6c2, which sees both pincers.
      const { layer, marks } = draw('xyWing');
      const pivot = marks('pivot');
      expect(pivot).toHaveLength(1);
      expect(cellOf(pivot[0])).toBe(6 * 9 + 3);
      expect(screen.getByText('The pivot')).toBeInTheDocument();
      // The pivot's two digits and each pincer's link to it, ringed; each
      // pincer's 3, filled in.
      expect(digits(marks('pattern'))).toEqual(['5', '5', '7', '7']);
      expect(digits(marks('forced'))).toEqual(['3', '3']);
      expect(layer('rings').querySelectorAll('circle[data-ring="forced"]')).toHaveLength(2);
      expect(screen.getByText('At least one of these is 3')).toBeInTheDocument();
      expect(digits(marks('removed'))).toEqual(['3']);
      // In forced colours, where the shading goes, the pincers are outlined;
      // the pivot keeps its frame.
      expect([...marks('pincer')].map(cellOf).sort((a, b) => a - b)).toEqual([
        5 * 9 + 3,
        6 * 9 + 1,
      ]);
    });

    it("fills in an XYZ-Wing's forced digit in the pivot as well as the pincers", () => {
      // Pivot r1c6 {3, 8, 9}; pincers r1c7 {8, 9} and r2c6 {3, 9}.
      const { marks } = draw('xyzWing');
      expect(digits(marks('forced'))).toEqual(['9', '9', '9']);
      expect(digits(marks('pattern'))).toEqual(['3', '3', '8', '8']);
      expect(screen.getByText('At least one of these is 9')).toBeInTheDocument();
    });

    it('frames no pivot for a technique that has none', () => {
      const { marks } = draw('nakedTriple');
      expect(marks('pivot')).toHaveLength(0);
      expect(marks('forced')).toHaveLength(0);
      expect(marks('pincer')).toHaveLength(0);
      expect(screen.queryByText('The pivot')).not.toBeInTheDocument();
      expect(screen.queryByText(/At least one of these/)).not.toBeInTheDocument();
    });
  });
});
