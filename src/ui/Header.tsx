import type { Difficulty } from '../core';
import { DifficultyMenu } from './DifficultyMenu';
import { DIFFICULTY_LABEL } from './format';
import { BookIcon, HelpIcon, HistoryIcon, MenuIcon, SettingsIcon, ShareIcon } from './icons';
import { keepFocus } from './keepFocus';
import { Menu } from './Menu';
import type { Phase } from './session';
import { Timer } from './Timer';
import type { HeaderDialog } from './useSudoku';

export interface HeaderProps {
  difficulty: Difficulty;
  elapsedMs: number;
  phase: Phase;
  showTimer: boolean;
  onPause: () => void;
  onResume: () => void;
  onNewGame: (difficulty: Difficulty) => void;
  onOpenDialog: (kind: HeaderDialog) => void;
}

/** The icon buttons beside New game, in the order they appear. */
const ACTIONS: readonly { kind: HeaderDialog; label: string; Icon: typeof HelpIcon }[] = [
  { kind: 'history', label: 'History', Icon: HistoryIcon },
  { kind: 'share', label: 'Share', Icon: ShareIcon },
  { kind: 'settings', label: 'Settings', Icon: SettingsIcon },
  { kind: 'techniques', label: 'Solving techniques', Icon: BookIcon },
  { kind: 'help', label: 'Help', Icon: HelpIcon },
];

/**
 * The tier in three or four letters, for a header with no room for the
 * whole word (a narrow phone with a large default font size). Shown in its
 * place by the stylesheet; assistive technology always hears the full name.
 */
const SHORT_LABEL: Readonly<Record<Difficulty, string>> = {
  easy: 'Easy',
  medium: 'Med',
  hard: 'Hard',
  expert: 'Exp',
};

/**
 * The bar across the top: the wordmark and the tier on the left, the timer
 * and the app's actions on the right. On a phone the five less-used actions
 * fold into an overflow menu (the stylesheet shows one or the other), so the
 * header stays one row and the board keeps the height a second would take.
 * The overflow has a menu icon of its own, so it is never confused with the
 * game's "…" menu of help.
 *
 * The icon buttons keep a mouse press from taking focus, like the on-screen
 * keys: focus stays on the board, so Space still flips the mode afterwards
 * instead of pressing the button again.
 */
export function Header({
  difficulty,
  elapsedMs,
  phase,
  showTimer,
  onPause,
  onResume,
  onNewGame,
  onOpenDialog,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="header__inner">
        <h1 className="header__title">Sudoku</h1>
        <p className="header__difficulty">
          <span className="visually-hidden">Difficulty: </span>
          <span className="header__tier">{DIFFICULTY_LABEL[difficulty]}</span>
          <span className="header__tier-short" aria-hidden="true">
            {SHORT_LABEL[difficulty]}
          </span>
        </p>
        <div className="header__timer">
          <Timer
            elapsedMs={elapsedMs}
            phase={phase}
            showTimer={showTimer}
            onPause={onPause}
            onResume={onResume}
          />
        </div>
        <div className="header__actions">
          <DifficultyMenu current={difficulty} onSelect={onNewGame} />
          {ACTIONS.map(({ kind, label, Icon }) => (
            <button
              key={kind}
              type="button"
              className="icon-button header__wide"
              aria-label={label}
              title={label}
              // Nothing to share until there is a puzzle.
              disabled={kind === 'share' && phase === 'loading'}
              onMouseDown={keepFocus}
              onClick={() => onOpenDialog(kind)}
            >
              <Icon />
            </button>
          ))}
          <Menu
            label="Menu"
            className="menu--header header__narrow"
            buttonClassName="icon-button"
            items={ACTIONS.map(({ kind, label, Icon }) => ({
              key: kind,
              label,
              icon: <Icon />,
              disabled: kind === 'share' && phase === 'loading',
              onSelect: () => onOpenDialog(kind),
            }))}
          >
            <MenuIcon />
          </Menu>
        </div>
      </div>
    </header>
  );
}
