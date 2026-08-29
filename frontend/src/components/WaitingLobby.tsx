import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { p2pChallengesService } from '../services/p2pChallengesService';
import { useAuthStore } from '../store/authStore';

/** Public player data returned by the waiting-lobby endpoint. */
interface WaitingPlayer {
  id: string;
  user_id: string;
  nickname: string;
  available_until: string;
  challenger_nicknames?: string | null;
  challenger_proposals?: Array<{ nickname: string; slots: string[] }>;
}
/** Optional management mode is enabled only on the authenticated player's profile. */
interface WaitingLobbyProps { manage?: boolean; timezone?: string; onChallenge?: (player: WaitingPlayer) => void; }

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const formatLocal = (value: string, timezone: string, locale: string) => new Date(value).toLocaleString(locale, {
  timeZone: timezone, hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric'
});
/** Format proposed half-hour slots as compact local-time ranges for the card. */
const formatSlotRanges = (slots: string[], timezone: string, locale: string) => {
  const ordered = [...new Set(slots)].map(value => new Date(value)).sort((a, b) => a.getTime() - b.getTime());
  const ranges: Array<[Date, Date]> = [];
  for (const slot of ordered) {
    const previous = ranges[ranges.length - 1];
    if (previous && slot.getTime() === previous[1].getTime() + 30 * 60 * 1000) {
      previous[1] = slot;
    } else {
      ranges.push([slot, slot]);
    }
  }
  return ranges.map(([start, last]) => {
    const end = new Date(last.getTime() + 30 * 60 * 1000);
    const options: Intl.DateTimeFormatOptions = { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false };
    return `${start.toLocaleTimeString(locale, options)}–${end.toLocaleTimeString(locale, options)}`;
  }).join(', ');
};
const localInputValue = (date: Date, timezone: string) => {
  // datetime-local has no timezone metadata, so its value must be assembled
  // from the requested wall clock rather than from the browser's local getters.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
/** Convert a wall-clock input in an IANA timezone to an ISO instant. */
const zonedInputToIso = (value: string, timezone: string) => {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  // Start with a UTC interpretation, then correct it by the offset observed
  // when that instant is rendered in the target zone. This preserves the
  // player's intended wall-clock time across DST changes.
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess)).map(part => [part.type, part.value]));
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess + Date.UTC(year, month - 1, day, hour, minute) - shown).toISOString();
};

/** Show the public challenge lobby and, on the profile page, manage the current player's announcement. */
const WaitingLobby: React.FC<WaitingLobbyProps> = ({ manage = false, timezone: requestedTimezone, onChallenge }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, userId } = useAuthStore();
  const timezone = useMemo(() => requestedTimezone || browserTimezone(), [requestedTimezone]);
  const [players, setPlayers] = useState<WaitingPlayer[]>([]);
  const [mine, setMine] = useState<any>(null);
  const [expiry, setExpiry] = useState(() => localInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000), requestedTimezone || browserTimezone()));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Refresh both the public list and the owner's private status so an
    // expiration or replacement is reflected without a full page reload.
    try {
      const result = await p2pChallengesService.listWaiting();
      setPlayers(result.waiting || []);
      if (manage && isAuthenticated) setMine((await p2pChallengesService.getMyWaiting()).waiting);
    } catch (error) { console.error('Failed to load challenge waiting lobby:', error); }
  }, [manage, isAuthenticated]);

  useEffect(() => { void load(); const timer = window.setInterval(load, 30000); return () => window.clearInterval(timer); }, [load]);

  const publish = async () => {
    // Convert the input from the player's profile timezone before sending it;
    // the API stores UTC instants and applies its own authoritative validation.
    setBusy(true);
    try { await p2pChallengesService.publishWaiting(expiry ? zonedInputToIso(expiry, timezone) : undefined); await load(); }
    finally { setBusy(false); }
  };
  const cancel = async () => { setBusy(true); try { await p2pChallengesService.cancelWaiting(); await load(); } finally { setBusy(false); } };

  return <section data-help-id="region-p2p-waiting-lobby" className="bg-white rounded-xl shadow-lg p-6">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h2 className="text-2xl font-bold text-gray-800">{t('waiting_lobby_title', "I'm waiting")}</h2>
      <span className="text-sm text-gray-500">{timezone}</span>
    </div>
    {manage && isAuthenticated && <div className="mb-5 flex flex-wrap items-end gap-3 border-b pb-4">
      <label className="text-sm text-gray-700">{t('waiting_lobby_until', 'Until')}
        <input data-help-id="field-challenge-waiting-expiration" type="datetime-local" value={expiry} min={localInputValue(new Date(), timezone)} max={localInputValue(new Date(Date.now() + 4 * 3600000), timezone)} onChange={e => setExpiry(e.target.value)} className="block mt-1 px-3 py-2 border rounded" />
      </label>
      <button data-help-id="action-publish-challenge-waiting" onClick={publish} disabled={busy} className="px-4 py-2 rounded bg-green-600 text-white font-semibold disabled:opacity-50">{mine ? t('waiting_lobby_extend', 'Extend') : t('waiting_lobby_button', 'Challenge me')}</button>
      {mine && <button data-help-id="action-cancel-challenge-waiting" onClick={cancel} disabled={busy} className="px-4 py-2 rounded bg-gray-200 text-gray-800 font-semibold disabled:opacity-50">{t('waiting_lobby_cancel', 'Cancel')}</button>}
    </div>}
    {players.length === 0 ? <p className="text-gray-500">{t('waiting_lobby_empty', 'No players are currently waiting.')}</p> : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {players.map(player => {
        // One waiting player may receive several pending proposals, so keep
        // the names as a list and use the highlighted card state for visibility.
        const challengers = player.challenger_proposals?.length
          ? player.challenger_proposals
          : (player.challenger_nicknames?.split(',').filter(Boolean) || []).map(nickname => ({ nickname, slots: [] }));
        return <div key={player.id} className={`rounded-lg border p-4 ${challengers.length > 0 ? 'border-orange-300 bg-orange-50' : 'border-green-200 bg-green-50'}`}>
        {isAuthenticated && player.user_id !== userId ? <button data-help-id="action-challenge-waiting-player" onClick={() => onChallenge?.(player)} className="text-lg font-bold text-blue-700 hover:underline">{player.nickname}</button> : !isAuthenticated ? <button data-help-id="action-login-to-challenge-waiting-player" onClick={() => navigate('/login')} className="text-lg font-bold text-blue-700 hover:underline">{player.nickname}</button> : <span className="text-lg font-bold text-gray-800">{player.nickname}</span>}
        <div className="text-sm text-gray-600">{t('waiting_lobby_until', 'Until')} {formatLocal(player.available_until, timezone, i18n.language)}</div>
        {challengers.length > 0 && <div className="mt-2 text-sm text-orange-900">
          <div className="font-semibold">{t('waiting_lobby_challenged_by', 'Challenged by')}:</div>
          {challengers.map(challenger => <div key={challenger.nickname} className="ml-2">
            <span className="font-semibold">{challenger.nickname}</span>
            {challenger.slots.length > 0 && <span className="block text-xs">{formatSlotRanges(challenger.slots, timezone, i18n.language)}</span>}
          </div>)}
        </div>}
      </div>;
      })}
    </div>}
  </section>;
};

export default WaitingLobby;
