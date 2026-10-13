import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { matchService } from '../services/api';
import MainLayout from '../components/MainLayout';
import GlobalStatsRecalculationProgress from '../components/GlobalStatsRecalculationProgress';
import { useGlobalStatsRecalculation } from '../hooks/useGlobalStatsRecalculation';
import i18next from 'i18next';

interface DisputedMatch {
  id: string;
  winner_nickname?: string;
  loser_nickname?: string;
  map?: string;
  winner_faction?: string;
  loser_faction?: string;
  winner_comments?: string | null;
  loser_comments?: string | null;
  winner_id?: string;
  loser_id?: string;
  /** Participant who opened the dispute; NULL for disputes opened before this was recorded. */
  disputed_by?: string | null;
  disputed_by_nickname?: string | null;
  winner_rating?: number | null;
  loser_rating?: number | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
}

function formatDisputeDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(i18next.language);
}

const AdminDisputes: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, isTournamentModerator } = useAuthStore();
  
  const [disputes, setDisputes] = useState<DisputedMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedDispute, setSelectedDispute] = useState<DisputedMatch | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const {
    status: recalculationStatus,
    progress: recalculationProgress,
    warnings: recalculationWarnings,
    trackJob: trackRecalculationJob,
    reset: resetRecalculation,
  } = useGlobalStatsRecalculation();

  useEffect(() => {
    if (!isAuthenticated || (!isAdmin && !isTournamentModerator)) {
      navigate('/');
      return;
    }

    fetchDisputes();
  }, [isAuthenticated, isAdmin, isTournamentModerator, navigate, currentPage]);

  const fetchDisputes = async () => {
    try {
      setLoading(true);
      const response = await matchService.getAllDisputedMatches(currentPage);
      setDisputes(response.data?.disputes || response.data || []);
      setTotal(response.data?.pagination?.total || 0);
      setTotalPages(response.data?.pagination?.totalPages || 1);
      setError('');
    } catch (err: any) {
      console.error('Error fetching disputes:', err);
      setError(err.response?.data?.error || err.message || t('disputes_admin.load_failed'));
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  };

  const handleValidateDispute = async (matchId: string) => {
    resetRecalculation();
    setProcessingId(matchId);
    setError('');
    try {
      const response = await matchService.validateDispute(matchId);
      setMessage(t('dispute_validate_queued'));
      setSelectedDispute(null);
      fetchDisputes();

      const jobId = response.data?.recalculationJobId;
      if (jobId) {
        await trackRecalculationJob(jobId);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || t('disputes_admin.validate_failed'));
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectDispute = async (matchId: string) => {
    resetRecalculation();
    setProcessingId(matchId);
    setError('');
    try {
      const response = await matchService.rejectDispute(matchId);
      setMessage(response.data?.message || t('disputes_admin.rejected'));
      setSelectedDispute(null);
      fetchDisputes();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || t('disputes_admin.reject_failed'));
    } finally {
      setProcessingId(null);
    }
  };

  const handleAwardDisputeWin = async (matchId: string) => {
    setProcessingId(matchId);
    setError('');
    try {
      const response = await matchService.awardDisputeWin(matchId);
      // Keep the visible confirmation in the selected locale; the backend
      // response is an operational message and is not localized.
      setMessage(t('dispute_award_queued'));
      setSelectedDispute(null);
      fetchDisputes();

      const jobId = response.data?.recalculationJobId;
      if (jobId) {
        await trackRecalculationJob(jobId);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || t('error_awarding_dispute_win'));
    } finally {
      setProcessingId(null);
    }
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setSelectedDispute(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (loading) {
    return <MainLayout><div className="max-w-6xl mx-auto px-4 py-8"><p className="text-center text-gray-600">{t('loading')}</p></div></MainLayout>;
  }

  return (
    <MainLayout>
      <div data-help-id="region-match-disputes" className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">{t('disputes_admin.title')}</h1>

        {error && recalculationStatus === 'idle' && <p className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</p>}
        <GlobalStatsRecalculationProgress status={recalculationStatus} progress={recalculationProgress} warnings={recalculationWarnings} />
        {recalculationStatus === 'idle' && message && <p className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-4">{message}</p>}

        {disputes.length === 0 ? (
          <p className="text-center text-gray-600">{t('no_data')}</p>
        ) : (
          <section>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-800">{t('disputes_admin.list_title', { total })}</h2>
              <span className="text-sm text-gray-500">{t('pagination_page_info', { page: currentPage, totalPages })}</span>
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mb-4">
                <button className="px-3 py-2 border rounded disabled:opacity-50" onClick={() => handlePageChange(1)} disabled={currentPage === 1}>{t('pagination_first')}</button>
                <button className="px-3 py-2 border rounded disabled:opacity-50" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>{t('pagination_prev')}</button>
                <span className="px-3 text-sm text-gray-600">{disputes.length} shown</span>
                <button className="px-3 py-2 border rounded disabled:opacity-50" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>{t('pagination_next')}</button>
                <button className="px-3 py-2 border rounded disabled:opacity-50" onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages}>{t('pagination_last')}</button>
              </div>
            )}

            <table data-help-id="region-disputed-matches-table" className="w-full border-collapse bg-white shadow-md rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-200">
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('disputes_admin.col_match_id')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_winner')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_loser')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_map')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('disputes_admin.col_winner_faction')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('disputes_admin.col_loser_faction')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_status')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('disputes_admin.col_disputed_at')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((dispute) => (
                  <tr data-help-id="region-disputed-match-row" key={dispute.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{dispute.id.substring(0, 8)}</td>
                    <td className="px-4 py-3 text-gray-700">{dispute.winner_nickname}</td>
                    <td className="px-4 py-3 text-gray-700">{dispute.loser_nickname}</td>
                    <td className="px-4 py-3 text-gray-700">{dispute.map}</td>
                    <td className="px-4 py-3 text-gray-700">{dispute.winner_faction}</td>
                    <td className="px-4 py-3 text-gray-700">{dispute.loser_faction}</td>
                    <td className="px-4 py-3"><span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-semibold rounded-full">{dispute.status}</span></td>
                    <td className="px-4 py-3 text-gray-700">{formatDisputeDate(dispute.updated_at)}</td>
                    <td className="px-4 py-3">
                      <div>
                        <button 
                          data-help-id="action-view-dispute-details"
                          className="px-3 py-1 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600"
                          onClick={() => setSelectedDispute(dispute)}
                        >
                          {t('disputes_admin.view_details')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {selectedDispute && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedDispute(null)}>
            <div data-help-id="region-dispute-review" className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-5 border-b-2 border-blue-800 flex justify-between items-center rounded-t-xl">
                <h2 className="text-2xl font-bold text-white">{t('disputes_admin.review_title')}</h2>
                <button data-help-id="action-close-dispute-review" className="text-3xl text-white hover:text-blue-100 transition-colors" onClick={() => setSelectedDispute(null)}>×</button>
              </div>
              
              <div className="p-8 space-y-6">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6 border border-blue-200">
                  <h3 className="text-lg font-bold text-blue-900 mb-5">{t('disputes_admin.match_details')}</h3>
                  <div className="flex justify-around items-center mb-6">
                    <div className="text-center bg-white rounded-lg p-4 flex-1 mx-2 shadow-sm">
                      <p className="text-green-600 text-xs font-semibold uppercase tracking-wide">{t('label_winner')}</p>
                      <p className="text-xl font-bold text-gray-900 mt-2">{selectedDispute.winner_nickname}</p>
                      <p className="text-sm text-gray-700 mt-1 font-medium">{selectedDispute.winner_faction}</p>
                    </div>
                    <div className="text-gray-400 font-bold text-2xl mx-2">vs</div>
                    <div className="text-center bg-white rounded-lg p-4 flex-1 mx-2 shadow-sm">
                      <p className="text-red-600 text-xs font-semibold uppercase tracking-wide">{t('label_loser')}</p>
                      <p className="text-xl font-bold text-gray-900 mt-2">{selectedDispute.loser_nickname}</p>
                      <p className="text-sm text-gray-700 mt-1 font-medium">{selectedDispute.loser_faction}</p>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-4 space-y-2 text-sm text-gray-700">
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-800">{t('disputes_admin.map_label')}</span>
                      <span className="text-gray-900 font-medium">{selectedDispute.map}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-800">{t('disputes_admin.played_label')}</span>
                      <span className="text-gray-900 font-medium">{formatDisputeDate(selectedDispute.created_at)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-800">{t('dispute_opened_by')}</span>
                      <span className="text-gray-900 font-medium">{selectedDispute.disputed_by_nickname || t('dispute_opened_by_unknown')}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 rounded-lg p-6 border-l-4 border-green-500">
                  <h3 className="text-lg font-bold text-green-900 mb-4">{selectedDispute.disputed_by && selectedDispute.disputed_by === selectedDispute.winner_id ? t('disputes_admin.winner_comments_reason') : t('disputes_admin.winner_comments')}</h3>
                  <p className="whitespace-pre-line break-words leading-relaxed text-gray-800">{selectedDispute.winner_comments || t('disputes_admin.no_comments')}</p>
                  {selectedDispute.winner_rating && (
                    <p className="text-sm text-green-700 mt-4 font-semibold">⭐ {t('disputes_admin.match_rating', { rating: selectedDispute.winner_rating })}</p>
                  )}
                </div>

                <div className="bg-red-50 rounded-lg p-6 border-l-4 border-red-500">
                  {/* Disputes opened before `disputed_by` existed could only come from the loser. */}
                  <h3 className="text-lg font-bold text-red-900 mb-4">{!selectedDispute.disputed_by || selectedDispute.disputed_by === selectedDispute.loser_id ? t('disputes_admin.loser_comments_reason') : t('disputes_admin.loser_comments')}</h3>
                  <p className="whitespace-pre-line break-words leading-relaxed text-gray-800">{selectedDispute.loser_comments || t('disputes_admin.no_comments')}</p>
                  {selectedDispute.loser_rating && (
                    <p className="text-sm text-red-700 mt-4 font-semibold">⭐ {t('disputes_admin.match_rating', { rating: selectedDispute.loser_rating })}</p>
                  )}
                </div>

                <div className="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-lg">
                  <p className="text-amber-900 leading-relaxed"><strong className="font-bold">⚠️ {t('disputes_admin.notice_label')}</strong> {t('disputes_admin.notice_text')}</p>
                </div>
              </div>

              <div className="bg-gray-50 px-6 py-5 border-t-2 border-gray-200 flex justify-end gap-3 rounded-b-xl sticky bottom-0">
                <button
                  data-help-id="action-cancel-dispute-review"
                  className="px-6 py-2.5 bg-gray-400 text-white rounded-lg hover:bg-gray-500 font-semibold transition-colors shadow-md"
                  onClick={() => setSelectedDispute(null)}
                >
                  {t('common.cancel')}
                </button>
                <button 
                  data-help-id="action-validate-dispute-admin"
                  className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold transition-colors shadow-md flex items-center gap-2"
                  disabled={processingId === selectedDispute.id}
                  onClick={() => {
                    if (window.confirm(t('disputes_admin.confirm_validate'))) {
                      handleValidateDispute(selectedDispute.id);
                    }
                  }}
                >
                  ✓ {t('disputes_admin.validate')}
                </button>
                <button
                  data-help-id="action-award-dispute-win-admin"
                  className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold transition-colors shadow-md flex items-center gap-2"
                  disabled={processingId === selectedDispute.id}
                  onClick={() => {
                    if (window.confirm(t('confirm_award_dispute_win', { nickname: selectedDispute.loser_nickname }))) {
                      handleAwardDisputeWin(selectedDispute.id);
                    }
                  }}
                >
                  ✓ {t('award_dispute_win', { nickname: selectedDispute.loser_nickname })}
                </button>
                <button 
                  data-help-id="action-reject-dispute-admin"
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors shadow-md flex items-center gap-2"
                  disabled={processingId === selectedDispute.id}
                  onClick={() => {
                    if (window.confirm(t('disputes_admin.confirm_reject'))) {
                      handleRejectDispute(selectedDispute.id);
                    }
                  }}
                >
                  ✗ {t('disputes_admin.reject')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default AdminDisputes;
