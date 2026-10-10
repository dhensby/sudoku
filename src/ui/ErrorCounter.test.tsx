import { render, screen } from '@testing-library/react';
import { ErrorCounter, MistakeAnnouncer } from './ErrorCounter';

const counter = () => document.querySelector('.error-counter')!;
const status = () => screen.getByRole('status');

describe('ErrorCounter', () => {
  it('counts the mistakes so far, saying the whole of it to a screen reader', () => {
    render(<ErrorCounter mistakes={{ values: 2, candidates: 0 }} isShown placement="play" />);
    expect(counter()).toHaveTextContent(/^Mistakes 22 mistakes so far$/);
    expect(screen.getByText('2 mistakes so far')).toHaveClass('visually-hidden');
    expect(screen.getByText('Mistakes').closest('[aria-hidden]')).toHaveTextContent('Mistakes 2');
  });

  it('says nought as a count, not as nothing', () => {
    render(<ErrorCounter mistakes={{ values: 0, candidates: 0 }} isShown placement="play" />);
    expect(counter().querySelector('[aria-hidden]')).toHaveTextContent(/^Mistakes 0$/);
    expect(screen.getByText('No mistakes so far')).toBeInTheDocument();
  });

  it.each([
    [
      { values: 2, candidates: 1 },
      'Mistakes 2 · 1 candidate',
      '2 mistakes and 1 candidate mistake so far',
    ],
    [
      { values: 0, candidates: 3 },
      'Mistakes 0 · 3 candidates',
      '0 mistakes and 3 candidate mistakes so far',
    ],
    [{ values: 1, candidates: 0 }, 'Mistakes 1', '1 mistake so far'],
  ])('keeps candidate mistakes apart once there are any (%o)', (mistakes, shown, spoken) => {
    render(<ErrorCounter mistakes={mistakes} isShown placement="header" />);
    expect(counter().querySelector('[aria-hidden]')).toHaveTextContent(new RegExp(`^${shown}$`));
    expect(screen.getByText(spoken)).toBeInTheDocument();
  });

  it('shows a dash, never a nought, for a game whose mistakes are not known', () => {
    render(<ErrorCounter mistakes={null} isShown placement="play" />);
    expect(counter().querySelector('[aria-hidden]')).toHaveTextContent(/^Mistakes —$/);
    expect(counter()).toHaveAttribute('title', 'Not recorded for this game');
    expect(screen.getByText('Mistakes not recorded for this game')).toBeInTheDocument();
  });

  it('is empty while the board is hidden, but keeps its place', () => {
    render(
      <ErrorCounter mistakes={{ values: 2, candidates: 1 }} isShown={false} placement="play" />,
    );
    expect(counter()).toBeEmptyDOMElement();
    expect(counter()).toHaveClass('error-counter--play');
  });

  it('says where it sits, for the stylesheet to show the one that fits', () => {
    const { rerender } = render(<ErrorCounter mistakes={null} isShown placement="header" />);
    expect(counter()).toHaveClass('error-counter', 'error-counter--header');
    rerender(<ErrorCounter mistakes={null} isShown placement="play" />);
    expect(counter()).toHaveClass('error-counter', 'error-counter--play');
  });
});

describe('MistakeAnnouncer', () => {
  it('is a polite live region, silent to begin with, whatever the count a game opens with', () => {
    render(<MistakeAnnouncer mistakes={{ values: 3, candidates: 1 }} gameId="a" isShown />);
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(status()).toBeEmptyDOMElement();
  });

  it('says each mistake once, as it is counted', () => {
    const { rerender } = render(
      <MistakeAnnouncer mistakes={{ values: 0, candidates: 0 }} gameId="a" isShown />,
    );
    rerender(<MistakeAnnouncer mistakes={{ values: 1, candidates: 0 }} gameId="a" isShown />);
    expect(status()).toHaveTextContent('1 mistake counted.');
    const first = status().firstElementChild;
    rerender(<MistakeAnnouncer mistakes={{ values: 1, candidates: 0 }} gameId="a" isShown />);
    expect(status().firstElementChild).toBe(first);
    rerender(<MistakeAnnouncer mistakes={{ values: 1, candidates: 1 }} gameId="a" isShown />);
    expect(status()).toHaveTextContent('1 candidate mistake counted.');
    rerender(<MistakeAnnouncer mistakes={{ values: 3, candidates: 2 }} gameId="a" isShown />);
    expect(status()).toHaveTextContent('2 mistakes and 1 candidate mistake counted.');
  });

  it('says the same words again as a new message, so a live region speaks them', () => {
    const { rerender } = render(
      <MistakeAnnouncer mistakes={{ values: 0, candidates: 0 }} gameId="a" isShown />,
    );
    rerender(<MistakeAnnouncer mistakes={{ values: 1, candidates: 0 }} gameId="a" isShown />);
    const first = status().firstElementChild;
    rerender(<MistakeAnnouncer mistakes={{ values: 2, candidates: 0 }} gameId="a" isShown />);
    expect(status()).toHaveTextContent('1 mistake counted.');
    expect(status().firstElementChild).not.toBe(first);
  });

  it('says nothing for a count that falls, which a count never should', () => {
    const { rerender } = render(
      <MistakeAnnouncer mistakes={{ values: 2, candidates: 1 }} gameId="a" isShown />,
    );
    rerender(<MistakeAnnouncer mistakes={{ values: 1, candidates: 1 }} gameId="a" isShown />);
    expect(status()).toBeEmptyDOMElement();
  });

  it('says nothing while the board is hidden, and says a mistake counted meanwhile once it shows', () => {
    const { rerender } = render(
      <MistakeAnnouncer mistakes={{ values: 0, candidates: 0 }} gameId="a" isShown />,
    );
    rerender(<MistakeAnnouncer mistakes={{ values: 1, candidates: 0 }} gameId="a" isShown />);
    expect(status()).toHaveTextContent('1 mistake counted.');
    // Paused: what was said goes, and a mistake settling as it pauses is not said.
    rerender(
      <MistakeAnnouncer mistakes={{ values: 2, candidates: 0 }} gameId="a" isShown={false} />,
    );
    expect(status()).toBeEmptyDOMElement();
    // Shown again: said now, once.
    rerender(<MistakeAnnouncer mistakes={{ values: 2, candidates: 0 }} gameId="a" isShown />);
    expect(status()).toHaveTextContent('1 mistake counted.');
    const said = status().firstElementChild;
    rerender(<MistakeAnnouncer mistakes={{ values: 2, candidates: 0 }} gameId="a" isShown />);
    expect(status().firstElementChild).toBe(said);
    // Hidden and shown again with nothing new: nothing said again.
    rerender(
      <MistakeAnnouncer mistakes={{ values: 2, candidates: 0 }} gameId="a" isShown={false} />,
    );
    rerender(<MistakeAnnouncer mistakes={{ values: 2, candidates: 0 }} gameId="a" isShown />);
    expect(status()).toBeEmptyDOMElement();
  });

  it('says nothing for another game’s count, nor for a count that comes or goes unknown', () => {
    const { rerender } = render(
      <MistakeAnnouncer mistakes={{ values: 0, candidates: 0 }} gameId="a" isShown />,
    );
    rerender(<MistakeAnnouncer mistakes={{ values: 4, candidates: 0 }} gameId="b" isShown />);
    expect(status()).toBeEmptyDOMElement();
    rerender(<MistakeAnnouncer mistakes={null} gameId="b" isShown />);
    rerender(<MistakeAnnouncer mistakes={{ values: 5, candidates: 0 }} gameId="b" isShown />);
    expect(status()).toBeEmptyDOMElement();
  });
});
