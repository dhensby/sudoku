import { randomSeed, type Difficulty, type Puzzle } from '../core';
import { respond, type GenerateRequest, type GenerateResponse } from '../worker/protocol';

/*
 * Where new puzzles come from.
 *
 * Generation runs in a module worker so the board never stutters while a Hard
 * grid is being dug out, and one puzzle per tier is generated ahead of time so
 * that New game is usually instant. Where there is no Worker (jsdom, a
 * browser that refuses module workers) or the worker fails, the same code
 * runs on the main thread instead — a beat later, after the UI has had a
 * chance to paint its spinner.
 */

/** Hands out puzzles, generating them off the main thread where it can. */
export interface PuzzleSource {
  /**
   * A fresh puzzle of `difficulty`: the one generated ahead of time if there
   * is one (ready, or still being worked on), else one generated now. Either
   * way another is then started in the background for next time.
   */
  next(difficulty: Difficulty): Promise<Puzzle>;
  /** Start generating a puzzle of `difficulty` now, so a later `next` finds it ready. */
  prefetch(difficulty: Difficulty): void;
  /**
   * Stop the worker and drop everything in flight. Promises from earlier
   * `next` calls that are still pending are dropped too: they **never
   * settle**, rather than rejecting — a rejection would only make every
   * caller catch an error that means nothing more than "nobody is listening
   * any more", and leave an unhandled rejection wherever one forgot.
   *
   * Not terminal: a later `next` or `prefetch` starts a new worker. That
   * keeps a source held for a component's lifetime working under StrictMode,
   * which disposes and re-runs effects once on mount.
   */
  dispose(): void;
}

/** The parts of a `Worker` the source uses — what a test fake has to provide. */
export interface WorkerLike {
  postMessage(message: GenerateRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<GenerateResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export interface PuzzleSourceOptions {
  /**
   * Start the worker, or return null to generate on the main thread. Called
   * lazily, on the first request (and again after `dispose`). Defaults to the
   * real module worker where `Worker` exists.
   */
  createWorker?: () => WorkerLike | null;
  /** Seeds for the puzzles, one per request. Defaults to `randomSeed`. */
  seed?: () => string;
}

/** A request waiting for its puzzle. */
interface Job {
  difficulty: Difficulty;
  seed: string;
  resolve: (puzzle: Puzzle) => void;
  reject: (error: Error) => void;
}

/**
 * The real generator worker, or null where there is none.
 *
 * The `new URL(…, import.meta.url)` has to stay written out inside
 * `new Worker(…)`: that exact shape is how Vite finds the worker script to
 * bundle, and hoisting it into a variable silently ships a page that tries to
 * load a `.ts` file. Construction is guarded because it can throw outright —
 * under a strict CSP, or in a browser that does not do module workers — and
 * that should mean the main-thread fallback, not a broken page.
 */
function createModuleWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('../worker/generate.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

/** Resolve or reject a request from its reply. */
function settle(job: Job, response: GenerateResponse): void {
  if ('puzzle' in response) job.resolve(response.puzzle);
  else job.reject(new Error(response.error));
}

/**
 * A puzzle source backed by the generator worker, falling back to the main
 * thread where there is no worker or once it has failed.
 *
 * A worker that fails (an `error` event — say the script would not load — or
 * a reply that could not be deserialised) is not tried again for the life of
 * the source: every request it was holding is generated on the main thread
 * instead, and so is everything after. A worker that failed once will most
 * likely fail again, and each retry would make the player wait for it first.
 */
export function createPuzzleSource(options: PuzzleSourceOptions = {}): PuzzleSource {
  const { createWorker = createModuleWorker, seed = randomSeed } = options;

  let worker: WorkerLike | null = null;
  let isWorkerBroken = false;
  let nextId = 1;
  /** Requests the worker is working on, by id. */
  const pending = new Map<number, Job>();
  /** Main-thread generations waiting for their turn, so `dispose` can cancel them. */
  const timers = new Set<number>();
  /** The puzzle generated ahead of time for each tier — ready, or still on its way. */
  const prefetched = new Map<Difficulty, Promise<Puzzle>>();

  /**
   * Generate on the main thread, in a task of its own: a beat later rather
   * than right now, so whatever asked can paint a spinner before the main
   * thread is busy for a few dozen milliseconds.
   */
  const runOnMainThread = (job: Job): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      settle(job, respond({ id: 0, difficulty: job.difficulty, seed: job.seed }));
    }, 0);
    timers.add(id);
  };

  /** Give up on the worker for good, and hand everything it held to the main thread. */
  const abandonWorker = (): void => {
    isWorkerBroken = true;
    worker?.terminate();
    worker = null;
    const jobs = [...pending.values()];
    pending.clear();
    jobs.forEach(runOnMainThread);
  };

  /** The worker, started on first use; null once there is none to be had. */
  const ensureWorker = (): WorkerLike | null => {
    if (worker !== null || isWorkerBroken) return worker;
    const created = createWorker();
    if (created === null) {
      isWorkerBroken = true;
      return null;
    }
    created.onmessage = (event) => {
      const job = pending.get(event.data.id);
      // Nothing is waiting for a reply the source no longer knows about —
      // one that arrived after `dispose`, say.
      if (job === undefined) return;
      pending.delete(event.data.id);
      settle(job, event.data);
    };
    created.onerror = (event) => {
      // Handled here, so it should not also surface as an uncaught error.
      event.preventDefault();
      // A worker already let go of has nothing to hand over, and must not
      // take its replacement down with it.
      if (worker === created) abandonWorker();
    };
    created.onmessageerror = () => {
      if (worker === created) abandonWorker();
    };
    worker = created;
    return worker;
  };

  const request = (difficulty: Difficulty): Promise<Puzzle> =>
    new Promise<Puzzle>((resolve, reject) => {
      const job: Job = { difficulty, seed: seed(), resolve, reject };
      const target = ensureWorker();
      if (target === null) {
        runOnMainThread(job);
        return;
      }
      const id = nextId++;
      pending.set(id, job);
      target.postMessage({ id, difficulty, seed: job.seed });
    });

  const prefetch = (difficulty: Difficulty): void => {
    if (prefetched.has(difficulty)) return;
    const puzzle = request(difficulty);
    prefetched.set(difficulty, puzzle);
    // A prefetch nobody has asked for yet must not become an unhandled
    // rejection; and a failed one is forgotten, so the next request starts
    // afresh instead of being handed the same failure.
    puzzle.catch(() => {
      if (prefetched.get(difficulty) === puzzle) prefetched.delete(difficulty);
    });
  };

  return {
    next(difficulty) {
      const puzzle = prefetched.get(difficulty) ?? request(difficulty);
      prefetched.delete(difficulty);
      prefetch(difficulty);
      return puzzle;
    },
    prefetch,
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
      prefetched.clear();
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    },
  };
}
