# Tournament guided configuration and direct advancement plan

## Purpose and scope

This document turns the agreed tournament-configuration proposal into an implementation plan. The goal is an approachable workflow between templates and the advanced phase editor, without introducing a second competition model or changing the compiled tournament graph.

The initial delivery includes:

- Guided definition of phases and groups, using the existing phase formats and settings.
- Per-source-group qualification counts into the immediately following phase.
- Automatic generation of advancement mappings and proposed elimination seeds, which organizers can review and edit before preparation.
- Organizer-assigned direct passes (“golden passes”) that place a specific participant or team into a later phase.
- Backend validation, additive database changes, tests, and help instrumentation.

Out of scope for this delivery: selecting a fixed number of best performers across an entire phase, double elimination, changing competition results/progression after preparation, and replacing the advanced editor. Rankings across groups are deliberately not compared: qualification count is configured per group.

## Existing architecture to preserve

The phase engine already stores the declarative phase graph in `tournament_phases` and `tournament_phase_groups`. `tournament_advancement_rules` stores the concrete source-group rank to target-group seed mapping. During preparation, the compiler materializes entries, rounds, series, games, and slot provenance. The configurable format is editable only before preparation.

Templates and the advanced editor already save through `saveTournamentFormat` and use `TournamentFormatDefinition`. Guided mode must produce that same definition and use the same validation and save path. No guided-only format model, conversion pipeline, or alternate compiler should be introduced.

Relevant existing implementation includes `backend/src/tournament-engine/formatService.ts`, `backend/src/tournament-engine/competitionCompiler.ts`, `backend/src/tournament-engine/pairingAlgorithms.ts`, `backend/src/tournament-engine/formatValidator.ts`, tournament format routes, and the frontend tournament creation/format editor. This plan describes responsibilities, not a frozen file inventory.

## Product behavior

### Configuration modes

Keep three entry points:

1. **Templates** for fast setup.
2. **Guided configuration** for phase/group structure and automatic advancement setup.
3. **Advanced editor** for full control of mappings and technical settings.

All modes read and write the same declarative phase graph. Moving between modes must not silently discard or reinterpret saved settings. If the current graph cannot be represented by the guided controls, explain that and offer the advanced editor; do not simplify it destructively.

Guided mode exposes phase order/name, competition system, number of groups, relevant system settings (rounds, best-of, assignment/distribution), and qualification count per source group. Group names are generated from phase name and group number (for example, `Phase name — Group 1`) rather than independently edited in the guided UI. Advanced mode retains its existing ability to control the graph in detail.

### Per-group advancement and generated mappings

For each eligible group, the organizer chooses how many ranked entries advance to the next phase. If a later phase exists, the count must be at least one; zero qualifiers is invalid. This is explicitly **per group**, not “best N across the whole phase.” The UI should show the implied total, e.g. four groups × two qualifiers = eight advancing entries.

When the target phase is elimination, propose a bracket seed order that:

- includes exactly the selected number of ranks from each source group;
- avoids pairing entries from the same source group in the first round wherever the bracket size and qualifier distribution make that possible;
- gives deterministic, stable output for an unchanged configuration;
- handles non-power-of-two totals using the existing bracket/byes behavior;
- reports when the no-same-group-first-round preference cannot be satisfied, rather than claiming it was guaranteed.

The generated result is a proposal, not hidden behavior. Show the resulting source rank → target seed/group mappings in a review step. Organizers may edit individual mappings there; edits are persisted through the existing `tournament_advancement_rules` table. Regeneration after changing group counts, qualifier counts, or target structure must be explicit and must warn that it will replace the generated proposal and any edits it supersedes. Save must reject duplicate source ranks and duplicate target seeds with actionable validation; it must never silently renumber other rules.

The initial pairing objective is first-round group separation, not a global fairness optimizer. If several valid seedings exist, use a documented deterministic strategy (for example, snake distribution of ranks across target seeds, followed by swaps that reduce same-group pairings). Add exhaustive or property-based tests for supported small bracket sizes and group distributions before choosing/finalizing the algorithm.

### Direct advancement (“golden pass”)

An organizer may nominate an individual participant or a complete team for a later phase, with an optional target group and format-specific placement. In an elimination phase, the pass may target a bracket and a specific later-round position (for example, a place in the round of 16), not only a first-round seed. The UI and backend must describe and validate that placement in the target format's terms. An optional administrative note/reason is explanatory and does not affect competitive logic.

The organizer first enables direct-entry capacity on an eligible target phase and sets the number of reserved direct-entry slots. First phase is never eligible. Then, after participants/teams are available, the organizer assigns each reserved slot to a participant/team. The selection UI only offers eligible later phases with remaining capacity and valid groups. Preparation is blocked while enabled capacity is not filled exactly.

Direct entrants must not also qualify into the same target phase through an ordinary advancement mapping. Direct-entry capacity counts toward the target phase's total entrant/bracket capacity and may be mixed with mapped qualifiers. Validate the combined field against the target format; for example, six mapped qualifiers plus two direct entrants may fill an eight-entry elimination, while fourteen plus two may fill a sixteen-entry elimination. Multiple elimination brackets must each receive a valid count. The backend is authoritative for phase ordering, capacity, membership/acceptance, entity type, duplicates, group/bracket/round-position validity, placement conflicts, and the pre-preparation edit boundary. Once preparation begins, assignments and capacity are immutable through this workflow.

## Data model and migration proposal

Use additive schema changes. Preserve the existing generic advancement graph and compiled tables.

### 1. Per-group qualification configuration

Preferred minimal model: add nullable `advance_count` (positive small integer) to `tournament_phase_groups`. `NULL` means no guided automatic qualification configured for this source group. A configured value applies to the immediately following phase only. This keeps the setting naturally scoped to the group, matches the product decision, and leaves arbitrary advanced mappings in `tournament_advancement_rules` unchanged.

The field is declarative convenience/configuration; it is not a replacement for the concrete mapping rows. The server derives and stores those rows in `tournament_advancement_rules` before preparation. Validate that the source phase has a following phase, the count is feasible for the group/competition format, generated mappings fit target capacity, and all referenced source/target groups belong to this tournament and have the expected phase order.

Alternative to evaluate during schema review: a separate `tournament_group_advancement_settings` table. Use it only if qualification settings need multiple target phases or multiple policies per source group; neither is part of this initial scope. Avoid adding both the column and a redundant settings table.

### 2. Direct-entry group capacity

Add `direct_advancement_slots` (non-negative small integer, default 0) to `tournament_phase_groups`. Zero means direct entry is disabled for that group; a positive value reserves exactly that many nominations. Keeping capacity on the group/bracket lets the backend validate each bracket independently when a phase contains multiple elimination groups.

### 3. Direct-entry nomination on the tournament participant/team

The golden pass is a single tournament-specific property of a participant or team, not a collection of phase-entry assignments. Store its declarative fields on the existing tournament-owned participant/team row rather than introducing a parallel nomination table. Confirm the exact table names and mode-specific ownership in the current schema before implementation.

Add nullable fields, with equivalent semantics for individuals and teams:

- target group ID (NULL means no direct pass; the target phase is derived through this group);
- optional elimination round, series position, and slot number, all NULL for Swiss/round-robin or ordinary first-round seeding;
- optional organizer reason/note.

The participant/team row itself is the audit subject. If the application has an audit-event mechanism suitable for recording who changed these fields, use it for actor/history rather than adding assignment identity columns or a separate pass table. If there is no such mechanism, decide explicitly whether actor history is required for the first release; do not silently create a parallel assignment model.

Validate that the target group belongs to a later phase in the same tournament, that the individual/team belongs to the tournament and matches its mode, and that the chosen group or elimination bracket/round/position is valid and conflict-free. The group-level direct-entry capacity limits how many participant/team rows may nominate that group. Preparation resolves the nominated participant/team to its compiled `tournament_entry` and materializes exactly one ordinary row in `tournament_phase_entry_assignments` for the destination group. For an elimination pass into a later round, preparation must also materialize the required bracket-slot provenance/byes so the entrant is placed in that round without inventing a match in an earlier round. That assignment/slot structure is consumed by the competition compiler; the source participant/team fields remain the declarative golden-pass configuration.

Do not write one `tournament_phase_entry_assignments` row per participant ahead of preparation merely to represent the nomination: that table represents compiled group placement, and the golden pass is configured once on the participant/team. Preparation must avoid creating a duplicate assignment through ordinary qualification mappings and must roll back atomically if a direct pass cannot be resolved or materialized.

### Migration and schema deliverables

- One additive, timestamped migration for the selected participant/team and phase-group fields, constraints, indexes, and comments only if consistent with project SQL style. No dedicated direct-nomination table is planned.
- Matching updates to the canonical schema snapshot (`backend/src/config/schema.sql`).
- Migration tests/reviewer validation; prove existing tournaments default to no direct passes and no automatic group advancement.
- Document any MariaDB-version-specific constraint fallback and verify foreign-key collations/types match referenced columns.
- No data backfill should be necessary; all new behavior is opt-in.

## Backend work

### Format contract and validation

- Extend `TournamentFormatDefinition` and API schemas for per-group `advance_count` and direct-entry phase capacity, preserving backward-compatible defaults when fields are absent.
- Keep mapping generation as a deterministic domain service with a pure input/output boundary; avoid embedding bracket logic in route handlers.
- Add a preview/regenerate operation or derive the proposal client-side only if the exact same tested algorithm is shared safely. Preferred: backend owns generation and validation so preview, save, and preparation cannot disagree.
- Keep generated/edited concrete rules in the current `tournament_advancement_rules` contract.
- Ensure all writes remain transactional and lock the tournament row as existing format writes do.
- Preserve the pre-preparation immutability boundary.

### Direct-entry APIs and preparation

- Extend authorized participant/team editing and read endpoints with the direct-pass fields, following existing route conventions.
- Validate nominated identity belongs to the tournament and has accepted/eligible status; validate individual-vs-team mode and exactly-one identity.
- Enforce phase is later than phase 1, capacity is enabled and not exceeded, target group/bracket/round position belongs to the target phase, placement is legal and unique, nomination is not duplicated, and nomination does not conflict with a normal qualification route.
- Include a read endpoint returning configured capacity, assigned count, eligible phases/groups, and outstanding slots for the UI.
- Preparation transaction checks every enabled capacity is exactly filled, then resolves nominations into entries/phase assignments before compiling target rounds. Roll back the entire preparation on any resolution or uniqueness error.
- Keep the declarative fields and reason available for readback after preparation; no post-preparation mutation endpoint. Record the acting organizer through the existing audit mechanism if supported/required.

### Tests

- Unit tests for generated mappings, repeatability, no-same-source-group first-round behavior, impossible distributions, byes, and manual overrides.
- Format validation/API tests for missing or invalid next phase, over-qualification, target capacity, duplicate source-rank/target-seed, cross-tournament IDs, and malformed payloads.
- Direct-entry tests for individual and team modes, duplicates, ineligible/unaccepted entries, first-phase rejection, full/disabled capacity, group/bracket/round-position conflicts, conflict with normal qualification, incomplete capacity at preparation, later-round entry/byes, successful compilation, rollback, and post-preparation immutability.
- Regression tests that templates and advanced editor payloads without the new fields continue to work.

## Frontend work

- Add a mode choice or entry point for Guided configuration while keeping Templates and Advanced editor available.
- Build a guided phase/group editor reusing existing controls/components where possible. Keep group labels generated from phase/group order in guided mode.
- Add per-group “advance N from this group” controls, total-qualified summary, and clear explanation that counts are per group.
- Add a generated-mapping preview for the next phase. Visually flag same-source-group first-round pairings if any remain; allow manual edits in the preview without silently shifting another rule.
- Add explicit regenerate action with confirmation when manual edits would be replaced.
- Add direct-entry capacity controls on eligible later phases and a participant/team assignment panel with target phase, optional group or elimination bracket/round position, and optional reason.
- Show assigned/required slot counts and block/guide the user before preparation if there are unfilled slots.
- Display backend validation adjacent to affected phase, group, rule, or participant row; do not mutate other values to hide conflicts.
- Preserve shared authenticated navigation/layout and add semantic `data-help-id` hooks to all new or functionally changed editable/actionable controls. Add documentation region hooks only for substantial editors/previews.
- Ensure changes to phase/group count keep IDs and associations stable where possible; when unavoidable, explain and confirm removal of affected mappings/nominations rather than silently deleting them.

## Delivery sequence

1. **Confirm design:** inspect participant/team tables, preparation flow, existing phase-editor UX, supported MariaDB version and migration conventions; settle nomination references, seed semantics, group/phase capacity rules, and the pairing algorithm.
2. **Algorithm first:** implement/test pure per-group mapping generation and deterministic bracket distribution; review edge cases before wiring persistence.
3. **Schema + contracts:** add opt-in migration and schema snapshot updates; extend shared backend types/validators with backward-compatible defaults.
4. **Backend format workflow:** preview/save generated mappings through existing graph; enforce transactional integrity and advanced-editor compatibility.
5. **Direct-entry backend:** assignment CRUD/read model, capacity checks, preparation resolution, audit preservation, and tests.
6. **Frontend guided workflow:** phase/group setup, generated mapping review/edit, direct-entry assignment, validation and help hooks.
7. **End-to-end verification:** create individual and team tournaments with template, guided, and advanced paths; test four groups × two qualifiers into elimination, groups represented apart in round one, direct entrants, incomplete capacity, and preparation rollback.
8. **Local review and release:** work only on `feature/tournament-guided-configuration`. Stop after local verification for the user's review. Do not push or merge to `test` or any other branch until the user has validated locally and explicitly authorized the action; then use the agreed release workflow. Never commit directly on `prod`.

## Decisions and remaining clarification

- **Decided:** A direct pass can target a specific group in a later phase. For elimination it can target a bracket and a specific later-round place, such as a slot in the round of 16; implementation must support the necessary bracket slot/byes.
- **Decided:** For multiple target groups, distribute qualifiers deterministically and as evenly as possible, keeping entries from the same source group apart in the first elimination round where feasible. Mappings remain reviewable.
- **Decided:** If there is a later phase, each source group must advance at least one entry; zero is invalid.
- **Decided:** Direct-pass slots count toward the target's total capacity and may be mixed with ordinary qualifiers. Validate the combined count against the target format, including each bracket where a phase has multiple elimination brackets (e.g. six qualifiers plus two passes for an eight-entry bracket).
- **Decided:** Regenerating after manual mapping edits requires explicit confirmation before replacing them.
- **Decided:** In Swiss and round-robin destinations, a direct pass chooses only the target group. Normal assignment rules determine initial order/position; organizers do not manually seed a direct entrant within that group in the initial version.

## Acceptance criteria

- An organizer can configure phases/groups in guided mode and save the same phase graph used by templates and advanced mode.
- Qualification counts are entered per source group; no cross-group “best N” selector exists.
- For four source groups with two qualifiers each into an eight-entry elimination, the preview creates eight valid rules and minimizes same-source-group first-round matchups; any unavoidable matchup is visible and explained.
- The organizer can revise generated mappings, save, reload, and see the same concrete rules.
- A participant/team can hold at most one direct-pass declaration, which is correctly materialized as one `tournament_phase_entry_assignments` row during preparation.
- Invalid, duplicate, ineligible, or incomplete direct assignments are rejected by the backend, and preparation remains atomic.
- Existing tournaments and template/advanced workflows are unaffected unless the new options are explicitly enabled.
