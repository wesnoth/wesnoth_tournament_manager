import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { matchService } from '../services/api';
import StarDisplay from './StarDisplay';

interface MatchDetailsModalProps {
  match: any;
  isOpen: boolean;
  onClose: () => void;
  onDownloadReplay?: (matchId: string | null, replayFilePath: string, tournamentMatchId?: string) => void;
  onCancelSuccess?: () => void;
}

const MatchDetailsModal: React.FC<MatchDetailsModalProps> = ({ match, isOpen, onClose, onDownloadReplay, onCancelSuccess }) => {
  const { userId } = useAuthStore();
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = useState(false);
  
  if (!isOpen || !match) {
    return null;
  }

  const winnerEloChange = (match: any) => (match.winner_elo_after || 0) - (match.winner_elo_before || 0);
  const loserEloChange = (match: any) => (match.loser_elo_after || 0) - (match.loser_elo_before || 0);

  // Check if current user is the reporter (winner) and match can be cancelled
  const isReporter = match.winner_id === userId;
  const canCancel = isReporter && ['unconfirmed', 'confirmed'].includes(match.status);

  const handleCancelReport = async () => {
    try {
      setCancelLoading(true);
      setCancelError(null);
      await matchService.cancelOwnMatch(match.id);
      setCancelSuccess(true);
      setTimeout(() => {
        if (onCancelSuccess) {
          onCancelSuccess();
        }
        onClose();
      }, 1500);
    } catch (error: any) {
      setCancelError(error?.response?.data?.error || 'Failed to cancel match report');
    } finally {
      setCancelLoading(false);
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
                  {!match.status && <span className="inline-block px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">⏳ Unconfirmed</span>}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 bg-gray-50">Statistic</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700 bg-green-50">Winner</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700 bg-red-50">Loser</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">Player</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.winner_nickname}</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.loser_nickname}</td>
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

                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">ELO Before</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.winner_elo_before || 'N/A'}</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.loser_elo_before || 'N/A'}</td>
                  </tr>

                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">ELO After</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.winner_elo_after || 'N/A'}</td>
                    <td className="px-4 py-3 text-center text-gray-800">{match.loser_elo_after || 'N/A'}</td>
                  </tr>

                  <tr className="border-b border-gray-200 hover:bg-gray-50">
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
                  </tr>

                  {(match.winner_comments || match.loser_comments) && (
                    <tr className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-700 bg-gray-50">Comments</td>
                      <td className="px-4 py-3 text-justify text-gray-800 text-xs whitespace-normal break-words">{match.winner_comments || '-'}</td>
                      <td className="px-4 py-3 text-justify text-gray-800 text-xs whitespace-normal break-words">{match.loser_comments || '-'}</td>
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
                          onClick={() => {
                            if (onDownloadReplay && (match.id || match.match_id)) {
                              onDownloadReplay(match.match_id || null, match.replay_file_path, match.id);
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

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex gap-3 justify-center">
          {canCancel && (
            <button 
              data-help-id="action-cancel-match-report"
              className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
                cancelSuccess 
                  ? 'bg-green-500 text-white' 
                  : cancelLoading
                  ? 'bg-red-300 text-white cursor-not-allowed'
                  : 'bg-red-500 hover:bg-red-600 text-white'
              }`}
              onClick={handleCancelReport}
              disabled={cancelLoading || cancelSuccess}
            >
              {cancelLoading ? '⏳ Cancelling...' : cancelSuccess ? '✓ Report Cancelled' : '✗ Cancel Report'}
            </button>
          )}
          {cancelError && (
            <div className="text-red-600 text-sm self-center">
              {cancelError}
            </div>
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
