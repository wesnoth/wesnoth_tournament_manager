import React from 'react';
import { useTranslation } from 'react-i18next';
import { matchService } from '../services/api';
import PlayerLink from './PlayerLink';
import StarDisplay from './StarDisplay';
import ReplayConfirmationModal from './ReplayConfirmationModal';
import { useAuthStore } from '../store/authStore';
import MatchStreams from './MatchStreams';
import MatchTypeBadge from './MatchTypeBadge';
import { Link } from 'react-router-dom';

interface MatchesTableProps {
  matches: any[];
  currentPlayerId?: string;
  onDownloadReplay?: (matchId: string | null, replayFilePath: string, tournamentGameId?: string, tournamentId?: string) => void;
  onViewDetails?: (match: any) => void;
  onOpenConfirmation?: (match: any) => void;
  onReplayReported?: (replayId: string) => void;
}

type SortColumn = 'date' | 'winner' | 'loser' | 'map' | 'status' | '';
type SortDirection = 'asc' | 'desc';

const MatchesTable: React.FC<MatchesTableProps> = ({
  matches,
  currentPlayerId,
  onDownloadReplay,
  onViewDetails,
  onOpenConfirmation,
  onReplayReported,
}) => {
  const { t } = useTranslation();
  const { isAuthenticated, userId, user, isAdmin } = useAuthStore();
  const currentUserNickname = user?.nickname?.toLowerCase() || '';

  const [sortColumn, setSortColumn] = React.useState<SortColumn>('');
  const [sortDirection, setSortDirection] = React.useState<SortDirection>('desc');
  const [reportingReplayId, setReportingReplayId] = React.useState<string | null>(null);
  const [showConfirmationModal, setShowConfirmationModal] = React.useState(false);
  const [selectedReplay, setSelectedReplay] = React.useState<any>(null);
  const [modalChoice, setModalChoice] = React.useState<'I won' | 'I lost' | 'cancel'>('I won');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const winnerEloChange = (match: any) => (match.winner_elo_after || 0) - (match.winner_elo_before || 0);
  const loserEloChange = (match: any) => (match.loser_elo_after || 0) - (match.loser_elo_before || 0);

  const handleDownloadReplay = async (match: any, replayFilePath: string) => {
    try {
      if (!replayFilePath) return;
      const isPendingTournamentReplay = String(match.source_type).startsWith('tournament_replay_confidence_1');
      
      if (onDownloadReplay && !isPendingTournamentReplay) {
        await onDownloadReplay(
          match.source_type === 'tournament_game' ? null : match.match_id || match.id,
          replayFilePath,
          match.tournament_game_id,
          match.tournament_id,
        );
        return;
      }
      
      // Extract filename from path
      const filename = replayFilePath.split('/').pop() || `replay_${match.id}`;
      
      // Increment download count in the database
      if (match.source_type === 'tournament_game' && match.tournament_id && match.tournament_game_id) {
        await matchService.incrementTournamentGameReplayDownloads(match.tournament_id, match.tournament_game_id);
      } else {
        await matchService.incrementReplayDownloads(match.match_id || match.id);
      }
      
      // Use the replay_file_path HTTPS URL directly
      const link = document.createElement('a');
      link.href = replayFilePath;
      link.download = filename;
      link.target = '_blank';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error downloading replay:', err);
    }
  };

  const renderCompetitor = (match: any, winner: boolean) => {
    const nickname = winner ? match.winner_nickname : match.loser_nickname;
    const userId = winner ? match.winner_id : match.loser_id;
    const teamId = winner ? match.winner_team_id : match.loser_team_id;
    const members = (winner ? match.winner_members : match.loser_members) || [];
    const isTournamentWithoutOutcome = match.has_outcome === false
      && String(match.source_type).startsWith('tournament_');
    return (
      <div>
        {isTournamentWithoutOutcome && (
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {winner ? t('match_feed.side_1', 'Side 1') : t('match_feed.side_2', 'Side 2')}
          </div>
        )}
        {teamId
          ? <div className="font-semibold text-gray-900">{nickname}</div>
          : <PlayerLink nickname={nickname} userId={userId} />}
        {teamId && members.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs">
            {members.map((member: any) => (
              <PlayerLink key={`${teamId}:${member.user_id || member.nickname}`} nickname={member.nickname} userId={member.user_id} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const handleReportConfidence1Replay = (match: any, winner_choice: 'I won' | 'I lost' | 'cancel') => {
    // Open the modal with replay details
    setSelectedReplay(match);
    setModalChoice(winner_choice);
    setShowConfirmationModal(true);
  };

  const handleReplayReportSuccess = () => {
    // Close modal and refresh list
    setShowConfirmationModal(false);
    setSelectedReplay(null);
    
    if (onReplayReported && selectedReplay) {
      onReplayReported(selectedReplay.id);
    }
  };

  const handleAdminDiscardReplay = async (replayId: string) => {
    if (!window.confirm(t('replay_discard_confirm'))) return;
    try {
      await matchService.adminDiscardReplay(replayId);
      if (onReplayReported) onReplayReported(replayId);
    } catch (err) {
      console.error('Admin discard failed:', err);
      alert('Failed to discard replay. Please try again.');
    }
  };

  // Sorting logic for matches
  const sortedMatches = React.useMemo(() => {
    if (!sortColumn) return matches;
    const sorted = [...matches].sort((a, b) => {
      let aValue: any, bValue: any;
      switch (sortColumn) {
        case 'date':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        case 'winner':
          aValue = a.winner_nickname?.toLowerCase?.() || '';
          bValue = b.winner_nickname?.toLowerCase?.() || '';
          break;
        case 'loser':
          aValue = a.loser_nickname?.toLowerCase?.() || '';
          bValue = b.loser_nickname?.toLowerCase?.() || '';
          break;
        case 'map':
          aValue = a.map?.toLowerCase?.() || '';
          bValue = b.map?.toLowerCase?.() || '';
          break;
        case 'status':
          aValue = a.status || '';
          bValue = b.status || '';
          break;
        default:
          return 0;
      }
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [matches, sortColumn, sortDirection]);

  if (matches.length === 0) {
    return (
      <div className="w-full overflow-x-auto">
        <table className="w-full table-fixed border-collapse bg-white">
          <colgroup>
            <col className="w-[7%]" />
            <col className="w-[30%]" />
            <col className="w-[30%]" />
            <col className="w-[15%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead className="bg-gray-100 border-b-2 border-gray-300">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('date')}>{t('label_date')}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('winner')}>{t('label_winner')}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('loser')}>{t('label_loser')}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('map')}>{t('label_map')}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('status')}>{t('label_status_actions') || 'Status / Actions'}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">{t('matches_no_matches_found')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full table-fixed border-collapse bg-white">
        <colgroup>
          <col className="w-[7%]" />
          <col className="w-[30%]" />
          <col className="w-[30%]" />
          <col className="w-[15%]" />
          <col className="w-[18%]" />
        </colgroup>
        <thead className="bg-gray-100 border-b-2 border-gray-300">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('date')}>
              {t('label_date')}{sortColumn === 'date' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
            </th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('winner')}>
              {t('label_winner')}{sortColumn === 'winner' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
            </th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('loser')}>
              {t('label_loser')}{sortColumn === 'loser' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
            </th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('map')}>
              {t('label_map')}{sortColumn === 'map' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
            </th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('status')}>
              {t('label_status_actions') || 'Status / Actions'}{sortColumn === 'status' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedMatches.map((match) => {
            // Special rendering for confidence=1 replays (including 'due' replays)
            if (match.source_type === 'replay_confidence_1' || match.source_type === 'replay_confidence_1_due') {
              const map = match.map || 'Unknown Map';
              const faction1 = match.winner_faction || 'Unknown';
              const faction2 = match.loser_faction || 'Unknown';
              const player1Name = match.winner_nickname || 'Player 1';
              const player2Name = match.loser_nickname || 'Player 2';
              const side1 = match.winner_side || 1;
              const side2 = match.loser_side || 2;
              const date = new Date(match.created_at).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });
              const isDueReplay = match.source_type === 'replay_confidence_1_due';
               
              // Determine opponent for logged-in user (for correct tooltip display)
              const opponent = currentUserNickname.toLowerCase() === player1Name.toLowerCase() 
                ? player2Name 
                : player1Name;

              const rowBgColor = isDueReplay ? 'bg-red-100' : 'bg-yellow-50';
              const rowBorderColor = isDueReplay ? 'border-red-200' : 'border-yellow-200';
              const rowHoverColor = isDueReplay ? 'hover:bg-red-50' : 'hover:bg-yellow-50';

              return (
                <tr key={match.feed_id || match.id} className={`border-b ${rowBorderColor} ${rowHoverColor} ${rowBgColor}`}>
                  <td className="px-4 py-3 align-top text-sm text-gray-700">{date}</td>

                  <td className="px-4 py-3 align-top text-sm">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1 break-words">
                          <span className={`font-semibold ${isDueReplay ? 'text-red-800' : 'text-yellow-800'}`}>{player1Name}</span>
                        </div>
                        <span className={`inline-block px-2 py-1 ${isDueReplay ? 'bg-red-200 text-red-700' : 'bg-yellow-100 text-yellow-700'} text-xs rounded font-semibold`}>{faction1}</span>
                        <span className={`inline-block px-1.5 py-0.5 text-xs rounded font-semibold ${side1 === 1 ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>S{side1}</span>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top text-sm">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1 break-words">
                          <span className={`font-semibold ${isDueReplay ? 'text-red-800' : 'text-yellow-800'}`}>{player2Name}</span>
                        </div>
                        <span className={`inline-block px-2 py-1 ${isDueReplay ? 'bg-red-200 text-red-700' : 'bg-yellow-100 text-yellow-700'} text-xs rounded font-semibold`}>{faction2}</span>
                        <span className={`inline-block px-1.5 py-0.5 text-xs rounded font-semibold ${side2 === 1 ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>S{side2}</span>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top text-sm">
                    <div className={`break-words font-semibold ${isDueReplay ? 'text-red-900' : 'text-yellow-900'}`}>{map}</div>
                    {(match.replay_filename || match.game_name) && (
                      <div className={`text-xs ${isDueReplay ? 'text-red-700 bg-red-100' : 'text-yellow-700 bg-yellow-100'} mt-1 font-mono px-2 py-1 rounded truncate max-w-[200px]`} title={match.replay_filename || match.game_name}>
                        📄 {match.replay_filename || match.game_name}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3 align-top text-sm">
                    <div className="space-y-2">
                      <div>
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${isDueReplay ? 'bg-red-200 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {isDueReplay ? t('replay_due') || 'Due Replay' : t('replay_need_confirmation')}
                        </span>
                      </div>
                      {!isDueReplay && match.cancel_requested_by && (
                        <div className="text-xs text-gray-600 bg-gray-100 border border-gray-300 rounded px-2 py-1">
                          🚫 {t('label_cancel_requested')} — {t('label_waiting_other_player')}
                        </div>
                      )}
                      {isDueReplay ? (
                        // Due replay: read-only mode
                        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 italic">
                          {t('replay_due_expired') || 'Confirmation period expired. Download only.'}
                        </div>
                      ) : match.is_admin_view ? (
                        // Admin view: only discard
                        <div className="space-y-1">
                          <div className="text-xs text-orange-700 font-semibold">{t('replay_admin_view')}</div>
                          <button
                            className="px-3 py-1 rounded text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition"
                            onClick={() => handleAdminDiscardReplay(match.id)}
                            title={t('replay_discard')}
                          >
                            {t('replay_discard')}
                          </button>
                        </div>
                      ) : match.is_participant ? (
                        // Participant view: I won / I lost / Cancel
                        <>
                          <div className="text-xs text-yellow-700 mb-2 font-semibold">
                            {t('replay_who_won')}
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              className={`px-3 py-1 rounded text-xs font-semibold transition ${
                                showConfirmationModal
                                  ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                                  : 'bg-green-500 text-white hover:bg-green-600'
                              }`}
                              onClick={() => handleReportConfidence1Replay(match, 'I won')}
                              disabled={showConfirmationModal}
                              title={`${t('replay_i_won')}: ${currentUserNickname} beats ${opponent}`}
                            >
                              {t('replay_i_won')}
                            </button>
                            <button
                              className={`px-3 py-1 rounded text-xs font-semibold transition ${
                                showConfirmationModal
                                  ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                                  : 'bg-red-500 text-white hover:bg-red-600'
                              }`}
                              onClick={() => handleReportConfidence1Replay(match, 'I lost')}
                              disabled={showConfirmationModal}
                              title={`${t('replay_i_lost')}: ${opponent} beats ${currentUserNickname}`}
                            >
                              {t('replay_i_lost')}
                            </button>
                            <button
                              className={`px-3 py-1 rounded text-xs font-semibold transition ${
                                showConfirmationModal
                                  ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                                  : 'bg-gray-500 text-white hover:bg-gray-600'
                              }`}
                              onClick={() => handleReportConfidence1Replay(match, 'cancel')}
                              disabled={showConfirmationModal}
                              title={t('button_cancel_replay')}
                            >
                              🚫 {t('button_cancel_replay')}
                            </button>
                          </div>
                        </>
                      ) : null}
                      <div className={`mt-2 pt-2 ${isDueReplay ? 'border-t border-red-200' : 'border-t border-yellow-200'}`}>
                        {(match.replay_url || match.replay_file_path) ? (
                          <a
                            href={match.replay_url || match.replay_file_path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block px-3 py-1 rounded text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 transition"
                            title={t('replay_download')}
                          >
                            {t('replay_download')}
                          </a>
                        ) : (
                          <span className="text-xs text-gray-500">{t('no_replay')}</span>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            }

            // Regular match rendering
            const isCancelled = match.status === 'cancelled';
            const isPendingTournamentReplay = String(match.source_type).startsWith('tournament_replay_confidence_1');
            const hasEloData = match.has_elo_data !== false;
            const matchRowBgColor = isCancelled ? 'bg-red-100' : isPendingTournamentReplay ? 'bg-yellow-50' : '';
            const matchRowBorderColor = isCancelled ? 'border-red-200' : isPendingTournamentReplay ? 'border-yellow-200' : 'border-gray-200';
            const matchRowHoverColor = isCancelled ? 'hover:bg-red-50' : isPendingTournamentReplay ? 'hover:bg-yellow-100' : 'hover:bg-gray-50';

            return (
              <tr data-help-id="region-match-row" key={match.feed_id || match.id} className={`border-b ${matchRowBorderColor} ${matchRowHoverColor} ${matchRowBgColor}`}>
              <td className="px-4 py-3 align-top text-sm text-gray-700">{new Date(match.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>

              <td className="px-4 py-3 align-top text-sm">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1 break-words">
                      {renderCompetitor(match, true)}
                    </div>
                    <StarDisplay rating={match.loser_rating} size="sm" />
                    <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded font-semibold">{match.winner_faction}</span>
                    {match.winner_side && (
                      <span className={`inline-block px-1.5 py-0.5 text-xs rounded font-semibold ${match.winner_side === 1 ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>S{match.winner_side}</span>
                    )}
                  </div>
                  {hasEloData ? <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                    <div>
                      <span className="font-semibold text-gray-700">ELO: </span>
                      <span>{match.winner_elo_before || 'N/A'}</span>
                      {!isCancelled && (
                        <span className={`ml-1 font-semibold ${winnerEloChange(match) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ({winnerEloChange(match) >= 0 ? '+' : ''}{winnerEloChange(match)})
                        </span>
                      )}
                    </div>
                    {match.winner_ranking_pos && (
                      <div>
                        <span className="font-semibold text-gray-700">Rank: </span>
                        <span>{match.winner_ranking_pos}</span>
                        {!isCancelled && (
                          <span className={`ml-1 font-semibold ${(match.winner_ranking_change || 0) > 0 ? 'text-green-600' : (match.winner_ranking_change || 0) < 0 ? 'text-red-600' : ''}`}>
                            {(match.winner_ranking_change || 0) > 0 ? '↑' : (match.winner_ranking_change || 0) < 0 ? '↓' : ''}{Math.abs(match.winner_ranking_change || 0)}
                          </span>
                        )}
                      </div>
                    )}
                  </div> : <div className="text-xs font-semibold text-gray-500">
                    {match.match_type === 'tournament_ranked'
                      ? t('match_feed.elo_unavailable', 'ELO unavailable')
                      : t('match_feed.no_elo', 'No ELO')}
                  </div>}
                  {match.winner_comments && (
                    <div className="whitespace-pre-line break-words text-xs italic text-gray-500">{match.winner_comments}</div>
                  )}
                </div>
              </td>

              <td className="px-4 py-3 align-top text-sm">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1 break-words">
                      {renderCompetitor(match, false)}
                    </div>
                    <StarDisplay rating={match.winner_rating} size="sm" />
                    <span className="inline-block px-2 py-1 bg-red-100 text-red-700 text-xs rounded font-semibold">{match.loser_faction}</span>
                    {match.winner_side && (
                      <span className={`inline-block px-1.5 py-0.5 text-xs rounded font-semibold ${match.winner_side === 1 ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>S{match.winner_side === 1 ? 2 : 1}</span>
                    )}
                  </div>
                  {hasEloData ? <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                    <div>
                      <span className="font-semibold text-gray-700">ELO: </span>
                      <span>{match.loser_elo_before || 'N/A'}</span>
                      {!isCancelled && (
                        <span className={`ml-1 font-semibold ${loserEloChange(match) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ({loserEloChange(match) >= 0 ? '+' : ''}{loserEloChange(match)})
                        </span>
                      )}
                    </div>
                    {match.loser_ranking_pos && (
                      <div>
                        <span className="font-semibold text-gray-700">Rank: </span>
                        <span>{match.loser_ranking_pos}</span>
                        {!isCancelled && (
                          <span className={`ml-1 font-semibold ${(match.loser_ranking_change || 0) > 0 ? 'text-green-600' : (match.loser_ranking_change || 0) < 0 ? 'text-red-600' : ''}`}>
                            {(match.loser_ranking_change || 0) > 0 ? '↑' : (match.loser_ranking_change || 0) < 0 ? '↓' : ''}{Math.abs(match.loser_ranking_change || 0)}
                          </span>
                        )}
                      </div>
                    )}
                  </div> : <div className="text-xs font-semibold text-gray-500">
                    {match.match_type === 'tournament_ranked'
                      ? t('match_feed.elo_unavailable', 'ELO unavailable')
                      : t('match_feed.no_elo', 'No ELO')}
                  </div>}
                  {match.loser_comments && (
                    <div className="whitespace-pre-line break-words text-xs italic text-gray-500">{match.loser_comments}</div>
                  )}
                </div>
              </td>

              <td className="break-words px-4 py-3 align-top text-sm text-gray-700">
                <div>{match.map}</div>
                <MatchTypeBadge match={match} />
              </td>

              <td className="px-4 py-3 align-top text-sm">
                <div className="space-y-2">
                  <div>
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                      match.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                      match.status === 'reported' ? 'bg-orange-100 text-orange-700' :
                      match.status === 'disputed' ? 'bg-red-100 text-red-700' :
                      match.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                      match.status === 'pending_report' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {match.status === 'confirmed' && t('match_status_confirmed')}
                      {match.status === 'reported' && t('match_status_reported')}
                      {match.status === 'unconfirmed' && t('match_status_unconfirmed')}
                      {match.status === 'disputed' && t('match_status_disputed')}
                      {match.status === 'cancelled' && t('match_status_cancelled')}
                      {match.status === 'pending_report' && t('replay_need_confirmation')}
                      {!match.status && t('match_status_unconfirmed')}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {isAuthenticated && match.source_type === 'match' && (() => {
                      const isWinner = currentPlayerId === match.winner_id;
                      const isLoser = currentPlayerId === match.loser_id;
                      const hasWinnerData = match.winner_comments && match.winner_rating;
                      const hasLoserData = match.loser_comments && match.loser_rating;

                      // Winner should confirm if missing winner data
                      if (isWinner && !hasWinnerData) {
                        return (
                          <button
                            data-help-id="action-report-match-result"
                            className="px-2 py-1 bg-orange-500 text-white text-xs rounded hover:bg-orange-600 transition"
                            onClick={() => onOpenConfirmation && onOpenConfirmation(match)}
                            title={t('match_inform') || 'Inform Match'}
                          >
                            {t('match_inform') || 'Inform Match'}
                          </button>
                        );
                      }

                      // Loser should confirm if missing loser data
                      if (isLoser && !hasLoserData) {
                        return (
                          <button
                            data-help-id="action-confirm-match-result"
                            className="px-2 py-1 bg-orange-500 text-white text-xs rounded hover:bg-orange-600 transition"
                            onClick={() => onOpenConfirmation && onOpenConfirmation(match)}
                            title={t('report_match_link') || 'Confirm/Dispute'}
                          >
                            {t('report_match_link') || 'Confirm/Dispute'}
                          </button>
                        );
                      }

                      return null;
                    })()}
                    {isPendingTournamentReplay && match.tournament_id && (
                      <Link
                        data-help-id="action-open-tournament-replay"
                        to={`/tournament/${match.tournament_id}?tab=competition${match.tournament_series_id ? `&seriesId=${match.tournament_series_id}` : ''}${match.tournament_game_id ? `&gameId=${match.tournament_game_id}` : ''}`}
                        className="px-2 py-1 bg-amber-500 text-white text-xs rounded hover:bg-amber-600 transition"
                      >
                        {t('match_feed.confirm_in_tournament', 'Confirm in tournament')}
                      </Link>
                    )}
                    <button
                      data-help-id="action-view-match-details"
                      className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition"
                      onClick={() => {
                        if (onViewDetails) {
                          onViewDetails(match);
                        }
                      }}
                      title={t('view_match_details')}
                    >
                      {t('details_btn')}
                    </button>
                    {match.replay_file_path ? (
                      <a
                        data-help-id="action-download-match-replay"
                        href={match.replay_url || match.replay_file_path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 transition"
                        onClick={isPendingTournamentReplay ? undefined : (event) => {
                          event.preventDefault();
                          void handleDownloadReplay(match, match.replay_file_path);
                        }}
                        title={`${t('downloads')}: ${match.replay_downloads || 0}`}
                      >
                        ⬇️ {match.replay_downloads || 0}
                      </a>
                    ) : (
                      <span className="px-2 py-1 text-xs text-gray-500">{t('no_replay')}</span>
                    )}
                  </div>
                  <MatchStreams match={match} />
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>

      {/* Replay Confirmation Modal */}
      {selectedReplay && (
        <ReplayConfirmationModal
          isOpen={showConfirmationModal}
          replayId={selectedReplay.id}
          player1_nickname={selectedReplay.winner_nickname}
          player2_nickname={selectedReplay.loser_nickname}
          currentUserNickname={currentUserNickname}
          your_choice={modalChoice}
          map={selectedReplay.map}
          player1_faction={selectedReplay.winner_faction}
          player2_faction={selectedReplay.loser_faction}
          onClose={() => {
            setShowConfirmationModal(false);
            setSelectedReplay(null);
          }}
          onSuccess={handleReplayReportSuccess}
        />
      )}
    </div>
  );
};

export default MatchesTable;
