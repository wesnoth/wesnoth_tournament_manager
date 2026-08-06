import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FactionBalanceTab from '../components/FactionBalanceTab';
import MapBalanceTab from '../components/MapBalanceTab';
import MatchupBalanceTab from '../components/MatchupBalanceTab';
import FactionVsFactionTab from '../components/FactionVsFactionTab';
import BalanceEventImpactPanel from '../components/BalanceEventImpactPanel';

type StatisticsTab = 'faction' | 'map' | 'matchups' | 'faction-vs-faction';

interface ComparisonData {
  map_id?: string;
  map_name?: string;
  faction_id?: string;
  faction_name?: string;
  opponent_faction_id?: string;
  opponent_faction_name?: string;
  winrate: number;
  total_games: number;
  wins: number;
  losses: number;
}

const Statistics: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<StatisticsTab>('faction');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [beforeData, setBeforeData] = useState<ComparisonData[]>([]);
  const [afterData, setAfterData] = useState<ComparisonData[]>([]);
  const [beforeInterval, setBeforeInterval] = useState('');
  const [afterInterval, setAfterInterval] = useState('');

  const handleComparisonDataChange = (before: ComparisonData[], after: ComparisonData[]) => {
    setBeforeData(before);
    setAfterData(after);
  };

  return (
    <div data-help-id="region-statistics" className="w-full max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-gray-800 mb-4">{t('statistics') || 'Balance Statistics'}</h1>
      <p className="text-lg text-gray-600 mb-8">
        {t('statistics_intro') || 'Detailed analysis of faction and map balance across all matches'}
      </p>

      <BalanceEventImpactPanel 
        eventId={selectedEventId ?? undefined} 
        onEventChange={setSelectedEventId}
        onComparisonDataChange={handleComparisonDataChange}
        onIntervalChange={(before, after) => {
          setBeforeInterval(before);
          setAfterInterval(after);
        }}
      />

      <div data-help-id="region-statistics-tabs" className="flex gap-4 border-b border-gray-300 mb-6 overflow-x-auto">
        <button 
          data-help-id="action-statistics-tab-faction"
          className={`px-4 py-3 font-semibold text-gray-600 border-b-2 border-transparent hover:text-gray-800 transition-colors cursor-pointer whitespace-nowrap ${activeTab === 'faction' ? 'text-blue-600 border-blue-600' : ''}`}
          onClick={() => setActiveTab('faction')}
        >
          {t('faction_balance') || 'Faction Balance'}
        </button>
        <button 
          data-help-id="action-statistics-tab-map"
          className={`px-4 py-3 font-semibold text-gray-600 border-b-2 border-transparent hover:text-gray-800 transition-colors cursor-pointer whitespace-nowrap ${activeTab === 'map' ? 'text-blue-600 border-blue-600' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          {t('map_balance') || 'Map Balance'}
        </button>
        <button 
          data-help-id="action-statistics-tab-matchups"
          className={`px-4 py-3 font-semibold text-gray-600 border-b-2 border-transparent hover:text-gray-800 transition-colors cursor-pointer whitespace-nowrap ${activeTab === 'matchups' ? 'text-blue-600 border-blue-600' : ''}`}
          onClick={() => setActiveTab('matchups')}
        >
          {t('matchup_balance') || 'Matchup Analysis'}
        </button>
        <button 
          data-help-id="action-statistics-tab-faction-vs-faction"
          className={`px-4 py-3 font-semibold text-gray-600 border-b-2 border-transparent hover:text-gray-800 transition-colors cursor-pointer whitespace-nowrap ${activeTab === 'faction-vs-faction' ? 'text-blue-600 border-blue-600' : ''}`}
          onClick={() => setActiveTab('faction-vs-faction')}
        >
          {t('faction_vs_faction') || 'Faction vs Faction'}
        </button>
      </div>

      <div data-help-id="region-statistics-active-tab" className="mt-8">
        {activeTab === 'faction' && <FactionBalanceTab beforeData={selectedEventId ? beforeData : null} afterData={selectedEventId ? afterData : null} beforeLabel={selectedEventId ? beforeInterval : undefined} afterLabel={selectedEventId ? afterInterval : undefined} />}
        {activeTab === 'map' && <MapBalanceTab beforeData={selectedEventId ? beforeData : null} afterData={selectedEventId ? afterData : null} />}
        {activeTab === 'matchups' && <MatchupBalanceTab beforeData={selectedEventId ? beforeData : null} afterData={selectedEventId ? afterData : null} />}
        {activeTab === 'faction-vs-faction' && <FactionVsFactionTab beforeData={selectedEventId ? beforeData : null} afterData={selectedEventId ? afterData : null} />}
      </div>
    </div>
  );
};

export default Statistics;
