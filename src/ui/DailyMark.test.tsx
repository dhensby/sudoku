import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DailyStatus } from '../storage/streaks';
import { DailyMark } from './DailyMark';

const STATUSES: DailyStatus[] = ['solved-on-the-day', 'solved-later', 'in-progress', 'not-started'];

describe('DailyMark', () => {
  it.each(STATUSES)('draws %s as a decorative square in the text colour', (status) => {
    const { container } = render(<DailyMark status={status} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 10 10');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('class', `daily-mark daily-mark--${status}`);
  });

  it('tells every standing apart by its shape alone', () => {
    const shapes = STATUSES.map(
      (status) => render(<DailyMark status={status} />).container.querySelector('svg')!.innerHTML,
    );
    expect(new Set(shapes).size).toBe(4);
    // Solid; outlined and hatched; outlined and half filled; outlined and empty.
    const [solid, hatched, half, empty] = shapes;
    expect(solid).toMatch(/fill="currentColor"/);
    expect(hatched).toMatch(/<path/);
    expect(half).toMatch(/y="5"/);
    expect(empty).not.toMatch(/fill="currentColor"/);
  });

  it('takes extra classes for its size', () => {
    const { container } = render(<DailyMark status="in-progress" className="calendar__mark" />);
    expect(container.querySelector('svg')).toHaveAttribute(
      'class',
      'daily-mark daily-mark--in-progress calendar__mark',
    );
  });
});
