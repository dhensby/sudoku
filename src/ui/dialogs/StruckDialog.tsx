import { useId } from 'react';
import { BOX, COL, ROW, bit, type Digit, type SolverBoard, type TechniqueTrace } from '../../core';
import { describePosition } from '../announce';
import { capitalise } from '../format';
import { TechniqueDiagram } from '../TechniqueDiagram';
import { Dialog } from './Dialog';

export interface StruckDialogProps {
  /** The cell whose answer is missing from its candidates, 0–80. */
  index: number;
  /** The digit that is missing: the cell's answer. */
  digit: Digit;
  /** The board as the player has it: the placed digits and their candidates. */
  board: SolverBoard;
  /**
   * Whether those candidates are the automatic ones less the player's
   * strikes (the digit was crossed out) or the player's notes (it was left
   * out of them): the words follow.
   */
  autoCandidates: boolean;
  /**
   * What opening it cost, said after its introduction ("2 hints used."),
   * as Show me's walkthrough says it; null when it was free.
   */
  charge?: string | null;
  /** Put the digit back among the cell's candidates — an ordinary, undoable move. */
  onPutBack: () => void;
  onClose: () => void;
}

/** The page's words that depend on how the digit went missing: crossed out, or never noted. */
function wordsFor(autoCandidates: boolean, digit: Digit) {
  return autoCandidates
    ? {
        intro: `${digit} has been crossed out of its candidates, but nothing on the board rules it out yet.`,
        key: 'Crossed out by you',
        label: 'Put it back',
        keep: 'keep it among its candidates',
        from: 'your candidates',
        action: `Put the ${digit} back`,
      }
    : {
        intro: `${digit} isn't in your notes here, but nothing on the board rules it out yet.`,
        key: 'Not in your notes',
        label: 'Pencil it in',
        keep: 'keep it in your notes',
        from: 'your notes',
        action: `Pencil in the ${digit}`,
      };
}

/** "an 8", "a 9". */
function aDigit(digit: number): string {
  return `${digit === 8 ? 'an' : 'a'} ${digit}`;
}

/**
 * The board drawn as a hidden single's is — the one digit's candidates
 * alone, its placed copies in ink, and the cell's row, column and box
 * shaded — though no technique is at work: that is just the picture of a
 * digit nothing rules out of a cell. The digit itself is drawn in the cell,
 * struck faintly, as the player left it out.
 */
function traceOf(board: SolverBoard, index: number, digit: Digit): TechniqueTrace {
  return {
    values: board.values,
    candidates: board.candidates,
    step: {
      technique: 'hiddenSingleBox',
      placement: null,
      eliminations: [],
      unit: null,
      pattern: [],
      houses: [
        { kind: 'row', index: ROW[index] },
        { kind: 'column', index: COL[index] },
        { kind: 'box', index: BOX[index] },
      ],
      digit,
    },
  };
}

/**
 * "Show me" for a wrong-marks hint: the digit the hint would not name, and
 * why it cannot be ruled out of the cell yet — no copy of it in the cell's
 * row, column or box, and no pattern among the candidates that removes it —
 * on one page, drawn on the player's own board, with a way to put it back:
 * among the automatic candidates, or into the notes, as the player has them.
 *
 * Laid out like a walkthrough's step, with the board beside its words on a
 * desktop and above them on a phone; focus starts on putting it back, which
 * is what the page is for, and is an ordinary move that Undo takes back. To
 * leave it out after all, close the page as any other.
 */
export function StruckDialog({
  index,
  digit,
  board,
  autoCandidates,
  charge = null,
  onPutBack,
  onClose,
}: StruckDialogProps) {
  const introId = useId();
  const position = describePosition(index);
  const words = wordsFor(autoCandidates, digit);
  const caption =
    `There's no ${digit} in row ${ROW[index] + 1}, in column ${COL[index] + 1} or in ` +
    `box ${BOX[index] + 1}, and no pattern among the candidates rules ${aDigit(digit)} out of ` +
    `${position}.`;
  return (
    <Dialog
      title={`Why ${position} can still be ${digit}`}
      onClose={onClose}
      className="dialog--walkthrough"
      describedBy={introId}
      footer={
        <button type="button" className="button button--primary" data-autofocus onClick={onPutBack}>
          {words.action}
        </button>
      }
    >
      <div className="walkthrough">
        <p className="walkthrough__intro" id={introId}>
          {words.intro}
          {charge !== null && (
            <>
              {' '}
              <span className="walkthrough__charge">{charge}</span>
            </>
          )}
        </p>
        <div className="walkthrough__step">
          <TechniqueDiagram
            trace={traceOf(board, index, digit)}
            caption={caption}
            target={index}
            targetLabel="The cell missing it"
            yours={[{ index, mask: bit(digit) }]}
            yoursLabel={words.key}
            conclusion={
              <p className="walkthrough__answer">
                <span className="walkthrough__answer-label">{words.label}</span>
                <span className="visually-hidden">: </span>
                <span className="struck__advice">
                  {capitalise(position)} can still be {digit}, so {words.keep} until something rules
                  it out — and hints can carry on from {words.from}.
                </span>
              </p>
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
