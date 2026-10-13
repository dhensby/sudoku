import { assessGivens, type GivensAssessment, type GridString } from '../core';
import { MAX_SAVED_PUZZLES } from '../storage/puzzles';

/*
 * Your puzzles, as the editor and their list see them: the grid a new one
 * starts from, and what each grid kept makes (see `SavedPuzzle`), worked out
 * afresh rather than stored, so a later grader's label is the one shown —
 * and remembered here, as the list asks it of every row each time it opens.
 */

/** A grid of blanks: what Enter a new puzzle opens on, and what is never kept. */
export const BLANK_GRID: GridString = '0'.repeat(81);

/**
 * The most answers `assessmentOf` keeps: a few hundred bytes each, so a full
 * list's worth costs little, with room beside it for the grids edits leave
 * behind; past this it starts again rather than growing.
 */
const MAX_ASSESSED = MAX_SAVED_PUZZLES + 200;

/**
 * What each grid was found to make, by its numbers. The list opens again
 * each time the editor, or anything else it opens, closes, and grading a
 * puzzle ready to play can take several milliseconds on a phone: once a
 * visit is enough, as the answer for a grid never changes.
 */
const assessed = new Map<GridString, GivensAssessment>();

/**
 * What a grid kept makes (see `assessGivens`) — a puzzle with one solution,
 * labelled as its link will be, or what stands in its way — remembered by
 * its numbers, so asking again costs nothing.
 */
export function assessmentOf(cells: GridString): GivensAssessment {
  const known = assessed.get(cells);
  if (known !== undefined) return known;
  if (assessed.size >= MAX_ASSESSED) assessed.clear();
  const answer = assessGivens(cells);
  assessed.set(cells, answer);
  return answer;
}
