import { createRng, generatePuzzle, type Difficulty, type Puzzle } from '../core';
import { respond, type GenerateRequest, type GenerateResponse } from '../worker/protocol';
import { createPuzzleSource, type WorkerLike } from './puzzleSource';

/** A stand-in worker: it records requests and answers only when the test says so. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<GenerateResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly requests: GenerateRequest[] = [];
  isTerminated = false;

  postMessage(message: GenerateRequest): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.isTerminated = true;
  }

  /** Answer one request (the oldest by default) the way the real worker would. */
  answer(index = 0, response?: GenerateResponse): void {
    const [request] = this.requests.splice(index, 1);
    this.deliver(response ?? respond(request));
  }

  deliver(data: GenerateResponse): void {
    this.onmessage!({ data } as MessageEvent<GenerateResponse>);
  }

  fail(): ErrorEvent {
    const event = new ErrorEvent('error', { cancelable: true });
    this.onerror!(event);
    return event;
  }
}

/** Seeds s1, s2, … in request order, so each request's puzzle is predictable. */
function counterSeeds(): () => string {
  let n = 0;
  return () => `s${++n}`;
}

const puzzleFor = (difficulty: Difficulty, seed: string): Puzzle =>
  generatePuzzle(difficulty, createRng(seed));

/** Let every already-settled promise run its callbacks. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** Watch a promise without awaiting it, to assert that it has (or has not) settled. */
function watch<T>(promise: Promise<T>): { settled: boolean } {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

function setup() {
  const workers: FakeWorker[] = [];
  const createWorker = vi.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const source = createPuzzleSource({ createWorker, seed: counterSeeds() });
  return { source, workers, createWorker };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createPuzzleSource with a worker', () => {
  it('starts no worker until a puzzle is wanted', () => {
    // A source is made in a lazy useState initialiser, which StrictMode calls
    // twice and throws one result away: a worker started there would leak.
    const { source, createWorker } = setup();
    expect(createWorker).not.toHaveBeenCalled();
    void source.next('easy');
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('asks the worker for the puzzle, then for a spare to have ready next time', () => {
    const { source, workers } = setup();
    void source.next('hard');
    expect(workers).toHaveLength(1);
    expect(workers[0].requests).toEqual([
      { id: 1, difficulty: 'hard', seed: 's1' },
      { id: 2, difficulty: 'hard', seed: 's2' },
    ]);
  });

  it('matches replies to requests by id, whatever order they come back in', async () => {
    const { source, workers } = setup();
    const easy = source.next('easy');
    const medium = source.next('medium');
    // Requests: 1 easy, 2 easy spare, 3 medium, 4 medium spare. Answer the
    // medium first and the easy last.
    workers[0].answer(2);
    workers[0].answer(0);
    await expect(medium).resolves.toEqual(puzzleFor('medium', 's3'));
    await expect(easy).resolves.toEqual(puzzleFor('easy', 's1'));
  });

  it('hands out the spare at once, and starts another', async () => {
    const { source, workers } = setup();
    source.prefetch('easy');
    workers[0].answer();
    await flushMicrotasks();

    const puzzle = source.next('easy');
    // Already generated: no reply needed for this one.
    await expect(puzzle).resolves.toEqual(puzzleFor('easy', 's1'));
    expect(workers[0].requests).toEqual([{ id: 2, difficulty: 'easy', seed: 's2' }]);
  });

  it('waits for a spare still being generated rather than asking twice', async () => {
    const { source, workers } = setup();
    source.prefetch('medium');
    const puzzle = watch(source.next('medium'));
    // The spare plus the replacement for it — not a third request.
    expect(workers[0].requests.map(({ id }) => id)).toEqual([1, 2]);
    await flushMicrotasks();
    expect(puzzle.settled).toBe(false);
    workers[0].answer();
    await flushMicrotasks();
    expect(puzzle.settled).toBe(true);
  });

  it('keeps one spare per tier', () => {
    const { source, workers } = setup();
    source.prefetch('easy');
    source.prefetch('easy');
    source.prefetch('expert');
    expect(workers[0].requests.map(({ difficulty }) => difficulty)).toEqual(['easy', 'expert']);
  });

  it('rejects when the worker reports that generation failed', async () => {
    const { source, workers } = setup();
    const puzzle = source.next('easy');
    workers[0].answer(0, { id: 1, error: 'boom' });
    await expect(puzzle).rejects.toThrow('boom');
  });

  it('forgets a failed spare, so the next request starts afresh', async () => {
    const { source, workers } = setup();
    source.prefetch('easy');
    // Nobody is waiting on the spare yet; its failure must not surface as an
    // unhandled rejection (vitest fails the run if it does).
    workers[0].answer(0, { id: 1, error: 'boom' });
    await flushMicrotasks();

    const puzzle = source.next('easy');
    expect(workers[0].requests.map(({ id }) => id)).toEqual([2, 3]);
    workers[0].answer();
    await expect(puzzle).resolves.toEqual(puzzleFor('easy', 's2'));
  });

  it('keeps the replacement when a spare already handed out fails', async () => {
    const { source, workers } = setup();
    source.prefetch('easy');
    // Handed out (request 1), with a replacement spare started (request 2).
    const handedOut = source.next('easy');
    workers[0].answer(0, { id: 1, error: 'boom' });
    await expect(handedOut).rejects.toThrow('boom');

    // The failure belonged to the old spare; the new one is still the spare.
    const puzzle = source.next('easy');
    workers[0].answer();
    await expect(puzzle).resolves.toEqual(puzzleFor('easy', 's2'));
  });

  it('generates the puzzle a given seed deals, with no spare before or after it', async () => {
    const { source, workers } = setup();
    const puzzle = source.generate('hard', 'daily/2026-10-06/hard');
    expect(workers[0].requests).toEqual([
      { id: 1, difficulty: 'hard', seed: 'daily/2026-10-06/hard' },
    ]);
    workers[0].answer();
    await expect(puzzle).resolves.toEqual(puzzleFor('hard', 'daily/2026-10-06/hard'));

    // Nor is a spare handed out for it.
    source.prefetch('hard');
    void source.generate('hard', 'other');
    expect(workers[0].requests.map(({ seed }) => seed)).toEqual(['s1', 'other']);
  });

  it('ignores a reply it is not waiting for', () => {
    const { source, workers } = setup();
    void source.next('easy');
    expect(() => workers[0].deliver({ id: 99, error: 'stray' })).not.toThrow();
  });
});

describe('createPuzzleSource falling back to the main thread', () => {
  it('generates a beat later when there is no worker, so a spinner can paint first', async () => {
    vi.useFakeTimers();
    const source = createPuzzleSource({ createWorker: () => null, seed: counterSeeds() });
    const promise = source.next('easy');
    const puzzle = watch(promise);
    await flushMicrotasks();
    expect(puzzle.settled).toBe(false);

    vi.advanceTimersByTime(0);
    await expect(promise).resolves.toEqual(puzzleFor('easy', 's1'));
  });

  it('generates a given seed on the main thread too', async () => {
    vi.useFakeTimers();
    const source = createPuzzleSource({ createWorker: () => null, seed: counterSeeds() });
    const promise = source.generate('easy', 'daily/2026-10-06/easy');
    vi.advanceTimersByTime(0);
    await expect(promise).resolves.toEqual(puzzleFor('easy', 'daily/2026-10-06/easy'));
  });

  it('prefetches on the main thread too', async () => {
    vi.useFakeTimers();
    const source = createPuzzleSource({ createWorker: () => null, seed: counterSeeds() });
    source.prefetch('easy');
    vi.advanceTimersByTime(0);
    await flushMicrotasks();
    await expect(source.next('easy')).resolves.toEqual(puzzleFor('easy', 's1'));
  });

  it('hands everything the worker held to the main thread when it fails', async () => {
    vi.useFakeTimers();
    const { source, workers } = setup();
    const easy = source.next('easy');
    const hard = source.next('hard');

    const event = workers[0].fail();
    // Handled, so the browser need not report it as uncaught as well.
    expect(event.defaultPrevented).toBe(true);
    expect(workers[0].isTerminated).toBe(true);

    vi.advanceTimersByTime(0);
    // Same seeds as the worker was given, so the same puzzles.
    await expect(easy).resolves.toEqual(puzzleFor('easy', 's1'));
    await expect(hard).resolves.toEqual(puzzleFor('hard', 's3'));
  });

  it('does not try the worker again once it has failed', async () => {
    vi.useFakeTimers();
    const { source, workers, createWorker } = setup();
    void source.next('easy');
    workers[0].fail();
    vi.advanceTimersByTime(0);
    await flushMicrotasks();

    const later = source.next('medium');
    vi.advanceTimersByTime(0);
    await expect(later).resolves.toEqual(puzzleFor('medium', 's3'));
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(workers[0].requests.map(({ id }) => id)).toEqual([1, 2]);
  });

  it('treats a reply that could not be deserialised as a failed worker', async () => {
    vi.useFakeTimers();
    const { source, workers } = setup();
    const puzzle = source.next('easy');
    workers[0].onmessageerror!(new MessageEvent('messageerror'));
    expect(workers[0].isTerminated).toBe(true);
    vi.advanceTimersByTime(0);
    await expect(puzzle).resolves.toEqual(puzzleFor('easy', 's1'));
  });

  it('never fails over because of a worker it has already let go of', () => {
    const { source, workers } = setup();
    void source.next('easy');
    source.dispose();
    void source.next('easy');
    // The old worker's last gasps must not take its replacement down.
    workers[0].fail();
    workers[0].onmessageerror!(new MessageEvent('messageerror'));
    expect(workers[1].isTerminated).toBe(false);
    void source.next('hard');
    expect(workers[1].requests.map(({ difficulty }) => difficulty)).toContain('hard');
  });
});

describe('createPuzzleSource.dispose', () => {
  it('stops the worker and leaves pending requests unsettled', async () => {
    const { source, workers } = setup();
    const puzzle = watch(source.next('easy'));
    source.dispose();
    expect(workers[0].isTerminated).toBe(true);

    // A reply that slips out anyway is dropped, not delivered to a caller
    // that has gone.
    workers[0].answer();
    await flushMicrotasks();
    expect(puzzle.settled).toBe(false);
  });

  it('cancels main-thread work still waiting for its turn', async () => {
    vi.useFakeTimers();
    const source = createPuzzleSource({ createWorker: () => null });
    const puzzle = watch(source.next('easy'));
    source.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    await flushMicrotasks();
    expect(puzzle.settled).toBe(false);
  });

  it('drops the spares, which belonged to the stopped worker', () => {
    const { source, workers } = setup();
    source.prefetch('easy');
    source.dispose();
    void source.next('easy');
    // A fresh request to a fresh worker, not a wait on a spare that will
    // never arrive.
    expect(workers[1].requests).toEqual([
      { id: 2, difficulty: 'easy', seed: 's2' },
      { id: 3, difficulty: 'easy', seed: 's3' },
    ]);
  });

  it('can carry on afterwards, as StrictMode needs', async () => {
    // StrictMode runs an effect's cleanup and then the effect again on mount,
    // so a source disposed in a cleanup is used again straight away.
    const { source, workers, createWorker } = setup();
    void source.next('easy');
    source.dispose();
    const puzzle = source.next('easy');
    expect(createWorker).toHaveBeenCalledTimes(2);
    workers[1].answer();
    // s1 and s2 went to the first worker's request and spare.
    await expect(puzzle).resolves.toEqual(puzzleFor('easy', 's3'));
  });
});

describe('createPuzzleSource defaults', () => {
  it('starts the real module worker from the bundled script where Worker exists', () => {
    const constructed: [URL, WorkerOptions | undefined][] = [];
    class StubWorker extends FakeWorker {
      constructor(url: URL, options?: WorkerOptions) {
        super();
        constructed.push([url, options]);
      }
    }
    vi.stubGlobal('Worker', StubWorker);

    void createPuzzleSource().next('easy');
    expect(constructed).toHaveLength(1);
    const [url, options] = constructed[0];
    // Vite rewrites the URL as it bundles the script (in tests too, which is
    // what proves the `new Worker(new URL(…))` shape is still one it spots).
    expect(url.pathname).toMatch(/\/worker\/generate\.worker\.ts$/);
    expect(options).toEqual({ type: 'module' });
  });

  it('draws a random seed for each request', () => {
    const workers: FakeWorker[] = [];
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor() {
          super();
          workers.push(this);
        }
      },
    );
    void createPuzzleSource().next('easy');
    const [first, second] = workers[0].requests;
    expect(first.seed).toMatch(/^[0-9a-z]{8}$/);
    expect(second.seed).not.toBe(first.seed);
  });

  it('falls back to the main thread when the worker cannot even be constructed', async () => {
    // A strict CSP, or a browser without module workers, throws right here.
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new DOMException('Refused', 'SecurityError');
        }
      },
    );
    vi.useFakeTimers();
    const puzzle = createPuzzleSource({ seed: () => 'fixed' }).next('easy');
    vi.advanceTimersByTime(0);
    await expect(puzzle).resolves.toEqual(puzzleFor('easy', 'fixed'));
  });

  it('generates on the main thread where there is no Worker at all, as in jsdom', async () => {
    expect(typeof Worker).toBe('undefined');
    vi.useFakeTimers();
    const puzzle = createPuzzleSource({ seed: () => 'fixed' }).next('medium');
    vi.advanceTimersByTime(0);
    await expect(puzzle).resolves.toEqual(puzzleFor('medium', 'fixed'));
  });
});
