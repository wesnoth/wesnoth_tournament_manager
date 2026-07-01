	# Discord Messaging and Tournament Threads Documentation

This document provides a comprehensive overview of all code related to Discord message publishing and tournament thread creation in the Wesnoth Tournament Manager.

---

## Table of Contents

1. [Discord Service Core Functions](#discord-service-core-functions)
2. [Notification Service Functions](#notification-service-functions)
3. [Discord Username Resolution](#discord-username-resolution)
4. [User Unlock Notifications](#user-unlock-notifications)
5. [Usage Examples](#usage-examples)

---

## Discord Service Core Functions

### File: `backend/src/services/discordService.ts`

This is the main service class for all Discord interactions. It handles thread creation and message publishing.

---

### Function: `createTournamentThread()`

**Location:** `backend/src/services/discordService.ts` (lines 40-86)

**Purpose:** Creates a new thread in the Discord forum channel for a tournament. Each tournament gets its own discussion thread where updates will be posted.

**Parameters:**
- `tournamentId`: UUID of the tournament
- `tournamentName`: Name of the tournament
- `tournamentType`: Type of tournament (e.g., 'league', 'single elimination')
- `organizerNickname` (optional): Nickname of the tournament organizer
- `description` (optional): Tournament description

**Returns:** Thread ID (string) if successful, empty string if failed

**Implementation:**

```typescript
async createTournamentThread(
  tournamentId: string,
  tournamentName: string,
  tournamentType: string,
  organizerNickname?: string,
  description?: string
): Promise<string> {
  if (!DISCORD_ENABLED) {
    console.log(`⏭️  Discord disabled (DISCORD_ENABLED=${process.env.DISCORD_ENABLED}). Skipping thread creation.`);
    return '';
  }
  if (!FORUM_CHANNEL_ID || !BOT_TOKEN) {
    console.warn('Discord credentials not configured, skipping thread creation');
    return '';
  }

  try {
    const threadName = `${tournamentName} [${tournamentType}]`.substring(0, 100);
    const organizer = organizerNickname || 'Unknown';
    const desc = description ? `\n\n${description}` : '';
    const payload = {
      name: threadName,
      auto_archive_duration: 10080, // 7 days
      message: {
        content: `**🎮 ${threadName}**\n\nOrganizado por: **${organizer}**${desc}\n\nDiscussions and updates will be posted here.`,
      },
    };

    console.log(`📤 Sending to Discord - Channel: ${FORUM_CHANNEL_ID}, Payload:`, JSON.stringify(payload));

    const response = await axios.post(
      `${DISCORD_API_URL}/channels/${FORUM_CHANNEL_ID}/threads`,
      payload,
      { headers: this.headers }
    );

    const threadId = response.data.id;
    console.log(`✅ Thread created for tournament ${tournamentId}: ${threadId}`);
    return threadId;
  } catch (error: any) {
    console.error('❌ Error creating thread on Discord:', error.response?.data || error.message);
    if (error.response?.data?.errors) {
      console.error('Error details:', JSON.stringify(error.response.data.errors, null, 2));
    }
    return '';
  }
}
```

---

### Function: `publishTournamentMessage()`

**Location:** `backend/src/services/discordService.ts` (lines 91-114)

**Purpose:** Publishes a message (with optional embeds) to a tournament's Discord thread. This is the base function used by all other Discord posting methods.

**Parameters:**
- `threadId`: The Discord thread ID
- `message`: DiscordMessage object containing content and/or embeds

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async publishTournamentMessage(
  threadId: string,
  message: DiscordMessage
): Promise<boolean> {
  if (!DISCORD_ENABLED) {
    console.log(`⏭️  Discord disabled (DISCORD_ENABLED=${process.env.DISCORD_ENABLED}). Skipping message publish.`);
    return false;
  }
  if (!BOT_TOKEN || !threadId) {
    return false;
  }

  try {
    await axios.post(
      `${DISCORD_API_URL}/channels/${threadId}/messages`,
      message,
      { headers: this.headers }
    );
    return true;
  } catch (error) {
    console.error('Error publishing message on Discord:', error);
    return false;
  }
}
```

---

### Function: `postTournamentCreated()`

**Location:** `backend/src/services/discordService.ts` (lines 119-160)

**Purpose:** Posts a formatted message to Discord when a tournament is created. Shows tournament details including type, organizer, and max participants.

**Parameters:**
- `threadId`: The Discord thread ID
- `tournamentName`: Name of the tournament
- `tournamentType`: Type of tournament
- `description`: Tournament description
- `organizer`: Name of the organizer
- `maxParticipants`: Maximum number of participants (null for unlimited)

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postTournamentCreated(
  threadId: string,
  tournamentName: string,
  tournamentType: string,
  description: string,
  organizer: string,
  maxParticipants: number | null
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `🎮 ${tournamentName}`,
    description: description,
    color: 0x3498db, // Blue
    fields: [
      {
        name: 'Tournament Type',
        value: tournamentType,
        inline: true,
      },
      {
        name: 'Organizer',
        value: organizer,
        inline: true,
      },
      {
        name: 'Max Participants',
        value: maxParticipants ? `${maxParticipants}` : 'Unlimited',
        inline: true,
      },
      {
        name: 'Status',
        value: '🔓 Registration Open',
        inline: true,
      },
    ],
    footer: {
      text: 'Tournament created',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postPlayerRegistered()`

**Location:** `backend/src/services/discordService.ts` (lines 185-213)

**Purpose:** Posts a notification when a player registers for a tournament. Shows current participant count.

**Parameters:**
- `threadId`: The Discord thread ID
- `playerNickname`: Nickname of the registered player
- `currentCount`: Current number of participants
- `maxParticipants`: Maximum participants (null for unlimited)

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postPlayerRegistered(
  threadId: string,
  playerNickname: string,
  currentCount: number,
  maxParticipants: number | null
): Promise<boolean> {
  const participantInfo = maxParticipants
    ? `${currentCount}/${maxParticipants}`
    : `${currentCount}`;

  const embed: DiscordEmbed = {
    title: `✅ New Participant`,
    description: `**${playerNickname}** has registered for the tournament.`,
    color: 0x3498db,
    fields: [
      {
        name: 'Participants',
        value: participantInfo,
        inline: true,
      },
    ],
    footer: {
      text: 'Participant registered',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postPlayerAccepted()`

**Location:** `backend/src/services/discordService.ts` (lines 218-241)

**Purpose:** Posts a notification when a player is accepted into a tournament (after registration review).

**Parameters:**
- `threadId`: The Discord thread ID
- `playerNickname`: Nickname of the accepted player
- `totalAccepted`: Total number of accepted players

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postPlayerAccepted(
  threadId: string,
  playerNickname: string,
  totalAccepted: number
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `👤 Participant Accepted`,
    description: `**${playerNickname}** has been accepted to the tournament.`,
    color: 0x27ae60, // Dark green
    fields: [
      {
        name: 'Total Accepted',
        value: `${totalAccepted}`,
        inline: true,
      },
    ],
    footer: {
      text: 'Participant accepted',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postRegistrationOpen()`

**Location:** `backend/src/services/discordService.ts` (lines 165-180)

**Purpose:** Posts a notification that tournament registration is now open.

**Parameters:**
- `threadId`: The Discord thread ID
- `tournamentName`: Name of the tournament

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postRegistrationOpen(
  threadId: string,
  tournamentName: string
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `🔓 Registration Open`,
    description: `Registration for **${tournamentName}** is now open.`,
    color: 0x2ecc71, // Green
    footer: {
      text: 'Status: Registration open',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postRegistrationClosed()`

**Location:** `backend/src/services/discordService.ts` (lines 246-268)

**Purpose:** Posts a notification when tournament registration closes. Shows total participants.

**Parameters:**
- `threadId`: The Discord thread ID
- `totalParticipants`: Total number of participants

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postRegistrationClosed(
  threadId: string,
  totalParticipants: number
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `🔒 Registration Closed`,
    description: `Registration has been closed.`,
    color: 0xe74c3c, // Red
    fields: [
      {
        name: 'Total Participants',
        value: `${totalParticipants}`,
        inline: true,
      },
    ],
    footer: {
      text: 'Registration closed',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postTournamentStarted()`

**Location:** `backend/src/services/discordService.ts` (lines 273-302)

**Purpose:** Posts a notification that the tournament has started. Shows participant count and total rounds.

**Parameters:**
- `threadId`: The Discord thread ID
- `tournamentName`: Name of the tournament
- `totalParticipants`: Total number of participants
- `totalRounds`: Total number of rounds in the tournament

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postTournamentStarted(
  threadId: string,
  tournamentName: string,
  totalParticipants: number,
  totalRounds: number
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `🚀 Tournament Started!`,
    description: `**${tournamentName}** has begun.`,
    color: 0xf39c12, // Orange
    fields: [
      {
        name: 'Participants',
        value: `${totalParticipants}`,
        inline: true,
      },
      {
        name: 'Total Rounds',
        value: `${totalRounds}`,
        inline: true,
      },
    ],
    footer: {
      text: 'Tournament started',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postRoundStarted()`

**Location:** `backend/src/services/discordService.ts` (lines 307-336)

**Purpose:** Posts a notification that a tournament round has started. Shows match count and deadline.

**Parameters:**
- `threadId`: The Discord thread ID
- `roundNumber`: Round number
- `matchesCount`: Number of matches in this round
- `endDate`: Deadline for the round

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postRoundStarted(
  threadId: string,
  roundNumber: number,
  matchesCount: number,
  endDate: string
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `⏱️ Round ${roundNumber} Started`,
    description: `Round ${roundNumber} has begun.`,
    color: 0x9b59b6, // Purple
    fields: [
      {
        name: 'Matches',
        value: `${matchesCount}`,
        inline: true,
      },
      {
        name: 'Deadline',
        value: endDate,
        inline: true,
      },
    ],
    footer: {
      text: `Round ${roundNumber}`,
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postMatchups()`

**Location:** `backend/src/services/discordService.ts` (lines 341-361)

**Purpose:** Posts the matchup brackets for a round to Discord. Shows all pairings in a formatted list.

**Parameters:**
- `threadId`: The Discord thread ID
- `roundNumber`: Round number
- `matchups`: Array of matchup objects with player1 and player2

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postMatchups(
  threadId: string,
  roundNumber: number,
  matchups: Array<{ player1: string; player2: string }>
): Promise<boolean> {
  const matchupText = matchups
    .map((m, i) => `${i + 1}. **${m.player1}** vs **${m.player2}**`)
    .join('\n');

  const embed: DiscordEmbed = {
    title: `🎲 Round ${roundNumber} Matchups`,
    description: matchupText || 'No matchups',
    color: 0x34495e, // Dark gray
    footer: {
      text: `Round ${roundNumber}`,
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postMatchResult()`

**Location:** `backend/src/services/discordService.ts` (lines 366-402)

**Purpose:** Posts match result to Discord when a match is reported and confirmed. Shows players, winner, map, and faction.

**Parameters:**
- `threadId`: The Discord thread ID
- `player1`: First player's nickname
- `player2`: Second player's nickname
- `winner`: Winner's nickname
- `map`: Map name
- `faction`: Faction used

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postMatchResult(
  threadId: string,
  player1: string,
  player2: string,
  winner: string,
  map: string,
  faction: string
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `🏆 Match Result - ${winner} Wins`,
    description: `**${player1}** vs **${player2}**`,
    color: 0x2ecc71, // Green
    fields: [
      {
        name: 'Winner',
        value: winner,
        inline: true,
      },
      {
        name: 'Map',
        value: map,
        inline: true,
      },
      {
        name: 'Faction',
        value: faction,
        inline: true,
      },
    ],
    footer: {
      text: 'Match reported',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postLeagueStarted()`

**Location:** `backend/src/services/discordService.ts` (lines 407-435)

**Purpose:** Posts notification that a league tournament has started with all rounds open simultaneously. Special handling for league tournaments.

**Parameters:**
- `threadId`: The Discord thread ID
- `totalRounds`: Total number of rounds
- `totalMatches`: Total number of matches

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postLeagueStarted(
  threadId: string,
  totalRounds: number,
  totalMatches: number
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `🏁 League Started — All Rounds Open`,
    description: `All **${totalRounds}** rounds are open simultaneously. Players can play matches from any round in any order.`,
    color: 0x9b59b6, // Purple
    fields: [
      {
        name: 'Total Rounds',
        value: `${totalRounds}`,
        inline: true,
      },
      {
        name: 'Total Matches',
        value: `${totalMatches}`,
        inline: true,
      },
    ],
    footer: {
      text: 'Good luck to all participants!',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postRoundEnded()`

**Location:** `backend/src/services/discordService.ts` (lines 440-455)

**Purpose:** Posts notification that a tournament round has completed.

**Parameters:**
- `threadId`: The Discord thread ID
- `roundNumber`: Round number

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postRoundEnded(
  threadId: string,
  roundNumber: number
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `✅ Round ${roundNumber} Completed`,
    description: `Round ${roundNumber} has finished.`,
    color: 0x27ae60, // Dark green
    footer: {
      text: `Round ${roundNumber}`,
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postLeagueRoundCompleted()`

**Location:** `backend/src/services/discordService.ts` (lines 460-489)

**Purpose:** Posts notification that a league round is complete with current standings.

**Parameters:**
- `threadId`: The Discord thread ID
- `roundNumber`: Round number
- `totalRounds`: Total rounds in the league
- `standings`: Array of player standings with points, wins, losses

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postLeagueRoundCompleted(
  threadId: string,
  roundNumber: number,
  totalRounds: number,
  standings: Array<{ nickname: string; points: number; wins: number; losses: number }>
): Promise<boolean> {
  const standingsText = standings
    .slice(0, 15) // Discord embed limit
    .map((p, i) => `**${i + 1}.** ${p.nickname} — ${p.points} pts (${p.wins}W-${p.losses}L)`)
    .join('\n');

  const embed: DiscordEmbed = {
    title: `✅ Round ${roundNumber}/${totalRounds} Completed`,
    description: standingsText || 'No standings available',
    color: 0x27ae60, // Dark green
    fields: [
      {
        name: 'Rounds remaining',
        value: `${totalRounds - roundNumber}`,
        inline: true,
      },
    ],
    footer: {
      text: `Standings after Round ${roundNumber}`,
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postQualifiedPlayers()`

**Location:** `backend/src/services/discordService.ts` (lines 494-522)

**Purpose:** Posts the standings/qualified players after a round.

**Parameters:**
- `threadId`: The Discord thread ID
- `roundNumber`: Round number
- `players`: Array of qualified players with nicknames and points

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postQualifiedPlayers(
  threadId: string,
  roundNumber: number,
  players: Array<{ nickname: string; points: number }>
): Promise<boolean> {
  const playerText = players
    .slice(0, 20) // Max 20 to not exceed Discord limit
    .map((p, i) => `${i + 1}. **${p.nickname}** - ${p.points} pts`)
    .join('\n');

  const embed: DiscordEmbed = {
    title: `📊 Standings - Round ${roundNumber}`,
    description: playerText || 'No qualified players',
    color: 0x3498db, // Blue
    fields: [
      {
        name: 'Total',
        value: `${players.length} players`,
        inline: true,
      },
    ],
    footer: {
      text: `Round ${roundNumber}`,
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postEliminatedFromTournament()`

**Location:** `backend/src/services/discordService.ts` (lines 527-549)

**Purpose:** Posts notification when a player or team is eliminated from the tournament.

**Parameters:**
- `threadId`: The Discord thread ID
- `tournamentName`: Name of the tournament
- `eliminatedName`: Name of the eliminated player/team
- `standings`: Current tournament standings

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postEliminatedFromTournament(
  threadId: string,
  tournamentName: string,
  eliminatedName: string,
  standings: Array<{ nickname: string; points: number; wins: number; losses: number }>
): Promise<boolean> {
  const standingsText = standings
    .slice(0, 15)
    .map((p, i) => `**${i + 1}.** ${p.nickname} — ${p.points} pts (${p.wins}W-${p.losses}L)`)
    .join('\n');

  const embed: DiscordEmbed = {
    title: `🚫 ${eliminatedName} eliminated from ${tournamentName}`,
    description: standingsText || 'No standings available',
    color: 0xe74c3c, // Red
    footer: {
      text: 'Current standings',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

### Function: `postTournamentFinished()`

**Location:** `backend/src/services/discordService.ts` (lines 554-583)

**Purpose:** Posts notification that tournament is finished with winner and runner-up information.

**Parameters:**
- `threadId`: The Discord thread ID
- `tournamentName`: Name of the tournament
- `winner`: Name of the tournament winner
- `runnerUp`: Name of the runner-up (second place)

**Returns:** Boolean indicating success

**Implementation:**

```typescript
async postTournamentFinished(
  threadId: string,
  tournamentName: string,
  winner: string,
  runnerUp: string
): Promise<boolean> {
  const embed: DiscordEmbed = {
    title: `🎉 ${tournamentName} Finished!`,
    description: `The tournament has come to an end.`,
    color: 0xf1c40f, // Yellow
    fields: [
      {
        name: '🥇 Champion',
        value: winner,
        inline: true,
      },
      {
        name: '🥈 Runner-up',
        value: runnerUp || 'N/A',
        inline: true,
      },
    ],
    footer: {
      text: 'Tournament finished',
    },
    timestamp: new Date().toISOString(),
  };

  return this.publishTournamentMessage(threadId, { embeds: [embed] });
}
```

---

## Notification Service Functions

### File: `backend/src/services/discordNotificationService.ts`

This service handles Discord notifications specifically for tournament scheduling (proposals and confirmations) and database notifications for offline users.

---

### Function: `buildScheduleProposalEmbed()`

**Location:** `backend/src/services/discordNotificationService.ts` (lines 29-60)

**Purpose:** Builds a Discord embed message for match schedule proposals with clear formatting showing who proposed, who it's for, proposed time, and any extra message.

**Parameters:**
- `tournamentName`: Name of the tournament
- `data`: DiscordScheduleNotificationData object with proposal details

**Returns:** Discord embed object

**Implementation:**

```typescript
function buildScheduleProposalEmbed(
  tournamentName: string,
  data: DiscordScheduleNotificationData
): any {
  const fromName = data.fromTeamName || data.fromUserName || 'Unknown';
  const toName = data.toTeamName || data.toUserName || 'Unknown';
  
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '📋 Tournament', value: tournamentName, inline: false },
    { name: '📤 From', value: fromName, inline: true },
    { name: '📥 To', value: toName, inline: true },
  ];

  if (data.proposedDateTime) {
    fields.push({ name: '📅 Proposed Date/Time', value: data.proposedDateTime, inline: false });
  }

  if (data.messageExtra) {
    fields.push({ name: '💬 Message', value: data.messageExtra, inline: false });
  }

  fields.push({ name: '⚠️ Action', value: 'Please confirm or counter propose', inline: false });

  return {
    title: '🗓️ Schedule Proposal',
    description: '',
    color: 0xffa500,
    fields,
    footer: { text: 'Schedule Proposal' },
    timestamp: new Date().toISOString(),
  };
}
```

---

### Function: `buildScheduleConfirmationEmbed()`

**Location:** `backend/src/services/discordNotificationService.ts` (lines 65-90)

**Purpose:** Builds a Discord embed message for match schedule confirmations.

**Parameters:**
- `tournamentName`: Name of the tournament
- `data`: DiscordScheduleNotificationData object with confirmation details

**Returns:** Discord embed object

**Implementation:**

```typescript
function buildScheduleConfirmationEmbed(
  tournamentName: string,
  data: DiscordScheduleNotificationData
): any {
  const confirmedByName = data.fromTeamName || data.fromUserName || 'Unknown';
  const againstName = data.toTeamName || data.toUserName || 'Unknown';

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '📋 Tournament', value: tournamentName, inline: false },
    { name: '✅ Confirmed by', value: confirmedByName, inline: true },
    { name: '🆚 Against', value: againstName, inline: true },
  ];

  if (data.proposedDateTime) {
    fields.push({ name: '📅 Confirmed Date/Time', value: data.proposedDateTime, inline: false });
  }

  return {
    title: '✅ Schedule Confirmed',
    description: '',
    color: 0x00ff00,
    fields,
    footer: { text: 'Schedule Confirmed' },
    timestamp: new Date().toISOString(),
  };
}
```

---

### Function: `sendDiscordNotification()`

**Location:** `backend/src/services/discordNotificationService.ts` (lines 95-180)

**Purpose:** Sends a scheduling notification (proposal or confirmation) to the tournament's Discord thread. Resolves Discord usernames to numeric IDs for proper @mentions and handles both embed and mention content.

**Parameters:**
- `tournamentId`: UUID of the tournament
- `notificationType`: Type of notification ('schedule_proposal' or 'schedule_confirmed')
- `notificationData`: DiscordScheduleNotificationData object with notification details

**Returns:** Boolean indicating success

**Implementation:**

```typescript
export async function sendDiscordNotification(
  tournamentId: string,
  notificationType: 'schedule_proposal' | 'schedule_confirmed',
  notificationData: DiscordScheduleNotificationData
): Promise<boolean> {
  if (!DISCORD_ENABLED) {
    console.log('⏭️  Discord disabled, skipping Discord notification');
    return true;
  }

  try {
    // Get tournament info including name and thread ID
    const tournamentResult = await query(
      'SELECT name, discord_thread_id FROM tournaments WHERE id = ?',
      [tournamentId]
    );

    if (!tournamentResult.rows || tournamentResult.rows.length === 0) {
      console.log('⚠️  Tournament not found in database');
      return false;
    }

    const { name: tournamentName, discord_thread_id: threadId } = tournamentResult.rows[0];
    
    if (!threadId) {
      console.log('⚠️  No Discord thread ID for this tournament');
      return false;
    }

    // Build appropriate embed
    const embed = notificationType === 'schedule_proposal'
      ? buildScheduleProposalEmbed(tournamentName, notificationData)
      : buildScheduleConfirmationEmbed(tournamentName, notificationData);

    // Build message content with mentions
    let messageContent = '';
    if (notificationData.toDiscordIds && notificationData.toDiscordIds.length > 0) {
      console.log(`🔍 [DISCORD-MENTION] Starting to resolve ${notificationData.toDiscordIds.length} Discord usernames:`, notificationData.toDiscordIds);
      
      // Resolve usernames to numeric Discord IDs for proper mentions
      const resolvedIds: string[] = [];
      for (const discordUsername of notificationData.toDiscordIds) {
        console.log(`🔄 [DISCORD-MENTION] Attempting to resolve username: ${discordUsername}`);
        const numericId = await resolveDiscordIdFromUsername(discordUsername);
        if (numericId) {
          console.log(`✅ [DISCORD-MENTION] Successfully resolved ${discordUsername} → ${numericId}`);
          resolvedIds.push(numericId);
        } else {
          console.warn(`❌ [DISCORD-MENTION] Failed to resolve Discord ID for username: ${discordUsername}`);
        }
      }
      
      console.log(`📊 [DISCORD-MENTION] Resolution summary: ${resolvedIds.length}/${notificationData.toDiscordIds.length} resolved`);
      
      if (resolvedIds.length > 0) {
        messageContent = resolvedIds.map(id => `<@${id}>`).join(' ');
        console.log(`📝 [DISCORD-MENTION] Final message content: ${messageContent}`);
      } else {
        console.warn(`⚠️  [DISCORD-MENTION] No Discord IDs resolved, message will have no mentions`);
      }
    } else {
      console.log(`ℹ️  [DISCORD-MENTION] No Discord IDs provided in notification data`);
    }

    const discordMessage = { 
      content: messageContent || undefined,
      embeds: [embed] 
    };

    console.log(`📤 [DISCORD-MENTION] Sending Discord message with content: "${messageContent || '(empty)'}"`);

    // Send to Discord thread
    const success = await discordService.publishTournamentMessage(threadId, discordMessage);
    
    if (success) {
      console.log(`✅ Discord notification sent to thread ${threadId} (${notificationType})`);
      return true;
    } else {
      console.log(`⚠️  Failed to send Discord notification to thread`);
      return false;
    }
  } catch (error: any) {
    console.error(`❌ Error sending Discord notification:`, error.message);
    return false;
  }
}
```

---

### Function: `storeNotificationForUsers()`

**Location:** `backend/src/services/discordNotificationService.ts` (lines 185-209)

**Purpose:** Stores a notification in the database for users who are offline. These notifications are shown in the UI when users log in or return to the app. Supports hybrid notification system: Discord webhook for real-time, Socket.IO for online users, and database for offline users.

**Parameters:**
- `userIds`: Array of user IDs to receive the notification
- `tournamentId`: UUID of the tournament
- `matchId`: UUID of the match
- `type`: Notification type ('schedule_proposal' or 'schedule_confirmed')
- `title`: Notification title
- `message`: Notification message
- `messageExtra` (optional): Extra message details

**Returns:** Boolean indicating success

**Implementation:**

```typescript
export async function storeNotificationForUsers(
  userIds: string[],
  tournamentId: string,
  matchId: string,
  type: 'schedule_proposal' | 'schedule_confirmed',
  title: string,
  message: string,
  messageExtra?: string | null
): Promise<boolean> {
  try {
    for (const userId of userIds) {
      const notificationId = uuidv4();
      await query(
        `INSERT INTO user_notifications (id, user_id, tournament_id, match_id, type, title, message, message_extra, is_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, false)`,
        [notificationId, userId, tournamentId, matchId, type, title, message, messageExtra || null]
      );
    }
    console.log(`✅ Stored ${userIds.length} notification(s) in database`);
    return true;
  } catch (error: any) {
    console.error(`❌ Error storing notifications:`, error.message);
    return false;
  }
}
```

---

## Discord Username Resolution

### File: `backend/src/services/discord.ts`

This module handles resolving Discord usernames to numeric Discord IDs, which is essential for proper @mentions in messages.

---

### Function: `resolveDiscordIdFromUsername()`

**Location:** `backend/src/services/discord.ts` (lines 15-130)

**Purpose:** Resolves a Discord username (with or without discriminator) to a numeric Discord ID by searching the guild members. Supports both new Discord usernames and legacy username#discriminator format.

**Parameters:**
- `usernameInput`: Discord username or username#discriminator format

**Returns:** Numeric Discord ID as string, or null if not found

**Implementation:**

```typescript
export async function resolveDiscordIdFromUsername(usernameInput: string): Promise<string | null> {
  console.log('[DISCORD-RESOLVE] Attempting to resolve username to ID:', usernameInput);

  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.warn('[DISCORD-RESOLVE] Bot token or guild ID not configured');
    return null;
  }

  // If input looks like numeric ID already, return it
  if (/^\d+$/.test(usernameInput)) {
    console.log('[DISCORD-RESOLVE] Input is already numeric ID:', usernameInput);
    return usernameInput;
  }

  try {
    const DISCORD_API_URL = 'https://discord.com/api/v10';
    const guildId = process.env.DISCORD_GUILD_ID;
    const headers = {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // Extract username from "username#discriminator" or just "username"
    const username = usernameInput.split('#')[0];

    console.log('[DISCORD-RESOLVE] Searching for username in guild:', {
      guildId,
      searchQuery: username,
      originalInput: usernameInput
    });

    // Search for members in guild by username
    const response = await axios.get(
      `${DISCORD_API_URL}/guilds/${guildId}/members/search`,
      {
        headers,
        params: { query: username, limit: 10 }
      }
    );

    const members = response.data;

    if (!members || members.length === 0) {
      console.warn('[DISCORD-RESOLVE] No members found with username:', username);
      return null;
    }

    console.log('[DISCORD-RESOLVE] Members found:', members.map((m: any) => ({
      id: m.user.id,
      username: m.user.username,
      discriminator: m.user.discriminator,
      fullTag: `${m.user.username}#${m.user.discriminator}`
    })));

    // Find exact match (considering both username and discriminator)
    let targetMember = null;

    if (usernameInput.includes('#')) {
      // Search for exact username#discriminator match
      const [searchUsername, searchDiscriminator] = usernameInput.split('#');
      console.log('[DISCORD-RESOLVE] Looking for exact match:', {
        searchUsername: searchUsername.toLowerCase(),
        searchDiscriminator
      });
      
      targetMember = members.find((m: any) => {
        const match = m.user.username.toLowerCase() === searchUsername.toLowerCase() &&
                      m.user.discriminator === searchDiscriminator;
        if (!match) {
          console.log('[DISCORD-RESOLVE] Checked member:', {
            username: m.user.username,
            discriminator: m.user.discriminator,
            matched: match
          });
        }
        return match;
      });
      
      if (!targetMember) {
        console.warn('[DISCORD-RESOLVE] Exact username#discriminator not found, trying username-only match');
        // Fall back to username-only match if discriminator doesn't match
        targetMember = members.find((m: any) =>
          m.user.username.toLowerCase() === usernameInput.split('#')[0].toLowerCase()
        );
      }
    } else {
      // Just username, take first match
      console.log('[DISCORD-RESOLVE] Accepting first match for username (no discriminator specified)');
      targetMember = members[0];
    }

    if (!targetMember) {
      console.warn('[DISCORD-RESOLVE] No suitable member found for:', usernameInput);
      console.warn('[DISCORD-RESOLVE] Available members:', members.map((m: any) => `${m.user.username}#${m.user.discriminator}`));
      return null;
    }

    const discordId = targetMember.user.id;
    console.log('[DISCORD-RESOLVE] Successfully resolved username to ID:', {
      input: usernameInput,
      resolvedId: discordId,
      username: targetMember.user.username,
      discriminator: targetMember.user.discriminator
    });

    return discordId;
  } catch (error: any) {
    console.error('[DISCORD-RESOLVE] Error resolving username:', {
      input: usernameInput,
      httpStatus: error.response?.status,
      errorData: error.response?.data,
      errorMessage: error.message
    });
    return null;
  }
}
```

---

---

## Usage Examples

### Example 1: Creating a Tournament Thread and Posting Tournament Created

**File:** `backend/src/routes/tournaments.ts`

**Context:** When a tournament is created via the API

```typescript
// Create Discord forum thread for the tournament
try {
  const threadId = await discordService.createTournamentThread(
    tournamentId,
    tournamentData.name,
    tournamentData.tournament_type,
    createdByUser?.nickname,
    tournamentData.description
  );

  // Post tournament created message to Discord
  await discordService.postTournamentCreated(
    threadId,
    tournamentData.name,
    tournamentData.tournament_type,
    tournamentData.description || '',
    createdByUser?.nickname || 'Unknown',
    tournamentData.max_participants || null
  );
} catch (error) {
  console.error('Error creating Discord thread:', error);
}
```

### Example 2: Sending Schedule Notification

**File:** `backend/src/routes/tournament-scheduling.ts`

**Context:** When a user proposes a schedule for a match

```typescript
// Send Discord notification
await sendDiscordNotification(
  tournament_id,
  'schedule_proposal',
  {
    tournamentName: tournament.name,
    fromUserName: user.nickname,
    toUserName: opponent.nickname,
    toDiscordIds: [opponent.discord_username],
    proposedDateTime: scheduled_for,
    messageExtra: note
  }
);

// Store in database for offline users
await storeNotificationForUsers(
  [opponent.id],
  tournament_id,
  match_id,
  'schedule_proposal',
  'Match Schedule Proposed',
  `${user.nickname} proposed a schedule for your match`,
  note
);
```

### Example 3: Posting Match Result

**File:** Tournament match reporting flow

**Context:** When a match result is confirmed

```typescript
// Get match details
const match = await getMatchDetails(matchId);

// Post result to Discord thread
await discordService.postMatchResult(
  tournament.discord_thread_id,
  match.player1_nickname,
  match.player2_nickname,
  winner.nickname,
  match.map_name,
  match.faction
);
```

---

## Configuration

### Required Environment Variables

```
DISCORD_ENABLED=true
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_guild_id_here
DISCORD_FORUM_CHANNEL_ID=your_forum_channel_id_here
DISCORD_P2P_CHALLENGE_CHANNEL_ID=your_p2p_challenges_channel_id_here
```

- `DISCORD_FORUM_CHANNEL_ID`: tournament notifications using forum-thread flow.
- `DISCORD_P2P_CHALLENGE_CHANNEL_ID`: P2P challenge notifications using flat channel messages (no thread creation).

**Deprecated webhook URLs** (no longer in use):
- `DISCORD_WEBHOOK_URL_ADMIN` - Previously used for admin notifications
- `DISCORD_WEBHOOK_URL_USERS` - Previously used for user unlock notifications


---

## Discord API Integration

- **API Version:** Discord API v10
- **Authentication:** Bot token via Authorization header
- **Endpoints Used:**
  - `POST /channels/{id}/threads` - Create forum thread
  - `POST /channels/{id}/messages` - Post message to thread
  - `GET /guilds/{id}/members/search` - Search guild members for username resolution

Note: Webhook-based notifications (previously used for user lock/unlock events) have been removed. 

---

## Error Handling

All Discord functions include error handling with:
- Detailed console logging with emoji indicators
- Graceful fallback when Discord is disabled
- Specific error logging for API failures
- Retry-safe design (idempotent operations)
