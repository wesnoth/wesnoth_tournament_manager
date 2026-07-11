# Discord Messaging Integration

This document describes the Discord integration currently implemented in the Wesnoth Tournament Manager.

Discord is an optional, best-effort notification channel. Tournament and challenge operations must continue to work when Discord is disabled, misconfigured, or temporarily unavailable.

## Supported identity model

The application accepts and stores only the canonical Discord user ID: the numeric Discord snowflake copied from Discord Developer Mode.

Examples of valid input:

```text
123456789012345678
```

The following are not supported:

- Discord usernames
- `username#discriminator` values
- Discord mentions such as `<@123456789012345678>`
- Display names or nicknames

The stored value is `users_extension.discord_id`. It is used directly to build mentions:

```text
<@DISCORD_USER_ID>
```

No username search or discriminator lookup is performed by the application.

## Configuration

The backend reads these environment variables:

| Variable | Purpose |
| --- | --- |
| `DISCORD_ENABLED=true` | Enables Discord publishing. Any other value disables it. |
| `DISCORD_BOT_TOKEN` | Bot token used for Discord API requests. |
| `DISCORD_GUILD_ID` | Guild used when validating a user's Discord ID. |
| `DISCORD_FORUM_CHANNEL_ID` | Forum channel where tournament threads are created. |
| `DISCORD_P2P_CHALLENGE_CHANNEL_ID` | Plain channel where public P2P challenge events are posted. |

`DISCORD_BOT_TOKEN` and the channel IDs are required for publishing. `DISCORD_GUILD_ID` and the bot token are required by the profile validation endpoint.

## Code map

| File | Responsibility |
| --- | --- |
| `backend/src/services/discord.ts` | Snowflake validation and guild-membership validation. |
| `backend/src/services/discordService.ts` | Discord API client, tournament threads, embeds, and generic publishing. |
| `backend/src/services/discordNotificationService.ts` | Match-scheduling embeds, direct mentions, and in-app notification fallback. |
| `backend/src/routes/tournaments.ts` | Tournament lifecycle notifications and custom tournament messages. |
| `backend/src/utils/tournament.ts` | Notifications emitted by automatic tournament progression and completion. |
| `backend/src/routes/challenges.ts` | Public P2P challenge-channel notifications. |
| `backend/src/routes/tournament-scheduling.ts` | Schedule proposal and confirmation notifications. |
| `backend/src/routes/users.ts` | Profile update and guild validation endpoints for Discord IDs. |
| `frontend/src/pages/Profile.tsx` | Profile input and validation UI for the numeric Discord ID. |

## Identity validation

### `isValidDiscordSnowflake()`

File: `backend/src/services/discord.ts`

This is a local sanity check. It requires a 17-20 digit decimal value and checks the timestamp encoded in the Discord snowflake.

The timestamp calculation:

```ts
const timestampMs = Number((snowflake >> 22n) + DISCORD_EPOCH_MS);
```

extracts the creation timestamp encoded in a Discord snowflake. The check rejects values before Discord's epoch and values more than one year in the future. It is useful for rejecting accidental or malformed numeric input, but it does not prove that the ID belongs to a real Discord user.

### `validateDiscordId()`

This function performs the authoritative application-side validation:

1. Trim the submitted numeric ID.
2. Apply `isValidDiscordSnowflake()`.
3. Request `GET /guilds/{guildId}/members/{userId}` using the bot token.
4. Return the Discord nickname, username, or ID for display.
5. Return `null` for an invalid ID or a user who is not in the configured guild.

The profile endpoint uses this function:

```text
POST /api/users/profile/discord/validate
Body: { "discord_id": "123456789012345678" }
```

The update endpoint accepts only a string containing the numeric ID and stores it in `users_extension.discord_id`:

```text
PUT /api/users/profile/discord
Body: { "discord_id": "123456789012345678" }
```

Updating the profile performs format validation. The explicit validation endpoint performs the additional guild-membership check.

## Tournament Discord service

File: `backend/src/services/discordService.ts`

The service uses the Discord REST API v10 and returns a boolean or empty string instead of throwing publishing failures into tournament workflows.

### Thread and transport functions

| Function | Use |
| --- | --- |
| `createTournamentThread()` | Creates one forum thread for a tournament and returns its Discord thread ID. |
| `publishTournamentMessage()` | Publishes content or embeds to a Discord channel or tournament thread. |
| `publishChannelMessage()` | Explicit wrapper for publishing to a non-thread channel, currently used for P2P challenges. |
| `toDiscordSafeText()` | Removes unsuitable Markdown and truncates text before it is put in a Discord message. |
| `buildCombinedTournamentText()` | Combines the tournament description and rules within Discord's embed limits. |

The created thread ID is stored in `tournaments.discord_thread_id`. Every subsequent tournament notification checks that value before publishing.

### Active tournament event functions

| Function | Event |
| --- | --- |
| `postTournamentCreated()` | Tournament thread created and initial tournament details published. |
| `postTournamentCancelled()` | Tournament cancelled. |
| `postPlayerRegistered()` | User requested to join. |
| `postPlayerAccepted()` | Organizer accepted a participant. |
| `postRegistrationClosed()` | Registration closed. |
| `postTournamentStarted()` | Tournament started. |
| `postLeagueStarted()` | League started with all rounds open. |
| `postRoundStarted()` | A round opened, including match count and deadline. |
| `postMatchups()` | Pairings for a round published. |
| `postEliminatedFromTournament()` | Player or team eliminated and current standings published. |
| `postLeagueRoundCompleted()` | League round completed and standings published. |
| `postTournamentFinished()` | Champion and runner-up published. |

Some tournament routes also build a custom embed and call `publishTournamentMessage()` directly when the message does not fit one of these event-specific helpers.

## Tournament lifecycle coverage

The active route and utility flows publish these events:

1. Tournament creation creates the forum thread, stores `discord_thread_id`, and publishes the initial details.
2. Cancellation publishes a cancellation message when a thread exists.
3. Join requests publish the new participant and current count.
4. Participant acceptance publishes the accepted player and accepted count.
5. Registration closure publishes the final participant count.
6. Tournament start publishes the participant and round counts.
7. League start publishes that all rounds are open.
8. Round start publishes the round deadline and matchups.
9. Organizer eliminations publish the eliminated player/team and standings.
10. League progress publishes standings after each completed round.
11. Tournament completion publishes the winner and runner-up.

Discord failures are logged and do not fail the corresponding tournament operation.

The organizer-only `POST /api/tournaments/:id/notify-results` endpoint is a deliberate manual resend mechanism for league standings and final results. It can therefore publish a repeated result notification; it is not dead code or a duplicate automatic trigger.

## P2P challenge notifications

File: `backend/src/routes/challenges.ts`

`sendChallengeDiscord()` publishes embeds to `DISCORD_P2P_CHALLENGE_CHANNEL_ID`. These messages are public channel notifications and do not create a thread.

Current challenge events are:

- New P2P challenge proposal
- Challenge confirmed or rejected after slot selection
- P2P counter-proposal
- Challenge cancellation
- Challenge schedule update

The challenge route uses application nicknames for the embed fields. It does not resolve usernames and does not query Discord IDs because these public challenge messages currently do not mention users.

The same actions also call `storeNotificationForUsers()` so the affected application users can see an in-app notification when they return to the site.

## Tournament schedule notifications

File: `backend/src/services/discordNotificationService.ts`

`sendDiscordNotification()` publishes scheduling events to the tournament's Discord thread. The `discordIds` field contains canonical Discord user IDs already loaded from `users_extension.discord_id`.

Supported notification types:

| Type | Embed |
| --- | --- |
| `schedule_proposal` | New schedule proposal or counter-proposal. |
| `schedule_confirmed` | Schedule accepted. |
| `schedule_rejected` | Schedule rejected. |
| `schedule_changed` | Existing proposal changed. |
| `schedule_cancelled` | Existing proposal cancelled. |

When IDs are present, the service creates direct mentions without any lookup:

```ts
const messageContent = discordIds.map(id => `<@${id}>`).join(' ');
```

IDs are sanity-checked before mention construction. The embed itself contains the tournament, actor, team/player, time-range, and optional message fields.

`storeNotificationForUsers()` inserts the corresponding event into `user_notifications`. This is the in-app fallback and is independent of whether Discord publishing succeeds.

## Notification failure policy

- `DISCORD_ENABLED` disabled: Discord publishing is skipped.
- Missing token or channel ID: publishing is skipped.
- Discord API failure: the error is logged and the main tournament/challenge operation continues.
- Missing tournament thread: the notification is skipped.
- Missing or invalid user Discord ID: the event is still published without that mention.
- Database notification failure: the error is logged and the request follows the caller's existing error handling.

Discord is therefore an auxiliary integration, not part of the transactional success criteria for tournament or challenge state changes.

## Removed or obsolete code

The following code was removed because there are no references in the current TypeScript source:

- `resolveDiscordIdFromUsername()`
- `normalizeDiscordInput()`
- `extractDiscordIdCandidate()`
- `checkGuildMembershipByDiscordId()`
- `DiscordService.postRegistrationOpen()`
- `DiscordService.postMatchResult()`
- `DiscordService.postRoundEnded()`
- `DiscordService.postQualifiedPlayers()`
- `DiscordScheduleNotificationData.fromDiscordId`

Username/discriminator resolution was obsolete because all notification producers now read the canonical ID from the database. The timestamp validation was retained because it remains a useful local sanity check before accepting or formatting numeric input; guild membership validation remains the authoritative Discord check.

## Verification checklist

For a local verification:

1. Run the backend TypeScript build.
2. Run the frontend build.
3. With Discord disabled, create/update/cancel a test tournament and challenge; all application operations must succeed without Discord calls.
4. With Discord enabled in the test environment, verify thread creation and the lifecycle events above.
5. Save a numeric Discord user ID in a test profile and verify the guild validation endpoint.
6. Confirm a schedule notification mentions the stored ID directly.
7. Try a username, `username#1234`, and `<@id>` in the profile; all must be rejected.
