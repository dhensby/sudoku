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
  hatched for solved on another day or after watching a solve (neither counts for a streak), half filled for in progress, an empty square for not
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
  of you, the two times on one row, each kind of help either of you took (auto candidates, guesses
  checked as entered, hints, checks, reveals) on a row of its own — or "Neither of you took any
  help." — and your mistakes and candidate mistakes on rows of their own, so it reads straight
  across. The faster time wins, whatever the help or the mistakes; they are there so the
  comparison is fair. Plus a link of their own to send back. Nothing is uploaded; everything
  travels in the link — your solve too, if you choose: switch on **Include my solve** and your
  friend can watch how you did it, once they've had a go (see [Sharing a solve](#sharing-a-solve)).
  The link also carries a random ID for your browser, so your friend's game can tell your times
  apart from anyone else's, whatever name they come with. [Friends](#friends), at the foot of
  History, lists everyone who has sent you a time: the name you give someone replaces whatever
  their links call them, on every race of theirs. The first link from someone new asks who sent
  it. Merge someone's phone and laptop into one friend, or split them apart again.
- **History and stats** — every game you play is kept: resume unfinished ones, play a solved
  puzzle again, [watch your solve](#watch-your-solve) of it, share it, or delete it. A game you only glanced at — nothing entered, no help
  taken — is dropped when you move on to another, so browsing the levels doesn't clutter the list
  or count as played. A game raced against a friend's link shows their time — under the name you gave them,
  if you have — and the help and mistakes it came with under it. Per-difficulty stats show games played and solved, and best and average
  times. Export your history to a file and import it on another browser.
- **Help when you want it** — Hint points at a cell you can fill next and names the technique
  ("Hidden single: there's only one place for a number in this box"), without ever giving the
  number away. Where the cell takes several steps, it names **the next step** and how far there is
  to go — "Step 1 of 7: a box/line reduction in column 8." — and tints where that step is on the
  board: its rows, columns and boxes (a fish's lines, a Skyscraper's or a kite's links), or a wing's
  or a chain's own cells, in place of the selected cell's row, column and box. The words say where
  too — "an X-Wing in rows 2 and 7" — and a single on the way, which fills another cell first, says
  so: "a naked single in box 6", "a hidden single elsewhere in this box". The tint stays while you
  select cells inside it to make the step. Make the step and ask again, and it moves on: "Step 2 of
  7 …", page by page, to the single that fills the cell, said as a single always is and untinted: the
  selected cell's own row, column and box are where to read it. The numbering
  counts against the route as first shown for the cell, so what is still to do ("of 7" less those
  behind) is always the route's own length: a step made a shorter way skips ahead, and a route
  grown longer than the first plan (a step undone) starts again from "Step 1". The "What's a …?"
  question asks about the next step's technique. Where the bar is wide enough to keep to two lines
  with it, it also says the hardest step still ahead — "The hardest is an XY-Chain." — which is
  always read out with the hint and in the cell's description, and Show me names every step. The
  hint stays with its cell while you fill in others, as long as the cell is no further off than
  it was, so it doesn't hop about and lose your place. It reasons from **your own
  candidates** — in Auto Candidate Mode the automatic ones less those you struck out, otherwise
  your notes, taken as whole lists (less any a placed number rules out), a cell you haven't marked
  counting as having every candidate — so a step you have taken is never the one it points you to
  again: strike what a box/line reduction removes, ask again, and it moves on to the next step.
  Crossed out a candidate, or left one out of your notes, that nothing rules out yet? Hint points at that cell first — "This cell is missing a candidate that
  can't be ruled out yet." — without saying which; its Show me names the number, shows that
  nothing on the board rules it out (none in its row, column or box, and no pattern among the
  candidates), and offers to **put it back** (or pencil it in), as an ordinary move that Undo takes
  back. Each counts as one hint; asking again is free until you change that cell's candidates, and
  then counts again — as a hint about a wrong number does for each number tried — so putting back
  the right number looks just like putting back any other. **Each step a hint names counts as one
  hint**, the first time: asking again before you make it is free, and so is any step you have
  seen already — named by a hint, or on a page of Show me — however the route around it is planned
  afresh, and on whichever cell's route it comes round again, since a step is known by what it is
  (its technique, houses and digit, and what makes its pattern that step: a subset's cells and
  digits, a wing's or a chain's candidates), not by where it falls on the route — so striking a
  candidate a step doesn't need leaves it the same step. A cell **remembers its hint**: select it
  again and the hint is back under the board (and in the cell's description for a screen reader) —
  brought up to date for the numbers placed since, so a cell that needed a hidden pair and now
  needs only a single says so, numbered on from where it was — and asking again for the same step
  isn't counted again. It is only ever brought up to a step you have seen: if the numbers placed
  since have moved the cell on to one you haven't, it says "The board has moved on. Ask again for
  this cell's next step." and Hint names it, counted as any new step is.
  What it says unasked, and whether it offers Show me, never turns on candidates you have changed
  since Hint last pointed you to a cell to fill, which nothing has checked: that would tell the
  right number from the wrong ones. Asking again brings them in. Still stuck? **Show me**, beside the hint, walks
  through the steps that solve that one cell, **a page each**, numbered as the hint numbers them
  ("Step 2 of 7", "Step 3 of 7" …) — only the steps it depends on, however far across
  the board the solve wandered, and none it could do without — each drawn on your own board with
  the cell marked, a caption that says which earlier step removed what, and the answer at the end.
  Its first step's board is yours, so it skips what you have done already, and a caption credits
  you with what you had ruled out ("You'd already ruled out its 5."), crossed out level on the
  board where an earlier step's removal has a dashed slash. **Each page counts as one hint the
  first time it is seen** — opening it shows the first, and each Next to a page not yet seen shows
  another — and says so on the page ("4 hints used."); going back to a page seen, or opening Show
  me again on one, is free, as is a hint naming a step already seen on a page (a page shows the
  step whole; a hint naming a step does not stop its page counting). Next names a page not yet
  seen by its number ("Step 4 of 7"), not its technique, which would give it away for free. A cell
  whose Show me was counted by an older version, once for every page, keeps its pages free. Whether it is on offer never
  gives away a wrong digit or a missing candidate elsewhere: pressed with one on the board, it points at that instead, as Hint would. On a phone on
  its side, each step's board is sized to the screen with its caption beside it. Check cell, Check
  puzzle and Reveal cell are in the "…" menu, and **Check guesses when entered**, in Settings,
  marks a wrong number the moment it goes in, as NYT's does. Any help you take (auto candidates
  and checked guesses included) is recorded next to your time, so comparisons stay fair — and
  shown as you play: see [Help taken](#help-taken).
- **Mistakes, counted honestly** — the Solved dialog says how clean the solve was: "No mistakes",
  "1 mistake", or "2 mistakes · 1 candidate mistake", the wrong numbers you entered kept apart from
  the right answers you struck out of your candidates. Mistakes never touch a time, a best or who
  wins a race. A slip of the finger is forgiven: a wrong number where the answer was obvious, or a
  struck candidate, put right within 3 seconds, before changing anything else (see
  [Mistakes](#mistakes)). History shows a solved game's count beside its time, and a shared time
  carries it to a friend. Nothing shows while you play unless you turn on **Show error counter** —
  "Mistakes 2 · 1 candidate", beside the timer (above the controls on a phone) — which shows each
  mistake only once it counts, so it is no free Check, and is not help. With **Check guesses when
  entered** on as well, a mistake counts, and shows, the moment it goes in.
- **Watch your solve** — the Solved dialog, and a solved game's row in History, play the solve
  back move by move on a board of its own: every number, note, hint, check and undo, the cell it
  went in outlined and a caption saying what it was ("5 in row 3, column 4 — a mistake"), with
  play and pause, a step either way, a scrubber marked with your mistakes, the slips you put right
  in time and the help you took, and speeds up to 8×. Watching changes nothing (see
  [Watch your solve](#watch-your-solve)). A friend's solve, from their link, plays the same way.
- **Compare solves** — once you have solved a puzzle a friend shared with their solve, set the two
  side by side: a chart of the cells each of you had solved over the time you played, your line
  solid and theirs dashed, your mistakes and help marked on each, and under it one board showing,
  at the moment you pick on the chart, who had filled each cell and with what. Comparing changes
  nothing either (see [Comparing solves](#comparing-solves)).
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
  menu so the header stays one row (help taken, once you take any, and the error counter, when it
  is on, share a line of their own above the controls, and the board gives up that line's height;
  on a phone on its side they sit beside the timer, one over the other, and a large phone's row of
  seven buttons folds into the ☰ menu to make room for them);
  touch targets are at least 44px; and the game can be added to your home screen.
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
  logical grader (with a worked example of every technique it knows), the puzzle generator, hints
  and walkthroughs from the player's own candidates (Show me: the steps one cell depends on, sliced
  from a solve, pruned of any it can do without and checked step by step; a hint, the next of
  them), share-link codec, clock arithmetic, the game reducer (which remembers each cell's hints,
  and the steps seen), the move log that replays it, playback (a solve shown again move by move,
  from its log) and the comparison of two solves (their progress over play time, and the board
  they overlay). No DOM, no React and no
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
What the logs show is a game's [mistakes](#mistakes), and the solve itself, played back (see
[Watch your solve](#watch-your-solve)); where they are kept is under [Your data](#your-data).

- **What is logged:** every move that changed the game, with its time on the play clock (which
  stops while paused), rounded down to a tenth of a second so that a logged time is never later
  than the clock: placing and pencilling a digit, erasing, hints (with their technique and unit,
  and for a step, where it falls on its route and which step it is), Show me and each page of it
  seen for the first time (with which step's page it was), Check, Reveal, auto candidates on and
  off, "Check guesses when entered" on and off (at the start of a game begun with it on, and
  wherever it changed — a setting, but one that decides how what follows is marked and counted),
  Undo, Redo and Reset. Show me opened again for a cell already counted, or at a page already
  seen, is logged too, though it changes nothing, because it is still help seen; a page turned
  back to while it is open is not, as opening it was help seen already. A move that acts on the
  selected cell carries the cell. Selecting, moving the selection,
  the input mode, pauses and a hint with nothing to say are not logged.
- **Replaying:** the moves go back through the same reducer, which is pure, so the replay rebuilds
  the game exactly — the board, the help taken, the hints remembered, and the Undo and Redo
  history too. `verifyMoveLog` checks a replay against a saved game.
- **The format:** base64url only, so it can go in a link. A 3-character header (the format
  version, the rules version and flags: whether the game began in auto candidate mode, whether the
  log was cut off at 5,000 moves), then each move as a 2-character code (`op × 81 + cell`, the
  moves without a cell above those — Check guesses on and off among them, in the two codes kept
  for them when the format was made, so they came with no new rules version; a hint adds 2 more,
  from a fixed table of techniques and units, where a wrong-marks hint took a code then unused,
  again with no new rules version; a step hint takes descriptors then unused too, 256 +
  technique × 28 + unit, and adds its hardest technique, where it falls and the route's length
  (varints) and the step's 24-bit id, 4 characters; a page of Show me takes a code a cell after
  Check guesses', 2761 + cell, and adds the id of its step — so an older build, which counted Show
  me once a cell, refuses a log holding either rather than replaying it its own way) and the time
  since the previous move as a varint, then a 3-character check, so that a log
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
candidates changes every cell); any help — Check, Hint (a step hint included), Show me and each new
page of it (opened again for free included) or Reveal; Reset; and the board becoming full (the move that fills its last empty cell), since "The
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
open, as put right.

With **Check guesses when entered** on, nothing waits: a wrong number typed, or a candidate
struck, while it is on counts the moment it is made, with nothing forgiven, and the wrong number is
struck through with the slash a Check gives (`markWrongGuesses` in `src/core/game.ts`; a right
number gets no mark). The log says when it was on, so each move is judged by the setting as it
stood. It judges only what is typed: turning it on judges nothing already on the board, and nor
does Undo or Redo, which bring a number back with the mark it had — either would be a free Check —
so a slip made just before it came on keeps its window, even brought back by Undo or Redo. Typed
again while it is on, though, that slip is marked, and counts at once. It is help,
recorded next to the time (`assists.checkGuesses`, sticky like auto candidates: turning it off
again stops the marking, not the record), and spoken as "guesses checked as entered" — "Checked as
entered" on a History chip and in the head-to-head. The setting follows the player from game to
game: changed in Settings, it takes effect as Settings closes; a game reopened, or one waiting
behind Start or a dialog, takes it up as its clock starts — so one switched off before Start is
played, and recorded, without it. A saved game marks such a number `w`, as a Check would, only once its assists
carry `checkGuesses: true` — so a tab still on a version from before the setting, which keeps that
field without knowing it, never takes those marks for Checks.

**Show error counter** shows the count so far as the game is played: "Mistakes 2", and "· 1
candidate" once there is a candidate mistake. It shows what has settled by the time on the clock
(`mistakesSoFar` in `src/ui/session.ts`, read on the timer's once-a-second render and at every
move), so with Check guesses off it never moves while a slip can still be put right — it would be
a free Check — and with Check guesses on it moves with the move. It is hidden with the board while
the game is paused, says "Mistakes —" for a game not recorded move by move, and tells a screen
reader "1 mistake counted." as each one settles. It is only a display: not help, and not recorded.

Counts only go up. Each save writes the count so far onto the game's record as `mistakes:
{ values, candidates, atMs }`, never lower than it was, and the solve freezes it: a game reopened
solved keeps the count it was solved with. `atMs` is the record's time it was counted at. A tab
still open on a version from before mistakes keeps the field as it found it while it plays on, so
a solved record whose `atMs` is not its own `elapsedMs` reads as not recorded — never as a final
count that missed what came after. Only solved games show a count (an unfinished game's would
work as a free Check — the error counter shows the settled count, see above), and a game not
recorded move by move from its start (see
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

## Help taken

**Show help taken**, in Settings beside Show timer and on unless turned off, shows the help the
game has taken so far as it is played, once there is any, in History's words — "Auto candidates ·
Checked as entered · 2 hints · 1 check · 1 reveal" — so a player sees each Hint, Show me, Check and
Reveal counted as it happens, and sees that asking again for a hint already given was free. The
"…" menu's Hint says how many have been used, "Hint (2 used)", in its name as well as on show. It
is only a display: help is recorded next to the time (`assists`) whether it shows or not, and
turning it off hides the count, the count on Hint and the count said with a move.

- **Where.** Beside the timer on a desktop and on a phone on its side, over the error counter
  when that is on; on a phone held upright, on the line above the controls, at its start, with
  the error counter at its end. The two are one strip (`.tally` in `layout.css`), designed
  together: in the header, help taken is held to the error counter's widest line (measured at
  173.5px on a phone on its side and 186.8px on a desktop), so the header's breakpoints, which make
  room for the counter, hold for both — a daily's wordmark giving way 3.3em sooner for its
  "Daily ·", as without them; on a phone's line, help taken gives way and the counter never does.
  The header makes room, and a phone gives the line, only once there is something to show: a game
  played without help keeps its wordmark and its whole board, and on a phone held upright the
  board gives up the line's height as the first help is taken (with a hint, as the hint bar fills).
  Every phone held upright, the shortest included, has the line: at 320×568 a hint's bar still
  keeps to its two lines beside it.
- **Shortened where it must be, never cut.** The full words where they fit — measured, not
  guessed: the box is as wide as the full words, up to the room it has (`HelpTaken.tsx`) — then
  the counts alone, "2 hints · 1 check": what the "…" menu charges and what a player watches,
  while the two switches show for themselves (the Auto Candidate switch, a checked guess's slash);
  and where even those do not fit, their total, "Help 3", set as the counter's "Mistakes 2" is
  and short enough to stay whole beside the widest counter on the narrowest phone. A count is
  never cut short; only "Help taken", the total's wording for a game whose only help is a switch,
  could ever end in an ellipsis. Hovering shows the full words, and a screen reader is always given
  the full list ("Help taken: auto candidates, 2 hints").
- **It ticks.** When help is charged the words are underlined in the accent colour, which holds a
  moment and fades back; asked for less motion, the colour is held still instead. Nothing grows
  or moves, so nothing is drawn over the tier or the counter beside it. Not as a game opens with
  the help it had — nor as a game behind Start, or made behind a dialog, takes up "Check guesses
  when entered" as it first starts — nor for another game's help, nor when the setting is switched
  on, and not for a hint asked for again, which is free. A charge made as a dialog opens (Show
  me's) ticks as the dialog closes, where it can be seen. A screen reader hears the new count once,
  with the move that charged it — "… Row 3, column 5. 2 hints used.", "1 check used.", "1 reveal
  used.", "Auto candidates on. Counts as help." the first time, and "Checked as entered. Counts as
  help." as Settings closes, or with "Resumed.", on a game already on show.
- **Show me says what it cost.** Its walkthrough shows the charge after its introduction — "2
  hints used." — so a sighted player sees it as it is made, and a screen reader hears it with the
  dialog's description (the status region is hidden behind a dialog). Each page turned to for the
  first time says what it cost under its heading — "3 hints used." — which describes the heading,
  so a screen reader hears it as focus moves there; once, as the page is turned to. Opened again,
  or turned back to a page already seen, it is free, and says nothing of cost.
- **While paused.** It stays on show, unlike the error counter: what help was taken says nothing
  about the board — not which cells, nor whether a number is right — and, like the timer's
  digits, it is a record of the game rather than of its cells.

## Watch your solve

A solved game can be watched again, move by move: **Watch your solve** in the Solved dialog, and
**Watch** on a solved game's row in History, open a player (`PlaybackDialog`) over the game,
which stays paused behind it, as it does for any dialog. Watching changes nothing — no record,
count or time moves, and nothing is written — and closing it goes back to the dialog it was
opened from as it was (History still filtered, as long, and at the game), focus back on its
Watch.

- **What it shows:** the board as it stood after the move on show — numbers, your own notes or
  the auto candidates, checked, wrong and revealed marks, conflicts — drawn by the game's own
  board in a read-only mode (a table of plain cells: nothing to select or press), the move's
  cell outlined in the accent, and a caption: "5 in row 3, column 4", "Struck 3 in row 3,
  column 4", "Erased row 3, column 4", "Undo", "Hint: X-Wing", "Hint: Hidden single in box 2",
  "Hint: step 2 of 7, a hidden triple in row 4" (a step hint: every house numbered, as there is
  no "this cell" to count from; the last step, the single, captioned as a single), "Show me for
  row 5, column 5", "Show me for row 2, column 1: step 3 of 7" (a page of Show me, headed as Show
  me headed it), "Checked the puzzle", "Revealed row 3, column 4", "Auto
  candidates on", "Check guesses off", "Reset"; a candidate entered over a number says what it
  cleared ("Cleared 6, struck 5 in row 3, column 4"). A move that made a mistake that counted says so
  ("— a mistake", "— a candidate mistake"), as does a slip forgiven ("— a slip, put right in
  time"), and the solving move ("— solved").
- **The controls:** Play and Pause (Watch again at the solve), a move back or forward, to the
  start or the solve, speeds of 1×, 2×, 4× and 8×, and a scrubber — a native range, which a
  screen reader hears as "Move 42 of 310, 4:12". Marks along it show each mistake that counted
  (solid, above the track), each slip forgiven (open, above) and each move of help — a hint, Show
  me or a page of it, a check or a reveal (a small square, below) — with a key to those present. The keys work
  anywhere in the dialog — <kbd>Space</kbd> plays and pauses, <kbd>←</kbd> and <kbd>→</kbd> step,
  <kbd>Home</kbd> and <kbd>End</kbd> jump — except where a control has a use of its own for one
  (Space presses a button, the arrows move the scrubber or the speeds); the game's own keys stand
  down while any dialog is open, and a held Space counts once. A move taken by hand has its
  caption spoken; a playback running by itself speaks only where it stops — the move on show when
  paused, the solve when it gets there — and with less motion asked for it still steps, with
  nothing animated.
- **Time:** each move comes after the pause the player took before it, divided by the speed, but
  a long think is shortened to 1.5 s (at 1×), and moves made within a tenth of a second of each
  other are spread 0.15 s apart so each shows. The time beside the board is the real play time
  at the move on show, against the solve's.
- **What it is played from:** the puzzle's givens and the encoded move log, nothing else — the
  solution is worked out from the givens, and neither the record nor the saved board (which a
  finished game loses once off screen) is read — so a solve that came from somewhere else plays
  the same way. `src/core/playback.ts` prepares it: it replays the log through the reducer once,
  keeping the game after every move, works out each move's cell, what a candidate move did to its
  digit (pencilled or struck, and any number it cleared — read from the game before and after
  it, as `analyseMistakes` judges a struck answer), which page of Show me a page move showed (the
  log keeps only its step's id: the route is walked again from the board before it, held to the
  solution and numbered on from the cell's last step hint, as Show me did), and its mistakes
  (`analyseMistakes`), and
  places the scrubber's marks; the
  timing and the cursor (`steer`: play, pause, step, seek, speed) are pure functions of it, and
  `usePlayback` only waits out each pause on the browser's timers. The captions are the UI's
  (`src/ui/playbackText.ts`), as the engine speaks no English.
- **What can be watched:** a solved game whose log decodes under this build's format and rules
  version and replays to the solve at its last move (`isPlayable`, asked only of the History rows
  built, and remembered) — play logs nothing after a solve, so a log that goes on past one is
  taken as damaged. A game not recorded move by move — begun before logs were kept, or one whose log
  stopped (see [The move log](#the-move-log)) — offers nothing; a log recorded under an older
  rules version is swept as a visit starts, so History says nothing of it either. Given a log it
  cannot play back, the player says why in the board's place: recorded by an older version, by a
  newer one (reload to update), damaged, or stopping short of the solve — `readMoveLogHeader`
  tells them apart.

## Sharing a solve

A solved game's time can carry the solve itself: the Share dialog — from the Solved dialog's
Share your time, or History's Share — has a switch, **Include my solve** ("Your friend can watch
how you did it. If they watch before solving it themselves, they won't get a time for it."),
shown only when the game has a log this build plays back to its solve at the time being shared,
no longer than 4,000 characters (`MAX_SHARED_LOG_LENGTH`; a chat app may cut a longer link short,
and a link cut short opens nothing). It is **off** each time the dialog opens: a shared time is
for racing, and its link stays short — the solve makes it several times longer (some 200–1,100
characters more) and gives the puzzle away, so sending it is the sharer's choice, never something
they find they did. Switched on, the link gains `&s=` and the message a last line, "You can watch
my solve too, once you've had a go.", which says nothing of how the solve went. A replay's
solve, or one after watching a friend's, has no time to go with, and is never sent.

Opening a link with a solve, the log is decoded strictly and replayed against the link's givens
(`sharedSolveRefusal` in `src/core/playback.ts`): it must play to their solve, and end there, at
the time the link claims — within a second, the rounding a link's whole seconds and the log's
tenths allow — so a link cannot pair one solve with another's time. A solve that fails any of it
is dropped without a word and the link opens as it would have without it, but for one recorded
by a newer version, which says so under the board: "This solve needs a newer version of the game
to watch." A solve that checks out is kept with the challenge (`Challenge.log`).

- **Watching before solving.** The Ready card offers **Watch Dan's solve** (the name you gave the
  friend, if you have, else their link's; "Watch your friend's solve" for a link with no name) beside Start, and the Paused card beside Resume, for an attempt
  reopened from the link. For a puzzle the player has not solved, it asks first, focus on the
  safe choice: "Watch Dan's solve? — This shows every number Dan placed. You haven't solved this
  puzzle yet: if you watch now, you won't be able to record a time for it, now or later." with
  **Play it first** (which starts or resumes the game) and **Watch anyway**. Escape leaves it
  as it was.
- **The spoiler rule.** Watching anyway remembers the puzzle as watched (`sudoku.watched`, its
  share code, up to 2,000 like the puzzles seen, outliving its records) and flags every
  unfinished attempt at it (`GameRecord.watched`) — the game on screen and any in History — and
  every attempt begun since, by any way back to the puzzle: a reload, Play again, the link
  again, the generator or a daily dealing it, a game resumed from History, an import. The rule
  lives where every record is written (`upsertRecord`), so no path can miss it. Such a solve is
  recorded as solved, without a time: the Solved dialog says "Solved — no time recorded: you
  watched a solve of this puzzle first." where the time would be, and the header's timer shows a
  dash ("Solved, no time recorded"); it is no best and in no
  average; a daily's counts for no streak ("You watched a solve of it first, so it doesn't count
  towards your streak"), and its calendar mark is a solve that did not count; History says
  "Solved after watching a solve"; sharing it shares the puzzle alone; and the head-to-head shows
  a dash for your time ("no time recorded") and, in place of a verdict, "You watched a solve
  first, so there's no time to compare." Its mistakes still show. The Ready card, once the solve
  has been watched, says "You've watched a solve of this puzzle, so no time will be recorded."
  in place of "The timer starts when you do.", and watching again asks nothing more.
- **Watching once solved is free.** With any solve of the puzzle in the history, watching gives
  nothing away: it opens at once, and remembers nothing. The link's offer to play a solved
  puzzle again offers it in its head-to-head, as do the Solved dialog's head-to-head after a
  solve of your own and the solved game's row in History — **Watch Dan's solve**, focus back on
  it as the player closes.

The player is the one your own solves play in (see [Watch your solve](#watch-your-solve)),
headed "Dan's solve" (the name you gave the friend, if you have, else their link's) over the
puzzle's tier, or its daily, and their time.

## Comparing solves

Once you have solved a puzzle whose link carried a friend's solve, **Compare solves**, beside
**Watch Dan's solve** — in the Solved dialog's head-to-head, the offer to play a solved puzzle
again, and the solved game's row in History — sets your solve against theirs (`CompareDialog`). It
is offered only when both play back: your own move log (see [The move log](#the-move-log)) and the
one the link carried (`Challenge.log`). A solve recorded with no time, after watching theirs
first, can be compared too: it simply shows no time. Like watching, comparing changes nothing —
no record, count or time moves, and nothing is written — the game behind stays paused, as for any
dialog, and closing it goes back where it was opened, focus on its Compare solves.

- **The heading:** "You vs Dan" (the name you gave the friend, if you have, else their link's;
  "You vs your friend" for a link with no name), over the puzzle and both times: "Easy · You 5:23
  · Dan 6:40", or "You: no time recorded".
- **The chart:** the cells each of you had solved — the puzzle's empty cells holding their answer
  — over play time, from 0:00 to the end of the longer solve, a step line each: yours solid, your
  friend's dashed. The mistakes that counted (of both kinds) are triangles on the line, and each
  move of help — a hint, Show me or a page of it, a check or a reveal — a diamond; yours filled, theirs open, each
  ringed in the dialog's own colour where it crosses a line, and theirs drawn over yours as an
  outline, so a spot you share (both at 0 cells at the start, a mistake each in the same second)
  shows your fill inside their ring. Auto candidates and Checked as entered, switches rather than
  moves, are not marked: the head-to-head has them. Each line is labelled where it ends with whose
  it is and the time ("You 5:23", "Dan 6:40"), above the chart; where the faster line's label would
  run into the other's, it sits beside its own line's end dot instead, inside the chart — never
  stacked, and never over the other line's end. A legend says the same. The axes are hairlines with a
  few round times (0:30, 1:00, 5:00…) and cell counts, the full count at the top.
- **The cursor:** a vertical line at the moment on show, with the counts there above the chart —
  "2:15 — You 34 cells, Dan 28 cells". The chart is the control: press or tap to put the cursor
  there, drag along it to scrub (a finger moving up or down scrolls the dialog and leaves the
  cursor where it was), or, with it focused (it is a
  slider, which a screen reader hears by the same words), <kbd>←</kbd>/<kbd>→</kbd> a second,
  <kbd>Page Up</kbd>/<kbd>Page Down</kbd> ten, <kbd>Home</kbd> and <kbd>End</kbd> to either end. It
  opens where the faster solve finished. Nothing plays by itself.
- **The table:** **Show as table**, after the board (so it never comes between the chart and the
  board it drives), lists the cells each of you had solved at round times to the end, and every
  mistake that counted and move of help, when and whose.
- **Names:** one longer than 12 characters is cut short ("Bartholomew…") where it shares a line
  with others — the chart's labels, its legend and readout, and the board's key; the heading, the
  times, the tables and every name a screen reader hears keep it whole.
- **On a phone on its side** the board sits beside the chart, both in view as it opens: the card
  takes the screen's height, and the chart and the board are sized from what its body has.
- **The board:** the game's own, read-only (as a playback's), at the cursor. Givens as ever; a
  number you both had in a quiet ink, upright; one only you had in your ink, upright, over a solid
  rule; one only your friend had in theirs, slanted, over a dashed rule; and where you had
  different numbers (one of you wrong then), both, small — yours top left, theirs bottom right. So
  it reads without colour, in High contrast and in Windows High Contrast, and at 320px wide. A key
  under it says which is which, and each cell's name says it in words ("7, yours", "yours 3, Dan's
  7").
- **Time** is counted in whole seconds, the unit times are shown in: at 5:23 the board shows
  every move made by then, so a solve the player was told took 5:23 is finished there.
- **Colour:** two series colours of the theme's own (`--series-you`, an ultramarine, and
  `--series-friend`, a vermilion, stepped for each palette) for the chart's lines and marks only —
  chosen with the data-visualisation palette checks: inside the chart's lightness band, a chroma
  that reads as a colour, apart in normal vision and under simulated protanopia and deuteranopia,
  and 3:1 against the dialog — and two inks of the same hues (`--ink-you`, `--ink-friend`) for the
  board's numbers at 7:1. Text is never in a series colour. `src/styles/contrast.test.ts` holds all
  of it in every palette.
- **What it is worked out from:** the two playbacks (`src/core/playback.ts`) and nothing else, by
  `src/core/compare.ts`: each player's progress, kept a point a second where it changed (an Undo,
  an Erase or a Reset can bring it down), the cells solved at any second (a binary search), the
  overlaid board at any second (each cell given, empty, both, yours, theirs or different), the
  marks from the mistakes `analyseMistakes` counted and the moves of help, and the chart's ticks,
  scales and where its end labels go (above the chart, or beside the line's end). The chart draws
  what stays put once for the solves and its size, so moving the cursor redraws only the cursor.
  The words are the UI's (`src/ui/compareText.ts`).

## Racing friends

A share link carries the puzzle itself, so it opens the same puzzle for anyone, on any version of
the game — there is no server and nothing is uploaded.

| Parameter      | Meaning                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?p=<code>`    | The puzzle: its givens packed into ~26–34 URL-safe characters.                                                                                              |
| `&t=<secs>`    | The sharer's time in whole seconds — the time to beat.                                                                                                      |
| `&n=<name>`    | The sharer's name (optional; past 24 characters it is cut short with an ellipsis); shown until the friend names you (see [Friends](#friends)).              |
| `&u=<id>`      | The sharer's player ID: 10 random letters and digits, made once per browser the first time it shares a time. Only with `t=`. Versions before it ignore it.  |
| `&a=<assists>` | Help the sharer took: `c` auto candidates, `g` guesses checked as entered, `h<N>` hints, `k<N>` checks, `r<N>` reveals; mistakes: `m<N>`, candidate `x<N>`. |
| `&d=<date>`    | A daily's date (`2026-10-13`): the opener checks it against that day's daily of the tier.                                                                   |
| `&s=<solve>`   | The sharer's solve, its move log as stored (base64url), only with `t=`: see [Sharing a solve](#sharing-a-solve). Versions before it ignore it.              |

Opening a link:

- **A link from someone new** — an ID not in [Friends](#friends) yet — first asks _Who sent this?_,
  the board's place blank and the clock stopped, before any of the below. Save names them (the
  link's name is filled in), Skip goes by their links' names. A link without an ID, or from your own
  browser, never asks.
- **A puzzle you haven't played** opens behind a "Ready?" card showing the time to beat, and the
  clock only starts when you press **Start** — so both of you start the same way. Until you do, a
  reload or a second click on the link brings the same card back.
- **A puzzle you're part-way through** reopens your game, with the challenge attached.
- **A puzzle you've already solved** shows how your time compares — your newest time that
  counted, rather than a replay's — and offers to play it again (which carries on an unfinished
  attempt, if you have one).
- **A broken link** says so and carries on with a fresh puzzle (or the game you were playing).
- **Your own link** — one whose `u=` is this browser's own ID — races no one: its time, solve and
  ID are set aside and it opens as a link without a time would, so a puzzle you have solved here
  shows your time and offers to play it again, with no head-to-head against yourself and no
  solve of your own to watch as a friend's. A game raced against your own link by a version from
  before such a link raced no one — one whose link carried this browser's ID — has that race taken
  off as a visit starts (`repairOwnRaces`), the game on screen included, and so does one an import
  brings in: History lists it as a game of your own. A race from a link older than IDs carries
  none, so it cannot be told from a friend's, and stays; Delete in History removes the game.

The difficulty is always re-graded from the puzzle itself rather than taken from the link, and
the parameters are cleared from the address bar once read, so reloading never drags you back.
A version of the game opens a link from a later one all the same: it skips a letter of `a=` it
does not know (`g` came after the others), and reads the rest as written. A version from before
solves were shared skips `s=` too — it only stays in that version's address bar, which clears
the parameters it knows and no others; harmless, as nothing there reads it. A version from before
player IDs skips `u=` the same way, and leaves it in its address bar.

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

## Friends

Every browser that shares a time sends its player ID with it (`u=`, see
[Racing friends](#racing-friends)): ten random letters and digits, made once, the first time it
shares one. That ID, not the name a link gives, is what tells one friend's times from another's —
a link's name is whatever its sender typed that day, and can change from one link to the next. A
link without an ID, from a version before them or with a garbled one, is raced as before, under
its own name.

Every link opened with an ID is noted (`sudoku.friends`, in `src/storage/friends.ts`): the ID,
the latest name its links gave and when its latest link was opened, whatever the link goes on to
open — a new game, one you were part-way through, or the offer to play a solved puzzle again. A
link from your own browser's ID is not. **Friends**, at the foot of History (shown once there is
anyone in it), lists everyone noted, the most recent link first — what each goes by, when their
latest link came, and what their links call them — with **Rename** on each. The name you give
someone there is the one you see on every race of theirs: the Ready card, **Watch Dan's solve**
and the warning before it, the solve played back, **Compare solves**, the head-to-head when you
finish, the offer to play a solved puzzle again, and History's "vs Dan" — past races included, as names are worked out
as they are drawn, never written into the history. Each race keeps the name its own link gave,
which shows again if you clear the name you gave (save it empty). Saving the name a link gave
keeps it too, whatever their later links call themselves. A race from before player IDs keeps its
link's name for good, and so does a race of a device whose links came in before Friends existed,
until its next link notes it. Other tabs pick a new name up as History or Friends next opens.

The first link from an ID the list does not hold yet asks **Who sent this?** before anything the
link opens — its Ready card, the game you were part-way through or the offer to play a solved puzzle
again, each coming once it is answered — the board's place left blank meanwhile, so a rude name in
the link is not on show behind it, and the clock never running. (Races already in History with that
ID do not count on their own: only the list does — which History's import fills too, see below.) Its
field holds the link's name, focused and selected: type over it, or keep it, and **Save** (or Enter)
names them, just as **Rename** in Friends would — saving the link's own name keeps it whatever their
later links say. Saved empty, or skipped (**Skip**, Escape, the close button or a tap outside), they
go by their links' names until you name them in Friends. Either way they were noted as the link
opened, so the question is never asked of them again — closing the tab before answering is the same
as Skip. A link without an ID, from your own browser, or from anyone already in the list never asks.

An ID belongs to a browser, not a person, so someone who shares from their phone and their laptop
arrives as two friends. Once anyone else is in the list, _Who sent this?_ asks below its field
**Or is it a friend you have already, on another device?**, with everyone else to choose from,
latest first — never chosen for you, however alike the names, as a name is exactly what a stranger
can copy. Choose one and **Save**, and the new device joins them, under the name you gave them
(the name field is disabled meanwhile, greyed out but not hidden, so nothing moves). In Friends,
**Merge…** (once there are two friends) says one is the same person as another, picked from
everyone else, latest first, with the latest picked to begin with: the two become one, under the
name you gave the one you chose, or else this one's — a merge never makes a name up, and never
loses the one you gave. Pressing **Merge** is all it asks, as a merge can be undone: a merged
friend lists their devices, each by the name its links last gave and when, and **Split off** on
any of them makes it a friend of its own again, unnamed, so its races show the name each of its
links gave until you name it.

The list keeps up to 200 devices (some 41,000 characters with every name at its longest). Past
that, the device heard from longest ago is forgotten — with the name you gave its friend, if it
was their last — and its next link is noted as someone new; never the device whose link is being
opened. The list is never shed to make room for anything else.

History's **Export** carries the list to another browser, whose **Import** adds the devices it has
never had a link from, into whatever room is left of its 200 — each joining whichever of its friends
holds a device the file groups it with, or else a new friend under the file's name — and never
renames, merges or splits a friend it has (see [Your data](#your-data)).

An ID proves nothing, as a time proves nothing: anyone holding one of your links can copy its
`u=`, and their links would then show under the name a friend gave you. It is the honour system,
as times are; trust is on first use.

## Your data

Everything is stored in your browser's `localStorage` under `sudoku.*` keys — preferences (with
this browser's player ID, once you share a time), the history (up to 1,000 games, a daily's with
the date it is the daily of and the date you started it — the calendar and the streaks are worked
out from it — and each game's [mistakes](#mistakes), stamped with the time they were counted at),
what the dailies of games pruned from the history said (a few bytes a day, kept for good, so
neither a best streak nor the calendar forgets them), the saved state of unfinished games (up to
50), every game's move log, the puzzles you have seen (up to 2,000, so a puzzle stays seen after
its game is deleted), the puzzles whose shared solve you watched before solving them
(`sudoku.watched`, up to 2,000 — see [Sharing a solve](#sharing-a-solve)), the friends whose
links you have opened (`sudoku.friends`, up to 200 devices — each one's ID, the latest name its
links gave and when — grouped into friends with the name you gave each; some 41,000 characters
with every name at its longest — see [Friends](#friends)) and the daily puzzles already dealt (the
last 112, so they need not be dealt again). A game raced against a link that
carried a solve keeps it with the challenge, inside its record, held on reading back to the shape
and length of a log in a link (at most 4,000 characters; some 200–1,100 in practice). There are no
accounts and no tracking: the player ID is random, and travels only in links you share with a
time.

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
more than one such chunk beyond what the write needed is ever lost; then friends' solves kept with
their challenges (every game's but the one on screen, which keeps the name and time it was racing;
only the button to watch the solve goes); and only once those are gone too, the saved boards of all but the 10 most recently played unfinished games, and
finished games beyond the newest 300, with their logs. The game on screen, the logs of unfinished
games, the preferences and the friends list are never shed. Finished games' logs go first because
nothing needs them to carry on playing (a game whose log is shed keeps its record and its count of
mistakes, but can no longer be watched). In a test with a full history and the storage filled to the
brim, one chunk (130 logs) makes room for the whole of a pencil-every-candidate game played after
it; with the quota cut by another 300,000 characters, 754 of the 950 finished games' logs go and
every record and board stays. If a log cannot be written even then, its game's old log is deleted
rather than left stopping short of the board saved beside it.

A tab left open on an older version after an update carries on saving, so the game keeps what it
does not recognise rather than wiping it: small fields a newer version added to a game's record,
its saved board or the preferences (up to 8 per object, each at most 200 characters of JSON) are
written back untouched, and a theme it does not know is applied as System, with none shown as
chosen in Settings, but kept until you pick one. (So a record's `watched` flag survives such a
tab, as do a challenge's player ID and the preferences' — though that tab, knowing nothing of the
flag, would show and count the solve's time until it is reloaded; a challenge's solve longer than
those 200 characters, as most are, is dropped by it.) A tab from before the friends list never
touches `sudoku.friends`, so the names given there survive it too, though it shows each race
under its link's name until it is reloaded.

Some browsers clear a site's storage after a while away (Safari does after seven days without a
visit, unless the game has been added to the home screen). Use **Export** in History to keep a
copy, and **Import** to bring it back or move it to another browser — imported games, the
puzzles seen, the puzzles watched and the dailies' record are merged with what is already
there, and every unfinished attempt at a puzzle watched, here or in the file, is flagged as
watched. The friends list is merged too: a device this browser has never had a link from joins
the friend the file has it with — one of yours, if the file groups it with a device you know, or
else a new friend under the file's name — into the room left under the cap. A friend you already
have is never renamed, merged or split by an import, so importing the same file twice adds
nothing. Your own player ID is not exported: each browser keeps its own. The file carries every
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
  (`src/styles/contrast.test.ts`) — a hinted step's sage tint and its given twin included: every
  ink on them, the rules and marks, a clear step from plain cells and givens, and from the same
  numbers and the selected block, which can sit among its cells. The tint takes the place of the
  selected cell's row, column and box whenever it is on show, so it never meets the peer fill,
  which it would be told from by hue alone. The daily archive is held to the engine in the code, and on a
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
  layers, Check guesses on from the start and switched on part-way — and by random games, whose
  counts must never fall and must stay at nothing for a game that never lets a wrong number
  stand. What Check guesses marks has golden logs and a checklist entry of its own, and the error
  counter is checked to move only once a slip has settled, on the main hook's own play clock.
  Help taken is held to History's words for every kind of help, to shortening by measure (full
  words, counts, total) and to ticking on a charge only — not for help a game behind Start takes
  up as it starts, and for Show me's, only as its walkthrough closes; through the main hook, a hint
  asked for again costs and says nothing more, while the next new one says "2 hints used.", and
  Check guesses switched on mid-game says it is help. The owner's report — the Expert of 10
  October 2026, row 2, column 1, in Auto Candidate Mode — is played through the main hook a hint
  at a time: "Step 1 of 7 … column 8", the 2s struck, "Step 2 of 7" counted, asked again for
  free, and on to the hidden single, every new step counted once; a digit placed elsewhere moving
  the cell on to a step not seen, which the bar and tint then never name for free; the tint kept
  while the step is made; Show me's pages counted as each is first seen and free on return; and
  step hints followed on the Expert dailies always name the step Show me starts with, never strike
  an answer, and always solve.
  Playback is held to every kind of move a log holds — the cell each outlines, its caption, its
  mistakes and the scrubber's marks — to its timing at every speed, long pauses shortened and
  bursts spread, to stepping, seeking and its ends, and to refusing, with the reason, a log from
  an older or a newer build or a broken one; watching is checked to write nothing. A log with
  step hints and Show me's pages in it plays back, each captioned with the step or page it
  revealed.
  Comparing solves is held to each player's progress (two moves in a second, an Undo, a Redo and a
  Reset, and a second ending where the one before ended), the lookups at every second, the
  overlaid board's every kind of cell, the marks (a slip forgiven left off), the ticks and where
  the end labels go; its chart to its keys, a press and a drag, a finger's tap, drag and swipe to
  scroll, its readout, its table and its board's key; and its button to the solves it needs, both
  playing back, writing nothing.
  Share links are held to the versions before them: a copy of the assists decoder every earlier
  version shipped must read a new link's help unchanged, skipping its mistakes, and an old link
  must read as mistakes not recorded, never 0; a link without `u=` reads as no ID, a garbled `u=`
  costs only the ID, and `u=` changes no other parameter; the friends list's operations — noting,
  renaming, merging, splitting, the cap — read back exactly what they wrote, a device merged
  in and split off again is on its own as it was, and an import never undoes a merge, split or
  rename. A solve in a link is held to its puzzle
  and its time — another puzzle's log, a time a second or more off, an older version's log, a broken
  one and a newer version's (which alone is said) — and the spoiler rule to every way back to a
  watched puzzle: a reload mid-game, Play again, a new attempt from the generator, a game resumed
  from History, a daily, an import, and the record pruned past 1,000 while the puzzle stays watched.
  Coverage thresholds are enforced in CI, with the engine held to 100%.
- **End-to-end** (`e2e/`, Playwright): full journeys against the built app — playing and solving,
  pausing and reloading, share links between two browsers (a solve with a mistake shared, opened in
  the other and compared row by row), the history, the technique guide, a
  hint's Show me walkthrough (and a step hint followed a step at a time, its pages turned with
  help taken ticking only for pages not seen before), the daily puzzles on a fixed clock (today's Hard from New game to
  the end and its streak, yesterday's from the calendar kept but not counted, a friend's daily
  link recognised), mistakes (an obvious slip put right at once, a wrong number where the answer
  was not obvious, Check guesses marking and counting one at once with "guesses checked as
  entered" beside the time, and the error counter waiting out a slip's 3 seconds of play),
  sharing a solve between browsers (one plays first and then watches it for nothing, another
  watches first and solves it with no time, the sharer's own link, followed in their own browser,
  racing no one, one who has solved it watches without being asked, and a daily's, watched first,
  kept out of the streak),
  comparing two solves between browsers (opened from the Solved dialog and from History, the
  cursor moved by keys and by a press, the readout and the board following it, focus back on
  Compare solves, and fitting a 320px phone and a phone on its side, opened at the top and, on its
  side, the chart and the board both in view), friends (a sharer named in the list, then at the
  prompt, kept through a reload and a later link calling itself something else — every race, the
  head-to-head and History following — the prompt's field typed over and Enter, then Enter again
  starting the race, a real sharer's two links carrying the one ID the prompt fills its name from,
  two devices taken for one friend at the prompt, split off and merged again in Friends — every
  race in History following, through a reload — and a name given carried by History's export to
  another browser, naming the race it imports and asking nothing of the sender's next link there),
  watching a solve with a mistake played back from the Solved dialog and from History (stepped,
  scrubbed and played at 8× on Playwright's clock, its mistake marked and captioned, focus back on
  Watch as it closes, and fitting a 320px phone and a phone on its side) and the phone layout from
  320px wide up and on its side (the calendar's
  days measured at 44px at 320px, the head-to-head's every row, hour-long times on one line and a
  long right-to-left name kept inside its card, New game and the calendar whole on a phone on its
  side, and the error counter's line with help taken beside it, upright and on its side, a large
  phone's header folding its buttons to fit both at 1:23:45 — a daily Medium's wordmark and tier
  never clipped, measured to the sub-pixel — and help taken giving way to its counts and then its
  total, never cut, beside a counter with a candidate mistake; with neither shown, the board as
  large as with the setting off; help taken alone above a 375×667 phone's controls, and on a
  320×568 phone beside a hint that keeps to two lines; Friends and _Who sent this?_ upright and on
  their sides, a long right-to-left name kept inside Friends' rows, a merged friend's devices and
  the prompt's hint, every control 44px — the friend pickers and a merge's buttons among them — and History's foot giving Friends a row of its own at 320px; and a desktop's header with a daily Medium and help at its widest). Help taken stays on show through a pause, its count the only one the
  hidden board leaves beside the timer's. An accessibility pass (`a11y.spec.ts`) runs axe-core's WCAG 2.2 A and AA rules over the main states — the board with
  every kind of mark, the error counter and help taken in both their places, the Ready and Paused
  cards, the menus (the "…" menu's "Hint (1 used)" among them),
  every dialog (Show me's, the daily calendar's, a solve played back, the warning before watching
  a friend's solve, two solves compared, Share with the solve included, History with Friends at
  its foot, Friends with a merged friend's devices, a name being changed and two friends being
  merged, and _Who sent this?_ with friends to choose from among them), each guide entry and a
  step hint's tinted houses — in both themes, and the board (its tint included), the dialogs, the
  menus and the calendar in High contrast, both chosen in
  Settings on a dark device and from a dark system asking for more contrast, measuring its heavier
  lines and its same-number ring kept off the digits — and allows no violations. Three projects:

  | Project    | Device         | Engine   | Specs                                                 |
  | ---------- | -------------- | -------- | ----------------------------------------------------- |
  | `chromium` | Desktop Chrome | Chromium | everything except the touch suite                     |
  | `iphone`   | iPhone 15      | WebKit   | `touch.spec.ts`, and the phone pass of `a11y.spec.ts` |
  | `android`  | Pixel 7        | Chromium | `touch.spec.ts`, and the phone pass of `a11y.spec.ts` |

  `npm run test:e2e` serves its build on a port of its own for each checkout, picked from the
  checkout's path, so separate clones and git worktrees can run the suite at the same time, and a
  `npm run preview` left running on 4173 is never in the way. It never tests a server it finds on
  that port, which may be serving another build or stop halfway: one there fails the run before it
  starts. So let a run finish before starting another in the same checkout — both would build into
  its `dist/` anyway. Set `PLAYWRIGHT_PORT` to choose the port, should two checkouts ever land on
  the same one.

## Deployment

Pushing to `main` runs [CI](.github/workflows/ci.yml) (format, lint, type-check, tests, build, e2e);
once that passes, the same run publishes the commit to **GitHub Pages**.

To set it up on a new repository, enable Pages once: in **Settings → Pages**, set **Source** to
**GitHub Actions**.

The Pages build sets Vite's `base` to `/<repository-name>/` automatically. If you rename the repo,
no change is needed — the base is derived from the repository name at build time.

## Controls

| Action                         | Keyboard                                                                                           | Mouse / Touch                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Select a cell                  | <kbd>Tab</kbd> to the board                                                                        | Click or tap it                      |
| Move the selection             | Arrow keys                                                                                         | Tap another cell                     |
| Enter a number                 | <kbd>1</kbd>–<kbd>9</kbd>                                                                          | Number pad                           |
| Erase                          | <kbd>Backspace</kbd> / <kbd>Delete</kbd>                                                           | Erase button                         |
| Switch Normal / Candidate      | <kbd>Space</kbd>                                                                                   | Mode buttons                         |
| Switch while held              | Hold <kbd>Shift</kbd> or <kbd>Alt</kbd>                                                            | —                                    |
| Toggle one candidate           | —                                                                                                  | Click its spot in the selected cell  |
| Undo                           | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>                                                          | Undo button                          |
| Redo                           | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd>           | Redo button                          |
| Pause or resume                | <kbd>P</kbd>                                                                                       | The timer                            |
| Hint, check, reveal, reset     | —                                                                                                  | The "…" menu                         |
| Show me how to solve a cell    | —                                                                                                  | Show me, after a hint                |
| New game, or today's puzzles   | —                                                                                                  | The + button                         |
| Daily calendar and streaks     | Arrow keys, Home/End, Page Up/Page Down in the month                                               | The calendar in the header, or +     |
| History, share, settings, help | —                                                                                                  | The header (on a phone, the ☰ menu) |
| Friends                        | —                                                                                                  | Friends, at the foot of History      |
| Solving techniques             | —                                                                                                  | The header, or a hint's question     |
| Watch your solve               | <kbd>Space</kbd>, <kbd>←</kbd>/<kbd>→</kbd>, <kbd>Home</kbd>/<kbd>End</kbd>                        | Watch your solve, or History's Watch |
| Compare solves                 | <kbd>←</kbd>/<kbd>→</kbd>, <kbd>Page Up</kbd>/<kbd>Page Down</kbd>, <kbd>Home</kbd>/<kbd>End</kbd> | Tap or drag along the chart          |
