import { fireEvent, render, screen, within } from '@testing-library/react';
import { SpoilerDialog } from './SpoilerDialog';

function renderSpoiler(name: string | null = 'Dan') {
  const props = { name, onWatch: vi.fn(), onPlay: vi.fn(), onClose: vi.fn() };
  render(<SpoilerDialog {...props} />);
  return props;
}

describe('SpoilerDialog', () => {
  it('says plainly what watching costs, naming whose solve it is', () => {
    renderSpoiler();
    const dialog = screen.getByRole('dialog', { name: "Watch Dan's solve?" });
    expect(dialog).toHaveAccessibleDescription(
      "This shows every number Dan placed. You haven't solved this puzzle yet: if you watch now, you won't be able to record a time for it, now or later.",
    );
    // A name from a link, kept apart from the sentence around it.
    expect(dialog.querySelector('bdi')).toHaveTextContent('Dan');
  });

  it('keeps a right-to-left name apart from the words around it in the heading too', () => {
    renderSpoiler('سارة 2');
    const dialog = screen.getByRole('dialog', { name: "Watch سارة 2's solve?" });
    expect(dialog.querySelector('.dialog__title bdi')).toHaveTextContent(/^سارة 2$/);
    expect(dialog.querySelector('.confirm__message bdi')).toHaveTextContent(/^سارة 2$/);
  });

  it('opens on the safe choice, Play it first, with Watch anyway after it', () => {
    renderSpoiler();
    const footer = within(screen.getByRole('dialog'))
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(footer).toEqual(['', 'Play it first', 'Watch anyway']);
    expect(screen.getByRole('button', { name: 'Play it first' })).toHaveFocus();
  });

  it('hands each choice up, and Escape only closes', () => {
    const props = renderSpoiler();
    fireEvent.click(screen.getByRole('button', { name: 'Play it first' }));
    expect(props.onPlay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Watch anyway' }));
    expect(props.onWatch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onPlay).toHaveBeenCalledTimes(1);
    expect(props.onWatch).toHaveBeenCalledTimes(1);
  });

  it('names a friend whose link gave no name as your friend', () => {
    renderSpoiler(null);
    expect(screen.getByRole('dialog', { name: "Watch your friend's solve?" })).toHaveTextContent(
      'This shows every number your friend placed.',
    );
  });
});
