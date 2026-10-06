import { fireEvent, render, screen, within } from '@testing-library/react';
import { GUIDE, GUIDE_ORDER, guideExamples, type GuideId } from '../techniqueGuide';
import { TechniquesDialog } from './TechniquesDialog';

function renderGuide(initial?: GuideId) {
  const onClose = vi.fn();
  const view = render(<TechniquesDialog initial={initial} onClose={onClose} />);
  return { ...view, onClose };
}

/** The open entry's title: the one third-level heading. */
const entryHeading = () => screen.getByRole('heading', { level: 3 });

const nav = () => screen.getByRole('navigation', { name: 'Techniques' });

/** The entry button in the list (the phone's picker lists them too, as options). */
const listed = (title: string) => within(nav()).getByRole('button', { name: title });

const picker = () => screen.getByRole('combobox', { name: 'Technique' });

describe('TechniquesDialog', () => {
  it('opens at the first entry, its heading focused, when none is asked for', () => {
    renderGuide();
    expect(screen.getByRole('dialog', { name: 'Solving techniques' })).toBeInTheDocument();
    expect(entryHeading()).toHaveTextContent('Full house');
    expect(entryHeading()).toHaveFocus();
    expect(listed('Full house')).toHaveAttribute('aria-current', 'true');
    expect(picker()).toHaveValue('fullHouse');
  });

  it('opens at the entry a hint asked about, so a screen reader starts there', () => {
    renderGuide('xWing');
    expect(entryHeading()).toHaveTextContent('X-Wing');
    expect(entryHeading()).toHaveFocus();
    expect(listed('X-Wing')).toHaveAttribute('aria-current', 'true');
    expect(listed('Full house')).not.toHaveAttribute('aria-current');
    expect(picker()).toHaveValue('xWing');
    // Focused from script only, never a tab stop of its own.
    expect(entryHeading()).toHaveAttribute('tabindex', '-1');
  });

  it('lists every entry under its tier, easiest first', () => {
    renderGuide();
    const tiers = {
      Easy: ['Full house', 'Hidden single'],
      Medium: ['Naked single', 'Pointing pair or triple', 'Box/line reduction'],
      Hard: ['Naked pair', 'Hidden pair', 'Naked triple', 'Hidden triple'],
      Expert: [
        'X-Wing',
        'Swordfish',
        'XY-Wing',
        'XYZ-Wing',
        'Skyscraper',
        '2-String Kite',
        'XY-Chain',
      ],
    };
    expect(within(nav()).getAllByRole('list')).toHaveLength(4);
    for (const [tier, titles] of Object.entries(tiers)) {
      const list = within(nav()).getByRole('list', { name: tier });
      expect(
        within(list)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(titles);
    }
  });

  it('groups the same entries in the picker for a phone', () => {
    renderGuide();
    const groups = within(picker()).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('label'))).toEqual([
      'Easy',
      'Medium',
      'Hard',
      'Expert',
    ]);
    expect(
      within(picker())
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual(GUIDE_ORDER);
  });

  it('shows the open entry in full: tier, other names, example, how it works and how to spot it', () => {
    renderGuide('xyWing');
    const entry = screen.getByRole('article', { name: 'XY-Wing' });
    expect(within(entry).getByText('Expert').parentElement?.parentElement).toHaveTextContent(
      /^Difficulty: Expert$/,
    );
    expect(within(entry).getByText(/^Also known as/)).toHaveTextContent('Also known as Y-Wing');
    expect(within(entry).getByText(GUIDE.xyWing.summary)).toBeInTheDocument();
    const [example] = guideExamples('xyWing');
    expect(within(entry).getByRole('img')).toHaveAccessibleName(example.caption);
    expect(
      within(entry)
        .getAllByRole('heading', { level: 4 })
        .map((h) => h.textContent),
    ).toEqual(['How it works', 'How to spot it']);
    expect(within(entry).getByText(GUIDE.xyWing.spot)).toBeInTheDocument();
  });

  it('joins other names with commas and "or", and leaves the line out when there are none', () => {
    renderGuide('fullHouse');
    expect(screen.getByText(/^Also known as/)).toHaveTextContent(
      'Also known as last free cell or last digit',
    );
    fireEvent.click(listed('Hidden single'));
    expect(screen.getByText(/^Also known as/)).toHaveTextContent(
      'Also known as last remaining cell, last possible place or pinned digit',
    );
    fireEvent.click(listed('Hidden pair'));
    expect(screen.queryByText(/^Also known as/)).not.toBeInTheDocument();
  });

  it('shows the hidden single in a box and along a line, with the tier of each', () => {
    renderGuide('hiddenSingle');
    const entry = screen.getByRole('article', { name: 'Hidden single' });
    const images = within(entry).getAllByRole('img');
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAccessibleName(/^In a box\. /);
    expect(images[1]).toHaveAccessibleName(/^In a row or column\. /);
    expect(within(entry).getByText(/^Difficulty:/).parentElement).toHaveTextContent(
      'Difficulty: Easy in a box, Medium in a row or column',
    );
  });

  it('moves to an entry chosen from the list, focusing its heading at the top', () => {
    const { container } = renderGuide();
    const body = container.ownerDocument.querySelector('.dialog__body')!;
    const scrolledTo = vi.fn();
    Object.defineProperty(body, 'scrollTop', {
      configurable: true,
      get: () => 400,
      set: scrolledTo,
    });
    fireEvent.click(listed('Swordfish'));
    expect(entryHeading()).toHaveTextContent('Swordfish');
    expect(entryHeading()).toHaveFocus();
    expect(scrolledTo).toHaveBeenCalledWith(0);
    expect(listed('Swordfish')).toHaveAttribute('aria-current', 'true');
  });

  it('walks the guide in order with Previous and Next', () => {
    renderGuide();
    // Nothing before the first entry.
    expect(screen.queryByRole('button', { name: /^Previous/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Hidden single' }));
    expect(entryHeading()).toHaveTextContent('Hidden single');
    expect(entryHeading()).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Previous: Full house' }));
    expect(entryHeading()).toHaveTextContent('Full house');

    fireEvent.click(listed('XY-Chain'));
    expect(screen.getByRole('button', { name: 'Previous: 2-String Kite' })).toBeInTheDocument();
    // Nor after the last.
    expect(screen.queryByRole('button', { name: /^Next/ })).not.toBeInTheDocument();
  });

  it('changes entry from the picker, leaving focus in the picker', () => {
    renderGuide();
    picker().focus();
    fireEvent.change(picker(), { target: { value: 'nakedTriple' } });
    expect(entryHeading()).toHaveTextContent('Naked triple');
    expect(listed('Naked triple')).toHaveAttribute('aria-current', 'true');
    // Arrowing through a closed select changes it at every step; focus
    // stays where the keys are.
    expect(picker()).toHaveFocus();
  });

  it('closes from its close button and from Escape', () => {
    const { onClose } = renderGuide();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
