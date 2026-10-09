import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export type TournamentDetailTab = 'participants' | 'competition' | 'tournamentStandings';

const tournamentDetailTabs = new Set<TournamentDetailTab>(['participants', 'competition', 'tournamentStandings']);

/** The tab requested by a `?tab=` deep link, when it names an existing view. */
export function getRequestedTournamentTab(searchParams: URLSearchParams): TournamentDetailTab | null {
  const tab = searchParams.get('tab');
  return tab && tournamentDetailTabs.has(tab as TournamentDetailTab) ? tab as TournamentDetailTab : null;
}

/**
 * Select the most useful landing view for the tournament status. Standings
 * are authoritative after completion, while pre-start states are primarily
 * concerned with the registered field.
 */
export function getDefaultTournamentTab(status: string): TournamentDetailTab {
  if (status === 'in_progress') return 'competition';
  if (['finished', 'complete', 'completed'].includes(status)) return 'tournamentStandings';
  return 'participants';
}

export type CompetitionMatchFilter = 'all' | 'pending' | 'completed';

/** Filters of the competition view; they are shown only while that tab is active. */
export interface CompetitionFilters {
  matchFilter: CompetitionMatchFilter;
  showOnlyMine: boolean;
  showPhasesGroups: boolean;
}

export const defaultCompetitionFilters: CompetitionFilters = {
  matchFilter: 'all',
  showOnlyMine: false,
  showPhasesGroups: true,
};

interface TournamentDetailTabsProps {
  activeTab: TournamentDetailTab;
  onTabChange: (tab: TournamentDetailTab) => void;
  participantsLabel: string;
  competitionFilters: CompetitionFilters;
  onCompetitionFiltersChange: (filters: CompetitionFilters) => void;
  /** Reload the active tab's data; the button spins until it settles. */
  onRefresh: () => Promise<void>;
}

/** Tab bar of the tournament page, with the competition filters and the refresh button. */
const TournamentDetailTabs: React.FC<TournamentDetailTabsProps> = ({
  activeTab,
  onTabChange,
  participantsLabel,
  competitionFilters,
  onCompetitionFiltersChange,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const [isRefreshing, setIsRefreshing] = useState(false);
  return (
    <div className="flex flex-col gap-4 mt-8 mb-6">
      {/* Tab buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        <button 
          data-help-id="action-tab-participants"
          className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'participants' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
          onClick={() => onTabChange('participants')}
        >
          {participantsLabel}
        </button>
        <button
          data-help-id="action-tab-tournament-standings"
          className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'tournamentStandings' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
          onClick={() => onTabChange('tournamentStandings')}
        >
          Tournament Standings
        </button>
        <button
          data-help-id="action-tab-competition"
          className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'competition' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
          onClick={() => onTabChange('competition')}
        >
          Competition
        </button>
        {activeTab === 'competition' && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
            <label className="flex items-center gap-2 font-semibold text-gray-700">
              <span>Matches</span>
              <select
                data-help-id="option-competition-match-status-filter"
                value={competitionFilters.matchFilter}
                onChange={(event) => onCompetitionFiltersChange({ ...competitionFilters, matchFilter: event.target.value as CompetitionMatchFilter })}
                className="rounded border border-gray-300 bg-white px-2 py-1 font-normal"
              >
                <option value="all">All</option>
                <option value="pending">Scheduled</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label className="flex items-center gap-2 font-semibold text-gray-700">
              <input
                data-help-id="option-competition-show-only-mine"
                type="checkbox"
                checked={competitionFilters.showOnlyMine}
                onChange={(event) => onCompetitionFiltersChange({ ...competitionFilters, showOnlyMine: event.target.checked })}
              />
              Show only mine
            </label>
            <label className="flex items-center gap-2 font-semibold text-gray-700">
              <input
                data-help-id="option-competition-hide-phases-groups"
                type="checkbox"
                checked={!competitionFilters.showPhasesGroups}
                onChange={(event) => onCompetitionFiltersChange({ ...competitionFilters, showPhasesGroups: !event.target.checked })}
              />
              Hide phases / groups
            </label>
          </div>
        )}
        
        {/* Refresh button */}
        <button
          data-help-id="action-refresh-tournament-detail"
          onClick={() => {
            setIsRefreshing(true);
            onRefresh().finally(() => setIsRefreshing(false));
          }}
          disabled={isRefreshing}
          className="ml-auto px-3 py-2 rounded bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          title={t('common.refresh')}
        >
          <svg 
            className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </button>
      </div>
    </div>
  );
};

export default TournamentDetailTabs;
