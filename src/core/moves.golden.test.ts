// @vitest-environment node
import { readFileSync } from 'node:fs';
import { MOVES_VERSION, decodeMoveLog, type Move } from '.';
import {
  GOLDEN_SITUATIONS,
  goldenProblems,
  situationsMissed,
  type GoldenFile,
} from '../test/goldenMoveLogs';

/*
 * The guard over the golden move logs, `fixtures/moveLogs.json` (see
 * `src/test/goldenMoveLogs.ts`). A saved log is replayed under the rules it
 * was recorded by, which `MOVES_VERSION` names; if `reduce` changes what it
 * does with a logged move while the version stays put, every player's saved
 * logs quietly replay into games they never played. This is where that is
 * caught, with a message that says what to do.
 */

const TEXT = readFileSync(new URL('./fixtures/moveLogs.json', import.meta.url), 'utf8');
const GOLDEN = JSON.parse(TEXT) as GoldenFile;

/** The golden games as puzzles and decoded logs. */
const LOGS = GOLDEN.games.map((game) => ({
  puzzle: { givens: game.givens, solution: game.solution, difficulty: game.difficulty },
  log: decodeMoveLog(game.log)!,
}));

/** Every kind of move, by the name a guard reports it under. */
function kindOf(move: Move): string {
  if (move.op === 'place') return move.clearPeerNotes ? 'place, clearing peers' : 'place';
  if (move.op !== 'hint') return move.op;
  return move.hint.index === -1 ? 'hint off the grid' : `hint: ${move.hint.kind}`;
}

describe('the golden move logs', () => {
  it('replay step for step into the games pinned for this MOVES_VERSION', () => {
    const problems = goldenProblems(GOLDEN);
    // Thrown rather than compared, so the message reads as written.
    if (problems.length > 0) throw new Error(`\n\n${problems.join('\n\n')}\n`);
  });

  it('exercise every kind of move between them', () => {
    const kinds = new Set(
      GOLDEN.games.flatMap((game) => decodeMoveLog(game.log)!.moves.map(kindOf)),
    );
    expect([...kinds].sort()).toEqual(
      [
        'autoOff',
        'autoOn',
        'candidate',
        'checkCell',
        'checkGuessesOff',
        'checkGuessesOn',
        'checkPuzzle',
        'erase',
        'hint off the grid',
        'hint: deduction',
        'hint: mistake',
        'hint: single',
        'hint: struck',
        'place',
        'place, clearing peers',
        'redo',
        'reset',
        'reveal',
        'undo',
        'walkthrough',
      ].sort(),
    );
  });

  // The guard reaches only the rules its logs pass through: this is what
  // keeps a rule from going unguarded when a golden game is dropped or
  // replayed differently.
  it('pass through every situation in which the reducer treats a move its own way', () => {
    const missed = situationsMissed(LOGS);
    if (missed.length > 0) {
      throw new Error(
        `\n\nNo golden log passes through:\n${missed.map((name) => `  - ${name}`).join('\n')}\n\nAdd a step that does to tourTheRules (src/test/movePlayers.ts) and run npm run moves:golden.\n`,
      );
    }
  });

  it('report a situation no log passes through', () => {
    const [placing] = LOGS;
    const missed = situationsMissed([placing]);
    expect(missed).toContain('Show me opened again, for free');
    expect(missed).not.toContain('a placement that completes the grid');
    expect(situationsMissed([])).toEqual(GOLDEN_SITUATIONS.map(({ name }) => name));
  });

  describe('fail with a message that says what to do', () => {
    const [first] = GOLDEN.games;

    it('when MOVES_VERSION has been bumped and the logs not recorded again', () => {
      const problems = goldenProblems({ ...GOLDEN, rules: MOVES_VERSION - 1 });
      expect(problems.join('\n')).toMatch(/recorded under rules version .*npm run moves:golden/);
    });

    it('when a replay ends in a different game', () => {
      const end = { ...first.end, undo: first.end.undo + 1 };
      const problems = goldenProblems({ ...GOLDEN, games: [{ ...first, end }] });
      expect(problems[0]).toMatch(/ends differently \(undo\)/);
      expect(problems.at(-1)).toMatch(/bump MOVES_VERSION .*npm run moves:golden/);
    });

    it('when a replay takes a different path to the same game', () => {
      const problems = goldenProblems({ ...GOLDEN, games: [{ ...first, trace: '00000000' }] });
      expect(problems[0]).toMatch(/takes a different path/);
      expect(problems.at(-1)).toMatch(/bump MOVES_VERSION/);
    });

    it('when a log no longer decodes', () => {
      const problems = goldenProblems({ ...GOLDEN, games: [{ ...first, log: 'BBA' }] });
      expect(problems[0]).toMatch(/no longer decodes/);
    });
  });
});
