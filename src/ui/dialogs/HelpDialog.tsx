import { Fragment, type ReactNode } from 'react';
import { DailyMark } from '../DailyMark';
import { STATUS_TEXT } from '../daily';
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
    action: 'History, share, settings, help',
    keyboard: null,
    pointer: 'The header (on a phone, the ☰ menu)',
  },
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
              left off. Random puzzles are still there too, under <strong>Random puzzle</strong>.
            </li>
            <li>
              The <strong>Daily puzzles</strong> calendar shows every day since the first, today
              ringed, with a mark for each difficulty — Easy, Medium, Hard and Expert, left to
              right. Pick a day to play it, carry on, or play it again. The marks:
              <span className="help__marks">
                {(Object.keys(STATUS_TEXT) as DailyStatus[]).map((status) => (
                  <span key={status} className="help__mark">
                    <DailyMark status={status} />
                    {STATUS_TEXT[status]}
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
              the technique that gets you there, without giving the number away.
            </li>
            <li>
              A cell remembers its hint: select it again and the hint is back, brought up to date if
              the board has moved on, and asking for it again costs nothing more.
            </li>
            <li>
              Still stuck? <strong>Show me</strong>, beside the hint, walks through the steps that
              solve that cell, one at a time, each drawn on your own board, and ends with the
              answer. Opening it counts as one more hint, the first time for each cell. If a number
              on the board is wrong, it points at that instead, as Hint would.
            </li>
            <li>Hints are recorded next to your time, as checks and reveals are.</li>
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
          <h3 className="help__heading">Difficulty</h3>
          <ul className="help__list">
            <li>
              <strong>Easy</strong>, <strong>Medium</strong> and <strong>Hard</strong> are pitched
              like the NYT puzzles of the same names: singles, then pointing pairs, then pairs and
              triples.
            </li>
            <li>
              <strong>Expert</strong> goes further, into techniques such as X-Wing, XY-Wing and
              Skyscraper, needed while much of the grid is still empty.
            </li>
            <li>Every puzzle is graded by the hardest step it needs, so the label never lies.</li>
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
              A puzzle from a friend&apos;s link, or one that arrives while this tab is hidden,
              waits behind <strong>Start</strong>, so the clock only counts time you could see the
              board.
            </li>
            <li>Your game is saved as you play, and reopens paused after a reload.</li>
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
              name, any help you took and your mistakes.
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
              without your time.
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
            <li>Everything stays in this browser: there are no accounts and no tracking.</li>
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
