# Statistics

The application exposes several related statistics systems. They use different source tables and update schedules, so they should not be treated as interchangeable views of the same calculation.

## Site-wide statistics

The global statistics cache contains high-level activity totals, including users, ranked matches, tournament matches, and tournaments over daily, weekly, monthly, yearly, and all-time periods. The scheduler refreshes this cache periodically so public dashboard requests do not run the full aggregate queries each time.

## Faction and map balance

The balance statistics describe match outcomes by:

- faction;
- map;
- opponent faction;
- side number;
- games, wins, losses, and winrate.

The current aggregate table is used for live faction, map, and matchup views. The statistics page presents these views as faction balance, map balance, matchup analysis, and faction-versus-faction analysis.

### Faction perspectives and match counts

Balance rows are stored from the perspective of one faction in one match. Every eligible match contributes two rows: one for the winning faction and one for the losing faction. Each perspective has its own faction, opponent faction, side, games, wins, and losses.

This representation is intentional: it makes faction and side winrates directly queryable. It also means that summing `total_games` across all faction perspectives counts each real match twice. A page that reports real matches must therefore normalize the perspective total, while faction-level games and wins remain the values for that faction's perspective. Map totals use the same normalization. The frontend and backend must not mix perspective-game counts with real-match counts in the same label.

All non-cancelled rows in `matches` are eligible for ranked statistics. The `matches` table is the source of truth for ranked matches, including ranked tournament matches; `tournament_id` only identifies an optional tournament relationship. Statistics must not use the legacy `tournament_mode` or `tournament_type` columns as an eligibility filter.

Minimum-game thresholds are display and sample-size criteria, not snapshot criteria. Recalculating snapshots always processes all eligible non-cancelled matches. A tab may apply a minimum after aggregation, and live aggregate endpoints may apply the same threshold in SQL. Changing the threshold must not change historical snapshot contents.

Balance-history snapshots are cumulative: a snapshot for a date includes eligible, non-cancelled matches with `DATE(created_at)` on or before that date. The scheduler creates the normal daily snapshot. The administrator's full recalculation clears and rebuilds the historical snapshot table from `matches`, so it is also the repair path for corrected historical data.

### Balance-event date boundaries

Balance-event analysis uses the event dates as chronological boundaries. Event dates must be unique. For an event `E`:

- `before` is the interval after the previous event and through `E`'s date. If there is no previous event, it starts at the earliest available statistics date.
- `after` starts on the day after `E` and ends on the next event's date. If there is no next event, it ends on the latest available non-cancelled match date.

For example, with events `F` on day 31 and `M` on day 60, `F` compares days 1–31 against days 32–60, while `M` compares days 32–60 against days 61–365. The same matches are never included in both sides of one event comparison, and adjacent event comparisons use the same shared interval.

The implementation obtains these intervals by subtracting cumulative snapshots: the current event boundary minus the previous event boundary gives `before`, and the next boundary minus the current event boundary gives `after`. The `snapshot_before_date` and `snapshot_after_date` columns on `balance_events` record the dates materialized by the maintenance process; the event-date ordering and cumulative snapshot contents define the analytical interval.

## Balance events

Administrators record buffs, nerfs, reworks, hotfixes, and general balance changes. Public statistics users can select an event to compare the interval since the previous event with the interval until the next event. The administrator maintenance action can clear and rebuild the event boundary snapshots when historical data needs correction.

Balance-event creation, editing, and full historical recalculation are administrator-only operations. Regular users cannot request arbitrary snapshot generation. The rebuild reads application match, faction, map, and event data and writes derived rows to `faction_map_statistics_history`; it does not write to forum database tables.

The scheduled statistics job creates the normal daily cumulative snapshot. The protected administrator recalculation clears the event snapshot markers and historical snapshot rows before rebuilding all required event boundaries. This operation is the supported correction path when historical match data or event metadata has been repaired.

## Player statistics

Player statistics are rebuilt from non-cancelled matches into dedicated aggregate records. The player views support:

- global performance;
- performance by map;
- performance by faction;
- faction-versus-faction matchups;
- head-to-head performance against another player;
- map-specific and faction-specific combinations;
- recent opponents.

Player aggregates also retain the player side, winrate, and average ELO change where applicable. Minimum-game filters prevent small samples from being presented as reliable comparisons.

## Update and consistency rules

Live balance aggregates and player aggregates are maintained separately because they answer different questions. A change to one calculation must be checked against its scheduler, administrative rebuild operation, API route, and frontend consumer before release.

Derived statistics exclude cancelled matches. Historical correction should be performed through the protected administrator maintenance workflow, followed by a review of the affected statistics page and event comparisons.

When changing a balance calculation, verify these invariants: every non-cancelled ranked match contributes exactly two faction perspectives; perspective totals normalize to the expected number of real matches; cumulative snapshots are monotonic; and adjacent balance-event intervals neither overlap nor leave a date gap.

The source code comments and JSDoc are the detailed source of truth for implementation behavior. This document describes the stable architecture and responsibilities only.
