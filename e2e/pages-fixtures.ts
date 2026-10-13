import { test as base } from '@playwright/test';
import { buildForPages, newVersionOf, startPages, type PagesServer } from './pages-server';

export { expect } from '@playwright/test';

/**
 * Specs served from a stand-in for GitHub Pages (see pages-server.ts) rather
 * than `vite preview`: the app under /sudoku/, which a test can deploy
 * another build to.
 */

interface Builds {
  /** The app, as the deploy builds it. */
  app: string;
  /** The next deploy of it: a new version, whose page is stamped "v2". */
  next: string;
}

export const test = base.extend<{ pages: PagesServer }, { builds: Builds }>({
  builds: [
    // Playwright reads a fixture's dependencies from this pattern, so it must
    // be one, even with nothing in it.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const app = `${workerInfo.project.outputDir}/pages-app-${workerInfo.workerIndex}`;
      const next = `${workerInfo.project.outputDir}/pages-next-${workerInfo.workerIndex}`;
      await buildForPages(app);
      newVersionOf(app, next, 'v2');
      await use({ app, next });
    },
    { scope: 'worker' },
  ],
  pages: async ({ builds }, use) => {
    const pages = await startPages(builds.app);
    await use(pages);
    await pages.stop();
  },
});
