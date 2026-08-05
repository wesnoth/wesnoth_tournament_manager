import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import StarRating from './StarRating';
import { api } from '../services/api';

type PhaseGameConfirmationAction = 'report' | 'respond';

interface PhaseGameConfirmationModalProps {
  isOpen: boolean;
  tournamentId: string;
  game: any;
  action: PhaseGameConfirmationAction;
  onClose: () => void;
  onSuccess: () => void;
}

/** Collect the winner/loser feedback required by the phase-game confirmation flow. */
const PhaseGameConfirmationModal: React.FC<PhaseGameConfirmationModalProps> = ({
  isOpen,
  tournamentId,
  game,
  action,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [rating, setRating] = useState('3');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen || !game) return null;

  const title = action === 'report'
    ? (t('match_inform') || 'Inform Match')
    : (t('report_match_link') || 'Report Match');
  const submitLabel = action === 'report'
    ? (t('match_inform') || 'Inform Match')
    : (t('report_match_link') || 'Report Match');
  const canDispute = Number(game.replay_confidence) === 1;

  const handleSubmit = async (responseAction: 'report' | 'confirm' | 'dispute') => {
    try {
      setSubmitting(true);
      setError('');
      await api.post(`/tournaments/${tournamentId}/games/${game.game_id}/confirm`, {
        action: responseAction,
        rating: Number(rating),
        comments: comments.trim() || undefined,
      });
      onSuccess();
      onClose();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Failed to update match confirmation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-gray-200 p-5">
          <h2 className="text-xl font-bold text-gray-800">{title}</h2>
          <p className="mt-1 text-sm text-gray-600">
            {game.entry1_name} vs {game.entry2_name}
          </p>
        </div>
        <div className="space-y-5 p-5">
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">
              {t('label_rate_opponent') || "Rate opponent's performance"}
            </label>
            <StarRating value={rating} onChange={(value) => setRating(value)} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">
              {t('label_comments') || 'Comments'}
            </label>
            <textarea
              data-help-id="field-phase-game-confirmation-comments"
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              maxLength={500}
              rows={4}
              className="w-full resize-none rounded border border-gray-300 px-3 py-2"
              placeholder={t('label_additional_notes') || 'Optional comments...'}
            />
            <div className="mt-1 text-right text-xs text-gray-500">{comments.length}/500</div>
          </div>
          {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>
        <div className="flex gap-3 border-t border-gray-200 p-5">
          <button data-help-id="action-cancel-phase-game-confirmation" type="button" onClick={onClose} disabled={submitting} className="flex-1 rounded border border-gray-300 px-4 py-2 font-semibold text-gray-700">
            {t('button_cancel') || 'Cancel'}
          </button>
          {action === 'respond' ? <>
            <button data-help-id="action-confirm-phase-game-result" type="button" onClick={() => handleSubmit('confirm')} disabled={submitting} className="flex-1 rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Processing...' : (t('match_confirm_result') || 'Confirm Match')}
            </button>
            {canDispute && <button data-help-id="action-dispute-phase-game-result" type="button" onClick={() => handleSubmit('dispute')} disabled={submitting} className="flex-1 rounded bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {submitting ? 'Processing...' : (t('match_dispute_result') || 'Dispute Match')}
            </button>}
          </> : <button data-help-id="action-report-phase-game-result" type="button" onClick={() => handleSubmit('report')} disabled={submitting} className="flex-1 rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {submitting ? 'Processing...' : submitLabel}
          </button>}
        </div>
      </div>
    </div>
  );
};

export default PhaseGameConfirmationModal;
