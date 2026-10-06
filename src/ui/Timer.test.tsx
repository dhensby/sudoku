import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Timer, type TimerProps } from './Timer';

function renderTimer(overrides: Partial<TimerProps> = {}) {
  const props: TimerProps = {
    elapsedMs: 222_900,
    phase: 'playing',
    showTimer: true,
    onPause: vi.fn(),
    onResume: vi.fn(),
    ...overrides,
  };
  render(<Timer {...props} />);
  return props;
}

describe('Timer', () => {
  it('is a pause button described by the time, so the name holds still', () => {
    const props = renderTimer();
    const button = screen.getByRole('button', { name: 'Pause' });
    expect(button).toHaveAccessibleDescription('3:42');
    expect(button).toHaveTextContent('3:42');
    fireEvent.click(button);
    expect(props.onPause).toHaveBeenCalledTimes(1);
  });

  it('gives each colon of a ticking time a span of its own, for its natural width', () => {
    renderTimer({ elapsedMs: (1 * 3600 + 23 * 60 + 45) * 1000 });
    const time = screen.getByRole('button', { name: 'Pause' }).querySelector('.timer__time')!;
    expect(time).toHaveTextContent('1:23:45');
    expect([...time.querySelectorAll('.timer__colon')].map((colon) => colon.textContent)).toEqual([
      ':',
      ':',
    ]);
  });

  it('keeps a mouse press from taking focus, so Space goes on switching the mode', () => {
    renderTimer();
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Pause' }))).toBe(false);
  });

  it('resumes a paused game and starts a ready one', () => {
    const paused = renderTimer({ phase: 'paused' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(paused.onResume).toHaveBeenCalledTimes(1);
  });

  it('starts a shared game waiting behind its Start button', () => {
    const props = renderTimer({ phase: 'ready', elapsedMs: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(props.onResume).toHaveBeenCalledTimes(1);
  });

  it('hides the digits but keeps the button when the timer is turned off', () => {
    renderTimer({ showTimer: false });
    const button = screen.getByRole('button', { name: 'Pause' });
    expect(button).not.toHaveTextContent('3:42');
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('cannot be pressed while a puzzle is generated', () => {
    renderTimer({ phase: 'loading' });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
  });

  it('is just the final time once solved', () => {
    renderTimer({ phase: 'solved' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/3:42/)).toHaveTextContent('Solved in 3:42');
  });

  it('shows nothing once solved with the timer turned off', () => {
    const { container } = render(
      <Timer
        elapsedMs={1000}
        phase="solved"
        showTimer={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
      />,
    );
    expect(container).toHaveTextContent('');
  });
});
