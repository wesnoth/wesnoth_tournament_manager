import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface Props {
  match: any;
  compact?: boolean;
}

const styles: Record<string, string> = {
  ranked: 'bg-blue-100 text-blue-800',
  tournament_ranked: 'bg-indigo-100 text-indigo-800',
  tournament_unranked: 'bg-gray-200 text-gray-800',
  tournament_team: 'bg-purple-100 text-purple-800',
};

/** Display the match mode and its competition context without changing actions. */
const MatchTypeBadge: React.FC<Props> = ({ match, compact = false }) => {
  const { t } = useTranslation();
  const matchType = match.match_type || (match.tournament_id ? 'tournament_ranked' : 'ranked');
  const context = [
    match.tournament_phase_name,
    match.tournament_round_name || (match.tournament_round_number
      ? `${t('match_feed.round', 'Round')} ${match.tournament_round_number}`
      : null),
    match.tournament_game_number
      ? `${t('match_feed.game', 'Game')} ${match.tournament_game_number}`
      : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`flex flex-wrap items-center gap-1 ${compact ? 'mt-1' : 'mt-2'}`}>
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${styles[matchType] || styles.ranked}`}>
        {t(`match_type.${matchType}`, matchType)}
      </span>
      {match.tournament_id && match.tournament_name && (
        <Link
          data-help-id="action-open-match-tournament"
          to={`/tournament/${match.tournament_id}`}
          className="text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline"
        >
          {match.tournament_name}
        </Link>
      )}
      {!compact && context && <span className="text-xs text-gray-500">{context}</span>}
    </div>
  );
};

export default MatchTypeBadge;
