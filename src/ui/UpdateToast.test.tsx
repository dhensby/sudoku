import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UPDATE_TEXT, UpdateToast, type UpdateToastProps } from './UpdateToast';

const SPOKEN = 'A new version of Sudoku is ready. Refresh to use it.';

function renderToast(props: Partial<UpdateToastProps> = {}) {
  const all: UpdateToastProps = { version: null, isCovered: false, onRefresh: vi.fn(), ...props };
  const view = render(<UpdateToast {...all} />);
  const rerender = (next: Partial<UpdateToastProps>) =>
    view.rerender(<UpdateToast {...{ ...all, ...next }} />);
  return { ...view, rerender, props: all };
}

const region = () => screen.getByRole('status');
const toast = () => screen.queryByText(UPDATE_TEXT);
const refresh = () => screen.getByRole('button', { name: 'Refresh' });
const dismiss = () => screen.getByRole('button', { name: 'Dismiss' });

describe('UpdateToast', () => {
  it('shows nothing with no newer version, its status region already on the page', () => {
    renderToast();
    expect(toast()).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // On the page before there is anything to say, so the first thing said is
    // a change to it, which is what a live region speaks.
    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(region()).toBeEmptyDOMElement();
  });

  it('offers a newer version, and says so', () => {
    const { rerender } = renderToast();
    rerender({ version: 'new' });
    expect(toast()).toBeVisible();
    expect(refresh()).toBeVisible();
    expect(dismiss()).toBeVisible();
    expect(region()).toHaveTextContent(SPOKEN);
  });

  it('loads it on Refresh', () => {
    const { props } = renderToast({ version: 'new' });
    fireEvent.click(refresh());
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });

  it('never takes focus from the board when pressed', () => {
    renderToast({ version: 'new' });
    expect(fireEvent.mouseDown(refresh())).toBe(false);
    expect(fireEvent.mouseDown(dismiss())).toBe(false);
  });

  it('goes on Dismiss, and stays gone until a newer version still', () => {
    const { rerender } = renderToast({ version: 'new' });
    fireEvent.click(dismiss());
    expect(toast()).not.toBeInTheDocument();
    expect(region()).toBeEmptyDOMElement();

    // The same version, found again on the next look, is not offered again.
    rerender({ version: 'new', isCovered: true });
    rerender({ version: 'new', isCovered: false });
    expect(toast()).not.toBeInTheDocument();

    rerender({ version: 'newer' });
    expect(toast()).toBeVisible();
    expect(region()).toHaveTextContent(SPOKEN);
  });

  it('waits for a dialog to close before it shows, or says anything', () => {
    const { rerender } = renderToast({ version: 'new', isCovered: true });
    expect(toast()).not.toBeInTheDocument();
    expect(region()).toBeEmptyDOMElement();

    rerender({ version: 'new', isCovered: false });
    expect(toast()).toBeVisible();
    expect(region()).toHaveTextContent(SPOKEN);
  });

  it('steps aside for a dialog, and is not spoken again as it comes back', () => {
    const { rerender } = renderToast({ version: 'new' });
    const said = region().firstChild;

    rerender({ version: 'new', isCovered: true });
    expect(toast()).not.toBeInTheDocument();
    rerender({ version: 'new', isCovered: false });
    expect(toast()).toBeVisible();
    // The words were never taken away and put back: nothing changed to speak.
    expect(region().firstChild).toBe(said);
  });

  it('goes if the version deployed is this page’s again', () => {
    const { rerender } = renderToast({ version: 'new' });
    rerender({ version: null });
    expect(toast()).not.toBeInTheDocument();
    expect(region()).toBeEmptyDOMElement();
  });
});
