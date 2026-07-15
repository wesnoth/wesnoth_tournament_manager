# Tournament Playwright Test Plan

This plan covers the complete tournament lifecycle through the test environment: creation, registration, preparation, start, match simulation, round progression, standings, and final completion. The scenarios use eight individual participants or eight teams and keep the naming convention `test_NNN_<mode>_<type>`.

## Execution Policy

- Run scenarios sequentially because they create persistent tournament data and exercise shared player state.
- Use only the test deployment. The simulator endpoints are unavailable in production.
- Authenticate interactively or through `E2E_USERNAME` and `E2E_PASSWORD`; credentials are never stored in the repository.
- The pilot reads eight real nicknames from `/players` with `Ranked enabled` active; use `E2E_PLAYER_NAMES` with eight comma-separated nicknames to pin a specific set.
- Team scenarios must also select real player nicknames from `/players`, then group them into eight teams through the team form; team names are not player identities.
- Keep the browser-visible checks as the acceptance source. API/database inspection may diagnose failures but does not replace UI assertions.
- Use `E2E_TOURNAMENT_NAME` to override a name when rerunning a scenario after a partial failure.

## Scenario Matrix

| ID | Mode | Format | Participants | Expected lifecycle | Status |
| --- | --- | --- | --- | --- | --- |
| `test_001_ranked_elimination` | Ranked | Elimination | 8 players | 4 → 2 → 1 | Pilot implemented |
| `test_002_ranked_league` | Ranked | League | 8 players | All league rounds open together, then standings | Planned |
| `test_003_ranked_swiss` | Ranked | Swiss | 8 players | Swiss rounds with tiebreakers and rematches avoided | Planned |
| `test_004_ranked_swiss_elimination` | Ranked | Swiss-Elimination | 8 players | Swiss qualification followed by elimination | Planned |
| `test_005_unranked_elimination` | Unranked | Elimination | 8 players | 4 → 2 → 1, no ELO changes | Planned |
| `test_006_unranked_league` | Unranked | League | 8 players | Concurrent league rounds and final standings | Planned |
| `test_007_unranked_swiss` | Unranked | Swiss | 8 players | Swiss rounds and tiebreakers without ELO | Planned |
| `test_008_unranked_swiss_elimination` | Unranked | Swiss-Elimination | 8 players | Qualification and elimination phases | Planned |
| `test_009_teams_elimination` | Teams | Elimination | 8 teams | 4 → 2 → 1, two members per team | Planned |
| `test_010_teams_league` | Teams | League | 8 teams | Concurrent league rounds and team standings | Planned |
| `test_011_teams_swiss` | Teams | Swiss | 8 teams | Swiss pairing and team tiebreakers | Planned |
| `test_012_teams_swiss_elimination` | Teams | Swiss-Elimination | 8 teams | Team qualification and elimination phases | Planned |

## Pilot Assertions

The first scenario creates an eight-player ranked elimination tournament with BO1 rounds, adds all participants through `Simulate Join`, closes registration, prepares and starts the tournament, simulates every open series through `Simulate Match`, starts each pending round, and verifies the final tournament status. It also verifies the visible participant and round counts along the way.

The remaining scenarios should reuse the same lifecycle helpers but vary format-specific configuration and assertions for league concurrency, Swiss tiebreakers, hybrid qualification, team labels, and ranked versus unranked statistics.

## Result Tracking

After each deployment run, replace `Planned` or `Pilot implemented` with `Passed`, `Failed`, or `Blocked`, and record the failure in the test report and the corresponding issue or code change. Do not mark a scenario passed from database output alone.
