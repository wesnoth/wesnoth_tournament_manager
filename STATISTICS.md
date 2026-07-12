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

Balance-history snapshots are cumulative: a snapshot for a date includes eligible, non-cancelled matches recorded up to that date. The scheduled job creates the daily snapshot. Balance events provide before/after anchors, and the administrator maintenance action can clear and rebuild those anchors when historical data needs correction.

## Balance events

Administrators record buffs, nerfs, reworks, hotfixes, and general balance changes. Public statistics users can select an event to compare the cumulative snapshot immediately before and after it. If an older event has not yet been assigned snapshot markers, the system can temporarily use the legacy match-based calculation until the history is rebuilt.

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

The source code comments and JSDoc are the detailed source of truth for implementation behavior. This document describes the stable architecture and responsibilities only.
