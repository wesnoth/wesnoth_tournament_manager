# Project instructions

## Git branch safety

- Never create commits directly on the `prod` branch.
- Before making changes or creating commits, verify the active branch. Work and commit on `test` or on a dedicated feature/fix branch, then promote changes to `prod` only through the agreed release workflow.

## Documentation

- Write all source-code comments and JSDoc in English.
- Write all Markdown documentation in English.
- Treat comments and JSDoc beside the source code as the detailed source of truth for functions, parameters, return values, limits, side effects, and implementation behavior.
- Keep Markdown documentation high-level and stable: describe architecture, responsibilities, configuration, workflows, and policies.
- Do not duplicate function inventories, line numbers, signatures, or volatile implementation details in Markdown when the source code already documents them.
- When implementation behavior changes, update the source comments/JSDoc first. Update Markdown only when a stable architectural, configuration, workflow, identity, formatting, or failure-policy change also occurred.
