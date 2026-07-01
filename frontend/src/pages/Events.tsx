import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tournamentService } from '../services/api';
import { challengeSchedulingService } from '../services/challengeSchedulingService';
import P2PChallengeModal from '../components/P2PChallengeModal';

type EventSourceType = 'tournament' | 'p2p';

interface EventItem {
  id: string;
  type: EventSourceType;
  title: string;
  tournamentName: string;
  players: string[];
  datetime: string;
  status: string;
  visibility?: string | null;
  raw: any;
}

const Events: React.FC = () => {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [showChallengeModal, setShowChallengeModal] = useState(false);

  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [typeFilter, setTypeFilter] = useState<'all' | EventSourceType>('all');
  const [tournamentNameFilter, setTournamentNameFilter] = useState('');
  const [playerFilter, setPlayerFilter] = useState('');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [myTournamentsResponse, p2pResponse] = await Promise.all([
        tournamentService.getMyTournaments(),
        challengeSchedulingService.listProposals('all'),
      ]);

      const tournaments = myTournamentsResponse.data || [];
      const tournamentRoundMatchesResponses = await Promise.all(
        tournaments
          .filter((t: any) => t?.id)
          .map((t: any) => tournamentService.getTournamentRoundMatches(t.id))
      );

      const tournamentEvents: EventItem[] = tournamentRoundMatchesResponses.flatMap((response: any, index: number) => {
        const tournament = tournaments[index];
        const matches = response.data || [];
        return matches
          .filter((m: any) => !!m?.scheduled_datetime)
          .map((m: any) => ({
            id: `tournament-${m.id}`,
            type: 'tournament',
            title: `${t('events_tournament_schedule') || 'Tournament Schedule'}: ${tournament?.name || ''}`,
            tournamentName: tournament?.name || '',
            players: [m.player1_nickname, m.player2_nickname].filter(Boolean),
            datetime: m.scheduled_datetime,
            status: m.scheduled_status || 'pending',
            raw: m,
          }));
      });

      const p2pRows = p2pResponse?.proposals || [];
      const p2pEvents: EventItem[] = p2pRows
        .filter((p: any) => !!p?.first_slot_datetime)
        .map((p: any) => ({
          id: `p2p-${p.id}`,
          type: 'p2p',
          title: t('events_p2p_challenge') || 'P2P Challenge',
          tournamentName: '',
          players: [p.proposed_by_nickname, p.challenged_nickname].filter(Boolean),
          datetime: p.first_slot_datetime,
          status: p.status || 'pending',
          visibility: p.visibility || 'private',
          raw: p,
        }));

      const merged = [...tournamentEvents, ...p2pEvents].sort((a, b) => {
        return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
      });

      setEvents(merged);
    } catch (err) {
      console.error('Error loading events:', err);
      setError(t('events_error_loading') || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (typeFilter !== 'all' && event.type !== typeFilter) return false;

      if (tournamentNameFilter.trim() && event.type === 'tournament') {
        if (!event.tournamentName.toLowerCase().includes(tournamentNameFilter.trim().toLowerCase())) {
          return false;
        }
      }

      if (playerFilter.trim()) {
        const playersJoined = event.players.join(' ').toLowerCase();
        if (!playersJoined.includes(playerFilter.trim().toLowerCase())) {
          return false;
        }
      }

      const eventDate = new Date(event.datetime);
      if (fromDateFilter) {
        const from = new Date(fromDateFilter);
        from.setHours(0, 0, 0, 0);
        if (eventDate < from) return false;
      }
      if (toDateFilter) {
        const to = new Date(toDateFilter);
        to.setHours(23, 59, 59, 999);
        if (eventDate > to) return false;
      }

      return true;
    });
  }, [events, typeFilter, tournamentNameFilter, playerFilter, fromDateFilter, toDateFilter]);

  const groupedByDay = useMemo(() => {
    const grouped: Record<string, EventItem[]> = {};
    for (const event of filteredEvents) {
      const key = new Date(event.datetime).toISOString().slice(0, 10);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(event);
    }
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEvents]);

  return (
    <div className="bg-gradient-to-br from-gray-100 to-gray-300 min-h-screen py-8 px-4">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-gray-800">{t('events_title') || 'Events'}</h1>
          <button
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 font-semibold"
            onClick={() => setShowChallengeModal(true)}
          >
            {t('events_button_challenge') || 'Challenge'}
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
          <select
            className="px-3 py-2 border border-gray-300 rounded"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as 'calendar' | 'list')}
          >
            <option value="calendar">{t('events_view_calendar') || 'Calendar view'}</option>
            <option value="list">{t('events_view_list') || 'List view'}</option>
          </select>

          <select
            className="px-3 py-2 border border-gray-300 rounded"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | EventSourceType)}
          >
            <option value="all">{t('events_filter_type_all') || 'All'}</option>
            <option value="tournament">{t('events_filter_type_tournament') || 'Tournament'}</option>
            <option value="p2p">{t('events_filter_type_p2p') || 'P2P'}</option>
          </select>

          <input
            type="text"
            className="px-3 py-2 border border-gray-300 rounded"
            placeholder={t('events_filter_tournament_name') || 'Tournament name'}
            value={tournamentNameFilter}
            onChange={(e) => setTournamentNameFilter(e.target.value)}
          />

          <input
            type="text"
            className="px-3 py-2 border border-gray-300 rounded"
            placeholder={t('events_filter_players') || 'Players'}
            value={playerFilter}
            onChange={(e) => setPlayerFilter(e.target.value)}
          />

          <input
            type="date"
            className="px-3 py-2 border border-gray-300 rounded"
            value={fromDateFilter}
            onChange={(e) => setFromDateFilter(e.target.value)}
          />

          <input
            type="date"
            className="px-3 py-2 border border-gray-300 rounded"
            value={toDateFilter}
            onChange={(e) => setToDateFilter(e.target.value)}
          />
        </div>

        {loading && (
          <div className="bg-white rounded-lg shadow p-6 text-gray-600">{t('loading')}</div>
        )}

        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
        )}

        {!loading && !error && filteredEvents.length === 0 && (
          <div className="bg-white rounded-lg shadow p-6 text-gray-600">
            {t('events_empty') || 'No events found with current filters'}
          </div>
        )}

        {!loading && !error && filteredEvents.length > 0 && viewMode === 'list' && (
          <div className="bg-white rounded-lg shadow overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="text-left px-4 py-3">{t('events_table_type') || 'Type'}</th>
                  <th className="text-left px-4 py-3">{t('events_table_name') || 'Name'}</th>
                  <th className="text-left px-4 py-3">{t('events_table_players') || 'Players'}</th>
                  <th className="text-left px-4 py-3">{t('events_table_datetime') || 'Date/Time'}</th>
                  <th className="text-left px-4 py-3">{t('events_table_status') || 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <tr key={event.id} className="border-t border-gray-100">
                    <td className="px-4 py-3">
                      {event.type === 'tournament'
                        ? (t('events_filter_type_tournament') || 'Tournament')
                        : (t('events_filter_type_p2p') || 'P2P')}
                    </td>
                    <td className="px-4 py-3">{event.title}</td>
                    <td className="px-4 py-3">{event.players.join(' vs ')}</td>
                    <td className="px-4 py-3">{new Date(event.datetime).toLocaleString()}</td>
                    <td className="px-4 py-3">{event.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && filteredEvents.length > 0 && viewMode === 'calendar' && (
          <div className="space-y-4">
            {groupedByDay.map(([dateKey, dayEvents]) => (
              <section key={dateKey} className="bg-white rounded-lg shadow">
                <div className="px-4 py-3 border-b border-gray-200 font-semibold text-gray-800">
                  {new Date(dateKey).toLocaleDateString()}
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {dayEvents.map((event) => (
                    <article key={event.id} className="border border-gray-200 rounded p-3 bg-gray-50">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {event.type === 'tournament'
                          ? (t('events_filter_type_tournament') || 'Tournament')
                          : (t('events_filter_type_p2p') || 'P2P')}
                      </p>
                      <h3 className="font-semibold text-gray-800 mt-1">{event.title}</h3>
                      <p className="text-sm text-gray-700 mt-1">{event.players.join(' vs ')}</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {new Date(event.datetime).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        {t('events_table_status') || 'Status'}: {event.status}
                        {event.type === 'p2p' && event.visibility ? ` • ${event.visibility}` : ''}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <P2PChallengeModal
        isOpen={showChallengeModal}
        onClose={() => setShowChallengeModal(false)}
        onSuccess={loadEvents}
      />
    </div>
  );
};

export default Events;

