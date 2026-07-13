# Testing Policy

The repository currently relies on TypeScript compilation and production builds as its automated local verification baseline:

```bash
cd backend && npm run build
cd frontend && npx tsc --noEmit && npm run build
```

## Integration Test Requirements

Integration and end-to-end tests must reflect the production identity and match-ingestion models:

- Users authenticate against a phpBB forum database and receive an application profile on their first successful login.
- Tests must not create application-only users or bypass forum identity.
- Ranked matches enter the application through replay processing and confirmation. Tests must not depend on the removed manual match-reporting flow.
- Tournament registration must use the request and organizer-acceptance workflow.
- Test data must use an isolated forum and tournament database. Credentials, database exports, generated replays, reports, screenshots, and traces must remain untracked.

The previous local-user tournament runners and notification Playwright suite were removed because they exercised retired routes and identity assumptions. A replacement suite should be introduced only with forum-backed fixtures and replay-pipeline coverage.
