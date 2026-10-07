import { DAILY_EPOCH, type DateKey, type Difficulty } from '../core';
import { DIFFICULTIES } from '../storage/storage';
import type { DailyStatus } from '../storage/streaks';
import { DailyMark } from './DailyMark';
import { DIFFICULTY_LABEL, formatLongDay, formatShortDay } from './format';
import { NewGameIcon } from './icons';
import { Menu } from './Menu';

/** Today's dailies as the menu offers them. */
export interface TodayDailies {
  /** The player's date, worked out as the menu opened. */
  date: DateKey;
  /** How each tier's daily stands. */
  statuses: Readonly<Record<Difficulty, DailyStatus>>;
}

export interface DifficultyMenuProps {
  /** The tier on show, marked in the list of random puzzles — or, for a daily, in today's. */
  current: Difficulty;
  /**
   * The date of the daily on show, if the game is one: no random tier stands
   * for it, but today's own daily of the tier is marked when it is today's.
   */
  dailyOnShow?: DateKey | null;
  today: TodayDailies;
  /** Start a new random game of a tier. */
  onSelect: (difficulty: Difficulty) => void;
  /** Open today's daily of a tier: resumed if unfinished, offered again if solved. */
  onSelectDaily: (difficulty: Difficulty) => void;
  /** The menu is opening: bring `today` up to date (see `Menu`'s `onOpen`). */
  onOpen?: () => void;
}

/** How a daily's status reads after its tier in an accessible name: "Today's Hard puzzle, solved". */
const STATUS_NAME: Readonly<Record<DailyStatus, string>> = {
  'solved-on-the-day': 'solved',
  'solved-later': 'solved',
  'in-progress': 'in progress',
  'not-started': 'not started',
};

/**
 * What a daily's item shows at its end. Not started needs no words: its empty
 * mark says it. Solved has no tick: in this menu a tick marks the game on
 * show, and a solved daily on show would otherwise wear two.
 */
function statusDetail(status: DailyStatus) {
  if (status === 'in-progress') return 'In progress';
  if (status === 'not-started') return undefined;
  return 'Solved';
}

/**
 * New game, in two runs: today's daily puzzles — one of each tier, the same
 * for everyone today, each marked with how it stands; then a random puzzle
 * of each tier. The game on show is marked current wherever it is in the
 * menu — today's daily of its tier, or its random tier (though choosing it
 * still starts a new game like the others); a past day's daily is in
 * neither.
 *
 * A new game needs no confirmation: the one on screen is saved and stays
 * resumable from History. "Today" is worked out each time the menu opens, so
 * one left open across midnight — or opened in a tab left overnight — offers
 * the new day's puzzles.
 */
export function DifficultyMenu({
  current,
  dailyOnShow = null,
  today,
  onSelect,
  onSelectDaily,
  onOpen,
}: DifficultyMenuProps) {
  // Only on a device whose clock is set before Daily #1: there is no daily yet.
  const isBeforeDailies = today.date < DAILY_EPOCH;
  return (
    <Menu
      label="New game"
      className="menu--header menu--new-game"
      buttonClassName="icon-button"
      onOpen={onOpen}
      items={[
        {
          key: 'today',
          label: "Today's puzzles",
          aside: formatShortDay(today.date),
          name: `Today's puzzles, ${formatLongDay(today.date)}`,
          items: DIFFICULTIES.map((difficulty) => ({
            key: `daily-${difficulty}`,
            label: DIFFICULTY_LABEL[difficulty],
            name: `Today's ${DIFFICULTY_LABEL[difficulty]} puzzle, ${STATUS_NAME[today.statuses[difficulty]]}`,
            icon: <DailyMark status={today.statuses[difficulty]} />,
            detail: statusDetail(today.statuses[difficulty]),
            isCurrent: dailyOnShow === today.date && difficulty === current,
            disabled: isBeforeDailies,
            onSelect: () => onSelectDaily(difficulty),
          })),
        },
        {
          key: 'random',
          label: 'Random puzzle',
          items: DIFFICULTIES.map((difficulty) => ({
            key: difficulty,
            label: DIFFICULTY_LABEL[difficulty],
            isCurrent: dailyOnShow === null && difficulty === current,
            onSelect: () => onSelect(difficulty),
          })),
        },
      ]}
    >
      <NewGameIcon />
    </Menu>
  );
}
