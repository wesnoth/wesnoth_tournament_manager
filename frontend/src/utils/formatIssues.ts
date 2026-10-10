import type { TFunction } from 'i18next';
import type { TournamentFormatDefinition } from '../types/tournament';

/**
 * Highest Swiss round count a phase may declare. It mirrors the backend
 * validator's MAX_SWISS_ROUNDS (the creation API caps the derived
 * `general_rounds` summary at 10); both must change together.
 */
export const MAX_SWISS_ROUNDS = 10;

/** One problem reported by the backend phase-format validator. */
export interface FormatValidationIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * Read the validator issues from a failed tournament request.
 *
 * Creation and format editing answer an invalid phase graph with
 * `400 { error, issues }`. Anything else (other errors, malformed bodies)
 * yields an empty list so callers fall back to the plain error message.
 */
export function readFormatIssues(error: any): FormatValidationIssue[] {
  const issues = error?.response?.data?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter((item): item is FormatValidationIssue =>
    item && typeof item.path === 'string' && typeof item.code === 'string');
}

/**
 * Turn an issue path into a place the organizer recognizes in the editor.
 *
 * Paths come from the backend as `phases[i]`, `phases[i].groups[j]...` or
 * `advancement_rules[k]...`, with zero-based indexes into the submitted
 * definition. The phase editor keeps phases sorted by order, so the index
 * also matches the phase the organizer sees. Names typed in the editor are
 * preferred; numbered labels are the fallback for unnamed or missing items.
 */
function describeLocation(path: string, definition: TournamentFormatDefinition | null | undefined, t: TFunction): string {
  const rule = /^advancement_rules\[(\d+)\]/.exec(path);
  if (rule) return t('format_issue_location_rule', { n: Number(rule[1]) + 1 });

  const phaseMatch = /^phases\[(\d+)\](?:\.groups\[(\d+)\])?/.exec(path);
  if (!phaseMatch) return t('format_issue_location_format');

  const phaseIndex = Number(phaseMatch[1]);
  const phase = definition?.phases?.[phaseIndex];
  const phaseLabel = phase?.name?.trim() || t('format_issue_location_phase', { n: phaseIndex + 1 });
  if (phaseMatch[2] === undefined) return phaseLabel;

  const groupIndex = Number(phaseMatch[2]);
  const group = phase?.groups?.[groupIndex];
  const groupLabel = group?.name?.trim() || t('format_issue_location_group', { n: groupIndex + 1 });
  // The editor names a phase's only group after the phase; repeating the
  // same name ("Final › Final") adds nothing.
  return groupLabel === phaseLabel ? phaseLabel : `${phaseLabel} › ${groupLabel}`;
}

/**
 * Localized, located description of one issue, e.g.
 * "Final › Bracket: This group needs at least two entries…".
 * Unknown codes fall back to the backend's English message so a new
 * validator rule is still readable before it gets a translation.
 */
export function describeFormatIssue(
  issue: FormatValidationIssue,
  definition: TournamentFormatDefinition | null | undefined,
  t: TFunction,
): string {
  const message = t(`format_issue_${issue.code}`, { defaultValue: issue.message, max: MAX_SWISS_ROUNDS });
  return `${describeLocation(issue.path, definition, t)}: ${message}`;
}
