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
  thin rules, and row, column and same-number fills strong enough to find at a glance (it follows
  your system, or pick Light or Dark in Settings) — and the game stays playable in Windows High
  Contrast.

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

## Racing friends

A share link carries the puzzle itself, so it opens the same puzzle for anyone, on any version of
the game — there is no server and nothing is uploaded.

| Parameter      | Meaning                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------- |
| `?p=<code>`    | The puzzle: its givens packed into ~26–34 URL-safe characters.                            |
| `&t=<secs>`    | The sharer's time in whole seconds — the time to beat.                                    |
| `&n=<name>`    | The sharer's name (optional; past 24 characters it is cut short with an ellipsis).        |
| `&a=<assists>` | Help the sharer took: `c` auto candidates, `h<N>` hints, `k<N>` checks, `r<N>` reveals.   |
| `&d=<date>`    | A daily's date (`2026-10-13`): the opener checks it against that day's daily of the tier. |

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
it — the calendar and the streaks are worked out from it), what the dailies of games pruned from
the history said (a few bytes a day, kept for good, so neither a best streak nor the calendar
forgets them), the saved state of unfinished games (up to 50), the puzzles you
have seen (up to 2,000, so a puzzle stays seen after its game is deleted) and the daily puzzles
already dealt (the last 112, so they need not be dealt again). There are no accounts and no
tracking.

A tab left open on an older version after an update carries on saving, so the game keeps what it
does not recognise rather than wiping it: small fields a newer version added to a game's record,
its saved board or the preferences (up to 8 per object, each at most 200 characters of JSON) are
written back untouched, and a theme it does not know is applied as System, with none shown as
chosen in Settings, but kept until you pick one. Nothing ever deletes the keys `sudoku.moves.<id>`
and `sudoku.moveLogs`, which are kept for move logs.

Some browsers clear a site's storage after a while away (Safari does after seven days without a
visit, unless the game has been added to the home screen). Use **Export** in History to keep a
copy, and **Import** to bring it back or move it to another browser — imported games, the
puzzles seen and the dailies' record are merged with what is already there.

## Testing

- **Unit & component** (`*.test.ts[x]`, Vitest + Testing Library): the engine is tested
  exhaustively, including a soundness harness that checks every placement and elimination the
  grader makes against the known solution — and every step's pattern against its board with
  `isStepValid`, the check a walkthrough must pass before it is shown — golden puzzles pinned per
  tier, and property tests over many seeds. Components and hooks are tested through real
  interactions. The palette is read straight from the stylesheet and held to its contrast targets
  pair by pair, in both themes and under simulated colour-blindness
  (`src/styles/contrast.test.ts`). The daily archive is held to the engine in the code, and on a
  pull request to the archive main has released, by a guard of its own
  (`src/daily/archive.guard.test.ts`, see [The daily archive](#the-daily-archive)), and date
  arithmetic and streaks are tested across the clocks changing in London and New York, and across
  a change of time zone between starting a daily and looking at its streak.
  Coverage thresholds are enforced in CI, with the engine held to 100%.
- **End-to-end** (`e2e/`, Playwright): full journeys against the built app — playing and solving,
  pausing and reloading, share links between two browsers, the history, the technique guide, a
  hint's Show me walkthrough, the daily puzzles on a fixed clock (today's Hard from New game to
  the end and its streak, yesterday's from the calendar kept but not counted, a friend's daily
  link recognised) and the phone layout from 320px wide up and on its side (the calendar's days
  measured at 44px at 320px, New game and the calendar whole on a phone on its side). An accessibility pass
  (`a11y.spec.ts`) runs axe-core's WCAG 2.2 A and AA rules over the main states — the board with
  every kind of mark, the Ready and Paused cards, the menus, every dialog (Show me's and the daily
  calendar's included) and each guide entry — in both themes, and allows no violations. Three
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
| New game, or today's puzzles   | —                                                                                        | The + button                         |
| Daily calendar and streaks     | Arrow keys, Home/End, Page Up/Page Down in the month                                     | The calendar in the header, or +     |
| History, share, settings, help | —                                                                                        | The header (on a phone, the ☰ menu) |
| Solving techniques             | —                                                                                        | The header, or a hint's question     |
