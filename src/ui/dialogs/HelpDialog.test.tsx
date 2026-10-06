import { fireEvent, render, screen, within } from '@testing-library/react';
import { HelpDialog } from './HelpDialog';

describe('HelpDialog', () => {
  it('covers each topic under its own heading', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Help' });
    expect(
      within(dialog)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'How to play',
      'Entering numbers',
      'Auto candidates',
      'Hints',
      'Difficulty',
      'The clock',
      'Racing friends',
      'Controls',
      'Privacy',
    ]);
  });

  it('gives the controls for keyboard and for mouse or touch', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Action', 'Keyboard', 'Mouse / Touch']);
    const undo = within(table).getByRole('row', { name: /^Undo/ });
    expect(undo).toHaveTextContent('Ctrl+Z');
    // A way of playing that has no control for an action says so plainly.
    const held = within(table).getByRole('row', { name: /^Switch while held/ });
    expect(within(held).getAllByRole('cell')[1]).toHaveTextContent('—');
  });

  it('says where the menus are for what has no key', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const table = screen.getByRole('table');
    const rows = [
      ['Pause or resume', 'The timer'],
      ['Hint, check, reveal, reset', 'The “…” menu'],
      ['New game', 'The + button'],
      ['History, share, settings, help', 'on a phone, the ☰ menu'],
      ['Solving techniques', 'The header, or the question after a hint'],
    ];
    for (const [action, pointer] of rows) {
      const row = within(table).getByRole('row', { name: new RegExp(`^${action}`) });
      expect(within(row).getAllByRole('cell')[1]).toHaveTextContent(pointer);
    }
  });

  it('says when the clock runs, and what waits behind Start', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/the board hides until it runs again/)).toBeInTheDocument();
    expect(screen.getByText(/arrives while this tab is hidden/)).toHaveTextContent(
      'waits behind Start',
    );
    expect(screen.getByText(/carries on with a game you haven.t finished/)).toHaveTextContent(
      'Play again starts a solved puzzle afresh',
    );
    expect(
      screen.getByText(/only glanced at, without entering anything, isn.t kept/),
    ).toBeInTheDocument();
  });

  it('says that nothing leaves the browser and times are on trust', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Nothing is uploaded/)).toBeInTheDocument();
    expect(screen.getByText(/honour system/)).toBeInTheDocument();
    expect(screen.getByText(/Everything stays in this browser/)).toBeInTheDocument();
  });

  it('says Reset keeps the clock, and replays keep out of the records', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    expect(
      screen.getByText(
        'Reset clears the board but not the clock, so a time is always the whole time.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/seen before.*doesn.t count towards your best or average/),
    ).toHaveTextContent("even in a game you've since deleted");
    expect(screen.getByText(/shares the puzzle without your time/)).toBeInTheDocument();
  });

  it('says what a second Erase does, and that it leaves auto candidates alone', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/pressing it again clears your own candidates/)).toHaveTextContent(
      'Erase clears a number first; pressing it again clears your own candidates (in Auto Candidate Mode it leaves the candidates alone).',
    );
  });

  it('says how Check and Reveal mark a number, in shape as well as colour', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/mark your numbers/)).toHaveTextContent(
      'Check and Reveal, in the “…” menu, mark your numbers: a wrong one is struck through with a red slash, a right one gets a small tick in its corner, and a revealed one is written in italics. Each counts as an assist.',
    );
  });

  it('says a cell remembers its hint, and that asking for it again is free', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const hints = screen.getByRole('heading', { name: 'Hints' }).closest('section')!;
    expect(within(hints).getByText(/without giving the number away/)).toBeInTheDocument();
    expect(within(hints).getByText(/A cell remembers its hint/)).toHaveTextContent(
      'select it again and the hint is back, and asking for it again costs nothing more',
    );
  });

  it('leads from Difficulty to the guide to the solving techniques', () => {
    const onBrowseTechniques = vi.fn();
    render(<HelpDialog onBrowseTechniques={onBrowseTechniques} onClose={vi.fn()} />);
    expect(screen.getByText(/A hint names the technique for the next step/)).toHaveTextContent(
      "What's a hidden single?",
    );
    const browse = screen.getByRole('button', { name: 'Browse the solving techniques' });
    // In the Difficulty section, after its points.
    expect(browse.closest('section')).toHaveTextContent(/^Difficulty/);
    fireEvent.click(browse);
    expect(onBrowseTechniques).toHaveBeenCalledOnce();
  });

  it('closes from its close button', () => {
    const onClose = vi.fn();
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
