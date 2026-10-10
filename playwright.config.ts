import { createHash } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

// Each checkout serves its build on a port of its own, picked from where it
// lives, so the suite can run in several git worktrees at once without one run
// finding another's server. The range sits below every OS's ephemeral ports,
// which other servers are handed when they ask for any free port.
// PLAYWRIGHT_PORT chooses one instead, should two checkouts ever collide.
function checkoutPort(): number {
  const hash = createHash('sha256')
    .update(import.meta.dirname)
    .digest();
  return 20_000 + (hash.readUInt32BE() % 10_000);
}

const PORT = Number(process.env.PLAYWRIGHT_PORT) || checkoutPort();
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Two workers in CI: a trial there, running every test three times with one
  // worker and with two, found none that needed a retry either way, and two
  // made the Chromium projects about a quarter faster. WebKit is held to one
  // at a time (see the iPhone project). Locally, Playwright picks.
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Desktop Chrome has `hasTouch: false`, so every `tap()` in the touch
      // spec would throw here. Touch coverage belongs to the phone projects.
      testIgnore: /touch\.spec\.ts/,
    },
    {
      // Safari is where most phones play, and WebKit is the only engine that
      // reproduces iOS pointer behaviour and its share/clipboard quirks. The
      // accessibility spec has a phone pass of its own, for the phone layout.
      name: 'iphone',
      use: { ...devices['iPhone 15'] },
      testMatch: /(touch|a11y)\.spec\.ts/,
      // One WebKit keeps a CI runner's CPUs busy on its own: with two at once,
      // each test took twice as long, so they finished no sooner, only closer
      // to their timeouts. Held to one, it runs beside the Chromium projects.
      ...(process.env.CI ? { workers: 1 } : {}),
    },
    {
      // The same touch suite on Android Chrome, which reports a different
      // viewport and fires `contextmenu` from a long press.
      name: 'android',
      use: { ...devices['Pixel 7'] },
      testMatch: /(touch|a11y)\.spec\.ts/,
    },
  ],
  // Build once, then serve the production bundle so e2e exercises the real
  // artifact. `base` defaults to "/" here (VITE_BASE is only set for Pages).
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: baseURL,
    // Never test whatever is already on the port: it may be serving an old
    // build, and whoever started it can stop it mid-run. A server there is a
    // clash, and fails the run before it starts.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
