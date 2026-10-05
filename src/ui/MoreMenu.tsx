import { CheckIcon, HintIcon, MoreIcon, ResetIcon, RevealIcon } from './icons';
import { Menu } from './Menu';

export interface MoreMenuProps {
  /** Everything here changes the board, so none of it works while the board is hidden or solved. */
  isDisabled: boolean;
  /** The selected cell holds a value of the player's that can still be checked. */
  canCheckCell: boolean;
  /** Some cell holds a value of the player's that can still be checked. */
  canCheckPuzzle: boolean;
  /** The selected cell can still be revealed (not a given, not already locked). */
  canRevealCell: boolean;
  onHint: () => void;
  onCheckCell: () => void;
  onCheckPuzzle: () => void;
  onRevealCell: () => void;
  /** Ask to reset — the confirmation is the caller's. */
  onReset: () => void;
}

/**
 * The "…" menu: the help a player can ask for, each counted as an assist,
 * and Reset. Opens upwards, as it sits at the foot of the controls. A check
 * with nothing to check is disabled rather than left to do nothing.
 */
export function MoreMenu({
  isDisabled,
  canCheckCell,
  canCheckPuzzle,
  canRevealCell,
  onHint,
  onCheckCell,
  onCheckPuzzle,
  onRevealCell,
  onReset,
}: MoreMenuProps) {
  return (
    <Menu
      label="More"
      placement="above"
      className="menu--more"
      buttonClassName="more-button"
      disabled={isDisabled}
      items={[
        { key: 'hint', label: 'Hint', icon: <HintIcon />, onSelect: onHint },
        {
          key: 'check-cell',
          label: 'Check cell',
          icon: <CheckIcon />,
          disabled: !canCheckCell,
          onSelect: onCheckCell,
        },
        {
          key: 'check-puzzle',
          label: 'Check puzzle',
          icon: <CheckIcon />,
          disabled: !canCheckPuzzle,
          onSelect: onCheckPuzzle,
        },
        {
          key: 'reveal-cell',
          label: 'Reveal cell',
          icon: <RevealIcon />,
          disabled: !canRevealCell,
          onSelect: onRevealCell,
        },
        { key: 'reset', label: 'Reset puzzle…', icon: <ResetIcon />, onSelect: onReset },
      ]}
    >
      <MoreIcon />
    </Menu>
  );
}
