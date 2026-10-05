import { respond, type GenerateRequest } from './protocol';

describe('generate.worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers every message with the protocol reply', async () => {
    // jsdom has no worker scope, so stand one in for `self` before the script
    // runs: it wires its handler up as a side effect of being loaded.
    const scope = {
      onmessage: null as ((event: { data: GenerateRequest }) => void) | null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', scope);
    await import('./generate.worker');

    const request: GenerateRequest = { id: 5, difficulty: 'easy', seed: 'worker' };
    scope.onmessage!({ data: request });
    expect(scope.postMessage).toHaveBeenCalledWith(respond(request));
  });
});
