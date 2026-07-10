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

  /**
   * Creates a thread in the forum channel for a tournament
   */
  async createTournamentThread(
    tournamentId: string,
    tournamentName: string,
    tournamentType: string,
    organizerNickname?: string,
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
      const organizer = organizerNickname || 'Unknown';
      const descriptionPreview = this.toDiscordSafeText(description, 450);
      const rulesPreview = this.toDiscordSafeText(rulesMarkdown, 700);
      const descriptionLine = descriptionPreview ? `\n\n${descriptionPreview}` : '';
      const rulesLine = rulesPreview ? `\n\n**Rules preview:**\n${rulesPreview}` : '';
      const content = `**🎮 ${threadName}**\n\nOrganizado por: **${organizer}**${descriptionLine}${rulesLine}\n\nDiscussions and updates will be posted here.`;
      const payload = {
        name: threadName,
        auto_archive_duration: 10080, // 7 días
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
      console.error('❌ Error creando thread en Discord:', error.response?.data || error.message);
      if (error.response?.data?.errors) {
        console.error('Detalles de errores:', JSON.stringify(error.response.data.errors, null, 2));
      }
      return '';
    }
  }

  /**
   * Publica un mensaje en un thread de torneo
   */
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
      console.error('Error publicando mensaje en Discord:', error);
      return false;
    }
  }

  /**
   * Publish a message to a plain Discord channel (non-thread).
   * Used for global channels like P2P challenges.
   */
  async publishChannelMessage(
    channelId: string,
    message: DiscordMessage
  ): Promise<boolean> {
    return this.publishTournamentMessage(channelId, message);
  }

  /**
   * Torneo Creado
   */
  async postTournamentCreated(
    threadId: string,
    tournamentName: string,
    tournamentType: string,
    description: string,
    organizer: string,
    maxParticipants: number | null,
    rulesMarkdown?: string
  ): Promise<boolean> {
    const descriptionPreview = this.toDiscordSafeText(description, 350);
    const rulesPreview = this.toDiscordSafeText(rulesMarkdown, 900);
    const embed: DiscordEmbed = {
      title: `🎮 ${tournamentName}`,
      description: descriptionPreview || undefined,
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
        ...(rulesPreview
          ? [
              {
                name: 'Rules Preview',
                value: rulesPreview,
                inline: false,
              },
            ]
          : []),
      ],
      footer: {
        text: 'Tournament created',
      },
      timestamp: new Date().toISOString(),
    };

    return this.publishTournamentMessage(threadId, { embeds: [embed] });
  }

  /**
   * Inscripción Abierta
   */
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

  /**
   * Jugador Inscrito
   */
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

  /**
   * Jugador Aceptado
   */
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

  /**
   * Inscripción Cerrada
   */
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

  /**
   * Torneo Iniciado
   */
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

  /**
   * Ronda Iniciada
   */
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

  /**
   * Cuadro de Emparejamientos
   */
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

  /**
   * Resultado de Partida Reportada
   */
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

  /**
   * Liga iniciada — todas las rondas abiertas simultáneamente
   */
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

  /**
   * Fin de Ronda
   */
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

  /**
   * Fin de Ronda en Liga con clasificación actual
   */
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

  /**
   * Clasificados para la Siguiente Ronda
   */
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

  /**
   * Jugador/equipo eliminado del torneo (por decisión del organizador)
   */
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

  /**
   * Torneo Finalizado
   */
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
}

export default new DiscordService();
