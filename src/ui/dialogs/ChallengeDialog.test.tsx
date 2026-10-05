import { fireEvent, render, screen } from '@testing-library/react';
import { formatGrid, parseGrid } from '../../core';
import type { GameRecord } from '../../storage/history';
import { WIKIPEDIA_PUZZLE } from '../../test/grids';
import { ChallengeDialog, type ChallengeDialogProps } from './ChallengeDialog';

const NONE = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
/** 14:30 local on 5 Oct 2026. */
const NOW = new Date(2026, 9, 5, 14, 30).getTime();

const PREVIOUS: GameRecord = {
  id: 'old',
  givens: formatGrid(parseGrid(WIKIPEDIA_PUZZLE)),
  difficulty: 'hard',
  source: 'generated',
  createdAt: new Date(2026, 9, 3, 9, 0).getTime(),
  updatedAt: new Date(2026, 9, 3, 9, 5).getTime(),
  completedAt: new Date(2026, 9, 3, 9, 5).getTime(),
  status: 'solved',
  elapsedMs: 290_700,
  assists: NONE,
  challenge: null,
};

function renderChallenge(overrides: Partial<ChallengeDialogProps> = {}) {
  const props: ChallengeDialogProps = {
    difficulty: 'hard',
    previous: PREVIOUS,
    challenge: null,
    onPlayAgain: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<ChallengeDialog {...props} />);
  return { ...view, props };
}

const dialog = () => screen.getByRole('dialog', { name: "You've solved this one" });

describe('ChallengeDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says when, and how fast, the puzzle was solved before', () => {
    renderChallenge();
    expect(dialog()).toHaveTextContent('You solved this Hard puzzle in 4:50 on 3 Oct.');
    // Read as the description: focus opens on Play again, below it.
    expect(dialog()).toHaveAccessibleDescription(/You solved this Hard puzzle in 4:50 on 3 Oct\./);
  });

  it.each([
    [new Date(2026, 9, 5, 9, 12).getTime(), 'today at 09:12'],
    [new Date(2026, 9, 4, 21, 3).getTime(), 'yesterday at 21:03'],
    [new Date(2025, 11, 31, 8, 0).getTime(), 'on 31 Dec 2025'],
  ])('phrases a solve at %s as "%s" mid-sentence', (completedAt, phrase) => {
    renderChallenge({ previous: { ...PREVIOUS, completedAt } });
    expect(dialog()).toHaveTextContent(`in 4:50 ${phrase}.`);
  });

  it('falls back to the last update for a solved record with no completion time', () => {
    renderChallenge({ previous: { ...PREVIOUS, completedAt: null } });
    expect(dialog()).toHaveTextContent('on 3 Oct.');
  });

  it('mentions the help the earlier solve took', () => {
    renderChallenge({ previous: { ...PREVIOUS, assists: { ...NONE, reveals: 2 } } });
    expect(dialog()).toHaveTextContent('With 2 reveals.');
  });

  it('compares with the time the link carried', () => {
    renderChallenge({ challenge: { name: 'Dan', seconds: 323, assists: NONE } });
    expect(screen.getByRole('region', { name: 'Head to head' })).toHaveTextContent(
      'You were 0:33 faster than Dan!',
    );
    expect(dialog()).toHaveAccessibleDescription(/You were 0:33 faster than Dan!/);
  });

  it('shows no comparison for a link without a time', () => {
    renderChallenge();
    expect(screen.queryByRole('region', { name: 'Head to head' })).toBeNull();
  });

  it('opens on Play again, and fires both actions', () => {
    const { props } = renderChallenge();
    const again = screen.getByRole('button', { name: 'Play again' });
    expect(again).toHaveFocus();
    fireEvent.click(again);
    expect(props.onPlayAgain).toHaveBeenCalledOnce();
    // Both the footer button and the × close it.
    const closes = screen.getAllByRole('button', { name: 'Close' });
    expect(closes).toHaveLength(2);
    for (const close of closes) fireEvent.click(close);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
