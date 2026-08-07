# Discord Messaging Integration

This document is a high-level guide to the Discord integration in the Wesnoth Tournament Manager. The source code and its English comments/JSDoc are the authoritative documentation for individual functions, parameters, limits, payloads, and implementation details.

Keep this document focused on architecture, responsibilities, configuration, and user-visible behavior. Do not duplicate function inventories or line-level implementation details here.

## Scope

Discord is an optional, best-effort notification channel. Tournament and challenge operations must continue to work when Discord is disabled, misconfigured, or temporarily unavailable.

The integration currently covers:

- Tournament forum threads and tournament lifecycle events.
- Public P2P challenge events.
- Tournament match-scheduling events.
- Direct Discord mentions for users whose canonical Discord IDs are stored.
- In-app notification fallback for scheduling and challenge events.

## Configuration

The backend reads these environment variables:

| Variable | Purpose |
| --- | --- |
| `DISCORD_ENABLED=true` | Enables Discord publishing. Any other value disables it. |
| `DISCORD_BOT_TOKEN` | Bot token used for Discord REST API requests. |
| `DISCORD_GUILD_ID` | Guild used when validating a user's Discord ID. |
| `DISCORD_FORUM_CHANNEL_ID` | Forum channel where tournament Discord threads are created. |
| `DISCORD_P2P_CHALLENGE_CHANNEL_ID` | Plain channel where public P2P challenge events are posted. |

Discord publishing requires the bot token and the relevant channel ID. Profile guild validation additionally requires `DISCORD_GUILD_ID`.

## Identity model

The application accepts and stores only the canonical numeric Discord user ID, also known as the Discord snowflake copied from Discord Developer Mode.

```text
123456789012345678
```

Usernames, `username#discriminator` values, display names, and Discord mention strings such as `<@123456789012345678>` are not valid input. The value is stored in `users_extension.discord_id` and is used directly when constructing mentions.

There is no username search or discriminator lookup. Format validation is local; the profile validation endpoint can additionally verify guild membership through Discord's API.

## Architecture

| Area | Main location | Responsibility |
| --- | --- | --- |
| Discord identity validation | `backend/src/services/discord.ts` | Validate numeric IDs and optionally verify guild membership. |
| Discord transport and tournament messages | `backend/src/services/discordService.ts` | Call Discord REST API, create tournament threads, publish embeds, and preserve readable user-authored text. |
| Scheduling notifications | `backend/src/services/discordNotificationService.ts` | Build schedule embeds, mention stored Discord IDs, and store in-app fallback notifications. |
| Tournament lifecycle | `backend/src/routes/tournaments.ts` and `backend/src/utils/tournament.ts` | Trigger tournament thread creation and lifecycle messages. |
| P2P challenges | `backend/src/routes/challenges.ts` | Publish public challenge-channel messages and store in-app notifications. |
| Scheduling routes | `backend/src/routes/tournament-scheduling.ts` | Supply schedule events and canonical Discord IDs to the notification service. |
| Profile integration | `backend/src/routes/users.ts` and `frontend/src/pages/Profile.tsx` | Accept, display, and validate the numeric Discord ID. |

The tournament's Discord thread ID is stored in `tournaments.discord_thread_id`. Later tournament messages are sent to that thread only when the value exists.

## User-visible notification flows

### Tournament notifications

Tournament creation creates a Discord thread in the configured forum channel and publishes the initial description, rules, organizers, type, capacity, and planned start. Registration closure repeats the planned start so accepted participants can see it in their own Discord timezone. Adding, changing, or removing that date before the tournament starts publishes a dedicated update. Later messages cover registration, participant acceptance, tournament start, league start, round start, pairings, eliminations, standings, cancellation, and completion.

Automatic tournament progression can publish completion and league standings messages. The organizer-only results endpoint is also available as an intentional manual resend mechanism for league standings and final results.

### P2P challenge notifications

Public P2P challenge messages are sent to `DISCORD_P2P_CHALLENGE_CHANNEL_ID`. The current events are proposal, confirmation or rejection, counter-proposal, cancellation, and schedule update.

These public messages use application nicknames and schedule information. They currently do not mention users because the public challenge flow does not need Discord user IDs. The same actions store in-app notifications for the affected users.

### Tournament scheduling notifications

Scheduling messages are sent to the tournament Discord thread. They cover proposals, confirmations, rejections, changes, and cancellations. When recipients have stored canonical Discord IDs, the notification content includes direct mentions without performing any Discord username lookup.

The same events are stored in `user_notifications` so users can see them inside the application even when they were offline or Discord publishing failed.

## Formatting policy

Tournament descriptions and rules are authored by users. The transport layer preserves paragraph breaks, lists, numbering, and supported Markdown so the Discord embed remains readable. It removes unusable image/link targets, normalizes line endings, limits excessive blank lines, protects public broadcast mentions, and applies Discord size limits.

The exact normalization and truncation behavior belongs in the comments/JSDoc beside the implementation in `backend/src/services/discordService.ts`.

## Failure policy

Discord is auxiliary and must not become part of the transaction that changes tournament or challenge state.

- Disabled Discord skips publishing.
- Missing configuration skips the affected message.
- A Discord API failure is logged and does not fail the main operation.
- A missing tournament thread skips thread-specific messages.
- Missing or invalid recipient IDs publish the event without those mentions.
- In-app notification storage remains a separate fallback path.

## Maintenance rule

When changing Discord behavior:

1. Update the English comments/JSDoc in the affected source code first; they are the detailed source of truth.
2. Update this Markdown file only when architecture, configuration, supported flows, identity policy, formatting policy, or failure behavior changes.
3. Keep both source-code documentation and Markdown documentation in English.
4. Avoid copying implementation details, function signatures, line numbers, or temporary behavior into this document.
