import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import UnrankedFactionSelect from './UnrankedFactionSelect';
import UnrankedMapSelect from './UnrankedMapSelect';
import MarkdownPreview from './MarkdownPreview';
import { tournamentService, userService } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { MatchFormat, TournamentFormData, TournamentMode, TournamentType } from '../types/tournament';

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
}) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();
  const [ruleTemplates, setRuleTemplates] = useState<RuleTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [organizerCandidateId, setOrganizerCandidateId] = useState('');

  const handleTournamentTypeChange = (newType: TournamentType) => {
    const updatedData = { ...formData, tournament_type: newType };

    // Reset round values based on new format to their creation defaults
    if (newType === 'elimination') {
      updatedData.general_rounds_format = 'bo3';
      updatedData.final_rounds_format = 'bo5';
      updatedData.general_rounds = 0;
      updatedData.final_rounds = 0;
    } else if (newType === 'league') {
      updatedData.auto_advance_round = false;
      updatedData.general_rounds = 1;
      updatedData.final_rounds = 0;
      updatedData.general_rounds_format = 'bo3';
    } else if (newType === 'swiss') {
      updatedData.general_rounds = 1;
      updatedData.final_rounds = 0;
      updatedData.general_rounds_format = 'bo3';
    } else if (newType === 'swiss_elimination') {
      updatedData.general_rounds = 1;
      updatedData.final_rounds = 1;
      updatedData.general_rounds_format = 'bo3';
      updatedData.final_rounds_format = 'bo5';
    }

    onFormDataChange(updatedData);
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

  return (
    <form id="tournament-form" data-help-id="region-tournament-form" className="bg-white rounded-lg shadow-md p-8 space-y-6" onSubmit={onSubmit}>
      {/* SECTION 1: BASIC INFORMATION */}
      <div data-help-id="region-tournament-basic-information" className="mb-6 p-4 border border-gray-200 rounded-lg bg-white">
        <h3 className="mb-4 font-semibold text-gray-800">{t('tournament.basic_info', 'Basic Information')}</h3>
        
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
        
        {/* Tournament Mode Selector (Ranked/Unranked/Team) */}
        <div data-help-id="region-tournament-mode" className="flex flex-col gap-2">
          <label className="font-medium text-gray-700">{t('tournament.match_type', 'Match Type')}:</label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                data-help-id="option-tournament-mode-ranked"
                type="radio"
                value="ranked"
                checked={formData.tournament_mode === 'ranked'}
                onChange={(e) => onFormDataChange({ ...formData, tournament_mode: e.target.value as TournamentMode })}
                disabled={isLoading || mode === 'edit'}
              />
              {t('tournament.ranked', 'Ranked (1v1, ELO impact)')}
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                data-help-id="option-tournament-mode-unranked"
                type="radio"
                value="unranked"
                checked={formData.tournament_mode === 'unranked'}
                onChange={(e) => onFormDataChange({ ...formData, tournament_mode: e.target.value as TournamentMode })}
                disabled={isLoading || mode === 'edit'}
              />
              {t('tournament.unranked', 'Unranked (1v1, no ELO)')}
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                data-help-id="option-tournament-mode-team"
                type="radio"
                value="team"
                checked={formData.tournament_mode === 'team'}
                onChange={(e) => onFormDataChange({ ...formData, tournament_mode: e.target.value as TournamentMode })}
                disabled={isLoading || mode === 'edit'}
              />
              {t('tournament.team', 'Team (2v2, no ELO)')}
            </label>
          </div>
        </div>
      </div>

      {/* SECTION 2: TOURNAMENT TYPE AND PARTICIPANTS */}
      <div data-help-id="region-tournament-format" className="mb-6 p-4 border border-gray-200 rounded-lg bg-white">
        <h3 className="mb-4 font-semibold text-gray-800">{t('tournament.format_settings', 'Format Settings')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="font-medium text-gray-700">{t('tournament.tournament_format', 'Tournament Format')}</label>
            <select
              data-help-id="field-tournament-format"
              value={formData.tournament_type}
              onChange={(e) => handleTournamentTypeChange(e.target.value as TournamentType)}
              required
              disabled={isLoading}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="elimination">{t('option_type_elimination', 'Elimination')}</option>
              <option value="league">{t('option_type_league', 'League')}</option>
              <option value="swiss">{t('option_type_swiss', 'Swiss')}</option>
              <option value="swiss_elimination">{t('option_type_swiss_elimination', 'Swiss-Elimination Mix')}</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="font-medium text-gray-700">{t('label_max_participants', 'Max Participants')}</label>
            <input
              data-help-id="field-tournament-max-participants"
              type="number"
              placeholder={t('label_max_participants', 'Max Participants')}
              min="2"
              max="256"
              value={formData.max_participants || ''}
              onChange={(e) => onFormDataChange({ 
                ...formData, 
                max_participants: e.target.value ? parseInt(e.target.value) : null 
              })}
              disabled={isLoading}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>
        </div>
      </div>

      {/* SECTION 3: UNRANKED ASSETS (conditional) */}
      {formData.tournament_mode === 'unranked' && (
        <div data-help-id="region-tournament-assets-unranked" className="mb-6">
          <h3>{t('tournament.unranked_assets', 'Unranked Tournament Assets')}</h3>
          <p className="text-sm text-gray-600 italic mb-4">{t('tournament.select_allowed_factions_maps', 'Select which factions and maps are allowed in this tournament')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <UnrankedFactionSelect 
              selectedFactionIds={unrankedFactions}
              onChange={onUnrankedFactionsChange}
              disabled={isLoading}
            />
            <UnrankedMapSelect 
              selectedMapIds={unrankedMaps}
              onChange={onUnrankedMapsChange}
              disabled={isLoading}
            />
          </div>
        </div>
      )}

      {/* SECTION 3B: TEAM ASSETS (same as unranked) */}
      {formData.tournament_mode === 'team' && (
        <div data-help-id="region-tournament-assets-team" className="mb-6">
          <h3>{t('tournament.team_assets', 'Team Tournament Assets')}</h3>
          <p className="text-sm text-gray-600 italic mb-4">{t('tournament.select_allowed_factions_maps', 'Select which factions and maps are allowed in this tournament')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <UnrankedFactionSelect 
              selectedFactionIds={unrankedFactions}
              onChange={onUnrankedFactionsChange}
              disabled={isLoading}
            />
            <UnrankedMapSelect 
              selectedMapIds={unrankedMaps}
              onChange={onUnrankedMapsChange}
              disabled={isLoading}
            />
          </div>
        </div>
      )}

      {/* SECTION 3C: RANKED ASSETS (only ranked factions/maps) */}
      {formData.tournament_mode === 'ranked' && (
        <div data-help-id="region-tournament-assets-ranked" className="mb-6">
          <h3>{t('tournament.ranked_assets', 'Ranked Tournament Assets')}</h3>
          <p className="text-sm text-gray-600 italic mb-4">{t('tournament.select_allowed_ranked_factions_maps', 'Select which ranked factions and maps are allowed in this tournament')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <UnrankedFactionSelect 
              selectedFactionIds={unrankedFactions}
              onChange={onUnrankedFactionsChange}
              disabled={isLoading}
              isRankedOnly={true}
            />
            <UnrankedMapSelect 
              selectedMapIds={unrankedMaps}
              onChange={onUnrankedMapsChange}
              disabled={isLoading}
              isRankedOnly={true}
            />
          </div>
        </div>
      )}

      <div data-help-id="region-tournament-round-configuration" className="mb-6 p-4 border border-gray-200 rounded-lg bg-white">
        <div className="mb-4">
          <h3 className="font-semibold text-gray-800">{t('tournament.round_configuration', 'Round Configuration')}</h3>
          {!formData.max_participants && (
            <span className="text-sm text-gray-600 italic">{t('tournaments.round_config_optional', 'Optional - set when preparing the tournament')}</span>
          )}
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-end gap-4 mb-4">
          <div className="flex-1">
            <label className="block font-medium text-gray-700 mb-2">{t('label_round_duration', 'Round Duration (days)')}</label>
            <input
              data-help-id="field-tournament-round-duration"
              type="number"
              min="1"
              max="365"
              value={formData.round_duration_days}
              onChange={(e) => onFormDataChange({ 
                ...formData, 
                round_duration_days: parseInt(e.target.value) 
              })}
              disabled={isLoading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          {formData.tournament_type !== 'league' && (
            <div className="flex items-center gap-3">
              <label className="font-medium text-gray-700">{t('label_auto_advance_rounds', 'Auto-advance Rounds')}</label>
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
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 mb-4">
          <label className="font-medium text-gray-700">
            {t('label_scheduled_start_date', 'Planned Start')}
          </label>
          <input
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

        {/* ELIMINATION TOURNAMENT - Auto-calculated rounds */}
        {formData.tournament_type === 'elimination' && (
          <div data-help-id="region-tournament-format-elimination" className="border-t border-gray-200 pt-6">
            <h4 className="font-semibold text-gray-800 mb-2">{t('tournament.round_configuration', 'Round Configuration')}</h4>
            <p className="text-sm text-gray-600 mb-4">{t('tournament.configure_match_formats_elimination', 'Configure match formats for your elimination tournament')}</p>
            
            <div className="border border-blue-200 bg-blue-50 p-4 rounded mb-4">
              <p className="text-sm text-blue-900">ℹ️ {t('tournament.elimination_auto_calculated', 'Tournament rounds are automatically calculated based on the number of participants.')}</p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="font-medium text-gray-700">{t('tournament.preliminary_rounds_format', 'Preliminary Rounds Match Format')}</label>
                <select
                  data-help-id="field-tournament-elimination-preliminary-format"
                  value={formData.general_rounds_format}
                  onChange={(e) => onFormDataChange({
                    ...formData,
                    general_rounds_format: e.target.value as MatchFormat
                  })}
                  disabled={isLoading}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="bo1">{t('match_format.bo1', 'Best of 1 (Single match)')}</option>
                  <option value="bo3">{t('match_format.bo3', 'Best of 3 (First to 2 wins)')}</option>
                  <option value="bo5">{t('match_format.bo5', 'Best of 5 (First to 3 wins)')}</option>
                </select>
                <small className="text-gray-600">{t('tournament.preliminary_format_help', 'Best of format for all preliminary elimination rounds')}</small>
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-medium text-gray-700">{t('tournament.final_match_format', 'Final Match Format')}</label>
                <select
                  data-help-id="field-tournament-elimination-final-format"
                  value={formData.final_rounds_format}
                  onChange={(e) => onFormDataChange({
                    ...formData,
                    final_rounds_format: e.target.value as MatchFormat
                  })}
                  disabled={isLoading}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="bo1">{t('match_format.bo1', 'Best of 1 (Single match)')}</option>
                  <option value="bo3">{t('match_format.bo3', 'Best of 3 (First to 2 wins)')}</option>
                  <option value="bo5">{t('match_format.bo5', 'Best of 5 (First to 3 wins)')}</option>
                </select>
                <small className="text-gray-600">{t('tournament.final_format_help', 'Best of format for the final match')}</small>
              </div>
            </div>
          </div>
        )}

        {/* NON-ELIMINATION TOURNAMENT - Manual round configuration */}
        {formData.tournament_type !== 'elimination' && (
          <div className="border-t border-gray-200 pt-6 space-y-6">
            {/* LEAGUE TOURNAMENT */}
            {formData.tournament_type === 'league' && (
              <div data-help-id="region-tournament-format-league">
                <h4 className="font-semibold text-gray-800 mb-2">{t('tournament.league_configuration', 'League Format Configuration')}</h4>
                <p className="text-sm text-gray-600 mb-4">{t('tournament.league_description', 'Configure the League tournament format')}</p>
                <div className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="font-medium text-gray-700">{t('tournament.league_format', 'League Format')}</label>
                    <select
                      data-help-id="field-tournament-league-waves"
                      value={formData.general_rounds}
                      onChange={(e) => onFormDataChange({
                        ...formData,
                        general_rounds: parseInt(e.target.value),
                      })}
                      disabled={isLoading}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    >
                      <option value="1">{t('tournament.single_round', 'Single Wave')}</option>
                      <option value="2">{t('tournament.double_round', 'Double Wave')}</option>
                    </select>
                    <small className="text-gray-600">{t('tournament.league_format_help', 'Select whether teams play once or twice against each other')}</small>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-medium text-gray-700">{t('tournament.match_format', 'Match Format')}</label>
                    <select
                      data-help-id="field-tournament-league-match-format"
                      value={formData.general_rounds_format}
                      onChange={(e) => onFormDataChange({
                        ...formData,
                        general_rounds_format: e.target.value as 'bo1' | 'bo3' | 'bo5'
                      })}
                      disabled={isLoading}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    >
                      <option value="bo1">{t('match_format.bo1', 'Best of 1 (Single match)')}</option>
                      <option value="bo3">{t('match_format.bo3', 'Best of 3 (First to 2 wins)')}</option>
                      <option value="bo5">{t('match_format.bo5', 'Best of 5 (First to 3 wins)')}</option>
                    </select>
                    <small className="text-gray-600">{t('tournament.match_format_help', 'Number of games in each match')}</small>
                  </div>
                  <div data-help-id="region-tournament-league-summary" className="bg-gray-50 p-3 rounded border border-gray-200">
                    <p className="text-sm"><strong>{t('tournament.format', 'Format')}:</strong> {formData.general_rounds === 2 ? t('tournament.double_round', 'Double Wave') : t('tournament.single_round', 'Single Wave')} ({formData.general_rounds_format?.toUpperCase()})</p>
                  </div>
                </div>
              </div>
            )}

            {/* SWISS TOURNAMENT */}
            {formData.tournament_type === 'swiss' && (
              <div data-help-id="region-tournament-format-swiss">
                <h4 className="font-semibold text-gray-800 mb-2">{t('tournament.swiss_configuration', 'Swiss Rounds Configuration')}</h4>
                <p className="text-sm text-gray-600 mb-4">{t('tournament.swiss_description', 'Configure the Swiss round tournament')}</p>
                <div className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="font-medium text-gray-700">{t('tournament.number_swiss_rounds', 'Number of Swiss Rounds')}</label>
                    <select
                      data-help-id="field-tournament-swiss-rounds"
                      value={formData.general_rounds}
                      onChange={(e) => onFormDataChange({
                        ...formData,
                        general_rounds: parseInt(e.target.value),
                      })}
                      disabled={isLoading}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    >
                      {Array.from({ length: 10 }, (_, index) => index + 1).map((rounds) => (
                        <option key={rounds} value={rounds}>{rounds}</option>
                      ))}
                    </select>
                    <small className="text-gray-600">{t('tournament.swiss_rounds_help', 'Number of Swiss system rounds to run (typically 3-7 rounds for Swiss tournaments)')}</small>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-medium text-gray-700">{t('tournament.match_format', 'Match Format')}</label>
                    <select
                      data-help-id="field-tournament-swiss-match-format"
                      value={formData.general_rounds_format}
                      onChange={(e) => onFormDataChange({
                        ...formData,
                        general_rounds_format: e.target.value as MatchFormat
                      })}
                      disabled={isLoading}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    >
                      <option value="bo1">{t('match_format.bo1', 'Best of 1 (Single match)')}</option>
                      <option value="bo3">{t('match_format.bo3', 'Best of 3 (First to 2 wins)')}</option>
                      <option value="bo5">{t('match_format.bo5', 'Best of 5 (First to 3 wins)')}</option>
                    </select>
                    <small className="text-gray-600">{t('tournament.match_format_help', 'Number of games in each match')}</small>
                  </div>
                  <div data-help-id="region-tournament-swiss-summary" className="bg-gray-50 p-3 rounded border border-gray-200">
                    <p className="text-sm"><strong>{t('tournament.total_rounds', 'Total Rounds')}:</strong> {formData.general_rounds} {t('tournament.swiss_rounds', 'Swiss rounds')} ({formData.general_rounds_format?.toUpperCase()})</p>
                  </div>
                </div>
              </div>
            )}

            {/* SWISS-ELIMINATION HYBRID TOURNAMENT */}
            {formData.tournament_type === 'swiss_elimination' && (
              <div data-help-id="region-tournament-format-swiss-elimination">
                <h4 className="font-semibold text-gray-800 mb-2">{t('tournament.swiss_elimination_configuration', 'Swiss-Elimination Mix Configuration')}</h4>
                <p className="text-sm text-gray-600 mb-4">{t('tournament.swiss_elimination_description', 'Configure Swiss qualifying rounds and elimination bracket with different match formats')}</p>
                <div className="border border-blue-200 bg-blue-50 p-4 rounded mb-4">
                  <p className="text-sm text-blue-900">ℹ️ {t('tournament.swiss_elimination_info', 'This tournament combines a Swiss phase for qualification with an elimination phase for final ranking. You can set different match formats for qualification and the grand final.')}</p>
                </div>
                
                {/* Rounds Configuration */}
                <div data-help-id="region-tournament-swiss-elimination-rounds" className="border border-gray-200 p-4 rounded-lg mb-4">
                  <h5 className="font-medium text-gray-800 mb-4">{t('tournament.rounds_configuration', 'Rounds Configuration')}</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-gray-700">{t('tournament.number_swiss_rounds', 'Number of Swiss Rounds')}</label>
                      <select
                        data-help-id="field-tournament-swiss-elimination-swiss-rounds"
                        value={formData.general_rounds}
                        onChange={(e) => onFormDataChange({
                          ...formData,
                          general_rounds: parseInt(e.target.value),
                        })}
                        disabled={isLoading}
                        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                      >
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((rounds) => (
                          <option key={rounds} value={rounds}>{rounds}</option>
                        ))}
                      </select>
                      <small className="text-gray-600">{t('tournament.qualifying_rounds_help', 'Qualifying rounds using Swiss system')}</small>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-gray-700">{t('tournament.number_elimination_rounds', 'Number of Elimination Rounds')}</label>
                      <select
                        data-help-id="field-tournament-swiss-elimination-final-rounds"
                        value={formData.final_rounds}
                        onChange={(e) => onFormDataChange({
                          ...formData,
                          final_rounds: parseInt(e.target.value),
                        })}
                        disabled={isLoading}
                        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                      >
                        {[1, 2, 3].map((rounds) => (
                          <option key={rounds} value={rounds}>{rounds}</option>
                        ))}
                      </select>
                      <small className="text-gray-600">{t('tournament.elimination_rounds_help', 'Total elimination rounds (includes grand final)')}</small>
                    </div>
                  </div>
                </div>

                {/* Match Formats */}
                <div data-help-id="region-tournament-swiss-elimination-match-formats" className="border border-gray-200 p-4 rounded-lg mb-4">
                  <h5 className="font-medium text-gray-800 mb-4">{t('tournament.match_formats', 'Match Formats')}</h5>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-gray-700">{t('tournament.general_format', 'General Format (Swiss Rounds + Elimination except Final)')}</label>
                      <select
                        data-help-id="field-tournament-swiss-elimination-general-format"
                        value={formData.general_rounds_format}
                        onChange={(e) => onFormDataChange({
                          ...formData,
                          general_rounds_format: e.target.value as MatchFormat
                        })}
                        disabled={isLoading}
                        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                      >
                        <option value="bo1">{t('match_format.bo1', 'Best of 1 (Single match)')}</option>
                        <option value="bo3">{t('match_format.bo3', 'Best of 3 (First to 2 wins)')}</option>
                        <option value="bo5">{t('match_format.bo5', 'Best of 5 (First to 3 wins)')}</option>
                      </select>
                      <small className="text-gray-600">{t('tournament.general_format_help', 'Used for Swiss rounds and all elimination rounds except the grand final')}</small>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-medium text-gray-700">{t('tournament.final_format', 'Final Format (Grand Final)')}</label>
                      <select
                        data-help-id="field-tournament-swiss-elimination-final-format"
                        value={formData.final_rounds_format}
                        onChange={(e) => onFormDataChange({
                          ...formData,
                          final_rounds_format: e.target.value as MatchFormat
                        })}
                        disabled={isLoading}
                        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                      >
                        <option value="bo1">{t('match_format.bo1', 'Best of 1 (Single match)')}</option>
                        <option value="bo3">{t('match_format.bo3', 'Best of 3 (First to 2 wins)')}</option>
                        <option value="bo5">{t('match_format.bo5', 'Best of 5 (First to 3 wins)')}</option>
                      </select>
                      <small className="text-gray-600">{t('tournament.final_format_help', 'Used only for the grand final match')}</small>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div data-help-id="region-tournament-swiss-elimination-summary" className="bg-gray-50 p-4 rounded border border-gray-200">
                  <p className="font-medium text-gray-800 mb-2">{t('tournament.tournament_structure', 'Tournament Structure')}:</p>
                  <div className="space-y-1 text-sm text-gray-700">
                    <p>• {t('tournament.swiss_phase', 'Swiss Phase')}: {formData.general_rounds} {t('tournament.rounds', 'rounds')} ({formData.general_rounds_format?.toUpperCase()})</p>
                    {formData.final_rounds > 1 && (
                      <p>• {t('tournament.qualification_phase', 'Qualification Phase')}:  {formData.final_rounds - 1} {t('tournament.rounds', 'rounds')} ({formData.general_rounds_format?.toUpperCase()}) [{t('tournament.quarters_semis', 'Quarters, Semis, etc')}]</p>
                    )}
                    <p>• {t('tournament.grand_final', 'Grand Final')}:  1 {t('tournament.round', 'round')} ({formData.final_rounds_format?.toUpperCase()})</p>
                    <p><strong>{t('tournament.total_rounds', 'Total Rounds')}:</strong> {formData.general_rounds + formData.final_rounds}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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
