import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import UnrankedFactionSelect from './UnrankedFactionSelect';
import UnrankedMapSelect from './UnrankedMapSelect';
import MarkdownPreview from './MarkdownPreview';
import { tournamentService, userService } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { TournamentFormData, TournamentMode } from '../types/tournament';
import type { TournamentFormatDefinition } from '../types/tournament';
import TournamentPhaseBuilder, { type PhaseBuilderChangeOptions } from './TournamentPhaseBuilder';
import TournamentMapPackSelector from './TournamentMapPackSelector';
import EditableIntegerInput from './EditableIntegerInput';
import { summaryFieldsForFormat } from '../utils/tournamentFormatTemplates';

interface RuleTemplate {
  id: string;
  title: string;
  content_markdown: string;
}

interface UserOption {
  id: string;
  nickname: string;
}

interface TournamentFormProps {
  mode: 'create' | 'edit';
  formData: TournamentFormData;
  onFormDataChange: (data: TournamentFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
  unrankedFactions: string[];
  onUnrankedFactionsChange: (factionIds: string[]) => void;
  unrankedMaps: string[];
  onUnrankedMapsChange: (mapIds: string[]) => void;
  isLoading?: boolean;
  onCancel?: () => void;
  entryOptions?: Array<{ id: string; name: string; direct_group_id?: string | null }>;
}

const toLocalDateTimeValue = (dateValue: string): string => {
  const date = new Date(dateValue);
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
};

const TournamentForm: React.FC<TournamentFormProps> = ({
  mode,
  formData,
  onFormDataChange,
  onSubmit,
  unrankedFactions,
  onUnrankedFactionsChange,
  unrankedMaps,
  onUnrankedMapsChange,
  isLoading = false,
  onCancel,
  entryOptions = [],
}) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();
  const [ruleTemplates, setRuleTemplates] = useState<RuleTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [organizerCandidateId, setOrganizerCandidateId] = useState('');

  const handlePhaseFormatChange = (definition: TournamentFormatDefinition, options?: PhaseBuilderChangeOptions) => {
    onFormDataChange({
      ...formData,
      format_definition: definition,
      ...summaryFieldsForFormat(definition),
      // Sticky for the whole edit: once a removal released passes, a later
      // change in the same session must not withdraw that consent.
      ...(options?.releasesDirectPasses || formData.release_removed_direct_passes ? { release_removed_direct_passes: true } : {}),
    });
  };

  useEffect(() => {
    const loadRuleTemplatesAndUsers = async () => {
      try {
        setTemplatesLoading(true);
        const [templatesRes, usersRes] = await Promise.all([
          tournamentService.getRuleTemplates(),
          userService.getAllUsers(),
        ]);
        const users = usersRes.data?.data || usersRes.data || [];
        setRuleTemplates(templatesRes.data || []);
        setAllUsers(Array.isArray(users) ? users : []);
      } catch (error) {
        console.error('Failed to load tournament form data:', error);
      } finally {
        setTemplatesLoading(false);
      }
    };

    loadRuleTemplatesAndUsers();
  }, []);

  const selectedOrganizerIds = formData.organizer_ids || [];
  const extractedForumTopicId = formData.forum_topic_url?.match(/[?&]t=([1-9][0-9]*)/)?.[1] || null;
  const coOrganizerOptions = allUsers.filter(
    (user) => user.id !== userId && !selectedOrganizerIds.includes(user.id)
  );
  const creatorUser = allUsers.find((user) => user.id === userId);
  const selectedCoOrganizers = allUsers.filter((user) => selectedOrganizerIds.includes(user.id));

  const handleAddCoOrganizer = () => {
    if (!organizerCandidateId) return;
    const alreadyAdded = selectedOrganizerIds.includes(organizerCandidateId);
    if (alreadyAdded) return;

    onFormDataChange({
      ...formData,
      organizer_ids: [...selectedOrganizerIds, organizerCandidateId],
    });
    setOrganizerCandidateId('');
  };

  const handleRemoveCoOrganizer = (targetId: string) => {
    onFormDataChange({
      ...formData,
      organizer_ids: selectedOrganizerIds.filter((id) => id !== targetId),
    });
  };

  const handleRuleTemplateChange = (templateId: string) => {
    if (!templateId) {
      onFormDataChange({
        ...formData,
        rules_template_id: null,
      });
      return;
    }

    const selectedTemplate = ruleTemplates.find((tpl) => tpl.id === templateId);
    onFormDataChange({
      ...formData,
      rules_template_id: templateId,
      rules_content: selectedTemplate?.content_markdown || formData.rules_content || '',
    });
  };

  /**
   * Asset pickers per match type. The three variants differ in behavior, not
   * only in title: ranked tournaments may only allow ranked factions and maps.
   */
  const assetSection = (assetsMode: TournamentMode, title: string, help: string, rankedOnly: boolean) => (
    formData.tournament_mode === assetsMode && (
      <details open data-help-id={`region-tournament-assets-${assetsMode}`} className="mb-6 rounded-lg border border-gray-200 bg-white">
        <summary data-help-id="action-toggle-tournament-assets" className="cursor-pointer p-4 font-semibold text-gray-800">{title}</summary>
        <div className="px-4 pb-4">
          <p className="text-sm text-gray-600 italic mb-4">{help}</p>
          <TournamentMapPackSelector selectedMapIds={unrankedMaps} onChange={onUnrankedMapsChange} rankedOnly={rankedOnly} disabled={isLoading} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <UnrankedFactionSelect
              selectedFactionIds={unrankedFactions}
              onChange={onUnrankedFactionsChange}
              disabled={isLoading}
              isRankedOnly={rankedOnly}
            />
            <UnrankedMapSelect
              selectedMapIds={unrankedMaps}
              onChange={onUnrankedMapsChange}
              disabled={isLoading}
              isRankedOnly={rankedOnly}
            />
          </div>
        </div>
      </details>
    )
  );

  const matchTypeOptions: Array<{ value: TournamentMode; label: string }> = [
    { value: 'ranked', label: t('tournament.ranked', 'Ranked (1v1, ELO impact)') },
    { value: 'unranked', label: t('tournament.unranked', 'Unranked (1v1, no ELO)') },
    { value: 'team', label: t('tournament.team', 'Team (2v2, no ELO)') },
  ];

  return (
    <form id="tournament-form" data-help-id="region-tournament-form" className="bg-white rounded-lg shadow-md p-8 space-y-6" onSubmit={onSubmit}>
      {/* SECTION 1: IDENTITY */}
      <details open data-help-id="region-tournament-basic-information" className="mb-6 border border-gray-200 rounded-lg bg-white">
        <summary data-help-id="action-toggle-tournament-basic-information" className="cursor-pointer p-4 font-semibold text-gray-800">{t('tournament.basic_info', 'Basic Information')}</summary>
        <div className="px-4 pb-4">
        <div data-help-id="region-tournament-identity" className={`mb-4 grid grid-cols-1 ${mode === 'create' ? 'xl:grid-cols-2' : ''} gap-4`}>
          {/* Tournament Name */}
          <div className="flex flex-col gap-2">
            <label className="font-medium text-gray-700">{t('tournament_name', 'Tournament Name')}</label>
            <input
              data-help-id="field-tournament-name"
              type="text"
              placeholder={t('tournament_name', 'Tournament Name')}
              value={formData.name}
              onChange={(e) => onFormDataChange({ ...formData, name: e.target.value })}
              required
              disabled={isLoading || (mode === 'edit')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          {mode === 'create' && (
            <div className="flex flex-col gap-2">
              <label className="font-medium text-gray-700">{t('tournament.organizers', 'Organizers')}</label>
              <div className="flex gap-2">
                <select
                  data-help-id="field-tournament-co-organizer"
                  value={organizerCandidateId}
                  onChange={(e) => setOrganizerCandidateId(e.target.value)}
                  disabled={isLoading || templatesLoading}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="">{t('tournament.select_co_organizer', 'Select co-organizer')}</option>
                  {coOrganizerOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.nickname}
                    </option>
                  ))}
                </select>
                <button
                  data-help-id="action-add-tournament-organizer"
                  type="button"
                  onClick={handleAddCoOrganizer}
                  disabled={isLoading || !organizerCandidateId}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
                >
                  +
                </button>
              </div>
              <div className="text-sm text-gray-700">
                <span className="font-medium">{t('tournament.organizers_list', 'Organizers list')}:</span>{' '}
                <span className="font-semibold">{creatorUser?.nickname || t('you', 'You')}</span>
                {selectedCoOrganizers.length > 0 && (
                  <>
                    {', '}
                    {selectedCoOrganizers.map((user, index) => (
                      <React.Fragment key={user.id}>
                        <span>{user.nickname}</span>
                        <button
                          data-help-id="action-remove-tournament-organizer"
                          type="button"
                          onClick={() => handleRemoveCoOrganizer(user.id)}
                          disabled={isLoading}
                          className="ml-1 mr-2 text-red-600 hover:text-red-800 disabled:opacity-50"
                          aria-label={`Remove ${user.nickname}`}
                        >
                          ×
                        </button>
                        {index < selectedCoOrganizers.length - 1 && ', '}
                      </React.Fragment>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <label className="font-medium text-gray-700">{t('tournament.forum_thread_url')}</label>
          <input
            data-help-id="field-tournament-forum-topic-url"
            type="url"
            placeholder="https://forums.wesnoth.org/viewtopic.php?t=60773"
            value={formData.forum_topic_url || ''}
            onChange={(event) => onFormDataChange({ ...formData, forum_topic_url: event.target.value || null })}
            disabled={isLoading}
            pattern="https://forums\.wesnoth\.org/viewtopic\.php\?.*t=[0-9]+.*"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          <small className="text-gray-600">{t('tournament.forum_thread_help')}</small>
          {extractedForumTopicId && <small className="text-green-700">{t('tournament.forum_topic_detected', { id: extractedForumTopicId })}</small>}
        </div>
        </div>
      </details>

      {/*
        SECTION 2: GENERAL SETTINGS. Everything that applies to the whole
        tournament, kept together. Like every section it starts open, so the
        required max participants field is never hidden by default.
      */}
      <details open data-help-id="region-tournament-general-settings" className="mb-6 rounded-lg border border-gray-200 bg-white">
        <summary data-help-id="action-toggle-tournament-general-settings" className="cursor-pointer p-4 font-semibold text-gray-800">{t('tournament.general_settings', 'General settings')}</summary>
        <div className="grid grid-cols-1 gap-6 px-4 pb-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          {/* Tournament Mode Selector (Ranked/Unranked/Team) */}
          <fieldset data-help-id="region-tournament-mode" className="flex flex-col gap-2">
            <legend className="mb-2 font-medium text-gray-700">{t('tournament.match_type', 'Match Type')}</legend>
            {matchTypeOptions.map((option) => (
              <label
                key={option.value}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  formData.tournament_mode === option.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                } ${isLoading || mode === 'edit' ? 'cursor-default opacity-80' : 'cursor-pointer hover:border-blue-400'}`}
              >
                <input
                  data-help-id={`option-tournament-mode-${option.value}`}
                  type="radio"
                  name="tournament_mode"
                  value={option.value}
                  checked={formData.tournament_mode === option.value}
                  onChange={(e) => onFormDataChange({ ...formData, tournament_mode: e.target.value as TournamentMode })}
                  disabled={isLoading || mode === 'edit'}
                />
                <span className="text-gray-800">{option.label}</span>
              </label>
            ))}
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="tournament-max-participants" className="font-medium text-gray-700">{t('label_max_participants', 'Max Participants')}</label>
              <input
                id="tournament-max-participants"
                data-help-id="field-tournament-max-participants"
                type="number"
                placeholder={t('label_max_participants', 'Max Participants')}
                min="0"
                max="256"
                value={formData.max_participants ?? ''}
                onChange={(e) => onFormDataChange({
                  ...formData,
                  max_participants: e.target.value ? parseInt(e.target.value) : null
                })}
                disabled={isLoading}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
              {/* The backend counts teams in team tournaments and players otherwise. */}
              <small className="text-gray-600">
                {formData.tournament_mode === 'team'
                  ? t('tournament.max_participants_help_teams')
                  : t('tournament.max_participants_help_players')}
              </small>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="tournament-round-duration" className="font-medium text-gray-700">{t('label_round_duration', 'Round Duration (days)')}</label>
              <EditableIntegerInput
                id="tournament-round-duration"
                data-help-id="field-tournament-round-duration"
                min={1}
                max={365}
                value={formData.round_duration_days}
                onValueChange={(days) => onFormDataChange({
                  ...formData,
                  round_duration_days: days,
                })}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
              <small className="text-gray-600">{t('tournament.round_duration_help')}</small>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="tournament-scheduled-start" className="font-medium text-gray-700">{t('label_scheduled_start_date')}</label>
              <input
                id="tournament-scheduled-start"
                data-help-id="field-tournament-scheduled-start"
                type="datetime-local"
                value={formData.scheduled_start_at
                  ? toLocalDateTimeValue(formData.scheduled_start_at)
                  : ''}
                onChange={(e) => onFormDataChange({
                  ...formData,
                  scheduled_start_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                })}
                disabled={isLoading}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
              <small className="text-gray-600">
                {t('tournament.scheduled_start_help', 'Informational date; the actual start is recorded when the tournament is started.')}
              </small>
            </div>

            {/*
              The phase engine starts the rounds of a compiled phase when this
              is set (tournaments.auto_progress). Leagues always open their
              rounds manually, and the backend stores false for them, so the
              option is hidden while the first phase is a round robin.
            */}
            {formData.tournament_type !== 'league' && (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-3 font-medium text-gray-700 sm:mt-8">
                  <input
                    data-help-id="option-tournament-auto-advance"
                    type="checkbox"
                    checked={formData.auto_advance_round}
                    onChange={(e) => onFormDataChange({
                      ...formData,
                      auto_advance_round: e.target.checked
                    })}
                    className="w-5 h-5"
                    disabled={isLoading}
                  />
                  {t('tournament.auto_advance_label', 'Start rounds automatically')}
                </label>
                <small className="text-gray-600">{t('tournament.auto_advance_help')}</small>
              </div>
            )}
          </div>
        </div>
      </details>

      {/* SECTION 3: PHASES */}
      <details open data-help-id="region-tournament-phase-configuration" className="mb-6 rounded-lg border border-blue-200 bg-white">
        <summary data-help-id="action-toggle-tournament-phase-configuration" className="cursor-pointer p-4 font-semibold text-gray-800">{t('tournament.phases')}</summary>
        <div className="px-4 pb-4">
          <TournamentPhaseBuilder
            value={formData.format_definition}
            onChange={handlePhaseFormatChange}
            disabled={isLoading}
            initialTemplate={formData.tournament_type === 'league' ? 'league' : formData.tournament_type === 'elimination' ? 'elimination' : 'swiss'}
            entryOptions={entryOptions}
          />
        </div>
      </details>

      {/* SECTION 4: ALLOWED FACTIONS AND MAPS (per match type) */}
      {assetSection('unranked', t('tournament.allowed_assets', 'Allowed factions and maps'), t('tournament.select_allowed_factions_maps', 'Select which factions and maps are allowed in this tournament'), false)}
      {assetSection('team', t('tournament.allowed_assets', 'Allowed factions and maps'), t('tournament.select_allowed_factions_maps', 'Select which factions and maps are allowed in this tournament'), false)}
      {assetSection('ranked', t('tournament.allowed_ranked_assets', 'Allowed ranked factions and maps'), t('tournament.select_allowed_ranked_factions_maps', 'Select which ranked factions and maps are allowed in this tournament'), true)}

      {/* SECTION 5: DESCRIPTION AND RULES (long texts last) */}
      <details open data-help-id="region-tournament-description-rules" className="mb-6 border border-gray-200 rounded-lg bg-white">
        <summary data-help-id="action-toggle-tournament-description-rules" className="cursor-pointer p-4 font-semibold text-gray-800">{t('tournament.description_and_rules', 'Description and rules')}</summary>
        <div className="px-4 pb-4">
        {/* Tournament Description - Wiki editor */}
        <div data-help-id="region-tournament-description" className="mb-4 flex flex-col gap-2">
          <label className="font-medium text-gray-700">{t('tournament_description', 'Description')}</label>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-gray-600">{t('tournament.editor', 'Editor')}</span>
              <textarea
                data-help-id="field-tournament-description"
                placeholder={t('tournament.description_markdown_placeholder', 'Write tournament description in markdown...')}
                value={formData.description}
                onChange={(e) => onFormDataChange({ ...formData, description: e.target.value })}
                rows={12}
                required
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 resize-vertical font-mono text-sm"
              />
            </div>
            <div data-help-id="region-tournament-description-preview" className="rounded-md border border-gray-200 p-4 bg-gray-50">
              <h4 className="font-semibold text-gray-800 mb-2">{t('tournament.description_preview', 'Description Preview')}</h4>
              <MarkdownPreview
                markdown={formData.description}
                emptyMessage={t('tournament.description_preview_empty', 'Description preview will appear here as you write.')}
              />
            </div>
          </div>
          <small className="text-gray-600">
            {t('tournament.description_markdown_help', 'Markdown syntax is supported, using the same renderer as Wiki Help.')}
          </small>
        </div>

        <div data-help-id="region-tournament-rules-template" className="mb-4 flex flex-col gap-2">
          <label className="font-medium text-gray-700">{t('tournament.rules_template', 'Rules Template')}</label>
          <select
            data-help-id="field-tournament-rules-template"
            value={formData.rules_template_id || ''}
            onChange={(e) => handleRuleTemplateChange(e.target.value)}
            disabled={isLoading || templatesLoading}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="">{t('tournament.rules_template_none', 'No template')}</option>
            {ruleTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title}
              </option>
            ))}
          </select>
          <small className="text-gray-600">
            {t('tournament.rules_template_help', 'Selecting a template creates an editable copy for this tournament.')}
          </small>
        </div>

        <div data-help-id="region-tournament-rules" className="mb-4 flex flex-col gap-2">
          <label className="font-medium text-gray-700">{t('tournament.rules_content', 'Tournament Rules')}</label>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-gray-600">{t('tournament.editor', 'Editor')}</span>
              <textarea
                data-help-id="field-tournament-rules"
                placeholder={t('tournament.rules_content_placeholder', 'Write tournament rules in markdown...')}
                value={formData.rules_content || ''}
                onChange={(e) => onFormDataChange({ ...formData, rules_content: e.target.value })}
                rows={12}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 resize-vertical font-mono text-sm"
              />
            </div>
            <div data-help-id="region-tournament-rules-preview" className="rounded-md border border-gray-200 p-4 bg-gray-50">
              <h4 className="font-semibold text-gray-800 mb-2">{t('tournament.rules_preview', 'Rules Preview')}</h4>
              <MarkdownPreview
                markdown={formData.rules_content || ''}
                emptyMessage={t('tournament.rules_preview_empty', 'Rules preview will appear here as you write.')}
              />
            </div>
          </div>
          <small className="text-gray-600">
            {t('tournament.rules_markdown_help', 'Markdown syntax is supported, using the same renderer as Wiki Help.')}
          </small>
        </div>
        </div>
      </details>

      <div className="flex w-full gap-2">
        <button data-help-id={mode === 'create' ? 'action-create-tournament' : 'action-update-tournament'} type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded flex-1 disabled:opacity-50 disabled:cursor-not-allowed" disabled={isLoading}>
          {isLoading ? t('loading') : (mode === 'create' ? t('tournament_create') : t('btn_confirm'))}
        </button>
        {mode === 'edit' && onCancel && (
          <button 
            data-help-id="action-cancel-tournament-edit"
            type="button"
            onClick={onCancel}
            className="bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded flex-1"
          >
            {t('btn_cancel', 'Cancel')}
          </button>
        )}
      </div>
    </form>
  );
};

export default TournamentForm;
