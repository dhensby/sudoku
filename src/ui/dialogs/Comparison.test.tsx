import { render, screen, within } from '@testing-library/react';
import type { Assists } from '../../core';
import type { Challenge } from '../../storage/history';
import { Comparison, compareTimes, type ComparisonProps, type TimeComparison } from './Comparison';

const NONE: Assists = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };

const challenger = (name: string | null, seconds: number, assists = NONE): Challenge => ({
  name,
  seconds,
  assists,
});

function renderComparison(overrides: Partial<ComparisonProps> = {}) {
  const props: ComparisonProps = {
    mySeconds: 290,
    myAssists: NONE,
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
    expect(table()).toHaveAccessibleName("Your time and help, and your friend's");
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
  ])('shows a row of help only when either player took it (%s)', (_, mine, theirs, rows) => {
    renderComparison({ myAssists: mine, challenge: challenger('Dan', 323, theirs) });
    expect(
      within(table())
        .getAllByRole('rowheader')
        .map((heading) => heading.textContent),
    ).toEqual(['Time', ...rows]);
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

    rerender(<Comparison mySeconds={335} myAssists={NONE} challenge={challenger('Dan', 323)} />);
    expect(times()[0]).not.toHaveClass('comparison__time--winner');
    expect(times()[1]).toHaveClass('comparison__time--winner');

    rerender(<Comparison mySeconds={323} myAssists={NONE} challenge={challenger('Dan', 323)} />);
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
