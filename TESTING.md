# Testing Policy

The project does not use hosted CI. Verification runs locally through one command, from the repository root:

```bash
npm run verify
```

It checks i18n parity (every locale has the English keys and interpolation variables), type-checks the frontend, compiles the backend with its unit tests into a scratch directory, and runs the unit tests, the tournament-engine self-test, and the group-progression harness. It takes a few seconds and stops at the first failure.

Backend unit tests are `*.test.ts` files next to the code, run with Node's built-in runner (`node:test`) and excluded from the production build. Replay parser tests use real replays stored by Wesnoth version in `backend/test-fixtures/replay-samples/`, each with the forum rows wesnothd recorded for it; add samples for a new Wesnoth or Ranked add-on version next to the old ones.

A versioned pre-push hook runs the same command before every push. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

`git push --no-verify` skips it in an emergency.

## Integration Test Requirements

Integration and end-to-end tests must reflect the production identity and match-ingestion models:

- Users authenticate against a phpBB forum database and receive an application profile on their first successful login.
- Tests must not create application-only users or bypass forum identity.
- Ranked matches enter the application through replay processing and confirmation. Tests must not depend on the removed manual match-reporting flow.
- Tournament registration must use the request and organizer-acceptance workflow.
- Test data must use an isolated forum and tournament database. Credentials, database exports, generated replays, reports, screenshots, and traces must remain untracked.

The previous local-user tournament runners and notification Playwright suite were removed because they exercised retired routes and identity assumptions.

The replay-pipeline suite (`e2e/replay-pipeline`, Playwright project `local-replays`) follows these rules. It runs against the local stack: a local MariaDB instance with forum fixtures, the backend, and the frontend. It drives real forum sync and replay parsing, and covers ranked and tournament integration, concurrent confirmations, failure paths injected through temporary database triggers, and statistics snapshot publication. It takes about twenty minutes, so it is not part of the push gate:

```bash
npm run verify:e2e
```

The tournament suite (`e2e/tournaments`, Playwright project `chromium`) runs against the deployed TEST site only, because it uses the tournament simulation tools that production does not expose. Scenarios run sequentially, authenticate through `E2E_USERNAME`/`E2E_PASSWORD` or interactively, pick real players from `/players`, and treat browser-visible results as the acceptance source; database inspection only helps diagnose failures.

The local replay suite needs these backend overrides besides the database ports: `WESNOTH_VERSION` matching the fixtures, `TOURNAMENT_SIMULATION=on`, `TOURNAMENT_CREATION_RATE_LIMIT_MAX=100`, and `RATE_LIMIT_LOGIN_MAX=1000` (see `e2e/support/localStack.ts`).
