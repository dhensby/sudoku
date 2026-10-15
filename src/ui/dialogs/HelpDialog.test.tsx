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
      'Your own puzzles',
      'Entering numbers',
      'Auto candidates',
      'Hints',
      'Mistakes',
      'Watching a solve',
      'Sharing a solve',
      'Comparing solves',
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

  it('says what sharing a solve does, and that watching one first costs the time', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Sharing a solve' }).closest('section')!;
    expect(section).toHaveTextContent(/turn on Include my solve and the link carries your solve/);
    expect(section).toHaveTextContent(/it's off until you turn it on/);
    // Product text, not an example: no sample name.
    expect(section).toHaveTextContent(
      /offers Watch your friend's solve \(with their name, if you or their link gave one\) with Start/,
    );
    expect(section).not.toHaveTextContent(/Dan/);
    expect(section).toHaveTextContent(/Once you've solved the puzzle yourself, watching is free/);
    expect(section).toHaveTextContent(
      /that puzzle never records a time for you — not the game you were playing, nor any later one/,
    );
    expect(section).toHaveTextContent(/no best, no average, no streak, and no time to share/);
  });

  it('says where to compare solves, what the chart and the board show, and that it changes nothing', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Comparing solves' }).closest('section')!;
    expect(section).toHaveTextContent(
      /Compare solves — beside Watch your friend's solve in the Solved dialog and in History/,
    );
    expect(section).toHaveTextContent(/yours a solid line, theirs dashed/);
    expect(section).toHaveTextContent(/Tap or drag along it, or use the arrow keys/);
    expect(section).toHaveTextContent(/only you had \(upright, underlined\)/);
    expect(section).toHaveTextContent(/Comparing changes nothing/);
    const row = within(screen.getByRole('table')).getByRole('row', { name: /^Compare solves/ });
    expect(row).toHaveTextContent(
      '← → a second, Page Up Page Down ten, Home End to the start or the end',
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
      ['Friends', 'Friends, at the foot of History'],
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
      /^A puzzle from a friend's link, one you enter yourself, or one that arrives while this tab is hidden, waits behind Start/,
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
    expect(screen.getByText(/Everything stays in this browser/)).toHaveTextContent(
      'Everything stays in this browser: there are no accounts and no tracking. A link with your time carries a random ID for this browser, made the first time you share a time: the ID says nothing else about you.',
    );
  });

  it("says a link with a time carries a random ID for the browser, and what it's for", () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Racing friends' }).closest('section')!;
    expect(within(section).getByText(/^A share link carries/)).toHaveTextContent(
      "A share link carries the puzzle itself — and, once you have solved it, your time, your name, any help you took, your mistakes and a random ID for this browser, so a friend's game can tell your times from anyone else's.",
    );
  });

  it('says where Friends is, and that a name given there shows on every time, past ones too', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Racing friends' }).closest('section')!;
    expect(within(section).getByText(/at the foot of History, lists everyone/)).toHaveTextContent(
      "Friends, at the foot of History, lists everyone who has sent you a time. Give someone a name there and it's the one you'll see on all their times, past ones too, whatever their links call them; until you do, each time shows the name its link gave.",
    );
    // Product text, not an example: no sample name.
    expect(section).not.toHaveTextContent(/Dan/);
    // After History's row, where it is found.
    const actions = within(screen.getByRole('table'))
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent);
    expect(actions.indexOf('Friends')).toBe(actions.indexOf('History, share, settings, help') + 1);
  });

  it('says the first link from someone new asks who sent it, and what Skip leaves', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Racing friends' }).closest('section')!;
    expect(within(section).getByText(/^The first link from someone new/)).toHaveTextContent(
      "The first link from someone new asks who sent it, with the name from their link filled in. Skip it, and they go by their links' names until you name them in Friends.",
    );
    // Product text, not an example: no sample name.
    expect(section).not.toHaveTextContent(/Dan/);
  });

  it("says the names given friends leave this browser only in History's export", () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Privacy' }).closest('section')!;
    expect(within(section).getByText(/^The names you give friends/)).toHaveTextContent(
      "The names you give friends never leave this browser, except in History's export.",
    );
  });

  it('says a friend on two devices can be merged into one, and split apart again', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Racing friends' }).closest('section')!;
    expect(within(section).getByText(/^Someone who shares from two devices/)).toHaveTextContent(
      "Someone who shares from two devices arrives as two friends: say so when the second one's first link asks who sent it, or merge them in Friends. A merged friend lists their devices, and any of them can be split off again.",
    );
  });

  it('says links carry your mistakes, compared beside the help, and explains the dash', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/any help you took, your mistakes/)).toBeInTheDocument();
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
      'Each page counts as a hint the first time you see it, and says so; going back to a page you have seen, or opening Show me again, is free.',
    );
    expect(showMe).toHaveTextContent(
      'If a number on the board is wrong, or a candidate missing, it points at that instead, as Hint would.',
    );
  });

  it('says a hint names the next step, how far there is to go, and what each step costs', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const hints = screen.getByRole('heading', { name: 'Hints' }).closest('section')!;
    expect(within(hints).getByText(/names the next step towards it/)).toHaveTextContent(
      '“Step 1 of 7: a box/line reduction in column 8.” — and tints where the step is on the board, which stays while you select cells in it to make the step. Make the step and ask again, and it moves on: “Step 2 of 7”, and so on to the single that fills the cell.',
    );
    expect(within(hints).getByText(/Each step a hint names/)).toHaveTextContent(
      'Each step a hint names counts as a hint, once: asking again before you have made it is free, and so is a step you have already seen, however the route around it changes, whichever cell it is on the way to. Come back to a cell after placing numbers elsewhere, and if they have moved it on to a step you haven’t seen, it says so without naming it: ask again for its next step.',
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
      /It ticks each time help is counted, so you can see that asking again for a hint you already have was free; Show me says what each page cost as you turn to it;/,
    );
    expect(shown).toHaveTextContent(/“Hint \(2 used\)”\. Turning it off only hides the count\./);
  });

  it('says what Beyond Expert is, where it comes from, and what Hint can do there', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Difficulty' }).parentElement!;
    expect(section).toHaveTextContent(
      /Beyond Expert is a puzzle that needs more than every technique the game knows\. The game never makes one, so you'll only meet one in a link or a puzzle you enter\./,
    );
    expect(section).toHaveTextContent(
      /Hint can only point at the cell with the fewest candidates, and there's no Show me\./,
    );
    // An Expert needed early is the game's own rule, not every puzzle's.
    expect(section).toHaveTextContent(/in a puzzle the game makes, needed while much of the grid/);
  });

  it('says how to type in a puzzle of your own, what is checked, and how its time counts', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Your own puzzles' }).closest('section')!;
    expect(section).toHaveTextContent(
      /Your puzzles…, last under Random puzzle in New game, lists the puzzles you've typed in from a newspaper or a book\. Enter a new puzzle opens an empty grid for another\./,
    );
    expect(section).toHaveTextContent(
      /a number fills a cell and moves on, Space, 0 or a dot leaves a cell blank, Backspace takes back the last number/,
    );
    // A finger copies a puzzle out as the keys do.
    expect(section).toHaveTextContent(
      /tap a cell, then numbers on the pad: each fills a cell and moves on, as one typed does/,
    );
    expect(section).toHaveTextContent(
      /“One solution: a Hard puzzle\.” Only then can you play or share it\./,
    );
    expect(section).toHaveTextContent(/Check every number against your copy/);
    expect(section).toHaveTextContent(
      /Share… sends a friend the puzzle alone, without starting it\. Play puts it behind Start, so you can share it from there too before you start\./,
    );
    expect(section).toHaveTextContent(
      /its time counts as a new puzzle's, towards your best and average/,
    );
    expect(section).not.toHaveTextContent(/forgets/);
    // Under Random puzzle in New game, as the dailies' section says.
    expect(
      screen.getByRole('heading', { name: 'Daily puzzles' }).closest('section'),
    ).toHaveTextContent(
      /under Random puzzle, with Your puzzles… after them for ones of your own\./,
    );
    const row = within(screen.getByRole('table')).getByRole('row', { name: /^Enter a puzzle/ });
    expect(row).toHaveTextContent(
      '1–9 fill and move on, Space or 0 leave a blank, Backspace goes back',
    );
    expect(row).toHaveTextContent(
      'New game › Your puzzles… › Enter a new puzzle, then tap a cell and a number',
    );
  });

  it('says how to paste a puzzle in, and what is read of it', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Your own puzzles' }).closest('section')!;
    expect(section).toHaveTextContent(
      /To paste one in whole, copied from a page or a file, press Paste or Ctrl\+V \(⌘\+V on a Mac\) on the grid\. Its 81 cells are read in order — a number for each given, a 0 or a dot for each blank, anything else skipped — and put in place of what you've typed\./,
    );
    const row = within(screen.getByRole('table')).getByRole('row', { name: /^Paste a puzzle in/ });
    expect(row).toHaveTextContent('Ctrl+V on the grid');
    expect(row).toHaveTextContent('Paste, in Enter a puzzle');
    expect(screen.getByText(/^On a Mac, undo with/)).toHaveTextContent(
      'On a Mac, undo with ⌘+Z, redo with ⌘+Shift+Z and paste with ⌘+V.',
    );
  });

  it('says every grid typed in is kept, how, and what can be done with it there', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Your own puzzles' }).closest('section')!;
    expect(section).toHaveTextContent(
      /Every grid you type in is kept in Your puzzles, finished or not: Save keeps it as it is, and Play, Share… and closing the grid keep it too\. Up to 1,000 are kept\./,
    );
    expect(section).toHaveTextContent(
      /Play or Share one that's ready, Edit one to carry on typing or put a number right, Rename one to tell it apart, or Delete it — its games stay in your history\./,
    );
    expect(section).toHaveTextContent(
      /Give it a name in Name, above the grid — “The Times #5,123”, say — to tell it apart in the list\. It's kept with the grid, and goes with its link\./,
    );
  });

  it("says the list of puzzles leaves this browser only in History's export, and a name with its link", () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Privacy' }).closest('section')!;
    expect(within(section).getByText(/^The list of your puzzles/)).toHaveTextContent(
      "The list of your puzzles never leaves this browser, except in History's export. A puzzle's name goes with its link when you share it.",
    );
  });

  it("says a puzzle's name goes with its link, and where the friend sees it", () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Racing friends' }).closest('section')!;
    expect(within(section).getByText(/^A puzzle you've named/)).toHaveTextContent(
      "A puzzle you've named, as you typed it in or in Your puzzles, sends its name with its link, solved or not: your friend sees it on the Start card and in their history, and it goes on with their link.",
    );
  });

  it('makes a puzzle you enter the one exception to a puzzle seen before not counting', () => {
    render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
    const section = screen.getByRole('heading', { name: 'Racing friends' }).closest('section')!;
    expect(within(section).getByText(/^A puzzle you've seen before/)).toHaveTextContent(
      /The one exception is a puzzle you enter yourself: typing in its numbers isn't seeing it, so its first game here counts\.$/,
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

  describe('HelpDialog on the daily puzzles', () => {
    it('explains the dailies, the calendar and its marks, and the streak rule', () => {
      render(<HelpDialog onBrowseTechniques={vi.fn()} onClose={vi.fn()} />);
      const section = screen.getByRole('heading', { name: 'Daily puzzles' }).parentElement!;
      expect(section).toHaveTextContent(/daily puzzle of each difficulty/);
      expect(section).toHaveTextContent(/your own midnight/);
      expect(section).toHaveTextContent(/Easy, Medium, Hard and Expert, left to right/);
      expect(section).toHaveTextContent(/started on its own day/);
      expect(section).toHaveTextContent(/never adds to a streak/);
      expect(section).toHaveTextContent(/Solved on another day, or after watching a solve/);
      for (const status of ['solved-on-the-day', 'solved-later', 'in-progress', 'not-started']) {
        expect(section.querySelector(`.daily-mark--${status}`)).not.toBeNull();
      }
      expect(
        within(screen.getByRole('table')).getByText('Daily calendar and streaks'),
      ).toBeVisible();
    });
  });
});
