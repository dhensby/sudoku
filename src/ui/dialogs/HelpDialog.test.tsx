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
      'Daily puzzles',
      'Entering numbers',
      'Auto candidates',
      'Hints',
      'Mistakes',
      'Watching a solve',
      'Difficulty',
      'The clock',
      'Racing friends',
      'Controls',
      'Privacy',
    ]);
  });

  it('says what counts as a mistake, and which slip is forgiven', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: 'Mistakes' });
    const section = heading.closest('section')!;
    expect(section).toHaveTextContent(/wrong numbers/);
    expect(section).toHaveTextContent(/counted apart as candidate mistakes/);
    expect(section).toHaveTextContent(/never change your time/);
    expect(section).toHaveTextContent(
      /A wrong number is forgiven if the right number was obvious .* put it right within 3 seconds, before changing anything else/,
    );
    // A struck candidate needs no obvious answer: only putting back in time.
    expect(section).toHaveTextContent(
      /A struck candidate is forgiven if you put it back within 3 seconds, before changing anything else or taking any help\./,
    );
  });

  it('describes the error counter and Check guesses, and which of them is help', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Mistakes' }).closest('section')!;
    expect(section).toHaveTextContent(
      /Show error counter, in Settings, shows your mistakes so far as you play, each once it counts .* It is not help, and is not recorded\./,
    );
    expect(section).toHaveTextContent(
      /Check guesses when entered, in Settings, strikes a wrong number through .* the moment you enter it, and it counts as a mistake at once, with nothing forgiven\./,
    );
    expect(section).toHaveTextContent(
      /Numbers entered before you turn it on are not checked, even when Undo or Redo brings them\s+back\./,
    );
    expect(section).toHaveTextContent(/It is help: .* “guesses checked as entered”/);
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

  it('says where to watch a solve, what the marks show, and that watching changes nothing', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Watching a solve' }).closest('section')!;
    expect(section).toHaveTextContent(
      /Watch your solve in the Solved dialog, or Watch on the game in History, plays it back/,
    );
    expect(section).toHaveTextContent(/mistakes, slips you put right in time, and help you took/);
    expect(section).toHaveTextContent(
      /up to 8×; the time beside it is the time you'd really taken/,
    );
    expect(section).toHaveTextContent(/Watching changes nothing/);
    const row = within(screen.getByRole('table')).getByRole('row', { name: /^Watch your solve/ });
    expect(row).toHaveTextContent(
      'Space to play or pause, ← → a move, Home End to the start or the solve',
    );
  });

  it('says where the menus are for what has no key', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const table = screen.getByRole('table');
    const rows = [
      ['Pause or resume', 'The timer'],
      ['Hint, check, reveal, reset', 'The “…” menu'],
      ['Show me how to solve a cell', 'Show me, after a hint'],
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

  it('says links carry your mistakes, compared beside the help, and explains the dash', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/any help you took and your mistakes/)).toBeInTheDocument();
    // The head-to-head shows a bare dash for a count not known, so Help names it as such.
    expect(screen.getByText(/compared row by row/)).toHaveTextContent(
      "A dash means the mistakes weren't recorded: a link from an older version of the game doesn't carry them, and a solve of yours that wasn't recorded move by move has none to show.",
    );
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

  it('says a cell remembers its hint, and what Show me does and costs', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const hints = screen.getByRole('heading', { name: 'Hints' }).closest('section')!;
    expect(within(hints).getByText(/without giving the number away/)).toBeInTheDocument();
    expect(within(hints).getByText(/A cell remembers its hint/)).toHaveTextContent(
      'brought up to date if numbers have been placed since, and asking for it again costs nothing more — and brings in any candidates you have changed since.',
    );
    const showMe = within(hints).getByText(/walks through the steps that solve that cell/);
    expect(showMe).toHaveTextContent(
      'Opening it counts as one more hint, the first time for each cell.',
    );
    expect(showMe).toHaveTextContent(
      'If a number on the board is wrong, or a candidate missing, it points at that instead, as Hint would.',
    );
  });

  it('says hints work from your own candidates, and point out one crossed out too soon', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const hints = screen.getByRole('heading', { name: 'Hints' }).closest('section')!;
    expect(within(hints).getByText(/It works from your own candidates/)).toHaveTextContent(
      'a step you have already taken is never the one it points you to again',
    );
    expect(within(hints).getByText(/left it out of your notes/)).toHaveTextContent(
      'If you have crossed out a candidate, or left it out of your notes, when nothing rules it out yet, Hint points at its cell first, without saying which number it is; Show me then names it, shows why it can’t be ruled out yet, and offers to put it back. Each counts as a hint; asking again is free until you change that cell’s candidates.',
    );
  });

  it('describes the help taken shown as you play, and the count on Hint', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const hints = screen.getByRole('heading', { name: 'Hints' }).closest('section')!;
    const shown = within(hints)
      .getByText(/Show help taken/)
      .closest('li')!;
    expect(shown).toHaveTextContent(
      /Show help taken, in Settings, is on until you turn it off: once you take any help, it shows what you have taken so far, as History does — “Auto candidates · 2 hints” — beside the timer \(above the controls on a phone held upright\), or just the counts, or their total \(“Help 3”\), where there is no room for more\./,
    );
    expect(shown).toHaveTextContent(
      /It ticks each time help is counted, so you can see that asking again for a hint you already have was free; Show me says what it cost as it opens;/,
    );
    expect(shown).toHaveTextContent(/“Hint \(2 used\)”\. Turning it off only hides the count\./);
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

  describe('HelpDialog on the daily puzzles', () => {
    it('explains the dailies, the calendar and its marks, and the streak rule', () => {
      render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
      const section = screen.getByRole('heading', { name: 'Daily puzzles' }).parentElement!;
      expect(section).toHaveTextContent(/daily puzzle of each difficulty/);
      expect(section).toHaveTextContent(/your own midnight/);
      expect(section).toHaveTextContent(/Easy, Medium, Hard and Expert, left to right/);
      expect(section).toHaveTextContent(/started on its own day/);
      expect(section).toHaveTextContent(/never adds to a streak/);
      for (const status of ['solved-on-the-day', 'solved-later', 'in-progress', 'not-started']) {
        expect(section.querySelector(`.daily-mark--${status}`)).not.toBeNull();
      }
      expect(
        within(screen.getByRole('table')).getByText('Daily calendar and streaks'),
      ).toBeVisible();
    });
  });
});
