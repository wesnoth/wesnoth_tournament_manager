import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'https://tournament-test.wesnoth.org';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      testMatch: /.*\.spec\.ts/,
      // Replay-pipeline specs need the local stack and its forum tables.
      testIgnore: /replay-pipeline\//,
    },
    {
      // Real replay pipeline against the local stack (backend + frontend on
      // localhost, MariaDB instance from localdatabase/). Public pages only,
      // so no stored login. The replay fixtures share players (and their ELO),
      // so run serially: npx playwright test --project=local-replays --workers=1
      name: 'local-replays',
      testMatch: /replay-pipeline\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_LOCAL_BASE_URL || 'http://localhost:5173',
      },
    },
  ],
});
