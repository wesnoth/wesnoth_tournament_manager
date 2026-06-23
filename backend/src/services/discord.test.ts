/**
 * Unit Tests for Discord Service
 * Tests core functions without external API calls
 */

// ============================================================================
// TEST UTILITIES
// ============================================================================

interface TestResult {
  passed: boolean;
  name: string;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ passed: true, name });
    console.log(`✓ ${name}`);
  } catch (error: any) {
    results.push({ passed: false, name, error: error.message });
    console.error(`✗ ${name}: ${error.message}`);
  }
}

function assertEquals(actual: any, expected: any, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${expected}, got ${actual}`
    );
  }
}

function assertTrue(value: any, message?: string): void {
  if (!value) {
    throw new Error(message || `Expected truthy value, got ${value}`);
  }
}

function assertFalse(value: any, message?: string): void {
  if (value) {
    throw new Error(message || `Expected falsy value, got ${value}`);
  }
}

function assertNull(value: any, message?: string): void {
  if (value !== null) {
    throw new Error(message || `Expected null, got ${value}`);
  }
}

// ============================================================================
// FUNCTIONS TO TEST (copy from discord.ts for pure unit testing)
// ============================================================================

const DISCORD_EPOCH_MS = 1420070400000n;
const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;
const DISCORD_USER_MENTION_REGEX = /^<@!?(\d{17,20})>$/;

function normalizeDiscordInput(input: string): string {
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

// ============================================================================
// TESTS
// ============================================================================

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║            Discord Service Unit Tests - Level 1             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// ─────────────────────────────────────────────────────────────────────────
// TEST SUITE 1: normalizeDiscordInput()
// ─────────────────────────────────────────────────────────────────────────

console.log('📋 Test Suite 1: normalizeDiscordInput()\n');

test('Should trim leading whitespace', () => {
  const result = normalizeDiscordInput('  john  ');
  assertEquals(result, 'john', 'Whitespace should be trimmed');
});

test('Should trim trailing whitespace', () => {
  const result = normalizeDiscordInput('john  ');
  assertEquals(result, 'john');
});

test('Should handle mixed whitespace', () => {
  const result = normalizeDiscordInput('  \t  john  \n  ');
  assertEquals(result, 'john');
});

test('Should remove control character (0x00)', () => {
  const result = normalizeDiscordInput('jo\x00hn');
  assertEquals(result, 'john', 'Null byte should be removed');
});

test('Should remove control characters (0x01-0x1F)', () => {
  const result = normalizeDiscordInput('jo\x01hn');
  assertEquals(result, 'john');
});

test('Should remove DEL character (0x7F)', () => {
  const result = normalizeDiscordInput('jo\x7Fhn');
  assertEquals(result, 'john');
});

test('Should preserve valid characters', () => {
  const result = normalizeDiscordInput('user_name-123');
  assertEquals(result, 'user_name-123');
});

test('Should preserve alphanumeric and special chars', () => {
  const result = normalizeDiscordInput('User@123#456');
  assertEquals(result, 'User@123#456');
});

test('Should handle empty string', () => {
  const result = normalizeDiscordInput('   ');
  assertEquals(result, '');
});

// ─────────────────────────────────────────────────────────────────────────
// TEST SUITE 2: extractDiscordIdCandidate()
// ─────────────────────────────────────────────────────────────────────────

console.log('\n📋 Test Suite 2: extractDiscordIdCandidate()\n');

test('Should extract ID from mention format <@123456789012345678>', () => {
  const result = extractDiscordIdCandidate('<@123456789012345678>');
  assertEquals(result, '123456789012345678');
});

test('Should extract ID from mention format with ! (<@!123456789012345678>)', () => {
  const result = extractDiscordIdCandidate('<@!123456789012345678>');
  assertEquals(result, '123456789012345678');
});

test('Should recognize 17-digit snowflake', () => {
  const result = extractDiscordIdCandidate('12345678901234567');
  assertEquals(result, '12345678901234567');
});

test('Should recognize 18-digit snowflake', () => {
  const result = extractDiscordIdCandidate('123456789012345678');
  assertEquals(result, '123456789012345678');
});

test('Should recognize 19-digit snowflake', () => {
  const result = extractDiscordIdCandidate('1234567890123456789');
  assertEquals(result, '1234567890123456789');
});

test('Should recognize 20-digit snowflake', () => {
  const result = extractDiscordIdCandidate('12345678901234567890');
  assertEquals(result, '12345678901234567890');
});

test('Should reject < 17 digits', () => {
  const result = extractDiscordIdCandidate('1234567890123456');
  assertNull(result, 'Should return null for <17 digits');
});

test('Should reject > 20 digits', () => {
  const result = extractDiscordIdCandidate('123456789012345678901');
  assertNull(result, 'Should return null for >20 digits');
});

test('Should reject username (no match)', () => {
  const result = extractDiscordIdCandidate('john');
  assertNull(result, 'Username should not match');
});

test('Should reject invalid mention format', () => {
  const result = extractDiscordIdCandidate('<john>');
  assertNull(result, 'Invalid mention format should not match');
});

test('Should reject ID with letters', () => {
  const result = extractDiscordIdCandidate('12345678901234567a');
  assertNull(result, 'ID with letters should not match');
});

// ─────────────────────────────────────────────────────────────────────────
// TEST SUITE 3: isValidDiscordSnowflake()
// ─────────────────────────────────────────────────────────────────────────

console.log('\n📋 Test Suite 3: isValidDiscordSnowflake()\n');

test('Should reject non-numeric strings', () => {
  const result = isValidDiscordSnowflake('abc123def456');
  assertFalse(result, 'Non-numeric should be invalid');
});

test('Should reject too short ID', () => {
  const result = isValidDiscordSnowflake('1234567890123456');
  assertFalse(result, '<17 digits should be invalid');
});

test('Should reject too long ID', () => {
  const result = isValidDiscordSnowflake('123456789012345678901');
  assertFalse(result, '>20 digits should be invalid');
});

test('Should reject zero', () => {
  const result = isValidDiscordSnowflake('00000000000000000');
  assertFalse(result, 'Zero should be invalid');
});

test('Should reject negative values', () => {
  const result = isValidDiscordSnowflake('-1234567890123456789');
  assertFalse(result, 'Negative should be invalid');
});

test('Should accept valid snowflake (current timestamp)', () => {
  // Create a valid snowflake: timestamp bits + worker + process + increment
  // For current time: (Date.now() - 1420070400000) << 22
  const validSnowflake = ((BigInt(Date.now()) - DISCORD_EPOCH_MS) << 22n).toString();
  if (validSnowflake.length >= 17 && validSnowflake.length <= 20) {
    const result = isValidDiscordSnowflake(validSnowflake);
    assertTrue(result, 'Current timestamp snowflake should be valid');
  }
});

test('Should accept valid historical snowflake (Discord launch)', () => {
  // Snowflake from Discord epoch: 1420070400000 in ms, left shift 22
  // = 00000000000000000001 (after shifting)
  // A minimal valid snowflake: all zeros + 1 increment
  const result = isValidDiscordSnowflake('00000000000000001');
  assertTrue(result, 'Epoch snowflake should be valid');
});

test('Should reject future snowflake (>1 year ahead)', () => {
  const futureTime = BigInt(Date.now()) + BigInt(400 * 24 * 60 * 60 * 1000);
  const futureSnowflake = ((futureTime - DISCORD_EPOCH_MS) << 22n).toString();
  const result = isValidDiscordSnowflake(futureSnowflake);
  assertFalse(result, 'Snowflake >1 year in future should be invalid');
});

// ─────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                       TEST SUMMARY                         ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const total = results.length;

console.log(`Total:  ${total}`);
console.log(`Passed: ${passed} ✓`);
console.log(`Failed: ${failed} ✗\n`);

if (failed > 0) {
  console.log('Failed tests:');
  results.filter((r) => !r.passed).forEach((r) => {
    console.log(`  ✗ ${r.name}`);
    console.log(`    → ${r.error}`);
  });
  process.exit(1);
} else {
  console.log('✅ All tests passed!\n');
  process.exit(0);
}
