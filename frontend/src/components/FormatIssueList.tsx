import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TournamentFormatDefinition } from '../types/tournament';
import { describeFormatIssue, type FormatValidationIssue } from '../utils/formatIssues';

interface Props {
  issues: FormatValidationIssue[];
  /** The definition that was submitted, used to name phases and groups. */
  definition?: TournamentFormatDefinition | null;
}

/**
 * Lists what the organizer must fix in the phase format after the backend
 * rejected it. Rendered next to the page's error banner; renders nothing when
 * there are no issues.
 */
const FormatIssueList: React.FC<Props> = ({ issues, definition }) => {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  // The list appears after submitting a long form whose button sits far below
  // the page's message area, so it scrolls itself into view when it changes.
  useEffect(() => {
    if (issues.length > 0) container.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [issues]);
  if (issues.length === 0) return null;
  return (
    <div ref={container} className="bg-red-50 border-l-4 border-red-500 text-red-800 px-4 py-3 rounded-md mb-6" role="alert">
      <p className="font-semibold mb-1">{t('format_issues_title')}</p>
      <ul className="list-disc pl-5 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.path}-${issue.code}-${index}`}>{describeFormatIssue(issue, definition, t)}</li>
        ))}
      </ul>
    </div>
  );
};

export default FormatIssueList;
