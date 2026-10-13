import { translate } from '../i18n/translationService.js';
import type { TimeRange } from '../utils/slotGrouping.js';

/** Profile settings that decide how one recipient's notification is written. */
export interface NotificationRecipient {
  language: string | null;
  timezone: string | null;
}

/** Title and body stored for one recipient. */
export interface NotificationContent {
  title: string;
  message: string;
}

/** Renders a notification for one recipient (see storeNotificationForUsers). */
export type NotificationRenderer = (recipient: NotificationRecipient) => NotificationContent;

/** One side of a team series with its members, as named in the message. */
export interface NotificationTeam {
  name: string;
  members: string[];
}

export type ChallengeNotificationType =
  | 'challenge_proposal'
  | 'challenge_confirmed'
  | 'challenge_rejected'
  | 'challenge_counter_proposal'
  | 'challenge_updated'
  | 'challenge_cancelled';

export type SeriesNotificationType =
  | 'schedule_proposal'
  | 'schedule_confirmed'
  | 'schedule_rejected'
  | 'schedule_changed'
  | 'schedule_cancelled';

/**
 * Title icons, kept out of the locale files so translators never have to
 * preserve them and every language shows the same marker.
 */
const ICONS: Record<ChallengeNotificationType | SeriesNotificationType, string> = {
  challenge_proposal: '🗓️',
  challenge_confirmed: '✅',
  challenge_rejected: '❌',
  challenge_counter_proposal: '🔄',
  challenge_updated: '🔄',
  challenge_cancelled: '🚫',
  schedule_proposal: '🗓️',
  schedule_confirmed: '✅',
  schedule_rejected: '❌',
  schedule_changed: '🔄',
  schedule_cancelled: '🚫',
};

/**
 * Return the timezone when Intl accepts it, otherwise UTC. Profiles store
 * free-form IANA names, and one invalid value must not stop the notification
 * from being stored for that recipient.
 */
const usableTimezone = (timezone: string | null): string => {
  if (!timezone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
};

/**
 * Format slot ranges as bullet lines in the recipient's language and profile
 * timezone, naming the timezone so the reader knows which clock is meant.
 * Ranges are contiguous 30-minute slots, so they normally end on the same
 * local day and the end shows only its time; a range crossing local midnight
 * shows the end date too, so the line never suggests an end before its start.
 * The notification is stored as text, so this is fixed at write time: a later
 * change of profile language or timezone does not rewrite old notifications.
 */
export const formatRangesForRecipient = (ranges: TimeRange[], recipient: NotificationRecipient): string => {
  const language = recipient.language || 'en';
  const timeZone = usableTimezone(recipient.timezone);
  const dateTime = new Intl.DateTimeFormat(language, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const time = new Intl.DateTimeFormat(language, { timeZone, timeStyle: 'short' });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return ranges.map((range) => {
    const sameDay = day.format(range.start) === day.format(range.end);
    return `• ${dateTime.format(range.start)} – ${sameDay ? time.format(range.end) : dateTime.format(range.end)} (${timeZone})`;
  }).join('\n');
};

/** Join the sentence and, when it names slots, the formatted slot lines. */
const withRanges = (sentence: string, ranges: TimeRange[] | undefined, recipient: NotificationRecipient): string =>
  ranges && ranges.length ? `${sentence}\n${formatRangesForRecipient(ranges, recipient)}` : sentence;

/**
 * Notification for a P2P challenge event, written in each recipient's profile
 * language. `ranges` is passed only for events whose sentence introduces a
 * list of times (proposal, confirmation, counter-proposal, update). Notes are
 * not repeated here: they are stored in `message_extra`, which the UI shows on
 * its own.
 */
export const challengeNotification = (
  type: ChallengeNotificationType,
  actor: string,
  ranges?: TimeRange[]
): NotificationRenderer => (recipient) => ({
  title: `${ICONS[type]} ${translate(recipient.language, `notifications.${type}.title`)}`,
  message: withRanges(translate(recipient.language, `notifications.${type}.message`, { actor }), ranges, recipient),
});

/** "Red (Ana, Bob)", or the bare team name when the roster is unknown. */
const teamLabel = (team: NotificationTeam): string =>
  team.members.length ? `${team.name} (${team.members.join(', ')})` : team.name;

/**
 * Notification for a tournament series schedule event. Team series use
 * whole-sentence keys (`message_team`) that name the actor's team and both
 * sides with their members, instead of inserting a translated "the series ..."
 * fragment into the 1v1 sentence, because word order and grammatical case
 * differ between the supported languages.
 */
export const seriesNotification = (
  type: SeriesNotificationType,
  details: {
    tournament: string;
    actor: string;
    ranges?: TimeRange[];
    /** Team series only: the actor's team first, then the opponent. */
    teams?: [NotificationTeam, NotificationTeam];
  }
): NotificationRenderer => (recipient) => {
  const { tournament, actor, ranges, teams } = details;
  const sentence = teams
    ? translate(recipient.language, `notifications.${type}.message_team`, {
        actor,
        team: teams[0].name,
        home: teamLabel(teams[0]),
        away: teamLabel(teams[1]),
      })
    : translate(recipient.language, `notifications.${type}.message`, { actor });
  return {
    title: `${ICONS[type]} ${translate(recipient.language, `notifications.${type}.title`, { tournament })}`,
    message: withRanges(sentence, ranges, recipient),
  };
};
