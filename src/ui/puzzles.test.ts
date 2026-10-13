import { describe, expect, it, vi } from 'vitest';
import * as core from '../core';
import { HARDEST } from '../test/logic-fixtures';
import { assessmentOf } from './puzzles';

vi.mock('../core', { spy: true });

const HARD = HARDEST.nakedPair.givens;

describe('assessmentOf', () => {
  it('says what a grid makes, as the editor does, grading it once however often it is asked', () => {
    vi.mocked(core.assessGivens).mockClear();
    const first = assessmentOf(HARD);
    expect(first).toEqual(core.assessGivens(HARD));
    expect(first).toMatchObject({ kind: 'ok', puzzle: { givens: HARD, difficulty: 'hard' } });
    vi.mocked(core.assessGivens).mockClear();
    expect(assessmentOf(HARD)).toBe(first);
    expect(core.assessGivens).not.toHaveBeenCalled();
  });

  it('says what stands in the way of a grid that is no puzzle yet', () => {
    expect(assessmentOf('55'.padEnd(81, '0'))).toMatchObject({ kind: 'clash', digit: 5 });
    expect(assessmentOf('123'.padEnd(81, '0'))).toEqual({ kind: 'too-few' });
  });

  it('keeps answering rightly once it has remembered more than it keeps', () => {
    for (let i = 0; i < 1500; i++) {
      expect(assessmentOf(String(i + 1).padEnd(81, '0')).kind).not.toBe('ok');
    }
    expect(assessmentOf(HARD)).toMatchObject({ kind: 'ok' });
  });
});
