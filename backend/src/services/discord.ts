import axios from 'axios';

const DISCORD_API_URL = 'https://discord.com/api/v10';
const DISCORD_EPOCH_MS = 1420070400000n; // 2015-01-01T00:00:00.000Z
const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;

/**
 * Check whether a value has the shape of a Discord snowflake user ID.
 *
 * The timestamp check only rejects malformed or implausible numeric values.
 * It does not prove that the ID belongs to a real user; callers that need
 * that guarantee must validate the ID against Discord's guild-member API.
 */
export function isValidDiscordSnowflake(id: string): boolean {
  if (!DISCORD_SNOWFLAKE_REGEX.test(id)) return false;

  try {
    const snowflake = BigInt(id);
    const timestampMs = Number((snowflake >> 22n) + DISCORD_EPOCH_MS);
    const maxFutureSkewMs = 365 * 24 * 60 * 60 * 1000;

    return (
      snowflake > 0n &&
      Number.isFinite(timestampMs) &&
      timestampMs >= Number(DISCORD_EPOCH_MS) &&
      timestampMs <= Date.now() + maxFutureSkewMs
    );
  } catch {
    return false;
  }
}

/**
 * Validate a Discord user ID and, when configured, confirm guild membership.
 * Returns the guild nickname when available, falling back to the Discord
 * username or the ID itself for display.
 */
export async function validateDiscordId(
  discordInput: string
): Promise<{ discordId: string; nickname: string } | null> {
  const discordId = discordInput.trim();
  if (!discordId || !isValidDiscordSnowflake(discordId)) {
    return null;
  }

  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) {
    return null;
  }

  try {
    const response = await axios.get(
      `${DISCORD_API_URL}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordId}`,
      {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const member = response.data;
    return {
      discordId,
      nickname: member?.nick || member?.user?.username || discordId,
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}
