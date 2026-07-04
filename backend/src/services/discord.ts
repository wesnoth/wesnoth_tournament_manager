import axios from 'axios';

const DISCORD_API_URL = 'https://discord.com/api/v10';
const DISCORD_EPOCH_MS = 1420070400000n; // 2015-01-01T00:00:00.000Z
const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;
const DISCORD_USER_MENTION_REGEX = /^<@!?(\d{17,20})>$/;

function normalizeDiscordInput(input: string): string {
  return input.trim();
}

function extractDiscordIdCandidate(input: string): string | null {
  const mentionMatch = input.match(DISCORD_USER_MENTION_REGEX);
  if (mentionMatch) return mentionMatch[1];
  return DISCORD_SNOWFLAKE_REGEX.test(input) ? input : null;
}

function isValidDiscordSnowflake(id: string): boolean {
  if (!DISCORD_SNOWFLAKE_REGEX.test(id)) return false;

  try {
    const snowflake = BigInt(id);
    if (snowflake <= 0n) return false;

    const timestampMs = Number((snowflake >> 22n) + DISCORD_EPOCH_MS);
    const maxFutureSkewMs = 365 * 24 * 60 * 60 * 1000;

    return (
      Number.isFinite(timestampMs) &&
      timestampMs >= Number(DISCORD_EPOCH_MS) &&
      timestampMs <= Date.now() + maxFutureSkewMs
    );
  } catch {
    return false;
  }
}

export { isValidDiscordSnowflake };

async function checkGuildMembershipByDiscordId(
  guildId: string,
  discordId: string,
  headers: Record<string, string>
): Promise<'member' | 'not_member' | 'error'> {
  try {
    await axios.get(`${DISCORD_API_URL}/guilds/${guildId}/members/${discordId}`, { headers });
    return 'member';
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 404) return 'not_member';
    return 'error';
  }
}

/**
 * Resolve Discord username (username#discriminator) to numeric Discord ID
 * Searches in the guild to find the user by username
 */
export async function resolveDiscordIdFromUsername(usernameInput: string): Promise<string | null> {
  console.log('[DISCORD-RESOLVE] Attempting to resolve username to ID:', usernameInput);
  const normalizedInput = normalizeDiscordInput(usernameInput);

  if (!normalizedInput) {
    console.warn('[DISCORD-RESOLVE] Empty username input');
    return null;
  }

  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.warn('[DISCORD-RESOLVE] Bot token or guild ID not configured');
    return null;
  }

  try {
    const guildId = process.env.DISCORD_GUILD_ID;
    const headers = {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    };

    const discordIdCandidate = extractDiscordIdCandidate(normalizedInput);
    if (discordIdCandidate) {
      if (isValidDiscordSnowflake(discordIdCandidate)) {
        const memberStatus = await checkGuildMembershipByDiscordId(guildId, discordIdCandidate, headers);
        if (memberStatus === 'member') {
          console.log('[DISCORD-RESOLVE] Valid Discord ID and guild member:', discordIdCandidate);
          return discordIdCandidate;
        }
        if (memberStatus === 'not_member') {
          console.warn('[DISCORD-RESOLVE] Discord ID is valid but user is not in guild:', discordIdCandidate);
          return null;
        }
        console.warn('[DISCORD-RESOLVE] Failed to verify guild membership for Discord ID:', discordIdCandidate);
        return null;
      }

      console.warn('[DISCORD-RESOLVE] Input looks like Discord ID but is not a valid snowflake:', normalizedInput);
    }

    // Extract username from "username#discriminator" or just "username"
    const username = normalizedInput.split('#')[0];

    console.log('[DISCORD-RESOLVE] Searching for username in guild:', {
      guildId,
      searchQuery: username,
      originalInput: normalizedInput
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

    if (normalizedInput.includes('#')) {
      // Search for exact username#discriminator match
      const [searchUsername, searchDiscriminator] = normalizedInput.split('#');
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
          m.user.username.toLowerCase() === normalizedInput.split('#')[0].toLowerCase()
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
      input: normalizedInput,
      resolvedId: discordId,
      username: targetMember.user.username,
      discriminator: targetMember.user.discriminator
    });

    return discordId;
  } catch (error: any) {
    console.error('[DISCORD-RESOLVE] Error resolving username:', {
      input: normalizedInput,
      httpStatus: error.response?.status,
      errorData: error.response?.data,
      errorMessage: error.message
    });
    return null;
  }
}

export async function validateDiscordId(
  discordInput: string
): Promise<{ discordId: string; nickname: string } | null> {
  const normalizedInput = normalizeDiscordInput(discordInput);
  if (!normalizedInput) {
    return null;
  }

  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) {
    return null;
  }

  const candidateId = extractDiscordIdCandidate(normalizedInput);
  if (!candidateId || !isValidDiscordSnowflake(candidateId)) {
    return null;
  }

  try {
    const response = await axios.get(
      `${DISCORD_API_URL}/guilds/${process.env.DISCORD_GUILD_ID}/members/${candidateId}`,
      {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const member = response.data;
    return {
      discordId: candidateId,
      nickname: member?.nick || member?.user?.username || candidateId,
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}
