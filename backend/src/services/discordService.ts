import axios from 'axios';

const DISCORD_API_URL = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const FORUM_CHANNEL_ID = process.env.DISCORD_FORUM_CHANNEL_ID; // ID of the forum channel "tournaments"
const DISCORD_ENABLED = process.env.DISCORD_ENABLED === 'true'; // Enable Discord if explicitly set to 'true'

// Log Discord status on module load
console.log(`🔔 Discord Service: ${DISCORD_ENABLED ? '✅ ENABLED' : '⏭️  DISABLED'} (DISCORD_ENABLED=${process.env.DISCORD_ENABLED || 'not set'})`);

interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
  timestamp?: string;
}

interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
}

class DiscordService {
  private headers = {
    Authorization: `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };

  /** Remove markdown that is not useful in Discord embeds and enforce a limit. */
  private toDiscordSafeText(input: string | undefined, maxLength: number): string {
    if (!input) return '';
    const normalized = input
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/[`*_>#~\-]{1,3}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}…`;
  }

  /** Combine the optional tournament description and rules into one embed-safe block. */
  private buildCombinedTournamentText(
    description: string | undefined,
    rulesMarkdown: string | undefined,
    maxLength: number
  ): string {
    const descriptionText = this.toDiscordSafeText(description, 3000);
    const rulesText = this.toDiscordSafeText(rulesMarkdown, 3000);
    const parts: string[] = [];

    if (descriptionText) {
      parts.push(`**Description**\n${descriptionText}`);
    }

    if (rulesText) {
      parts.push(`**Rules**\n${rulesText}`);
    }

    const combined = parts.join('\n\n');
    if (!combined) return '';
    if (combined.length <= maxLength) return combined;
    return `${combined.slice(0, maxLength - 1)}…`;
  }

  /** Create the forum thread that becomes the tournament's Discord discussion space. */
  async createTournamentThread(
    tournamentId: string,
    tournamentName: string,
    tournamentType: string,
    organizersDisplay?: string,
    description?: string,
    rulesMarkdown?: string
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
      const organizers = organizersDisplay || 'Unknown';
      const combinedTournamentText = this.buildCombinedTournamentText(description, rulesMarkdown, 1150);
      const combinedLine = combinedTournamentText ? `\n\n${combinedTournamentText}` : '';
      const content = `**🎮 ${threadName}**\n\nOrganizers: **${organizers}**${combinedLine}\n\nDiscussions and updates will be posted here.`;
      const payload = {
        name: threadName,
        auto_archive_duration: 10080, // 7 days
        message: {
          content: content.slice(0, 1900),
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
      console.error('❌ Error creating Discord thread:', error.response?.data || error.message);
      if (error.response?.data?.errors) {
        console.error('Discord error details:', JSON.stringify(error.response.data.errors, null, 2));
      }
      return '';
    }
  }

  /** Publish an embed or content message to a Discord channel or tournament thread. */
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
      console.error('Error publishing Discord message:', error);
      return false;
    }
  }

  /** Publish a message to a plain Discord channel, such as the P2P challenge channel. */
  async publishChannelMessage(
    channelId: string,
    message: DiscordMessage
  ): Promise<boolean> {
    return this.publishTournamentMessage(channelId, message);
  }

  /** Publish the initial tournament details after its forum thread is created. */
  async postTournamentCreated(
    threadId: string,
    tournamentName: string,
    tournamentType: string,
    description: string,
    organizers: string,
    maxParticipants: number | null,
    rulesMarkdown?: string
  ): Promise<boolean> {
    const combinedTournamentText = this.buildCombinedTournamentText(description, rulesMarkdown, 1800);
    const embed: DiscordEmbed = {
      title: `🎮 ${tournamentName}`,
      description: combinedTournamentText || undefined,
      color: 0x3498db, // Blue
      fields: [
        {
          name: 'Tournament Type',
          value: tournamentType,
          inline: true,
        },
        {
          name: 'Organizers',
          value: organizers,
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

  /** Publish a notification when a player requests to join the tournament. */
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

  /** Publish a notification when an organizer accepts a participant. */
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

  /** Publish a notification when tournament registration closes. */
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

  /** Publish the tournament-start notification with participant and round counts. */
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

  /** Publish the opening of one tournament round and its deadline. */
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

  /** Publish the pairings generated for a tournament round. */
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

  /** Publish that a league has started with all rounds open simultaneously. */
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

  /** Publish league standings after a round has completed. */
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

  /** Publish the current standings after a player or team is eliminated. */
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

  /** Publish the tournament winner and runner-up when the tournament ends. */
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

  /** Publish the cancellation notice for a tournament thread. */
  async postTournamentCancelled(
    threadId: string,
    tournamentName: string,
    cancelledBy: string
  ): Promise<boolean> {
    const embed: DiscordEmbed = {
      title: `🛑 Tournament Cancelled`,
      description: `**${tournamentName}** has been cancelled.`,
      color: 0xe74c3c, // Red
      fields: [
        {
          name: 'Cancelled by',
          value: cancelledBy || 'Unknown',
          inline: true,
        },
      ],
      footer: {
        text: 'Tournament cancelled',
      },
      timestamp: new Date().toISOString(),
    };

    return this.publishTournamentMessage(threadId, { embeds: [embed] });
  }
}

export default new DiscordService();
