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
} from '../core';
import { EASY_PUZZLE, act, startPlaying } from '../test/movePlayers';
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
