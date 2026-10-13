import { Fragment, type ReactNode } from 'react';
import { DailyMark } from '../DailyMark';
import { KEY_TEXT } from '../daily';
import { BookIcon } from '../icons';
import type { DailyStatus } from '../../storage/streaks';
import { Dialog } from './Dialog';

export interface HelpDialogProps {
  /** Swap Help for the guide to the solving techniques. */
  onBrowseTechniques: () => void;
  onClose: () => void;
}

/** A key combination: <kbd>Ctrl</kbd>+<kbd>Z</kbd>. */
function Combo({ keys }: { keys: readonly string[] }) {
  return (
    <span className="help__combo">
      {keys.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && '+'}
          <kbd>{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

/** One row of the controls table; `null` where that column has no way to do it. */
interface Control {
  action: string;
  keyboard: ReactNode;
  pointer: string | null;
}

const CONTROLS: readonly Control[] = [
  {
    action: 'Select a cell',
    keyboard: (
      <>
        <kbd>Tab</kbd> to the board
      </>
    ),
    pointer: 'Click or tap the cell',
  },
  { action: 'Move the selection', keyboard: 'Arrow keys', pointer: 'Tap another cell' },
  {
    action: 'Enter a number',
    keyboard: (
      <>
        <kbd>1</kbd>–<kbd>9</kbd>
      </>
    ),
    pointer: 'Number pad',
  },
  {
    action: 'Erase',
    keyboard: (
      <>
        <kbd>Backspace</kbd> or <kbd>Delete</kbd>
      </>
    ),
    pointer: 'Erase button',
  },
  { action: 'Switch Normal / Candidate', keyboard: <kbd>Space</kbd>, pointer: 'Mode buttons' },
  {
    action: 'Switch while held',
    keyboard: (
      <>
        Hold <kbd>Shift</kbd> or <kbd>Alt</kbd>
      </>
    ),
    pointer: null,
  },
  {
    action: 'Toggle one candidate',
    keyboard: null,
    pointer: 'Click its spot in the selected cell (mouse)',
  },
  {
    action: 'Undo',
    keyboard: <Combo keys={['Ctrl', 'Z']} />,
    pointer: 'Undo button',
  },
  {
    action: 'Redo',
    keyboard: (
      <>
        <Combo keys={['Ctrl', 'Shift', 'Z']} /> or <Combo keys={['Ctrl', 'Y']} />
      </>
    ),
    pointer: 'Redo button',
  },
  { action: 'Pause or resume', keyboard: <kbd>P</kbd>, pointer: 'The timer' },
  { action: 'Hint, check, reveal, reset', keyboard: null, pointer: 'The “…” menu' },
  { action: 'Show me how to solve a cell', keyboard: null, pointer: 'Show me, after a hint' },
  { action: 'New game, or today’s puzzles', keyboard: null, pointer: 'The + button' },
  {
    action: 'Daily calendar and streaks',
    keyboard: null,
    pointer: 'The calendar in the header (on a phone, the ☰ menu), or the + button',
  },
  {
    action: 'Enter a puzzle',
    keyboard: (
      <>
        <kbd>1</kbd>–<kbd>9</kbd> fill and move on, <kbd>Space</kbd> or <kbd>0</kbd> leave a blank,{' '}
        <kbd>Backspace</kbd> goes back
      </>
    ),
    pointer: 'New game › Your puzzles… › Enter a new puzzle, then tap a cell and a number',
  },
  {
    action: 'Watch your solve',
    keyboard: (
      <>
        <kbd>Space</kbd> to play or pause, <kbd>←</kbd> <kbd>→</kbd> a move, <kbd>Home</kbd>{' '}
        <kbd>End</kbd> to the start or the solve
      </>
    ),
    pointer: 'The buttons and the bar under its board',
  },
  {
    action: 'Compare solves',
    keyboard: (
      <>
        <kbd>←</kbd> <kbd>→</kbd> a second, <kbd>Page Up</kbd> <kbd>Page Down</kbd> ten,{' '}
        <kbd>Home</kbd> <kbd>End</kbd> to the start or the end
      </>
    ),
    pointer: 'Tap or drag along the chart',
  },
  {
    action: 'History, share, settings, help',
    keyboard: null,
    pointer: 'The header (on a phone, the ☰ menu)',
  },
  { action: 'Friends', keyboard: null, pointer: 'Friends, at the foot of History' },
  {
    action: 'Solving techniques',
    keyboard: null,
    pointer: 'The header, or the question after a hint',
  },
];

/**
 * How to play, written to be scanned: short sections, bullets, and a controls
 * table with a column per way of playing. The Difficulty section leads on to
 * the guide to the solving techniques, which takes Help's place.
 */
export function HelpDialog({ onBrowseTechniques, onClose }: HelpDialogProps) {
  return (
    <Dialog title="Help" onClose={onClose} className="dialog--wide dialog--help">
      <div className="help">
        <section className="help__section">
          <h3 className="help__heading">How to play</h3>
          <ul className="help__list">
            <li>Fill every empty cell with a number from 1 to 9.</li>
            <li>Each row, each column and each 3×3 box holds every number exactly once.</li>
            <li>Every puzzle has exactly one solution, and none needs guessing.</li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Daily puzzles</h3>
          <ul className="help__list">
            <li>
              Every day has a daily puzzle of each difficulty — the same for everyone, so you can
              compare times with friends. A new day&apos;s puzzles arrive at your own midnight.
            </li>
            <li>
              Play today&apos;s from <strong>New game</strong>, under{' '}
              <strong>Today&apos;s puzzles</strong>. One you&apos;ve started carries on where you
              left off. Random puzzles are still there too, under <strong>Random puzzle</strong>,
              with <strong>Your puzzles…</strong> after them for ones of your own.
            </li>
            <li>
              The <strong>Daily puzzles</strong> calendar shows every day since the first, today
              ringed, with a mark for each difficulty — Easy, Medium, Hard and Expert, left to
              right. Pick a day to play it, carry on, or play it again. The marks:
              <span className="help__marks">
                {(Object.keys(KEY_TEXT) as DailyStatus[]).map((status) => (
                  <span key={status} className="help__mark">
                    <DailyMark status={status} />
                    {KEY_TEXT[status]}
                  </span>
                ))}
              </span>
            </li>
            <li>
              A <strong>streak</strong> counts the days in a row you&apos;ve solved a
              difficulty&apos;s daily, started on its own day — one begun before midnight and
              finished after still counts. Catching up on an earlier day is kept in the calendar and
              your history, but never adds to a streak.
            </li>
            <li>
              Sharing a daily names it. A friend who opens your link plays the same daily, and it
              counts towards their streak if they start it on the day.
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Your own puzzles</h3>
          <ul className="help__list">
            <li>
              <strong>Your puzzles…</strong>, last under Random puzzle in <strong>New game</strong>,
              lists the puzzles you&apos;ve typed in from a newspaper or a book.{' '}
              <strong>Enter a new puzzle</strong> opens an empty grid for another.
            </li>
            <li>
              Type it in row by row: a number fills a cell and moves on, <kbd>Space</kbd>,{' '}
              <kbd>0</kbd> or a dot leaves a cell blank, <kbd>Backspace</kbd> takes back the last
              number, and the arrow keys move — left and right from the end of a row to the start of
              the next, as typing does. Or tap a cell, then a number on the pad, which goes in where
              you tapped.
            </li>
            <li>
              A number twice in a row, column or box is marked at once, and a line by the grid says
              what the numbers make so far — too few for a puzzle, more than one solution, or none —
              until they make a puzzle with exactly one solution, and how hard it is: “One solution:
              a Hard puzzle.” Only then can you play or share it.
            </li>
            <li>
              Check every number against your copy: one wrong number can still make a puzzle, just
              not the one in the paper.
            </li>
            <li>
              <strong>Share…</strong> sends a friend the puzzle alone, without starting it.{' '}
              <strong>Play</strong> puts it behind <strong>Start</strong>, so you can share it from
              there too before you start. Once you&apos;ve solved it, Share sends your time with it,
              as for any puzzle.
            </li>
            <li>
              Typing it in isn&apos;t seeing it: its time counts as a new puzzle&apos;s, towards
              your best and average — unless you&apos;d seen it before, in a game here. One you
              haven&apos;t finished carries on where you left off; one you&apos;ve solved is offered
              to play again.
            </li>
            <li>
              Every grid you type in is kept in Your puzzles, finished or not: <strong>Save</strong>{' '}
              keeps it as it is, and Play, Share… and closing the grid keep it too. Up to 1,000 are
              kept.
            </li>
            <li>
              From the list, <strong>Play</strong> or <strong>Share</strong> one that&apos;s ready,{' '}
              <strong>Edit</strong> one to carry on typing or put a number right,{' '}
              <strong>Rename</strong> one to tell it apart, or <strong>Delete</strong> it — its
              games stay in your history.
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Entering numbers</h3>
          <ul className="help__list">
            <li>
              <strong>Normal</strong> mode places a number. <strong>Candidate</strong> mode pencils
              in small notes instead — the numbers a cell might still be.
            </li>
            <li>
              Press <kbd>Space</kbd> to switch modes, or hold <kbd>Shift</kbd> or <kbd>Alt</kbd> to
              switch only while the key is down.
            </li>
            <li>
              Erase clears a number first; pressing it again clears your own candidates (in Auto
              Candidate Mode it leaves the candidates alone).
            </li>
            <li>
              <strong>Check</strong> and <strong>Reveal</strong>, in the “…” menu, mark your
              numbers: a wrong one is struck through with a red slash, a right one gets a small tick
              in its corner, and a revealed one is written in italics. Each counts as an assist.
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Auto candidates</h3>
          <ul className="help__list">
            <li>
              Fills every empty cell with the numbers not yet ruled out by its row, column and box,
              and keeps them up to date as you play.
            </li>
            <li>
              Candidates you remove yourself stay removed, even after switching it off and on again.
            </li>
            <li>Using it is recorded as an assist next to your time.</li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Hints</h3>
          <ul className="help__list">
            <li>
              <strong>Hint</strong>, in the “…” menu, points at a cell you can fill next and names
              the next step towards it, without giving the number away. Where the cell takes several
              steps, it says how far there is to go — “Step 1 of 7: a box/line reduction in column
              8.” — and tints where the step is on the board, which stays while you select cells in
              it to make the step. Make the step and ask again, and it moves on: “Step 2 of 7”, and
              so on to the single that fills the cell. It works from your own candidates — the
              automatic ones less those you crossed out, or your notes, with a cell you haven’t
              marked counting as having every candidate — so a step you have already taken is never
              the one it points you to again, and it stays with its cell while you fill in others.
            </li>
            <li>
              Each step a hint names counts as a hint, once: asking again before you have made it is
              free, and so is a step you have already seen, however the route around it changes,
              whichever cell it is on the way to. Come back to a cell after placing numbers
              elsewhere, and if they have moved it on to a step you haven’t seen, it says so without
              naming it: ask again for its next step.
            </li>
            <li>
              If you have crossed out a candidate, or left it out of your notes, when nothing rules
              it out yet, Hint points at its cell first, without saying which number it is;{' '}
              <strong>Show me</strong> then names it, shows why it can’t be ruled out yet, and
              offers to put it back. Each counts as a hint; asking again is free until you change
              that cell’s candidates.
            </li>
            <li>
              A cell remembers its hint: select it again and the hint is back, brought up to date if
              numbers have been placed since, and asking for it again costs nothing more — and
              brings in any candidates you have changed since.
            </li>
            <li>
              Still stuck? <strong>Show me</strong>, beside the hint, walks through the steps that
              solve that cell, a page each, numbered as the hint numbers them, each drawn on your
              own board, and ends with the answer. Each page counts as a hint the first time you see
              it, and says so; going back to a page you have seen, or opening Show me again, is
              free. A step you have seen on a page is free when a hint names it. If a number on the
              board is wrong, or a candidate missing, it points at that instead, as Hint would.
            </li>
            <li>Hints are recorded next to your time, as checks and reveals are.</li>
            <li>
              <strong>Show help taken</strong>, in Settings, is on until you turn it off: once you
              take any help, it shows what you have taken so far, as History does — “Auto candidates
              · 2 hints” — beside the timer (above the controls on a phone held upright), or just
              the counts, or their total (“Help 3”), where there is no room for more. It ticks each
              time help is counted, so you can see that asking again for a hint you already have was
              free; Show me says what each page cost as you turn to it; and Hint in the “…” menu
              says how many you have used: “Hint (2 used)”. Turning it off only hides the count.
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Mistakes</h3>
          <p className="help__text">
            Once you&apos;ve solved a puzzle, it tells you your mistakes: wrong numbers, and,
            counted apart as candidate mistakes, a right number struck out of a cell&apos;s
            candidates. Mistakes never change your time. A wrong number is forgiven if the right
            number was obvious — the cell already held it, nothing else fitted there, or it fitted
            nowhere else in its row, column or box — and you put it right within 3 seconds, before
            changing anything else or taking any help. A struck candidate is forgiven if you put it
            back within 3 seconds, before changing anything else or taking any help.
          </p>
          <ul className="help__list">
            <li>
              <strong>Show error counter</strong>, in Settings, shows your mistakes so far as you
              play, each once it counts — so a slip you put right in time never shows. It is not
              help, and is not recorded.
            </li>
            <li>
              <strong>Check guesses when entered</strong>, in Settings, strikes a wrong number
              through with a red slash the moment you enter it, and it counts as a mistake at once,
              with nothing forgiven. Numbers entered before you turn it on are not checked, even
              when Undo or Redo brings them back. It is help: from the moment it is on, your time
              says “guesses checked as entered”, even if you turn it off again.
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Watching a solve</h3>
          <ul className="help__list">
            <li>
              Once you&apos;ve solved a puzzle, <strong>Watch your solve</strong> in the Solved
              dialog, or <strong>Watch</strong> on the game in History, plays it back move by move:
              every number, note, hint, undo and check, each with a caption saying what it was.
            </li>
            <li>
              Play and pause, step a move at a time, or drag along the bar. Marks along it show your
              mistakes, slips you put right in time, and help you took. Long pauses are shortened,
              and it plays at up to 8×; the time beside it is the time you&apos;d really taken.
            </li>
            <li>
              Watching changes nothing: the clock stays stopped, and your time and record stay as
              they were. A game from before solves were recorded move by move can&apos;t be watched.
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Sharing a solve</h3>
          <ul className="help__list">
            <li>
              When you share a time, turn on <strong>Include my solve</strong> and the link carries
              your solve as well, so your friend can watch how you did it. It makes the link longer,
              so it&apos;s off until you turn it on.
            </li>
            <li>
              A link with a solve offers <strong>Watch your friend&apos;s solve</strong> (with their
              name, if you or their link gave one) beside <strong>Start</strong>. Once you&apos;ve
              solved the puzzle yourself, watching is free: the Solved dialog and History offer it
              too.
            </li>
            <li>
              Watch before you&apos;ve solved it, and you&apos;ve seen every number go in, so the
              game asks first. If you watch anyway, that puzzle never records a time for you — not
              the game you were playing, nor any later one. You can still solve it, and it counts as
              solved, but with no time: no best, no average, no streak, and no time to share.
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Comparing solves</h3>
          <ul className="help__list">
            <li>
              Once you&apos;ve solved a puzzle a friend shared with their solve,{' '}
              <strong>Compare solves</strong> — beside{' '}
              <strong>Watch your friend&apos;s solve</strong> in the Solved dialog and in History —
              sets your solve against theirs. It needs both solves recorded move by move.
            </li>
            <li>
              A chart shows the cells each of you had solved as you played: yours a solid line,
              theirs dashed, with the mistakes that counted and the hints, checks and reveals you
              took marked on each. Tap or drag along it, or use the arrow keys, to pick a moment.
            </li>
            <li>
              The board below shows that moment: numbers you both had, numbers only you had
              (upright, underlined), only your friend had (slanted, with a dashed line), and, where
              you had different numbers, both, small. Comparing changes nothing, as watching
              doesn&apos;t.
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Difficulty</h3>
          <ul className="help__list">
            <li>
              <strong>Easy</strong>, <strong>Medium</strong> and <strong>Hard</strong> are pitched
              like the NYT puzzles of the same names: singles, then pointing pairs, then pairs and
              triples.
            </li>
            <li>
              <strong>Expert</strong> goes further, into techniques such as X-Wing, XY-Wing and
              Skyscraper — in a puzzle the game makes, needed while much of the grid is still empty.
            </li>
            <li>
              <strong>Beyond Expert</strong> is a puzzle that needs more than every technique the
              game knows. The game never makes one, so you&apos;ll only meet one in a link or a
              puzzle you enter. Once the techniques run out, Hint can only point at the cell with
              the fewest candidates, and there&apos;s no Show me.
            </li>
            <li>
              Every puzzle is graded by the hardest step it needs, a link&apos;s and one you enter
              included, so the label never lies.
            </li>
            <li>
              A hint names the technique for the next step. Not sure what that is? The question
              after it — <strong>What&apos;s a hidden single?</strong> — opens the guide to the
              solving techniques, which explains each one with a worked example.
            </li>
          </ul>
          <button
            type="button"
            className="button button--small help__guide"
            onClick={onBrowseTechniques}
          >
            <BookIcon />
            Browse the solving techniques
          </button>
        </section>

        <section className="help__section">
          <h3 className="help__heading">The clock</h3>
          <ul className="help__list">
            <li>
              The clock stops when you pause, switch tabs or open a dialog, and the board hides
              until it runs again.
            </li>
            <li>
              A puzzle from a friend&apos;s link, one you enter yourself, or one that arrives while
              this tab is hidden, waits behind <strong>Start</strong>, so the clock only counts time
              you could see the board.
            </li>
            <li>Your game is saved as you play, and reopens paused after a reload.</li>
            <li>
              When a new version of the game is out, a note at the foot of the screen says so, and{' '}
              <strong>Refresh</strong> loads it: your game reopens paused, as after any reload.
            </li>
            <li>
              In History, <strong>Resume</strong> carries on with a game you haven&apos;t finished,
              and <strong>Play again</strong> starts a solved puzzle afresh. A game you only glanced
              at, without entering anything, isn&apos;t kept.
            </li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Racing friends</h3>
          <ul className="help__list">
            <li>
              A share link carries the puzzle itself — and, once you have solved it, your time, your
              name, any help you took, your mistakes and a random ID for this browser, so a
              friend&apos;s game can tell your times from anyone else&apos;s.
            </li>
            <li>
              <strong>Friends</strong>, at the foot of History, lists everyone who has sent you a
              time. Give someone a name there and it&apos;s the one you&apos;ll see on all their
              times, past ones too, whatever their links call them; until you do, each time shows
              the name its link gave.
            </li>
            <li>
              The first link from someone new asks who sent it, with the name from their link filled
              in. Skip it, and they go by their links&apos; names until you name them in Friends.
            </li>
            <li>
              Someone who shares from two devices arrives as two friends: say so when the second
              one&apos;s first link asks who sent it, or merge them in Friends. A merged friend
              lists their devices, and any of them can be split off again.
            </li>
            <li>
              Your friend&apos;s solve and yours are compared row by row: the time, each kind of
              help, and the mistakes. The faster time wins; the rest is there to keep it fair. A
              dash means the mistakes weren&apos;t recorded: a link from an older version of the
              game doesn&apos;t carry them, and a solve of yours that wasn&apos;t recorded move by
              move has none to show.
            </li>
            <li>Nothing is uploaded: everything a friend needs is in the link.</li>
            <li>Reset clears the board but not the clock, so a time is always the whole time.</li>
            <li>
              A puzzle you&apos;ve seen before — even in a game you&apos;ve since deleted —
              doesn&apos;t count towards your best or average, and sharing it shares the puzzle
              without your time. The one exception is a puzzle you enter yourself: typing in its
              numbers isn&apos;t seeing it, so its first game here counts.
            </li>
            <li>Times are on the honour system. It's a game between friends.</li>
          </ul>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Controls</h3>
          <div className="help__table-wrap">
            <table className="help__table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Keyboard</th>
                  <th scope="col">Mouse / Touch</th>
                </tr>
              </thead>
              <tbody>
                {CONTROLS.map(({ action, keyboard, pointer }) => (
                  <tr key={action}>
                    <th scope="row">{action}</th>
                    <td>{keyboard ?? '—'}</td>
                    <td>{pointer ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help__note">
            On a Mac, undo with <Combo keys={['⌘', 'Z']} /> and redo with{' '}
            <Combo keys={['⌘', 'Shift', 'Z']} />.
          </p>
        </section>

        <section className="help__section">
          <h3 className="help__heading">Privacy</h3>
          <ul className="help__list">
            <li>
              Everything stays in this browser: there are no accounts and no tracking. A link with
              your time carries a random ID for this browser, made the first time you share a time:
              the ID says nothing else about you.
            </li>
            <li>
              The names you give friends never leave this browser, except in History&apos;s export.
            </li>
            <li>
              The names you give your puzzles, and the list itself, never leave this browser, except
              in History&apos;s export: a link to one carries its numbers, never its name.
            </li>
            <li>
              Some browsers clear a site's data after a while away. Export your history from the
              History screen to keep it safe.
            </li>
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
