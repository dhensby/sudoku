import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The Pages deploy sets VITE_BASE (e.g. "/sudoku/"). Locally and for
// preview/e2e we serve from the root.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  // Puzzle generation runs in a module worker so the board never stutters
  // while a Hard grid is being dug out.
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Vitest's 5s default is too close for the heaviest jsdom tests on a CI
    // runner under coverage: rendering a thousand-row History or walking a
    // whole App through Show me took 3.8–4s there. The engine's big sweeps set
    // their own, longer limits.
    testTimeout: 15_000,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/**/*.d.ts',
        // Type-only declarations and re-export barrels have no runtime logic.
        'src/**/types.ts',
        'src/**/index.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
        // The pure engine is the heart of the game — hold it to 100%.
        'src/core/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
