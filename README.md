# Sudoku

An NYT-style Sudoku for when the day's three puzzles are done: **unlimited Easy, Medium, Hard and
Expert puzzles**, Normal and Candidate modes, **Auto Candidate Mode**, a pause that really hides
the board, a **history** of everything you have played — and **links to race your friends** on
the same puzzle. Built with React, TypeScript and Vite, and runs entirely in your browser.

**[▶ Play it in your browser](https://dhensby.github.io/sudoku/)** — the latest green build of
`main`, deployed to GitHub Pages.

## Features

- **Four difficulties, never-ending** — Easy, Medium and Hard are pitched like the NYT puzzles of
  the same names; Expert goes further, into X-Wings, XY-Wings and chains such as the XY-Chain,
  needed while much of the grid is still empty rather than as a last snag. Every puzzle is
  generated on the spot, has exactly one solution, and is graded by the hardest technique it
  needs, so the label never lies.
- **Plays like the NYT game** — Normal and Candidate modes (<kbd>Space</kbd> to switch, or hold
  <kbd>Shift</kbd>/<kbd>Alt</kbd> to switch while held), the two-step erase, highlighting of the
  row, column, box and matching numbers, a red dot on every conflict, givens on grey, and clicking
  a candidate's spot in the selected cell to toggle it.
- **Auto Candidate Mode, modelled exactly on NYT's** — your own notes and the automatic candidates
  are separate layers: switching it on fills every empty cell, placing a number clears it from the
  row, column and box, and candidates you strike out yourself stay struck out, even if you switch
  it off and on again. Turning it off brings your own notes back untouched.
- **Undo and Redo** — unlimited, including switching auto candidates (NYT has no Redo).
- **A timer that keeps an honest time** — it runs off a monotonic clock rather than counting
  ticks, so neither a busy tab nor changing the computer's clock can stretch or shrink it. It
  pauses the moment you switch tabs or open a dialog, and a stopped clock **hides the board**
  completely, so a paused game can't be studied. A puzzle that arrives while the tab is hidden
  waits behind a **Start** card, as does one you never started. Progress is saved every few
  seconds while the clock runs, and a reload reopens your game paused, where you left off.
- **Race your friends** — share a link to any puzzle. Once you have solved it, the link carries
  your time too: your friend sees "Dan solved this Hard puzzle in 5:23. Can you beat it?", starts
  the clock when they are ready, and gets a head-to-head comparison at the end — plus a link of
  their own to send back. Nothing is uploaded; everything travels in the link.
- **History and stats** — every game you play is kept: resume unfinished ones, play a solved
  puzzle again, share it, or delete it. A game you only glanced at — nothing entered, no help
  taken — is dropped when you move on to another, so browsing the levels doesn't clutter the list
  or count as played. Per-difficulty stats show games played and solved, and best and average
  times. Export your history to a file and import it on another browser.
- **Help when you want it** — Hint points at a cell you can fill next and names the technique
  ("Hidden single: there's only one place for a number in this box"), without ever giving the
  number away. A cell **remembers its hint**: select it again and the hint is back under the
  board (and in the cell's description for a screen reader) — brought up to date if the board has
  moved on, so a cell that needed a hidden pair and now needs only a single says so — and asking
  again for the same cell isn't counted again. Still stuck? **Show me**, beside the hint, walks
  through the steps that solve that one cell — only the steps it depends on, however far across
  the board the solve wandered, and none it could do without — each drawn on your own board with
  the cell marked, a caption that says which earlier step removed what, and the answer at the end.
  It counts as one more hint, once per cell. Whether it is on offer never gives away a wrong digit
  elsewhere: pressed with one on the board, it points at that instead, as Hint would. On a phone on
  its side, each step's board is sized to the screen with its caption beside it. Check cell, Check
  puzzle and Reveal cell are in the "…" menu. Any help you take (auto candidates included) is
  recorded next to your time, so comparisons stay fair.
- **A guide to the solving techniques** — every technique the grader knows, from a full house to
  the XY-Chain: its other names, what it is, why it works, how to spot it, and a worked
  example from a real puzzle, drawn with the pattern ringed (and a chain's links traced), the
  candidates it removes struck out and a caption that walks through it. A hint that names a
  technique asks "What's a hidden single?" — press it and the guide opens at that entry (each step
  of Show me asks too, and the guide hands back to the step you were on). It is in the header too
  (the book; on a phone, the
  ☰ menu), and in Help. Reading it pauses the clock like any dialog, and is not counted as help.
- **Keyboard and screen-reader friendly** — the board is a real ARIA grid, every move is
  announced in a status region, dialogs take and trap focus, and the whole game can be played
  from the keyboard.
- **At home on a phone** — the whole game fits a 320×568 screen, or a phone turned on its side,
  without scrolling, and on a taller phone the controls sit at the foot of the screen, under your
  thumb; History, Share, Settings, the technique guide and Help fold into a ☰ menu so the header
  stays one row; touch targets are at least 44px; and the game can be added to your home screen.
- **Broadsheet, a theme drawn for clarity** — the puzzle page of a morning paper: warm newsprint,
  ink-black box lines, one ultramarine spot colour, the selected cell printed as a solid block,
  givens typeset in a slab and your own numbers in a grotesque. Givens and your own numbers hold
  at least 7:1 contrast (WCAG AAA) on every cell they can sit on, and checked and revealed numbers
  and candidates at least 4.5:1; each highlight is a step of lightness as well as of hue — checked
  under simulated colour-blindness — and checked and revealed numbers carry a tick or an italic as
  well as a colour. A night edition is drawn for the dark rather than
  inverted (it follows your system, or pick Light or Dark in Settings), and the game stays
  playable in Windows High Contrast.

## Tech stack

React 19 · TypeScript (strict) · Vite · Vitest + Testing Library · Playwright · ESLint + Prettier.
See [`package.json`](package.json) for exact versions.

### Fonts

[Bitter](https://github.com/solmatas/BitterPro) (Huerta Tipográfica) for the wordmark, titles
and givens, and [Schibsted Grotesk](https://github.com/schibsted/schibsted-grotesk) (Schibsted /
Bakken & Bæck) for everything else — both under the
[SIL Open Font License 1.1](https://openfontlicense.org), and bundled with the app through
[Fontsource](https://fontsource.org) (`@fontsource-variable/bitter`,
`@fontsource-variable/schibsted-grotesk`), so no font service is contacted while you play.

The design keeps a hard line between logic and presentation:

- **`src/core/`** — a pure, framework-free engine: grid geometry, a bitmask solver, a human-style
  logical grader (with a worked example of every technique it knows), the puzzle generator, hints,
  walkthroughs (Show me: the steps one cell depends on, sliced from a solve, pruned of any it can
  do without and checked step by step), share-link codec, clock arithmetic and the game reducer
  (which remembers each cell's hints). No DOM, no React and no English;
  `reduce(state, action)` is a pure function, randomness is passed in, and the whole directory is
  held to 100% coverage.
- **`src/storage/`** — a thin, injectable `localStorage` layer for preferences, the history and
  saved games, which validates everything it reads back and never lets a full or broken storage
  stop play.
- **`src/worker/`** — the module Web Worker that generates puzzles off the main thread.
- **`src/ui/`** — React components and hooks that render the engine's state and turn input into
  actions, plus the dialogs in `src/ui/dialogs/`.

## Getting started

Requires **Node 22.12 or newer**.

```bash
npm install
npm run dev        # start the dev server (http://localhost:5173)
```

### Scripts

| Script                 | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `npm run dev`          | Start the Vite dev server                               |
| `npm run build`        | Type-check and build the production bundle to `dist/`   |
| `npm run preview`      | Serve the production build locally                      |
| `npm test`             | Run unit & component tests once                         |
| `npm run test:watch`   | Run tests in watch mode                                 |
| `npm run coverage`     | Run tests with coverage (100% enforced on `src/core`)   |
| `npm run test:e2e`     | Build, preview and run the Playwright end-to-end suite  |
| `npm run typecheck`    | `tsc --noEmit`                                          |
| `npm run lint`         | ESLint                                                  |
| `npm run lint:fix`     | ESLint with `--fix`                                     |
| `npm run format`       | Format with Prettier                                    |
| `npm run format:check` | Check formatting without writing (this is what CI runs) |

## How puzzles are made

Each new puzzle is generated in a Web Worker, in a fraction of a second:

1. Fill a random complete grid, then remove givens in random order for as long as the puzzle
   keeps exactly one solution. That leaves a _minimal_ puzzle — every given is needed — with
   21–28 givens, like NYT's Medium and Hard. NYT puzzles are not symmetric, and neither are these.
2. Solve it the way a person would, always applying the easiest technique that makes progress,
   and grade it by the hardest technique the solve needed:

   | Tier   | Hardest technique needed                                                  |
   | ------ | ------------------------------------------------------------------------- |
   | Easy   | Full houses and hidden singles in a box (padded to 38 givens)             |
   | Medium | Pointing pairs or box/line reductions                                     |
   | Hard   | Naked or hidden pairs and triples                                         |
   | Expert | X-Wing, Swordfish, XY- or XYZ-Wing, Skyscraper, 2-String Kite or XY-Chain |

3. Keep it if it is the tier you asked for; otherwise try again. Expert has one more rule: its
   fish, wing or chain must be needed while at least 40 cells are still empty. Left to chance,
   most puzzles that need one only need it near the end, where it is quick to spot or to guess
   past — and they play like a Hard.

The tiers were calibrated against hundreds of published NYT puzzles: Easy needs only box hidden
singles, every Medium needs locked candidates, and Hard needs pairs and triples but never a fish
or a wing. Each tier rarely takes more than a hundred attempts — well under a second — and while
you play, the next puzzle of the same tier is already being prepared, so "New game" is instant.

## Racing friends

A share link carries the puzzle itself, so it opens the same puzzle for anyone, on any version of
the game — there is no server and nothing is uploaded.

| Parameter      | Meaning                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `?p=<code>`    | The puzzle: its givens packed into ~26–34 URL-safe characters.                          |
| `&t=<secs>`    | The sharer's time in whole seconds — the time to beat.                                  |
| `&n=<name>`    | The sharer's name (optional; past 24 characters it is cut short with an ellipsis).      |
| `&a=<assists>` | Help the sharer took: `c` auto candidates, `h<N>` hints, `k<N>` checks, `r<N>` reveals. |

Opening a link:

- **A puzzle you haven't played** opens behind a "Ready?" card showing the time to beat, and the
  clock only starts when you press **Start** — so both of you start the same way. Until you do, a
  reload or a second click on the link brings the same card back.
- **A puzzle you're part-way through** reopens your game, with the challenge attached.
- **A puzzle you've already solved** shows how your time compares — your newest time that
  counted, rather than a replay's — and offers to play it again (which carries on an unfinished
  attempt, if you have one).
- **A broken link** says so and carries on with a fresh puzzle (or the game you were playing).

The difficulty is always re-graded from the puzzle itself rather than taken from the link, and
the parameters are cleared from the address bar once read, so reloading never drags you back.

Times are on the honour system: the link says what time you claim, and nothing can verify it. It
is a game between friends. What the game does do is keep its own records honest — a reset clears
the board but not the clock, a game with revealed cells never sets a best time, and neither does
playing a puzzle again once you know it, even after deleting the game you saw it in. A replay's
time is never offered as one to beat, either: sharing it shares the puzzle alone.

## Your data

Everything is stored in your browser's `localStorage` under `sudoku.*` keys — preferences, the
history (up to 1,000 games), the saved state of unfinished games (up to 50) and the puzzles you
have seen (up to 2,000, so a puzzle stays seen after its game is deleted). There are no accounts
and no tracking.

Some browsers clear a site's storage after a while away (Safari does after seven days without a
visit, unless the game has been added to the home screen). Use **Export** in History to keep a
copy, and **Import** to bring it back or move it to another browser — imported games, and the
puzzles seen, are merged with what is already there.

## Testing

- **Unit & component** (`*.test.ts[x]`, Vitest + Testing Library): the engine is tested
  exhaustively, including a soundness harness that checks every placement and elimination the
  grader makes against the known solution — and every step's pattern against its board with
  `isStepValid`, the check a walkthrough must pass before it is shown — golden puzzles pinned per
  tier, and property tests over many seeds. Components and hooks are tested through real
  interactions. The palette is read straight from the stylesheet and held to its contrast targets
  pair by pair, in both themes and under simulated colour-blindness
  (`src/styles/contrast.test.ts`). Coverage thresholds are enforced in CI, with the engine held to
  100%.
- **End-to-end** (`e2e/`, Playwright): full journeys against the built app — playing and solving,
  pausing and reloading, share links between two browsers, the history, the technique guide, a
  hint's Show me walkthrough and the phone layout from 320px wide up and on its side. An
  accessibility pass (`a11y.spec.ts`) runs axe-core's WCAG 2.2 A and AA rules over the main
  states — the board with every kind of mark, the Ready and Paused cards, the menus, every dialog
  (Show me's included) and each guide entry — in both themes, and allows no violations. Three
  projects:

  | Project    | Device         | Engine   | Specs                                                 |
  | ---------- | -------------- | -------- | ----------------------------------------------------- |
  | `chromium` | Desktop Chrome | Chromium | everything except the touch suite                     |
  | `iphone`   | iPhone 15      | WebKit   | `touch.spec.ts`, and the phone pass of `a11y.spec.ts` |
  | `android`  | Pixel 7        | Chromium | `touch.spec.ts`, and the phone pass of `a11y.spec.ts` |

## Deployment

Pushing to `main` runs [CI](.github/workflows/ci.yml) (format, lint, type-check, tests, build, e2e);
on success, [Deploy](.github/workflows/deploy.yml) publishes the site to **GitHub Pages**.

To set it up on a new repository, enable Pages once: in **Settings → Pages**, set **Source** to
**GitHub Actions**.

The Pages build sets Vite's `base` to `/<repository-name>/` automatically. If you rename the repo,
no change is needed — the base is derived from the repository name at build time.

## Controls

| Action                         | Keyboard                                                                                 | Mouse / Touch                        |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| Select a cell                  | <kbd>Tab</kbd> to the board                                                              | Click or tap it                      |
| Move the selection             | Arrow keys                                                                               | Tap another cell                     |
| Enter a number                 | <kbd>1</kbd>–<kbd>9</kbd>                                                                | Number pad                           |
| Erase                          | <kbd>Backspace</kbd> / <kbd>Delete</kbd>                                                 | Erase button                         |
| Switch Normal / Candidate      | <kbd>Space</kbd>                                                                         | Mode buttons                         |
| Switch while held              | Hold <kbd>Shift</kbd> or <kbd>Alt</kbd>                                                  | —                                    |
| Toggle one candidate           | —                                                                                        | Click its spot in the selected cell  |
| Undo                           | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>                                                | Undo button                          |
| Redo                           | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo button                          |
| Pause or resume                | <kbd>P</kbd>                                                                             | The timer                            |
| Hint, check, reveal, reset     | —                                                                                        | The "…" menu                         |
| Show me how to solve a cell    | —                                                                                        | Show me, after a hint                |
| New game                       | —                                                                                        | The + button                         |
| History, share, settings, help | —                                                                                        | The header (on a phone, the ☰ menu) |
| Solving techniques             | —                                                                                        | The header, or a hint's question     |
