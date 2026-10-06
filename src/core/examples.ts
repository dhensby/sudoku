import { traceTechnique, type TechniqueTrace } from './grader';
import { gridValues } from './grid';
import type { GridString, TechniqueId } from './types';

/*
 * Worked examples for the technique guide: one board per technique, on which
 * that technique is the very next step the grader makes.
 *
 * Every board comes from this project's own generator: the givens of
 * `digMinimal(randomSolution(mulberry32(seed)))` plus the first placements
 * the grader made solving it (seed and count noted alongside). That makes each
 * one a valid puzzle in its own right, with the same unique solution. They
 * were picked by a search over a hundred thousand seeds, every position along
 * each solve, for the clearest instance to teach from:
 *
 * - the technique is the first step from the board, and every candidate on
 *   it follows from the placed digits alone — no earlier elimination the
 *   reader cannot see;
 * - few pattern cells, close together, removing one to four candidates —
 *   ideally opening up a single straight away;
 * - singles that are not also another kind of single, subsets whose cells
 *   share only the house the step names, and hidden subsets cluttered with
 *   other candidates (in all but one cell of the triple), so nothing reads
 *   as a different technique;
 * - for the naked pair, the X-Wing and the chains, whose captions are mostly
 *   numbers, digits that are not also the rows and columns named, so
 *   "3 from row 1, column 4" never reads as "8 from column 8";
 * - and a hint on the board that names the technique itself, so the hint's
 *   "What's a …?" on an example's own board opens that example's entry
 *   (all but the swordfish, whose next placement needs a Skyscraper too).
 *
 * Positions in the comments are counted from one, as the guide shows them.
 */

/** The board each technique's worked example starts from. */
export const EXAMPLE_PUZZLES: Readonly<Record<TechniqueId, GridString>> = {
  // Row 5 lacks only a 6, at column 8. Seed 81916, after 32 placements.
  fullHouse: '915007604267004300438561279726100543851423907349675000603042108100056700500810036',
  // Box 7 can take its 7 only at row 7, column 2. Seed 75422, after 2.
  hiddenSingleBox:
    '000090087500700000700002030001507090000000001000100706002030000983060000006870000',
  // Row 4 can take its 3 only at column 5; box 5 still has two places for
  // it. Seed 28095, after 5.
  hiddenSingleLine:
    '603009000000300040009060053400207810900000007370000204000073000030000400005081000',
  // Row 7, column 3 sees every digit but 3: three in its row, four in its
  // column and one in its box. Seed 16533, after 35.
  nakedSingle: '561723894389145726000968513134286957928357001600419238000602005700804002000501009',
  // Box 1's 8s lie in row 1, clearing row 1, column 4. Seed 14526, after 20.
  pointing: '000009000069020000752146839001080004600000180000610000924761358817532006536090271',
  // Row 6's 4s lie in box 4, clearing row 5, column 2. Seed 70514, after 30.
  claiming: '812094035750138240000025081028500170507801320100270058075416890081057460460082517',
  // {1, 2} twice in row 7, clearing a 2 and a 1 from the cells between them.
  // Seed 78693, after 25.
  nakedPair: '397142865518960420060080091670000904109074680080609000940000536800406279706090148',
  // 5 and 7 fit only two cells of row 1, which lose their 9s. Seed 52517,
  // after 26.
  hiddenPair: '000030041100600530030100070382010790714000020956827314078000152593281467001005983',
  // {3, 5}, {1, 5} and {1, 3} in column 6 — no cell holds all three digits.
  // Seed 86323, after 26.
  nakedTriple: '367000020852407906491620807739200048548700000126894573074006300085340760613570000',
  // 6, 8 and 9 fit only rows 6–8 of column 8, which lose a 5 and a 4.
  // Seed 29012, after 27.
  hiddenTriple: '150608309962310008830090601308900106405861032601073004219700003543100007786439215',
  // Rows 2 and 7 hold their 3s in columns 4 and 9, clearing row 1, column 4.
  // Seed 129146, after 34.
  xWing: '089057006564091070072640905915786300426135798738429561097012050053964107041570009',
  // Rows 2, 4 and 7 hold their 8s in columns 2, 3 and 4, two apiece.
  // Seed 33432, after 40.
  swordfish: '697400035402035679035679024940007056723564981056090047200756493569040718374981562',
  // Pivot {5, 7} with pincers {3, 5} above and {3, 7} beside it; the 3
  // goes from the fourth corner. Seed 82068, after 42.
  xyWing: '002985341384612795519004286450207918827491653901008472100029864040803129298146537',
  // Pivot {3, 8, 9} with pincers {8, 9} along its row and {3, 9} in its box.
  // Seed 59827, after 38.
  xyzWing: '650000007820070005793040021465317298038060714017804563572931486389456172146782359',
  // Columns 3 and 4 hold their 7s in two cells each, one apiece in row 2;
  // the 7 goes from row 5, column 1, which sees both tops. Seed 27146,
  // after 34.
  skyscraper: '004108200080032410201400508825310094003004182140289053679821345312945867458673921',
  // Row 2 and column 4 hold their 1s in two cells each, one apiece in box
  // 2; the 1 goes from row 4, column 7, which sees both far ends. Seed
  // 42146, after 36.
  twoStringKite:
    '127080600605230008803076200708042060209860000461793582586924317372618495914357826',
  // Row 1, column 3 {1, 6} to row 2, column 4 {6, 8}, through {1, 3} and
  // {3, 8}; the 6 goes from row 1, column 4, which sees both ends. Seed
  // 12207, after 36.
  xyChain: '040000857092057041750400092030765429274000560965200710427396185583100976619578234',
  // Row 4, column 6 and row 7, column 5 are both {3, 9}, and column 7's 9s
  // lie in their rows; the 3 goes from row 6, column 5, which sees both.
  // Seed 49031, after 36.
  wWing: '829476135541000786637815400058760014016048570074501608182604057495087060763052840',
  // Row 7's 8s, column 5's, row 2's, then row 2, column 7 switches to 9
  // and column 7's 9s finish it: row 7, column 6 can't be 9. Seed 56290,
  // after 13.
  alternatingChain:
    '268090400510602003370001200005900000901020700007050009456200007792005084183700500',
};

/**
 * The worked example for a technique: its stored board traced to the
 * technique's first step (see `traceTechnique`). For every stored board that
 * step is the very first one, so the trace's `values` are the board itself
 * and its candidates are exactly what the placed digits allow.
 *
 * Throws if a stored board no longer shows its technique — which a change to
 * the techniques could cause, and which the tests rule out.
 */
export function techniqueExample(id: TechniqueId): TechniqueTrace {
  const trace = traceTechnique(gridValues(EXAMPLE_PUZZLES[id]), [id]);
  if (trace === null) throw new Error(`No ${id} step in the stored ${id} example`);
  return trace;
}
