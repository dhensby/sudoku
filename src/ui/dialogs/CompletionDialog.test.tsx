import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Challenge, DifficultyStats } from '../../storage/history';
import { CompletionDialog, type CompletionDialogProps } from './CompletionDialog';

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

  it.each([
    [{ values: 0, candidates: 0 }, 'No mistakes'],
    [{ values: 1, candidates: 0 }, '1 mistake'],
    [{ values: 3, candidates: 0 }, '3 mistakes'],
    [{ values: 2, candidates: 1 }, '2 mistakes · 1 candidate mistake'],
    [{ values: 0, candidates: 2 }, '2 candidate mistakes'],
  ])('says how clean the solve was: %o reads "%s"', (mistakes, text) => {
    renderCompletion({ mistakes });
    expect(within(dialog()).getByText(text)).toHaveClass('result__mistakes');
    // Read on the way in, with the time.
    expect(dialog()).toHaveAccessibleDescription(new RegExp(`5:23\\s*${text}`));
  });

  it.each([
    ['not known', { mistakes: null }],
    ['not given', {}],
  ])('says nothing of mistakes %s — never "No mistakes"', (_, overrides) => {
    renderCompletion(overrides);
    expect(within(dialog()).queryByText(/mistake/)).toBeNull();
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
      const [you, them] = within(versus).getAllByRole('columnheader');
      expect(you).toHaveTextContent('You');
      expect(them).toHaveTextContent('Dan');
      expect(within(versus).getByRole('row', { name: /^Time/ })).toHaveTextContent('Time4:505:23');
      // The verdict is part of what focus skips on the way to Share.
      expect(dialog()).toHaveAccessibleDescription(/You were 0:33 faster than Dan!/);
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

    it("sets the player's help against the challenger's, row by row, and keeps the hero's line", () => {
      renderCompletion({
        assists: { ...NONE, hints: 1 },
        challenge: challenger('Dan', 323, { ...NONE, autoCandidates: true }),
      });
      const versus = screen.getByRole('region', { name: 'Head to head' });
      expect(within(versus).getByRole('row', { name: /^Auto candidates/ })).toHaveTextContent(
        'Auto candidatesNoYes',
      );
      expect(within(versus).getByRole('row', { name: /^Hints/ })).toHaveTextContent('Hints10');
      expect(document.querySelector('.result__assists')).toHaveTextContent('With 1 hint');
    });

    it('says when neither player took any help', () => {
      renderCompletion({ challenge: challenger('Dan', 323) });
      expect(screen.getByRole('region', { name: 'Head to head' })).toHaveTextContent(
        'Neither of you took any help.',
      );
    });
  });

  describe('CompletionDialog for a daily', () => {
    const daily = (streak: NonNullable<CompletionDialogProps['daily']>['streak']) => ({
      date: '2026-10-13',
      today: '2026-10-13',
      streak,
    });

    it('names the daily in place of the tier', () => {
      renderCompletion({ daily: daily({ kind: 'started' }) });
      expect(within(dialog()).getByText('Daily · 13 Oct · Hard')).toBeInTheDocument();
      expect(within(dialog()).queryByText(/^Hard$/)).not.toBeInTheDocument();
    });

    it.each([
      [{ kind: 'streak', days: 5 } as const, 'Hard streak: 5 days'],
      [{ kind: 'streak', days: 1 } as const, 'Hard streak: 1 day'],
      [{ kind: 'started' } as const, 'That starts a Hard streak'],
      [{ kind: 'counted' } as const, 'Begun on its day, so it counts towards your Hard streak'],
      [
        { kind: 'later' } as const,
        "Played on a later day, so it doesn't count towards your streak",
      ],
      [
        { kind: 'early' } as const,
        "Started before its day began here, so it doesn't count towards your streak",
      ],
    ])('says what it did for the streak: %o', (streak, text) => {
      renderCompletion({ daily: daily(streak) });
      const line = within(dialog()).getByText(text);
      // Counted, it is led by the calendar's own mark for a day solved on it.
      expect(line.querySelector('.daily-mark--solved-on-the-day') !== null).toBe(
        streak.kind !== 'later' && streak.kind !== 'early',
      );
      // Read with the time as focus lands on Share.
      expect(within(dialog()).getByRole('button', { name: 'Share your time' })).toBeInTheDocument();
      expect(dialog()).toHaveAccessibleDescription(expect.stringContaining(text));
    });

    it('says nothing of streaks for a random puzzle', () => {
      renderCompletion();
      expect(within(dialog()).queryByText(/streak/)).not.toBeInTheDocument();
    });
  });
});
