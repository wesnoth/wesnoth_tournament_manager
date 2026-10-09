import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tournamentService } from '../services/api';
import MarkdownPreview from './MarkdownPreview';
import type { TournamentDetails, TournamentRuleVersion } from '../types/tournament';
import { formatTournamentDate } from '../utils/tournamentStatus';

interface TournamentRulesPanelProps {
  tournament: Pick<TournamentDetails, 'id' | 'description' | 'rules_content'>;
  rulesHistory: TournamentRuleVersion[];
  /** Organizers may edit the rules until the tournament is completed. */
  canEdit: boolean;
  /** Reload the tournament and its rules history after a save. */
  onSaved: () => Promise<void>;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const descriptionRulesStateKey = (tournamentId: string) =>
  `tournament-detail:${tournamentId}:description-rules-open`;

function readDescriptionRulesState(tournamentId: string): boolean | null {
  try {
    const storedValue = sessionStorage.getItem(descriptionRulesStateKey(tournamentId));
    return storedValue === null ? null : storedValue === 'true';
  } catch {
    // Storage can be unavailable in restricted browser contexts; the UI still works in memory.
    return null;
  }
}

/**
 * Collapsible description and rules of a tournament, with the rules history
 * selector and the organizers' live rules editor.
 *
 * Render it with `key={tournament.id}`: the open/closed state is remembered
 * per tournament in sessionStorage and read on mount, so a remount is what
 * keeps one tournament's state from being written under another's id.
 */
const TournamentRulesPanel: React.FC<TournamentRulesPanelProps> = ({
  tournament,
  rulesHistory,
  canEdit,
  onSaved,
  onSuccess,
  onError,
}) => {
  const { t } = useTranslation();
  const [descriptionRulesOpen, setDescriptionRulesOpen] = useState<boolean>(() =>
    readDescriptionRulesState(tournament.id) ?? true
  );
  const [selectedRulesVersion, setSelectedRulesVersion] = useState<number | null>(null);
  const [rulesEditMode, setRulesEditMode] = useState(false);
  const [rulesDraft, setRulesDraft] = useState('');
  const [rulesSaving, setRulesSaving] = useState(false);
  const rulesEditorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(descriptionRulesStateKey(tournament.id), String(descriptionRulesOpen));
    } catch {
      // Storage failures should not prevent the user from toggling the section.
    }
  }, [descriptionRulesOpen, tournament.id]);

  // A reloaded history may no longer contain the version being viewed.
  useEffect(() => {
    setSelectedRulesVersion(null);
  }, [rulesHistory]);

  useEffect(() => {
    if (!rulesEditMode || !rulesEditorRef.current) return;

    // Move the editor into view after it mounts so the organizer can start typing immediately.
    rulesEditorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    rulesEditorRef.current.focus({ preventScroll: true });
  }, [rulesEditMode]);

  const selectedRules = selectedRulesVersion === null
    ? null
    : rulesHistory.find((version) => version.version_number === selectedRulesVersion) || null;
  const displayedRulesContent = selectedRules?.rules_content ?? tournament.rules_content ?? '';

  const handleSaveRules = async () => {
    if (!canEdit) return;

    try {
      setRulesSaving(true);
      await tournamentService.updateTournament(tournament.id, { rules_content: rulesDraft });
      setRulesEditMode(false);
      onSuccess(t('tournament.rules_updated', 'Tournament rules updated successfully'));
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.error || t('tournament.rules_update_failed', 'Failed to update tournament rules'));
    } finally {
      setRulesSaving(false);
    }
  };

  return (
    <details
      className="mt-4"
      open={descriptionRulesOpen}
      onToggle={(event) => setDescriptionRulesOpen(event.currentTarget.open)}
    >
      <summary
        data-help-id="action-toggle-tournament-description-rules"
        className="cursor-pointer select-none font-semibold text-gray-800 marker:text-gray-500"
      >
        {t('label_description')} &amp; {t('tournament.rules_content', 'Tournament Rules')}
      </summary>
      <div className="mt-3 space-y-4">
        <div>
          <strong>{t('label_description')}:</strong>
          <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
            <MarkdownPreview
              markdown={tournament.description || ''}
              emptyMessage={t('tournament.description_preview_empty', 'No description configured for this tournament.')}
            />
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <strong>{t('tournament.rules_content', 'Tournament Rules')}:</strong>
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span>{t('tournament.rules_history', 'Rules history')}</span>
              <select
                data-help-id="option-tournament-rules-history"
                value={selectedRulesVersion ?? ''}
                onChange={(event) => setSelectedRulesVersion(event.target.value ? Number(event.target.value) : null)}
                className="rounded border border-gray-300 bg-white px-2 py-1"
              >
                <option value="">{t('tournament.rules_current_version', 'Current rules')}</option>
                {rulesHistory.map((version) => (
                  <option key={version.version_number} value={version.version_number}>
                    {t('tournament.rules_version_with_date', 'Version {{version}} · {{date}}', {
                      version: version.version_number,
                      date: formatTournamentDate(t, version.changed_at),
                    })}
                  </option>
                ))}
              </select>
              {canEdit && !rulesEditMode && (
                <button
                  data-help-id="action-edit-tournament-rules"
                  type="button"
                  onClick={() => {
                    setRulesDraft(tournament.rules_content || tournament.description || '');
                    setSelectedRulesVersion(null);
                    setRulesEditMode(true);
                  }}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {t('tournament.edit_rules', 'Edit Rules')}
                </button>
              )}
            </div>
          </div>
          {selectedRules && (
            <p className="mt-1 text-xs text-gray-500">
              {t('tournament.rules_changed_at', 'Changed {{date}} by {{user}}', {
                date: formatTournamentDate(t, selectedRules.changed_at),
                user: selectedRules.changed_by_nickname || t('tournament.unknown_user', 'Unknown user'),
              })}
            </p>
          )}
          {rulesEditMode ? (
            <div data-help-id="region-tournament-rules-live-edit" className="mt-2 space-y-3">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-gray-600">
                    {t('tournament.editor', 'Editor')}
                  </span>
                  <textarea
                    data-help-id="field-tournament-rules-live-edit"
                    ref={rulesEditorRef}
                    value={rulesDraft}
                    onChange={(event) => setRulesDraft(event.target.value)}
                    rows={12}
                    disabled={rulesSaving}
                    className="w-full resize-y rounded border border-gray-300 bg-white p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                  />
                </div>
                <div data-help-id="region-tournament-rules-live-edit-preview" className="rounded border border-gray-200 bg-gray-50 p-4">
                  <h4 className="mb-2 font-semibold text-gray-800">
                    {t('tournament.rules_preview', 'Rules Preview')}
                  </h4>
                  <MarkdownPreview
                    markdown={rulesDraft}
                    emptyMessage={t('tournament.rules_preview_empty', 'No rules configured for this tournament.')}
                  />
                </div>
              </div>
              <small className="text-gray-600">
                {t('tournament.rules_markdown_help', 'Markdown syntax is supported, using the same renderer as Wiki Help.')}
              </small>
              <div className="flex flex-wrap gap-2">
                <button
                  data-help-id="action-save-tournament-rules"
                  type="button"
                  onClick={handleSaveRules}
                  disabled={rulesSaving}
                  className="rounded bg-indigo-500 px-4 py-2 text-white hover:bg-indigo-600 disabled:opacity-50"
                >
                  {rulesSaving ? t('tournament.rules_saving', 'Saving...') : t('common.save', 'Save')}
                </button>
                <button
                  data-help-id="action-cancel-tournament-rules-edit"
                  type="button"
                  onClick={() => setRulesEditMode(false)}
                  disabled={rulesSaving}
                  className="rounded bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300 disabled:opacity-50"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
              <MarkdownPreview
                markdown={displayedRulesContent}
                emptyMessage={t('tournament.rules_preview_empty', 'No rules configured for this tournament.')}
              />
            </div>
          )}
        </div>
      </div>
    </details>
  );
};

export default TournamentRulesPanel;
