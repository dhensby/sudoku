import { respond, type GenerateRequest, type GenerateResponse } from './protocol';

/*
 * The puzzle generator, off the main thread: digging out a Hard or Expert
 * grid can take tens of milliseconds, sometimes more, and the board must not
 * stutter while it does. Loaded as a module worker by
 * `createPuzzleSource`; all the work lives in `respond`, which is tested on
 * its own.
 */

/**
 * The slice of a dedicated worker's global scope this script uses. The
 * project's TypeScript lib is the DOM one, where `self` is a Window, so the
 * worker scope is described here rather than pulling in the conflicting
 * WebWorker lib for one handler.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<GenerateRequest>) => void) | null;
  postMessage(message: GenerateResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  scope.postMessage(respond(event.data));
};
