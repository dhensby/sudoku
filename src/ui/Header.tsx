import type { ReactNode } from 'react';
import type { DateKey, Difficulty } from '../core';
import { DifficultyMenu, type TodayDailies } from './DifficultyMenu';
import { DIFFICULTY_LABEL, formatLongDay } from './format';
import {
  BookIcon,
  CalendarIcon,
  HelpIcon,
  HistoryIcon,
  MenuIcon,
  SettingsIcon,
  ShareIcon,
} from './icons';
import { keepFocus } from './keepFocus';
import { Menu } from './Menu';
import type { Phase } from './session';
import { Timer } from './Timer';
import type { HeaderDialog } from './useSudoku';

export interface HeaderProps {
  difficulty: Difficulty;
  /** The date of the daily on show (or on its way), if the game is one. */
  daily?: DateKey | null;
  elapsedMs: number;
  phase: Phase;
  showTimer: boolean;
  /** Today's dailies, for New game. */
  today: TodayDailies;
  onPause: () => void;
  onResume: () => void;
  onNewGame: (difficulty: Difficulty) => void;
  /** Open today's daily of a tier, from New game. */
  onOpenDaily: (difficulty: Difficulty) => void;
  /** New game is opening: bring today's dailies up to date. */
  onRefreshToday?: () => void;
  onOpenDialog: (kind: HeaderDialog) => void;
  /**
   * The error counter, while "Show error counter" is on, to sit beside the
   * timer where the header has room for it (the stylesheet decides where,
   * and makes the wordmark give way for it first).
   */
  errorCounter?: ReactNode;
}

/** The icon buttons beside New game, in the order they appear. */
const ACTIONS: readonly { kind: HeaderDialog; label: string; Icon: typeof HelpIcon }[] = [
  { kind: 'daily', label: 'Daily puzzles', Icon: CalendarIcon },
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
 * The bar across the top: the wordmark and the tier on the left — "Daily ·
 * Medium" for a daily, so it is plain which games build a streak — the timer
 * and the app's actions on the right. On a phone the six less-used actions
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
  daily = null,
  elapsedMs,
  phase,
  showTimer,
  today,
  onPause,
  onResume,
  onNewGame,
  onOpenDaily,
  onRefreshToday,
  onOpenDialog,
  errorCounter,
}: HeaderProps) {
  const className = ['header', daily !== null && 'header--daily', errorCounter && 'header--counter']
    .filter(Boolean)
    .join(' ');
  return (
    <header className={className}>
      <div className="header__inner">
        <h1 className="header__title">Sudoku</h1>
        <p className="header__difficulty">
          {daily !== null && (
            <span className="visually-hidden">Daily puzzle for {formatLongDay(daily)}. </span>
          )}
          <span className="visually-hidden">Difficulty: </span>
          {/* Dropped by the stylesheet on the narrowest headers; the words
              above say it all the same. */}
          {daily !== null && (
            <span className="header__daily" aria-hidden="true">
              Daily ·{' '}
            </span>
          )}
          <span className="header__tier">{DIFFICULTY_LABEL[difficulty]}</span>
          <span className="header__tier-short" aria-hidden="true">
            {SHORT_LABEL[difficulty]}
          </span>
        </p>
        {errorCounter}
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
          <DifficultyMenu
            current={difficulty}
            dailyOnShow={daily}
            today={today}
            onSelect={onNewGame}
            onSelectDaily={onOpenDaily}
            onOpenCalendar={() => onOpenDialog('daily')}
            onOpen={onRefreshToday}
          />
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
