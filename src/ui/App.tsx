import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import {
  dealtTier,
  digitCounts,
  isEditable,
  rememberedHint,
  type DateKey,
  type Difficulty,
  type GameState,
} from '../core';
import { challengerName, namedChallenge, namedRecord } from '../storage/friends';
import type { Challenge } from '../storage/history';
import { getNewerVersion, reload, subscribeNewerVersion } from '../update/check';
import { Board } from './Board';
import { BoardOverlay, type BoardOverlayContent } from './BoardOverlay';
import { Controls } from './Controls';
import { ErrorCounter, MistakeAnnouncer } from './ErrorCounter';
import { hasAssists } from './format';
import { HelpTaken } from './HelpTaken';
import {
  ChallengeDialog,
  CompareDialog,
  CompletionDialog,
  ConfirmDialog,
  DailyDialog,
  EnterDialog,
  FriendsDialog,
  HelpDialog,
  HistoryDialog,
  PlaybackDialog,
  PuzzlesDialog,
  SettingsDialog,
  ShareDialog,
  SpoilerDialog,
  StruckDialog,
  TechniquesDialog,
  WalkthroughDialog,
  WhoSentDialog,
} from './dialogs';
import { Header } from './Header';
import { HintBar } from './HintBar';
import { FocusHomeContext, focusQuietly, guardFocus, trackInputModality } from './keepFocus';
import { commandForKey, isModeModifierKey, isRepeatable } from './keyboard';
import { useTheme } from './theme';
import { UpdateToast } from './UpdateToast';
import { useSudoku, type Sudoku, type UseSudokuOptions } from './useSudoku';

export interface AppProps {
  /** Test seam for in-memory storage, a synchronous puzzle source, a share link and a clock. */
  options?: UseSudokuOptions;
}

/** Controls where Space means "press me", as it always has, rather than "switch mode". */
const SPACE_CONTROL = 'button, a[href], [role="button"], [role="switch"], [role="menuitem"]';

/** The selected cell: the grid's one tab stop (see Cell's roving tabindex). */
const SELECTED_CELL = '[role="gridcell"][tabindex="0"]';

/** What the board's place shows: the board itself, or a card in its place. */
type BoardContent = { kind: 'board'; game: GameState } | BoardOverlayContent;

function boardContent(sudoku: Sudoku): BoardContent {
  const { phase, difficulty, game, record, elapsedMs, settings, isLoadFailed, actions } = sudoku;
  // The daily on show (or being dealt), for the cards' wording.
  const daily = sudoku.daily === null ? null : { date: sudoku.daily, today: sudoku.today.date };
  // The friend's solve the game's link carried, which its cards offer.
  const solve =
    sudoku.friendSolve === null
      ? null
      : { name: sudoku.friendSolve.name, onWatch: actions.watchFriendSolve };
  // Loading is the only phase without a game, so past it there is always one.
  if (phase === 'loading' || game === null) {
    // Behind a dialog there is nothing to say: the dialog has the floor.
    if (sudoku.dialog !== null) return { kind: 'veiled' };
    return isLoadFailed
      ? { kind: 'failed', difficulty, onRetry: actions.retry }
      : { kind: 'loading', difficulty, daily };
  }
  // The first link from someone new asks who sent it before its card shows,
  // so the card arrives already naming them (see WhoSentDialog) — and a rude
  // name in the link is not there to read through the scrim meanwhile.
  if (sudoku.dialog?.kind === 'whoSent') return { kind: 'veiled' };
  if (phase === 'ready') {
    const challenge = record?.challenge ?? null;
    return {
      kind: 'ready',
      difficulty,
      // Not a puzzle the player typed in themselves (see `GameRecord.entered`).
      isShared: record?.source === 'shared' && record.entered !== true,
      // Under the name the friend was given here, if any (see `challengerName`).
      challenge: challenge === null ? null : namedChallenge(sudoku.friendIndex, challenge),
      daily,
      onStart: actions.resume,
      solve,
      isWatched: record?.watched === true,
    };
  }
  if (phase !== 'paused') return { kind: 'board', game };
  // Behind a dialog the pause is silent: the dialog says everything.
  if (sudoku.pauseReason === 'dialog') return { kind: 'veiled' };
  return {
    kind: 'paused',
    difficulty,
    elapsedMs,
    showTimer: settings.showTimer,
    daily,
    onResume: actions.resume,
    solve,
  };
}

/**
 * The whole game: the header, the board (or the card in its place), the hint
 * bar, the controls, the status region, the offer of a newer version and the
 * dialogs, wired to the `useSudoku` hook — plus the keyboard, which NYT-style
 * listens on the whole document rather than on whatever has focus.
 *
 * And focus, which the game moves about: wherever a control it was on goes
 * (disabled, or gone from the page), it lands on the game's focus home —
 * the selected cell, else the card's button, else the board's place, which
 * hands it to the board when the board arrives (see `guardFocus`).
 */
export function App({ options }: AppProps = {}) {
  const sudoku = useSudoku(options);
  const { phase, game, settings, dialog, actions } = sudoku;
  useTheme(settings.theme);
  const hintTextId = useId();
  // A newer version deployed since the page loaded (see src/update/check.ts).
  const newerVersion = useSyncExternalStore(subscribeNewerVersion, getNewerVersion);

  /*
   * Every challenger is drawn under the name the friend was given here, if
   * any (see `challengerName`) — resolved where it is drawn, never stored, so
   * the snapshots the dialogs hold (a solve's result, an offer, a friend's
   * solve) follow a rename wherever they come back.
   */
  const named = (challenge: Challenge | null): Challenge | null =>
    challenge === null ? null : namedChallenge(sudoku.friendIndex, challenge);
  // History's rows are memoised: a record is copied only when its name
  // changes, so a rename draws again only the rows it renames. Its actions
  // find the stored records by id, so no copy is ever written back.
  const historyRecords = useMemo(
    () => sudoku.history.records.map((record) => namedRecord(sudoku.friendIndex, record)),
    [sudoku.history.records, sudoku.friendIndex],
  );

  useEffect(() => trackInputModality(), []);

  const boardAreaRef = useRef<HTMLDivElement>(null);
  // A hand-over to the board as it next arrives (see Board's
  // `takeFocusRequest`): from a card whose button had focus, or from a
  // control that starts a new board. A ref, read only from the board's
  // mount effect.
  const boardFocusRequest = useRef(false);
  const requestBoardFocus = useCallback(() => {
    boardFocusRequest.current = true;
  }, []);
  const withdrawBoardFocus = useCallback(() => {
    boardFocusRequest.current = false;
  }, []);
  const takeFocusRequest = useCallback(() => {
    // Focus parked on the board's place is waiting for the board too.
    const isRequested =
      boardFocusRequest.current || document.activeElement === boardAreaRef.current;
    boardFocusRequest.current = false;
    return isRequested;
  }, []);

  /** Move focus to the game's home (see above). */
  const focusHome = useCallback((): boolean => {
    const area = boardAreaRef.current;
    if (area === null) return false;
    focusQuietly(
      area.querySelector<HTMLElement>(SELECTED_CELL) ??
        area.querySelector<HTMLElement>('button:not(:disabled)') ??
        area,
    );
    return true;
  }, []);

  // A control can go while it has focus — whichever component it belonged
  // to, the App's or a menu's own — and focus goes home rather than to <body>.
  useEffect(() => guardFocus(focusHome), [focusHome]);

  /** A game action from the "…" menu, after which the keyboard carries on from the board. */
  const thenHome = (action: () => void) => () => {
    action();
    focusHome();
  };
  const handleNewGame = useCallback(
    (difficulty: Difficulty) => {
      requestBoardFocus();
      actions.newGame(difficulty);
    },
    [actions, requestBoardFocus],
  );
  // A daily, from New game or the calendar: the keyboard carries on from its board.
  const handleOpenDaily = useCallback(
    (date: DateKey, difficulty: Difficulty) => {
      requestBoardFocus();
      actions.openDaily(date, difficulty);
    },
    [actions, requestBoardFocus],
  );

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Modal means modal, and that covers typing: every field to type into is
    // in a dialog. Something that has claimed the key already — an open menu
    // moving between its items — keeps it.
    if (dialog !== null || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    // An open menu has the keyboard: a digit typed there must not change the
    // board behind it.
    if (target?.closest('[role="menu"]')) return;

    if (isModeModifierKey(event.key)) {
      // Held, the key repeats; only the first press flips the mode.
      if (!event.repeat) actions.setModifier(event.key, true);
      return;
    }

    const command = commandForKey(event);
    if (command === null) return;
    // Space presses a focused button or link outside the grid, as it always
    // does; on a cell, or with nothing in particular focused, it is the
    // game's.
    if (
      command.type === 'toggleMode' &&
      target?.closest(SPACE_CONTROL) &&
      !target.closest('[role="grid"]')
    ) {
      return;
    }
    event.preventDefault();
    if (event.repeat && !isRepeatable(command)) return;

    // With the board hidden, P is the only key that does anything: it brings
    // the board back.
    if (phase !== 'playing' && phase !== 'solved') {
      if (command.type === 'pause') actions.resume();
      return;
    }
    switch (command.type) {
      case 'digit':
        actions.enterDigit(command.digit);
        break;
      case 'erase':
        actions.erase();
        break;
      case 'move':
        actions.move(command.direction);
        break;
      case 'toggleMode':
        actions.toggleMode();
        break;
      case 'undo':
        actions.undo();
        break;
      case 'redo':
        actions.redo();
        break;
      case 'pause':
        actions.pause();
        break;
    }
  });

  const handleKeyUp = useEffectEvent((event: KeyboardEvent) => {
    // Even with a dialog open: a modifier let go there must not stay "held".
    if (isModeModifierKey(event.key)) actions.setModifier(event.key, false);
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event);
    const onKeyUp = (event: KeyboardEvent) => handleKeyUp(event);
    // A modifier held as the window loses focus never sends its keyup here.
    const onBlur = () => actions.clearModifiers();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [actions]);

  const content = boardContent(sudoku);
  const isPlaying = phase === 'playing';
  // The error counter shows only with the board: a hidden board hides it too.
  const isCounting = settings.showErrorCounter;
  const isCountShown = phase === 'playing' || phase === 'solved';
  // Help taken shows whatever the phase: it says nothing about the board.
  const isHelpOn = settings.showHelpTaken;
  const assists = game?.assists ?? null;
  const gameId = sudoku.record?.id ?? null;
  // The tally — help taken and the error counter — on one strip: beside the
  // timer, or on a line of its own above a phone's controls. On the page
  // while either is on, so help taken can tick as it first appears; the
  // header makes room for it, and a phone gives it its line, only once it
  // has something to show — so a game played without help keeps its board
  // and its wordmark whole.
  const hasTally = isHelpOn || isCounting;
  const isTallyShown = isCounting || (isHelpOn && assists !== null && hasAssists(assists));
  const tally = (placement: 'header' | 'play') => (
    <div className={`tally tally--${placement}`}>
      {isHelpOn && (
        <HelpTaken
          assists={assists}
          gameId={gameId}
          isStarted={sudoku.hasBoardShown}
          isCovered={dialog !== null}
          placement={placement}
        />
      )}
      {isCounting && (
        <ErrorCounter
          mistakes={sudoku.mistakesSoFar}
          isShown={isCountShown}
          placement={placement}
        />
      )}
    </div>
  );
  const counts = game === null ? EMPTY_COUNTS : digitCounts(game);
  const selectedCell = game === null ? null : game.cells[game.selected];
  const canRevealCell = game !== null && isEditable(game, game.selected);
  const canCheckPuzzle =
    game !== null && game.cells.some((cell, i) => cell.value !== 0 && isEditable(game, i));
  // A hint points at a cell; with the board hidden there is none to see.
  // Behind the guide and "Show me" it stays, under the scrim, so they can
  // give focus back to the button in it that opened them.
  const isHintShown =
    isPlaying ||
    dialog?.kind === 'techniques' ||
    dialog?.kind === 'walkthrough' ||
    dialog?.kind === 'struck';
  // A cell's remembered hint, shown again as the cell is selected again, is
  // not spoken: the cell's description carries it, read as focus arrives,
  // and only then — the status region would repeat it at every cell the
  // arrow keys pass through. A hint just asked for is spoken there already.
  const isCellDescribed =
    isPlaying &&
    game !== null &&
    game.hint === null &&
    rememberedHint(game, game.selected) !== null;

  return (
    <FocusHomeContext value={focusHome}>
      {/* With the tally showing, a phone held upright gives it a line above
        the controls, which the layout counts in (layout.css). */}
      <div className={isTallyShown ? 'app app--tally' : 'app'}>
        {/* The board's changes, spoken. The inner element is keyed so the same
          words twice still re-announce: a live region only speaks when its
          contents actually change. */}
        <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {sudoku.announcement && (
            <span key={sudoku.announcement.id}>{sudoku.announcement.text}</span>
          )}
        </div>
        {isCounting && (
          <MistakeAnnouncer
            mistakes={sudoku.mistakesSoFar}
            gameId={gameId}
            isShown={isCountShown}
          />
        )}

        <Header
          difficulty={sudoku.difficulty}
          daily={sudoku.daily}
          elapsedMs={sudoku.elapsedMs}
          phase={phase}
          showTimer={settings.showTimer}
          isTimeless={sudoku.record?.watched === true}
          today={sudoku.today}
          onPause={actions.pause}
          onResume={actions.resume}
          onNewGame={handleNewGame}
          onOpenDaily={(difficulty) => handleOpenDaily(sudoku.today.date, difficulty)}
          onRefreshToday={actions.refreshToday}
          onOpenDialog={actions.openDialog}
          tally={hasTally ? tally('header') : undefined}
          isTallyShown={isTallyShown}
        />

        <main className="main">
          <div className="play">
            <div className="play__board">
              {/* Focusable from script (never a tab stop), so focus has
                somewhere to wait while the board is on its way. */}
              <div className="board-area" tabIndex={-1} ref={boardAreaRef}>
                {content.kind === 'board' ? (
                  <Board
                    // Keyed by game: another game is a fresh board, which takes
                    // focus if asked to — a daily already dealt arrives in the
                    // same render as it is chosen, with no loading card between.
                    key={sudoku.record?.id}
                    game={content.game}
                    settings={settings}
                    isPlaying={isPlaying}
                    isCelebrating={sudoku.isCelebrating}
                    onSelect={actions.select}
                    onToggleCandidate={actions.toggleCandidate}
                    takeFocusRequest={takeFocusRequest}
                    describedBy={isCellDescribed ? hintTextId : undefined}
                    // Where the step the hint bar names is, tinted with it.
                    tinted={isHintShown ? sudoku.hintTint : undefined}
                  />
                ) : (
                  <BoardOverlay
                    // Keyed by kind and game: each card is a fresh arrival, and
                    // takes focus — another game's Start card too, in place of
                    // one already showing (a puzzle entered while one waits).
                    key={`${content.kind}-${sudoku.record?.id}`}
                    {...content}
                    onReleaseFocus={requestBoardFocus}
                    onClaimFocus={withdrawBoardFocus}
                  />
                )}
              </div>
              <HintBar
                hint={isHintShown ? sudoku.shownHint : null}
                houses={sudoku.hintHouses}
                isMovedOn={sudoku.isHintMovedOn}
                textId={hintTextId}
                onShowMe={sudoku.isShowMeOffered ? actions.showMe : null}
                notice={sudoku.notice}
                onDismissNotice={actions.dismissNotice}
                onOpenGuide={actions.openTechniques}
              />
            </div>

            {hasTally && tally('play')}

            <Controls
              mode={sudoku.effectiveMode}
              autoCandidates={game?.autoCandidates ?? false}
              counts={counts}
              isDisabled={!isPlaying}
              canUndo={(game?.undoStack.length ?? 0) > 0}
              canRedo={(game?.redoStack.length ?? 0) > 0}
              canCheckCell={canRevealCell && selectedCell !== null && selectedCell.value !== 0}
              canCheckPuzzle={canCheckPuzzle}
              canRevealCell={canRevealCell}
              hintsUsed={isHelpOn ? (assists?.hints ?? 0) : 0}
              onSetMode={actions.setMode}
              onDigit={actions.enterDigit}
              onErase={actions.erase}
              onUndo={actions.undo}
              onRedo={actions.redo}
              onSetAutoCandidates={actions.setAutoCandidates}
              onHint={thenHome(actions.hint)}
              onCheckCell={thenHome(() => actions.check('cell'))}
              onCheckPuzzle={thenHome(() => actions.check('puzzle'))}
              onRevealCell={thenHome(actions.reveal)}
              onReset={actions.requestReset}
            />
          </div>
        </main>

        <UpdateToast version={newerVersion} isCovered={dialog !== null} onRefresh={reload} />

        {dialog?.kind === 'completion' && (
          <CompletionDialog
            {...dialog.result}
            challenge={named(dialog.result.challenge)}
            onShare={actions.shareResult}
            onWatch={sudoku.canWatchSolve ? actions.watchSolve : undefined}
            isBackFromWatch={dialog.isBackFromWatch}
            onWatchFriend={sudoku.canWatchChallengeSolve ? actions.watchChallengeSolve : undefined}
            isBackFromFriend={dialog.isBackFromFriend}
            onCompare={sudoku.canCompareSolves ? actions.compareSolves : undefined}
            isBackFromCompare={dialog.isBackFromCompare}
            onNewGame={() => handleNewGame(dealtTier(dialog.result.difficulty))}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'share' && (
          <ShareDialog
            givens={dialog.target.givens}
            difficulty={dialog.target.difficulty}
            result={dialog.target.result}
            daily={dialog.target.daily}
            solve={dialog.target.solve}
            playerId={sudoku.playerId}
            playerName={sudoku.playerName}
            onPlayerNameChange={actions.setPlayerName}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'history' && (
          <HistoryDialog
            records={historyRecords}
            currentId={gameId}
            resumableIds={sudoku.history.resumableIds}
            now={sudoku.history.now}
            onResume={actions.resumeRecord}
            onReplay={actions.replayRecord}
            onShare={actions.shareRecord}
            canWatch={actions.canWatchRecord}
            onWatch={actions.watchRecord}
            canWatchChallenge={actions.canWatchRecordChallenge}
            onWatchChallenge={actions.watchRecordChallenge}
            canCompare={actions.canCompareRecord}
            onCompare={actions.compareRecord}
            place={dialog.place}
            onDelete={actions.deleteRecord}
            onExport={actions.exportHistory}
            onImport={actions.importHistory}
            onOpenFriends={sudoku.friends.length > 0 ? actions.openFriends : undefined}
            isBackFromFriends={dialog.isBackFromFriends}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'friends' && (
          <FriendsDialog
            friends={sudoku.friends}
            // Set as History opened, just before: Friends dates links as it did.
            now={sudoku.history.now}
            onRename={actions.renameFriend}
            onMerge={actions.mergeFriends}
            onSplit={actions.splitFriend}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'playback' && (
          <PlaybackDialog {...dialog.source} settings={settings} onClose={actions.closeDialog} />
        )}
        {dialog?.kind === 'compare' && (
          <CompareDialog {...dialog.source} onClose={actions.closeDialog} />
        )}
        {dialog?.kind === 'settings' && (
          <SettingsDialog
            settings={settings}
            isThemeNewer={sudoku.isThemeNewer}
            onChange={actions.updateSettings}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'help' && (
          <HelpDialog
            onBrowseTechniques={() => actions.openTechniques(null)}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'techniques' && (
          <TechniquesDialog initial={dialog.initial ?? undefined} onClose={actions.closeDialog} />
        )}
        {dialog?.kind === 'walkthrough' && (
          <WalkthroughDialog
            walkthrough={dialog.walkthrough}
            initialStep={dialog.step}
            numbering={dialog.numbering}
            charge={dialog.charge ?? null}
            pageCharge={dialog.pageCharge ?? null}
            seenPages={sudoku.seenPages}
            onStep={actions.showStep}
            onOpenGuide={actions.openTechniques}
            autoCandidates={sudoku.game?.autoCandidates}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'struck' && (
          <StruckDialog
            index={dialog.index}
            digit={dialog.digit}
            board={dialog.board}
            autoCandidates={dialog.autoCandidates}
            charge={dialog.charge ?? null}
            onPutBack={actions.putBack}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'daily' && (
          <DailyDialog
            records={dialog.calendar.records}
            ledger={dialog.calendar.ledger}
            today={dialog.calendar.today}
            onPlay={handleOpenDaily}
            onReplay={(date, difficulty) => {
              requestBoardFocus();
              actions.replayDaily(date, difficulty);
            }}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'puzzles' && (
          <PuzzlesDialog
            puzzles={sudoku.puzzles}
            place={dialog.place}
            onNew={() => actions.openEditor(null)}
            onPlay={(puzzle) => {
              requestBoardFocus();
              actions.playEntered(puzzle);
            }}
            onShare={actions.shareEntry}
            onEdit={actions.openEditor}
            onRename={actions.renameEntry}
            onDelete={actions.deleteEntry}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'enter' && (
          <EnterDialog
            settings={settings}
            initialCells={dialog.cells}
            initialSelected={dialog.selected}
            savedCells={dialog.id === null ? null : dialog.cells}
            onPlay={(puzzle) => {
              requestBoardFocus();
              actions.playFromEditor(dialog, puzzle);
            }}
            onShare={(puzzle, selected) => actions.shareFromEditor(dialog, puzzle, selected)}
            onSave={(cells) => actions.saveEntry(dialog, cells)}
            onClose={(cells) => actions.closeEditor(dialog, cells)}
            isBackFromShare={dialog.isBackFromShare}
          />
        )}
        {dialog?.kind === 'challenge' && (
          <ChallengeDialog
            difficulty={dialog.offer.puzzle.difficulty}
            previous={dialog.offer.previous}
            challenge={named(dialog.offer.challenge)}
            daily={dialog.offer.daily ?? null}
            onPlayAgain={() => {
              requestBoardFocus();
              actions.playAgain();
            }}
            onWatch={sudoku.canWatchChallengeSolve ? actions.watchChallengeSolve : undefined}
            isBackFromWatch={dialog.isBackFromWatch}
            onCompare={sudoku.canCompareSolves ? actions.compareSolves : undefined}
            isBackFromCompare={dialog.isBackFromCompare}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'spoiler' && (
          <SpoilerDialog
            name={challengerName(sudoku.friendIndex, dialog.solve.challenge)}
            onWatch={actions.confirmWatch}
            onPlay={() => {
              requestBoardFocus();
              actions.playFirst();
            }}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'whoSent' && (
          <WhoSentDialog
            sharer={dialog.sharer}
            friends={sudoku.friends}
            onSave={actions.answerWhoSent}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'confirmReset' && (
          <ConfirmDialog
            title="Reset puzzle?"
            message="Clear all your entries and start again? The clock keeps running."
            confirmLabel="Reset"
            onConfirm={actions.confirmReset}
            onCancel={actions.closeDialog}
          />
        )}
      </div>
    </FocusHomeContext>
  );
}

const EMPTY_COUNTS: readonly number[] = new Array<number>(10).fill(0);
