import {
  DIFFICULTY_LABEL,
  TECHNIQUE_LABEL,
  capitalise,
  assistPartText,
  assistParts,
  count,
  plural,
  describeAssists,
  describeMistakes,
  describeResult,
  formatDate,
  hasAssists,
  joinList,
  withArticle,
} from './format';

const NONE = { autoCandidates: false, hints: 0, checks: 0, reveals: 0 };

describe('labels', () => {
  it('names every tier and technique', () => {
    expect(Object.values(DIFFICULTY_LABEL)).toEqual(['Easy', 'Medium', 'Hard', 'Expert']);
    expect(TECHNIQUE_LABEL.xyWing).toBe('XY-Wing');
    expect(TECHNIQUE_LABEL.hiddenSingleBox).toBe(TECHNIQUE_LABEL.hiddenSingleLine);
  });

  it('names pointing for both its shapes, since a hint can point at a triple', () => {
    expect(TECHNIQUE_LABEL.pointing).toBe('pointing pair or triple');
    expect(withArticle(TECHNIQUE_LABEL.pointing)).toBe('a pointing pair or triple');
  });

  it('picks the article by sound', () => {
    expect(withArticle('Easy')).toBe('an Easy');
    expect(withArticle('Expert')).toBe('an Expert');
    expect(withArticle('Medium')).toBe('a Medium');
    expect(withArticle('Hard')).toBe('a Hard');
    // X is said "ex".
    expect(withArticle('XY-Wing')).toBe('an XY-Wing');
    expect(withArticle('Swordfish')).toBe('a Swordfish');
  });

  it('capitalises the first letter only, so a name keeps its own capitals', () => {
    expect(capitalise('hidden single')).toBe('Hidden single');
    expect(capitalise('X-Wing')).toBe('X-Wing');
    expect(capitalise('')).toBe('');
  });

  it('joins a list the British way, with no comma before the "and"', () => {
    expect(joinList([])).toBe('');
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b'])).toBe('a and b');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('counts a noun, plural unless there is exactly one', () => {
    expect(count(0, 'game')).toBe('0 games');
    expect(count(1, 'game')).toBe('1 game');
    expect(count(3, 'new game')).toBe('3 new games');
  });
});

describe('assists', () => {
  it('treats a game with no help as unassisted', () => {
    expect(hasAssists(NONE)).toBe(false);
    expect(describeAssists(NONE)).toBeNull();
  });

  it.each([
    [{ ...NONE, autoCandidates: true }, 'auto candidates'],
    [{ ...NONE, hints: 1 }, '1 hint'],
    [{ ...NONE, hints: 2, checks: 1 }, '2 hints, 1 check'],
    [
      { autoCandidates: true, hints: 1, checks: 2, reveals: 3 },
      'auto candidates, 1 hint, 2 checks, 3 reveals',
    ],
    [{ ...NONE, reveals: 1 }, '1 reveal'],
    [{ ...NONE, checkGuesses: true as const }, 'guesses checked as entered'],
    [
      { autoCandidates: true, hints: 2, checks: 0, reveals: 0, checkGuesses: true as const },
      'auto candidates, guesses checked as entered, 2 hints',
    ],
  ])('describes %o as "%s"', (assists, text) => {
    expect(hasAssists(assists)).toBe(true);
    expect(describeAssists(assists)).toBe(text);
  });
});

describe('assistParts', () => {
  it('is empty for an unaided game', () => {
    expect(assistParts(NONE)).toEqual([]);
  });

  it('names the switches whole and keeps each count apart from its noun, in History’s order', () => {
    const parts = assistParts({
      autoCandidates: true,
      checkGuesses: true,
      hints: 2,
      checks: 1,
      reveals: 3,
    });
    expect(parts).toEqual([
      { count: null, words: 'Auto candidates' },
      { count: null, words: 'Checked as entered' },
      { count: 2, words: 'hints' },
      { count: 1, words: 'check' },
      { count: 3, words: 'reveals' },
    ]);
    expect(parts.map(assistPartText)).toEqual([
      'Auto candidates',
      'Checked as entered',
      '2 hints',
      '1 check',
      '3 reveals',
    ]);
  });

  it('makes a noun plural unless there is exactly one', () => {
    expect(plural(1, 'hint')).toBe('hint');
    expect(plural(0, 'hint')).toBe('hints');
    expect(plural(2, 'reveal')).toBe('reveals');
  });
});

describe('describeMistakes', () => {
  it.each([
    [{ values: 0, candidates: 0 }, 'No mistakes'],
    [{ values: 1, candidates: 0 }, '1 mistake'],
    [{ values: 4, candidates: 0 }, '4 mistakes'],
    [{ values: 0, candidates: 1 }, '1 candidate mistake'],
    [{ values: 0, candidates: 3 }, '3 candidate mistakes'],
    [{ values: 1, candidates: 1 }, '1 mistake · 1 candidate mistake'],
    [{ values: 2, candidates: 5 }, '2 mistakes · 5 candidate mistakes'],
  ])('describes %o as "%s", wrong numbers and struck answers apart', (mistakes, text) => {
    expect(describeMistakes(mistakes)).toBe(text);
  });
});

describe('describeResult', () => {
  const CLEAN = { values: 0, candidates: 0 };
  it.each<[string, typeof NONE, { values: number; candidates: number } | null, string | null]>([
    ['a clean, unaided solve', NONE, CLEAN, 'No mistakes'],
    ['a clean solve with help', { ...NONE, hints: 2 }, CLEAN, 'No mistakes · with 2 hints'],
    [
      'mistakes and help',
      { ...NONE, autoCandidates: true, checks: 1 },
      { values: 1, candidates: 2 },
      '1 mistake · 2 candidate mistakes · with auto candidates, 1 check',
    ],
    ['help with the mistakes not known', { ...NONE, reveals: 1 }, null, 'With 1 reveal'],
    ['an unaided solve with the mistakes not known', NONE, null, null],
  ])('describes %s', (_label, assists, mistakes, text) => {
    expect(describeResult(assists, mistakes)).toBe(text);
  });
});

describe('formatDate', () => {
  const now = new Date(2026, 9, 4, 15, 30).getTime(); // 4 Oct 2026, 15:30 local

  it('says "Today" with the time for games played today', () => {
    expect(formatDate(new Date(2026, 9, 4, 9, 5).getTime(), now)).toBe('Today 09:05');
  });

  it('says "Yesterday" across midnight, by calendar day rather than 24 hours', () => {
    expect(formatDate(new Date(2026, 9, 3, 23, 59).getTime(), now)).toBe('Yesterday 23:59');
    expect(formatDate(new Date(2026, 9, 3, 0, 1).getTime(), now)).toBe('Yesterday 00:01');
  });

  it('drops the year within the same year and keeps it otherwise', () => {
    expect(formatDate(new Date(2026, 8, 12, 12, 0).getTime(), now)).toBe('12 Sept');
    expect(formatDate(new Date(2025, 9, 3, 12, 0).getTime(), now)).toBe('3 Oct 2025');
  });
});
