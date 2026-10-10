import type { Digit, InputMode } from '../core';
import { EraseIcon, RedoIcon, UndoIcon } from './icons';
import { MoreMenu } from './MoreMenu';
import { keepFocus } from './keepFocus';
import { NumberPad } from './NumberPad';

export interface ControlsProps {
  /** The effective mode (the latched one, flipped while Shift or Alt is held). */
  mode: InputMode;
  autoCandidates: boolean;
  /** How many of each digit are placed (index 1–9). */
  counts: readonly number[];
  /** Everything is inert unless a game is being played. */
  isDisabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canCheckCell: boolean;
  canCheckPuzzle: boolean;
  canRevealCell: boolean;
  /** The hints used, for the "…" menu's Hint to say (see MoreMenu); 0 for none, or not shown. */
  hintsUsed?: number;
  onSetMode: (mode: InputMode) => void;
  onDigit: (digit: Digit) => void;
  onErase: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSetAutoCandidates: (enabled: boolean) => void;
  onHint: () => void;
  onCheckCell: () => void;
  onCheckPuzzle: () => void;
  onRevealCell: () => void;
  onReset: () => void;
}

const MODES: readonly { mode: InputMode; label: string }[] = [
  { mode: 'normal', label: 'Normal' },
  { mode: 'candidate', label: 'Candidate' },
];

/**
 * Everything beside (desktop) or below (phone) the board. Every control is a
 * direct child of one grid, so the stylesheet can lay the same buttons out
 * as NYT does on each: a column of mode toggle, 3×3 pad, Erase/Undo/Redo
 * and the switches on a desktop; mode toggle beside Undo and Redo, a pad of
 * two rows of five with Erase as the tenth key, then the switches, on a phone.
 */
export function Controls({
  mode,
  autoCandidates,
  counts,
  isDisabled,
  canUndo,
  canRedo,
  canCheckCell,
  canCheckPuzzle,
  canRevealCell,
  hintsUsed = 0,
  onSetMode,
  onDigit,
  onErase,
  onUndo,
  onRedo,
  onSetAutoCandidates,
  onHint,
  onCheckCell,
  onCheckPuzzle,
  onRevealCell,
  onReset,
}: ControlsProps) {
  return (
    <div className="controls">
      <div className="mode-toggle" role="group" aria-label="Input mode">
        {MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            className="mode-toggle__option"
            aria-pressed={mode === option.mode}
            disabled={isDisabled}
            onMouseDown={keepFocus}
            onClick={() => onSetMode(option.mode)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <NumberPad mode={mode} counts={counts} isDisabled={isDisabled} onDigit={onDigit} />

      <button
        type="button"
        className="control control--erase"
        disabled={isDisabled}
        onMouseDown={keepFocus}
        onClick={onErase}
      >
        <EraseIcon />
        <span className="control__label">Erase</span>
      </button>
      <button
        type="button"
        className="control control--undo"
        disabled={isDisabled || !canUndo}
        onMouseDown={keepFocus}
        onClick={onUndo}
      >
        <UndoIcon />
        <span className="control__label">Undo</span>
      </button>
      <button
        type="button"
        className="control control--redo"
        disabled={isDisabled || !canRedo}
        onMouseDown={keepFocus}
        onClick={onRedo}
      >
        <RedoIcon />
        <span className="control__label">Redo</span>
      </button>

      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={autoCandidates}
        disabled={isDisabled}
        onMouseDown={keepFocus}
        onClick={() => onSetAutoCandidates(!autoCandidates)}
      >
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
        <span className="switch__label">Auto Candidate Mode</span>
      </button>

      <MoreMenu
        isDisabled={isDisabled}
        canCheckCell={canCheckCell}
        canCheckPuzzle={canCheckPuzzle}
        canRevealCell={canRevealCell}
        hintsUsed={hintsUsed}
        onHint={onHint}
        onCheckCell={onCheckCell}
        onCheckPuzzle={onCheckPuzzle}
        onRevealCell={onRevealCell}
        onReset={onReset}
      />
    </div>
  );
}
