import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { tournamentService, publicService } from '../services/api';
import { p2pChallengesService } from '../services/p2pChallengesService';
import { tournamentSchedulingService } from '../services/tournamentSchedulingService';
import ScheduleProposalModal from '../components/ScheduleProposalModal';
import ChallengeFromEventsModal from '../components/ChallengeFromEventsModal';
import ChallengeActionButtons from '../components/ChallengeActionButtons';
import { useAuthStore } from '../store/authStore';
import WaitingLobby from '../components/WaitingLobby';
import ChallengeFromPlayerModal from '../components/ChallengeFromPlayerModal';

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
  isTeamMode?: boolean;
  userTeamParticipates?: boolean;
}

/** Map the selected application language to a locale understood by Intl. */
const getDateLocale = (language: string): string => {
  const languageCode = language.split('-')[0];
  return ({ en: 'en-US', es: 'es-ES', de: 'de-DE', ru: 'ru-RU', zh: 'zh-CN' } as Record<string, string>)[languageCode]
    || 'en-US';
};

/** Format an event timestamp in the viewer's IANA timezone and language. */
const formatEventDateTime = (datetime: string, timezone: string, locale: string): string =>
  new Date(datetime).toLocaleString(locale, { timeZone: timezone });

/** Return the calendar date key for an event in the viewer's timezone. */
const getEventDateKey = (datetime: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(datetime));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const Events: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { userId } = useAuthStore();
  const dateLocale = getDateLocale(i18n.language);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [userTimezone, setUserTimezone] = useState('UTC');

  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [typeFilter, setTypeFilter] = useState<'all' | EventSourceType>('all');
  const [tournamentNameFilter, setTournamentNameFilter] = useState('');
  const [playerFilter, setPlayerFilter] = useState('');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [myEventsOnly, setMyEventsOnly] = useState(false);
  const [scheduleModal, setScheduleModal] = useState<any>({ isOpen: false });
  const [waitingChallenge, setWaitingChallenge] = useState<any>(null);

  const getEventStatusLabel = (status: string): string => {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const translationKey = `events_status_${normalizedStatus}`;
    const translatedStatus = t(translationKey);
    if (translatedStatus !== translationKey) return translatedStatus;
    return normalizedStatus
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  };

  const openSeriesSchedule = useCallback(async (event: EventItem) => {
    const seriesId = event.raw?.series_id;
    const tournamentId = event.raw?.tournament_id;
    if (!seriesId || !tournamentId) return;
    try {
      const [availability, proposalResponse] = await Promise.all([
        tournamentSchedulingService.getSeriesParticipantsAvailability(tournamentId, seriesId),
        tournamentSchedulingService.getSeriesProposal(tournamentId, seriesId),
      ]);
      const proposal = proposalResponse.proposal || null;
      const timezone = availability.viewing_timezone || 'UTC';
      const earliest = proposal?.slots?.length
        ? new Date(Math.min(...proposal.slots.map((slot: any) => new Date(slot.slot_datetime).getTime())))
        : new Date(event.datetime);
      const dateParts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
      }).formatToParts(earliest);
      const value = (type: string, fallback: string) => dateParts.find((part) => part.type === type)?.value || fallback;
      setScheduleModal({
        isOpen: true,
        tournamentId,
        seriesId,
        initialParticipants: availability.participants || [],
        initialProposal: proposal,
        initialViewingTimezone: timezone,
        initialDisplayDateStart: new Date(Date.UTC(Number(value('year', '2026')), Number(value('month', '1')) - 1, Number(value('day', '1')))),
        initialScrollToHour: Number(value('hour', '0')),
      });
    } catch (error) {
      console.error('Error opening series schedule from Events:', error);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [userResponse, myTournamentsResponse, p2pResponse] = await Promise.all([
        userId ? publicService.getPlayerProfile(userId) : Promise.resolve(null),
        publicService.getTournaments(1),
        p2pChallengesService.listProposals('all'),
      ]);

      if (userResponse?.data?.timezone) {
        setUserTimezone(userResponse.data.timezone);
      }

      const firstTournamentPage = myTournamentsResponse.data || {};
      const additionalTournamentPages = await Promise.all(
        Array.from(
          { length: Math.max(0, Number(firstTournamentPage.pagination?.totalPages || 1) - 1) },
          (_, index) => publicService.getTournaments(index + 2)
        )
      );
      const tournaments = [
        ...(firstTournamentPage.data || []),
        ...additionalTournamentPages.flatMap((response: any) => response.data?.data || []),
      ];
      const scheduledSeriesResponses = await Promise.all(
        tournaments.map((t: any) => Number(t?.competition_model_version) === 2
          ? tournamentService.getTournamentScheduledSeries(t.id).catch(() => ({ data: { schedules: [] } }))
          : Promise.resolve({ data: { schedules: [] } }))
      );
      // Load participants for team mode tournaments
      const tournamentParticipantsMap: Record<string, any[]> = {};
      const participantsResponses = await Promise.all(
        tournaments
          .filter((t: any) => t?.id && t?.tournament_mode === 'team')
          .map((t: any) => 
            publicService.getTournamentParticipants(t.id)
              .then((response: any) => ({
                tournamentId: t.id,
                participants: response.data || []
              }))
              .catch((err: any) => ({
                tournamentId: t.id,
                participants: []
              }))
          )
      );

      participantsResponses.forEach(({ tournamentId, participants }: any) => {
        tournamentParticipantsMap[tournamentId] = participants;
      });

      const phaseTournamentEvents: EventItem[] = scheduledSeriesResponses.flatMap((response: any, index: number) => {
        const tournament = tournaments[index];
        const schedules = response.data?.schedules || [];
        const isTeamMode = tournament?.tournament_mode === 'team';
        return schedules.map((schedule: any) => ({
          id: `tournament-series-${schedule.series_id}`,
          type: 'tournament' as const,
          title: `${t('events_tournament_schedule') || 'Tournament Schedule'}: ${schedule.tournament_name || tournament?.name || ''}`,
          tournamentName: schedule.tournament_name || tournament?.name || '',
          players: [schedule.player1_name, schedule.player2_name].filter(Boolean),
          datetime: schedule.scheduled_datetime,
          status: schedule.scheduled_status || 'confirmed',
          raw: {
            ...schedule,
            tournament_id: tournament?.id,
            player1_id: schedule.player1_id,
            player2_id: schedule.player2_id,
          },
          isTeamMode,
          userTeamParticipates: isTeamMode
            ? schedule.player1_team_id === (tournamentParticipantsMap[tournament?.id] || [])
                .find((participant: any) => participant.user_id === userId)?.team_id
              || schedule.player2_team_id === (tournamentParticipantsMap[tournament?.id] || [])
                .find((participant: any) => participant.user_id === userId)?.team_id
            : undefined,
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
          visibility: p.visibility || 'public',
          raw: p,
        }));

      const merged = [...phaseTournamentEvents, ...p2pEvents].sort((a, b) => {
        return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
      });

      setEvents(merged);
    } catch (err) {
      console.error('Error loading events:', err);
      setError(t('events_error_loading') || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [t, userId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const renderScheduleSlots = useCallback((proposal: any, timezone: string) => {
    if (!proposal || !proposal.slots || proposal.slots.length === 0) {
      return null;
    }

    const slots = proposal.slots;

    // Sort and group confirmed slots into ranges
    const sortedSlots = slots
      .map((s: any) => ({ ...s, dateObj: new Date(s.slot_datetime) }))
      .sort((a: any, b: any) => a.dateObj.getTime() - b.dateObj.getTime());

    // Group contiguous slots (30-min intervals)
    const ranges: Array<{ start: Date; end: Date }> = [];
    if (sortedSlots.length > 0) {
      let currentStart = sortedSlots[0].dateObj;
      let currentEnd = sortedSlots[0].dateObj;

      for (let i = 1; i < sortedSlots.length; i++) {
        const current = sortedSlots[i].dateObj;
        const prevEnd = new Date(currentEnd.getTime() + 30 * 60 * 1000); // Add 30 min

        if (current.getTime() === prevEnd.getTime()) {
          // Contiguous - extend current range
          currentEnd = current;
        } else {
          // Gap found - save range and start new one
          const endTime = new Date(currentEnd.getTime() + 30 * 60 * 1000);
          ranges.push({ start: currentStart, end: endTime });
          currentStart = current;
          currentEnd = current;
        }
      }
      // Add last range
      const endTime = new Date(currentEnd.getTime() + 30 * 60 * 1000);
      ranges.push({ start: currentStart, end: endTime });
    }

    return (
      <div className="mt-2 text-xs text-gray-600 space-y-1">
        {ranges.map((range, idx) => (
          <div key={idx}>
            {range.start.toLocaleTimeString(dateLocale, {
              timeZone: timezone,
              hour: '2-digit',
              minute: '2-digit'
            })}
            {' – '}
            {range.end.toLocaleTimeString(dateLocale, {
              timeZone: timezone,
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        ))}
      </div>
    );
  }, [dateLocale]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Apply "My Events" filter
      if (myEventsOnly) {
        const isUserInvolved = 
          (event.type === 'p2p' && 
            (event.raw?.proposed_by_user_id === userId || event.raw?.challenged_user_id === userId))
          || (event.type === 'tournament' && 
            (event.isTeamMode ? event.userTeamParticipates : (event.raw?.player1_id === userId || event.raw?.player2_id === userId)));
        
        if (!isUserInvolved) return false;
      } else {
        // Hide pending_confirmation tournament events where user is not involved (unless "My Events" filter is on)
        if (event.type === 'tournament' && event.status === 'pending_confirmation') {
          const isUserInvolved = 
            event.isTeamMode ? event.userTeamParticipates : (event.raw?.player1_id === userId || event.raw?.player2_id === userId);
          if (!isUserInvolved) return false;
        }
      }

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
      // The default events view is an upcoming-events view. Historical events
      // remain available when the user explicitly selects a start date.
      if (!fromDateFilter && eventDate.getTime() < Date.now()) return false;
      const eventDateKey = getEventDateKey(event.datetime, userTimezone);
      if (fromDateFilter) {
        if (eventDateKey < fromDateFilter) return false;
      }
      if (toDateFilter) {
        if (eventDateKey > toDateFilter) return false;
      }

      return true;
    });
  }, [events, typeFilter, tournamentNameFilter, playerFilter, fromDateFilter, toDateFilter, myEventsOnly, userId, userTimezone]);

  const groupedByDay = useMemo(() => {
    const grouped: Record<string, EventItem[]> = {};
    for (const event of filteredEvents) {
      const key = getEventDateKey(event.datetime, userTimezone);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(event);
    }
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEvents, userTimezone]);

  return (
    <div data-help-id="region-events" className="bg-gradient-to-br from-gray-100 to-gray-300 min-h-screen py-8 px-4">
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

        <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded text-sm text-blue-800">
          <span className="font-semibold">{t('events_viewing_as') || 'Viewing as'}:</span> {userTimezone || 'UTC'}{' '}
          <span className="text-xs text-blue-600">
            ({t('events_viewing_note') || 'All times converted to your timezone'})
          </span>
        </div>

        <WaitingLobby onChallenge={(player) => setWaitingChallenge(player)} />

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

          <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded bg-white hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={myEventsOnly}
              onChange={(e) => setMyEventsOnly(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium">{t('events_filter_my_events') || 'My Events'}</span>
          </label>
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
                  <React.Fragment key={event.id}>
                    <tr data-help-id={event.type === 'tournament' ? 'region-event-tournament-schedule' : undefined} className="border-t border-gray-100">
                      <td className="px-4 py-3">
                        {event.type === 'tournament'
                          ? (t('events_filter_type_tournament') || 'Tournament')
                          : (t('events_filter_type_p2p') || 'P2P')}
                      </td>
                      <td className="px-4 py-3">{event.title}</td>
                      <td className="px-4 py-3">{event.players.join(' vs ')}</td>
                      <td className="px-4 py-3">
                        {formatEventDateTime(event.datetime, userTimezone, dateLocale)}
                        {event.type === 'p2p' && event.raw?.slots && (
                          renderScheduleSlots(event.raw, userTimezone)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span>{getEventStatusLabel(event.status)}</span>
                        {event.type === 'tournament' && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              data-help-id="action-open-tournament-from-event"
                              onClick={() => navigate(`/tournament/${event.raw.tournament_id}?tab=competition&seriesId=${event.raw.series_id}`)}
                              className="rounded bg-gray-700 px-2 py-1 text-xs font-semibold text-white hover:bg-gray-800"
                            >
                              {t('events_open_tournament') || 'Open tournament'}
                            </button>
                            {((event.isTeamMode && event.userTeamParticipates)
                              || (!event.isTeamMode && (event.raw.player1_id === userId || event.raw.player2_id === userId))) && (
                              <button
                                data-help-id="action-open-schedule-from-event"
                                onClick={() => openSeriesSchedule(event)}
                                className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                              >
                                {t('events_open_schedule') || 'Open schedule'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {event.type === 'p2p' && event.raw && (
                      <tr className="bg-gray-50 border-t border-gray-100">
                        <td colSpan={5} className="px-4 py-3">
                          <ChallengeActionButtons
                            proposalId={event.raw.id}
                            proposedByUserId={event.raw.proposed_by_user_id}
                            challengedUserId={event.raw.challenged_user_id}
                            status={event.raw.status}
                            layout="inline"
                            onActionComplete={() => {
                              // Reload events after action
                              loadEvents();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
                    {dayEvents[0] && new Date(dayEvents[0].datetime).toLocaleDateString(dateLocale, {
                    timeZone: userTimezone,
                    weekday: 'long',
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {dayEvents.map((event) => (
                    <article data-help-id={event.type === 'p2p' ? 'region-p2p-event-item' : event.type === 'tournament' ? 'region-event-tournament-schedule' : 'region-event-item'} key={event.id} className="border border-gray-200 rounded p-3 bg-gray-50">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {event.type === 'tournament'
                          ? (t('events_filter_type_tournament') || 'Tournament')
                          : (t('events_filter_type_p2p') || 'P2P')}
                      </p>
                      <h3 className="font-semibold text-gray-800 mt-1">{event.title}</h3>
                      <p className="text-sm text-gray-700 mt-1">{event.players.join(' vs ')}</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {formatEventDateTime(event.datetime, userTimezone, dateLocale)}
                      </p>
                     {event.type === 'p2p' && event.raw?.slots && (
                       renderScheduleSlots(event.raw, userTimezone)
                     )}
                     <p className="text-xs text-gray-500 mt-2">
                       {t('events_table_status') || 'Status'}: {getEventStatusLabel(event.status)}
                       {event.type === 'p2p' && event.visibility ? ` • ${event.visibility}` : ''}
                     </p>
                     <div className="mt-3 pt-3 border-t border-gray-300 space-y-2">
                       {event.type === 'tournament' && (
                         <div className="flex flex-wrap gap-2">
                           <button
                             data-help-id="action-open-tournament-from-event"
                             onClick={() => navigate(`/tournament/${event.raw.tournament_id}?tab=competition&seriesId=${event.raw.series_id}`)}
                             className="rounded bg-gray-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800"
                           >
                           {t('events_open_tournament') || 'Open tournament'}
                           </button>
                           {((event.isTeamMode && event.userTeamParticipates)
                             || (!event.isTeamMode && (event.raw.player1_id === userId || event.raw.player2_id === userId))) && (
                             <button
                               data-help-id="action-open-schedule-from-event"
                               onClick={() => openSeriesSchedule(event)}
                               className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
                             >
                             {t('events_open_schedule') || 'Open schedule'}
                             </button>
                           )}
                         </div>
                       )}
                       {event.type === 'p2p' && event.raw && (
                         <ChallengeActionButtons
                           proposalId={event.raw.id}
                           proposedByUserId={event.raw.proposed_by_user_id}
                           challengedUserId={event.raw.challenged_user_id}
                           status={event.raw.status}
                           layout="stacked"
                           onActionComplete={() => {
                             loadEvents();
                           }}
                         />
                       )}
                     </div>
                   </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <ChallengeFromEventsModal
        isOpen={showChallengeModal}
        onClose={() => setShowChallengeModal(false)}
        onSuccess={loadEvents}
      />
      <ChallengeFromPlayerModal
        isOpen={!!waitingChallenge}
        onClose={() => setWaitingChallenge(null)}
        onSuccess={() => setWaitingChallenge(null)}
        opponentId={waitingChallenge?.user_id || ''}
        opponentNickname={waitingChallenge?.nickname || ''}
      />
      <ScheduleProposalModal
        isOpen={scheduleModal.isOpen}
        tournamentId={scheduleModal.tournamentId || ''}
        seriesId={scheduleModal.seriesId}
        initialParticipants={scheduleModal.initialParticipants}
        initialProposal={scheduleModal.initialProposal}
        initialViewingTimezone={scheduleModal.initialViewingTimezone}
        initialDisplayDateStart={scheduleModal.initialDisplayDateStart}
        initialScrollToHour={scheduleModal.initialScrollToHour}
        onClose={() => setScheduleModal({ isOpen: false })}
        onSuccess={() => {
          setScheduleModal({ isOpen: false });
          loadEvents();
        }}
      />
    </div>
  );
};

export default Events;
