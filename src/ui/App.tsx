import { useCallback, useEffect, useEffectEvent, useId, useRef } from 'react';
import { digitCounts, isEditable, rememberedHint, type Difficulty, type GameState } from '../core';
import { Board } from './Board';
import { BoardOverlay, type BoardOverlayContent } from './BoardOverlay';
import { Controls } from './Controls';
import {
  ChallengeDialog,
  CompletionDialog,
  ConfirmDialog,
  HelpDialog,
  HistoryDialog,
  SettingsDialog,
  ShareDialog,
  TechniquesDialog,
  WalkthroughDialog,
} from './dialogs';
import { Header } from './Header';
import { HintBar } from './HintBar';
import { FocusHomeContext, focusQuietly, guardFocus, trackInputModality } from './keepFocus';
import { commandForKey, isModeModifierKey, isRepeatable } from './keyboard';
import { useTheme } from './theme';
import { useSudoku, type Sudoku, type UseSudokuOptions } from './useSudoku';

export interface AppProps {
  /** Test seam for in-memory storage, a synchronous puzzle source, a share link and a clock. */
  options?: UseSudokuOptions;
}

/** Fields where keys are typing, not playing. */
const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Controls where Space means "press me", as it always has, rather than "switch mode". */
const SPACE_CONTROL = 'button, a[href], [role="button"], [role="switch"], [role="menuitem"]';

/** The selected cell: the grid's one tab stop (see Cell's roving tabindex). */
const SELECTED_CELL = '[role="gridcell"][tabindex="0"]';

/** What the board's place shows: the board itself, or a card in its place. */
type BoardContent = { kind: 'board'; game: GameState } | BoardOverlayContent;

function boardContent(sudoku: Sudoku): BoardContent {
  const { phase, difficulty, game, record, elapsedMs, settings, isLoadFailed, actions } = sudoku;
  // Loading is the only phase without a game, so past it there is always one.
  if (phase === 'loading' || game === null) {
    // Behind a dialog there is nothing to say: the dialog has the floor.
    if (sudoku.dialog !== null) return { kind: 'veiled' };
    return isLoadFailed
      ? { kind: 'failed', difficulty, onRetry: actions.retry }
      : { kind: 'loading', difficulty };
  }
  if (phase === 'ready') {
    return {
      kind: 'ready',
      difficulty,
      isShared: record?.source === 'shared',
      challenge: record?.challenge ?? null,
      onStart: actions.resume,
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
    onResume: actions.resume,
  };
}

/**
 * The whole game: the header, the board (or the card in its place), the hint
 * bar, the controls, the status region and the dialogs, wired to the
 * `useSudoku` hook — plus the keyboard, which NYT-style listens on the whole
 * document rather than on whatever has focus.
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

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Modal means modal. Something that has claimed the key already — an
    // open menu moving between its items — keeps it.
    if (dialog !== null || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(TEXT_FIELD)) return;
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
  const counts = game === null ? EMPTY_COUNTS : digitCounts(game);
  const selectedCell = game === null ? null : game.cells[game.selected];
  const canRevealCell = game !== null && isEditable(game, game.selected);
  const canCheckPuzzle =
    game !== null && game.cells.some((cell, i) => cell.value !== 0 && isEditable(game, i));
  // A hint points at a cell; with the board hidden there is none to see.
  // Behind the guide and "Show me" it stays, under the scrim, so they can
  // give focus back to the button in it that opened them.
  const isHintShown = isPlaying || dialog?.kind === 'techniques' || dialog?.kind === 'walkthrough';
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
      <div className="app">
        {/* The board's changes, spoken. The inner element is keyed so the same
          words twice still re-announce: a live region only speaks when its
          contents actually change. */}
        <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {sudoku.announcement && (
            <span key={sudoku.announcement.id}>{sudoku.announcement.text}</span>
          )}
        </div>

        <Header
          difficulty={sudoku.difficulty}
          elapsedMs={sudoku.elapsedMs}
          phase={phase}
          showTimer={settings.showTimer}
          onPause={actions.pause}
          onResume={actions.resume}
          onNewGame={handleNewGame}
          onOpenDialog={actions.openDialog}
        />

        <main className="main">
          <div className="play">
            <div className="play__board">
              {/* Focusable from script (never a tab stop), so focus has
                somewhere to wait while the board is on its way. */}
              <div className="board-area" tabIndex={-1} ref={boardAreaRef}>
                {content.kind === 'board' ? (
                  <Board
                    game={content.game}
                    settings={settings}
                    isPlaying={isPlaying}
                    isCelebrating={sudoku.isCelebrating}
                    onSelect={actions.select}
                    onToggleCandidate={actions.toggleCandidate}
                    takeFocusRequest={takeFocusRequest}
                    describedBy={isCellDescribed ? hintTextId : undefined}
                  />
                ) : (
                  <BoardOverlay
                    // Keyed by kind: each card is a fresh arrival, and takes focus.
                    key={content.kind}
                    {...content}
                    onReleaseFocus={requestBoardFocus}
                    onClaimFocus={withdrawBoardFocus}
                  />
                )}
              </div>
              <HintBar
                hint={isHintShown ? sudoku.shownHint : null}
                textId={hintTextId}
                onShowMe={sudoku.walkthrough === null ? null : actions.showMe}
                notice={sudoku.notice}
                onDismissNotice={actions.dismissNotice}
                onOpenGuide={actions.openTechniques}
              />
            </div>

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

        {dialog?.kind === 'completion' && (
          <CompletionDialog
            {...dialog.result}
            onShare={actions.shareResult}
            onNewGame={() => handleNewGame(dialog.result.difficulty)}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'share' && (
          <ShareDialog
            givens={dialog.target.givens}
            difficulty={dialog.target.difficulty}
            result={dialog.target.result}
            playerName={sudoku.playerName}
            onPlayerNameChange={actions.setPlayerName}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'history' && (
          <HistoryDialog
            records={sudoku.history.records}
            currentId={sudoku.record?.id ?? null}
            resumableIds={sudoku.history.resumableIds}
            now={sudoku.history.now}
            onResume={actions.resumeRecord}
            onReplay={actions.replayRecord}
            onShare={actions.shareRecord}
            onDelete={actions.deleteRecord}
            onExport={actions.exportHistory}
            onImport={actions.importHistory}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'settings' && (
          <SettingsDialog
            settings={settings}
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
            onOpenGuide={actions.openTechniques}
            onClose={actions.closeDialog}
          />
        )}
        {dialog?.kind === 'challenge' && (
          <ChallengeDialog
            difficulty={dialog.offer.puzzle.difficulty}
            previous={dialog.offer.previous}
            challenge={dialog.offer.challenge}
            onPlayAgain={() => {
              requestBoardFocus();
              actions.playAgain();
            }}
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
