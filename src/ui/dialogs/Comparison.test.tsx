import { render, screen, within } from '@testing-library/react';
import type { Assists, MistakeTally } from '../../core';
import type { Challenge } from '../../storage/history';
import { Comparison, compareTimes, type ComparisonProps, type TimeComparison } from './Comparison';

const NONE: Assists = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };

const challenger = (
  name: string | null,
  seconds: number,
  assists = NONE,
  mistakes?: MistakeTally,
): Challenge => ({
  name,
  seconds,
  assists,
  ...(mistakes === undefined ? {} : { mistakes }),
});

const tally = (values: number, candidates = 0): MistakeTally => ({ values, candidates });

function renderComparison(overrides: Partial<ComparisonProps> = {}) {
  const props: ComparisonProps = {
    mySeconds: 290,
    myAssists: NONE,
    myMistakes: null,
    challenge: challenger('Dan', 323),
    ...overrides,
  };
  return render(<Comparison {...props} />);
}

const region = () => screen.getByRole('region', { name: 'Head to head' });
const table = () => within(region()).getByRole('table');

/** The table as text, row by row and cell by cell — headings included. */
const cellsByRow = () =>
  within(table())
    .getAllByRole('row')
    .map((row) => Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent));

/** The time cells, the player's first. */
const times = () => {
  const [, mine, theirs] = within(table()).getByRole('row', { name: /^Time/ }).children;
  return [mine, theirs];
};

describe('compareTimes', () => {
  it.each<[number, number, TimeComparison]>([
    [290, 323, { result: 'faster', differenceSeconds: 33 }],
    [335, 323, { result: 'slower', differenceSeconds: 12 }],
    [323, 323, { result: 'tie', differenceSeconds: 0 }],
    // Whole seconds: a clock's 5:23.9 and a link's 5:23 are a dead heat, not
    // a defeat by a fraction nobody was shown.
    [323.9, 323, { result: 'tie', differenceSeconds: 0 }],
    [1, 3600, { result: 'faster', differenceSeconds: 3599 }],
  ])('compares my %ss with their %ss', (mine, theirs, expected) => {
    expect(compareTimes(mine, theirs)).toEqual(expected);
  });
});

describe('Comparison', () => {
  it('sets the two times side by side, a column for each player', () => {
    renderComparison({ myAssists: { ...NONE, hints: 1 } });
    expect(cellsByRow().slice(0, 2)).toEqual([
      ['', 'You', 'Dan'],
      ['Time', '4:50', '5:23'],
    ]);
  });

  it('lets an hour-long time break after its hours, and nowhere inside the minutes and seconds', () => {
    // A link can claim thousands of hours, more than a phone's column holds.
    renderComparison({ mySeconds: 35084, challenge: challenger('Dan', 9_999_999) });
    const [mine, theirs] = times();
    expect(mine).toHaveTextContent(/^9:44:44$/);
    expect(mine.innerHTML).toBe('9:<wbr>44:44');
    expect(theirs).toHaveTextContent(/^2777:46:39$/);
    expect(theirs.innerHTML).toBe('2777:<wbr>46:39');
  });

  it('gives a time under an hour no break at all', () => {
    renderComparison({ mySeconds: 3599 });
    expect(times()[0].innerHTML).toBe('59:59');
    expect(times()[1].innerHTML).toBe('5:23');
  });

  it('is a table a screen reader can walk: named, with column and row headings', () => {
    renderComparison({ myAssists: { ...NONE, hints: 1 } });
    expect(table()).toHaveAccessibleName("Your result and your friend's");
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((heading) => heading.textContent),
    ).toEqual(['You', 'Dan']);
    expect(
      within(table())
        .getAllByRole('rowheader')
        .map((heading) => heading.textContent),
    ).toEqual(['Time', 'Hints']);
    // Each value is read with its row and its player, in that order.
    for (const heading of within(table()).getAllByRole('columnheader')) {
      expect(heading).toHaveAttribute('scope', 'col');
    }
    for (const heading of within(table()).getAllByRole('rowheader')) {
      expect(heading).toHaveAttribute('scope', 'row');
    }
  });

  it('puts each kind of help on one line, so the two players read straight across', () => {
    renderComparison({
      myAssists: { autoCandidates: true, hints: 2, checks: 0, reveals: 1 },
      challenge: challenger('Dan', 323, { autoCandidates: false, hints: 1, checks: 3, reveals: 0 }),
    });
    expect(cellsByRow()).toEqual([
      ['', 'You', 'Dan'],
      ['Time', '4:50', '5:23'],
      ['Auto candidates', 'Yes', 'No'],
      ['Hints', '2', '1'],
      ['Checks', '0', '3'],
      ['Reveals', '1', '0'],
    ]);
    expect(within(region()).queryByText('Neither of you took any help.')).toBeNull();
  });

  it.each<[string, Assists, Assists, string[]]>([
    ['auto candidates on my side', { ...NONE, autoCandidates: true }, NONE, ['Auto candidates']],
    ['auto candidates on theirs', NONE, { ...NONE, autoCandidates: true }, ['Auto candidates']],
    [
      'a check of mine and a reveal of theirs',
      { ...NONE, checks: 1 },
      { ...NONE, reveals: 2 },
      ['Checks', 'Reveals'],
    ],
    ['hints on both sides', { ...NONE, hints: 1 }, { ...NONE, hints: 4 }, ['Hints']],
    [
      'guesses checked as entered on my side',
      { ...NONE, checkGuesses: true },
      NONE,
      ['Checked as entered'],
    ],
  ])('shows a row of help only when either player took it (%s)', (_, mine, theirs, rows) => {
    renderComparison({ myAssists: mine, challenge: challenger('Dan', 323, theirs) });
    expect(
      within(table())
        .getAllByRole('rowheader')
        .map((heading) => heading.textContent),
    ).toEqual(['Time', ...rows]);
  });

  it('sets guesses checked as entered on a row of its own, after auto candidates, as Yes or No', () => {
    renderComparison({
      myAssists: { ...NONE, autoCandidates: true },
      challenge: challenger('Dan', 323, { ...NONE, checkGuesses: true, hints: 1 }),
    });
    expect(cellsByRow().slice(2)).toEqual([
      ['Auto candidates', 'Yes', 'No'],
      ['Checked as entered', 'No', 'Yes'],
      ['Hints', '0', '1'],
    ]);
  });

  it('says so, in place of the help rows and across both columns, when neither player took any', () => {
    renderComparison();
    expect(cellsByRow()).toEqual([
      ['', 'You', 'Dan'],
      ['Time', '4:50', '5:23'],
      ['Neither of you took any help.'],
    ]);
    expect(
      within(table()).getByRole('cell', { name: 'Neither of you took any help.' }),
    ).toHaveAttribute('colspan', '3');
    expect(within(table()).getAllByRole('rowheader')).toHaveLength(1);
  });

  it('marks the faster time, and neither on a dead heat', () => {
    const { rerender } = renderComparison({ mySeconds: 290 });
    expect(times()[0]).toHaveClass('comparison__time--winner');
    expect(times()[1]).not.toHaveClass('comparison__time--winner');

    const at = (mySeconds: number) => (
      <Comparison
        mySeconds={mySeconds}
        myAssists={NONE}
        myMistakes={null}
        challenge={challenger('Dan', 323)}
      />
    );
    rerender(at(335));
    expect(times()[0]).not.toHaveClass('comparison__time--winner');
    expect(times()[1]).toHaveClass('comparison__time--winner');

    rerender(at(323));
    for (const time of times()) expect(time).not.toHaveClass('comparison__time--winner');
  });

  it('decides on time alone, whatever help either player took', () => {
    renderComparison({
      mySeconds: 290,
      myAssists: { autoCandidates: true, hints: 5, checks: 2, reveals: 3 },
      challenge: challenger('Dan', 323),
    });
    expect(region()).toHaveTextContent('You were 0:33 faster than Dan!');
    expect(times()[0]).toHaveClass('comparison__time--winner');
  });

  it('decides on time alone, whatever mistakes either player made', () => {
    renderComparison({
      mySeconds: 290,
      myMistakes: tally(9, 4),
      challenge: challenger('Dan', 323, NONE, tally(0)),
    });
    expect(region()).toHaveTextContent('You were 0:33 faster than Dan!');
    expect(times()[0]).toHaveClass('comparison__time--winner');
  });

  describe('mistakes', () => {
    /** The cells of one row, by its heading; undefined when it is not shown. */
    const row = (label: string) => cellsByRow().find((cells) => cells[0] === label);

    it('puts each kind on one line, the two players side by side, after the help', () => {
      renderComparison({
        myAssists: { ...NONE, hints: 2 },
        myMistakes: tally(1, 2),
        challenge: challenger('Dan', 323, { ...NONE, hints: 1 }, tally(3)),
      });
      expect(cellsByRow()).toEqual([
        ['', 'You', 'Dan'],
        ['Time', '4:50', '5:23'],
        ['Hints', '2', '1'],
        ['Mistakes', '1', '3'],
        ['Candidate mistakes', '2', '0'],
      ]);
    });

    it('keeps "no help" where the help would be, above the mistakes', () => {
      renderComparison({ myMistakes: tally(0), challenge: challenger('Dan', 323, NONE, tally(2)) });
      expect(cellsByRow().slice(2)).toEqual([
        ['Neither of you took any help.'],
        ['Mistakes', '0', '2'],
      ]);
    });

    it('shows a clean solve as 0 against a friend’s, rather than hiding the row', () => {
      renderComparison({ myMistakes: tally(0), challenge: challenger('Dan', 323, NONE, tally(0)) });
      expect(row('Mistakes')).toEqual(['Mistakes', '0', '0']);
      // Candidate mistakes only once either player made one, as the Solved dialog names them.
      expect(row('Candidate mistakes')).toBeUndefined();
    });

    it.each<[string, MistakeTally | null, MistakeTally | undefined]>([
      ['mine', tally(0, 1), undefined],
      ['theirs', null, tally(2, 3)],
    ])('shows candidate mistakes once either player made one (%s)', (_label, mine, theirs) => {
      renderComparison({ myMistakes: mine, challenge: challenger('Dan', 323, NONE, theirs) });
      expect(row('Candidate mistakes')).toBeDefined();
    });

    it('shows a count not known as a dash a screen reader hears as "not recorded", never as 0', () => {
      // An old link: it says nothing of the friend's mistakes.
      renderComparison({ myMistakes: tally(1, 1), challenge: challenger('Dan', 323) });
      expect(row('Mistakes')).toEqual(['Mistakes', '1', '—not recorded']);
      expect(row('Candidate mistakes')).toEqual(['Candidate mistakes', '1', '—not recorded']);
      const [, , theirs] = within(table()).getByRole('row', { name: /^Mistakes/ }).children;
      expect(within(theirs as HTMLElement).getByText('—')).toHaveAttribute('aria-hidden', 'true');
      expect(within(theirs as HTMLElement).getByText('not recorded')).toHaveClass(
        'visually-hidden',
      );
    });

    it('shows mine as not recorded against a friend’s known count', () => {
      renderComparison({ myMistakes: null, challenge: challenger('Dan', 323, NONE, tally(0)) });
      expect(row('Mistakes')).toEqual(['Mistakes', '—not recorded', '0']);
    });

    it('says nothing of mistakes when neither count is known', () => {
      renderComparison({ myMistakes: null, challenge: challenger('Dan', 323) });
      expect(cellsByRow()).toEqual([
        ['', 'You', 'Dan'],
        ['Time', '4:50', '5:23'],
        ['Neither of you took any help.'],
      ]);
      expect(table()).not.toHaveTextContent(/mistake/i);
    });
  });

  it.each([
    [290, 'You were 0:33 faster than Dan!'],
    [335, 'Dan was 0:12 faster.'],
    [323, 'A dead heat!'],
  ])(
    'gives the verdict for my %ss against 5:23, under an id a dialog can point at',
    (mine, verdict) => {
      renderComparison({ mySeconds: mine, verdictId: 'verdict' });
      expect(document.getElementById('verdict')).toHaveTextContent(verdict);
    },
  );

  it.each([
    [290, 'You were 0:33 faster than your friend!'],
    [335, 'Your friend was 0:12 faster.'],
  ])(
    'heads a nameless challenger\'s column "Your friend", with nothing to hover for (my %ss)',
    (mine, verdict) => {
      renderComparison({ mySeconds: mine, challenge: challenger(null, 323) });
      const [, theirs] = within(table()).getAllByRole('columnheader');
      expect(theirs).toHaveTextContent('Your friend');
      expect(theirs).not.toHaveAttribute('title');
      expect(region()).toHaveTextContent(verdict);
    },
  );

  it('offers a long name in full on hover, where a tie leaves the verdict nameless', () => {
    const name = 'Bartholomew-Fitzgerald';
    renderComparison({ mySeconds: 323, challenge: challenger(name, 323) });
    const [you, them] = within(table()).getAllByRole('columnheader');
    expect(them).toHaveAttribute('title', name);
    expect(you).not.toHaveAttribute('title');
    expect(them).toHaveClass('comparison__who');
  });

  it('keeps a right-to-left name in its own direction, inside its own heading', () => {
    // A right-to-left name would otherwise pull the time beside it into its
    // own direction, so "5:23" could read as "32:5".
    renderComparison({ challenge: challenger('אלכסנדרה בת־שבע', 323, { ...NONE, hints: 1 }) });
    const names = within(region()).getAllByText('אלכסנדרה בת־שבע');
    for (const name of names) expect(name.tagName).toBe('BDI');
    const [, them] = within(table()).getAllByRole('columnheader');
    expect(them.firstElementChild?.tagName).toBe('BDI');
    expect(them).toHaveAttribute('title', 'אלכסנדרה בת־שבע');
    // The rows still line up: the name moves nothing out of its column.
    expect(cellsByRow()[2]).toEqual(['Hints', '0', '1']);
  });
});
