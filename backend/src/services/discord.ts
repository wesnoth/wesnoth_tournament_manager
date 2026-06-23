import axios from 'axios';

const DISCORD_API_URL = 'https://discord.com/api/v10';
const DISCORD_EPOCH_MS = 1420070400000n; // 2015-01-01T00:00:00.000Z
const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;
const DISCORD_USER_MENTION_REGEX = /^<@!?(\d{17,20})>$/;

// Check if Discord is explicitly enabled via environment variable
export const DISCORD_ENABLED = process.env.DISCORD_ENABLED === 'true';

function normalizeDiscordInput(input: string): string {
  // Remove leading/trailing whitespace and control characters (0x00-0x1F, 0x7F)
  return input.trim().replace(/[\x00-\x1F\x7F]/g, '');
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

async function checkGuildMembershipByDiscordId(
  guildId: string,
  discordId: string,
  headers: Record<string, string>
): Promise<'member' | 'not_member' | 'error'> {
  try {
    await axios.head(`${DISCORD_API_URL}/guilds/${guildId}/members/${discordId}`, { headers });
    return 'member';
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 404) return 'not_member';
    return 'error';
  }
}

/**
 * Resolve Discord ID or mention to numeric Discord ID
 * Strategy: Try by ID first (preferred), fallback to legacy username search
 * 
 * 1. If input is valid Discord ID (17-20 digits) or mention format (<@123456789>):
 *    → Extract ID and check guild membership
 *    → Return ID if member, null if not
 * 
 * 2. If ID validation fails or input is username:
 *    → Fall back to username search (DEPRECATED)
 *    → Log deprecation warning for tracking
 *    → Return first match (legacy behavior)
 */
export async function resolveDiscordIdFromUsername(usernameInput: string): Promise<string | null> {
  console.log('[DISCORD-RESOLVE] Attempting to resolve to ID:', usernameInput);
  const normalizedInput = normalizeDiscordInput(usernameInput);

  if (!normalizedInput) {
    console.warn('[DISCORD-RESOLVE] Empty input');
    return null;
  }

  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn('[DISCORD-RESOLVE] Bot token not configured');
    return null;
  }

  if (!process.env.DISCORD_GUILD_ID) {
    console.warn('[DISCORD-RESOLVE] Guild ID not configured');
    return null;
  }

  try {
    const guildId = process.env.DISCORD_GUILD_ID;
    const headers = {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // ===== PHASE 1: Try direct ID lookup (preferred, secure) =====
    const discordIdCandidate = extractDiscordIdCandidate(normalizedInput);
    if (discordIdCandidate) {
      if (isValidDiscordSnowflake(discordIdCandidate)) {
        console.log('[DISCORD-RESOLVE] Valid snowflake detected, checking guild membership:', discordIdCandidate);
        const memberStatus = await checkGuildMembershipByDiscordId(guildId, discordIdCandidate, headers);
        if (memberStatus === 'member') {
          console.log('[DISCORD-RESOLVE] Resolved via Discord ID:', discordIdCandidate);
          return discordIdCandidate;
        }
        if (memberStatus === 'not_member') {
          console.warn('[DISCORD-RESOLVE] Discord ID valid but not in guild:', discordIdCandidate);
          return null;
        }
        console.warn('[DISCORD-RESOLVE] Failed to verify guild membership:', discordIdCandidate);
        return null;
      }

      console.warn('[DISCORD-RESOLVE] Input looks like Discord ID but is not valid snowflake:', normalizedInput);
    }

    // ===== PHASE 2: Fallback to username search (deprecated) =====
    console.warn('[DISCORD-RESOLVE] DEPRECATED: Falling back to username search. Users should provide Discord ID or mention instead.');
    
    const username = normalizedInput;

    console.log('[DISCORD-RESOLVE] Searching for username in guild:', {
      guildId,
      searchQuery: username
    });

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
      username: m.user.username
    })));

    // Username search can return multiple results with no guaranteed order
    // Taking first match and logging for audit trail
    console.warn('[DISCORD-RESOLVE] Username search returned multiple potential matches. Using first result.');
    console.warn('[DISCORD-RESOLVE] Matched members:', members.map((m: any) => ({
      id: m.user.id,
      username: m.user.username
    })));

    const targetMember = members[0];
    const discordId = targetMember.user.id;

    console.log('[DISCORD-RESOLVE] Resolved via username search (DEPRECATED):', {
      input: normalizedInput,
      resolvedId: discordId,
      username: targetMember.user.username
    });

    return discordId;
  } catch (error: any) {
    console.error('[DISCORD-RESOLVE] Error resolving Discord ID:', {
      input: normalizedInput,
      httpStatus: error.response?.status,
      errorData: error.response?.data,
      errorMessage: error.message
    });
    return null;
  }
}
