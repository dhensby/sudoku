import {
  createGame,
  encodeMoveLog,
  preparePlayback,
  type GameState,
  type MistakeEvent,
  type Digit,
  type MoveChange,
  type PlaybackFrame,
  type PlaybackRefusal,
  type StepHint,
  type TechniqueId,
  type Unit,
} from '../core';
import { createRng } from '../core/rng';
import {
  EASY_PUZZLE,
  act,
  showMeOnceAStepIsTaken,
  startPlaying,
  stepHintsTour,
} from '../test/movePlayers';
import {
  REFUSAL_TEXT,
  START_CAPTION,
  TICK_LABEL,
  captionAt,
  describeMove,
  positionText,
} from './playbackText';

const PLAYING: GameState = createGame(EASY_PUZZLE);
const SOLVED: GameState = { ...PLAYING, status: 'solved' };

/** A frame of a playback with `change` on show, as `preparePlayback` would make it. */
function frame(
  change: MoveChange | Omit<MoveChange, 'at'>,
  options: { mistakes?: Partial<MistakeEvent>[]; isSolved?: boolean } = {},
): PlaybackFrame {
  return {
    index: 0,
    change: { at: 0, ...change } as MoveChange,
    state: options.isSolved ? SOLVED : PLAYING,
    cell: null,
    mistakes: (options.mistakes ?? []) as MistakeEvent[],
  };
}

describe('describeMove', () => {
  it.each([
    [{ op: 'place', cell: 20, digit: 5, clearPeerNotes: false }, '5 in row 3, column 3'],
    [{ op: 'place', cell: 80, digit: 9, clearPeerNotes: true }, '9 in row 9, column 9'],
    [
      { op: 'candidate', cell: 21, digit: 3, effect: 'struck', cleared: null },
      'Struck 3 in row 3, column 4',
    ],
    [
      { op: 'candidate', cell: 21, digit: 3, effect: 'pencilled', cleared: null },
      'Pencilled 3 in row 3, column 4',
    ],
    [
      { op: 'candidate', cell: 21, digit: 3, effect: 'unchanged', cleared: null },
      'Candidate 3 in row 3, column 4',
    ],
    [
      { op: 'candidate', cell: 21, digit: 5, effect: 'struck', cleared: 6 },
      'Cleared 6, struck 5 in row 3, column 4',
    ],
    [
      { op: 'candidate', cell: 21, digit: 5, effect: 'pencilled', cleared: 6 },
      'Cleared 6, pencilled 5 in row 3, column 4',
    ],
    [
      { op: 'candidate', cell: 21, digit: 6, effect: 'unchanged', cleared: 6 },
      'Cleared 6 in row 3, column 4',
    ],
    [{ op: 'erase', cell: 21 }, 'Erased row 3, column 4'],
    [{ op: 'walkthrough', cell: 0 }, 'Show me for row 1, column 1'],
    [
      { op: 'page', cell: 9, id: 1, page: { step: 3, of: 7 } },
      'Show me for row 2, column 1: step 3 of 7',
    ],
    [{ op: 'page', cell: 9, id: 1, page: null }, 'Show me for row 2, column 1'],
    [{ op: 'checkCell', cell: 21 }, 'Checked row 3, column 4'],
    [{ op: 'checkPuzzle' }, 'Checked the puzzle'],
    [{ op: 'reveal', cell: 21 }, 'Revealed row 3, column 4'],
    [{ op: 'autoOn', cell: 4 }, 'Auto candidates on'],
    [{ op: 'autoOff', cell: 4 }, 'Auto candidates off'],
    [{ op: 'checkGuessesOn' }, 'Check guesses on'],
    [{ op: 'checkGuessesOff' }, 'Check guesses off'],
    [{ op: 'undo' }, 'Undo'],
    [{ op: 'redo' }, 'Redo'],
    [{ op: 'reset' }, 'Reset'],
  ] as const)('says what %o did', (change, caption) => {
    expect(describeMove(frame(change))).toBe(caption);
  });

  it.each([
    [{ kind: 'mistake', index: 21 }, 'Hint: a wrong number in row 3, column 4'],
    [{ kind: 'mistake', index: -1 }, 'Hint: a wrong number'],
    [{ kind: 'struck', index: 21 }, 'Hint: a candidate missing in row 3, column 4'],
    [{ kind: 'struck', index: -1 }, 'Hint: a candidate missing'],
    [
      { kind: 'single', index: 21, technique: 'hiddenSingleBox', unit: { kind: 'box', index: 1 } },
      'Hint: Hidden single in box 2',
    ],
    [
      { kind: 'single', index: 21, technique: 'fullHouse', unit: { kind: 'row', index: 2 } },
      'Hint: Full house in row 3',
    ],
    [
      {
        kind: 'single',
        index: 21,
        technique: 'hiddenSingleLine',
        unit: { kind: 'column', index: 3 },
      },
      'Hint: Hidden single in column 4',
    ],
    [
      { kind: 'single', index: 21, technique: 'nakedSingle', unit: null },
      'Hint: Naked single in row 3, column 4',
    ],
    [{ kind: 'deduction', index: 21, technique: 'xWing' }, 'Hint: X-Wing'],
    [{ kind: 'deduction', index: 21, technique: 'pointing' }, 'Hint: Pointing pair or triple'],
    [{ kind: 'deduction', index: 21, technique: null }, 'Hint: try row 3, column 4'],
    [{ kind: 'deduction', index: -1, technique: null }, 'Hint'],
  ] as const)('names the hint %o', (hint, caption) => {
    expect(describeMove(frame({ op: 'hint', hint }))).toBe(caption);
  });

  /** A step hint about row 2, column 1 (cell 9), its route `of` steps long. */
  const step = (
    technique: TechniqueId,
    unit: Unit | null,
    numbering: { step: number; of: number },
  ): StepHint => ({
    kind: 'step',
    index: 9,
    technique,
    unit,
    ...numbering,
    hardest: 'xyChain',
    id: 1,
  });

  it.each([
    [
      step('claiming', { kind: 'column', index: 7 }, { step: 1, of: 7 }),
      'Hint: step 1 of 7, a box/line reduction in column 8',
    ],
    [
      step('hiddenTriple', { kind: 'row', index: 3 }, { step: 2, of: 7 }),
      'Hint: step 2 of 7, a hidden triple in row 4',
    ],
    // A step with no house of its own is named alone.
    [step('xWing', null, { step: 5, of: 7 }), 'Hint: step 5 of 7, an X-Wing'],
    [step('xyChain', null, { step: 2, of: 3 }), 'Hint: step 2 of 3, an XY-Chain'],
    // A single on the way, filling another cell in a house the hinted one is in.
    [
      step('hiddenSingleBox', { kind: 'box', index: 0 }, { step: 6, of: 7 }),
      'Hint: step 6 of 7, a hidden single elsewhere in box 1',
    ],
    [
      step('nakedSingle', { kind: 'box', index: 5 }, { step: 1, of: 7 }),
      'Hint: step 1 of 7, a naked single in box 6',
    ],
    // The last step, the single that fills the cell, as a single always is.
    [
      step('hiddenSingleBox', { kind: 'box', index: 0 }, { step: 3, of: 3 }),
      'Hint: Hidden single in box 1',
    ],
    [step('nakedSingle', null, { step: 1, of: 1 }), 'Hint: Naked single in row 2, column 1'],
  ] as const)('names the step a step hint named: %o', (hint, caption) => {
    expect(describeMove(frame({ op: 'hint', hint }))).toBe(caption);
  });

  it('says when a move was a mistake that counted', () => {
    const place = { op: 'place', cell: 20, digit: 5, clearPeerNotes: false } as const;
    expect(describeMove(frame(place, { mistakes: [{ kind: 'value', outcome: 'counted' }] }))).toBe(
      '5 in row 3, column 3 — a mistake',
    );
    expect(
      describeMove(
        frame(
          { op: 'candidate', cell: 20, digit: 5, effect: 'struck', cleared: null },
          { mistakes: [{ kind: 'candidate', outcome: 'counted' }] },
        ),
      ),
    ).toBe('Struck 5 in row 3, column 3 — a candidate mistake');
    expect(
      describeMove(frame({ op: 'undo' }, { mistakes: [{ kind: 'value', outcome: 'counted' }] })),
    ).toBe('Undo — a mistake');
  });

  it('says when a move was a slip put right in time', () => {
    const place = { op: 'place', cell: 20, digit: 5, clearPeerNotes: false } as const;
    expect(describeMove(frame(place, { mistakes: [{ kind: 'value', outcome: 'forgiven' }] }))).toBe(
      '5 in row 3, column 3 — a slip, put right in time',
    );
  });

  it('puts a counted mistake before a forgiven one made by the same move', () => {
    const mistakes = [
      { kind: 'value', outcome: 'forgiven' },
      { kind: 'value', outcome: 'counted' },
    ] as const;
    expect(describeMove(frame({ op: 'redo' }, { mistakes: [...mistakes] }))).toBe(
      'Redo — a mistake',
    );
  });

  it('says which move solved the puzzle', () => {
    const place = { op: 'place', cell: 80, digit: 9, clearPeerNotes: false } as const;
    expect(describeMove(frame(place, { isSolved: true }))).toBe('9 in row 9, column 9 — solved');
    expect(
      describeMove(
        frame(place, { isSolved: true, mistakes: [{ kind: 'value', outcome: 'forgiven' }] }),
      ),
    ).toBe('9 in row 9, column 9 — a slip, put right in time — solved');
  });
});

describe('a playback’s words', () => {
  const blanks = [0, 40, 80];
  const cells = EASY_PUZZLE.solution.split('');
  for (const index of blanks) cells[index] = '0';
  const givens = cells.join('');
  let played = startPlaying({ ...EASY_PUZZLE, givens });
  played = blanks.reduce(
    (game, cell, i) =>
      act(
        game,
        {
          type: 'enter',
          digit: Number(EASY_PUZZLE.solution[cell]) as 1,
          index: cell,
          mode: 'normal',
        },
        (i + 1) * 61_000,
      ),
    played,
  );
  const result = preparePlayback(givens, 'easy', encodeMoveLog(played.log));
  if (!result.ok) throw new Error(result.reason);
  const { playback } = result;

  it('captions the start, before any move, and each move after', () => {
    expect(captionAt(playback, 0)).toBe(START_CAPTION);
    expect(START_CAPTION).toBe('Before the first move');
    expect(captionAt(playback, 1)).toBe('5 in row 1, column 1');
    expect(captionAt(playback, 3)).toBe('9 in row 9, column 9 — solved');
  });

  it('gives the scrubber’s place as the move on show and its play time', () => {
    expect(positionText(playback, 0)).toBe('Start, 0:00');
    expect(positionText(playback, 1)).toBe('Move 1 of 3, 1:01');
    expect(positionText(playback, 3)).toBe('Move 3 of 3, 6:06');
  });
});

describe('a solve with step hints and Show me a page at a time', () => {
  it('captions each step hint and each page as the player saw them', () => {
    const toured = stepHintsTour(createRng('captions'));
    const result = preparePlayback(toured.game.puzzle.givens, 'expert', encodeMoveLog(toured.log));
    if (!result.ok) throw new Error(result.reason);
    const captions = result.playback.frames.map((_, i) => captionAt(result.playback, i + 1));
    // Stuck at row 2, column 1: its first step named twice, then Show me
    // opened and turned twice, and opened again at its first page.
    const opened = captions.indexOf('Show me for row 2, column 1: step 1 of 7');
    expect(captions.slice(opened - 2, opened + 4)).toEqual([
      'Hint: step 1 of 7, a box/line reduction in column 8',
      'Hint: step 1 of 7, a box/line reduction in column 8',
      'Show me for row 2, column 1: step 1 of 7',
      'Show me for row 2, column 1: step 2 of 7',
      'Show me for row 2, column 1: step 3 of 7',
      'Show me for row 2, column 1: step 1 of 7',
    ]);
    expect(captions).toContain('Hint: step 2 of 7, a hidden triple in row 4');
    expect(captions).toContain('Hint: step 5 of 7, an X-Wing');
  });

  it('captions the pages of a Show me opened once a step is taken as they were headed', () => {
    const { game, log } = showMeOnceAStepIsTaken();
    const result = preparePlayback(game.puzzle.givens, 'expert', encodeMoveLog(log));
    if (!result.ok) throw new Error(result.reason);
    const captions = result.playback.frames.map((_, i) => captionAt(result.playback, i + 1));
    expect(captions.filter((caption) => caption.startsWith('Show me'))).toEqual([
      'Show me for row 2, column 1: step 2 of 7',
      'Show me for row 2, column 1: step 4 of 7',
    ]);
  });
});

describe('a candidate entry over a wrong value', () => {
  it('says the answer was struck, as its mistake note does', () => {
    const cells = EASY_PUZZLE.solution.split('');
    cells[0] = '0';
    const givens = cells.join('');
    const answer = Number(EASY_PUZZLE.solution[0]) as Digit;
    const wrong = ((answer % 9) + 1) as Digit;
    const enter = (digit: Digit, mode: 'normal' | 'candidate') =>
      ({ type: 'enter', digit, index: 0, mode }) as const;
    let played = startPlaying({ ...EASY_PUZZLE, givens });
    // The answer pencilled, a wrong digit placed over it, then the answer
    // entered as a candidate: the value goes, and the note under it with it.
    for (const action of [
      enter(answer, 'candidate'),
      enter(wrong, 'normal'),
      enter(answer, 'candidate'),
      enter(answer, 'normal'),
    ]) {
      played = act(played, action, 61_000);
    }
    const result = preparePlayback(givens, 'easy', encodeMoveLog(played.log));
    if (!result.ok) throw new Error(result.reason);
    expect(captionAt(result.playback, 3)).toBe(
      `Cleared ${wrong}, struck ${answer} in row 1, column 1 — a candidate mistake`,
    );
  });
});

describe('the labels', () => {
  it('names each kind of mark on the scrubber', () => {
    expect(TICK_LABEL).toEqual({ mistake: 'Mistake', slip: 'Slip put right', help: 'Help' });
  });

  it.each([
    ['puzzle', /isn't one the game can play/],
    ['older', /older version/],
    ['newer', /newer version.*Reload/],
    ['broken', /damaged/],
    ['unsolved', /stops short of the solve/],
  ] as const)('says why a %s log cannot be played back', (reason, text) => {
    expect(REFUSAL_TEXT[reason as PlaybackRefusal]).toMatch(text);
  });
});
