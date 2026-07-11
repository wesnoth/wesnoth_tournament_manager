# Replay Processing

This document is a high-level overview of replay discovery, parsing, confirmation, and match integration. The implementation comments and JSDoc are the authoritative source for parser behavior and state transitions.

## Pipeline

1. `SyncGamesFromForumJob` reads eligible game metadata from the forum database and creates replay records in the tournament database.
2. `ParseNewReplaysRefactored` processes queued records on the backend scheduler.
3. `ReplayParser` and `parseRankedReplay` extract game metadata, players, factions, map information, victory data, reloads, and addon flags from the replay.
4. The parser links valid tournament games to their tournament round match and either creates a match automatically or leaves the replay pending player confirmation.
5. Player confirmation routes create the final match and update tournament progression when the parser cannot determine the result with sufficient confidence.
6. The daily scheduler marks old, unconfirmed replays as `due`; due replays remain downloadable but cannot be confirmed.

## Data ownership

Replay records, parse summaries, and participant records are stored in the tournament database. The forum database is an external read-only source for game metadata and replay availability.

## Main states

- `new` / `processing`: queued or currently being parsed.
- `parsed`: parsed successfully and awaiting confirmation when confidence is insufficient for automatic integration.
- `completed`: integrated into a match or automatically confirmed.
- `error`: parsing or integration failed and may be reprocessed by an authorized administrator or tournament moderator.
- `rejected` / `discarded`: intentionally excluded from integration.
- `due`: confirmation expired; the replay is retained for download only.

## Related implementation

- `backend/src/jobs/syncGamesFromForum.ts`
- `backend/src/jobs/parseNewReplaysRefactored.ts`
- `backend/src/jobs/scheduler.ts`
- `backend/src/routes/replays.ts`
- `backend/src/routes/admin.ts`
- `backend/src/services/replayParser.ts`
- `backend/src/utils/replayRankedParser.ts`
- `backend/src/services/replayConfirmationService.ts`
- `frontend/src/pages/AdminReplays.tsx`
