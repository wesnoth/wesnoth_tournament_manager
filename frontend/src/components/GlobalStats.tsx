import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { publicService } from '../services/api';
import i18next from 'i18next';

interface GlobalStatistics {
  users_total: number;
  users_active: number;
  users_ranked: number;
  users_new_month: number;
  users_new_year: number;
  matches_today: number;
  matches_week: number;
  matches_month: number;
  matches_year: number;
  matches_total: number;
  tournament_matches_month: number;
  tournament_matches_year: number;
  tournament_matches_total: number;
  tournaments_month: number;
  tournaments_year: number;
  tournaments_total: number;
  last_updated: string;
}

interface StatRowProps {
  label: string;
  value: number;
}

const StatRow: React.FC<StatRowProps> = ({ label, value }) => (
  <div className="flex justify-between items-center py-2 border-b border-gray-200">
    <span className="text-gray-600 text-sm">{label}</span>
    <span className="text-gray-900 font-semibold">{value.toLocaleString(i18next.language)}</span>
  </div>
);

const GlobalStats: React.FC = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<GlobalStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGlobalStats = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await publicService.getGlobalStatistics();
        setStats(response.data);
      } catch (err) {
        console.error('Error fetching global statistics:', err);
        setError(t('error_loading_statistics') || 'Failed to load statistics');
      } finally {
        setLoading(false);
      }
    };

    fetchGlobalStats();

    // Refresh every 10 minutes
    const interval = setInterval(fetchGlobalStats, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [t]);

  if (loading) {
    return (
      <section className="bg-white rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold mb-4">{t('global_statistics') || 'Site Statistics'}</h3>
        <div className="text-center text-gray-600 text-sm">{t('loading')}</div>
      </section>
    );
  }

  if (error || !stats) {
    return (
      <section className="bg-white rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold mb-4">{t('global_statistics') || 'Site Statistics'}</h3>
        <div className="text-center text-red-600 text-xs">{error}</div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-lg shadow p-6">
      <h3 className="text-sm font-semibold mb-4">{t('global_statistics') || 'Site Statistics'}</h3>

      <div className="space-y-1 text-xs">
        {/* Users */}
        <div className="font-semibold text-gray-700 text-xs uppercase mb-2 mt-3">{t('global_stats.users')}</div>
        <StatRow label={t('total') || 'Total'} value={stats.users_total} />
        <StatRow label={t('active') || 'Active'} value={stats.users_active} />
        <StatRow label={t('ranked') || 'Ranked'} value={stats.users_ranked} />
        <StatRow label={`${t('new') || 'New'} (${t('month')})`} value={stats.users_new_month} />
        <StatRow label={`${t('new') || 'New'} (${t('year')})`} value={stats.users_new_year} />

        {/* Ranked Matches */}
        <div className="font-semibold text-gray-700 text-xs uppercase mb-2 mt-3">{t('global_stats.ranked_matches')}</div>
        <StatRow label={t('today') || 'Today'} value={stats.matches_today} />
        <StatRow label={t('week') || 'Week'} value={stats.matches_week} />
        <StatRow label={t('month') || 'Month'} value={stats.matches_month} />
        <StatRow label={t('year') || 'Year'} value={stats.matches_year} />
        <StatRow label={t('total') || 'Total'} value={stats.matches_total} />

        {/* Tournament Matches */}
        <div className="font-semibold text-gray-700 text-xs uppercase mb-2 mt-3">{t('global_stats.tournament_matches')}</div>
        <StatRow label={`${t('month') || 'Month'}`} value={stats.tournament_matches_month} />
        <StatRow label={`${t('year') || 'Year'}`} value={stats.tournament_matches_year} />
        <StatRow label={t('total') || 'Total'} value={stats.tournament_matches_total} />

        {/* Tournaments */}
        <div className="font-semibold text-gray-700 text-xs uppercase mb-2 mt-3">{t('global_stats.tournaments')}</div>
        <StatRow label={`${t('month') || 'Month'}`} value={stats.tournaments_month} />
        <StatRow label={`${t('year') || 'Year'}`} value={stats.tournaments_year} />
        <StatRow label={t('total') || 'Total'} value={stats.tournaments_total} />
      </div>
    </section>
  );
};

export default GlobalStats;

