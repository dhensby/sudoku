import { useLayoutEffect, useRef, useState } from 'react';

// Any function: `never[]` parameters accept every signature under strict
// function types, where `unknown[]` would reject them.
type AnyFunction = (...args: never[]) => unknown;

/**
 * An object of functions whose identities never change, each calling the
 * newest version of its counterpart in `actions`.
 *
 * The game's actions read the latest state, so they are recreated on every
 * render; passed straight down, they would defeat every memoised child — all
 * 81 cells, and History's rows — on every tick of the timer. This keeps the
 * identities still while the behaviour stays current.
 *
 * The newest functions are taken in a layout effect, which runs before the
 * browser can deliver the next event: two key presses in quick succession
 * must each see the state the previous one left. The wrappers are for event
 * handlers and effects, never for calling while rendering — mid-render they
 * would still see the previous render's functions.
 *
 * `actions` must have the same keys on every render.
 */
export function useStableActions<T extends { [K in keyof T]: AnyFunction }>(actions: T): T {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const [stable] = useState(() => {
    const wrappers: Partial<Record<keyof T, AnyFunction>> = {};
    for (const key of Object.keys(actions) as (keyof T)[]) {
      wrappers[key] = (...args) => latest.current[key](...args);
    }
    return wrappers as T;
  });
  return stable;
}
