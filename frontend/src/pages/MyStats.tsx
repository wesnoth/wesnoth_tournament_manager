import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { userService, matchService } from '../services/api';
import { getLevelTranslationKey } from '../utils/levelTranslation';

const MyStats: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  
  const [stats, setStats] = useState<any>(null);
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Get user profile for stats
        const profileRes = await userService.getProfile();
        setStats(profileRes.data);

        // Get recent matches
        try {
          const matchesRes = await matchService.getAllMatches();
          const matchesData = matchesRes.data?.data || matchesRes.data || [];
          setRecentMatches(matchesData.slice(0, 10));
        } catch (err) {
          console.error('Error fetching matches:', err);
          setRecentMatches([]);
        }

        setError('');
      } catch (err: any) {
        console.error('Error fetching stats:', err);
        setError('Error loading statistics');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated, navigate]);

  if (loading) {
    return <div className="auth-container"><p>Loading...</p></div>;
  }

  if (!stats) {
    return <div className="auth-container"><p>Statistics not found</p></div>;
  }

  return (
    <div className="auth-container">
      <h1>My Statistics</h1>

      {error && <p className="error">{error}</p>}

      <section className="profile-info">
        <h2>Player Information</h2>
        <div className="info-group">
          <label>Nickname:</label>
          <p>{stats.nickname}</p>
        </div>
        <div className="info-group">
          <label>ELO Rating:</label>
          <p>{stats.elo_rating || 1200}</p>
        </div>
        <div className="info-group">
          <label>Level:</label>
          <p>{t(getLevelTranslationKey(stats.level))}</p>
        </div>
      </section>

      <section className="recent-matches">
        <h2>Recent Matches</h2>
        {recentMatches.length > 0 ? (
          <div className="matches-list">
            {recentMatches.map((match, index) => (
              <div key={match.id} className="match-item">
                <div className="match-info">
                  <span className="match-number">Match #{index + 1}</span>
                  <span className="match-date">{new Date(match.created_at).toLocaleDateString()}</span>
                </div>
                <div className="match-details">
                  <span className="match-map">{match.map}</span>
                  <span className="vs">vs</span>
                  <span className="match-status">
                    {match.is_confirmed ? 'Confirmed' : 'Pending'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No recent matches</p>
        )}
      </section>
    </div>
  );
};

export default MyStats;
