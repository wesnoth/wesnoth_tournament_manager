import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tournamentService, publicService } from '../services/api';
import { challengeSchedulingService } from '../services/challengeSchedulingService';
import P2PChallengeModal from '../components/P2PChallengeModal';
import ChallengeActionButtons from '../components/ChallengeActionButtons';
import ScheduleProposalModal from '../components/ScheduleProposalModal';
import { groupSlotsIntoRanges } from '../utils/slotGrouping';
import { useAuthStore } from '../store/authStore';

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

const Events: React.FC = () => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();

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

  // ScheduleProposalModal state for P2P challenges
  const [scheduleProposalModal, setScheduleProposalModal] = useState<{
    isOpen: boolean;
    proposalId?: string;
    initialParticipants?: any[];
    initialProposal?: any;
    initialViewingTimezone?: string;
    initialDisplayDateStart?: Date;
    initialScrollToHour?: number | null;
  }>({ isOpen: false });
  const [isLoadingScheduling, setIsLoadingScheduling] = useState(false);
  const [proposalCache, setProposalCache] = useState<Record<string, any>>({});

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [userResponse, myTournamentsResponse, p2pResponse] = await Promise.all([
        userId ? publicService.getPlayerProfile(userId) : Promise.resolve(null),
        tournamentService.getMyTournaments(),
        challengeSchedulingService.listProposals('all'),
      ]);

      if (userResponse?.data?.timezone) {
        setUserTimezone(userResponse.data.timezone);
      }

      const tournaments = myTournamentsResponse.data || [];
      const tournamentRoundMatchesResponses = await Promise.all(
        tournaments
          .filter((t: any) => t?.id)
          .map((t: any) => tournamentService.getTournamentRoundMatches(t.id))
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

      const tournamentEvents: EventItem[] = tournamentRoundMatchesResponses.flatMap((response: any, index: number) => {
        const tournament = tournaments[index];
        const matches = response.data || [];
        const isTeamMode = tournament?.tournament_mode === 'team';
        const participants = tournamentParticipantsMap[tournament?.id] || [];

        return matches
          .filter((m: any) => !!m?.scheduled_datetime)
          .map((m: any) => {
            let playerNames = [m.player1_nickname, m.player2_nickname].filter(Boolean);
           let userTeamParticipates = false;
            
           // If team mode, enhance with participant names and check if user participates
           if (isTeamMode && participants.length > 0) {
             const getTeamParticipantNames = (teamId: string | null) => {
               if (!teamId) return [];
               const teamParticipants = participants.filter((p: any) => p.team_id === teamId);
               return teamParticipants.map((p: any) => p.user_nickname || p.nickname).filter(Boolean);
             };

             const team1Participants = participants.filter((p: any) => p.team_id === m.player1_id);
             const team2Participants = participants.filter((p: any) => p.team_id === m.player2_id);
              
             // Check if user is in either team
             const userInTeam1 = team1Participants.some((p: any) => p.user_id === userId);
             const userInTeam2 = team2Participants.some((p: any) => p.user_id === userId);
             userTeamParticipates = userInTeam1 || userInTeam2;

             const team1Names = getTeamParticipantNames(m.player1_id);
             const team2Names = getTeamParticipantNames(m.player2_id);
              
             // Format: "TeamName (player1, player2)" vs "TeamName (player1, player2)"
             playerNames = [
               team1Names.length > 0 
                 ? `${m.player1_nickname} (${team1Names.join(', ')})`
                 : m.player1_nickname,
               team2Names.length > 0
                 ? `${m.player2_nickname} (${team2Names.join(', ')})`
                 : m.player2_nickname
             ].filter(Boolean);
           }

           return {
             id: `tournament-${m.id}`,
             type: 'tournament',
             title: `${t('events_tournament_schedule') || 'Tournament Schedule'}: ${tournament?.name || ''}`,
             tournamentName: tournament?.name || '',
             players: playerNames,
             datetime: m.scheduled_datetime,
             status: m.scheduled_status || 'pending',
             raw: m,
             isTeamMode,
             userTeamParticipates,
           };
         });
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

  const handlePreloadSchedulingData = useCallback(async (proposalId: string) => {
    try {
      setIsLoadingScheduling(true);
      const cacheKey = proposalId;

      // Check cache first
      if (proposalCache[cacheKey]) {
        const cached = proposalCache[cacheKey];
        setScheduleProposalModal({
          isOpen: true,
          proposalId,
          initialProposal: cached.proposal,
          initialParticipants: cached.participants,
          initialViewingTimezone: cached.viewingTimezone,
          initialDisplayDateStart: cached.displayDateStart,
          initialScrollToHour: cached.scrollToHour,
        });
        setIsLoadingScheduling(false);
        return;
      }

      // Load proposal and participants
      const [proposalRes, participantsRes] = await Promise.all([
        challengeSchedulingService.getProposal(proposalId),
        challengeSchedulingService.getParticipantsAvailability(proposalId),
      ]);

      const proposal = proposalRes.proposal || proposalRes;
      const participants = participantsRes.participants || [];
      const viewingTimezone = participantsRes.viewing_timezone || userTimezone || 'UTC';

      // Calculate displayDateStart and scrollToHour
      let displayDateStart = new Date();
      let scrollToHour: number | null = null;

      if (proposal && proposal.slots && proposal.slots.length > 0) {
        // Convert UTC slots to viewing timezone to get correct date and time
        const sortedSlots = proposal.slots
          .map((s: any) => new Date(s.slot_datetime))
          .sort((a: any, b: any) => a.getTime() - b.getTime());

        const earliestSlot = sortedSlots[0];

        // Convert UTC time to viewing timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: viewingTimezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          hour12: false
        });

        const parts = formatter.formatToParts(earliestSlot);
        const year = parseInt(parts.find(p => p.type === 'year')?.value || '2025');
        const month = parseInt(parts.find(p => p.type === 'month')?.value || '1') - 1;
        const day = parseInt(parts.find(p => p.type === 'day')?.value || '1');
        const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');

        displayDateStart = new Date(Date.UTC(year, month, day));
        scrollToHour = hour;
      } else {
        const now = new Date();
        displayDateStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        scrollToHour = now.getHours();
      }

      // Cache the data
      const cacheData = {
        proposal,
        participants,
        viewingTimezone,
        displayDateStart,
        scrollToHour,
      };
      setProposalCache(prev => ({ ...prev, [cacheKey]: cacheData }));

      setScheduleProposalModal({
        isOpen: true,
        proposalId,
        initialProposal: proposal,
        initialParticipants: participants,
        initialViewingTimezone: viewingTimezone,
        initialDisplayDateStart: displayDateStart,
        initialScrollToHour: scrollToHour,
      });
    } catch (err) {
      console.error('Error loading scheduling data:', err);
    } finally {
      setIsLoadingScheduling(false);
    }
  }, [userTimezone, proposalCache]);

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
            {range.start.toLocaleTimeString('es-ES', {
              hour: '2-digit',
              minute: '2-digit'
            })}
            {' – '}
            {range.end.toLocaleTimeString('es-ES', {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        ))}
      </div>
    );
  }, []);

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
  }, [events, typeFilter, tournamentNameFilter, playerFilter, fromDateFilter, toDateFilter, myEventsOnly, userId]);

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

        <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded text-sm text-blue-800">
          <span className="font-semibold">{t('events_viewing_as') || 'Viewing as'}:</span> {userTimezone || 'UTC'}{' '}
          <span className="text-xs text-blue-600">
            ({t('events_viewing_note') || 'All times converted to your timezone'})
          </span>
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
                    <tr className="border-t border-gray-100">
                      <td className="px-4 py-3">
                        {event.type === 'tournament'
                          ? (t('events_filter_type_tournament') || 'Tournament')
                          : (t('events_filter_type_p2p') || 'P2P')}
                      </td>
                      <td className="px-4 py-3">{event.title}</td>
                      <td className="px-4 py-3">{event.players.join(' vs ')}</td>
                      <td className="px-4 py-3">
                        {new Date(event.datetime).toLocaleString()}
                        {event.type === 'p2p' && event.raw?.slots && (
                          renderScheduleSlots(event.raw, userTimezone)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{event.status}</span>
                          {event.type === 'p2p' && event.raw?.status === 'pending' && (
                            <button
                              onClick={() => handlePreloadSchedulingData(event.raw.id)}
                              disabled={isLoadingScheduling}
                              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                            >
                              {isLoadingScheduling ? '...' : 'Schedule'}
                            </button>
                          )}
                        </div>
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
                     {event.type === 'p2p' && event.raw?.slots && (
                       renderScheduleSlots(event.raw, userTimezone)
                     )}
                     <p className="text-xs text-gray-500 mt-2">
                       {t('events_table_status') || 'Status'}: {event.status}
                       {event.type === 'p2p' && event.visibility ? ` • ${event.visibility}` : ''}
                     </p>
                     <div className="mt-3 pt-3 border-t border-gray-300 space-y-2">
                       {event.type === 'p2p' && event.raw?.status === 'pending' && (
                         <button
                           onClick={() => handlePreloadSchedulingData(event.raw.id)}
                           disabled={isLoadingScheduling}
                           className="w-full px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 font-semibold"
                         >
                           {isLoadingScheduling ? '...' : 'Schedule'}
                         </button>
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

      <P2PChallengeModal
        isOpen={showChallengeModal}
        onClose={() => setShowChallengeModal(false)}
        onSuccess={loadEvents}
      />

      <ScheduleProposalModal
        isOpen={scheduleProposalModal.isOpen}
        initialProposal={scheduleProposalModal.initialProposal}
        initialParticipants={scheduleProposalModal.initialParticipants}
        initialViewingTimezone={scheduleProposalModal.initialViewingTimezone}
        initialDisplayDateStart={scheduleProposalModal.initialDisplayDateStart}
        initialScrollToHour={scheduleProposalModal.initialScrollToHour}
        onClose={() => setScheduleProposalModal({ isOpen: false })}
        onSuccess={() => {
          setScheduleProposalModal({ isOpen: false });
          loadEvents();
        }}
      />
    </div>
  );
};

export default Events;

