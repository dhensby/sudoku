import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FocusHomeContext, trackInputModality } from '../keepFocus';
import { Dialog } from './Dialog';

function renderDialog(children = <button type="button">Inside</button>, onClose = vi.fn()) {
  const view = render(
    <Dialog title="Test" onClose={onClose}>
      {children}
    </Dialog>,
  );
  return { ...view, onClose };
}

const overlay = () => document.querySelector('.dialog-overlay') as Element;

/** Press a key on the document, as the Dialog hears it, and report whether it was claimed. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('Dialog', () => {
  it('is a modal dialog named by its visible title', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Test' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Named by the heading itself, so the name and what is on screen cannot drift.
    expect(screen.getByRole('heading', { name: 'Test' }).id).toBe(
      dialog.getAttribute('aria-labelledby'),
    );
  });

  it('renders a footer only when given one', () => {
    const { rerender } = renderDialog();
    expect(document.querySelector('.dialog__footer')).toBeNull();
    rerender(
      <Dialog title="Test" onClose={vi.fn()} footer={<button type="button">Act</button>}>
        <p>Body</p>
      </Dialog>,
    );
    expect(document.querySelector('.dialog__footer')).toContainElement(
      screen.getByRole('button', { name: 'Act' }),
    );
  });

  it('adds modifier classes and a description', () => {
    render(
      <Dialog title="Test" onClose={vi.fn()} className="dialog--wide" describedBy="explain">
        <p id="explain">What this is for</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('dialog', 'dialog--wide');
    expect(dialog).toHaveAccessibleDescription('What this is for');
  });

  it('closes on the close button, Escape, and a press on the scrim', () => {
    const { onClose } = renderDialog(<p>Body</p>);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    // A press inside the card must NOT close it — only the scrim around it.
    fireEvent.pointerDown(screen.getByText('Body'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.pointerDown(overlay());
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('leaves Escape alone when something inside has already claimed it', () => {
    // The History list backs out of an inline confirmation on Escape; closing
    // the whole dialog on the same keypress would throw the player out.
    const { onClose } = renderDialog(
      <button type="button" onKeyDown={(event) => event.preventDefault()}>
        Claims keys
      </button>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Claims keys' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores keys other than Escape and Tab', () => {
    const { onClose } = renderDialog();
    expect(press('Enter')).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Dialog focus management', () => {
  it('takes focus when it opens, on the first control when none is nominated', () => {
    renderDialog();
    // Not merely "not body": aria-modal hides everything outside this node, so
    // focus has to be within it or there is nothing for a screen reader to read.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('opens on the control the dialog nominates', () => {
    renderDialog(
      <>
        <button type="button">First in order</button>
        <button type="button" data-autofocus>
          Nominated
        </button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Nominated' })).toHaveFocus();
  });

  it('selects a nominated text field, so typing replaces what is there', () => {
    renderDialog(<input aria-label="Name" defaultValue="Dan" data-autofocus />);
    const field = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
  });

  it('wraps Tab and Shift+Tab inside the dialog', () => {
    renderDialog();
    const close = screen.getByRole('button', { name: 'Close' });
    const inside = screen.getByRole('button', { name: 'Inside' });

    inside.focus();
    // jsdom cannot move focus on Tab itself, so the trap has to be seen to
    // stop the browser (preventDefault) as well as to move focus.
    expect(press('Tab')).toBe(true);
    expect(close).toHaveFocus();

    expect(press('Tab', { shiftKey: true })).toBe(true);
    expect(inside).toHaveFocus();
  });

  it('lets Tab move normally between stops in the middle', () => {
    renderDialog(
      <>
        <button type="button">One</button>
        <button type="button">Two</button>
      </>,
    );
    screen.getByRole('button', { name: 'One' }).focus();
    expect(press('Tab')).toBe(false);
    expect(press('Tab', { shiftKey: true })).toBe(false);
  });

  it('holds Shift+Tab when focus is on the dialog container itself', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    // Clicking the title or any body text lands focus here, and the container
    // is inside itself — so "is it contained" was the wrong question.
    dialog.focus();
    expect(press('Tab', { shiftKey: true })).toBe(true);
    expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
  });

  it('pulls focus back in if it has escaped the dialog', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    renderDialog();
    outside.focus();
    expect(press('Tab')).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    outside.remove();
  });

  it.each([
    [
      'disabled',
      <button type="button" disabled key="x">
        Skipped
      </button>,
    ],
    ['hidden', <input type="file" hidden aria-label="Skipped" key="x" />],
    [
      'parked by a roving tabindex',
      <button type="button" tabIndex={-1} key="x">
        Skipped
      </button>,
    ],
  ])('treats a %s control as no tab stop when wrapping', (_, skipped) => {
    // If the trap's "last stop" is one the browser skips, Tab from the real
    // last stop is not intercepted and walks out of the modal.
    renderDialog(
      <>
        <button type="button">Real last</button>
        {skipped}
      </>,
    );
    screen.getByRole('button', { name: 'Real last' }).focus();
    expect(press('Tab')).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('counts a radio group as one stop, at its checked radio', () => {
    renderDialog(
      <>
        <input type="radio" name="theme" aria-label="System" defaultChecked />
        <input type="radio" name="theme" aria-label="Light" />
        <input type="radio" name="theme" aria-label="Dark" />
      </>,
    );
    // Tab leaves a radio group from whichever radio is checked — "System" here
    // — so that has to count as the last stop, not "Dark".
    screen.getByRole('radio', { name: 'System' }).focus();
    expect(press('Tab')).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    expect(press('Tab', { shiftKey: true })).toBe(true);
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus();
  });

  it('counts an unchosen radio group as one stop, at its first radio', () => {
    renderDialog(
      <>
        <input type="radio" name="pick" aria-label="A" />
        <input type="radio" name="pick" aria-label="B" />
      </>,
    );
    screen.getByRole('button', { name: 'Close' }).focus();
    expect(press('Tab', { shiftKey: true })).toBe(true);
    expect(screen.getByRole('radio', { name: 'A' })).toHaveFocus();
  });

  it('does not let the browser steal focus when the scrim closes it', () => {
    const { onClose } = renderDialog();
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    overlay().dispatchEvent(event);

    expect(onClose).toHaveBeenCalledOnce();
    // The browser's focus-on-press runs after the dialog has unmounted and
    // restored focus, and the scrim is not focusable — so left to itself it
    // drops focus on <body>. Only preventDefault stops that.
    expect(event.defaultPrevented).toBe(true);
  });

  it('gives focus back to whatever opened it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = renderDialog();
    expect(opener).not.toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  describe('when focus cannot simply go back', () => {
    /** A home for focus, as the App provides one: a button outside the dialog. */
    function withHome(children: ReactNode) {
      const home = document.createElement('button');
      home.textContent = 'Home';
      document.body.append(home);
      const focusHome = vi.fn(() => {
        home.focus();
        return true;
      });
      const view = render(
        <FocusHomeContext value={focusHome}>
          <Dialog title="Test" onClose={vi.fn()}>
            {children}
          </Dialog>
        </FocusHomeContext>,
      );
      return { ...view, home, focusHome };
    }

    let stop: (() => void) | null = null;
    afterEach(() => {
      stop?.();
      stop = null;
      document.body.replaceChildren();
    });

    it('sends focus home when the opener has left the page', () => {
      // A cell under the board the dialog hid, as Safari leaves a clicked
      // button unfocused.
      stop = trackInputModality();
      fireEvent.keyDown(document.body, { key: 'Enter' });
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      const { unmount, home } = withHome(<p>Body</p>);
      opener.remove();
      unmount();
      expect(home).toHaveFocus();
    });

    it('sends focus home when it opened by itself, with nothing focused', () => {
      stop = trackInputModality();
      fireEvent.keyDown(document.body, { key: 'Enter' });
      const { unmount, home } = withHome(<p>Body</p>);
      unmount();
      expect(home).toHaveFocus();
    });

    it('gives focus back to its opener when opened from the keyboard', () => {
      stop = trackInputModality();
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      fireEvent.keyDown(opener, { key: 'Enter' });
      const { unmount, focusHome } = withHome(<p>Body</p>);
      unmount();
      expect(opener).toHaveFocus();
      expect(focusHome).not.toHaveBeenCalled();
    });

    it('sends focus home when opened with a pointer, so Space is not the opener’s again', () => {
      stop = trackInputModality();
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      fireEvent.pointerDown(opener);
      const { unmount, home } = withHome(<p>Body</p>);
      unmount();
      expect(home).toHaveFocus();
    });

    it('settles for the opener when opened with a pointer and there is no home', () => {
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      const { unmount } = renderDialog();
      unmount();
      expect(opener).toHaveFocus();
    });
  });

  it('closes with the app’s own close icon', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Close' }).querySelector('svg.icon')).not.toBeNull();
  });

  describe('a body too long for the card', () => {
    let overflow = 0;
    beforeEach(() => {
      overflow = 0;
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains('dialog__body') ? 300 + overflow : 0;
      });
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains('dialog__body') ? 300 : 0;
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('becomes a tab stop the keyboard can scroll, named by the title', () => {
      overflow = 500;
      renderDialog(<p>Long</p>);
      const body = screen.getByRole('region', { name: 'Test' });
      expect(body).toHaveClass('dialog__body', 'dialog__body--scrollable');
      expect(body).toHaveAttribute('tabindex', '0');
      // It joins the trap: Tab from the close button lands on it, and wraps from it.
      screen.getByRole('button', { name: 'Close' }).focus();
      expect(press('Tab')).toBe(false);
      body.focus();
      expect(press('Tab')).toBe(true);
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });

    it('stays out of the way when it fits, give or take a rounded pixel', () => {
      overflow = 1;
      renderDialog(<p>Short</p>);
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      expect(document.querySelector('.dialog__body')).not.toHaveAttribute('tabindex');
    });

    it('notices when it starts to overflow, as the card or its content changes size', () => {
      let notify = () => {};
      const observed: Element[] = [];
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            notify = callback;
          }
          observe(element: Element) {
            observed.push(element);
          }
          disconnect() {}
        },
      );
      renderDialog(<p>Grows</p>);
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      expect(observed).toContain(document.querySelector('.dialog__body'));
      expect(observed).toContain(screen.getByText('Grows'));
      overflow = 200;
      act(() => notify());
      expect(screen.getByRole('region', { name: 'Test' })).toBeInTheDocument();
    });
  });

  it('stops listening for keys once closed', () => {
    const { onClose, unmount } = renderDialog();
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
