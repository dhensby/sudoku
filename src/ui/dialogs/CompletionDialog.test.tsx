import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Challenge, DifficultyStats } from '../../storage/history';
import {
  CompletionDialog,
  compareTimes,
  type CompletionDialogProps,
  type TimeComparison,
} from './CompletionDialog';

const NONE = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
const STATS: DifficultyStats = { played: 9, solved: 7, bestMs: 241_000, averageMs: 330_500 };

function renderCompletion(overrides: Partial<CompletionDialogProps> = {}) {
  const props: CompletionDialogProps = {
    difficulty: 'hard',
    elapsedMs: 323_900,
    assists: NONE,
    isNewBest: false,
    stats: STATS,
    challenge: null,
    onShare: vi.fn(),
    onNewGame: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<CompletionDialog {...props} />);
  return { ...view, props };
}

const dialog = () => screen.getByRole('dialog', { name: 'Solved!' });
const challenger = (name: string | null, seconds: number, assists = NONE): Challenge => ({
  name,
  seconds,
  assists,
});

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

describe('CompletionDialog', () => {
  it('shows the tier and the final time, floored like every time on screen', () => {
    renderCompletion();
    expect(within(dialog()).getByText('Hard')).toBeInTheDocument();
    expect(within(dialog()).getByText('5:23')).toBeInTheDocument();
  });

  it('reads the result as the description, since focus opens past it', () => {
    renderCompletion({ isNewBest: true });
    expect(dialog()).toHaveAccessibleDescription(/Hard\s*5:23\s*New best!/);
  });

  it('opens on "Share your time"', () => {
    renderCompletion();
    expect(screen.getByRole('button', { name: 'Share your time' })).toHaveFocus();
  });

  it('celebrates a new best only when told to', () => {
    const { rerender, props } = renderCompletion();
    expect(screen.queryByText('New best!')).toBeNull();
    rerender(<CompletionDialog {...props} isNewBest />);
    expect(screen.getByText('New best!')).toBeInTheDocument();
  });

  it('says a replay’s time does not count towards the best or average, and never calls it a new best', () => {
    const { rerender, props } = renderCompletion();
    expect(screen.queryByText(/played this puzzle before/)).toBeNull();
    rerender(<CompletionDialog {...props} isReplay isNewBest />);
    expect(
      screen.getByText(
        "You'd played this puzzle before, so this time doesn't count towards your best or average.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('New best!')).toBeNull();
    // Read on the way in, with the time.
    expect(dialog()).toHaveAccessibleDescription(/5:23.*played this puzzle before/);
  });

  it('offers a replay’s puzzle to share rather than its time', () => {
    const { props } = renderCompletion({ isReplay: true });
    expect(screen.queryByRole('button', { name: 'Share your time' })).toBeNull();
    const share = screen.getByRole('button', { name: 'Share puzzle' });
    expect(share).toHaveFocus();
    fireEvent.click(share);
    expect(props.onShare).toHaveBeenCalledOnce();
  });

  it('still shows how a replay went against the link it came from', () => {
    renderCompletion({ isReplay: true, challenge: challenger('Dan', 400) });
    expect(document.querySelector('.comparison__verdict')).toHaveTextContent(
      'You were 1:17 faster than Dan!',
    );
  });

  it('says what help the time came with, and nothing for an unaided one', () => {
    const { rerender, props } = renderCompletion();
    expect(screen.queryByText(/^With /)).toBeNull();
    rerender(<CompletionDialog {...props} assists={{ ...NONE, autoCandidates: true, hints: 2 }} />);
    expect(screen.getByText('With auto candidates, 2 hints')).toBeInTheDocument();
  });

  it("shows the tier's stats, with dashes where there is no time yet", () => {
    const { rerender, props } = renderCompletion();
    const stats = screen.getByRole('region', { name: 'Your Hard record' });
    expect(within(stats).getByText('Solved').nextElementSibling).toHaveTextContent('7');
    expect(within(stats).getByText('Best').nextElementSibling).toHaveTextContent('4:01');
    expect(within(stats).getByText('Average').nextElementSibling).toHaveTextContent('5:30');

    // Every solve had reveals: there is no best or average, and 0:00 would
    // read as an impossible record.
    rerender(<CompletionDialog {...props} stats={{ ...STATS, bestMs: null, averageMs: null }} />);
    expect(within(stats).getByText('Best').nextElementSibling).toHaveTextContent('—');
    expect(within(stats).getByText('Average').nextElementSibling).toHaveTextContent('—');
  });

  it('fires its actions', () => {
    const { props } = renderCompletion();
    fireEvent.click(screen.getByRole('button', { name: 'Share your time' }));
    expect(props.onShare).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(props.onNewGame).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('shows no head-to-head without a challenge', () => {
    renderCompletion();
    expect(screen.queryByRole('region', { name: 'Head to head' })).toBeNull();
  });

  describe('against a challenge', () => {
    it('says by how much the player won, naming the challenger', () => {
      renderCompletion({ elapsedMs: 290_400, challenge: challenger('Dan', 323) });
      const versus = screen.getByRole('region', { name: 'Head to head' });
      expect(versus).toHaveTextContent('You were 0:33 faster than Dan!');
      const [you, them] = within(versus).getAllByRole('term');
      expect(you).toHaveTextContent('You');
      expect(you.nextElementSibling).toHaveTextContent('4:50');
      expect(them).toHaveTextContent('Dan');
      expect(them.nextElementSibling).toHaveTextContent('5:23');
      // The verdict is part of what focus skips on the way to Share.
      expect(dialog()).toHaveAccessibleDescription(/You were 0:33 faster than Dan!/);
    });

    it('keeps the name in its own direction', () => {
      // A right-to-left name would otherwise pull the time beside it into its
      // own direction, so "5:23" could read as "32:5".
      renderCompletion({ challenge: challenger('דן', 400) });
      for (const name of screen.getAllByText('דן')) expect(name.tagName).toBe('BDI');
    });

    it('offers a long name in full on hover, where a tie leaves the verdict nameless', () => {
      const name = 'Bartholomew-Fitzgerald';
      renderCompletion({ elapsedMs: 323_000, challenge: challenger(name, 323) });
      const versus = screen.getByRole('region', { name: 'Head to head' });
      const [you, them] = within(versus).getAllByRole('term');
      expect(them).toHaveAttribute('title', name);
      expect(you).not.toHaveAttribute('title');
    });

    it('owns up to a loss', () => {
      renderCompletion({ elapsedMs: 335_000, challenge: challenger('Dan', 323) });
      expect(screen.getByRole('region', { name: 'Head to head' })).toHaveTextContent(
        'Dan was 0:12 faster.',
      );
    });

    it('calls a draw on whole seconds', () => {
      renderCompletion({ elapsedMs: 323_999, challenge: challenger('Dan', 323) });
      expect(screen.getByRole('region', { name: 'Head to head' })).toHaveTextContent(
        'A dead heat!',
      );
    });

    it.each([
      [290_000, 'You were 0:33 faster than your friend!'],
      [335_000, 'Your friend was 0:12 faster.'],
    ])('calls a nameless challenger "your friend" (%sms)', (elapsedMs, verdict) => {
      renderCompletion({ elapsedMs, challenge: challenger(null, 323) });
      const versus = screen.getByRole('region', { name: 'Head to head' });
      expect(versus).toHaveTextContent(verdict);
      expect(within(versus).getByText('Your friend')).toBeInTheDocument();
    });

    it("shows the help the challenger's time came with", () => {
      const { rerender, props } = renderCompletion({ challenge: challenger('Dan', 323) });
      expect(screen.getByRole('region', { name: 'Head to head' })).not.toHaveTextContent('With');
      rerender(
        <CompletionDialog {...props} challenge={challenger('Dan', 323, { ...NONE, hints: 1 })} />,
      );
      expect(screen.getByRole('region', { name: 'Head to head' })).toHaveTextContent('With 1 hint');
    });
  });
});
