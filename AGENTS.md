# Project instructions

## Git branch safety

- Never create commits directly on the `prod` branch.
- Before making changes or creating commits, verify the active branch. Work and commit on `test` or on a dedicated feature/fix branch, then promote changes to `prod` only through the agreed release workflow.

## Documentation

- Write all source-code comments and JSDoc in English.
- Add explanatory comments or JSDoc for non-trivial logic, especially statistical calculations, data transformations, compatibility decisions, and boundary conditions. Explain the reasoning and invariants, not merely what the syntax does.
- Write all Markdown documentation in English.
- Treat comments and JSDoc beside the source code as the detailed source of truth for functions, parameters, return values, limits, side effects, and implementation behavior.
- Keep Markdown documentation high-level and stable: describe architecture, responsibilities, configuration, workflows, and policies.
- Do not duplicate function inventories, line numbers, signatures, or volatile implementation details in Markdown when the source code already documents them.
- When implementation behavior changes, update the source comments/JSDoc first. Update Markdown only when a stable architectural, configuration, workflow, identity, formatting, or failure-policy change also occurred.

## Dependency safety

- Before installing a new package or dependency, verify that its release is at least one month old.
- Do not install a package released less than one month ago without explicit user approval.

## Filter interaction

- Text and numeric list filters must not trigger a request on every keystroke.
- Enter and the page's Refresh action must apply the current typed filter values and produce the same refresh behavior.
- Select, checkbox, and other non-text filters may apply immediately when changed.
