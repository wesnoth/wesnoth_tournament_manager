import { test as guard } from '@playwright/test';
import { assertLocalStack } from './localStack';

// Dependency of the local-replays and tournament-lifecycle projects: when it
// fails, Playwright runs none of their specs, so a mistaken run on a server
// stops before any fixture is written. See assertLocalStack for the rules.
guard('local stack opt-in and loopback URLs', () => {
  assertLocalStack();
});
