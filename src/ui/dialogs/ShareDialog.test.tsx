import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { formatGrid, parseGrid } from '../../core';
import { WIKIPEDIA_PUZZLE } from '../../test/grids';
import { buildShareText, buildShareUrl, messageWithLink, shareBaseUrl } from '../share';
import { ShareDialog, type ShareDialogProps } from './ShareDialog';

const GIVENS = formatGrid(parseGrid(WIKIPEDIA_PUZZLE));
const NONE = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };
const RESULT = { seconds: 323, assists: { ...NONE, hints: 2 }, mistakes: null };

function renderShare(overrides: Partial<ShareDialogProps> = {}) {
  const props: ShareDialogProps = {
    givens: GIVENS,
    difficulty: 'hard',
    result: RESULT,
    playerName: 'Dan',
    onPlayerNameChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<ShareDialog {...props} />);
  return { ...view, props };
}

const dialog = () => screen.getByRole('dialog');
const status = () => within(dialog()).getByRole('status');
const button = (name: string) => within(dialog()).getByRole('button', { name });
const nameField = () =>
  within(dialog()).getByRole('textbox', { name: 'Your name (optional)' }) as HTMLInputElement;
const shownUrl = () => document.querySelector('.share__url')?.textContent;

/** The link the dialog should build for a name. */
const linkFor = (name: string) => buildShareUrl(shareBaseUrl(), GIVENS, { ...RESULT, name });
const RESULT_TEXT = buildShareText({ difficulty: 'hard', result: RESULT });

/** Install something on `navigator` for one test, restored afterwards. */
const stubs: Array<() => void> = [];
function stubNavigator(key: 'share' | 'canShare' | 'clipboard', value: unknown) {
  const had = Object.getOwnPropertyDescriptor(navigator, key);
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  stubs.push(() => {
    if (had) Object.defineProperty(navigator, key, had);
    else delete (navigator as unknown as Record<string, unknown>)[key];
  });
}

/**
 * Give every textarea a laid-out size for one test (jsdom lays nothing out).
 * The getters shadow the inherited ones; deleting them restores those.
 */
function stubTextareaLayout(
  sizes: Record<'scrollHeight' | 'offsetHeight' | 'clientHeight', number>,
) {
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(HTMLTextAreaElement.prototype, key, {
      configurable: true,
      get: () => value,
    });
    stubs.push(() => {
      delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>)[key];
    });
  }
}

afterEach(() => {
  while (stubs.length) stubs.pop()!();
  vi.unstubAllGlobals();
});

const fallbackField = () =>
  within(dialog()).getByRole('textbox', { name: 'Message and link' }) as HTMLTextAreaElement;

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(button(name));
  });
};

describe('ShareDialog', () => {
  describe('a puzzle on its own', () => {
    it('invites a friend, with no time and no name to give', () => {
      renderShare({ result: null });
      expect(screen.getByRole('dialog', { name: 'Share this puzzle' })).toBeInTheDocument();
      expect(within(dialog()).queryByRole('textbox')).toBeNull();
      expect(dialog()).toHaveTextContent('Try this Hard Sudoku!');
      expect(shownUrl()).toBe(buildShareUrl(shareBaseUrl(), GIVENS));
    });
  });

  describe('a solved time', () => {
    it('shows the message and the link with the time, name and help in it', () => {
      renderShare();
      expect(screen.getByRole('dialog', { name: 'Share your time' })).toBeInTheDocument();
      expect(document.querySelector('.share__text')?.textContent).toBe(RESULT_TEXT);
      expect(shownUrl()).toBe(linkFor('Dan'));
      expect(new URL(shownUrl()!).searchParams.get('a')).toBe('h2');
    });

    it('puts known mistakes in the message and the link, a clean solve as "m0"', () => {
      const { unmount } = renderShare({
        result: { ...RESULT, mistakes: { values: 1, candidates: 2 } },
      });
      expect(document.querySelector('.share__text')?.textContent).toBe(
        'Sudoku · Hard · 5:23\n1 mistake · 2 candidate mistakes · with 2 hints\nCan you beat my time?',
      );
      expect(new URL(shownUrl()!).searchParams.get('a')).toBe('h2m1x2');
      unmount();

      renderShare({ result: { ...RESULT, assists: NONE, mistakes: { values: 0, candidates: 0 } } });
      expect(new URL(shownUrl()!).searchParams.get('a')).toBe('m0');
    });

    it('starts the name field on the remembered name', () => {
      renderShare();
      expect(nameField().value).toBe('Dan');
    });

    it('updates the link as the name is typed, tidied as it will be sent', () => {
      const { props } = renderShare({ playerName: '' });
      fireEvent.change(nameField(), { target: { value: 'Ann ' } });
      // The field keeps the trailing space (a surname may follow it)…
      expect(nameField().value).toBe('Ann ');
      // …while the link already carries the tidy name.
      expect(shownUrl()).toBe(linkFor('Ann'));
      // Nothing is remembered on every keystroke.
      expect(props.onPlayerNameChange).not.toHaveBeenCalled();
    });

    it('hands the raw name up when the field loses focus, and shows it tidied', () => {
      const { props } = renderShare({ playerName: '' });
      fireEvent.change(nameField(), { target: { value: '  Ann   Lee ' } });
      fireEvent.blur(nameField());
      expect(props.onPlayerNameChange).toHaveBeenCalledExactlyOnceWith('  Ann   Lee ');
      expect(nameField().value).toBe('Ann Lee');
    });

    it('does not hand up a name that has not changed', () => {
      const { props } = renderShare();
      fireEvent.blur(nameField());
      fireEvent.change(nameField(), { target: { value: ' Dan ' } });
      fireEvent.blur(nameField());
      expect(props.onPlayerNameChange).not.toHaveBeenCalled();
    });

    it('keeps a name typed but never blurred when the dialog is closed', () => {
      // Escape and the scrim close without moving focus out of the field first.
      const { props } = renderShare({ playerName: '' });
      fireEvent.change(nameField(), { target: { value: 'Ann' } });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(props.onPlayerNameChange).toHaveBeenCalledExactlyOnceWith('Ann');
      expect(props.onClose).toHaveBeenCalledOnce();
    });
  });

  describe('copying', () => {
    it('copies the message and link together, and says so', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubNavigator('clipboard', { writeText });
      renderShare();
      expect(button('Copy')).toHaveFocus();
      await click('Copy');
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        messageWithLink(RESULT_TEXT, linkFor('Dan')),
      );
      expect(status()).toHaveTextContent('Copied to clipboard');
    });

    it('remembers a name typed just before copying, and copies it', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubNavigator('clipboard', { writeText });
      const { props } = renderShare({ playerName: '' });
      fireEvent.change(nameField(), { target: { value: 'Ann' } });
      await click('Copy');
      expect(props.onPlayerNameChange).toHaveBeenCalledWith('Ann');
      expect(writeText).toHaveBeenCalledWith(messageWithLink(RESULT_TEXT, linkFor('Ann')));
    });

    it('says so again on a second copy, which a live region would otherwise keep quiet', async () => {
      stubNavigator('clipboard', { writeText: vi.fn().mockResolvedValue(undefined) });
      renderShare();
      await click('Copy');
      const first = status().firstElementChild;
      await click('Copy');
      expect(status()).toHaveTextContent('Copied to clipboard');
      expect(status().firstElementChild).not.toBe(first);
    });

    it('shows the message selected for copying by hand when the clipboard fails', async () => {
      // jsdom has no clipboard, as an insecure page or an old browser has none.
      renderShare();
      await click('Copy');
      expect(status()).toHaveTextContent("Couldn't copy automatically.");
      const field = within(dialog()).getByRole('textbox', {
        name: 'Message and link',
      }) as HTMLTextAreaElement;
      expect(field).toHaveAttribute('readonly');
      expect(field.value).toBe(messageWithLink(RESULT_TEXT, linkFor('Dan')));
      expect(field).toHaveAccessibleDescription('Press Ctrl+C / ⌘C to copy.');
      expect(field).toHaveFocus();
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    });

    it('selects the message afresh when copying fails again', async () => {
      stubNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) });
      renderShare();
      await click('Copy');
      const field = within(dialog()).getByRole('textbox', {
        name: 'Message and link',
      }) as HTMLTextAreaElement;
      field.setSelectionRange(2, 2);
      button('Copy').focus();
      await click('Copy');
      expect(field).toHaveFocus();
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    });

    it('selects the whole message when it is focused or clicked', async () => {
      renderShare();
      await click('Copy');
      const field = within(dialog()).getByRole('textbox', {
        name: 'Message and link',
      }) as HTMLTextAreaElement;
      field.setSelectionRange(3, 3);
      fireEvent.click(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
      field.setSelectionRange(3, 3);
      fireEvent.focus(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
      // WebKit would put the caret down as the button comes up, undoing it.
      expect(fireEvent.mouseUp(field)).toBe(false);
    });

    it('explains a long press instead of a shortcut on a touchscreen', async () => {
      // A phone has no Ctrl+C: the field says how to copy there instead.
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: query.includes('pointer: coarse'), media: query })),
      );
      renderShare();
      await click('Copy');
      expect(fallbackField()).toHaveAccessibleDescription(
        'Touch and hold the text, then choose Copy.',
      );
    });

    it('keeps the keyboard shortcut where there is a mouse', async () => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: false, media: query })),
      );
      renderShare();
      await click('Copy');
      expect(fallbackField()).toHaveAccessibleDescription('Press Ctrl+C / ⌘C to copy.');
    });

    it('makes the copy-by-hand field as tall as its message, so none of it scrolls out of sight', async () => {
      // 120px of wrapped text inside 2px borders top and bottom.
      stubTextareaLayout({ scrollHeight: 120, offsetHeight: 50, clientHeight: 46 });
      renderShare();
      await click('Copy');
      expect(fallbackField().style.height).toBe('124px');
    });

    it('starts the copy-by-hand field with a row for each line of the message', async () => {
      renderShare();
      await click('Copy');
      const lines = messageWithLink(RESULT_TEXT, linkFor('Dan')).split('\n').length;
      expect(fallbackField()).toHaveAttribute('rows', String(lines));
      // Nothing laid out to measure, so no height is forced on it.
      expect(fallbackField().style.height).toBe('');
    });

    it('keeps the copy-by-hand message in step with the name', async () => {
      renderShare();
      await click('Copy');
      fireEvent.change(nameField(), { target: { value: 'Ann' } });
      expect(
        (within(dialog()).getByRole('textbox', { name: 'Message and link' }) as HTMLTextAreaElement)
          .value,
      ).toBe(messageWithLink(RESULT_TEXT, linkFor('Ann')));
    });
  });

  describe('the share sheet', () => {
    it('is offered only where the browser has one', () => {
      renderShare();
      expect(within(dialog()).queryByRole('button', { name: 'Share…' })).toBeNull();
    });

    it('is not offered where the browser says it cannot share this', () => {
      stubNavigator('share', vi.fn());
      stubNavigator(
        'canShare',
        vi.fn(() => false),
      );
      renderShare();
      expect(within(dialog()).queryByRole('button', { name: 'Share…' })).toBeNull();
    });

    it('opens on Share… where there is one, with Copy beside it', () => {
      stubNavigator('share', vi.fn());
      renderShare();
      // Each carries an icon, which leaves its name alone.
      expect(button('Share…').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(button('Copy').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(button('Share…')).toHaveFocus();
      expect(button('Share…')).toHaveClass('button--primary');
      expect(button('Copy')).not.toHaveClass('button--primary');
    });

    it('shares the message and link, and says so', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      stubNavigator('share', share);
      renderShare();
      await click('Share…');
      expect(share).toHaveBeenCalledExactlyOnceWith({
        title: 'Sudoku',
        text: RESULT_TEXT,
        url: linkFor('Dan'),
      });
      expect(status()).toHaveTextContent('Shared');
    });

    it('remembers a name typed just before sharing', async () => {
      stubNavigator('share', vi.fn().mockResolvedValue(undefined));
      const { props } = renderShare({ playerName: '' });
      fireEvent.change(nameField(), { target: { value: 'Ann' } });
      await click('Share…');
      expect(props.onPlayerNameChange).toHaveBeenCalledWith('Ann');
    });

    it('says nothing when the sheet is dismissed, and clears an older message', async () => {
      stubNavigator(
        'share',
        vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(Object.assign(new Error('dismissed'), { name: 'AbortError' })),
      );
      renderShare();
      await click('Share…');
      expect(status()).toHaveTextContent('Shared');
      await click('Share…');
      expect(status()).toBeEmptyDOMElement();
    });

    it('suggests copying when the sheet fails to open', async () => {
      stubNavigator('share', vi.fn().mockRejectedValue(new Error('NotAllowedError')));
      renderShare();
      await click('Share…');
      expect(status()).toHaveTextContent(
        "Couldn't open the share sheet. Copy the message instead.",
      );
    });

    it('opens one sheet however often it is pressed while one is open', async () => {
      let settle = () => {};
      const share = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          }),
      );
      stubNavigator('share', share);
      renderShare();
      fireEvent.click(button('Share…'));
      fireEvent.click(button('Share…'));
      expect(share).toHaveBeenCalledOnce();
      await act(async () => settle());
      // Once it closes, the next press opens another.
      await click('Share…');
      expect(share).toHaveBeenCalledTimes(2);
    });
  });

  describe('ShareDialog for a daily', () => {
    it('names the daily in the message, and puts its date in the link', () => {
      renderShare({ daily: '2026-10-13' });
      expect(document.querySelector('.share__text')?.textContent).toBe(
        'Sudoku Daily · 13 Oct 2026 · Hard · 5:23\nWith 2 hints\nCan you beat my time?',
      );
      expect(new URL(shownUrl()!).searchParams.get('d')).toBe('2026-10-13');
    });

    it('names a daily shared without a time too', () => {
      renderShare({ daily: '2026-10-13', result: null });
      expect(document.querySelector('.share__text')?.textContent).toBe(
        'Sudoku Daily · 13 Oct 2026 · Hard\nCan you solve it?',
      );
    });
  });
});

describe('including the solve', () => {
  const SOLVE = 'BBAxy-_z';
  const solveSwitch = () =>
    within(dialog()).getByRole('checkbox', { name: 'Include my solve' }) as HTMLInputElement;

  it('is offered, off, beside a time with a solve to go with it — saying what it costs the friend', () => {
    renderShare({ solve: SOLVE });
    expect(solveSwitch().checked).toBe(false);
    expect(solveSwitch()).toHaveAccessibleDescription(
      "Your friend can watch how you did it. If they watch before solving it themselves, they won't get a time for it.",
    );
    // Off: the link and message are a race's, as ever.
    expect(shownUrl()).toBe(linkFor('Dan'));
    expect(document.querySelector('.share__text')?.textContent).toBe(RESULT_TEXT);
  });

  it('puts the solve in the link, and a line in the message, once switched on — and takes them out again', () => {
    renderShare({ solve: SOLVE });
    fireEvent.click(solveSwitch());
    expect(solveSwitch().checked).toBe(true);
    expect(shownUrl()).toBe(
      buildShareUrl(shareBaseUrl(), GIVENS, { ...RESULT, name: 'Dan', log: SOLVE }),
    );
    expect(new URL(shownUrl()!).searchParams.get('s')).toBe(SOLVE);
    expect(document.querySelector('.share__text')?.textContent).toBe(
      buildShareText({ difficulty: 'hard', result: { ...RESULT, log: SOLVE } }),
    );
    fireEvent.click(solveSwitch());
    expect(shownUrl()).toBe(linkFor('Dan'));
  });

  it('copies the link with the solve in it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator('clipboard', { writeText });
    renderShare({ solve: SOLVE });
    fireEvent.click(solveSwitch());
    await act(async () => fireEvent.click(button('Copy')));
    expect(writeText.mock.calls[0][0]).toContain(`&s=${SOLVE}`);
  });

  it('is not offered without a solve', () => {
    renderShare().unmount();
    renderShare({ solve: null });
    expect(within(dialog()).queryByRole('checkbox')).toBeNull();
  });

  it('is not offered for the puzzle alone, whatever it is given', () => {
    renderShare({ result: null, solve: SOLVE });
    expect(within(dialog()).queryByRole('checkbox')).toBeNull();
    expect(new URL(shownUrl()!).searchParams.has('s')).toBe(false);
  });
});
