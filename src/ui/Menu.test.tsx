import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Menu, type MenuItem } from './Menu';

function items(): MenuItem[] {
  return [
    { key: 'a', label: 'Alpha', onSelect: vi.fn() },
    { key: 'b', label: 'Bravo', onSelect: vi.fn(), disabled: true },
    { key: 'c', label: 'Charlie', onSelect: vi.fn() },
  ];
}

function renderMenu(list = items(), props: { disabled?: boolean } = {}) {
  const view = render(
    <>
      <Menu label="Things" items={list} {...props}>
        …
      </Menu>
      <p>Outside</p>
      <button type="button">Next</button>
    </>,
  );
  return {
    ...view,
    list,
    button: screen.getByRole('button', { name: 'Things' }),
    next: screen.getByRole('button', { name: 'Next' }),
  };
}

describe('Menu', () => {
  it('says it has a popup, and whether it is open', () => {
    const { button } = renderMenu();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute(
      'aria-controls',
      screen.getByRole('menu', { name: 'Things' }).id,
    );
  });

  it('moves focus to the first enabled item as it opens', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
  });

  it('opens on the last item with ArrowUp, and the first with ArrowDown', () => {
    const { button } = renderMenu();
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Charlie' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
    // Other keys on the button are left to the browser.
    fireEvent.keyDown(button, { key: 'x' });
  });

  it('moves between enabled items with the arrows, Home and End, wrapping round', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    const alpha = screen.getByRole('menuitem', { name: 'Alpha' });
    const charlie = screen.getByRole('menuitem', { name: 'Charlie' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    // Bravo is disabled, so it is skipped.
    expect(charlie).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(alpha).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(charlie).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(alpha).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(charlie).toHaveFocus();
  });

  it('claims the keys it uses, so the game’s arrow keys leave the board alone', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    expect(fireEvent.keyDown(menu, { key: 'ArrowDown' })).toBe(false);
    // A digit is not the menu's to claim (the App ignores keys aimed at a menu).
    expect(fireEvent.keyDown(menu, { key: '5' })).toBe(true);
  });

  it('closes on Escape and hands focus back to its button', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes on Tab once focus has moved on, not before', () => {
    // Taken out from under the focus first, the menu would leave the browser
    // nowhere to move on from.
    const { button, next } = renderMenu();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // The browser moves focus, as Tab does.
    act(() => next.focus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(next).toHaveFocus();
  });

  it('closes on Shift+Tab back onto its own button', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab', shiftKey: true });
    act(() => button.focus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes when focus leaves it any other way, so it never lingers out of reach', () => {
    // The Paused card taking focus as the tab hides, say.
    const { button, next } = renderMenu();
    fireEvent.click(button);
    act(() => next.focus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when focus leaves for nowhere in the page, as when the window loses it', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    fireEvent.blur(screen.getByRole('menuitem', { name: 'Alpha' }), { relatedTarget: null });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('stays open as focus moves between its button and its items', () => {
    const { button } = renderMenu();
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Charlie' })).toHaveFocus();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes when anything outside it is pressed', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Alpha' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('toggles closed from its own button', () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('runs an item chosen from the keyboard with focus already back on the button', () => {
    // A dialog the item opens restores focus to whatever had it on opening;
    // the item is about to unmount, so that has to be somewhere else. (A
    // click from Enter or Space has no click count, as here.)
    const list = items();
    let focused: Element | null = null;
    list[0].onSelect = vi.fn(() => {
      focused = document.activeElement;
    });
    const { button } = renderMenu(list);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }));
    expect(list[0].onSelect).toHaveBeenCalledTimes(1);
    expect(focused).toBe(button);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('never takes focus from a mouse press, on its button or its items', () => {
    const { button } = renderMenu();
    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button);
    expect(fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Alpha' }))).toBe(false);
  });

  describe('chosen with a pointer', () => {
    /** The menu, with a cell-like control that has focus before it opens. */
    function withFocusOutside(list = items()) {
      const view = render(
        <>
          <button type="button">Cell</button>
          <Menu label="Things" items={list}>
            …
          </Menu>
        </>,
      );
      const cell = screen.getByRole('button', { name: 'Cell' });
      cell.focus();
      return { ...view, list, cell, button: screen.getByRole('button', { name: 'Things' }) };
    }

    it('gives focus back to where it was before the menu opened, then runs the item', () => {
      const list = items();
      let focused: Element | null = null;
      list[0].onSelect = vi.fn(() => {
        focused = document.activeElement;
      });
      const { button, cell } = withFocusOutside(list);
      fireEvent.click(button, { detail: 1 });
      fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }), { detail: 1 });
      expect(focused).toBe(cell);
      expect(cell).toHaveFocus();
    });

    it('gives focus back as the button toggles it closed', () => {
      const { button, cell } = withFocusOutside();
      fireEvent.click(button, { detail: 1 });
      fireEvent.click(button, { detail: 1 });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(cell).toHaveFocus();
    });

    it('gives focus back as Escape closes it, so Space is the game’s again, not the button’s', () => {
      const { button, cell } = withFocusOutside();
      fireEvent.click(button, { detail: 1 });
      expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(cell).toHaveFocus();
    });

    it('still hands Escape’s focus to the button for a menu opened from the keyboard', () => {
      const { button } = withFocusOutside();
      button.focus();
      fireEvent.click(button, { detail: 0 });
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      expect(button).toHaveFocus();
    });

    it('settles for the button when there was nowhere in particular to go back to', () => {
      const { button } = renderMenu();
      // Nothing had focus as it opened.
      fireEvent.click(button, { detail: 1 });
      fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }), { detail: 1 });
      expect(button).toHaveFocus();
    });

    it('settles for the button when where it was has left the page', () => {
      // A cell under a board the item's action replaced, say.
      const cell = document.createElement('button');
      document.body.append(cell);
      cell.focus();
      const { button } = renderMenu();
      fireEvent.click(button, { detail: 1 });
      cell.remove();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }), { detail: 1 });
      expect(button).toHaveFocus();
    });
  });

  it('marks the current item with a check and in its name, as a plain command', () => {
    const list: MenuItem[] = [
      { key: 'a', label: 'Alpha', onSelect: vi.fn(), isCurrent: true },
      { key: 'b', label: 'Bravo', onSelect: vi.fn() },
    ];
    const { button } = renderMenu(list);
    fireEvent.click(button);
    const alpha = screen.getByRole('menuitem', { name: 'Alpha (current)' });
    expect(alpha).not.toHaveAttribute('aria-checked');
    expect(alpha.querySelector('.menu__check')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Bravo' })).not.toHaveAttribute('aria-label');
    fireEvent.click(alpha);
    expect(list[0].onSelect).toHaveBeenCalledTimes(1);
  });

  it('closes when disabled, and stays closed when enabled again', () => {
    const list = items();
    const { button, rerender } = renderMenu(list);
    fireEvent.click(button);
    rerender(
      <Menu label="Things" items={list} disabled>
        …
      </Menu>,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Things' })).toBeDisabled();
    rerender(
      <Menu label="Things" items={list}>
        …
      </Menu>,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows a heading and icons when given them', () => {
    render(
      <Menu
        label="Pick"
        heading="Pick one"
        items={[{ key: 'x', label: 'X', icon: <span data-testid="icon" />, onSelect: vi.fn() }]}
      >
        …
      </Menu>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }));
    expect(screen.getByText('Pick one')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
