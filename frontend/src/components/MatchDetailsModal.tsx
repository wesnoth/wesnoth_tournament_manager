import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { matchService } from '../services/api';
import StarDisplay from './StarDisplay';
import MatchTypeBadge from './MatchTypeBadge';
import PlayerLink from './PlayerLink';
import { useTranslation } from 'react-i18next';

interface MatchDetailsModalProps {
  match: any;
  isOpen: boolean;
  onClose: () => void;
  onDownloadReplay?: (matchId: string | null, replayFilePath: string, tournamentGameId?: string, tournamentId?: string) => void;
  /** Called after the viewer successfully disputes the match. */
  onDisputeSuccess?: () => void;
}

const MatchDetailsModal: React.FC<MatchDetailsModalProps> = ({ match, isOpen, onClose, onDownloadReplay, onDisputeSuccess }) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();
  const [disputeFormOpen, setDisputeFormOpen] = useState(false);
  const [disputeComments, setDisputeComments] = useState('');
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [disputeSuccess, setDisputeSuccess] = useState(false);
  
  if (!isOpen || !match) {
    return null;
  }

  const winnerEloChange = (match: any) => (match.winner_elo_after || 0) - (match.winner_elo_before || 0);
  const loserEloChange = (match: any) => (match.loser_elo_after || 0) - (match.loser_elo_before || 0);

  // Either participant of a ranked match row may dispute an open result that no
  // admin has reviewed yet (mirrors the backend check in POST /matches/:id/confirm).
  // A dispute changes nothing by itself: an admin inverts, annuls, or keeps the
  // result. This replaces the former self-cancel, which let a player trigger a
  // global recalculation (e.g. the real winner surrendered by mistake and the
  // reported "winner" wants the result reopened).
  const isParticipant = !!userId && (match.winner_id === userId || match.loser_id === userId);
  const canDispute = match.source_type === 'match'
    && isParticipant
    && ['reported', 'unconfirmed', 'confirmed'].includes(match.status)
    && !match.admin_reviewed;
  const hasEloData = match.has_elo_data !== false;
  const isPendingTournamentReplay = String(match.source_type).startsWith('tournament_replay_confidence_1');

  const renderCompetitor = (winner: boolean) => {
    const nickname = winner ? match.winner_nickname : match.loser_nickname;
    const userId = winner ? match.winner_id : match.loser_id;
    const members = (winner ? match.winner_members : match.loser_members) || [];
    return (
      <div>
        <PlayerLink nickname={nickname} userId={userId} />
        {members.length > 0 && <div className="mt-1 flex flex-wrap justify-center gap-2 text-xs">
          {members.map((member: any) => <PlayerLink key={member.user_id || member.nickname} nickname={member.nickname} userId={member.user_id} />)}
        </div>}
      </div>
    );
  };

  const handleSubmitDispute = async () => {
    try {
      setDisputeLoading(true);
      setDisputeError(null);
      await matchService.confirmMatch(match.id, { action: 'dispute', comments: disputeComments.trim() || null });
      setDisputeSuccess(true);
      setTimeout(() => {
        if (onDisputeSuccess) {
          onDisputeSuccess();
        }
        onClose();
      }, 1500);
    } catch (error: any) {
      setDisputeError(error?.response?.status === 409
        ? t('match_dispute_not_allowed')
        : t('match_dispute_failed'));
    } finally {
      setDisputeLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fadeIn" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-11/12 max-h-screen overflow-y-auto border border-gray-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center border-b-2 border-gray-100 px-6 py-6 bg-gray-50">
          <h2 className="text-2xl font-semibold text-gray-800 m-0">Match Details</h2>
          <button 
            data-help-id="action-close-match-details"
            className="bg-none border-none text-gray-400 text-2xl cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded hover:text-gray-800 hover:bg-gray-100 transition-all"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-6">
          <div>
            <MatchTypeBadge match={match} />
            <div className="grid grid-cols-3 gap-4 mb-6 pb-4 border-b border-gray-200">
              <div>
                <label className="text-gray-600 text-sm font-semibold">Date:</label>
                <span className="text-gray-800 text-sm block">{new Date(match.played_at || match.created_at).toLocaleString()}</span>
              </div>
              <div>
                <label className="text-gray-600 text-sm font-semibold">Map:</label>
                <span className="text-gray-800 text-sm block">{match.map}</span>
              </div>
              <div>
                <label className="text-gray-600 text-sm font-semibold">Status:</label>
                <div className="text-sm">
                  {match.status === 'confirmed' && <span className="inline-block px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">✓ Confirmed</span>}
                  {match.status === 'reported' && <span className="inline-block px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-semibold">📋 Reported</span>}
                  {match.status === 'unconfirmed' && <span className="inline-block px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">⏳ Unconfirmed</span>}
                  {match.status === 'disputed' && <span className="inline-block px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">⚠ Disputed</span>}
                  {match.status === 'cancelled' && <span className="inline-block px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-semibold">✗ Cancelled</span>}
                  {match.status === 'pending_report' && <span className="inline-block px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">⏳ {t('replay_need_confirmation')}</span>}
                  {!match.status && <span className="inline-block px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">⏳ Unconfirmed</span>}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 bg-gray-50">Statistic</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700 bg-green-50">{match.has_outcome === false ? t('match_feed.side_1', 'Side 1') : 'Winner'}</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700 bg-red-50">{match.has_outcome === false ? t('match_feed.side_2', 'Side 2') : 'Loser'}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">Player</td>
                    <td className="px-4 py-3 text-center text-gray-800">{renderCompetitor(true)}</td>
                    <td className="px-4 py-3 text-center text-gray-800">{renderCompetitor(false)}</td>
                  </tr>

                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">Faction</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">{match.winner_faction}</span>
                      {match.winner_side && (
                        <span className={`ml-1 inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${match.winner_side === 1 ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>S{match.winner_side}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">{match.loser_faction}</span>
                      {match.winner_side && (
                        <span className={`ml-1 inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${match.winner_side === 1 ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>S{match.winner_side === 1 ? 2 : 1}</span>
                      )}
                    </td>
                  </tr>

                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">Rating</td>
                    <td className="px-4 py-3 text-center text-gray-800"><StarDisplay rating={match.loser_rating} size="md" /></td>
                    <td className="px-4 py-3 text-center text-gray-800"><StarDisplay rating={match.winner_rating} size="md" /></td>
                  </tr>

                  {hasEloData && <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">ELO Before</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.winner_elo_before || 'N/A'}</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.loser_elo_before || 'N/A'}</td>
                  </tr>}

                  {hasEloData && <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">ELO After</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.winner_elo_after || 'N/A'}</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.loser_elo_after || 'N/A'}</td>
                  </tr>}

                  {hasEloData && <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">ELO Change</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${winnerEloChange(match) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {winnerEloChange(match) >= 0 ? '+' : ''}{winnerEloChange(match)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${loserEloChange(match) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {loserEloChange(match) >= 0 ? '+' : ''}{loserEloChange(match)}
                      </span>
                    </td>
                  </tr>}

                  {!hasEloData && <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">ELO</td>
                    <td colSpan={2} className="px-4 py-3 text-center font-semibold text-gray-500">
                      {match.match_type === 'tournament_ranked'
                        ? t('match_feed.elo_unavailable', 'ELO unavailable')
                        : t('match_feed.no_elo', 'No ELO')}
                    </td>
                  </tr>}

                  {(match.winner_comments || match.loser_comments) && (
                    <tr className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">Comments</td>
                      <td className="whitespace-pre-line break-words px-4 py-3 text-justify text-xs text-gray-800">{match.winner_comments || '-'}</td>
                      <td className="whitespace-pre-line break-words px-4 py-3 text-justify text-xs text-gray-800">{match.loser_comments || '-'}</td>
                    </tr>
                  )}

                  {match.replay_file_path && (
                    <tr className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">Replay</td>
                      <td colSpan={2} className="px-4 py-3 text-center">
                        <a
                          data-help-id="action-download-match-replay"
                          href={match.replay_url || match.replay_file_path}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold text-sm transition-colors"
                          onClick={(event) => {
                            if (isPendingTournamentReplay) return;
                            event.preventDefault();
                            if (onDownloadReplay && (match.id || match.match_id)) {
                              onDownloadReplay(
                                match.source_type === 'tournament_game' ? null : match.match_id || match.id,
                                match.replay_file_path,
                                match.tournament_game_id,
                                match.tournament_id,
                              );
                            }
                          }}
                          title={`Downloads: ${match.replay_downloads || 0}`}
                        >
                          ⬇️ Download ({match.replay_downloads || 0})
                        </a>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {canDispute && disputeFormOpen && (
          <div data-help-id="region-match-dispute-form" className="px-6 py-4 border-t border-gray-200 bg-red-50">
            <p className="text-sm text-gray-700 mb-3">{t('match_dispute_description')}</p>
            <textarea
              data-help-id="field-match-dispute-comments"
              value={disputeComments}
              onChange={(e) => setDisputeComments(e.target.value)}
              placeholder={t('match_dispute_comments_placeholder')}
              rows={3}
              maxLength={500}
              disabled={disputeLoading || disputeSuccess}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-red-400 bg-white text-gray-800 disabled:opacity-50"
            />
            <div className="flex gap-3 justify-end mt-3">
              <button
                data-help-id="action-close-match-dispute-form"
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg font-semibold hover:bg-gray-400 disabled:opacity-50"
                onClick={() => { setDisputeFormOpen(false); setDisputeError(null); }}
                disabled={disputeLoading || disputeSuccess}
              >
                {t('match_dispute_back')}
              </button>
              <button
                data-help-id="action-submit-match-dispute"
                className={`px-4 py-2 rounded-lg font-semibold text-white disabled:cursor-not-allowed ${
                  disputeSuccess ? 'bg-green-500' : 'bg-red-500 hover:bg-red-600 disabled:bg-red-300'
                }`}
                onClick={handleSubmitDispute}
                disabled={disputeLoading || disputeSuccess}
              >
                {disputeLoading ? t('match_dispute_sending') : disputeSuccess ? t('match_dispute_success') : t('match_dispute_submit')}
              </button>
            </div>
            {disputeError && <p className="text-red-600 text-sm mt-2">{disputeError}</p>}
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex gap-3 justify-center">
          {canDispute && !disputeFormOpen && (
            <button
              data-help-id="action-dispute-match-result"
              className="px-6 py-2 rounded-lg font-semibold transition-colors bg-red-500 hover:bg-red-600 text-white"
              onClick={() => setDisputeFormOpen(true)}
            >
              {t('match_dispute_button')}
            </button>
          )}
          <button 
            data-help-id="action-close-match-details"
            className="px-6 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded-lg font-semibold transition-colors"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default MatchDetailsModal;
