import type { Difficulty } from '../core';
import { DIFFICULTIES } from '../storage/storage';
import { DIFFICULTY_LABEL } from './format';
import { NewGameIcon } from './icons';
import { Menu } from './Menu';

export interface DifficultyMenuProps {
  /** The tier on show, marked in the list. */
  current: Difficulty;
  /** Start a new game of a tier. */
  onSelect: (difficulty: Difficulty) => void;
}

/**
 * New game: the four tiers, easiest first, with the current one marked —
 * though choosing it still starts a new game, like the others. A new game
 * needs no confirmation: the one on screen is saved and stays resumable from
 * History.
 */
export function DifficultyMenu({ current, onSelect }: DifficultyMenuProps) {
  return (
    <Menu
      label="New game"
      heading="New game"
      className="menu--header"
      buttonClassName="icon-button"
      items={DIFFICULTIES.map((difficulty) => ({
        key: difficulty,
        label: DIFFICULTY_LABEL[difficulty],
        isCurrent: difficulty === current,
        onSelect: () => onSelect(difficulty),
      }))}
    >
      <NewGameIcon />
    </Menu>
  );
}
