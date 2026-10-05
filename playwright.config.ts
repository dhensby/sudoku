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
      // reproduces iOS pointer behaviour and its share/clipboard quirks.
      name: 'iphone',
      use: { ...devices['iPhone 15'] },
      testMatch: /touch\.spec\.ts/,
    },
    {
      // The same touch suite on Android Chrome, which reports a different
      // viewport and fires `contextmenu` from a long press.
      name: 'android',
      use: { ...devices['Pixel 7'] },
      testMatch: /touch\.spec\.ts/,
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
