import { isIP } from 'node:net';

/**
 * Number of leading IPv6 bits that identify one client for rate limiting.
 *
 * A /64 is the smallest prefix routinely delegated to a single subscriber or
 * LAN (SLAAC requires it), and privacy extensions rotate the low 64 bits at
 * will. Keying on the full address would therefore let one client spread its
 * requests over 2^64 distinct counters. Grouping by /64 can merge devices that
 * share one home network, which is the same trade-off IPv4 NAT already imposes.
 */
const IPV6_CLIENT_PREFIX_HEXTETS = 4;

/**
 * Expand a textual IPv6 address into its eight 16-bit groups.
 *
 * Handles the `::` zero-run shorthand and a trailing dotted IPv4 part
 * (`::ffff:192.0.2.1`). The caller must have validated the address with
 * `isIP(...) === 6`, so malformed input is not re-checked here.
 */
const expandIPv6 = (address: string): number[] => {
  let text = address;
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const lastPart = text.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    // An embedded IPv4 part occupies the last two groups.
    const [a, b, c, d] = lastPart.split('.').map(Number);
    tail.push((a << 8) | b, (c << 8) | d);
    text = text.slice(0, lastColon + 1);
    // Keep a well-formed shorthand: "::" stays, but "x:" loses its separator.
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }

  const parseGroups = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((group) => parseInt(group, 16));

  const [headText, tailText] = text.split('::');
  const head = parseGroups(headText);
  const rest = tailText === undefined ? [] : parseGroups(tailText);
  const zeros = 8 - head.length - rest.length - tail.length;
  return [...head, ...new Array(Math.max(zeros, 0)).fill(0), ...rest, ...tail];
};

/**
 * Derive the rate-limit bucket key for a client address.
 *
 * - IPv4 addresses are used as they are.
 * - IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`, how a dual-stack socket
 *   reports IPv4 peers) collapse to the plain IPv4 form, so the same client
 *   never gets two buckets depending on the listening socket.
 * - Any other IPv6 address is reduced to its /64 prefix
 *   (see {@link IPV6_CLIENT_PREFIX_HEXTETS}); a zone index (`%eth0`) is dropped.
 * - A missing or unparsable value falls back to a shared `unknown` bucket, so
 *   an unexpected address format is limited rather than exempted.
 *
 * @param address Client address as resolved by Express (`req.ip`, which
 *   already honours the `trust proxy` setting).
 * @returns Stable key such as `203.0.113.7` or `2001:db8:0:1::/64`.
 */
export const rateLimitKeyForAddress = (address: string | undefined | null): string => {
  if (!address) return 'unknown';
  const withoutZone = address.split('%')[0];
  const family = isIP(withoutZone);
  if (family === 4) return withoutZone;
  if (family !== 6) return 'unknown';

  const groups = expandIPv6(withoutZone);
  const isIPv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isIPv4Mapped) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }

  const prefix = groups.slice(0, IPV6_CLIENT_PREFIX_HEXTETS).map((group) => group.toString(16)).join(':');
  return `${prefix}::/64`;
};
