# Rankings

The public rankings page (`/rankings`) presents the global ranked-player leaderboard. It is a read-only public surface and does not require authentication; player names link to the signed-in user's own view when applicable, or to the public player profile otherwise.

## Responsibilities

- Apply the ranking eligibility policy defined by the backend, including active, unblocked, rated players with the minimum rating and match history.
- Provide deterministic server-side pagination and sorting for the leaderboard.
- Calculate and display summary statistics derived from the returned player records, including win percentage and the stored trend indicator.
- Allow nickname and ELO range filters without issuing requests while the user is still typing.

Text and numeric filters are applied with Enter or Refresh. Reset clears the draft and applied filters. Sorting and pagination request the selected result set from the backend, and the backend applies filters before pagination.

## Boundaries

Ranking eligibility and query ordering are backend responsibilities. The frontend must not recreate the full ranking dataset or infer eligibility from a partial page. Profile navigation and shared player-area navigation are described in [PLAYERS_AND_USERS_DOCUMENTATION.md](PLAYERS_AND_USERS_DOCUMENTATION.md).
