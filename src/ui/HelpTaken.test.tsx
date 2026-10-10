import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assists } from '../core';
import { HelpTaken, TICK_MS } from './HelpTaken';

const NO_HELP: Assists = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
const help = (more: Partial<Assists>): Assists => ({ ...NO_HELP, ...more });

const chip = () => document.querySelector('.help-taken');
const face = () => document.querySelector('.help-taken__face')!;
const full = () => document.querySelector('.help-taken__full')!;
const counts = () => document.querySelector('.help-taken__counts')!;
const total = () => document.querySelector('.help-taken__total')!;

describe('HelpTaken', () => {
  it('shows nothing before any help is taken, nor with no game', () => {
    const { rerender } = render(<HelpTaken assists={NO_HELP} gameId="a" placement="header" />);
    expect(chip()).toBeNull();
    rerender(<HelpTaken assists={null} gameId={null} placement="header" />);
    expect(chip()).toBeNull();
  });

  it.each([
    [help({ autoCandidates: true }), 'Auto candidates', 'auto candidates'],
    [help({ checkGuesses: true }), 'Checked as entered', 'guesses checked as entered'],
    [help({ hints: 1 }), '1 hint', '1 hint'],
    [help({ hints: 2 }), '2 hints', '2 hints'],
    [help({ checks: 1 }), '1 check', '1 check'],
    [help({ checks: 3 }), '3 checks', '3 checks'],
    [help({ reveals: 1 }), '1 reveal', '1 reveal'],
    [help({ reveals: 2 }), '2 reveals', '2 reveals'],
    [
      help({ autoCandidates: true, hints: 2 }),
      'Auto candidates · 2 hints',
      'auto candidates, 2 hints',
    ],
    [
      { autoCandidates: true, checkGuesses: true, hints: 12, checks: 1, reveals: 3 },
      'Auto candidates · Checked as entered · 12 hints · 1 check · 3 reveals',
      'auto candidates, guesses checked as entered, 12 hints, 1 check, 3 reveals',
    ],
  ] as const)('words %o as History does: "%s"', (assists, shown, spoken) => {
    render(<HelpTaken assists={assists} gameId="a" placement="header" />);
    expect(full()).toHaveTextContent(new RegExp(`^${shown}$`));
    expect(face()).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(`Help taken: ${spoken}`)).toHaveClass('visually-hidden');
  });

  it('sets each count in ink, apart from its words', () => {
    render(<HelpTaken assists={help({ hints: 2, reveals: 1 })} gameId="a" placement="play" />);
    const counts = [...full().querySelectorAll('.help-taken__count')].map((el) => el.textContent);
    expect(counts).toEqual(['2', '1']);
  });

  it.each([
    [
      help({ autoCandidates: true, checkGuesses: true, hints: 2, checks: 1 }),
      '2 hints · 1 check',
      'Help 3',
    ],
    [help({ autoCandidates: true, reveals: 1 }), '1 reveal', 'Help 1'],
    [help({ hints: 12, checks: 12, reveals: 12 }), '12 hints · 12 checks · 12 reveals', 'Help 36'],
    [
      help({ autoCandidates: true, checkGuesses: true }),
      'Auto candidates · Checked as entered',
      'Help taken',
    ],
  ] as const)(
    'shortens %o to the counts alone, "%s", and then to their total, "%s"',
    (assists, alone, added) => {
      render(<HelpTaken assists={assists} gameId="a" placement="play" />);
      expect(counts()).toHaveTextContent(new RegExp(`^${alone}$`));
      expect(total()).toHaveTextContent(new RegExp(`^${added}$`));
    },
  );

  it('sets the total in ink, as the error counter sets its counts', () => {
    render(<HelpTaken assists={help({ hints: 2, reveals: 1 })} gameId="a" placement="play" />);
    expect(total().querySelector('.help-taken__count')).toHaveTextContent(/^3$/);
  });

  it('says where it sits, for the stylesheet to show the one that fits', () => {
    const { rerender } = render(
      <HelpTaken assists={help({ hints: 1 })} gameId="a" placement="header" />,
    );
    expect(chip()).toHaveClass('help-taken', 'help-taken--header');
    rerender(<HelpTaken assists={help({ hints: 1 })} gameId="a" placement="play" />);
    expect(chip()).toHaveClass('help-taken', 'help-taken--play');
  });

  describe('fitting its room', () => {
    let room = 200;
    let needed = 100;
    let alone = 50;
    let resize: (() => void) | null = null;

    beforeEach(() => {
      room = 200;
      needed = 100;
      alone = 50;
      // jsdom lays nothing out: the box's room and each wording's width are given here.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        let width = 0;
        if (this.classList.contains('help-taken')) width = room;
        else if (this.classList.contains('help-taken__full')) width = needed;
        else if (this.classList.contains('help-taken__counts')) width = alone;
        return new DOMRect(0, 0, width, 18);
      });
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resize = callback;
          }
          observe() {}
          disconnect() {
            resize = null;
          }
        },
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      resize = null;
    });

    const AIDED = help({ autoCandidates: true, hints: 2 });

    it('shows the full words where they fit, to the sub-pixel', () => {
      needed = 200;
      render(<HelpTaken assists={AIDED} gameId="a" placement="play" />);
      expect(face().className).toBe('help-taken__face');
      expect(chip()).not.toHaveAttribute('title');
    });

    it('shows the counts alone where they do not, with the full words on hover', () => {
      // A fraction over is over: whole pixels would round it to a fit.
      needed = 200.4;
      render(<HelpTaken assists={AIDED} gameId="a" placement="play" />);
      expect(face()).toHaveClass('help-taken__face--counts');
      expect(chip()).toHaveAttribute('title', 'Auto candidates · 2 hints');
    });

    it('shows their total where even the counts do not fit, never a count cut short', () => {
      needed = 300;
      alone = 201;
      render(<HelpTaken assists={AIDED} gameId="a" placement="play" />);
      expect(face()).toHaveClass('help-taken__face--total');
      expect(face()).not.toHaveClass('help-taken__face--counts');
      expect(chip()).toHaveAttribute('title', 'Auto candidates · 2 hints');
    });

    it('measures again as its room changes', () => {
      render(<HelpTaken assists={AIDED} gameId="a" placement="play" />);
      room = 80;
      act(() => resize!());
      expect(face()).toHaveClass('help-taken__face--counts');
      room = 40;
      act(() => resize!());
      expect(face()).toHaveClass('help-taken__face--total');
      room = 120;
      act(() => resize!());
      expect(face().className).toBe('help-taken__face');
    });

    it('measures again as its words change', () => {
      const { rerender } = render(
        <HelpTaken assists={help({ hints: 2 })} gameId="a" placement="header" />,
      );
      expect(face()).not.toHaveClass('help-taken__face--counts');
      needed = 260;
      rerender(<HelpTaken assists={AIDED} gameId="a" placement="header" />);
      expect(face()).toHaveClass('help-taken__face--counts');
    });

    it('measures once, without a ResizeObserver to call on', () => {
      vi.unstubAllGlobals();
      const observer = globalThis.ResizeObserver;
      // @ts-expect-error -- a browser without it
      delete globalThis.ResizeObserver;
      try {
        needed = 300;
        render(<HelpTaken assists={help({ hints: 2 })} gameId="a" placement="play" />);
        expect(face()).toHaveClass('help-taken__face--counts');
      } finally {
        if (observer !== undefined) globalThis.ResizeObserver = observer;
      }
    });
  });

  describe('ticking', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const isTicking = () => face().classList.contains('help-taken__face--tick');

    it('ticks as help is charged, afresh each time, and settles', () => {
      const { rerender } = render(
        <HelpTaken assists={help({ hints: 1 })} gameId="a" placement="header" />,
      );
      expect(isTicking()).toBe(false);
      rerender(<HelpTaken assists={help({ hints: 2 })} gameId="a" placement="header" />);
      const first = face();
      expect(isTicking()).toBe(true);
      act(() => vi.advanceTimersByTime(TICK_MS / 2));
      rerender(<HelpTaken assists={help({ hints: 2, checks: 1 })} gameId="a" placement="header" />);
      // A new element, so the pop plays again from its start.
      expect(face()).not.toBe(first);
      expect(isTicking()).toBe(true);
      act(() => vi.advanceTimersByTime(TICK_MS - 1));
      expect(isTicking()).toBe(true);
      act(() => vi.advanceTimersByTime(1));
      expect(isTicking()).toBe(false);
    });

    it.each([
      ['auto candidates on', help({ autoCandidates: true })],
      ['guesses checked as entered', help({ checkGuesses: true })],
      ['a hint', help({ hints: 1 })],
      ['a check', help({ checks: 1 })],
      ['a reveal', help({ reveals: 1 })],
    ])('ticks as the first help, %s, appears', (_label, assists) => {
      const { rerender } = render(<HelpTaken assists={NO_HELP} gameId="a" placement="play" />);
      rerender(<HelpTaken assists={assists} gameId="a" placement="play" />);
      expect(isTicking()).toBe(true);
    });

    it('does not tick for help a game opens with, another game, or the same help again', () => {
      const { rerender } = render(
        <HelpTaken assists={help({ hints: 2 })} gameId="a" placement="header" />,
      );
      expect(isTicking()).toBe(false);
      // Another game, with more help: news of that game, not a charge.
      rerender(<HelpTaken assists={help({ hints: 5 })} gameId="b" placement="header" />);
      expect(isTicking()).toBe(false);
      // The same help, as a new object.
      rerender(<HelpTaken assists={help({ hints: 5 })} gameId="b" placement="header" />);
      expect(isTicking()).toBe(false);
      // A game with no help, then nothing on screen, then help again.
      rerender(<HelpTaken assists={null} gameId={null} placement="header" />);
      rerender(<HelpTaken assists={help({ hints: 1 })} gameId={null} placement="header" />);
      expect(isTicking()).toBe(false);
    });

    it('does not tick for help a game takes up as it first starts, only after', () => {
      // Behind Start, then started with Check guesses taken up: help it opens with.
      const { rerender } = render(
        <HelpTaken assists={NO_HELP} gameId="a" isStarted={false} placement="header" />,
      );
      rerender(<HelpTaken assists={help({ checkGuesses: true })} gameId="a" placement="header" />);
      expect(chip()).not.toBeNull();
      expect(isTicking()).toBe(false);
      // Once on show, help is a charge.
      rerender(
        <HelpTaken
          assists={help({ checkGuesses: true, hints: 1 })}
          gameId="a"
          placement="header"
        />,
      );
      expect(isTicking()).toBe(true);
    });

    it('ticks a charge made behind a dialog as the dialog closes, where it can be seen', () => {
      const { rerender } = render(
        <HelpTaken assists={help({ hints: 1 })} gameId="a" placement="header" />,
      );
      // Show me charges as its walkthrough opens over the page.
      rerender(<HelpTaken assists={help({ hints: 2 })} gameId="a" isCovered placement="header" />);
      expect(isTicking()).toBe(false);
      act(() => vi.advanceTimersByTime(TICK_MS * 3));
      rerender(<HelpTaken assists={help({ hints: 2 })} gameId="a" isCovered placement="header" />);
      expect(isTicking()).toBe(false);
      rerender(<HelpTaken assists={help({ hints: 2 })} gameId="a" placement="header" />);
      expect(isTicking()).toBe(true);
      act(() => vi.advanceTimersByTime(TICK_MS));
      expect(isTicking()).toBe(false);
      // A dialog opened and closed with nothing charged ticks nothing.
      rerender(<HelpTaken assists={help({ hints: 2 })} gameId="a" isCovered placement="header" />);
      rerender(<HelpTaken assists={help({ hints: 2 })} gameId="a" placement="header" />);
      expect(isTicking()).toBe(false);
    });

    it('drops a charge behind a dialog when another game takes its place', () => {
      const { rerender } = render(
        <HelpTaken assists={help({ hints: 1 })} gameId="a" placement="header" />,
      );
      rerender(<HelpTaken assists={help({ hints: 2 })} gameId="a" isCovered placement="header" />);
      rerender(<HelpTaken assists={help({ hints: 3 })} gameId="b" isCovered placement="header" />);
      rerender(<HelpTaken assists={help({ hints: 3 })} gameId="b" placement="header" />);
      expect(isTicking()).toBe(false);
    });

    it('does not tick for a switch going off, which charges nothing', () => {
      const { rerender } = render(
        <HelpTaken
          assists={help({ autoCandidates: true, checkGuesses: true, hints: 1 })}
          gameId="a"
          placement="header"
        />,
      );
      rerender(<HelpTaken assists={help({ hints: 1 })} gameId="a" placement="header" />);
      expect(isTicking()).toBe(false);
    });
  });
});
