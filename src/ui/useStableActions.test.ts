import { act, renderHook } from '@testing-library/react';
import { useLayoutEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useStableActions } from './useStableActions';

describe('useStableActions', () => {
  it('keeps every function’s identity across renders', () => {
    const { result, rerender } = renderHook(({ n }) => useStableActions({ get: () => n }), {
      initialProps: { n: 1 },
    });
    const first = result.current;
    rerender({ n: 2 });
    expect(result.current).toBe(first);
    expect(result.current.get).toBe(first.get);
  });

  it('calls the newest version of each function, with its arguments', () => {
    const { result } = renderHook(() => {
      const [count, setCount] = useState(0);
      const actions = useStableActions({
        add: (by: number) => setCount(count + by),
        read: () => count,
      });
      return actions;
    });
    act(() => result.current.add(2));
    // Each call sees the state the one before left, not the first render's.
    act(() => result.current.add(3));
    expect(result.current.read()).toBe(5);
  });

  it('has the newest functions in place before layout effects run, not after paint', () => {
    // A regression to a passive effect would leave the previous render's
    // functions in place here, where the browser could already deliver the
    // next event.
    const seen: number[] = [];
    const { rerender } = renderHook(
      ({ n }) => {
        const actions = useStableActions({ read: () => n });
        useLayoutEffect(() => {
          seen.push(actions.read());
        });
      },
      { initialProps: { n: 1 } },
    );
    rerender({ n: 2 });
    expect(seen).toEqual([1, 2]);
  });
});
