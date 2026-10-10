import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serialise in CI for stable timers; let Playwright pick locally.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  // In CI each project runs in a job of its own, side by side with the
  // others, so a new one needs an entry in the e2e job's matrix in
  // .github/workflows/ci.yml as well, naming the engine its device runs on;
  // CI fails until it has one.
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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
