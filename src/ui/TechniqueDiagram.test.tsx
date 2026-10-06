import { render, screen } from '@testing-library/react';
import { COL, POPCOUNT, ROW, bit, explainCell, type TechniqueId } from '../core';
import { STUCK_ON_A_HIDDEN_PAIR, stuckOnAHiddenPair } from '../test/logic-fixtures';
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

/** The cell a point of a mark sits in, from its coordinates (40 units a cell). */
const cellAt = (mark: Element, xAttr: string, yAttr: string) => {
  const [x, y] = [xAttr, yAttr].map((axis) => Number(mark.getAttribute(axis)));
  return Math.floor(y / 40) * 9 + Math.floor(x / 40);
};

/** The cell a mark sits in. */
const cellOf = (mark: Element) => cellAt(mark, 'x', 'y');

/** The cells a line runs between. */
const endsOf = (line: Element) => [cellAt(line, 'x1', 'y1'), cellAt(line, 'x2', 'y2')];

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

  describe('a chain', () => {
    // Skyscraper: columns 3 and 4 hold their 7s in rows 2 and 6, and rows 2
    // and 5; the 7 goes from r5c1, which sees both tops.
    const [top1, base1, base2, top2] = [5 * 9 + 2, 1 * 9 + 2, 1 * 9 + 3, 4 * 9 + 3];

    it('links its candidates end to end: solid, dashed, solid', () => {
      const { layer } = draw('skyscraper');
      const links = [...layer('links').querySelectorAll('line')];
      expect(links.map((line) => line.getAttribute('data-link'))).toEqual([
        'strong',
        'weak',
        'strong',
      ]);
      expect(links.map(endsOf)).toEqual([
        [top1, base1],
        [base1, base2],
        [base2, top2],
      ]);
      expect(screen.getByText("If one isn't 7, the other is")).toBeInTheDocument();
      expect(screen.getByText("If one is 7, the other isn't")).toBeInTheDocument();
    });

    it('fills in both ends, one of which is the digit, and rings the cells between', () => {
      const { layer, marks } = draw('skyscraper');
      expect([...marks('forced')].map(cellOf)).toEqual([top2, top1]);
      expect([...marks('pattern')].map(cellOf)).toEqual([base1, base2]);
      expect(layer('rings').querySelectorAll('circle[data-ring="forced"]')).toHaveLength(2);
      expect(screen.getByText('At least one of these is 7')).toBeInTheDocument();
      expect([...marks('removed')].map(cellOf)).toEqual([4 * 9]);
    });

    it('shades the lines its strong links lie in, and nothing for the weak link', () => {
      const { marks } = draw('skyscraper');
      const shaded = [...marks('shaded')];
      expect(shaded).toHaveLength(18);
      expect(shaded.every((rect) => rect.getAttribute('data-shade') === 'look')).toBe(true);
      const columns = new Set(shaded.map((rect) => Number(rect.getAttribute('x')) / 40));
      expect(columns).toEqual(new Set([2, 3]));
      expect(marks('house')).toHaveLength(2);
      expect(screen.queryByText('Where it clears')).not.toBeInTheDocument();
    });
  });

  describe('an XY-Chain', () => {
    // r1c3 {1, 6} – r1c1 {1, 3} – r2c1 {3, 8} – r2c4 {6, 8}: if r1c3 isn't
    // 6, r2c4 is, so the 6 goes from r1c4.
    const cells = [2, 0, 9, 12];

    it('shades its cells, which share no house, and links them on the digits they share', () => {
      const { layer, marks } = draw('xyChain');
      expect([...marks('shaded')].map(cellOf)).toEqual(cells);
      expect([...marks('chain-cell')].map(cellOf)).toEqual(cells);
      expect(marks('house')).toHaveLength(0);
      // Each cell is a strong link of its own; the drawn links are the weak
      // ones between them, on 1, 3 and 8.
      const links = [...layer('links').querySelectorAll('line')];
      expect(links.map((line) => line.getAttribute('data-link'))).toEqual(['weak', 'weak', 'weak']);
      expect(links.map(endsOf)).toEqual([
        [2, 0],
        [0, 9],
        [9, 12],
      ]);
      expect(screen.getByText("Can't both be the digit they share")).toBeInTheDocument();
      expect(screen.queryByText(/the other is$/)).not.toBeInTheDocument();
    });

    it('fills in the digit at both ends and rings the rest of its cells', () => {
      const { marks } = draw('xyChain');
      expect(digits(marks('forced'))).toEqual(['6', '6']);
      expect([...marks('forced')].map(cellOf).sort((a, b) => a - b)).toEqual([2, 12]);
      expect(digits(marks('pattern'))).toEqual(['1', '1', '3', '3', '8', '8']);
      expect(screen.getByText('At least one of these is 6')).toBeInTheDocument();
      expect([...marks('removed')].map(cellOf)).toEqual([3]);
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

    it('draws no links for a technique that is not a chain', () => {
      const { layer } = draw('xyWing');
      expect(layer('links').querySelectorAll('line')).toHaveLength(0);
      expect(screen.queryByText(/the other is/)).not.toBeInTheDocument();
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

  describe('in a walkthrough', () => {
    // The steps that solve row 5, column 2 of the board a player was stuck
    // on: a hidden pair in column 6, a pointing pair in box 5, and a naked
    // single.
    const { values, solution } = stuckOnAHiddenPair();
    const { target, steps } = explainCell(values, STUCK_ON_A_HIDDEN_PAIR.target, solution)!;

    function drawStep(k: number, props: Partial<Parameters<typeof TechniqueDiagram>[0]> = {}) {
      const view = render(
        <TechniqueDiagram trace={steps[k]} caption="A step." target={target} {...props} />,
      );
      const layer = (name: string) => view.container.querySelector(`.technique-diagram__${name}`);
      return { ...view, layer };
    }

    it('marks the cell being solved at its corners, and inks its row and column numbers', () => {
      const { container, layer } = drawStep(0);
      const path = layer('target')!.querySelector('path')!;
      // Four corner marks, each an L of two arms, inside row 5, column 2.
      const moves = path.getAttribute('d')!.match(/M[\d.]+ [\d.]+/g)!;
      expect(moves).toHaveLength(4);
      for (const move of moves) {
        const [x, y] = move.slice(1).split(' ').map(Number);
        expect(Math.floor(y / 40) * 9 + Math.floor(x / 40)).toBe(target);
      }
      const inked = [...container.querySelectorAll('[data-mark="target"]')];
      expect(inked.map((label) => label.textContent)).toEqual(['2', '5']);
      expect(screen.getByText('The cell being solved')).toBeInTheDocument();
    });

    it('marks no cell outside a walkthrough', () => {
      const { container, layer } = drawStep(0, { target: null });
      expect(layer('target')).toBeNull();
      expect(container.querySelectorAll('[data-mark="target"]')).toHaveLength(0);
      expect(screen.queryByText('The cell being solved')).not.toBeInTheDocument();
    });

    it('strikes faintly what an earlier step removed, of the digits it shows', () => {
      // Step 2, the pointing pair, needs the 5 the hidden pair took from row
      // 4, column 6; the 2 it took from row 6, column 6 is not a 5, so it is
      // not drawn on a board of 5s.
      const ruledOut = [
        { index: 32, mask: bit(5) },
        { index: 50, mask: bit(2) },
      ];
      const { layer } = drawStep(1, { ruledOut });
      const ghosts = layer('ruled-out')!;
      const texts = [...ghosts.querySelectorAll('text')];
      expect(texts.map((text) => text.textContent)).toEqual(['5']);
      expect(texts.map(cellOf)).toEqual([32]);
      expect(texts[0]).toHaveAttribute('data-mark', 'ruled-out');
      expect(ghosts.querySelectorAll('line')).toHaveLength(1);
      expect(screen.getByText('Removed in an earlier step')).toBeInTheDocument();
    });

    it('says nothing of earlier steps when none is drawn', () => {
      const { layer } = drawStep(1);
      expect(layer('ruled-out')!.childElementCount).toBe(0);
      expect(screen.queryByText('Removed in an earlier step')).not.toBeInTheDocument();
    });

    it('frames the answer inside the corner marks when it is written in the cell being solved', () => {
      const inset = (view: ReturnType<typeof drawStep>) =>
        Number(view.layer('answer')!.querySelector('rect')!.getAttribute('x')) - COL[target] * 40;
      const last = drawStep(2);
      expect(inset(last)).toBe(4.5);
      last.unmount();
      expect(inset(drawStep(2, { target: null }))).toBe(2.5);
    });

    it('says what the step comes to after the caption, and before the key', () => {
      drawStep(2, { conclusion: <p>The answer: 8.</p> });
      const conclusion = screen.getByText('The answer: 8.');
      expect(conclusion).not.toHaveAttribute('aria-hidden');
      const caption = screen.getByText('A step.');
      expect(caption.nextElementSibling).toBe(conclusion);
      expect(conclusion.nextElementSibling?.tagName).toBe('UL');
    });
  });
});
