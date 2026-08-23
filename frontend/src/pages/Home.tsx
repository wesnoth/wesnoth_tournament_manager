import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { userService, matchService, publicService } from '../services/api';
import { processMultiLanguageItems } from '../utils/languageFallback';
import { getLevelTranslationKey } from '../utils/levelTranslation';
import PlayerLink from '../components/PlayerLink';
import GlobalStats from '../components/GlobalStats';
import { renderWikiMarkdown } from '../utils/wikiMarkdown';
import MatchStreams from '../components/MatchStreams';

// Get API URL for direct backend calls
// Determine API URL based on frontend hostname and Vite environment variables

// Cache with 5-minute TTL for home page data
const homeDataCache = new Map<string, { data: any; timestamp: number; userId: string | null }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getCacheKey = (key: string) => `home_${key}`;

const getCurrentUserId = (): string | null => {
  try {
    const token = localStorage.getItem('token');
    if (!token) return null;
    // Decode JWT to get user ID (payload is second part)
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.id || null;
  } catch {
    return null;
  }
};

const getCachedData = (key: string) => {
  const cached = homeDataCache.get(getCacheKey(key));
  const currentUserId = getCurrentUserId();
  
  if (
    cached &&
    Date.now() - cached.timestamp < CACHE_TTL &&
    cached.userId === currentUserId
  ) {
    return cached.data;
  }
  homeDataCache.delete(getCacheKey(key));
  return null;
};

const setCachedData = (key: string, data: any) => {
  const currentUserId = getCurrentUserId();
  homeDataCache.set(getCacheKey(key), { data, timestamp: Date.now(), userId: currentUserId });
};

const Home: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [topPlayers, setTopPlayers] = useState<any[]>([]);
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [recentPlayers, setRecentPlayers] = useState<any[]>([]);
  const [playerOfMonth, setPlayerOfMonth] = useState<any>(null);
  const [playerMonthlyStats, setPlayerMonthlyStats] = useState<any>(null);
  const [newsItems, setNewsItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fetchInProgressRef = useRef(false);

  const refetchMatches = async () => {
    try {
      const matchesRes = await publicService.getRecentMatches();
      const matches = matchesRes.data || matchesRes || [];
      setRecentMatches(Array.isArray(matches) ? matches.slice(0, 10) : []);
    } catch (err) {
      console.error('Error refetching matches:', err);
    }
  };

  const handleDownloadReplay = async (matchId: string, replayFilePath: string) => {
    try {
      if (!replayFilePath) {
        throw new Error('No replay file available');
      }
      
      // Extract filename from path
      const filename = replayFilePath.split('/').pop() || `replay_${matchId}`;
      
      // Increment download count in the database
      await matchService.incrementReplayDownloads(matchId);
      
      // Refresh the matches to update the download count
      await refetchMatches();
      
      // Use the replay_file_path HTTPS URL directly
      if (import.meta.env.VITE_DEBUG_LOGS === 'true') console.log('🔽 Downloading from:', replayFilePath);
      
      // Create a temporary anchor element to trigger download
      const link = document.createElement('a');
      link.href = replayFilePath;
      link.download = filename;
      link.target = '_blank';
      
      // Append to body, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      if (import.meta.env.VITE_DEBUG_LOGS === 'true') console.log('✅ Download started:', filename);
    } catch (err) {
      console.error('Error downloading replay:', err);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      // Prevent multiple simultaneous fetches
      if (fetchInProgressRef.current) {
        return;
      }

      try {
        fetchInProgressRef.current = true;
        setLoading(true);
        setError('');
        
        // Try to use cached data first
        const cachedPlayers = getCachedData('players');
        const cachedMatches = getCachedData('matches');
        const cachedUsers = getCachedData('users');
        const cachedNews = getCachedData('news');
        const cachedPOM = getCachedData('player-of-month');

        if (cachedPlayers) {
          setTopPlayers(cachedPlayers.slice(0, 10));
        } else {
          // Fetch top 10 players only if not cached
          try {
            const rankingRes = await userService.getGlobalRanking();
            const players = rankingRes.data?.data || rankingRes.data || [];
            setTopPlayers(Array.isArray(players) ? players.slice(0, 10) : []);
            setCachedData('players', players);
          } catch (err) {
            console.error('Error fetching ranking:', err);
          }
        }

        // Fetch player of month (separate from ranking cache)
        if (cachedPOM) {
          console.log('📊 Using cached player of month:', cachedPOM);
          setPlayerOfMonth(cachedPOM);
          setPlayerMonthlyStats({
            elo_gained: cachedPOM.elo_gained,
            positions_gained: cachedPOM.positions_gained,
            current_rank: cachedPOM.ranking_position
          });
        } else {
          try {
            const debugRes = await publicService.getDebug();
            console.log(`📊 Debug response (${debugRes.status}):`, debugRes.data);
            
            const pomRes = await publicService.getPlayerOfMonth();
            console.log(`📊 Response status: ${pomRes.status}`);
            console.log(`📊 Response headers:`, pomRes.headers);
            
            if (pomRes.status === 200) {
              try {
                const pomData = pomRes.data;
                console.log('✅ Player of month data:', pomData);
                setPlayerOfMonth(pomData);
                setPlayerMonthlyStats({
                  elo_gained: pomData.elo_gained,
                  positions_gained: pomData.positions_gained,
                  current_rank: pomData.ranking_position
                });
                setCachedData('player-of-month', pomData);
              } catch (parseErr) {
                console.error('❌ Failed to parse data:', parseErr);
                console.error('Response:', pomRes.data);
              }
            } else {
              console.warn(`⚠️ Player of month not available (${pomRes.status})`);
            }
          } catch (pomErr) {
            console.error('❌ Error fetching player of month:', pomErr);
          }
        }

        // Fetch recent matches (only 3 for home page)
        if (cachedMatches) {
          setRecentMatches(cachedMatches.slice(0, 3));
        } else {
          try {
            const matchesRes = await publicService.getRecentMatches();
            const matches = matchesRes.data || [];
            setRecentMatches(matches.slice(0, 3));
            setCachedData('matches', matches);
          } catch (err) {
            console.error('Error fetching matches:', err);
          }
        }

        // Fetch recent players (latest registrations)
        if (cachedUsers) {
          const sortedByDate = [...cachedUsers].sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
          });
          setRecentPlayers(sortedByDate.slice(0, 3));
        } else {
          try {
            const usersRes = await userService.getAllUsers();
            const allUsers = usersRes.data?.data || usersRes.data || [];
            if (Array.isArray(allUsers)) {
              setCachedData('users', allUsers);
              // Get newest players by sorting by creation date (reverse order for newest first)
              const sortedByDate = [...allUsers].sort((a, b) => {
                const dateA = new Date(a.created_at || 0).getTime();
                const dateB = new Date(b.created_at || 0).getTime();
                return dateB - dateA;
              });
              setRecentPlayers(sortedByDate.slice(0, 3));
            }
          } catch (err) {
            console.error('Error fetching recent players:', err);
          }
        }

        // Fetch recent news for the Home summary.
        if (cachedNews) {
          const localizedNews = processMultiLanguageItems(cachedNews, i18n.language);
          setNewsItems(localizedNews.slice(0, 5));
        } else {
          try {
            const newsRes = await publicService.getNews();
            const rawNews = newsRes.data || [];
            setCachedData('news', rawNews);
            // Process with language fallback: use user's language, fallback to EN
            const localizedNews = processMultiLanguageItems(rawNews, i18n.language);
            setNewsItems(localizedNews.slice(0, 5));
          } catch (err) {
            console.error('Error fetching news:', err);
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        setError('Error loading data');
      } finally {
        setLoading(false);
        fetchInProgressRef.current = false;
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return <div className="w-full p-4 bg-gradient-to-br from-blue-50 to-blue-100"><p>{t('loading')}</p></div>;
  }

  return (
    <div className="w-full max-w-full mx-auto px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200 min-h-screen flex flex-col">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">{t('app_name')}</h1>
        {error && <p className="bg-gradient-to-r from-red-100 to-red-50 text-red-900 p-4 rounded-lg border-l-4 border-red-500 shadow-md">{error}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 w-full">
        {/* Left Column: 3/4 width */}
        <div className="lg:col-span-3 flex flex-col gap-8">
          {/* Recent Matches */}
          <section className="bg-white rounded-xl shadow-lg p-8">
            <div className="flex justify-between items-center mb-6 pb-4 border-b-2 border-gray-200">
              <h2 className="text-2xl font-bold text-gray-800">{t('recent_games')}</h2>
              <a href="/matches" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 font-semibold text-sm px-4 py-2 rounded transition-all">{t('view_all') || 'View All →'}</a>
            </div>
            {recentMatches.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">{t('label_date')}</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">{t('label_winner')}</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">{t('label_winner_rating')}</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">{t('label_loser')}</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">{t('label_loser_rating')}</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">{t('label_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentMatches.map((match) => {
                      const isConfidence1 = match.source_type === 'replay_confidence_1';
                      const isDueReplay = match.source_type === 'replay_confidence_1_due';

                      if (isConfidence1 || isDueReplay) {
                        const map = match.map || 'Unknown Map';
                        const player1Name = match.winner_nickname || 'Player 1';
                        const player2Name = match.loser_nickname || 'Player 2';
                        const bgColor = isDueReplay ? 'bg-red-50' : 'bg-yellow-50';
                        const borderColor = isDueReplay ? 'border-red-200' : 'border-yellow-200';
                        const textColor = isDueReplay ? 'text-red-800' : 'text-yellow-800';
                        const badgeBg = isDueReplay ? 'bg-red-100' : 'bg-yellow-100';
                        const badgeText = isDueReplay ? 'text-red-700' : 'text-yellow-700';
                        const statusLabel = isDueReplay ? t('replay_due') : t('replay_need_confirmation');

                        return (
                          <tr key={match.id} className={`border-b ${borderColor} hover:${isDueReplay ? 'bg-red-100' : 'bg-yellow-50'} ${bgColor}`}>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {new Date(match.created_at).toLocaleDateString()}
                            </td>

                            <td className="px-4 py-3 text-sm" colSpan={2}>
                              <div className="space-y-2">
                                <div className="flex gap-2 items-center">
                                  <div className="flex-1 min-w-0">
                                    <span className={`font-semibold ${textColor}`}>{player1Name}</span>
                                  </div>
                                  {match.winner_faction && (
                                    <span className={`inline-block px-2 py-1 ${badgeBg} ${badgeText} text-xs rounded font-semibold`}>{match.winner_faction}</span>
                                  )}
                                  {match.winner_side && (
                                    <span className={`inline-block px-1.5 py-0.5 text-xs rounded font-semibold ${match.winner_side === 1 ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>S{match.winner_side}</span>
                                  )}
                                </div>
                              </div>
                            </td>

                            <td className="px-4 py-3 text-sm" colSpan={2}>
                              <div className="space-y-2">
                                <div className="flex gap-2 items-center">
                                  <div className="flex-1 min-w-0">
                                    <span className={`font-semibold ${textColor}`}>{player2Name}</span>
                                  </div>
                                  {match.loser_faction && (
                                    <span className={`inline-block px-2 py-1 ${badgeBg} ${badgeText} text-xs rounded font-semibold`}>{match.loser_faction}</span>
                                  )}
                                  {match.winner_side && (
                                    <span className={`inline-block px-1.5 py-0.5 text-xs rounded font-semibold ${match.winner_side === 1 ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>S{match.winner_side === 1 ? 2 : 1}</span>
                                  )}
                                </div>
                              </div>
                            </td>

                            <td className="px-4 py-3 text-sm">
                              <div className="space-y-2">
                                <div className={`font-semibold ${isDueReplay ? 'text-red-900' : 'text-yellow-900'}`}>{map}</div>
                                {(match.replay_filename || match.game_name) && (
                                  <div className={`text-xs ${badgeText} font-mono ${badgeBg} px-2 py-1 rounded truncate max-w-[200px]`} title={match.replay_filename || match.game_name}>
                                    📄 {match.replay_filename || match.game_name}
                                  </div>
                                )}
                                <div>
                                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${badgeBg} ${badgeText}`}>
                                    {statusLabel}
                                  </span>
                                </div>
                                {(match.replay_url || match.replay_file_path) && (
                                  <a
                                    href={match.replay_url || match.replay_file_path}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block px-3 py-1 rounded text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 transition"
                                    title={t('replay_download')}
                                  >
                                    {t('replay_download')}
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      const winnerEloChange = (match.winner_elo_after || 0) - (match.winner_elo_before || 0);
                      const loserEloChange = (match.loser_elo_after || 0) - (match.loser_elo_before || 0);

                      return (
                        <tr data-help-id="region-home-recent-match-row" key={match.id} className="border-b hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-700">
                            {new Date(match.created_at).toLocaleDateString()}
                          </td>
                          
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-green-600"><PlayerLink nickname={match.winner_nickname} userId={match.winner_id} /></span>
                              {match.winner_faction && (
                                <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded inline-block w-fit">{match.winner_faction}</span>
                              )}
                              {match.winner_side && (
                                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold inline-block w-fit ${match.winner_side === 1 ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>S{match.winner_side}</span>
                              )}
                              {match.winner_comments && (
                                <span className="text-xs text-gray-600 italic">{match.winner_comments}</span>
                              )}
                            </div>
                          </td>
                          
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <div className="text-gray-700 font-semibold">{match.winner_elo_before || 'N/A'}</div>
                              <div className={`text-sm font-semibold ${winnerEloChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                ({winnerEloChange >= 0 ? '+' : ''}{winnerEloChange})
                              </div>
                            </div>
                          </td>
                          
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-red-600"><PlayerLink nickname={match.loser_nickname} userId={match.loser_id} /></span>
                              {match.loser_faction && (
                                <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded inline-block w-fit">{match.loser_faction}</span>
                              )}
                              {match.winner_side && (
                                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold inline-block w-fit ${match.winner_side === 1 ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>S{match.winner_side === 1 ? 2 : 1}</span>
                              )}
                              {match.loser_comments && (
                                <span className="text-xs text-gray-600 italic">{match.loser_comments}</span>
                              )}
                            </div>
                          </td>
                          
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <div className="text-gray-700 font-semibold">{match.loser_elo_before || 'N/A'}</div>
                              <div className={`text-sm font-semibold ${loserEloChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                ({loserEloChange >= 0 ? '+' : ''}{loserEloChange})
                              </div>
                            </div>
                          </td>
                          
                          <td className="px-4 py-3">
                            <MatchStreams match={match} compact />
                            {match.replay_file_path && (
                              <a
                                href={match.replay_url || match.replay_file_path}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs transition-colors"
                                onClick={() => handleDownloadReplay(match.id, match.replay_file_path)}
                                title={`${t('downloads')}: ${match.replay_downloads || 0}`}
                              >
                                ⬇️
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>{t('recent_games_no_data')}</p>
            )}
          </section>

          {/* News */}
          <section className="bg-white rounded-xl shadow-lg p-8">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2>{t('news_title', 'News')}</h2>
              <Link to="/news" className="text-blue-700 font-semibold hover:underline">
                {t('news_see_all', 'See all news')}
              </Link>
            </div>
            {newsItems.length > 0 ? (
              <div className="flex flex-col gap-4">
                {newsItems.map((newsItem) => (
                  <div key={newsItem.id} className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
                    <h3>{newsItem.title}</h3>
                    <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: renderWikiMarkdown(newsItem.content || '').html }} />
                    <small>By {newsItem.author} - {new Date(newsItem.published_at || newsItem.created_at).toLocaleDateString(i18n.language)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p>{t('news_no_items', 'No news available')}</p>
            )}
          </section>
        </div>

        {/* Right Column: 20% */}
        <div className="flex flex-col gap-4">
          {/* Player of Month */}
          <section className="bg-white rounded-lg shadow p-6">
            <h3>{t('home.player_of_month')}</h3>
            {playerOfMonth ? (
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 mt-4">
                  <div className="font-semibold text-center mb-3"><PlayerLink nickname={playerOfMonth.nickname} userId={playerOfMonth.player_id || playerOfMonth.id} /></div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600 font-medium">{t('label_elo')}:</span>
                    <span className="text-gray-900 font-bold">{playerOfMonth.elo_rating}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600 font-medium">{t('label_ranking')}:</span>
                    <span className="text-gray-900 font-bold">#{playerOfMonth.ranking_position}</span>
                  </div>
                  {playerMonthlyStats && (
                    <>
                      <div className="flex justify-between items-center py-2 border-b border-gray-200">
                        <span className="text-gray-600 font-medium">ELO {t('month')}:</span>
                        <span className="text-gray-900 font-bold" style={{ color: playerMonthlyStats.elo_gained >= 0 ? '#4caf50' : '#f44336' }}>
                          {playerMonthlyStats.elo_gained >= 0 ? '+' : ''}{playerMonthlyStats.elo_gained}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-2">
                        <span className="text-gray-600 font-medium">{t('label_ranking_position')}:</span>
                        <span className="text-gray-900 font-bold" style={{ color: playerMonthlyStats.positions_gained >= 0 ? '#4caf50' : '#f44336' }}>
                          {playerMonthlyStats.positions_gained >= 0 ? '+' : ''}{playerMonthlyStats.positions_gained}
                        </span>
                      </div>
                    </>
                  )}
                </div>
            ) : (
              <p>{t('no_data')}</p>
            )}
          </section>

          {/* Recent Players */}
          <section className="bg-white rounded-lg shadow p-6">
            <h3>{t('home.recent_players')}</h3>
            {recentPlayers.length > 0 ? (
              <div className="flex flex-col gap-3">
                {recentPlayers.map((player) => (
                  <div key={player.id} className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-blue-600 font-semibold hover:text-blue-700"><PlayerLink nickname={player.nickname} userId={player.id} /></span>
                    <span className="text-gray-700 text-sm">
                      {player.is_rated ? `${player.elo_rating} ${t('label_elo')}` : t('unrated')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p>{t('no_data')}</p>
            )}
          </section>

          {/* Top 10 */}
          <section className="bg-white rounded-lg shadow p-6">
            <h3>{t('home.top_10_players')}</h3>
            {topPlayers.length > 0 ? (
              <div className="flex flex-col gap-3">
                {topPlayers.map((player, index) => (
                  <div key={player.id} className="flex items-center gap-3 py-2 border-b border-gray-200">
                    <span className="text-gray-600 font-semibold">#{index + 1}</span>
                    <span className="text-blue-600 font-semibold hover:text-blue-700"><PlayerLink nickname={player.nickname} userId={player.id} /></span>
                    <span className="text-gray-700 text-sm ml-auto">
                      {player.is_rated ? player.elo_rating : t('unrated')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p>{t('no_data')}</p>
            )}
          </section>

          {/* Global Statistics */}
          <GlobalStats />
        </div>
      </div>
    </div>
  );
};

export default Home;
