# Sudoku

An NYT-style Sudoku for when the day's three puzzles are done: **a daily puzzle of each
difficulty**, the same for everyone, with a calendar and streaks, and **unlimited Easy, Medium,
Hard and Expert puzzles** besides; Normal and Candidate modes, **Auto Candidate Mode**, a pause
that really hides the board, a **history** of everything you have played — and **links to race
your friends** on the same puzzle. Built with React, TypeScript and Vite, and runs entirely in
your browser.

**[▶ Play it in your browser](https://dhensby.github.io/sudoku/)** — the latest green build of
`main`, deployed to GitHub Pages.

## Features

- **Four difficulties, never-ending** — Easy, Medium and Hard are pitched like the NYT puzzles of
  the same names; Expert goes further, into X-Wings, XY-Wings and chains of candidates,
  needed while much of the grid is still empty rather than as a last snag. Every puzzle is
  generated on the spot, has exactly one solution, and is graded by the hardest technique it
  needs, so the label never lies.
- **A daily puzzle of each difficulty** — every day has an Easy, a Medium, a Hard and an Expert of
  its own, the same for everyone, so friends can compare times; a new day's arrive at each
  player's own midnight. New game offers **Today's puzzles**, each marked with how it stands, above
  a **Random puzzle** of each tier, and a daily you have started carries on where you left off.
  The **calendar** (the calendar button in the header; on a phone, the ☰ menu) shows every day
  since Daily #1 — 7 October 2026, the day the dailies launched — with a mark for each tier — solid for solved on the day,
  hatched for solved on another day, half filled for in progress, an empty square for not
  started, Easy to Expert from left to right, so it reads without colour — and the day chosen
  with its four puzzles to play, carry on with or play again. It is a WAI-ARIA date grid: the arrow keys move a
  day or a week, Home and End to the week's ends, Page Up and Page Down a month, and each day's
  name says how its four stand. Each tier keeps a **streak**, current and best: the days in a row
  its daily was solved — and started — on its own day, by the date your device had when you
  started it (so a flight across time zones never rewrites a streak), so a daily begun at 23:50
  and finished after midnight still counts, but catching up on an earlier day never does (it
  shows in the calendar all the same). A daily on show says so in the header ("Daily · Hard") and
  is marked current in New game; a solved one says what it did for the streak; sharing one names
  it.
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
  your time too, with your help and your [mistakes](#mistakes): your friend sees "Dan solved this
  Hard puzzle in 5:23. Can you beat it?" over "Dan's solve: no mistakes · with 2 hints.", starts
  the clock when they are ready, and gets a head-to-head at the end: a table with a column for each
  of you, the two times on one row, each kind of help either of you took (auto candidates, hints,
  checks, reveals) on a row of its own — or "Neither of you took any help." — and your mistakes
  and candidate mistakes on rows of their own, so it reads straight across. The faster time wins,
  whatever the help or the mistakes; they are there so the comparison is fair. Plus a link of
  their own to send back. Nothing is uploaded; everything travels in the link.
- **History and stats** — every game you play is kept: resume unfinished ones, play a solved
  puzzle again, share it, or delete it. A game you only glanced at — nothing entered, no help
  taken — is dropped when you move on to another, so browsing the levels doesn't clutter the list
  or count as played. A game raced against a friend's link shows their time, and the help and
  mistakes it came with under it. Per-difficulty stats show games played and solved, and best and average
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
- **Mistakes, counted honestly** — the Solved dialog says how clean the solve was: "No mistakes",
  "1 mistake", or "2 mistakes · 1 candidate mistake", the wrong numbers you entered kept apart from
  the right answers you struck out of your candidates. Nothing shows while you play, so the count
  is no free Check, and mistakes never touch a time, a best or who wins a race. A slip of the finger
  is forgiven: a wrong number where the answer was obvious, or a struck candidate, put right within
  3 seconds, before changing anything else (see [Mistakes](#mistakes)). History shows a solved
  game's count beside its time, and a shared time carries it to a friend.
- **A guide to the solving techniques** — every technique the grader knows, from a full house to
  the alternating chain: its other names, what it is, why it works, how to spot it, and a worked
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
  thumb; the daily calendar, History, Share, Settings, the technique guide and Help fold into a ☰
  menu so the header stays one row; touch targets are at least 44px; and the game can be added to
  your home screen.
- **Broadsheet, a theme drawn for clarity** — the puzzle page of a morning paper: warm newsprint,
  ink-black box lines, one ultramarine spot colour, the selected cell printed as a solid block,
  givens typeset in a slab and your own numbers in a grotesque. Givens and your own numbers hold
  at least 7:1 contrast (WCAG AAA) on every cell they can sit on, and checked and revealed numbers
  and candidates at least 4.5:1; each highlight is a step of lightness as well as of hue — checked
  under simulated colour-blindness — and checked and revealed numbers carry a tick or an italic as
  well as a colour. The grid's structure is held to targets too: thin rules at least 3:1 against
  every fill but the same number's, box lines at least 4.5:1 against every fill but the selected
  block (whose ring is drawn in the box lines' own ink), and a given's screen kept apart from the
  highlights beside and around it. Candidates are set large (28% of the cell, at least 11px on all
  but the smallest boards, and 9px on a phone on its side), and heavier on a phone-sized board. A
  night edition is drawn for the dark rather than inverted — box lines in the page's ink, bright
  thin rules, and row, column and same-number fills strong enough to find at a glance — and the
  game stays playable in Windows High Contrast.
- **High contrast, for when dark is still too faint** — a fourth theme: white givens on black
  cells, your own numbers in a pale sky blue, near-white candidates, brighter thin rules, and white
  box lines a pixel heavier (never under 3px, inside a frame never under 4px). The selected cell is
  a solid yellow block with black numbers (a deeper gold when it holds a given), its row, column
  and box a slate blue; every other cell with its number gets a yellow ring just inside its edge,
  kept clear of the digit, and its number is lit in yellow among the candidates too (both with
  Highlight identical numbers on, as it is by default); buttons, focus rings and the calendar's
  chosen day take the same yellow. Every number, label and candidate holds at least 7:1 — but for
  the technique guide's struck-out candidates, bold and struck through in red, at 5.8:1 on the
  same-number fill — every mark at least 3:1, and conflicts, checked and revealed numbers keep
  their dot, slash, tick and italic. Settings › Theme offers System, Light, Dark and High contrast;
  under System it comes on by itself when the device is in dark mode and asks for more contrast
  (Increase contrast on an iPhone or a Mac, for example). A light device asking for more contrast
  keeps the light theme, which is ink on paper already.

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
  do without and checked step by step), share-link codec, clock arithmetic, the game reducer
  (which remembers each cell's hints) and the move log that replays it. No DOM, no React and no
  English; `reduce(state, action)` is a pure function, randomness is passed in, and the whole
  directory is held to 100% coverage.
- **`src/storage/`** — a thin, injectable `localStorage` layer for preferences, the history and
  saved games, which validates everything it reads back and never lets a full or broken storage
  stop play.
- **`src/daily/`** — the daily puzzles: dealing a date's four from its seeds, the archive of
  days dealt by engines since replaced (and the rules for keeping it), and the store the app
  asks for a day's puzzles, which deals them in the worker and keeps them.
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

| Script                   | What it does                                             |
| ------------------------ | -------------------------------------------------------- |
| `npm run dev`            | Start the Vite dev server                                |
| `npm run build`          | Type-check and build the production bundle to `dist/`    |
| `npm run preview`        | Serve the production build locally                       |
| `npm test`               | Run unit & component tests once                          |
| `npm run test:watch`     | Run tests in watch mode                                  |
| `npm run coverage`       | Run tests with coverage (100% enforced on `src/core`)    |
| `npm run test:e2e`       | Build, preview and run the Playwright end-to-end suite   |
| `npm run typecheck`      | `tsc --noEmit`                                           |
| `npm run lint`           | ESLint                                                   |
| `npm run lint:fix`       | ESLint with `--fix`                                      |
| `npm run format`         | Format with Prettier                                     |
| `npm run format:check`   | Check formatting without writing (this is what CI runs)  |
| `npm run dailies:freeze` | Freeze the dailies dealt so far, before an engine change |
| `npm run dailies:switch` | Hand later dailies to a new engine                       |
| `npm run moves:golden`   | Record the golden move logs again, after a rules change  |

## How puzzles are made

Each new puzzle is generated in a Web Worker, in a fraction of a second:

1. Fill a random complete grid, then remove givens in random order for as long as the puzzle
   keeps exactly one solution. That leaves a _minimal_ puzzle — every given is needed — with
   21–28 givens, like NYT's Medium and Hard. NYT puzzles are not symmetric, and neither are these.
2. Solve it the way a person would, always applying the easiest technique that makes progress,
   and grade it by the hardest technique the solve needed:

   | Tier   | Hardest technique needed                                                                         |
   | ------ | ------------------------------------------------------------------------------------------------ |
   | Easy   | Full houses and hidden singles in a box (padded to 38 givens)                                    |
   | Medium | Pointing pairs or box/line reductions                                                            |
   | Hard   | Naked or hidden pairs and triples                                                                |
   | Expert | X-Wing, Swordfish, XY-, XYZ- or W-Wing, Skyscraper, 2-String Kite, XY-Chain or alternating chain |

3. Keep it if it is the tier you asked for; otherwise try again. Expert has one more rule: its
   fish, wing or chain must be needed while at least 40 cells are still empty. Left to chance,
   most puzzles that need one only need it near the end, where it is quick to spot or to guess
   past — and they play like a Hard.

The tiers were calibrated against hundreds of published NYT puzzles: Easy needs only box hidden
singles, every Medium needs locked candidates, and Hard needs pairs and triples but never a fish
or a wing. Each tier rarely takes more than a hundred attempts — well under a second — and while
you play, the next puzzle of the same tier is already being prepared, so "New game" is instant.

## How the daily puzzles are made

Each day has a daily puzzle of each difficulty, the same for everyone: the Hard of 13 October
2026 is `generatePuzzle('hard', createRng('daily/2026-10-13/hard'))` — dealt in the browser, in
the worker like any other puzzle, from nothing but the date (never from how far it is from
Daily #1). The day turns over at each player's own midnight, and Daily #1 was 7 October 2026, the
day the dailies launched: the calendar goes back no further. (Should the generator ever fall back to another
tier, which for an Expert is about a one-in-10¹¹ chance, the seed `…/hard/2` is tried next, and so
on: a daily is always of its tier.)

Nothing in the repository or the bundle lists the puzzles to come: each day is dealt live, by
whoever opens it, so there is no answer key to read ahead in. There is no server either, so a
determined player could run the generator for a future date — but times are on the honour system
anyway. Dealing a day's four takes a few tens of milliseconds on a laptop (Expert has the long
tail: some 20 ms at the median, under a tenth of a second at worst over October 2026) and a few
hundred on a slow phone, so the game starts on today's four as soon as the page has loaded, keeps
every daily it deals — in memory, and the last 112 in `localStorage` — and lets a daily someone
is waiting for go ahead of those being made in advance. A date only has a daily once it has begun
somewhere on Earth, which lets a friend a time zone ahead send a link to "tomorrow's" puzzle; a
daily opened that way the evening before and started the next morning counts on its own day.

### The daily archive

A change to the engine — anything that bumps `GENERATOR_VERSION` — changes what every seed deals,
past dates included, and a player's past dailies must not change under them. So just before an
engine is replaced, the days it has dealt are frozen into
[`src/daily/archive.json`](src/daily/archive.json), and the new engine deals from the day after:

```json
{
  "segments": [
    { "version": 4, "from": "2026-10-07" },
    { "version": 5, "from": "2026-11-15" }
  ],
  "frozenThrough": "2026-11-14",
  "days": ["2026-10-07 v4 <easy> <medium> <hard> <expert>", "…one line a day…"]
}
```

`segments` say which engine deals which dates. `days` hold every frozen day from Daily #1 to
`frozenThrough`, one line each: the date, the engine version that dealt it, and its four puzzles'
share codes (givens only — the solver recovers each solution in a fraction of a millisecond). The
app takes a date up to `frozenThrough` from the archive and deals every later one live. Until the
first engine change it holds no days at all, and it only grows at an engine change, by about 150
bytes a day. It is a chunk of its own, read once the first game is on screen, so it costs the
first load nothing; and as its name is a hash of what it holds, a page left open across a deploy
that changed it already has it, or, failing that, asks for a reload rather than failing to deal.

A guard test, `src/daily/archive.guard.test.ts`, holds the file to two rules: the last segment's
version is `GENERATOR_VERSION`, and it starts the day after `frozenThrough` (on Daily #1 while
nothing is frozen), with every day before it frozen. So bumping `GENERATOR_VERSION` without
freezing, freezing without switching, and switching without freezing all fail CI, with a message
that says what to run.

Neither rule looks at the clock, so on a pull request the guard also holds the archive to the one
already released — main's copy, which CI fetches and names in `DAILY_ARCHIVE_BASE` (locally,
`origin/main`) — at the moment it runs: only what no player can have been dealt yet may change.
Main's days and segments must all still be there; a segment added must start on a day that has
not begun anywhere on Earth, so a switch that waited too long to merge fails; and the live segment
may be re-pointed to a new engine only while its first day is still ahead everywhere, so a version
changed by hand instead of freezing fails too. On main itself there is nothing to compare with:
once merged, the released archive is this one. CI checks at the moment it runs, so run it again
on a pull request that has waited a day or more.

**Daily #1** (`DAILY_EPOCH`, and the archive's `"epoch"` and first segment) may move later, but
only while main's archive has nothing frozen, and only to a day that has begun somewhere. A date's
puzzle comes from its own seed, so a later Daily #1 changes no remaining day's puzzle — it only
takes days off the front of the calendar — and with nothing frozen, no frozen day is lost. A
Daily #1 still to come would take today's dailies from everyone, and since re-pointing an engine
needs its first day to be ahead everywhere, the rule also keeps a move from standing in for a
freeze: change the engine on its own. The guard then compares as though main's archive had begun
on the new Daily #1, its one segment starting there, and every rule above still applies. Moving
Daily #1 earlier, or later once anything is frozen, fails, saying why; a branch cut before
main moved Daily #1 later looks as though it moves it earlier, and rebasing onto main puts that
right. That is how Daily #1 moved from 1 to 7 October 2026 on launch day, so that the calendar
starts on the day the dailies launched. A record of a daily from a day before Daily #1 — one
opened in the few hours the earlier days were on offer — stays in the history as an ordinary
game, with its time, but not in the calendar or a streak.

**Before dailies are first released** — while `src/daily/archive.json` is not on main — no player
has been dealt a daily, whatever the date, and there is nothing to freeze. An engine change then
needs only `npm run dailies:switch`, which re-points the archive's one segment to the new
`GENERATOR_VERSION` (`dailies:freeze` says so and stores nothing). That is how the dailies kept
up with engine changes while they were still on a branch of their own; every engine change since
they reached main freezes and switches, as below.

### Changing the engine

Freeze the old engine's days and switch to the new one as the last step before merging, in the
same commit as the engine change, so that every commit passes the guard. On your branch, rebased
onto an up-to-date `main`, with the engine change (and the `GENERATOR_VERSION` bump) committed:

```bash
git restore --source=origin/main -- src/core src/daily/archive.json  # main's engine and archive, for now
npm run dailies:freeze                                               # freeze the days it has dealt
git restore -- src/core                                              # your engine back
npm run dailies:switch                                               # hand it every later day
git commit --fixup=<the engine change> -- src/daily/archive.json
```

- **`dailies:freeze`** stores every day from the first unfrozen one through the day after
  tomorrow, by your clock (or an earlier date: `-- --through YYYY-MM-DD`), as the engine in
  `src/core` deals them. The two days ahead are for players in time zones ahead of yours and tabs
  left open overnight; they briefly put a couple of upcoming days' puzzles in the repository and
  the bundle — the only time any are there. It refuses to reach further ahead, refuses to run on
  an engine that is not the archive's live one, never rewrites a frozen day, and writes the file
  after every day, so a run stopped part-way carries on where it left off. It runs the engine
  through Vite's server-side loading, which is some ten times slower than the bundled app: a few
  tenths of a second a day.
- **`dailies:switch`** starts the bumped `GENERATOR_VERSION` the day after the last frozen one.
  It refuses until the version has been bumped and some of the old engine's days are frozen, and
  if the first day it would hand over has already begun anywhere. An engine switched in so
  recently that it has not dealt a day yet — or any engine, before dailies are released — is
  simply replaced.
- **Merge before the frozen days run out** — the next day or so; the guard fails the PR once the
  first day handed over has begun anywhere. If the PR waits longer, rebase and run the five lines
  again: the days the old engine went on dealing meanwhile must be frozen too.

## The move log

The engine keeps a game as a log of its moves, `src/core/moves.ts` — a record to replay the game
from, step by step, with nothing but the puzzle. Every game records one as it is played: each
change the game makes goes through one step, `advance` in `src/ui/session.ts`, which runs the
reducer and logs the move at the time on the play clock, and a guard test fails if the main hook
ever calls the reducer itself. A game is recorded from its first move or not at all — never from
part-way, which would read as a whole game — so one begun before logs were kept, one whose saved
board no longer replays from its saved log (a tab still on an older version played on without
logging), or one past 5,000 moves keeps no log. The log is saved just before the board, so it is
never behind it: if the board's write is refused, or lost to a crash, the log reopens trimmed back
to the moves that reach the board saved, which is the whole log of the game as saved. A log
written by a newer version, which this one cannot read, is left alone for that version to judge.
What the logs show so far is a game's [mistakes](#mistakes); where they are kept is under
[Your data](#your-data).

- **What is logged:** every move that changed the game, with its time on the play clock (which
  stops while paused), rounded down to a tenth of a second so that a logged time is never later
  than the clock: placing and pencilling a digit, erasing, hints (with their technique and unit),
  Show me, Check, Reveal, auto candidates on and off, Undo, Redo and Reset. Show me opened again
  for a cell already counted is logged too, though it changes nothing, because it is still help
  seen. A move that acts on the selected cell carries the cell. Selecting, moving the selection,
  the input mode, pauses and a hint with nothing to say are not logged.
- **Replaying:** the moves go back through the same reducer, which is pure, so the replay rebuilds
  the game exactly — the board, the help taken, the hints remembered, and the Undo and Redo
  history too. `verifyMoveLog` checks a replay against a saved game.
- **The format:** base64url only, so it can go in a link. A 3-character header (the format
  version, the rules version and flags: whether the game began in auto candidate mode, whether the
  log was cut off at 5,000 moves), then each move as a 2-character code (`op × 81 + cell`, the
  moves without a cell above those; a hint adds 2 more, from a fixed table of techniques and
  units) and the time since the previous move as a varint, then a 3-character check, so that a log
  cut short or mistyped is refused rather than read as another game. That comes to 3–4 characters
  a move: about 160–250 for a solve that only places digits, 190–370 with auto candidates, and
  500–1,100 for one that pencils in every candidate. Decoding is strict: anything malformed, or
  from a format or rules version the build does not know, is refused whole. `readMoveLogHeader`
  tells those apart — a log from an older version, one that needs a newer build, or a broken one.
- **The rules version:** a log is only replayed under the rules it was recorded by. A new kind of
  move, hint or flag takes a code unused today, which older builds already refuse, so it needs no
  new version. A change to what the reducer does with a move an existing log can hold does: it
  must bump `MOVES_VERSION`, and logs recorded under the old rules then read as not recorded. The
  golden logs in [`src/core/fixtures/moveLogs.json`](src/core/fixtures/moveLogs.json) — real games
  and a scripted tour of the rules, each with the game it must end in and a hash of every step —
  fail CI when the reducer replays one differently while the version stays put, with a message
  that says what to do. Between them they must pass through every situation on a named checklist
  of the reducer's rules (`GOLDEN_SITUATIONS` in `src/test/goldenMoveLogs.ts`), so a rule added to
  the reducer needs a situation there and a step in the tour, or it is not guarded. Bump the
  version, then run `npm run moves:golden` to record them again; it refuses to rewrite logs that
  no longer replay as pinned under an unchanged version.

## Mistakes

A game's mistakes are worked out from its [move log](#the-move-log) by `src/core/mistakes.ts`,
judged against the puzzle's solution, so the count is the same live, saved and reopened. Two
kinds, counted apart:

- **A mistake** is a wrong digit coming to stand in a cell: placed, typed over another, or
  brought back by Undo or Redo. Each cell and digit counts once a game.
- **A candidate mistake** is striking a cell's answer out of its candidates: switching off your
  own note of it, or striking it in Auto Candidate Mode — by a candidate-mode entry or a Redo of
  one. Each cell counts once a game. A wrong note left in, never pencilling the answer at all, the
  second Erase wiping the notes, "clear it from the peers' notes", auto candidates hidden by a
  wrong number nearby, and Undo of a note added are not candidate mistakes.

Each one — the same wrong digit or strike made again included — opens a **window** of its own, which
settles at the first of: 3 seconds of play time (the log's time, so a pause neither uses it up nor
stretches it); a change to another cell (what one move does beside its own cell, such as clearing
peers' notes, is not; Undo or Redo acts on the cell of the change it takes back; switching auto
candidates changes every cell); any help — Check, Hint, Show me (opened again for free included) or
Reveal; Reset; and the board becoming full (the move that fills its last empty cell), since "The
board is full, but something isn't right" is news a slip must not wait for. A board full already
tells nothing new, so a slip made on it, while you hunt for what is wrong, has its window like any
other. As it settles it **counts unless forgiven**. A wrong number is forgiven only if its cell's
answer was **obvious** as it went in — the cell held its answer already (a solved cell overwritten
by tapping the wrong square), or the answer was a single on the placed numbers (the only digit left
for the cell, or the only place left for it in its row, column or box; never judged from notes) —
**and** the cell held its answer again before the window settled. So a wrong number in a cell whose
answer was not obvious counts however fast it is put right, and so does a clash undone to an empty
cell before another is solved. A candidate mistake needs no obvious answer: it is forgiven if the
answer is back (pencilled in again, the strike taken back, or placed) in time. Put right is for
good: the same wrong digit typed in again afterwards is judged afresh in a window of its own, while
one brought back before it was put right shares the earlier window, and is forgiven only if the
answer was obvious both times it went in. Reset never forgives; the solve settles everything still
open, as put right. A later version's "Check guesses when entered" will count every mistake at once,
with nothing forgiven: the analysis takes it as an option already.

Counts only go up. Each save writes the count so far onto the game's record as `mistakes:
{ values, candidates, atMs }`, never lower than it was, and the solve freezes it: a game reopened
solved keeps the count it was solved with. `atMs` is the record's time it was counted at. A tab
still open on a version from before mistakes keeps the field as it found it while it plays on, so
a solved record whose `atMs` is not its own `elapsedMs` reads as not recorded — never as a final
count that missed what came after. Only solved games show a count (an unfinished game's would
work as a free Check), and a game not recorded move by move from its start (see
[The move log](#the-move-log)) shows none at all — never "No mistakes". A game solved by a version
that kept logs but did not count mistakes is counted from its log once, as a visit starts, if the
log holds the whole game.

**Shared.** A solved game's link carries its count — only a count as the record keeps it, stamped
at the solve — inside the assists parameter (see [Racing friends](#racing-friends)), and its
message says it on the line under the time, before the help: "No mistakes · with 2 hints", "1
mistake · 1 candidate mistake", "No mistakes". The friend's Ready card says it the same way, under
a "Dan's solve:" that keeps it from reading as a rule of the race or as their own count, the
head-to-head sets it beside their own on a row for each kind, and their History keeps it with your
time. A count that is not known — a game not recorded move by move, or a link from a version before
mistakes were shared — is never sent or read as 0: the link and message say nothing of it, and the
head-to-head shows a dash, which a screen reader reads as "not recorded". The "Mistakes" row shows
whenever either count is known, a clean 0 included; "Candidate mistakes" only once either of you made
one.

## Racing friends

A share link carries the puzzle itself, so it opens the same puzzle for anyone, on any version of
the game — there is no server and nothing is uploaded.

| Parameter      | Meaning                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `?p=<code>`    | The puzzle: its givens packed into ~26–34 URL-safe characters.                                              |
| `&t=<secs>`    | The sharer's time in whole seconds — the time to beat.                                                      |
| `&n=<name>`    | The sharer's name (optional; past 24 characters it is cut short with an ellipsis).                          |
| `&a=<assists>` | Help: `c` auto candidates, `h<N>` hints, `k<N>` checks, `r<N>` reveals; mistakes: `m<N>`, candidate `x<N>`. |
| `&d=<date>`    | A daily's date (`2026-10-13`): the opener checks it against that day's daily of the tier.                   |

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

The mistakes ride in `a=` rather than a parameter of their own, after the help: `m<N>` is always
there once the count is known — an unaided, mistake-free solve sends `a=m0` — so a link that says
nothing is told apart from one that says none, and `x<N>` is added when there were candidate
mistakes (`a=ch2m1x2`: auto candidates, 2 hints, 1 mistake, 2 candidate mistakes). Every version
before reads `a=` by picking out `c`, `h`, `k` and `r` and skipping anything else, so a new link
opens there with the same help, its mistakes unsaid; a test holds the old decoder to that. Read
here, a link without `m` — every older link — leaves the mistakes not recorded, never 0, and so
does one whose counts no game could make (more than 8 wrong numbers a cell, or a strike a cell),
while the time and help still stand.

A daily's link names it — "Sudoku Daily · 13 Oct 2026 · Hard · 5:23" — and carries its date as
well as its givens. The link opens as any shared puzzle while the game checks the date against
that day's daily (dealt live, or taken from the archive); if the puzzle is that daily, the
friend's game is recorded as it, shows in their calendar, and counts towards their streak if they
start it on that date. A date that does not match, or has no daily yet, is simply ignored.

Times are on the honour system: the link says what time you claim, and nothing can verify it. It
is a game between friends. What the game does do is keep its own records honest — a reset clears
the board but not the clock, a game with revealed cells never sets a best time, and neither does
playing a puzzle again once you know it, even after deleting the game you saw it in. A replay's
time is never offered as one to beat, either: sharing it shares the puzzle alone.

## Your data

Everything is stored in your browser's `localStorage` under `sudoku.*` keys — preferences, the
history (up to 1,000 games, a daily's with the date it is the daily of and the date you started
it — the calendar and the streaks are worked out from it — and each game's
[mistakes](#mistakes), stamped with the time they were counted at), what the dailies of games pruned from
the history said (a few bytes a day, kept for good, so neither a best streak nor the calendar
forgets them), the saved state of unfinished games (up to 50), every game's move log, the
puzzles you have seen (up to 2,000, so a puzzle stays seen after its game is deleted) and the
daily puzzles already dealt (the last 112, so they need not be dealt again). There are no accounts
and no tracking.

Every game in the history, finished or not, keeps its **move log** (see
[The move log](#the-move-log)) under a key of its own, `sudoku.moves.<id>`, listed in
`sudoku.moveLogs` — never inside the history, which is rewritten whole as you play, nor the saved
board, which a finished game loses once it is off screen while its log stays. A log is written with
its game, only when it has changed, and goes when its game does: deleted from History, pruned past
1,000, dropped as a glimpse, or replaced by an import. Once a visit, a sweep deletes what a tab
still on an older version, which knows nothing of logs, can leave behind: a log whose game is no
longer in the history, and a finished game's log whose last move is not the solve (that tab played
the game to the end without logging, and dropped the board that would have shown the log to be
short) — as well as a log that no longer reads back at all. A log is some 3–4
characters a move: about 200 for a solve that only places digits, 300 with auto candidates and up
to 1,100 for one that pencils in every candidate. With a full history of 1,000 games, 50 of them
unfinished, everything the game stores comes to about 0.9 million characters, 0.4 million of it
logs, for a mix of those three kinds of solve — 0.75 million if every game only placed digits, and
1.5 million if every game pencilled in every candidate. That is under a third of the ~5 MB (some
5.2 million characters) the browser allows the whole of `dhensby.github.io`, which every project
hosted there shares.

When that space runs out, the game makes room, cheapest loss first, trying the write again after
each step: the logs of games no longer in the history, then the oldest finished games' logs, about
50,000 characters at a time (an eighth or so of a full history's), until the write fits — so no
more than one such chunk beyond what the write needed is ever lost; and only once every finished
game's log is gone, the saved boards of all but the 10 most recently played unfinished games, and
finished games beyond the newest 300, with their logs. The game on screen, and the logs of
unfinished games, are never shed. Finished games' logs go first because nothing needs them to
carry on playing. In a test with a full history and the storage filled to the brim, one chunk
(130 logs) makes room for the whole of a pencil-every-candidate game played after it; with the
quota cut by another 300,000 characters, 754 of the 950 finished games' logs go and every record
and board stays. If a log cannot be written even then, its game's old log is deleted rather than
left stopping short of the board saved beside it.

A tab left open on an older version after an update carries on saving, so the game keeps what it
does not recognise rather than wiping it: small fields a newer version added to a game's record,
its saved board or the preferences (up to 8 per object, each at most 200 characters of JSON) are
written back untouched, and a theme it does not know is applied as System, with none shown as
chosen in Settings, but kept until you pick one.

Some browsers clear a site's storage after a while away (Safari does after seven days without a
visit, unless the game has been added to the home screen). Use **Export** in History to keep a
copy, and **Import** to bring it back or move it to another browser — imported games, the
puzzles seen and the dailies' record are merged with what is already there. The file carries every
game's move log too; an import takes the log of each game it adds or replaces, leaving out (on its
own) any log that does not read back exactly, and never makes room for one by deleting anything:
logs go only into space that was free, and if the imported games themselves only fitted once some
of the logs here were shed, none of the file's logs are taken.

## Testing

- **Unit & component** (`*.test.ts[x]`, Vitest + Testing Library): the engine is tested
  exhaustively, including a soundness harness that checks every placement and elimination the
  grader makes against the known solution — and every step's pattern against its board with
  `isStepValid`, the check a walkthrough must pass before it is shown — golden puzzles pinned per
  tier, and property tests over many seeds. Components and hooks are tested through real
  interactions. The palette is read straight from the stylesheet and held to its contrast targets
  pair by pair, in all three palettes (High contrast's text at 7:1, but for the guide's struck-out
  candidate on the same-number fill, held at 4.5:1) and under simulated colour-blindness
  (`src/styles/contrast.test.ts`). The daily archive is held to the engine in the code, and on a
  pull request to the archive main has released, by a guard of its own
  (`src/daily/archive.guard.test.ts`, see [The daily archive](#the-daily-archive)), and date
  arithmetic and streaks are tested across the clocks changing in London and New York, and across
  a change of time zone between starting a daily and looking at its streak. The move log is
  replayed after every move of random games — every action there is, with reloads in between —
  and must rebuild the live game each time; its golden logs hold the reducer to its rules (see
  [The move log](#the-move-log)). The game's own logs are checked move by move through the main
  hook on a play clock of the test's own, and a full history of them is held under a third of the
  storage quota, shedding in the order [Your data](#your-data) gives. Mistakes are held to every
  rule by a table of scenarios at exact play times (`src/core/mistakes.test.ts`) — a slip put
  right at 2.9 s and at 3.1 s, every way a window closes, Undo and Redo, candidates in both
  layers, Check guesses on — and by random games, whose counts must never fall and must stay at
  nothing for a game that never lets a wrong number stand. Share links are held to the versions
  before them: a copy of the assists decoder every earlier version shipped must read a new link's
  help unchanged, skipping its mistakes, and an old link must read as mistakes not recorded, never 0.
  Coverage thresholds are enforced in CI, with the engine held to 100%.
- **End-to-end** (`e2e/`, Playwright): full journeys against the built app — playing and solving,
  pausing and reloading, share links between two browsers (a solve with a mistake shared, opened in
  the other and compared row by row), the history, the technique guide, a
  hint's Show me walkthrough, the daily puzzles on a fixed clock (today's Hard from New game to
  the end and its streak, yesterday's from the calendar kept but not counted, a friend's daily
  link recognised), mistakes (an obvious slip put right at once, and a wrong number where the
  answer was not obvious) and the phone layout from 320px wide up and on its side (the calendar's
  days measured at 44px at 320px, the head-to-head's every row, hour-long times on one line and a
  long right-to-left name kept inside its card, New game and the calendar whole on a phone on its
  side). An accessibility pass
  (`a11y.spec.ts`) runs axe-core's WCAG 2.2 A and AA rules over the main states — the board with
  every kind of mark, the Ready and Paused cards, the menus, every dialog (Show me's and the daily
  calendar's included) and each guide entry — in both themes, and the board, the dialogs, the
  menus and the calendar in High contrast, both chosen in Settings on a dark device and from a dark
  system asking for more contrast, measuring its heavier lines and its same-number ring kept off
  the digits — and allows no violations. Three projects:

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
| New game, or today's puzzles   | —                                                                                        | The + button                         |
| Daily calendar and streaks     | Arrow keys, Home/End, Page Up/Page Down in the month                                     | The calendar in the header, or +     |
| History, share, settings, help | —                                                                                        | The header (on a phone, the ☰ menu) |
| Solving techniques             | —                                                                                        | The header, or a hint's question     |
