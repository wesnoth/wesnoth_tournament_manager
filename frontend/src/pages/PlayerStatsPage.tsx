import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { publicService } from '../services/api';
import PlayerStatsOverview from '../components/PlayerStatsOverview';
import PlayerStatsByMap from '../components/PlayerStatsByMap';
import PlayerStatsByFaction from '../components/PlayerStatsByFaction';
import PlayerStatsByMatchup from '../components/PlayerStatsByMatchup';
import PlayerHeadToHead from '../components/PlayerHeadToHead';
import PlayerRecentOpponents from '../components/PlayerRecentOpponents';

type StatsTab = 'overview' | 'by-map' | 'by-faction' | 'by-matchup' | 'recent-opponents';

interface Player {
  id: string;
  username: string;
  elo_rating: number;
}

const PlayerStatsPage: React.FC = () => {
  const { playerId } = useParams<{ playerId: string }>();
  const { t } = useTranslation();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<StatsTab>('overview');
  const [headToHeadOpponent, setHeadToHeadOpponent] = useState<string>('');

  useEffect(() => {
    const fetchPlayer = async () => {
      try {
        setLoading(true);
        if (!playerId) {
          setError('No player ID provided');
          return;
        }

        const response = await publicService.getPlayerProfile(playerId);
        const data = response.data;

        if (!data) {
          setError('Player not found');
          return;
        }

        setPlayer(data);
      } catch (err) {
        console.error('Error fetching player:', err);
        setError('Error loading player information');
      } finally {
        setLoading(false);
      }
    };

    fetchPlayer();
  }, [playerId]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <p className="text-center text-gray-600">{t('loading')}</p>
      </div>
    );
  }

  if (error || !player || !playerId) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <p className="text-center text-red-600">{error || 'Error loading player'}</p>
      </div>
    );
  }

  const tabs: { id: StatsTab; label: string }[] = [
    { id: 'overview', label: t('overall_statistics') || 'Overall Statistics' },
    { id: 'by-map', label: t('performance_by_map') || 'By Map' },
    { id: 'by-faction', label: t('performance_by_faction') || 'By Faction' },
    { id: 'by-matchup', label: t('matchup_analysis') || 'Matchup Analysis' },
    { id: 'recent-opponents', label: t('recent_opponents') || 'Recent Opponents' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Player Header */}
      <div className="mb-8 pb-6 border-b-2 border-gray-300">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">{player.username}</h1>
        <p className="text-gray-700 mb-2">{t('current_elo') || 'Current ELO'}: <strong className="text-lg">{player.elo_rating}</strong></p>
        <p className="text-gray-700">{t('player_id') || 'Player ID'}: {playerId}</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-300">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`px-4 py-3 font-semibold transition-all cursor-pointer ${
              activeTab === tab.id
                ? 'text-blue-600 border-b-4 border-blue-600 bg-white rounded-t-lg'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
            }`}
            onClick={() => {
              setActiveTab(tab.id);
              setHeadToHeadOpponent(''); // Reset H2H opponent when switching tabs
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-8">
        {activeTab === 'overview' && (
          <div className="bg-white rounded-lg shadow-md p-8">
            <PlayerStatsOverview playerId={playerId} />
          </div>
        )}

        {activeTab === 'by-map' && (
          <div className="bg-white rounded-lg shadow-md p-8">
            <PlayerStatsByMap playerId={playerId} />
          </div>
        )}

        {activeTab === 'by-faction' && (
          <div className="bg-white rounded-lg shadow-md p-8">
            <PlayerStatsByFaction playerId={playerId} />
          </div>
        )}

        {activeTab === 'by-matchup' && (
          <div className="bg-white rounded-lg shadow-md p-8">
            <PlayerStatsByMatchup playerId={playerId} />
          </div>
        )}

        {activeTab === 'recent-opponents' && (
          <div className="bg-white rounded-lg shadow-md p-8">
            <PlayerRecentOpponents playerId={playerId} limit={20} />
            
            {/* Head to Head Section */}
            {headToHeadOpponent && (
              <div className="mt-12 pt-8 border-t-2 border-gray-300">
                <PlayerHeadToHead 
                  playerId={playerId} 
                  opponentId={headToHeadOpponent}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerStatsPage;
