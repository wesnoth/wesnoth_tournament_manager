# E2E Test Documentation Index

This index describes the current end-to-end test documentation. Test assertions and selectors live in the executable files under `tests/e2e/`; Markdown documents provide stable testing guidance and scope.

## Notification coverage

The notification page test is:

- `tests/e2e/notifications-page.spec.ts`

It covers navigation, filters, notification rendering, read/unread actions, deletion, pagination, and authenticated access behavior.

Supporting material:

- [`NOTIFICATIONS_DOCUMENTATION.md`](NOTIFICATIONS_DOCUMENTATION.md) — high-level implementation overview.
- [`tests/e2e/README.md`](tests/e2e/README.md) — notification test-suite usage.
- [`tests/e2e/NOTIFICATIONS_TEST_GUIDE.md`](tests/e2e/NOTIFICATIONS_TEST_GUIDE.md) — manual execution guidance.
- [`tests/e2e/VALIDATION_RESULTS.md`](tests/e2e/VALIDATION_RESULTS.md) — latest validation notes.

## Running the notification test

From the repository root:

```bash
npm run test:e2e:notifications
```

The test environment must provide the configured test user and running frontend/backend services expected by the Playwright configuration.

## Documentation policy

Keep implementation details in source comments/JSDoc and keep Markdown at a high level. Update test assertions with the test code when selectors or behavior change; update the overview documents only when the system architecture or supported test scope changes. All source comments and Markdown must be written in English.
