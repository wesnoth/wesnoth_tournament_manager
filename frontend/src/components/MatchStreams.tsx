import React from 'react';
import { useTranslation } from 'react-i18next';
import { matchService } from '../services/api';
import { useAuthStore } from '../store/authStore';

interface MatchStreamsProps { match: any; compact?: boolean; }

/** Displays links attached to a ranked match and lets streamers add one after completion. */
const MatchStreams: React.FC<MatchStreamsProps> = ({ match, compact = false }) => {
  const { t } = useTranslation();
  const { isStreamer, userId, isAdmin, isTournamentModerator } = useAuthStore();
  const [url, setUrl] = React.useState('');
  const [links, setLinks] = React.useState<any[]>(() => {
    if (Array.isArray(match.stream_links)) return match.stream_links;
    if (typeof match.stream_links === 'string') { try { return JSON.parse(match.stream_links) || []; } catch { return []; } }
    return [];
  });
  const [saving, setSaving] = React.useState(false);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setSaving(true);
    try {
      const response = await matchService.addStream(match.id, url.trim());
      setLinks(current => [...current, response.data]);
      setUrl('');
    } catch (error) { console.error('Failed to add match stream:', error); }
    finally { setSaving(false); }
  };

  const remove = async (streamId: string) => {
    if (!window.confirm(t('stream.delete_confirm'))) return;
    try {
      await matchService.deleteStream(match.id, streamId);
      setLinks(current => current.filter(link => link.id !== streamId));
    } catch (error) { console.error('Failed to delete match stream:', error); }
  };

  return <div data-help-id="region-match-streams" className={compact ? 'mt-1 space-y-1' : 'mt-2 border-t border-gray-200 pt-2 space-y-1'}>
    {links.length > 0 && <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs font-semibold text-purple-700">{t('stream.label')}:</span>
      {links.map(link => <span key={link.id} className="inline-flex items-center gap-1">
        <a data-help-id="action-open-match-stream" href={link.stream_url} target="_blank" rel="noopener noreferrer" className="rounded bg-purple-100 px-2 py-1 text-xs font-semibold text-purple-800 hover:bg-purple-200" title={`${t('stream.streamer')}: ${link.streamer_nickname || t('stream.unknown_streamer')}`}>
          {t('stream.watch')}{link.streamer_nickname ? ` · ${link.streamer_nickname}` : ''}
        </a>
        {(link.streamer_user_id === userId || isAdmin || isTournamentModerator) && <button data-help-id="action-delete-match-stream" type="button" onClick={() => void remove(link.id)} className="text-xs text-red-700 hover:underline">{t('stream.delete')}</button>}
      </span>)}
    </div>}
    {isStreamer && <form className="flex flex-wrap items-center gap-1" onSubmit={add}>
      <input data-help-id="field-match-stream-url" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder={t('stream.url_placeholder')} maxLength={2048} className="min-w-[180px] flex-1 rounded border border-gray-300 px-2 py-1 text-xs" />
      <button data-help-id="action-add-match-stream" type="submit" disabled={saving || !url.trim()} className="rounded bg-purple-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{saving ? t('stream.saving') : t('stream.add')}</button>
    </form>}
  </div>;
};

export default MatchStreams;
