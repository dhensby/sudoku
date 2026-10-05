import { Fragment, type ReactNode } from 'react';
import { Dialog } from './Dialog';

export interface HelpDialogProps {
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
  { action: 'New game', keyboard: null, pointer: 'The + button' },
  {
    action: 'History, share, settings, help',
    keyboard: null,
    pointer: 'The header (on a phone, the ☰ menu)',
  },
];

/**
 * How to play, written to be scanned: short sections, bullets, and a controls
 * table with a column per way of playing.
 */
export function HelpDialog({ onClose }: HelpDialogProps) {
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
          <h3 className="help__heading">Difficulty</h3>
          <ul className="help__list">
            <li>
              <strong>Easy</strong>, <strong>Medium</strong> and <strong>Hard</strong> are pitched
              like the NYT puzzles of the same names: singles, then pointing pairs, then pairs and
              triples.
            </li>
            <li>
              <strong>Expert</strong> goes further, into techniques such as X-Wing and XY-Wing.
            </li>
            <li>Every puzzle is graded by the hardest step it needs, so the label never lies.</li>
          </ul>
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
              name and any help you took.
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
