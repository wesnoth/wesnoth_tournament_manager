/**
 * Discord Notification Helper for Tournament Scheduling
 * Sends notifications to Discord tournament threads via Bot Token
 * Database notifications are handled separately when users access the app
 */

import { query } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import discordService from './discordService.js';
import { isValidDiscordSnowflake } from './discord.js';

const DISCORD_ENABLED = process.env.DISCORD_ENABLED === 'true';

/** Input data shared by all tournament match-scheduling Discord embeds. */
interface DiscordScheduleNotificationData {
  /** Display name of the player or team that initiated the action. */
  fromUserName?: string;
  /** Display name of the source team for team tournaments. */
  fromTeamName?: string;
  /** Display name of the user who performed the current action. */
  actionByUserName?: string;
  /** Display name of the user who cancelled the proposal, when applicable. */
  cancelledByUserName?: string;
  /** Display names of members in the source team. */
  fromTeamMembers?: string[];
  /** Display name of the target player for one-versus-one matches. */
  toUserName?: string;
  /** Display name of the target team for team tournaments. */
  toTeamName?: string;
  /** Display names of members in the target team. */
  toTeamMembers?: string[];
  /** Discord user IDs that should receive a direct mention. */
  discordIds?: string[];
  /** Legacy single UTC date/time retained for older scheduling flows. */
  proposedDateTime?: string;
  /** Current formatted UTC time ranges produced by slotGrouping utilities. */
  proposedTimeRanges?: string;
  /** Optional user-authored message attached to the proposal. */
  messageExtra?: string;
}

/** Discord embed shape produced by the scheduling notification builders. */
interface DiscordScheduleEmbed {
  title: string;
  description?: string;
  color?: number;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

/**
 * Format a team and its members for a Discord embed field.
 * @param teamName Team display name, or a fallback when unavailable.
 * @param members Member display names to include below the team name.
 * @returns A multiline value suitable for a Discord embed field.
 */
function formatTeamWithMembers(teamName?: string, members?: string[]): string {
  const name = teamName || 'Unknown team';
  if (!members || members.length === 0) return `${name}\nMembers: Unknown`;
  return `${name}\nMembers: ${members.join(', ')}`;
}

/**
 * Add the actor and participant fields shared by all schedule embeds.
 * @param fields Mutable field list receiving the common fields.
 * @param data Scheduling event data containing actor and participant names.
 */
function appendActorAndTargetFields(
  fields: Array<{ name: string; value: string; inline?: boolean }>,
  data: DiscordScheduleNotificationData
): void {
  const actorUserName = data.actionByUserName || data.cancelledByUserName || data.fromUserName || 'Unknown';
  fields.push({ name: '👤 Action by', value: actorUserName, inline: false });

  if (data.fromTeamName || data.toTeamName) {
    fields.push({
      name: '🛡️ From Team',
      value: formatTeamWithMembers(data.fromTeamName, data.fromTeamMembers),
      inline: false,
    });
    fields.push({
      name: '🎯 To Team',
      value: formatTeamWithMembers(data.toTeamName, data.toTeamMembers),
      inline: false,
    });
    return;
  }

  const fromName = data.fromUserName || 'Unknown';
  const toName = data.toUserName || 'Unknown';
  fields.push({ name: '📤 From', value: fromName, inline: true });
  fields.push({ name: '📥 To', value: toName, inline: true });
}

/**
 * Build the embed published when a player proposes a schedule.
 * Supports the current time-range format and the legacy single datetime field.
 * @param tournamentName Tournament display name loaded from the database.
 * @param data Scheduling event details.
 * @returns A Discord embed ready to publish.
 */
function buildScheduleProposalEmbed(
  tournamentName: string,
  data: DiscordScheduleNotificationData
): DiscordScheduleEmbed {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '📋 Tournament', value: tournamentName, inline: false },
  ];
  appendActorAndTargetFields(fields, data);

  // Use new format with time ranges if available, otherwise fall back to single datetime
  if (data.proposedTimeRanges) {
    fields.push({ name: '📅 Proposed Time Slots (UTC)', value: data.proposedTimeRanges, inline: false });
  } else if (data.proposedDateTime) {
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

/**
 * Build the embed published when a schedule proposal is confirmed.
 * Supports the current time-range format and the legacy single datetime field.
 * @param tournamentName Tournament display name loaded from the database.
 * @param data Scheduling event details.
 * @returns A Discord embed ready to publish.
 */
function buildScheduleConfirmationEmbed(
  tournamentName: string,
  data: DiscordScheduleNotificationData
): DiscordScheduleEmbed {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '📋 Tournament', value: tournamentName, inline: false },
  ];
  appendActorAndTargetFields(fields, data);

  // Use new format with time ranges if available, otherwise fall back to single datetime
  if (data.proposedTimeRanges) {
    fields.push({ name: '📅 Confirmed Time Slot (UTC)', value: data.proposedTimeRanges, inline: false });
  } else if (data.proposedDateTime) {
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

/**
 * Build the embed published when a schedule proposal is changed.
 * @param tournamentName Tournament display name loaded from the database.
 * @param data Scheduling event details.
 * @returns A Discord embed ready to publish.
 */
function buildScheduleChangedEmbed(
  tournamentName: string,
  data: DiscordScheduleNotificationData
): DiscordScheduleEmbed {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '📋 Tournament', value: tournamentName, inline: false },
  ];
  appendActorAndTargetFields(fields, data);

  if (data.proposedTimeRanges) {
    fields.push({ name: '📅 New Proposed Time Slots (UTC)', value: data.proposedTimeRanges, inline: false });
  }

  return {
    title: '✏️ Proposal Changed',
    description: 'The proposed schedule has been updated.',
    color: 0xffa500,
    fields,
    footer: { text: 'Proposal Changed' },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build the embed published when a schedule proposal is cancelled.
 * @param tournamentName Tournament display name loaded from the database.
 * @param data Scheduling event details.
 * @returns A Discord embed ready to publish.
 */
function buildScheduleCancelledEmbed(
  tournamentName: string,
  data: DiscordScheduleNotificationData
): DiscordScheduleEmbed {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '📋 Tournament', value: tournamentName, inline: false },
    { name: '🚫 Event', value: 'Proposal cancelled', inline: false },
  ];
  appendActorAndTargetFields(fields, data);

  if (data.proposedTimeRanges) {
    fields.push({ name: '📅 Cancelled Proposal Time Slots (UTC)', value: data.proposedTimeRanges, inline: false });
  }

  return {
    title: '🚫 Proposal Cancelled',
    description: 'A schedule proposal has been cancelled.',
    color: 0xff0000,
    fields,
    footer: { text: 'Proposal Cancelled' },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build the embed published when a schedule proposal is rejected.
 * @param tournamentName Tournament display name loaded from the database.
 * @param data Scheduling event details.
 * @returns A Discord embed ready to publish.
 */
function buildScheduleRejectionEmbed(
  tournamentName: string,
  data: DiscordScheduleNotificationData
): DiscordScheduleEmbed {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '📋 Tournament', value: tournamentName, inline: false },
  ];
  appendActorAndTargetFields(fields, data);

  if (data.proposedTimeRanges) {
    fields.push({ name: '📅 Rejected Proposal Time Slots (UTC)', value: data.proposedTimeRanges, inline: false });
  }

  return {
    title: '❌ Schedule Rejected',
    description: 'The proposed schedule was rejected.',
    color: 0xff0000,
    fields,
    footer: { text: 'Schedule Rejected' },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build and publish a scheduling notification in the tournament thread.
 * `discordIds` already contains canonical Discord user IDs, so no username
 * or discriminator lookup is performed before creating mentions.
 * @param tournamentId Tournament whose Discord thread receives the message.
 * @param notificationType Scheduling event type used to select the embed.
 * @param notificationData Actor, participant, time, and mention data.
 * @returns `true` when the notification is skipped or published successfully; otherwise `false`.
 */
export async function sendDiscordNotification(
  tournamentId: string,
  notificationType: 'schedule_proposal' | 'schedule_confirmed' | 'schedule_rejected' | 'schedule_changed' | 'schedule_cancelled',
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
    let embed;
    if (notificationType === 'schedule_proposal') {
      embed = buildScheduleProposalEmbed(tournamentName, notificationData);
    } else if (notificationType === 'schedule_confirmed') {
      embed = buildScheduleConfirmationEmbed(tournamentName, notificationData);
    } else if (notificationType === 'schedule_rejected') {
      embed = buildScheduleRejectionEmbed(tournamentName, notificationData);
    } else if (notificationType === 'schedule_changed') {
      embed = buildScheduleChangedEmbed(tournamentName, notificationData);
    } else {
      embed = buildScheduleCancelledEmbed(tournamentName, notificationData);
    }

    // Build message content with mentions
    let messageContent = '';
    if (notificationData.discordIds && notificationData.discordIds.length > 0) {
      const validIds = notificationData.discordIds.filter(isValidDiscordSnowflake);
      if (validIds.length > 0) {
        messageContent = validIds.map(id => `<@${id}>`).join(' ');
        console.log(`📝 [DISCORD-MENTION] Final message content: ${messageContent}`);
      } else {
        console.warn('⚠️  [DISCORD-MENTION] No valid Discord IDs provided; message will have no mentions');
      }
    } else {
      console.log('ℹ️  [DISCORD-MENTION] No Discord IDs provided in notification data');
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

/**
 * Store an in-app notification for users who may be offline when the event occurs.
 * @param userIds Application user IDs that should receive the notification.
 * @param tournamentId Tournament or proposal owner used by the notification record.
 * @param _legacyMatchId Ignored compatibility argument retained for legacy callers.
 * @param type Notification type consumed by the in-app notification UI.
 * @param title Short notification title.
 * @param message Human-readable notification body.
 * @param messageExtra Optional additional content stored separately.
 * @param seriesId Optional phase-engine series identifier.
 * @param gameId Optional phase-engine game identifier.
 * @returns `true` when all inserts succeed; otherwise `false`.
 */
export async function storeNotificationForUsers(
  userIds: string[],
  tournamentId: string,
  _legacyMatchId: string | null,
  type:
    | 'schedule_proposal'
    | 'schedule_confirmed'
    | 'schedule_rejected'
    | 'schedule_changed'
    | 'schedule_cancelled'
    | 'challenge_proposal'
    | 'challenge_confirmed'
    | 'challenge_rejected'
    | 'challenge_counter_proposal'
    | 'challenge_updated'
    | 'challenge_cancelled',
  title: string,
  message: string,
  messageExtra?: string | null,
  seriesId?: string | null,
  gameId?: string | null
): Promise<boolean> {
  try {
    for (const userId of userIds) {
      const notificationId = uuidv4();
      await query(
        `INSERT INTO user_notifications
           (id, user_id, tournament_id, game_id, series_id, type, title, message, message_extra, is_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, false)`,
        [notificationId, userId, tournamentId, gameId || null, seriesId || null,
          type, title, message, messageExtra || null]
      );
    }
    console.log(`✅ Stored ${userIds.length} notification(s) in database`);
    return true;
  } catch (error: any) {
    console.error(`❌ Error storing notifications:`, error.message);
    return false;
  }
}
