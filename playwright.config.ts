import { defineConfig, devices } from '@playwright/test';
import { localStack } from './e2e/support/localStack';

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
      // Refuses the local-stack projects below unless E2E_LOCAL_STACK=1 and
      // their URLs are loopback (e2e/support/localStack.ts, assertLocalStack).
      name: 'local-stack-guard',
      testMatch: /support\/localStack\.guard\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      testMatch: /.*\.spec\.ts/,
      // Replay-pipeline and lifecycle specs need the local stack.
      testIgnore: /(replay-pipeline|tournament-lifecycle)\//,
    },
    {
      // Real replay pipeline against the local stack (backend + frontend on
      // localhost, MariaDB instance from localdatabase/). Public pages only,
      // so no stored login. The replay fixtures share players (and their ELO),
      // so run serially: npx playwright test --project=local-replays --workers=1
      name: 'local-replays',
      dependencies: ['local-stack-guard'],
      testMatch: /replay-pipeline\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: localStack.frontendUrl,
      },
    },
    {
      // Tournament lifecycle through the UI's own API calls against the local
      // stack (backend on localhost and the MariaDB instance it uses). No
      // browser page is opened; every request is checked against the frontend
      // endpoint catalog (scripts/check-ui-api-contract.mjs). Scenarios share
      // players, so run serially: npm run verify:lifecycle
      name: 'tournament-lifecycle',
      dependencies: ['local-stack-guard'],
      testMatch: /tournament-lifecycle\/.*\.spec\.ts/,
    },
  ],
});
