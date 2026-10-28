/**
 * Unit tests of the rate-limit bucket key (audit finding 1, IPv6 follow-up).
 *
 * A client must not escape the limiter by rotating the interface identifier of
 * its IPv6 address, and a dual-stack socket must not give an IPv4 client a
 * second bucket through the IPv4-mapped form.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rateLimitKeyForAddress } from './rateLimitKey.js';

describe('rateLimitKeyForAddress', () => {
  it('keeps IPv4 addresses unchanged', () => {
    assert.equal(rateLimitKeyForAddress('203.0.113.7'), '203.0.113.7');
  });

  it('collapses IPv4-mapped IPv6 addresses to IPv4', () => {
    assert.equal(rateLimitKeyForAddress('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(rateLimitKeyForAddress('::FFFF:cb00:7107'), '203.0.113.7');
  });

  it('groups every address of one /64 into the same key', () => {
    const a = rateLimitKeyForAddress('2001:db8:0:1:1111:2222:3333:4444');
    const b = rateLimitKeyForAddress('2001:0db8:0000:0001:abcd::1');
    assert.equal(a, '2001:db8:0:1::/64');
    assert.equal(b, a);
  });

  it('keeps different /64 prefixes apart', () => {
    assert.notEqual(
      rateLimitKeyForAddress('2001:db8:0:1::1'),
      rateLimitKeyForAddress('2001:db8:0:2::1')
    );
  });

  it('expands the zero-run shorthand at either end', () => {
    assert.equal(rateLimitKeyForAddress('::1'), '0:0:0:0::/64');
    assert.equal(rateLimitKeyForAddress('fe80::'), 'fe80:0:0:0::/64');
  });

  it('drops a zone index', () => {
    assert.equal(rateLimitKeyForAddress('fe80::1%eth0'), 'fe80:0:0:0::/64');
  });

  it('does not treat other embedded IPv4 forms as IPv4-mapped', () => {
    assert.equal(rateLimitKeyForAddress('64:ff9b::203.0.113.7'), '64:ff9b:0:0::/64');
  });

  it('falls back to a shared bucket for missing or unparsable input', () => {
    assert.equal(rateLimitKeyForAddress(undefined), 'unknown');
    assert.equal(rateLimitKeyForAddress(''), 'unknown');
    assert.equal(rateLimitKeyForAddress('not-an-ip'), 'unknown');
  });
});
