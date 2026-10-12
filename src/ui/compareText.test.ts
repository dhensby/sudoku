import type { ProgressMark } from '../core';
import {
  COMPARE_LABEL,
  HELP_NAME,
  cellsText,
  compareTitle,
  endLabelText,
  friendName,
  isolate,
  markName,
  overlayCellLabel,
  readoutText,
  shortName,
} from './compareText';

describe('the words of a comparison', () => {
  it('offers it as Compare solves, headed by the two of you', () => {
    expect(COMPARE_LABEL).toBe('Compare solves');
    expect(compareTitle('Dan')).toBe('You vs Dan');
    expect(compareTitle(null)).toBe('You vs your friend');
  });

  it('isolates a name from a link wherever it is set in plain text', () => {
    expect(isolate('سارة')).toBe('⁨سارة⁩');
    expect(friendName('Dan')).toBe('⁨Dan⁩');
    expect(friendName(null)).toBe('your friend');
  });

  it('reads the cursor out as the time and each player’s cells', () => {
    expect(cellsText(1)).toBe('1 cell');
    expect(cellsText(0)).toBe('0 cells');
    expect(readoutText(135, 34, 28, 'Alice')).toBe('2:15 — You 34 cells, ⁨Alice⁩ 28 cells');
    expect(readoutText(0, 1, 0, null)).toBe('0:00 — You 1 cell, your friend 0 cells');
  });

  it('names each mark by the name the game gives it', () => {
    const mark = (what: ProgressMark['what']): ProgressMark =>
      (what === 'value' || what === 'candidate'
        ? { kind: 'mistake', what, second: 0, solved: 0 }
        : { kind: 'help', what, second: 0, solved: 0 }) as ProgressMark;
    expect(
      (
        [
          'value',
          'candidate',
          'hint',
          'walkthrough',
          'page',
          'checkCell',
          'checkPuzzle',
          'reveal',
        ] as const
      ).map((what) => markName(mark(what))),
    ).toEqual([
      'Mistake',
      'Candidate mistake',
      'Hint',
      'Show me',
      'Show me, another page',
      'Check cell',
      'Check puzzle',
      'Reveal cell',
    ]);
    expect(Object.keys(HELP_NAME)).toHaveLength(6);
  });

  it('labels a line’s end with who and their time, or who alone without one', () => {
    expect(endLabelText('You', 323)).toBe('You 5:23');
    expect(endLabelText('You', null)).toBe('You');
  });

  it('cuts a long name short for a line’s label, by characters rather than code units', () => {
    expect(shortName('Dan')).toBe('Dan');
    expect(shortName('Twelve chars')).toBe('Twelve chars');
    expect(shortName('Alexandra Featherstonehx')).toBe('Alexandra F…');
    expect(shortName('😀😀😀😀😀😀😀😀😀😀😀😀😀')).toBe('😀😀😀😀😀😀😀😀😀😀😀…');
  });

  it('names each cell of the overlaid board by whose its number was', () => {
    expect(overlayCellLabel({ kind: 'empty' }, 'Dan')).toBe('empty');
    expect(overlayCellLabel({ kind: 'both', digit: 7 }, 'Dan')).toBe('7, both of you');
    expect(overlayCellLabel({ kind: 'mine', digit: 7 }, 'Dan')).toBe('7, yours');
    expect(overlayCellLabel({ kind: 'theirs', digit: 7 }, 'Dan')).toBe("7, ⁨Dan⁩'s");
    expect(overlayCellLabel({ kind: 'theirs', digit: 7 }, null)).toBe("7, your friend's");
    expect(overlayCellLabel({ kind: 'different', mine: 3, theirs: 7 }, null)).toBe(
      "yours 3, your friend's 7",
    );
  });
});
