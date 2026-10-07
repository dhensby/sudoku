import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardOverlay } from './BoardOverlay';

describe('BoardOverlay', () => {
  it('shows a spinner while a puzzle is generated', () => {
    render(<BoardOverlay kind="loading" difficulty="expert" />);
    expect(screen.getByRole('status')).toHaveTextContent('Generating an Expert puzzle…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers to try again when generation failed', () => {
    const onRetry = vi.fn();
    render(<BoardOverlay kind="failed" difficulty="hard" onRetry={onRetry} />);
    expect(screen.getByText("Couldn't make a Hard puzzle.")).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the challenger’s time on the Ready card, and focuses Start', () => {
    const onStart = vi.fn();
    render(
      <BoardOverlay
        kind="ready"
        difficulty="hard"
        isShared
        challenge={{
          name: 'Dan',
          seconds: 323,
          assists: { autoCandidates: true, hints: 2, checks: 0, reveals: 0 },
        }}
        onStart={onStart}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Ready?' })).toBeInTheDocument();
    expect(
      screen.getByText(/solved this Hard puzzle in 5:23\. Can you beat it\?/),
    ).toHaveTextContent('Dan solved this Hard puzzle in 5:23. Can you beat it?');
    expect(screen.getByText('With auto candidates, 2 hints.')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toHaveFocus();
    // Landing on Start, a screen reader hears what it is starting.
    expect(start).toHaveAccessibleDescription(
      'Ready? Dan solved this Hard puzzle in 5:23. Can you beat it? With auto candidates, 2 hints. The timer starts when you do.',
    );
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('keeps a nameless challenger nameless', () => {
    render(
      <BoardOverlay
        kind="ready"
        difficulty="easy"
        isShared
        challenge={{
          name: null,
          seconds: 61,
          assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
        }}
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByText(/Your friend solved this Easy puzzle in 1:01/)).toBeInTheDocument();
  });

  it('says a puzzle was shared when the link carries no time', () => {
    render(
      <BoardOverlay kind="ready" difficulty="easy" isShared challenge={null} onStart={vi.fn()} />,
    );
    expect(screen.getByText('Someone shared an Easy puzzle with you.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toHaveAccessibleDescription(
      'Ready? Someone shared an Easy puzzle with you. The timer starts when you do.',
    );
  });

  it('says a puzzle of the player’s own is ready, when it waits for them', () => {
    // One that arrived while the tab was hidden, or was never started before a reload.
    render(
      <BoardOverlay
        kind="ready"
        difficulty="hard"
        isShared={false}
        challenge={null}
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Start' })).toHaveAccessibleDescription(
      'Ready? Your Hard puzzle is ready. The timer starts when you do.',
    );
  });

  it('shows the time on the Paused card, unless the timer is hidden', () => {
    const onResume = vi.fn();
    const { rerender } = render(
      <BoardOverlay
        kind="paused"
        difficulty="medium"
        elapsedMs={95_000}
        showTimer
        onResume={onResume}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Paused' })).toBeInTheDocument();
    expect(screen.getByText('Medium · 1:35')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveAccessibleDescription(
      'Paused Medium · 1:35',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    rerender(
      <BoardOverlay
        kind="paused"
        difficulty="medium"
        elapsedMs={95_000}
        showTimer={false}
        onResume={onResume}
      />,
    );
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('is blank behind a dialog', () => {
    const { container } = render(<BoardOverlay kind="veiled" />);
    expect(container.firstElementChild).toBeEmptyDOMElement();
  });

  it('hands focus on to whatever replaces it, if its button had it', () => {
    const onReleaseFocus = vi.fn();
    const { unmount } = render(
      <BoardOverlay
        kind="paused"
        difficulty="hard"
        elapsedMs={0}
        showTimer
        onResume={vi.fn()}
        onReleaseFocus={onReleaseFocus}
      />,
    );
    unmount();
    expect(onReleaseFocus).toHaveBeenCalledTimes(1);
  });

  it('claims focus as its button takes it, so a stale hand-over is withdrawn', () => {
    const onClaimFocus = vi.fn();
    render(
      <BoardOverlay
        kind="paused"
        difficulty="hard"
        elapsedMs={0}
        showTimer
        onResume={vi.fn()}
        onClaimFocus={onClaimFocus}
      />,
    );
    expect(onClaimFocus).toHaveBeenCalledTimes(1);
  });

  it('claims nothing when it has no button to focus', () => {
    const onClaimFocus = vi.fn();
    render(<BoardOverlay kind="loading" difficulty="hard" onClaimFocus={onClaimFocus} />);
    expect(onClaimFocus).not.toHaveBeenCalled();
  });

  it('describes Try again by what went wrong', () => {
    render(<BoardOverlay kind="failed" difficulty="hard" onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAccessibleDescription(
      "Something went wrong Couldn't make a Hard puzzle.",
    );
  });

  it('keeps out of focus it never had', () => {
    const onReleaseFocus = vi.fn();
    const { unmount } = render(
      <BoardOverlay kind="loading" difficulty="hard" onReleaseFocus={onReleaseFocus} />,
    );
    unmount();
    expect(onReleaseFocus).not.toHaveBeenCalled();
  });

  describe('BoardOverlay for a daily', () => {
    const today = { date: '2026-10-13', today: '2026-10-13' };
    const earlier = { date: '2026-10-12', today: '2026-10-13' };

    it("names the daily being dealt: today's, or another day's", () => {
      const { unmount } = render(<BoardOverlay kind="loading" difficulty="hard" daily={today} />);
      expect(screen.getByRole('status')).toHaveTextContent("Generating today's Hard puzzle…");
      unmount();
      render(<BoardOverlay kind="loading" difficulty="hard" daily={earlier} />);
      expect(screen.getByRole('status')).toHaveTextContent('Generating the Hard daily for 12 Oct…');
    });

    it('names a daily waiting behind Start, whether shared, raced or reopened', () => {
      const { unmount } = render(
        <BoardOverlay
          kind="ready"
          difficulty="hard"
          isShared={false}
          challenge={null}
          daily={earlier}
          onStart={vi.fn()}
        />,
      );
      expect(screen.getByText('The Hard daily for 12 Oct is ready.')).toBeInTheDocument();
      unmount();
      const shared = render(
        <BoardOverlay
          kind="ready"
          difficulty="hard"
          isShared
          challenge={null}
          daily={today}
          onStart={vi.fn()}
        />,
      );
      expect(screen.getByText("Someone shared today's Hard puzzle with you.")).toBeInTheDocument();
      shared.unmount();
      render(
        <BoardOverlay
          kind="ready"
          difficulty="hard"
          isShared
          challenge={{
            name: 'Dan',
            seconds: 323,
            assists: { autoCandidates: false, hints: 0, checks: 0, reveals: 0 },
          }}
          daily={today}
          onStart={vi.fn()}
        />,
      );
      expect(screen.getByText(/solved today's Hard puzzle in 5:23/)).toHaveTextContent(
        "Dan solved today's Hard puzzle in 5:23. Can you beat it?",
      );
    });

    it('names a paused daily', () => {
      render(
        <BoardOverlay
          kind="paused"
          difficulty="medium"
          elapsedMs={151_000}
          showTimer
          daily={earlier}
          onResume={vi.fn()}
        />,
      );
      expect(screen.getByText('Daily · 12 Oct · Medium · 2:31')).toBeInTheDocument();
    });
  });
});
