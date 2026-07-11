# Match Disputes

This document is a high-level overview of match dispute handling. The comments and JSDoc in the source code are the authoritative reference for validation, recalculation, and state-transition details.

## Two dispute flows

### Ranked matches

The losing player can dispute a reported result through the match confirmation endpoint. The dispute sets the ranked `matches.status` to `disputed` and stores the loser's explanation in `loser_comments`. Administrators and forum tournament moderators can review ranked disputes at `/admin/disputes`.

The review list is paginated. Rejecting a dispute confirms the original result. Validating a dispute cancels the ranked match, recalculates affected ELO/statistics, and reopens any linked tournament match for re-reporting.

### Unranked tournament matches

The losing participant can dispute an unranked tournament result. The dispute is stored on `tournament_matches` and is resolved by the tournament organizer from the tournament page. Confirming the dispute resets the tournament match and may reopen the round; dismissing it confirms the original result.

These matches are intentionally not mixed into the global ranked dispute list because their authority and recalculation rules belong to the tournament organizer.

## Access and auditability

- Participants may submit a dispute only when they are the losing side.
- Ranked dispute review requires the same administrator/forum-moderator authorization as the administrative match routes.
- Tournament dispute resolution requires tournament-organizer authorization.
- Dispute submissions and administrative resolutions are recorded in `audit_logs` as `ADMIN_ACTION` events.

## Related implementation

- `backend/src/routes/matches.ts`
- `backend/src/routes/tournaments.ts`
- `frontend/src/pages/AdminDisputes.tsx`
- `frontend/src/pages/TournamentDetail.tsx`
- `frontend/src/components/MatchConfirmationModal.tsx`
