import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MouseEvent } from 'react';
import {
  focusQuietly,
  guardFocus,
  isUsingKeyboard,
  keepFocus,
  trackInputModality,
} from './keepFocus';

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  vi.restoreAllMocks();
});

describe('keepFocus', () => {
  it('stops a mouse press from moving focus', () => {
    const event = { preventDefault: vi.fn() } as unknown as MouseEvent;
    keepFocus(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('trackInputModality', () => {
  it('knows the keyboard from a pointer, by the last one used', () => {
    stop = trackInputModality();
    // A page just loaded has had no input at all.
    expect(isUsingKeyboard()).toBe(false);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(isUsingKeyboard()).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(isUsingKeyboard()).toBe(false);
  });

  it('hears keys that something stopped on the way', () => {
    stop = trackInputModality();
    const button = document.createElement('button');
    button.addEventListener('keydown', (event) => event.stopPropagation());
    document.body.append(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(isUsingKeyboard()).toBe(true);
    button.remove();
  });

  it('stops listening, and forgets, when told to', () => {
    stop = trackInputModality();
    fireEvent.keyDown(document.body, { key: 'a' });
    stop();
    stop = null;
    expect(isUsingKeyboard()).toBe(false);
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(isUsingKeyboard()).toBe(false);
  });
});

describe('focusQuietly', () => {
  it('focuses without a ring after a pointer, or before any input', () => {
    stop = trackInputModality();
    const button = document.createElement('button');
    document.body.append(button);
    const focus = vi.spyOn(button, 'focus');
    focusQuietly(button);
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
    expect(button).toHaveFocus();
    fireEvent.pointerDown(document.body);
    focusQuietly(button);
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
    button.remove();
  });

  it('leaves the ring to the browser after a key', () => {
    stop = trackInputModality();
    const button = document.createElement('button');
    document.body.append(button);
    const focus = vi.spyOn(button, 'focus');
    fireEvent.keyDown(document.body, { key: 'Tab' });
    focusQuietly(button);
    expect(focus).toHaveBeenLastCalledWith(undefined);
    button.remove();
  });

  it('does nothing with nothing to focus', () => {
    expect(() => focusQuietly(null)).not.toThrow();
    expect(() => focusQuietly(undefined)).not.toThrow();
  });
});

describe('guardFocus', () => {
  /** A page with a control, a home for focus to go to, and the guard watching both. */
  function page() {
    const control = document.createElement('button');
    control.textContent = 'Control';
    const home = document.createElement('button');
    home.textContent = 'Home';
    document.body.append(control, home);
    const focusHome = vi.fn(() => {
      home.focus();
      return true;
    });
    stop = guardFocus(focusHome);
    control.focus();
    return { control, home, focusHome };
  }

  /** The guard looks a frame after the loss; no timers are faked or advanced. */
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('sends focus home when the control holding it leaves the page', async () => {
    const { control, home, focusHome } = page();
    control.remove();
    expect(document.body).toHaveFocus();
    await nextFrame();
    expect(focusHome).toHaveBeenCalledOnce();
    expect(home).toHaveFocus();
  });

  it('sends focus home when the control holding it is disabled', async () => {
    const { control, home } = page();
    control.disabled = true;
    await nextFrame();
    expect(home).toHaveFocus();
  });

  it('sends focus home when a browser blurs a removed control as it goes', async () => {
    // Chrome fires focusout, with nowhere for focus to go, as it removes one.
    const { control, home } = page();
    fireEvent.focusOut(control, { relatedTarget: null });
    control.remove();
    await nextFrame();
    expect(home).toHaveFocus();
  });

  it('leaves focus the player sent to nothing there, and forgets it', async () => {
    // A press on a blank part of the page, with nothing taken away.
    const { control, focusHome } = page();
    control.blur();
    await nextFrame();
    expect(focusHome).not.toHaveBeenCalled();
    expect(document.body).toHaveFocus();
    // Nothing removed later pulls focus back to the board.
    control.remove();
    await nextFrame();
    expect(focusHome).not.toHaveBeenCalled();
  });

  it('leaves focus that moved to another element alone', async () => {
    const { control, home, focusHome } = page();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    control.remove();
    await nextFrame();
    expect(focusHome).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
    expect(home).not.toHaveFocus();
  });

  it('leaves a dialog to look after its own focus, and anything behind an open one', async () => {
    const { control, focusHome } = page();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const inside = document.createElement('button');
    dialog.append(inside);
    document.body.append(dialog);
    // Behind it: the control under the dialog goes.
    control.remove();
    await nextFrame();
    expect(focusHome).not.toHaveBeenCalled();
    // In it: a dialog's own button goes as the dialog closes.
    inside.focus();
    dialog.remove();
    await nextFrame();
    expect(focusHome).not.toHaveBeenCalled();
  });

  it('looks once a frame, however many signals arrive', async () => {
    const { control, focusHome } = page();
    fireEvent.focusOut(control, { relatedTarget: null });
    fireEvent.focusOut(control, { relatedTarget: null });
    control.remove();
    await nextFrame();
    expect(focusHome).toHaveBeenCalledOnce();
  });

  it('does nothing before anything has had focus', async () => {
    const focusHome = vi.fn(() => true);
    stop = guardFocus(focusHome);
    const element = document.createElement('p');
    document.body.append(element);
    element.remove();
    fireEvent.focusOut(document.body, { relatedTarget: null });
    await nextFrame();
    expect(focusHome).not.toHaveBeenCalled();
  });

  it('stops watching when told to', async () => {
    const { control, focusHome } = page();
    stop?.();
    stop = null;
    control.remove();
    await nextFrame();
    expect(focusHome).not.toHaveBeenCalled();
  });
});
