/**
 * Unit tests of the localized in-app notification text (audit finding 39).
 *
 * Notifications are written once per recipient in that recipient's profile
 * language and timezone, so these tests pin the language choice, the English
 * fallback, the team sentence, and the timezone handling of slot ranges.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { challengeNotification, formatRangesForRecipient, seriesNotification } from './notificationText.js';
import type { TimeRange } from '../utils/slotGrouping.js';

const range = (start: string, end: string): TimeRange => ({ start: new Date(start), end: new Date(end), hours: '' });

describe('challengeNotification', () => {
  it('writes the title and body in the recipient language', () => {
    const render = challengeNotification('challenge_rejected', 'Ana');
    assert.deepEqual(render({ language: 'es', timezone: 'UTC' }), {
      title: '❌ Horario del reto rechazado',
      message: 'Ana ha rechazado tu propuesta.',
    });
  });

  it('falls back to English for an unknown or missing language', () => {
    const render = challengeNotification('challenge_cancelled', 'Ana');
    assert.equal(render({ language: 'xx', timezone: null }).message, 'Ana cancelled the challenge proposal.');
    assert.equal(render({ language: null, timezone: null }).message, 'Ana cancelled the challenge proposal.');
  });

  it('lists the slots below the sentence', () => {
    const render = challengeNotification('challenge_proposal', 'Ana', [range('2027-02-13T18:00:00Z', '2027-02-13T19:30:00Z')]);
    const { message } = render({ language: 'en', timezone: 'UTC' });
    assert.equal(message.split('\n')[0], 'Ana challenges you and proposes these times:');
    assert.match(message.split('\n')[1], /^• .*6:00.*7:30.*\(UTC\)$/);
  });
});

describe('seriesNotification', () => {
  it('names both teams with their members in a team series', () => {
    const render = seriesNotification('schedule_rejected', {
      tournament: 'Cup',
      actor: 'Ana',
      teams: [{ name: 'Red', members: ['Ana', 'Bob'] }, { name: 'Blue', members: ['Cid', 'Dan'] }],
    });
    assert.deepEqual(render({ language: 'en', timezone: 'UTC' }), {
      title: '❌ Schedule rejected - Cup',
      message: 'Ana (Red) rejected the schedule for the series Red (Ana, Bob) vs Blue (Cid, Dan).',
    });
  });

  it('uses the 1v1 sentence without teams', () => {
    const render = seriesNotification('schedule_cancelled', { tournament: 'Cup', actor: 'Ana' });
    assert.equal(
      render({ language: 'de', timezone: 'UTC' }).message,
      'Ana hat den Terminvorschlag für deine Turnierserie zurückgezogen.',
    );
  });
});

describe('formatRangesForRecipient', () => {
  it('formats in the recipient timezone and names it', () => {
    const line = formatRangesForRecipient([range('2027-02-13T18:00:00Z', '2027-02-13T19:30:00Z')], {
      language: 'es',
      timezone: 'Europe/Madrid',
    });
    assert.match(line, /^• .*19:00 – 20:30 \(Europe\/Madrid\)$/);
  });

  it('shows the end date when the range crosses local midnight', () => {
    const line = formatRangesForRecipient([range('2027-02-13T22:30:00Z', '2027-02-13T23:30:00Z')], {
      language: 'en',
      timezone: 'Europe/Madrid',
    });
    assert.match(line, /Feb 13.*Feb 14/);
  });

  it('falls back to UTC for an invalid profile timezone', () => {
    const line = formatRangesForRecipient([range('2027-02-13T18:00:00Z', '2027-02-13T19:30:00Z')], {
      language: 'en',
      timezone: 'Not/AZone',
    });
    assert.match(line, /\(UTC\)$/);
  });
});
