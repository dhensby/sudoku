import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  STOPPED_CLOCK,
  elapsedMs,
  findHint,
  formatDuration,
  gridValues,
  isBoardFull,
  reduce,
  shownHint,
  toSeconds,
  valuesOf,
  type Difficulty,
  type Digit,
  type Direction,
  type GameState,
  type Hint,
  type InputMode,
  type Puzzle,
} from '../core';
import {
  computeStats,
  deleteRecord,
  exportHistory,
  findAttempts,
  importHistory,
  loadHistory,
  markSeen,
  saveCurrentId,
  savedGameIds,
  type Challenge,
  type DifficultyStats,
  type GameRecord,
  type ImportResult,
} from '../storage/history';
import {
  loadPreferences,
  setLastDifficulty,
  setPlayerName,
  updateSettings,
  type Settings,
} from '../storage/prefs';
import { DIFFICULTIES, browserStorage, type StorageLike } from '../storage/storage';
import { describeChange, type DescribedAction } from './announce';
import { DIFFICULTY_LABEL } from './format';
import { createPuzzleSource, type PuzzleSource } from './puzzleSource';
import type { GuideId } from './techniqueGuide';
import {
  attemptSource,
  hasBoardShown,
  isGlimpse,
  newSession,
  pauseSession,
  phaseOf,
  planStartup,
  puzzleOf,
  restoreSession,
  resumeSession,
  saveSession,
  shareTargetOf,
  shareTargetOfRecord,
  type ChallengeOffer,
  type Moment,
  type PauseReason,
  type Phase,
  type Session,
  type SessionStart,
  type ShareTarget,
} from './session';
import { clearShareParams } from './url';
import { useElapsed } from './useElapsed';
import { useStableActions } from './useStableActions';

export type { ChallengeOffer, PauseReason, Phase, ShareTarget } from './session';

export interface UseSudokuOptions {
  /** Where everything is saved. Defaults to localStorage (or memory where that is refused). */
  storage?: StorageLike;
  /** Where new puzzles come from. Defaults to the generator worker. */
  source?: PuzzleSource;
  /** The query string a share link arrives in. Defaults to `window.location.search`. */
  search?: string;
  /** The wall clock records are dated by. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * The clock play is timed by. Defaults to a monotonic one,
   * `performance.timeOrigin + performance.now()`, which setting the system
   * clock back cannot move (see `Moment`).
   */
  clock?: () => number;
}

/**
 * A line for the status region. `id` increments on every message so the
 * region re-announces even when the wording repeats — a live region is
 * silent if its text does not actually change.
 */
export interface Announcement {
  text: string;
  id: number;
}

/** Why the hint bar has something to say other than a hint. */
export type NoticeKind = 'badLink' | 'boardFull' | 'generationFailed' | 'resumeFailed';

/** A message for the hint bar, dismissed by the player (or by the board no longer being full). */
export interface Notice {
  kind: NoticeKind;
  text: string;
  /** Increments with every notice, so the same notice twice is a change React can see. */
  id: number;
}

/** What the completion dialog shows, fixed at the moment of the solve. */
export interface CompletionResult {
  difficulty: Difficulty;
  elapsedMs: number;
  assists: GameState['assists'];
  isNewBest: boolean;
  /** A puzzle the player had seen before: its time does not count towards the records. */
  isReplay: boolean;
  /** The tier's stats, this game included. */
  stats: DifficultyStats;
  challenge: Challenge | null;
}

/** The dialog on show — one at a time. */
export type DialogState =
  | { kind: 'completion'; result: CompletionResult }
  /** `returnTo` reopens History when the share was started from it. */
  | { kind: 'share'; target: ShareTarget; returnTo: 'history' | null }
  | { kind: 'history' }
  | { kind: 'settings' }
  | { kind: 'help' }
  /** The technique guide, open at the entry a hint named (null: its first entry). */
  | { kind: 'techniques'; initial: GuideId | null }
  | { kind: 'challenge'; offer: ChallengeOffer }
  | { kind: 'confirmReset' };

/** The dialogs the header opens. */
export type HeaderDialog = 'history' | 'settings' | 'techniques' | 'help' | 'share';

/** What the History dialog lists, read from storage when it opens. */
export interface HistoryView {
  records: readonly GameRecord[];
  resumableIds: ReadonlySet<string>;
  /** When it was read: the dialog's "today" and "yesterday" are relative to this. */
  now: number;
}

/** Everything the game does. Identities are stable for the hook's lifetime. */
export interface SudokuActions {
  select: (index: number) => void;
  move: (direction: Direction) => void;
  /** Enter a digit at the selected cell in the effective mode. */
  enterDigit: (digit: Digit) => void;
  /** Toggle a candidate in a cell whatever the mode (a click on its spot in the selected cell). */
  toggleCandidate: (index: number, digit: Digit) => void;
  erase: () => void;
  setMode: (mode: InputMode) => void;
  toggleMode: () => void;
  setAutoCandidates: (enabled: boolean) => void;
  undo: () => void;
  redo: () => void;
  hint: () => void;
  check: (scope: 'cell' | 'puzzle') => void;
  reveal: () => void;
  /** Ask before resetting (opens the confirmation). */
  requestReset: () => void;
  confirmReset: () => void;
  pause: () => void;
  /** Resume a paused game, or start one waiting behind its Start button. */
  resume: () => void;
  newGame: (difficulty: Difficulty) => void;
  retry: () => void;
  openDialog: (kind: HeaderDialog) => void;
  /**
   * Open the technique guide at an entry — the one a hint named — or at its
   * start. From Help, it takes Help's place.
   */
  openTechniques: (initial: GuideId | null) => void;
  closeDialog: () => void;
  /** From the completion dialog: share the time just set. */
  shareResult: () => void;
  /** From the challenge dialog: a fresh attempt at the linked puzzle (or the unfinished one, if there is one). */
  playAgain: () => void;
  resumeRecord: (id: string) => void;
  /** Play a history entry's puzzle again: the unfinished attempt at it if there is one, else a fresh one. */
  replayRecord: (id: string) => void;
  shareRecord: (id: string) => void;
  deleteRecord: (id: string) => void;
  exportHistory: () => string;
  importHistory: (json: string) => ImportResult;
  updateSettings: (patch: Partial<Settings>) => void;
  setPlayerName: (name: string) => void;
  /** Shift or Alt went down (true) or up (false): the mode flips while either is held. */
  setModifier: (key: string, isDown: boolean) => void;
  clearModifiers: () => void;
  dismissNotice: () => void;
}

export interface Sudoku {
  phase: Phase;
  /** Why the clock is stopped, while the game is unsolved. */
  pauseReason: PauseReason | null;
  /** The game on screen; null until the first puzzle arrives. */
  game: GameState | null;
  /**
   * The hint for the hint bar: the one just asked for, until the next
   * change, and otherwise the selected cell's remembered hint (`shownHint`).
   */
  shownHint: Hint | null;
  /** The record of the game on screen. */
  record: GameRecord | null;
  /** The tier on show: the one being generated, else the game's. */
  difficulty: Difficulty;
  /** Generation failed with no game to fall back to. */
  isLoadFailed: boolean;
  /** Time on the clock, for display. */
  elapsedMs: number;
  /** The mode digits go in with: the latched mode, flipped while Shift or Alt is held. */
  effectiveMode: InputMode;
  settings: Settings;
  playerName: string;
  announcement: Announcement | null;
  notice: Notice | null;
  dialog: DialogState | null;
  history: HistoryView;
  /** The board should play its solved wave. */
  isCelebrating: boolean;
  actions: SudokuActions;
}

/** How long after the solving move the completion dialog opens: long enough to see the wave start. */
export const COMPLETION_DELAY_MS = 400;

/** How long play may go unsaved. Pausing, hiding the tab and leaving the page save at once. */
export const SAVE_DELAY_MS = 500;

/**
 * How often the time on a running clock is saved with no move to save it.
 * A crash or a force-quit fires no event to save on, and must not lose
 * more than this — nor be a way to think for free.
 */
export const CLOCK_SAVE_MS = 5000;

const NOTICE_TEXT: Readonly<Record<NoticeKind, string>> = {
  badLink: "That puzzle link doesn't work — here's a fresh puzzle instead.",
  boardFull: "The board is full, but something isn't right.",
  generationFailed: "Couldn't make a new puzzle. Please try again.",
  resumeFailed: "That game couldn't be reopened. Try Play again instead.",
};

/** A bad link with a game already on screen gets no fresh puzzle, so it must not promise one. */
const BAD_LINK_KEPT = "That puzzle link doesn't work, so here's the game you were playing.";

const NO_MODIFIERS: ReadonlySet<string> = new Set();

/**
 * A puzzle being generated. Each request is a fresh object, so asking again
 * for the same tier (a retry) is still a change the generation effect sees.
 */
interface Generation {
  difficulty: Difficulty;
}

function nextAnnouncement(text: string) {
  return (previous: Announcement | null): Announcement => ({
    text,
    id: (previous?.id ?? 0) + 1,
  });
}

function flip(mode: InputMode): InputMode {
  return mode === 'normal' ? 'candidate' : 'normal';
}

/** The default play clock: monotonic, so a system clock set back cannot freeze it. */
function monotonicNow(): number {
  return performance.timeOrigin + performance.now();
}

/** A full board that is not the solution: the case the boardFull notice is for. */
function isFullButWrong(game: GameState): boolean {
  return game.status === 'playing' && isBoardFull(game);
}

/**
 * The game: everything between the page loading and a puzzle being solved,
 * plus the history around it.
 *
 * Follows minesweeper's hook: values fixed for its lifetime are lazy state,
 * and each handler works out the next game state with the pure reducer,
 * makes its side effects (the clock, the history, the status region), then
 * sets state. Effects only listen (visibility, page hide), save on a timer,
 * and wait for things that are genuinely asynchronous: a puzzle from the
 * generator, and the beat before the completion dialog.
 *
 * Two clocks are read (see `Moment`): play is timed by a monotonic one, and
 * records are dated by the wall clock.
 */
export function useSudoku(options: UseSudokuOptions = {}): Sudoku {
  // Fixed for the lifetime of the hook. Held as state rather than refs so
  // that reading them while rendering is legitimate.
  const [storage] = useState<StorageLike>(() => options.storage ?? browserStorage());
  const [source] = useState<PuzzleSource>(() => options.source ?? createPuzzleSource());
  const [now] = useState<() => number>(() => options.now ?? Date.now);
  const [clock] = useState<() => number>(() => options.clock ?? monotonicNow);
  const [prefs, setPrefs] = useState(() => loadPreferences(storage));
  // What this visit opens with. Pure: the writes it calls for happen once
  // mounted, so a render React throws away leaves nothing behind.
  const [startup] = useState(() =>
    planStartup(
      storage,
      options.search ?? window.location.search,
      { wall: now(), clock: clock() },
      prefs.settings.startInAutoCandidate,
    ),
  );

  const [session, setSession] = useState<Session | null>(startup.session);
  const [generating, setGenerating] = useState<Generation | null>(() =>
    startup.session === null ? { difficulty: prefs.lastDifficulty } : null,
  );
  const [isLoadFailed, setLoadFailed] = useState(false);
  // The tier of the game on screen when History deleted it, to be replaced
  // as History closes.
  const [vacancy, setVacancy] = useState<Difficulty | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(() =>
    startup.offer === null ? null : { kind: 'challenge', offer: startup.offer },
  );
  const [history, setHistory] = useState<HistoryView>(() => ({
    records: startup.records,
    resumableIds: new Set<string>(),
    now: 0,
  }));
  const [notice, setNotice] = useState<Notice | null>(() => {
    if (startup.isBadLink) {
      return {
        kind: 'badLink',
        text: startup.session === null ? NOTICE_TEXT.badLink : BAD_LINK_KEPT,
        id: 1,
      };
    }
    // A full board that will not finish says so again on a return visit; it
    // is spoken as the game resumes.
    if (startup.session !== null && isFullButWrong(startup.session.game)) {
      return { kind: 'boardFull', text: NOTICE_TEXT.boardFull, id: 1 };
    }
    return null;
  });
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [heldModifiers, setHeldModifiers] = useState<ReadonlySet<string>>(NO_MODIFIERS);
  const [completionDue, setCompletionDue] = useState<CompletionResult | null>(null);

  // The session last written to storage, so the save timer skips a session
  // a handler has already saved. Written only in handlers and timers.
  const savedRef = useRef<Session | null>(null);
  // The game `sudoku.current` names, as far as this page knows. A new game
  // is only named there once its board is saved (see `persist`).
  const currentIdRef = useRef<string | null>(
    startup.isNewCurrent ? null : (startup.session?.record.id ?? null),
  );
  // The game whose puzzle this page last marked seen, so it is written once
  // per game rather than with every save (see `noteSeen`).
  const seenIdRef = useRef<string | null>(null);

  const phase = phaseOf(session, generating !== null);
  const game = session?.game ?? null;
  const elapsed = useElapsed(session?.clock ?? STOPPED_CLOCK, session?.record.id ?? null, clock);
  const settings = prefs.settings;
  const effectiveMode: InputMode =
    game === null ? 'normal' : heldModifiers.size > 0 ? flip(game.mode) : game.mode;

  // ---- Helpers ----------------------------------------------------------

  /** Both clocks, read now. */
  const at = (): Moment => ({ wall: now(), clock: clock() });

  const announce = (text: string | null): void => {
    if (text !== null) setAnnouncement(nextAnnouncement(text));
  };

  /** Put a notice in the hint bar, and say it too unless the caller is saying it with something else. */
  const showNotice = (kind: NoticeKind, isSpoken = true): void => {
    setNotice((previous) => ({ kind, text: NOTICE_TEXT[kind], id: (previous?.id ?? 0) + 1 }));
    if (isSpoken) announce(NOTICE_TEXT[kind]);
  };

  /**
   * Say `message` about a game coming (back) into view — with, for a full
   * board that will not finish, the reason again: the notice that said so
   * when it filled is long gone after a reload, and the board looks done.
   * Spoken as one message: a second would replace the first before it was
   * read.
   */
  const announceArrival = (arriving: Session, message: string): void => {
    if (!isFullButWrong(arriving.game)) {
      announce(message);
      return;
    }
    showNotice('boardFull', false);
    announce(`${message} ${NOTICE_TEXT.boardFull}`);
  };

  /**
   * Remember that the puzzle on screen has been seen, once its board has
   * been on show: from then on, however its record fares — deleted from
   * History, discarded as a glimpse, pruned — another attempt at it is a
   * replay.
   */
  const noteSeen = (next: Session): void => {
    if (!hasBoardShown(next) || seenIdRef.current === next.record.id) return;
    markSeen(storage, next.record.givens);
    seenIdRef.current = next.record.id;
  };

  /**
   * Save a session at once, and note it so the save timer does not repeat it.
   * Returns the history as it now stands.
   *
   * A game the player has not seen yet is not saved at all. The game on
   * screen is made the current game once its board is saved, and not
   * before: pointing `sudoku.current` at a board storage refused would lose
   * the player's place on a reload, where the game it named before could
   * still be reopened.
   */
  const persist = (next: Session, t: Moment = at(), isOnScreen = true): GameRecord[] => {
    if (!next.isSeen) return loadHistory(storage);
    if (isOnScreen) {
      savedRef.current = next;
      noteSeen(next);
    }
    const { records, isBoardSaved } = saveSession(storage, next, t);
    if (isOnScreen && isBoardSaved && currentIdRef.current !== next.record.id) {
      saveCurrentId(storage, next.record.id);
      currentIdRef.current = next.record.id;
    }
    return records;
  };

  /** Save the session on screen if anything has changed since it was last saved. */
  const flush = (): void => {
    if (session !== null && savedRef.current !== session) persist(session);
  };

  const readHistory = (wall: number): HistoryView => ({
    records: loadHistory(storage),
    resumableIds: savedGameIds(storage),
    now: wall,
  });

  /**
   * Pause a running game for `reason`, saving it at once. Returns the paused
   * session, or null when there was nothing running to pause.
   */
  const pauseFor = (reason: PauseReason, t: Moment = at()): Session | null => {
    if (session === null || phase !== 'playing') return null;
    const next = pauseSession(session, reason, t.clock);
    persist(next, t);
    setSession(next);
    return next;
  };

  /** The tab hidden or the page going away: pause at once (and say so), or at least save. */
  const hide = (): void => {
    // At once, not after NYT's 30 seconds: a fair time cannot include time
    // spent in another tab.
    if (pauseFor('hidden')) announce('Paused.');
    else flush();
  };

  /**
   * Forget a game that was only glimpsed (see `isGlimpse`): its record and
   * its board go, but its puzzle stays seen.
   */
  const discard = (glimpsed: Session): void => {
    deleteRecord(storage, glimpsed.record.id);
    if (currentIdRef.current === glimpsed.record.id) currentIdRef.current = null;
  };

  /**
   * Leave the game on screen for another: saved, and its clock stopped — or,
   * if it was only glimpsed, discarded.
   */
  const setAside = (t: Moment): void => {
    if (session === null) return;
    if (isGlimpse(session)) discard(session);
    else persist(pauseSession(session, 'user', t.clock), t, false);
  };

  /** Put a game on screen, playing, as the current game. */
  const adopt = (next: Session, t: Moment, message: string): void => {
    persist(next, t);
    setSession(next);
    setGenerating(null);
    setLoadFailed(false);
    setVacancy(null);
    setDialog(null);
    setCompletionDue(null);
    // The notices on show were about the game being left.
    setNotice(null);
    announceArrival(next, message);
  };

  /** What resuming a game says: "Started" for one that never was. */
  const resumeMessage = (resumed: Session): string => {
    const label = DIFFICULTY_LABEL[resumed.record.difficulty];
    return resumed.pause === 'ready' ? `Started ${label} puzzle.` : `Resumed ${label} puzzle.`;
  };

  /**
   * Play a puzzle already in hand again (History's Play again, or the
   * challenge dialog's), at once.
   *
   * A puzzle has at most one unfinished attempt. If it has one that can be
   * reopened, that is resumed — or started, if it never was — rather than a
   * second begun beside it: with two, one could be studied while the other
   * sat at 0:00, then finished from memory. Otherwise a fresh attempt starts,
   * recorded as a replay. Either way it races `challenge`, if there is one.
   */
  const startPuzzle = (puzzle: Puzzle, challenge: Challenge | null): void => {
    const t = at();
    const racing = (attempt: Session): Session => ({
      ...attempt,
      record: { ...attempt.record, challenge: challenge ?? attempt.record.challenge },
    });
    // The attempt on screen, as it stands now: storage may be a moment behind.
    if (
      session !== null &&
      session.record.givens === puzzle.givens &&
      session.game.status === 'playing'
    ) {
      adopt(resumeSession(racing(session), t.clock), t, resumeMessage(session));
      return;
    }
    const records = loadHistory(storage);
    for (const attempt of findAttempts(records, puzzle.givens)) {
      if (attempt.status !== 'playing') continue;
      const restored = restoreSession(storage, records, attempt.id, t.wall);
      // One whose board has been pruned cannot be reopened, nor studied.
      if (restored === null || restored.game.status !== 'playing') continue;
      setAside(t);
      adopt(resumeSession(racing(restored), t.clock), t, resumeMessage(restored));
      return;
    }
    setAside(t);
    const next = newSession(puzzle, {
      source: 'replay',
      challenge,
      now: t,
      autoCandidates: settings.startInAutoCandidate,
      start: 'running',
    });
    adopt(next, t, `Playing this ${DIFFICULTY_LABEL[puzzle.difficulty]} puzzle again.`);
  };

  /** Ask the generator for a new game. The game on screen stays until it arrives. */
  const generate = (difficulty: Difficulty): void => {
    setGenerating({ difficulty });
    setLoadFailed(false);
    setVacancy(null);
  };

  /** Stop the clock on a solved board, record the result, and line up the completion dialog. */
  const solve = (solved: Session): Session => {
    const t = at();
    const { game: board, record } = solved;
    // From the clock, at this moment — the display can be a second stale —
    // but never below what the player was shown.
    const ms = Math.max(elapsedMs(solved.clock, t.clock), elapsed);
    // A replay was seen before it was played: it never sets a record.
    const isReplay = record.source === 'replay';
    // The best to beat is the one before this game. Compared in whole
    // seconds, the unit times are shown in: a "new best" equal to the old
    // one on screen would look like a mistake.
    const before = computeStats(loadHistory(storage))[record.difficulty].bestMs;
    const isNewBest =
      !isReplay &&
      board.assists.reveals === 0 &&
      before !== null &&
      toSeconds(ms) < toSeconds(before);
    const next: Session = {
      ...solved,
      clock: { bankedMs: ms, runningSince: null },
      pause: null,
      isCelebrating: true,
      record: { ...record, completedAt: t.wall },
    };
    const records = persist(next, t);
    setCompletionDue({
      difficulty: record.difficulty,
      elapsedMs: ms,
      assists: board.assists,
      isNewBest,
      isReplay,
      stats: computeStats(records)[record.difficulty],
      challenge: record.challenge,
    });
    if (notice?.kind === 'boardFull') setNotice(null);
    announce(`Solved in ${formatDuration(ms)}.`);
    return next;
  };

  /**
   * Run a game action. The solve is handled here, in the handler for the
   * move that caused it, rather than in an effect watching the status: an
   * effect would only see it a render later, and the time must be taken from
   * the clock at the moment of the move.
   */
  const run = (action: DescribedAction): void => {
    if (session === null || (phase !== 'playing' && phase !== 'solved')) return;
    const previous = session.game;
    const next = reduce(previous, action);
    // The reducer returns the same state for a no-op.
    if (next === previous) return;

    if (next.status === 'solved' && previous.status !== 'solved') {
      setSession(solve({ ...session, game: next }));
      return;
    }

    const said = describeChange(previous, next, action, { conflicts: settings.highlightConflicts });
    // NYT says nothing when a full board is wrong, which leaves a player
    // staring at a "finished" puzzle that never ends. Spoken with the move,
    // as one message: a second would replace the first before it was read.
    if (isBoardFull(next) && !isBoardFull(previous)) {
      showNotice('boardFull', false);
      announce([said, NOTICE_TEXT.boardFull].filter((part) => part !== null).join(' '));
    } else {
      if (notice?.kind === 'boardFull' && !isBoardFull(next)) setNotice(null);
      announce(said);
    }
    setSession({ ...session, game: next });
  };

  // ---- Effects ----------------------------------------------------------

  // The worker goes with the page. Disposing is not terminal (see
  // PuzzleSource), so StrictMode's rehearsal unmount leaves it usable.
  useEffect(() => () => source.dispose(), [source]);

  // The writes startup called for, once. Guarded because StrictMode runs
  // mount effects twice; they are idempotent anyway, but the guard keeps the
  // address bar and storage from being touched twice for nothing.
  const handleStartup = useEffectEvent(() => {
    if (startup.isLinkConsumed) clearShareParams();
    // A link's game takes the place of the one on screen, which goes the way
    // a New game would leave it.
    if (startup.left !== null && isGlimpse(startup.left)) discard(startup.left);
    if (startup.isNewCurrent && startup.session !== null) persist(startup.session);
  });
  const didStart = useRef(false);
  useEffect(() => {
    if (didStart.current) return;
    didStart.current = true;
    handleStartup();
  }, []);

  // A broken link is said out loud too. After mount rather than as the first
  // message: a live region announces changes, not what it held when it
  // appeared.
  useEffect(() => {
    if (!startup.isBadLink) return undefined;
    const text = startup.session === null ? NOTICE_TEXT.badLink : BAD_LINK_KEPT;
    const id = window.setTimeout(() => setAnnouncement(nextAnnouncement(text)));
    return () => window.clearTimeout(id);
  }, [startup]);

  const handleGenerated = useEffectEvent((puzzle: Puzzle) => {
    const t = at();
    // A dialog still open (the challenge offer on a first visit, or one
    // opened while the puzzle was on its way) holds the clock until it
    // closes — and the game goes unrecorded until then, as the player has
    // not seen it. A tab in the background (a first visit opened there, a
    // New game the player switched away from) waits behind Start: no time
    // counts, and no board shows, until someone is looking.
    let start: SessionStart = 'running';
    if (dialog !== null) start = 'dialog';
    else if (document.visibilityState === 'hidden') start = 'ready';
    // The game it replaces, kept resumable as New game left it — unless it
    // was only glimpsed. Done now rather than as New game was chosen, so a
    // puzzle that never arrives leaves the old game as it was.
    if (session !== null && isGlimpse(session)) discard(session);
    const next = newSession(puzzle, {
      source: attemptSource(storage, loadHistory(storage), puzzle.givens, 'generated'),
      challenge: null,
      now: t,
      autoCandidates: settings.startInAutoCandidate,
      start,
    });
    persist(next, t);
    setSession(next);
    setGenerating(null);
    setLoadFailed(false);
    // The broken-link notice has already promised a fresh puzzle; a second
    // message straight after it would be read instead of it.
    if (notice?.kind !== 'badLink') announce(`New ${DIFFICULTY_LABEL[puzzle.difficulty]} puzzle.`);
    // One of each tier, ready for the next New game whichever is picked.
    for (const difficulty of DIFFICULTIES) source.prefetch(difficulty);
  });

  const handleGenerationFailed = useEffectEvent(() => {
    setGenerating(null);
    if (session === null) setLoadFailed(true);
    showNotice('generationFailed');
  });

  // A puzzle from the generator: the one asynchronous thing a game needs.
  // A request that is superseded — another New game, a resume or a replay
  // meanwhile, StrictMode's rehearsal unmount, or a real one — is cancelled,
  // and its answer ignored.
  useEffect(() => {
    if (generating === null) return undefined;
    let isCancelled = false;
    source.next(generating.difficulty).then(
      (puzzle) => {
        if (!isCancelled) handleGenerated(puzzle);
      },
      () => {
        if (!isCancelled) handleGenerationFailed();
      },
    );
    return () => {
      isCancelled = true;
    };
  }, [generating, source]);

  // Save while playing, at most once per SAVE_DELAY_MS of quiet. Moments that
  // matter more — pausing, the tab hiding, the page going away, a solve —
  // save at once from their handlers.
  const saveQuietly = useEffectEvent((pending: Session) => {
    if (savedRef.current !== pending) persist(pending);
  });
  useEffect(() => {
    if (session === null || savedRef.current === session) return undefined;
    const id = window.setTimeout(() => saveQuietly(session), SAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [session]);

  // And while the clock runs, its time every CLOCK_SAVE_MS even with no move
  // to save: a crash or a force-quit fires no event to save on.
  const saveClock = useEffectEvent(() => {
    if (session !== null) persist(session);
  });
  const isPlaying = phase === 'playing';
  useEffect(() => {
    if (!isPlaying) return undefined;
    const id = window.setInterval(() => saveClock(), CLOCK_SAVE_MS);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  // The completion dialog, a beat after the solving move so the wave shows.
  useEffect(() => {
    if (completionDue === null) return undefined;
    const id = window.setTimeout(() => {
      setCompletionDue(null);
      // Never over a dialog opened in the meantime.
      setDialog((open) => open ?? { kind: 'completion', result: completionDue });
    }, COMPLETION_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [completionDue]);

  const handleVisibilityChange = useEffectEvent(() => {
    if (document.visibilityState !== 'hidden') return;
    // Keys let go while the tab was hidden never send their keyup here.
    setHeldModifiers(NO_MODIFIERS);
    hide();
  });

  const handlePageHide = useEffectEvent(() => hide());

  useEffect(() => {
    const onVisibilityChange = () => handleVisibilityChange();
    // `pagehide` rather than `beforeunload`, which mobile browsers skip when
    // they discard a page in the background.
    const onPageHide = () => handlePageHide();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // ---- Actions ----------------------------------------------------------

  const actions = useStableActions<SudokuActions>({
    select: (index) => run({ type: 'select', index }),
    move: (direction) => run({ type: 'move', direction }),
    enterDigit: (digit) =>
      run({ type: 'enter', digit, mode: effectiveMode, clearPeerNotes: settings.clearPeerNotes }),
    toggleCandidate: (index, digit) => run({ type: 'enter', digit, index, mode: 'candidate' }),
    erase: () => run({ type: 'erase' }),
    setMode: (mode) => run({ type: 'setMode', mode }),
    toggleMode: () => run({ type: 'toggleMode' }),
    setAutoCandidates: (enabled) => run({ type: 'setAutoCandidates', enabled }),
    undo: () => run({ type: 'undo' }),
    redo: () => run({ type: 'redo' }),
    hint: () => {
      if (game === null || phase !== 'playing') return;
      // Found here, not in the reducer, which only records it.
      run({ type: 'hint', hint: findHint(valuesOf(game), gridValues(game.puzzle.solution)) });
    },
    check: (scope) => run({ type: 'check', scope }),
    reveal: () => run({ type: 'reveal' }),

    requestReset: () => {
      if (phase !== 'playing') return;
      pauseFor('dialog');
      setDialog({ kind: 'confirmReset' });
    },
    confirmReset: () => {
      setDialog(null);
      if (session === null || session.game.status !== 'playing') return;
      const t = at();
      // Back to the givens, but not the clock: it carries on from where it
      // stood, running again as the confirmation closes. Otherwise studying
      // the board, then resetting it, would bank a time that left the
      // studying out.
      const next: Session = {
        ...resumeSession(session, t.clock),
        game: reduce(session.game, { type: 'reset' }),
      };
      persist(next, t);
      setSession(next);
      if (notice?.kind === 'boardFull') setNotice(null);
      announce('Puzzle reset.');
    },

    pause: () => {
      if (pauseFor('user')) announce('Paused.');
    },
    resume: () => {
      if (session === null || (phase !== 'paused' && phase !== 'ready')) return;
      const next = resumeSession(session, clock());
      // Its board is on show from this moment, perhaps for the first time.
      noteSeen(next);
      setSession(next);
      announceArrival(next, phase === 'ready' ? 'Started.' : 'Resumed.');
    },

    newGame: (difficulty) => {
      // Saved first: the game being left stays in History, resumable, so
      // starting another needs no confirmation (one only glimpsed goes as
      // its replacement arrives — see `isGlimpse`).
      if (session !== null && generating === null) {
        const t = at();
        const held = pauseSession(session, 'user', t.clock);
        persist(held, t);
        setSession(held);
      }
      setPrefs(setLastDifficulty(storage, difficulty));
      setDialog(null);
      setNotice(null);
      setCompletionDue(null);
      generate(difficulty);
    },
    retry: () => generate(generating?.difficulty ?? prefs.lastDifficulty),

    openDialog: (kind) => {
      const t = at();
      // Dialogs pause a running game silently and resume it when they close.
      const current = pauseFor('dialog', t) ?? session;
      if (kind === 'share') {
        if (current === null) return;
        setDialog({ kind, target: shareTargetOf(current), returnTo: null });
        return;
      }
      if (kind === 'techniques') {
        setDialog({ kind, initial: null });
        return;
      }
      if (kind === 'history') {
        // Its list should show the game on screen as it is now.
        if (current !== null && savedRef.current !== current) persist(current, t);
        setHistory(readHistory(t.wall));
      }
      setDialog({ kind });
    },
    openTechniques: (initial) => {
      // Reading the guide is not help with this puzzle: the clock stops, as
      // for any dialog, and nothing is recorded.
      pauseFor('dialog');
      setDialog({ kind: 'techniques', initial });
    },
    closeDialog: () => {
      if (dialog?.kind === 'share' && dialog.returnTo === 'history') {
        setHistory(readHistory(now()));
        setDialog({ kind: 'history' });
        return;
      }
      setDialog(null);
      // The game on screen was deleted from History: its replacement is made
      // now, as the player can see it arrive.
      if (session === null && generating === null && vacancy !== null) {
        generate(vacancy);
        return;
      }
      // Only the pause a dialog caused lifts with it: a game the player had
      // paused stays paused behind the dialog they opened.
      if (session === null || session.pause !== 'dialog' || generating !== null) return;
      const t = at();
      const next = resumeSession(session, t.clock);
      // A game made behind the dialog is seen for the first time, and its
      // record starts now.
      if (!session.isSeen) persist(next, t);
      setSession(next);
    },
    shareResult: () => {
      if (session === null) return;
      setDialog({ kind: 'share', target: shareTargetOf(session), returnTo: null });
    },
    playAgain: () => {
      if (dialog?.kind !== 'challenge') return;
      startPuzzle(dialog.offer.puzzle, dialog.offer.challenge);
    },

    resumeRecord: (id) => {
      if (session?.record.id === id) {
        actions.closeDialog();
        return;
      }
      const t = at();
      const restored = restoreSession(storage, loadHistory(storage), id, t.wall);
      if (restored === null || restored.game.status !== 'playing') {
        actions.closeDialog();
        showNotice('resumeFailed');
        return;
      }
      // The game on screen is set aside with its clock stopped: two clocks
      // must never run at once.
      setAside(t);
      adopt(resumeSession(restored, t.clock), t, resumeMessage(restored));
    },
    replayRecord: (id) => {
      const record = loadHistory(storage).find((entry) => entry.id === id);
      const puzzle = record === undefined ? null : puzzleOf(record);
      if (record === undefined || puzzle === null) {
        actions.closeDialog();
        showNotice('resumeFailed');
        return;
      }
      startPuzzle(puzzle, record.challenge);
    },
    shareRecord: (id) => {
      const record = history.records.find((entry) => entry.id === id);
      if (record === undefined) return;
      setDialog({ kind: 'share', target: shareTargetOfRecord(record), returnTo: 'history' });
    },
    deleteRecord: (id) => {
      deleteRecord(storage, id);
      if (currentIdRef.current === id) currentIdRef.current = null;
      setHistory(readHistory(now()));
      if (session?.record.id !== id) return;
      // The game on screen goes with its record. Its replacement waits for
      // History to close: made now, behind the list, it would be a game the
      // player never saw sitting in it — and the list could never be emptied.
      savedRef.current = null;
      setSession(null);
      setCompletionDue(null);
      if (notice?.kind === 'boardFull') setNotice(null);
      setVacancy(session.record.difficulty);
    },
    exportHistory: () => exportHistory(storage, now()),
    importHistory: (json) => {
      const result = importHistory(storage, json);
      if (result.ok) setHistory(readHistory(now()));
      return result;
    },

    updateSettings: (patch) => setPrefs(updateSettings(storage, patch)),
    setPlayerName: (name) => setPrefs(setPlayerName(storage, name)),

    setModifier: (key, isDown) => {
      setHeldModifiers((held) => {
        if (held.has(key) === isDown) return held;
        const next = new Set(held);
        if (isDown) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    clearModifiers: () => setHeldModifiers(NO_MODIFIERS),
    dismissNotice: () => setNotice(null),
  });

  return {
    phase,
    pauseReason: session?.pause ?? null,
    game,
    shownHint: game === null ? null : shownHint(game),
    record: session?.record ?? null,
    difficulty:
      generating?.difficulty ?? session?.record.difficulty ?? vacancy ?? prefs.lastDifficulty,
    isLoadFailed,
    elapsedMs: elapsed,
    effectiveMode,
    settings,
    playerName: prefs.playerName,
    announcement,
    notice,
    dialog,
    history,
    isCelebrating: session?.isCelebrating ?? false,
    actions,
  };
}
