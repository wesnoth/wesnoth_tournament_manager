import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { publicService, tournamentService, userService, api } from '../services/api';
import { tournamentSchedulingService } from '../services/tournamentSchedulingService';
import TournamentForm from '../components/TournamentForm';
import { TeamJoinModal } from '../components/TeamJoinModal';
import PlayerLink from '../components/PlayerLink';
import ScheduleProposalModal from '../components/ScheduleProposalModal';
import { TeamReplacementModal } from '../components/TeamReplacementModal';
import MarkdownPreview from '../components/MarkdownPreview';
import MainLayout from '../components/MainLayout';
import { SimulateJoinPanel } from '../components/TestSimulationControls';
import type { TournamentFormatDefinition, TournamentFormData, TournamentRuleVersion, TournamentUpdatePayload } from '../types/tournament';
import TournamentCompetitionView from '../components/TournamentCompetitionView';
import TournamentCompositionPreview from '../components/TournamentCompositionPreview';
import TournamentOverallStandings from '../components/TournamentOverallStandings';

interface Tournament {
  id: string;
  name: string;
  description: string;
  rules_template_id?: string | null;
  rules_content?: string;
  creator_id: string;
  creator_nickname: string;
  status: string;
  tournament_type: string;
  tournament_mode?: 'ranked' | 'unranked' | 'team';
  general_rounds: number;
  final_rounds: number;
  general_rounds_format: 'bo1' | 'bo3' | 'bo5';
  final_rounds_format: 'bo1' | 'bo3' | 'bo5';
  round_duration_days: number;
  auto_advance_round: boolean;
  max_participants: number | null;
  created_at: string;
  scheduled_start_at?: string | null;
  started_at: string;
  finished_at: string;
  forum_topic_id?: number | null;
}

interface TournamentOrganizer {
  user_id: string;
  nickname: string;
}

interface OrganizerUserOption {
  id: string;
  nickname: string;
}

interface TournamentParticipant {
  id: string;
  user_id: string;
  nickname: string;
  participation_status: string;
  elo_rating: number;
  team_id?: string | null;
  direct_group_id?: string | null;
  direct_round_number?: number | null;
  direct_series_position?: number | null;
  direct_slot_number?: number | null;
  team_position?: number | null;
  members_with_elo?: Array<{ participant_id: string; user_id: string; nickname: string; elo_rating: number; team_position: number; participation_status: string }>;
  member_user_ids?: string;
  team_size?: number;
  team_total_elo?: number;
}

interface DirectPassGroupOption { id: string; name: string; direct_advancement_slots?: number; direct_assigned_count?: number; format?: string; }

const DirectPassControl: React.FC<{
  tournamentId: string; entityType: 'participant' | 'team'; entityId: string;
  groups: DirectPassGroupOption[]; current?: any; disabled: boolean; onSaved: () => void;
}> = ({ tournamentId, entityType, entityId, groups, current, disabled, onSaved }) => {
  const [groupId, setGroupId] = useState(current?.direct_group_id || '');
  const [round, setRound] = useState(current?.direct_round_number || '');
  const [note, setNote] = useState(current?.direct_pass_note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedPlacement, setSavedPlacement] = useState('');
  useEffect(() => {
    setGroupId(current?.direct_group_id || ''); setRound(current?.direct_round_number || '');
    setNote(current?.direct_pass_note || '');
  }, [current?.direct_group_id, current?.direct_round_number, current?.direct_pass_note]);
  const selected = groups.find(group => group.id === groupId);
  const availableGroups = groups.filter(group => group.id === current?.direct_group_id
    || Number(group.direct_assigned_count || 0) < Number(group.direct_advancement_slots || 0));
  if (!groups.length || disabled) return null;
  return <div className="flex flex-wrap items-end gap-2">
    <label className="text-xs">Direct pass
      <select data-help-id="option-participant-direct-pass-group" value={groupId} onChange={event => { setError(''); setSavedPlacement(''); setGroupId(event.target.value); }} className="ml-1 border rounded px-2 py-1">
        <option value="">None</option>{availableGroups.map(group => <option key={group.id} value={group.id}>{group.name} ({group.direct_assigned_count || 0}/{group.direct_advancement_slots} assigned)</option>)}
      </select>
    </label>
    {selected?.format === 'single_elimination' && groupId && <>
      <label className="text-xs">Round<input data-help-id="field-participant-direct-pass-round" type="number" min={1} value={round} onChange={event => { setError(''); setSavedPlacement(''); setRound(event.target.value); }} className="ml-1 w-16 border rounded px-2 py-1" /></label>
      <span className="text-xs text-gray-600">The system chooses an available series and slot. In later rounds, the series position identifies the bracket branch.</span>
    </>}
    {groupId && <label className="text-xs">Reason<input data-help-id="field-participant-direct-pass-note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} className="ml-1 border rounded px-2 py-1" /></label>}
    {(groupId || current?.direct_group_id) && <button data-help-id="action-save-participant-direct-pass" type="button" disabled={saving || Boolean(groupId && selected?.format === 'single_elimination' && !round)} className="px-2 py-1 bg-indigo-600 text-white rounded text-xs disabled:opacity-50" onClick={async () => {
      setSaving(true);
      try { setError(''); setSavedPlacement(''); const response = await tournamentService.saveDirectPass(tournamentId, entityType, entityId, {
        group_id: groupId || null, round_number: selected?.format === 'single_elimination' && groupId ? Number(round) : null,
        note: groupId ? note : null,
      });
        const placement = response.data?.round_number
          ? `Saved for round ${response.data.round_number}, branch/series ${response.data.series_position}, slot ${response.data.slot_number}.`
          : groupId ? 'Direct pass saved.' : 'Direct pass removed.';
        setSavedPlacement(response.data?.adjusted_mappings
          ? `${placement} ${response.data.adjusted_mappings} qualifier mapping(s) adjusted so the round-one pass has an opponent.`
          : placement);
        onSaved();
      } catch (saveError: any) {
        setError(saveError.response?.data?.error || 'Could not save this direct pass.');
      } finally { setSaving(false); }
    }}>{saving ? 'Saving…' : groupId ? 'Save pass' : 'Remove pass'}</button>}
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    {savedPlacement && <span role="status" className="text-xs text-green-700">{savedPlacement}</span>}
  </div>;
};

type TournamentDetailTab = 'participants' | 'competition' | 'tournamentStandings';

const tournamentDetailTabs = new Set<TournamentDetailTab>(['participants', 'competition', 'tournamentStandings']);

function getRequestedTournamentTab(searchParams: URLSearchParams): TournamentDetailTab | null {
  const tab = searchParams.get('tab');
  return tab && tournamentDetailTabs.has(tab as TournamentDetailTab) ? tab as TournamentDetailTab : null;
}

/**
 * Select the most useful landing view for the tournament status. Standings
 * are authoritative after completion, while pre-start states are primarily
 * concerned with the registered field.
 */
function getDefaultTournamentTab(status: string): TournamentDetailTab {
  if (status === 'in_progress') return 'competition';
  if (['finished', 'complete', 'completed'].includes(status)) return 'tournamentStandings';
  return 'participants';
}

const tournamentDescriptionRulesStateKey = (tournamentId: string) =>
  `tournament-detail:${tournamentId}:description-rules-open`;

function readDescriptionRulesState(tournamentId?: string): boolean | null {
  if (!tournamentId) return null;

  try {
    const storedValue = sessionStorage.getItem(tournamentDescriptionRulesStateKey(tournamentId));
    return storedValue === null ? null : storedValue === 'true';
  } catch {
    // Storage can be unavailable in restricted browser contexts; the UI still works in memory.
    return null;
  }
}

const TournamentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { userId, user, enableRanked, isAdmin, isTournamentModerator } = useAuthStore();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<TournamentParticipant[]>([]);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [rulesHistory, setRulesHistory] = useState<TournamentRuleVersion[]>([]);
  const [selectedRulesVersion, setSelectedRulesVersion] = useState<number | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [directPassFormat, setDirectPassFormat] = useState<TournamentFormatDefinition | null>(null);
  const [organizers, setOrganizers] = useState<TournamentOrganizer[]>([]);
  const [organizerUsers, setOrganizerUsers] = useState<OrganizerUserOption[]>([]);
  const [organizerCandidateId, setOrganizerCandidateId] = useState('');
  const [organizerMutationLoading, setOrganizerMutationLoading] = useState(false);
  const [unrankedFactions, setUnrankedFactions] = useState<Array<{ id: string; name: string }>>([]);
  const [unrankedMaps, setUnrankedMaps] = useState<Array<{ id: string; name: string }>>([]);
  const [allFactions, setAllFactions] = useState<Array<{ id: string; name: string }>>([]);
  const [allMaps, setAllMaps] = useState<Array<{ id: string; name: string }>>([]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [showTeamJoinModal, setShowTeamJoinModal] = useState(false);
  const [joiningTeamLoading, setJoiningTeamLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<TournamentDetailTab>(() => getRequestedTournamentTab(searchParams) || 'participants');
  const tabInitializedForTournament = useRef<string | null>(null);
  const [highlightedSeriesId] = useState<string | null>(searchParams.get('seriesId'));
  const [highlightedCompetitionGameId] = useState<string | null>(searchParams.get('gameId'));
  const [competitionMatchFilter, setCompetitionMatchFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [competitionShowOnlyMine, setCompetitionShowOnlyMine] = useState(false);
  const [competitionShowPhasesGroups, setCompetitionShowPhasesGroups] = useState(true);
  const [descriptionRulesOpen, setDescriptionRulesOpen] = useState<boolean>(() =>
    readDescriptionRulesState(id) ?? true
  );
  const descriptionRulesStateTournamentId = useRef(id);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tabRefreshKey, setTabRefreshKey] = useState(0);
  const [userParticipationStatus, setUserParticipationStatus] = useState<string | null>(null);
  const [isUserInTournament, setIsUserInTournament] = useState(false);
  const [isJoinRequestLoading, setIsJoinRequestLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [rulesEditMode, setRulesEditMode] = useState(false);
  const [rulesDraft, setRulesDraft] = useState('');
  const [rulesSaving, setRulesSaving] = useState(false);
  const rulesEditorRef = useRef<HTMLTextAreaElement>(null);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [renameTeamModal, setRenameTeamModal] = useState<{ open: boolean; teamId: string; currentName: string }>({ open: false, teamId: '', currentName: '' });
  const [renameTeamValue, setRenameTeamValue] = useState('');
  const [renameTeamLoading, setRenameTeamLoading] = useState(false);
  const [showReplacementModal, setShowReplacementModal] = useState(false);
  const [replacementTeamMembers, setReplacementTeamMembers] = useState<any[]>([]);
  const [replacementData, setReplacementData] = useState<{ teamId: string; memberId: string; memberNickname: string } | null>(null);
  const [scheduleProposalModal, setScheduleProposalModal] = useState<{ 
    isOpen: boolean;
    tournamentId?: string;
    seriesId?: string;
    // Preloaded scheduling data
    initialParticipants?: any[];
    initialProposal?: any;
    initialViewingTimezone?: string;
    initialDisplayDateStart?: Date;
    initialScrollToHour?: number | null;
  }>({ isOpen: false });

  const [editData, setEditData] = useState<TournamentFormData>({
    name: '',
    description: '',
    tournament_type: 'elimination',
    tournament_mode: 'ranked',
    max_participants: 0,
    round_duration_days: 7,
    auto_advance_round: false,
    scheduled_start_at: null,
    general_rounds: 0,
    final_rounds: 0,
    general_rounds_format: 'bo3' as 'bo1' | 'bo3' | 'bo5',
    final_rounds_format: 'bo5' as 'bo1' | 'bo3' | 'bo5',
    rules_template_id: null,
    rules_content: '',
  });

  // Get the origin page from location state
  const originPage = (location.state as any)?.from || 'tournaments';

  useEffect(() => {
    if (!id) return;

    // Avoid writing the previous tournament's in-memory state under a new id
    // when React reuses this page component for another tournament route.
    if (descriptionRulesStateTournamentId.current !== id) {
      descriptionRulesStateTournamentId.current = id;
      setDescriptionRulesOpen(readDescriptionRulesState(id) ?? true);
      return;
    }

    try {
      sessionStorage.setItem(
        tournamentDescriptionRulesStateKey(id),
        String(descriptionRulesOpen)
      );
    } catch {
      // Storage failures should not prevent the user from toggling the section.
    }
  }, [descriptionRulesOpen, id]);

  useEffect(() => {
    if (id) {
      fetchTournamentData();
    }
  }, [id, userId]);

  useEffect(() => {
    let cancelled = false;

    // The user directory is only needed by the creator while membership is editable.
    // Avoid exposing an inoperative selector or doing extra work for co-organizers.
    if (!tournament || tournament.creator_id !== userId || tournament.status === 'finished') {
      setOrganizerUsers([]);
      setOrganizerCandidateId('');
      return () => { cancelled = true; };
    }

    userService.getAllUsers()
      .then((response) => {
        if (cancelled) return;
        const users = response.data?.data || response.data || [];
        setOrganizerUsers(Array.isArray(users) ? users : []);
      })
      .catch((loadError) => {
        console.error('Failed to load co-organizer candidates:', loadError);
      });

    return () => { cancelled = true; };
  }, [tournament?.id, tournament?.creator_id, tournament?.status, userId]);

  const fetchTournamentData = async () => {
    try {
      setLoading(true);
      const [tournamentRes, participantsRes, organizersRes] = await Promise.all([
        publicService.getTournamentById(id!),
        publicService.getTournamentParticipants(id!),
        tournamentService.getTournamentOrganizers(id!),
      ]);

      const rulesHistoryRes = await tournamentService.getTournamentRulesHistory(id!);
      setRulesHistory(rulesHistoryRes.data || []);
      setSelectedRulesVersion(null);

      // Every tournament uses the phase engine; its format feeds both the
      // configuration summary and the direct-pass controls.
      const formatRes = await tournamentService.getTournamentFormat(id!);
      setTournament(tournamentRes.data);
      setDirectPassFormat(formatRes.data);
      setRulesDraft(tournamentRes.data.rules_content || '');
      setRulesEditMode(false);
      if (tabInitializedForTournament.current !== tournamentRes.data.id) {
        // An explicit deep link to an existing view wins; otherwise choose the
        // state-aware landing view.
        setActiveTab(getRequestedTournamentTab(searchParams) ?? getDefaultTournamentTab(tournamentRes.data.status));
        tabInitializedForTournament.current = tournamentRes.data.id;
      }
      console.log('📋 Tournament loaded:', {
        id: tournamentRes.data.id,
        name: tournamentRes.data.name,
        tournament_type: tournamentRes.data.tournament_type,
        tournament_mode: tournamentRes.data.tournament_mode
      });
      setParticipants(participantsRes.data || []);
      if (tournamentRes.data.tournament_mode === 'team') {
        const teamsRes = await publicService.getTournamentTeams(id!);
        setTeams(teamsRes.data?.data || []);
      } else {
        setTeams([]);
      }
      setOrganizers(organizersRes.data || []);
      
      // Raw participant rows remain authoritative for the current user's team.
      if (tournamentRes.data.tournament_mode === 'team' && userId) {
        const userParticipant = (participantsRes.data || []).find((participant: any) => participant.user_id === userId);
        setUserTeamId(userParticipant?.team_id || null);
      } else {
        setUserTeamId(null);
      }
      
      // Initialize edit data when tournament loads
      setEditData({
        name: tournamentRes.data.name || '',
        description: tournamentRes.data.description || '',
        tournament_type: tournamentRes.data.tournament_type || 'elimination',
        tournament_mode: tournamentRes.data.tournament_mode || 'ranked',
        max_participants: tournamentRes.data.max_participants || 0,
        round_duration_days: tournamentRes.data.round_duration_days || 7,
        auto_advance_round: tournamentRes.data.auto_advance_round || false,
        scheduled_start_at: tournamentRes.data.scheduled_start_at || null,
        general_rounds: tournamentRes.data.general_rounds || 0,
        final_rounds: tournamentRes.data.final_rounds || 0,
        general_rounds_format: tournamentRes.data.general_rounds_format || 'bo3',
        final_rounds_format: tournamentRes.data.final_rounds_format || 'bo5',
        rules_template_id: tournamentRes.data.rules_template_id || null,
        rules_content: tournamentRes.data.rules_content || tournamentRes.data.description || '',
        forum_topic_url: tournamentRes.data.forum_topic_id
          ? `https://forums.wesnoth.org/viewtopic.php?t=${tournamentRes.data.forum_topic_id}`
          : null,
        format_definition: formatRes.data,
      });
      
      // Check user's participation status
      if (userId) {
        const userParticipant = (participantsRes.data || []).find((p: TournamentParticipant) => p.user_id === userId);
        // Row existence, rather than a subset of statuses, controls whether a
        // user may request entry again. Rejected and replaced rows still mean
        // the user has already participated in this tournament.
        setIsUserInTournament(Boolean(userParticipant));
        setUserParticipationStatus(userParticipant?.participation_status || null);
      } else {
        setIsUserInTournament(false);
        setUserParticipationStatus(null);
      }

      setError('');
    } catch (err: any) {
      console.error('Error fetching tournament:', err);
      setError(t('error_loading_tournament'));
    } finally {
      setLoading(false);
    }
  };

  /** Refresh saved direct-pass data without unmounting the other rows' unsaved form state. */
  const refreshDirectPassData = async () => {
    if (!id) return;
    try {
      const [participantsRes, formatRes, teamsRes] = await Promise.all([
        publicService.getTournamentParticipants(id),
        tournamentService.getTournamentFormat(id),
        tournament?.tournament_mode === 'team' ? publicService.getTournamentTeams(id) : Promise.resolve(null),
      ]);
      setParticipants(participantsRes.data || []);
      setDirectPassFormat(formatRes.data);
      if (teamsRes) setTeams(teamsRes.data?.data || []);
    } catch (refreshError) {
      console.error('Could not refresh direct-pass data:', refreshError);
      setError('The direct pass was saved, but the page could not refresh its latest assignments. Use Refresh to retry.');
    }
  };

  const refreshActiveTab = async () => {
    // Keep the tournament header and its fixed configuration untouched. Each
    // tab owns its changing data, so refreshing should not reinitialize the
    // page or alter the user's current scroll position.
    if (!id) return;
    if (activeTab === 'participants') {
      const participantsRes = await publicService.getTournamentParticipants(id);
      setParticipants(participantsRes.data || []);
      // Team tournaments render this tab from the team aggregates.
      if (tournament?.tournament_mode === 'team') {
        const teamsRes = await publicService.getTournamentTeams(id);
        setTeams(teamsRes.data?.data || []);
      }
      return;
    }
    setTabRefreshKey(value => value + 1);
  };

  /** Load a series' availability and current proposal, then open the scheduling modal on its earliest slot. */
  const handlePreloadSchedulingData = async (seriesId: string) => {
    try {
      const [availRes, proposalRes] = await Promise.all([
        tournamentSchedulingService.getSeriesParticipantsAvailability(id!, seriesId),
        tournamentSchedulingService.getSeriesProposal(id!, seriesId),
      ]);

      const participants = availRes.participants || [];
      const viewingTimezone = availRes.viewing_timezone || 'UTC';

      const proposal = proposalRes.proposal || null;

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

        console.log('[TournamentDetail] Scheduling data precalculated:', {
          earliestSlotUTC: earliestSlot.toISOString(),
          displayDateStart: displayDateStart.toLocaleDateString(),
          scrollToHour,
          viewingTimezone
        });
      } else {
        // No proposal, use current date
        const now = new Date();
        displayDateStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        scrollToHour = now.getHours();
      }

      // Open modal with preloaded data
      setScheduleProposalModal({
        isOpen: true,
        tournamentId: id,
        seriesId,
        initialParticipants: participants,
        initialProposal: proposal,
        initialViewingTimezone: viewingTimezone,
        initialDisplayDateStart: displayDateStart,
        initialScrollToHour: scrollToHour
      });
    } catch (err) {
      console.error('Error preloading scheduling data:', err);
      setError('Failed to load scheduling data');
    }
  };

  const handleJoinTournament = async () => {
    console.log('🔍 handleJoinTournament called with tournament_mode:', tournament?.tournament_mode);
    console.log('📋 Full tournament object:', tournament);
    
    if (tournament?.tournament_mode === 'team') {
      // Show team join modal for team tournaments
      console.log('✅ Showing team join modal for team tournament');
      setShowTeamJoinModal(true);
    } else {
      // Direct join for ranked/unranked tournaments
      console.log('❌ Direct join (not team mode)');
      try {
        setIsJoinRequestLoading(true);
        await tournamentService.requestJoinTournament(id!);
        setSuccess(t('success_join_request_sent'));
        setIsUserInTournament(true);
        setUserParticipationStatus('pending');
        // Refresh the page after 2 seconds
        setTimeout(() => {
          fetchTournamentData();
        }, 2000);
      } catch (err: any) {
        setError(err.response?.data?.error || t('error_failed_join_tournament'));
        if (err.response?.status === 409) fetchTournamentData();
      } finally {
        setIsJoinRequestLoading(false);
      }
    }
  };

  // Fetch tournament assets for all modes
  useEffect(() => {
    if (tournament && id) {
      const fetchAssets = async () => {
        try {
          // Fetch selected assets for this tournament
          const selectedRes = await publicService.getTournamentUnrankedAssets(id);
          if (selectedRes.data.success) {
            console.log('Tournament assets loaded:', {
              factions: selectedRes.data.data.factions,
              maps: selectedRes.data.data.maps
            });
            setUnrankedFactions(selectedRes.data.data.factions || []);
            setUnrankedMaps(selectedRes.data.data.maps || []);
          }
          setAssetsLoaded(true);
        } catch (err) {
          console.error('Error fetching tournament assets:', err);
          setAssetsLoaded(true);
        }
      };
      fetchAssets();
    }
  }, [tournament?.id, id]);

  // Fetch ALL available assets only in edit mode
  useEffect(() => {
    if (editMode && tournament) {
      const fetchAllAssets = async () => {
        try {
          console.log('📥 Fetching assets for edit mode. Tournament mode:', tournament.tournament_mode);
          
          if (tournament.tournament_mode === 'ranked') {
            // For ranked tournaments, fetch only ranked assets
            const factionsRes = await api.get('/public/factions?is_ranked=true');
            const mapsRes = await api.get('/public/maps?is_ranked=true');
            console.log('✅ Ranked - Factions:', factionsRes.data.length, 'Maps:', mapsRes.data.length);
            setAllFactions(factionsRes.data || []);
            setAllMaps(mapsRes.data || []);
          } else if (tournament.tournament_mode === 'unranked' || tournament.tournament_mode === 'team') {
            // For unranked/team tournaments, fetch ALL assets (so organizer can choose which to allow)
            const factionsRes = await api.get('/admin/unranked-factions');
            const mapsRes = await api.get('/admin/unranked-maps');
            console.log('🔵 Unranked/Team - ALL Factions:', factionsRes.data.data?.length, 'ALL Maps:', mapsRes.data.data?.length);
            setAllFactions(factionsRes.data.data || []);
            setAllMaps(mapsRes.data.data || []);
          }
        } catch (err) {
          console.error('❌ Error fetching available assets:', err);
        }
      };
      fetchAllAssets();
    }
  }, [editMode, tournament?.id, tournament?.tournament_mode]);

  useEffect(() => {
    if (activeTab !== 'competition' || (!highlightedSeriesId && !highlightedCompetitionGameId)) return;
    const timer = setTimeout(() => {
      const target = highlightedCompetitionGameId
        ? document.getElementById(`game-${highlightedCompetitionGameId}`)
        : document.getElementById(`series-${highlightedSeriesId}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 500);
    return () => clearTimeout(timer);
  }, [activeTab, highlightedCompetitionGameId, highlightedSeriesId]);

  const handleTeamJoinSubmit = async (teamName: string, teammateName: string) => {
    try {
      setJoiningTeamLoading(true);
      setError('');
      
      await tournamentService.requestJoinTournament(id!, {
        team_name: teamName,
        teammate_name: teammateName
      });
      
      setSuccess(t('success_join_request_sent'));
      setIsUserInTournament(true);
      setUserParticipationStatus('pending');
      setShowTeamJoinModal(false);
      
      // Refresh the page after 2 seconds
      setTimeout(() => {
        fetchTournamentData();
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('error_failed_join_tournament'));
    } finally {
      setJoiningTeamLoading(false);
    }
  };

  const handleBackButton = () => {
    if (originPage === 'my-tournaments') {
      navigate('/my-tournaments');
    } else {
      navigate('/tournaments');
    }
  };

const handleCloseRegistration = async () => {
  try {
    // First call without confirmation
    const response = await tournamentService.closeRegistration(id!);
    
    if (response.data?.requiresConfirmation) {
      // Show confirmation modal
      setShowDeleteConfirmModal(true);
    } else if (response.data?.action === 'closed') {
      // Tournament registration closed normally (had participants)
      setSuccess(t('success_registration_closed'));
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    }
  } catch (err: any) {
    setError(err.response?.data?.error || t('error_failed_close_registration'));
  }
};

const handleConfirmDelete = async () => {
  try {
    // Second call with confirmation
    const response = await tournamentService.closeRegistration(id!, true);
    
    if (response.data?.action === 'deleted') {
      setSuccess(t('tournaments.tournament_deleted_no_participants'));
      setShowDeleteConfirmModal(false);
      // Redirect after 2 seconds
      setTimeout(() => {
        navigate('/my-tournaments');
      }, 2000);
    }
  } catch (err: any) {
    setError(err.response?.data?.error || t('error_failed_close_registration'));
    setShowDeleteConfirmModal(false);
  }
};

  const handlePrepareAndStart = async () => {
    try {
      // Save edit data first if any changes (but exclude started_at if empty)
      if (editData.description !== tournament?.description || 
          editData.max_participants !== tournament?.max_participants ||
          editData.general_rounds !== tournament?.general_rounds ||
          editData.final_rounds !== tournament?.final_rounds ||
          editData.general_rounds_format !== tournament?.general_rounds_format ||
          editData.final_rounds_format !== tournament?.final_rounds_format ||
          editData.round_duration_days !== tournament?.round_duration_days ||
          editData.auto_advance_round !== tournament?.auto_advance_round ||
          editData.scheduled_start_at !== tournament?.scheduled_start_at ||
          editData.rules_template_id !== tournament?.rules_template_id ||
          editData.rules_content !== tournament?.rules_content ||
          editData.format_definition !== undefined ||
          editData.forum_topic_url !== (tournament?.forum_topic_id ? `https://forums.wesnoth.org/viewtopic.php?t=${tournament.forum_topic_id}` : null)) {
        const updateObj: TournamentUpdatePayload = {
          description: editData.description,
          max_participants: editData.max_participants,
          round_duration_days: editData.round_duration_days,
          auto_advance_round: editData.auto_advance_round,
          scheduled_start_at: editData.scheduled_start_at,
          general_rounds: editData.general_rounds,
          final_rounds: editData.final_rounds,
          general_rounds_format: editData.general_rounds_format,
          final_rounds_format: editData.final_rounds_format,
          rules_template_id: editData.rules_template_id,
          rules_content: editData.rules_content,
          forum_topic_url: editData.forum_topic_url,
          format_definition: editData.format_definition,
        };
        await tournamentService.updateTournament(id!, updateObj);
      }

      await tournamentService.updateTournamentAssets(
        id!,
        unrankedFactions.map((faction) => faction.id),
        unrankedMaps.map((map) => map.id)
      );

      // Call backend to prepare tournament (create rounds based on type and configuration)
      await tournamentService.prepareTournament(id!);
      setSuccess(t('success_tournament_prepared'));
      setEditMode(false);
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('error_failed_prepare_tournament'));
    }
  };

  const handleStartTournament = async () => {
    try {
      // Call backend to create rounds and start tournament
      await tournamentService.startTournament(id!);
      setSuccess(t('success_tournament_started'));
      setEditMode(false);
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('error_failed_start_tournament'));
    }
  };

  const handleCancelTournament = async () => {
    try {
      await api.delete(`/tournaments/${id}`);
      setSuccess(t('success_tournament_cancelled', 'Tournament cancelled successfully'));
      setTimeout(() => {
        navigate('/tournaments');
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('error_failed_cancel_tournament', 'Failed to cancel tournament'));
    }
  };

  const handleSaveChanges = async () => {
    try {
      const updateObj: TournamentUpdatePayload = {
        tournament_type: editData.tournament_type,
        description: editData.description,
        max_participants: editData.max_participants,
        round_duration_days: editData.round_duration_days,
        auto_advance_round: editData.auto_advance_round,
        scheduled_start_at: editData.scheduled_start_at,
        general_rounds: editData.general_rounds,
        final_rounds: editData.final_rounds,
        general_rounds_format: editData.general_rounds_format,
        final_rounds_format: editData.final_rounds_format,
        rules_template_id: editData.rules_template_id,
        rules_content: editData.rules_content,
        forum_topic_url: editData.forum_topic_url,
        format_definition: editData.format_definition,
      };
      // Save tournament configuration
      await tournamentService.updateTournament(id!, updateObj);

      // Empty arrays intentionally clear the corresponding allowed asset set.
      await tournamentService.updateTournamentAssets(
        id!,
        unrankedFactions.map((faction) => faction.id),
        unrankedMaps.map((map) => map.id)
      );

      setSuccess(t('success_tournament_configuration_updated'));
      setEditMode(false);
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('error_failed_save_changes'));
    }
  };

  const handleSaveRules = async () => {
    if (!id || isTournamentCompleted) return;

    try {
      setRulesSaving(true);
      await tournamentService.updateTournament(id, { rules_content: rulesDraft });
      setRulesEditMode(false);
      setSuccess(t('tournament.rules_updated', 'Tournament rules updated successfully'));
      await fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('tournament.rules_update_failed', 'Failed to update tournament rules'));
    } finally {
      setRulesSaving(false);
    }
  };

  useEffect(() => {
    if (!rulesEditMode || !rulesEditorRef.current) return;

    // Move the editor into view after it mounts so the organizer can start typing immediately.
    rulesEditorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    rulesEditorRef.current.focus({ preventScroll: true });
  }, [rulesEditMode]);

  const handleAcceptParticipant = async (participantId: string) => {
    try {
      await tournamentService.acceptParticipant(id!, participantId);
      setSuccess(t('success_participant_accepted'));
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('error_failed_accept_participant'));
    }
  };

  const handleConfirmParticipation = async (participantId: string) => {
    try {
      await tournamentService.confirmParticipation(id!, participantId);
      setSuccess(t('success_participation_confirmed') || 'Participation confirmed!');
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('error_failed_confirm_participation') || 'Failed to confirm participation');
    }
  };

  const handleRejectParticipant = async (participantId: string) => {
    try {
      await tournamentService.rejectParticipant(id!, participantId);
      setSuccess(t('success_participant_rejected'));
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('error_failed_reject_participant'));
    }
  };

  const getStatusColor = (status: string | undefined | null) => {
    const colorMap: { [key: string]: string } = {
      'pending': '#FF9800',
      'active': '#4CAF50',
      'completed': '#2196F3',
      'cancelled': '#f44336',
    };
    return colorMap[status || ''] || '#999';
  };

  const getParticipationStatusColor = (status: string | undefined | null) => {
    const colorMap: { [key: string]: string } = {
      'pending': '#FFC107',
      'unconfirmed': '#2196F3',
      'accepted': '#4CAF50',
      'denied': '#f44336',
      'cancelled': '#999',
    };
    return colorMap[status || ''] || '#999';
  };

  const formatDate = (date: string) => {
    if (!date) return t('not_available');
    return new Date(date).toLocaleDateString();
  };

  // Normalize status values to match locale keys like `option_in_progress`
  const normalizeStatus = (s?: string | null) => {
    if (!s) return 'pending';
    return s.toString().toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
  };

  const getModeLabel = (mode?: string) => {
    switch (mode) {
      case 'ranked':
        return 'Ranked (1v1)';
      case 'unranked':
        return 'Unranked (1v1)';
      case 'team':
        return 'Team (2v2)';
      default:
        return mode || 'Unknown';
    }
  };

  const isOrganizer = Boolean(userId && organizers.some((organizer) => organizer.user_id === userId));
  const isTournamentCompleted = ['finished', 'completed', 'complete'].includes(tournament?.status || '');
  const selectedRules = selectedRulesVersion === null
    ? null
    : rulesHistory.find((version) => version.version_number === selectedRulesVersion) || null;
  const displayedRulesContent = selectedRules?.rules_content ?? tournament?.rules_content ?? '';
  const isPrimaryOrganizer = Boolean(userId && tournament?.creator_id === userId);
  const canManageParticipants = isOrganizer || isAdmin || isTournamentModerator;
  // Keep the table header and participant rows at the same column count for public visitors.
  const showParticipantActions = Boolean((canManageParticipants || userId) && tournament?.status === 'registration_open');
  const directPassGroups: DirectPassGroupOption[] = (directPassFormat?.phases || []).slice(1).flatMap(phase =>
    phase.groups.filter(group => Number(group.direct_advancement_slots || 0) > 0).map(group => ({
      id: group.id, name: `${phase.name} / ${group.name}`, direct_advancement_slots: group.direct_advancement_slots,
      direct_assigned_count: group.direct_assigned_count, format: phase.format,
    })));
  const directPassEditable = canManageParticipants && ['registration_open', 'registration_closed'].includes(tournament?.status || '');
  const directPassDescription = (entry: any) => {
    if (!entry?.direct_group_id) return null;
    const destination = directPassGroups.find(group => group.id === entry.direct_group_id);
    const placement = entry.direct_round_number
      ? ` · Round ${entry.direct_round_number}${entry.direct_series_position ? `, match ${entry.direct_series_position}` : ''}${entry.direct_slot_number ? `, slot ${entry.direct_slot_number}` : ''}`
      : '';
    return `${destination?.name || 'Later phase'}${placement}`;
  };
  const compositionEntries = tournament?.tournament_mode === 'team'
    ? teams.filter(team => team.status === 'active').map(team => ({ id: team.id, direct_group_id: team.direct_group_id, direct_round_number: team.direct_round_number }))
    : participants.filter(participant => participant.participation_status === 'accepted' && !participant.team_id)
      .map(participant => ({ id: participant.id, direct_group_id: participant.direct_group_id, direct_round_number: participant.direct_round_number }));
  const canRenameTeam = (team: any) =>
    isOrganizer || isAdmin || isTournamentModerator || (userTeamId && team.id === userTeamId);

  const refreshOrganizers = async () => {
    const response = await tournamentService.getTournamentOrganizers(id!);
    setOrganizers(response.data || []);
  };

  const handleAddOrganizer = async () => {
    if (!id || !organizerCandidateId) return;
    try {
      setOrganizerMutationLoading(true);
      setError('');
      await tournamentService.addTournamentOrganizer(id, organizerCandidateId);
      await refreshOrganizers();
      setOrganizerCandidateId('');
      setSuccess(t('tournament.organizer_added', 'Co-organizer added successfully.'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (mutationError: any) {
      setError(mutationError.response?.data?.error || t('tournament.organizer_add_failed', 'Failed to add co-organizer.'));
    } finally {
      setOrganizerMutationLoading(false);
    }
  };

  const handleRemoveOrganizer = async (organizer: TournamentOrganizer) => {
    if (!id) return;
    try {
      setOrganizerMutationLoading(true);
      setError('');
      await tournamentService.removeTournamentOrganizer(id, organizer.user_id);
      await refreshOrganizers();
      setSuccess(t('tournament.organizer_removed', 'Co-organizer removed successfully.'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (mutationError: any) {
      setError(mutationError.response?.data?.error || t('tournament.organizer_remove_failed', 'Failed to remove co-organizer.'));
    } finally {
      setOrganizerMutationLoading(false);
    }
  };

  const handleRenameTeam = async () => {
    if (!renameTeamValue.trim() || !tournament) return;
    setRenameTeamLoading(true);
    try {
      await tournamentService.renameTeam(tournament.id, renameTeamModal.teamId, renameTeamValue.trim());
      setSuccess('Team renamed successfully');
      setTimeout(() => setSuccess(''), 3000);
      setRenameTeamModal({ open: false, teamId: '', currentName: '' });
      const teamsRes = await publicService.getTournamentTeams(tournament.id);
      setTeams(teamsRes.data?.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to rename team');
      setTimeout(() => setError(''), 4000);
    } finally {
      setRenameTeamLoading(false);
    }
  };

  const handleRemoveParticipant = async (participantId: string, nickname: string) => {
    if (!tournament) return;
    if (!window.confirm(`Remove ${nickname} from this tournament?`)) return;
    try {
      await tournamentService.removeParticipant(tournament.id, participantId);
      setSuccess(`${nickname} removed from tournament`);
      setTimeout(() => setSuccess(''), 3000);
      // Refresh both individual membership and the team aggregates rendered by this page.
      const [participantsRes, teamsRes] = await Promise.all([
        publicService.getTournamentParticipants(tournament.id),
        publicService.getTournamentTeams(tournament.id),
      ]);
      setParticipants(participantsRes.data || []);
      setTeams(teamsRes.data?.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to remove participant');
      setTimeout(() => setError(''), 4000);
    }
  };

  if (loading) {
    return <MainLayout showUserProfileNav={false}><div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200"><p>{t('loading')}</p></div></MainLayout>;
  }

  if (!tournament) {
    return (
      <MainLayout showUserProfileNav={false}><div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
        <p>{error || t('tournament_title')}</p>
        <button data-help-id="action-back-to-tournaments" onClick={() => navigate('/tournaments')}>{t('tournaments.back_to_tournaments')}</button>
      </div></MainLayout>
    );
  }

  const phaseDefinition = editData.format_definition;

  return (
    <MainLayout showUserProfileNav={false}><div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
      <div className="flex justify-between items-center mb-8 pb-4 border-b-2 border-gray-300">
        <button data-help-id="action-back-to-tournaments" onClick={handleBackButton} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors">← {t('tournaments.back_to_tournaments')}</button>
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold text-gray-800">{tournament.name}</h1>
          <span 
            className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold"
            style={{ backgroundColor: getStatusColor(tournament.status) }}
          >
            {t(`option_${normalizeStatus(tournament.status)}`) !== `option_${normalizeStatus(tournament.status)}` ? t(`option_${normalizeStatus(tournament.status)}`) : (tournament.status || t('option_pending'))}
          </span>
        </div>
      </div>

      {error && <p className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded mb-6">{error}</p>}
      {success && <p className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded mb-6">{success}</p>}

      <div data-help-id="region-tournament-details-summary" className="bg-white rounded-lg shadow-lg p-8 mb-8">
        <p>
          <strong>{t('tournament.col_organizer')}:</strong>{' '}
          {(organizers.length > 0 ? organizers : [{ user_id: tournament.creator_id, nickname: tournament.creator_nickname }]).map((organizer, index, arr) => (
            <React.Fragment key={organizer.user_id}>
              {organizer.user_id === tournament.creator_id ? (
                <strong>
                  <PlayerLink nickname={organizer.nickname} userId={organizer.user_id} />
                </strong>
              ) : (
                <PlayerLink nickname={organizer.nickname} userId={organizer.user_id} />
              )}
              {index < arr.length - 1 && ', '}
            </React.Fragment>
          ))}
        </p>
        {isPrimaryOrganizer && tournament.status !== 'finished' && (
          <div data-help-id="region-tournament-organizer-management" className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
            <h2 className="font-semibold text-gray-800">
              {t('tournament.manage_organizers', 'Manage co-organizers')}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {t('tournament.manage_organizers_help', 'Co-organizers can manage this tournament. Only you, as its creator, can change this list.')}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select
                data-help-id="field-tournament-co-organizer"
                value={organizerCandidateId}
                onChange={(event) => setOrganizerCandidateId(event.target.value)}
                disabled={organizerMutationLoading}
                className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">{t('tournament.select_co_organizer', 'Select co-organizer')}</option>
                {organizerUsers
                  .filter((candidate) => candidate.id !== tournament.creator_id && !organizers.some((organizer) => organizer.user_id === candidate.id))
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.nickname}</option>
                  ))}
              </select>
              <button
                data-help-id="action-add-tournament-organizer"
                type="button"
                onClick={handleAddOrganizer}
                disabled={organizerMutationLoading || !organizerCandidateId}
                className="rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {t('tournament.add_organizer', 'Add co-organizer')}
              </button>
            </div>
            {organizers.some((organizer) => organizer.user_id !== tournament.creator_id) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {organizers
                  .filter((organizer) => organizer.user_id !== tournament.creator_id)
                  .map((organizer) => (
                    <span key={organizer.user_id} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm ring-1 ring-gray-300">
                      {organizer.nickname}
                      <button
                        data-help-id="action-remove-tournament-organizer"
                        type="button"
                        onClick={() => handleRemoveOrganizer(organizer)}
                        disabled={organizerMutationLoading}
                        className="font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                        aria-label={t('tournament.remove_organizer_aria', 'Remove {{nickname}} as co-organizer', { nickname: organizer.nickname })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </div>
        )}
        <p><strong>{t('tournament.col_type')}:</strong> Flexible phases</p>
        <p><strong>Wesnoth game name:</strong> <code className="px-1 bg-gray-100 rounded">{tournament.forum_topic_id ? `T${tournament.forum_topic_id}` : tournament.name}</code></p>
        {tournament.forum_topic_id && (
          <p><strong>Forum:</strong>{' '}
            <a data-help-id="action-open-tournament-forum-topic" className="text-blue-600 hover:underline" href={`https://forums.wesnoth.org/viewtopic.php?t=${tournament.forum_topic_id}`} target="_blank" rel="noreferrer">
              Topic {tournament.forum_topic_id}
            </a>
          </p>
        )}
        {tournament.scheduled_start_at && (
          <p><strong>{t('label_scheduled_start_date', 'Planned Start')}:</strong> {formatDate(tournament.scheduled_start_at)}</p>
        )}
        <p><strong>{t('tournament.mode', 'Tournament Mode')}:</strong> {getModeLabel(tournament.tournament_mode)}</p>
        <p><strong>{t('label_max_participants')}:</strong> {tournament.max_participants || t('unlimited')}</p>
        <p><strong>{t('label_created')}:</strong> {formatDate(tournament.created_at)}</p>
        {tournament.started_at && <p><strong>{t('label_started')}:</strong> {formatDate(tournament.started_at)}</p>}
        {tournament.finished_at && <p><strong>{t('label_finished')}:</strong> {formatDate(tournament.finished_at)}</p>}
        <details
          className="mt-4"
          open={descriptionRulesOpen}
          onToggle={(event) => setDescriptionRulesOpen(event.currentTarget.open)}
        >
          <summary
            data-help-id="action-toggle-tournament-description-rules"
            className="cursor-pointer select-none font-semibold text-gray-800 marker:text-gray-500"
          >
            {t('label_description')} &amp; {t('tournament.rules_content', 'Tournament Rules')}
          </summary>
          <div className="mt-3 space-y-4">
            <div>
              <strong>{t('label_description')}:</strong>
              <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
                <MarkdownPreview
                  markdown={tournament.description || ''}
                  emptyMessage={t('tournament.description_preview_empty', 'No description configured for this tournament.')}
                />
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <strong>{t('tournament.rules_content', 'Tournament Rules')}:</strong>
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span>{t('tournament.rules_history', 'Rules history')}</span>
                  <select
                    data-help-id="option-tournament-rules-history"
                    value={selectedRulesVersion ?? ''}
                    onChange={(event) => setSelectedRulesVersion(event.target.value ? Number(event.target.value) : null)}
                    className="rounded border border-gray-300 bg-white px-2 py-1"
                  >
                    <option value="">{t('tournament.rules_current_version', 'Current rules')}</option>
                    {rulesHistory.map((version) => (
                      <option key={version.version_number} value={version.version_number}>
                        {t('tournament.rules_version_with_date', 'Version {{version}} · {{date}}', {
                          version: version.version_number,
                          date: formatDate(version.changed_at),
                        })}
                      </option>
                    ))}
                  </select>
                  {isOrganizer && !isTournamentCompleted && !rulesEditMode && (
                    <button
                      data-help-id="action-edit-tournament-rules"
                      type="button"
                      onClick={() => {
                        setRulesDraft(tournament.rules_content || tournament.description || '');
                        setSelectedRulesVersion(null);
                        setRulesEditMode(true);
                      }}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {t('tournament.edit_rules', 'Edit Rules')}
                    </button>
                  )}
                </div>
              </div>
              {selectedRules && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('tournament.rules_changed_at', 'Changed {{date}} by {{user}}', {
                    date: formatDate(selectedRules.changed_at),
                    user: selectedRules.changed_by_nickname || t('tournament.unknown_user', 'Unknown user'),
                  })}
                </p>
              )}
              {rulesEditMode ? (
                <div data-help-id="region-tournament-rules-live-edit" className="mt-2 space-y-3">
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-gray-600">
                        {t('tournament.editor', 'Editor')}
                      </span>
                      <textarea
                        data-help-id="field-tournament-rules-live-edit"
                        ref={rulesEditorRef}
                        value={rulesDraft}
                        onChange={(event) => setRulesDraft(event.target.value)}
                        rows={12}
                        disabled={rulesSaving}
                        className="w-full resize-y rounded border border-gray-300 bg-white p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                      />
                    </div>
                    <div data-help-id="region-tournament-rules-live-edit-preview" className="rounded border border-gray-200 bg-gray-50 p-4">
                      <h4 className="mb-2 font-semibold text-gray-800">
                        {t('tournament.rules_preview', 'Rules Preview')}
                      </h4>
                      <MarkdownPreview
                        markdown={rulesDraft}
                        emptyMessage={t('tournament.rules_preview_empty', 'No rules configured for this tournament.')}
                      />
                    </div>
                  </div>
                  <small className="text-gray-600">
                    {t('tournament.rules_markdown_help', 'Markdown syntax is supported, using the same renderer as Wiki Help.')}
                  </small>
                  <div className="flex flex-wrap gap-2">
                    <button
                      data-help-id="action-save-tournament-rules"
                      type="button"
                      onClick={handleSaveRules}
                      disabled={rulesSaving}
                      className="rounded bg-indigo-500 px-4 py-2 text-white hover:bg-indigo-600 disabled:opacity-50"
                    >
                      {rulesSaving ? t('tournament.rules_saving', 'Saving...') : t('common.save', 'Save')}
                    </button>
                    <button
                      data-help-id="action-cancel-tournament-rules-edit"
                      type="button"
                      onClick={() => setRulesEditMode(false)}
                      disabled={rulesSaving}
                      className="rounded bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300 disabled:opacity-50"
                    >
                      {t('common.cancel', 'Cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
                  <MarkdownPreview
                    markdown={displayedRulesContent}
                    emptyMessage={t('tournament.rules_preview_empty', 'No rules configured for this tournament.')}
                  />
                </div>
              )}
            </div>
          </div>
        </details>
      </div>

      {/* Tournament Assets Section */}
      {(unrankedFactions.length > 0 || unrankedMaps.length > 0) && (
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h3>{t('tournament.unranked_assets', 'Tournament Assets')}</h3>
          
          <div className="flex flex-col gap-6">
            {unrankedFactions.length > 0 && (
              <div className="flex flex-col gap-3">
                <h4 className="text-lg font-semibold text-gray-800">{t('tournament.allowed_factions', 'Allowed Factions')}</h4>
                <div className="flex flex-wrap gap-2">
                  {unrankedFactions.map((faction) => (
                    <span key={faction.id} className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">{faction.name}</span>
                  ))}
                </div>
              </div>
            )}

            {unrankedMaps.length > 0 && (
              <div className="flex flex-col gap-3">
                <h4 className="text-lg font-semibold text-gray-800">{t('tournament.allowed_maps', 'Allowed Maps')}</h4>
                <div className="flex flex-wrap gap-2">
                  {unrankedMaps.map((map) => (
                    <span key={map.id} className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">{map.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tournament Configuration Section */}
      <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
        <h3>{t('tournament_title')} {t('tournament.basic_info') ? '- ' + t('tournament.basic_info') : ''}</h3>
        <div data-help-id="region-tournament-phase-format-summary" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <strong className="font-semibold text-gray-700">{t('label_round_duration')}:</strong>
              <span className="text-gray-600">{tournament.round_duration_days} {t('label_days')}</span>
            </div>
            <div className="flex flex-col gap-2">
              <strong className="font-semibold text-gray-700">{t('label_auto_advance_rounds')}:</strong>
              <span className="text-gray-600">{tournament.auto_advance_round ? t('yes') : t('no')}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {(phaseDefinition?.phases || []).map((phase) => (
              <article key={phase.id} className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <h4 className="font-semibold text-gray-800">{phase.order}. {phase.name}</h4>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-gray-600">System</dt>
                  <dd className="font-medium text-gray-800">{phase.format === 'single_elimination' ? 'Single elimination' : phase.format === 'round_robin' ? 'Round robin' : 'Swiss'}</dd>
                  <dt className="text-gray-600">Groups / brackets</dt>
                  <dd className="font-medium text-gray-800">{phase.groups.length}</dd>
                  <dt className="text-gray-600">Match format</dt>
                  <dd className="font-medium text-gray-800">Bo{phase.default_best_of}</dd>
                  {phase.swiss && <><dt className="text-gray-600">Rounds</dt><dd className="font-medium text-gray-800">{phase.swiss.round_count}</dd></>}
                  {phase.round_robin && <><dt className="text-gray-600">Cycles</dt><dd className="font-medium text-gray-800">{phase.round_robin.cycle_count}</dd></>}
                </dl>
              </article>
            ))}
          </div>
        </div>
      </div>

      {!editMode && ['registration_open', 'registration_closed'].includes(tournament.status) && directPassFormat && (
        <TournamentCompositionPreview
          format={directPassFormat}
          entries={compositionEntries}
        />
      )}

      {/* Tournament Actions Section */}
      <div className="flex flex-row flex-wrap gap-3 items-center justify-between mb-6">
        {/* Join button (only if logged in and NOT in edit mode) - Left side */}
        {!editMode && tournament.status === 'registration_open' && !isUserInTournament && userId && (
          tournament.tournament_mode === 'ranked' && !enableRanked ? (
            <div className="flex flex-col gap-1">
              <button data-help-id="action-join-tournament-disabled" className="px-6 py-2 bg-gray-300 text-gray-500 rounded cursor-not-allowed" disabled>
                {t('tournaments.request_join')}
              </button>
              <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">
                {t('tournaments.join_ranked_disabled', 'Enable ranked matches in your profile to join this tournament')}
              </p>
            </div>
          ) : (
            <button data-help-id="action-join-tournament" className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleJoinTournament} disabled={isJoinRequestLoading}>
              {t('tournaments.request_join')}
            </button>
          )
        )}
        {(!tournament.status || tournament.status !== 'registration_open' || isUserInTournament || !userId || editMode) && !isOrganizer && (
          <div></div>
        )}

        {/* Organizer Controls - Right side */}
        {isOrganizer && !editMode && (
          <div className="flex flex-wrap gap-3">
            {!['prepared', 'in_progress', 'finished', 'completed', 'complete'].includes(tournament.status) && (
              <button 
                data-help-id="action-edit-tournament"
                onClick={() => setEditMode(true)} 
                disabled={!assetsLoaded}
                className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {t('btn_edit', 'Edit')}
              </button>
            )}

            {tournament.status === 'registration_open' && (
              <button data-help-id="action-close-registration" onClick={handleCloseRegistration} className="px-6 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors">{t('tournaments.btn_close_registration')}</button>
            )}

            {tournament.status === 'registration_closed' && (
              <button data-help-id="action-prepare-tournament" onClick={handlePrepareAndStart} className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">{t('tournaments.btn_prepare')}</button>
            )}

            {tournament.status === 'prepared' && (
              <button data-help-id="action-start-tournament" onClick={handleStartTournament} className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors">{t('tournaments.btn_start')}</button>
            )}

            {tournament.status === 'in_progress' && (
              <p className="self-center text-green-600">✓ {t('tournaments.started_locked')}</p>
            )}

            {(tournament.status !== 'in_progress' && tournament.status !== 'finished') && (
              <button 
                data-help-id="action-cancel-tournament"
                onClick={() => {
                  if (confirm(t('confirm_cancel_tournament', 'Are you sure you want to cancel this tournament? All data will be deleted.'))) {
                    handleCancelTournament();
                  }
                }} 
                className="px-6 py-2 bg-red-700 text-white rounded hover:bg-red-800 transition-colors"
              >
                {t('cancel_tournament', 'Cancel Tournament')}
              </button>
            )}
          </div>
        )}
      </div>

      {isOrganizer && (isAdmin || isTournamentModerator) && tournament.status === 'registration_open' && (
        <SimulateJoinPanel tournament={tournament} onCompleted={() => fetchTournamentData()} />
      )}

      {/* Edit form - shown when in edit mode */}
      {isOrganizer && editMode && !isTournamentCompleted && tournament.status !== 'in_progress' && (
        <TournamentForm 
          mode="edit"
          formData={editData}
          onFormDataChange={setEditData}
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveChanges();
          }}
          unrankedFactions={unrankedFactions.map(f => f.id)}
          onUnrankedFactionsChange={(factionIds: string[]) => {
            // Convert selected IDs back to objects by filtering allFactions
            const selected = allFactions.filter(f => factionIds.includes(f.id));
            setUnrankedFactions(selected);
          }}
          unrankedMaps={unrankedMaps.map(m => m.id)}
          onUnrankedMapsChange={(mapIds: string[]) => {
            // Convert selected IDs back to objects by filtering allMaps
            const selected = allMaps.filter(m => mapIds.includes(m.id));
            setUnrankedMaps(selected);
          }}
          onCancel={() => setEditMode(false)}
          entryOptions={(tournament?.tournament_mode === 'team' ? teams : participants).map(entry => ({ id: entry.id, name: entry.nickname }))}
        />
      )}

      {userParticipationStatus === 'pending' && (
        <p className="text-orange-600">⏳ {t('join_pending_msg')}</p>
      )}

      {userParticipationStatus === 'denied' && (
        <p className="text-red-600">❌ {t('join_denied_msg')}</p>
      )}

      <div className="flex flex-col gap-4 mt-8 mb-6">
        {/* Tab buttons */}
        <div className="flex flex-wrap gap-2 items-center">
          <button 
            data-help-id="action-tab-participants"
            className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'participants' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
            onClick={() => setActiveTab('participants')}
          >
            {tournament?.tournament_mode === 'team' ? 'Teams' : t('tabs.participants', { count: participants.length })}
          </button>
          <button
            data-help-id="action-tab-tournament-standings"
            className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'tournamentStandings' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
            onClick={() => setActiveTab('tournamentStandings')}
          >
            Tournament Standings
          </button>
          <button
            data-help-id="action-tab-competition"
            className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'competition' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
            onClick={() => setActiveTab('competition')}
          >
            Competition
          </button>
          {activeTab === 'competition' && (
            <div className="flex flex-wrap items-center gap-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <label className="flex items-center gap-2 font-semibold text-gray-700">
                <span>Matches</span>
                <select
                  data-help-id="option-competition-match-status-filter"
                  value={competitionMatchFilter}
                  onChange={(event) => setCompetitionMatchFilter(event.target.value as typeof competitionMatchFilter)}
                  className="rounded border border-gray-300 bg-white px-2 py-1 font-normal"
                >
                  <option value="all">All</option>
                  <option value="pending">Scheduled</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <label className="flex items-center gap-2 font-semibold text-gray-700">
                <input
                  data-help-id="option-competition-show-only-mine"
                  type="checkbox"
                  checked={competitionShowOnlyMine}
                  onChange={(event) => setCompetitionShowOnlyMine(event.target.checked)}
                />
                Show only mine
              </label>
              <label className="flex items-center gap-2 font-semibold text-gray-700">
                <input
                  data-help-id="option-competition-hide-phases-groups"
                  type="checkbox"
                  checked={!competitionShowPhasesGroups}
                  onChange={(event) => setCompetitionShowPhasesGroups(!event.target.checked)}
                />
                Hide phases / groups
              </label>
            </div>
          )}
          
          {/* Refresh button */}
          <button
            data-help-id="action-refresh-tournament-detail"
            onClick={() => {
              setIsRefreshing(true);
              refreshActiveTab().finally(() => setIsRefreshing(false));
            }}
            disabled={isRefreshing}
            className="ml-auto px-3 py-2 rounded bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            title={t('common.refresh')}
          >
            <svg 
              className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </button>
        </div>

      </div>

      {activeTab === 'participants' && (
        <div className="mb-8 mt-6">
          {tournament?.tournament_mode === 'team' ? (
            // Team aggregates include the authoritative member rows returned by the public teams endpoint.
            teams.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {teams
                  .filter((team: any) => {
                    // Show "Rejected players" team only if registration is open
                    const isRejectedTeam = team.nickname === 'Rejected players';
                    if (isRejectedTeam && tournament?.status !== 'registration_open') {
                      return false;
                    }
                    return true;
                  })
                  .sort((a: any, b: any) => {
                    // Always show "Rejected players" team last if it exists
                    const aIsRejected = a.nickname === 'Rejected players';
                    const bIsRejected = b.nickname === 'Rejected players';
                    if (aIsRejected && !bIsRejected) return 1;
                    if (!aIsRejected && bIsRejected) return -1;
                    return 0;
                  })
                  .map((team: any) => (
                  <div key={team.id} className="border-2 border-blue-400 rounded-lg p-6 bg-gray-50 shadow hover:shadow-lg transition-all hover:-translate-y-1">
                    <div className="flex justify-between items-start gap-6 mb-4 pb-3 border-b-2 border-blue-400 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-800">
                            {team.nickname}
                          </h3>
                          {canRenameTeam(team) && tournament?.status === 'registration_open' && team.nickname !== 'Rejected players' && (
                            <button
                              data-help-id="action-rename-team"
                              className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                              title="Rename team"
                              onClick={() => { setRenameTeamModal({ open: true, teamId: team.id, currentName: team.nickname }); setRenameTeamValue(team.nickname); }}
                            >
                              ✏️
                            </button>
                          )}
                        </div>
                        <span className="text-sm text-gray-600">({team.team_size}/2 members)</span>
                        {team.team_total_elo && (
                          <div className="text-sm text-gray-700 mt-2">
                            <strong>Total ELO:</strong> {team.team_total_elo}
                          </div>
                        )}
                      </div>
                    </div>
                    {directPassEditable && tournament?.tournament_mode === 'team' && <div className="mb-3">
                      <DirectPassControl tournamentId={id!} entityType="team" entityId={team.id} groups={directPassGroups} current={team}
                        disabled={!['active'].includes(team.status)} onSaved={() => { void refreshDirectPassData(); }} />
                    </div>}
                    {directPassDescription(team) && <p className="mb-3 text-sm font-medium text-indigo-800">Direct pass: {directPassDescription(team)}</p>}
                    {team.members_with_elo && team.members_with_elo.length > 0 ? (
                      <div className="mt-4 max-md:overflow-x-auto max-md:-webkit-overflow-scrolling-touch">
                        <table className="w-full text-sm max-md:min-w-[600px]">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">{t('label_nickname')}</th>
                              <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">{t('label_elo')}</th>
                              <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">Position</th>
                              <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">{t('label_status')}</th>
                              <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">{t('label_actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {team.members_with_elo.map((member: any) => (
                              <tr key={member.user_id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3 max-md:px-2 max-md:py-2 text-gray-700 max-md:text-xs"><PlayerLink nickname={member.nickname} userId={member.user_id} /></td>
                                <td className="px-4 py-3 max-md:px-2 max-md:py-2 text-gray-700 max-md:text-xs">{member.elo_rating || '-'}</td>
                                <td className="px-4 py-3 max-md:px-2 max-md:py-2 text-gray-700 max-md:text-xs">{member.team_position || '-'}</td>
                                <td className="px-4 py-3 max-md:px-2 max-md:py-2 text-gray-700 max-md:text-xs">
                                  <span
                                    className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold"
                                    style={{ backgroundColor: getParticipationStatusColor(member.participation_status || 'pending') }}
                                  >
                                    {member.participation_status === 'unconfirmed' ? 'Unconfirmed' :
                                   member.participation_status === 'pending' ? 'Pending' :
                                   member.participation_status === 'accepted' ? 'Accepted' : 'Pending'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-700">
                                <div className="flex gap-2 flex-wrap">
                                  {member.participation_status === 'unconfirmed' && member.user_id === userId && (
                                    <button
                                      data-help-id="action-confirm-participation"
                                      className="px-3 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600 transition-colors"
                                      onClick={() => handleConfirmParticipation(member.participant_id)}
                                      title="Confirm your participation"
                                    >
                                      {t('btn_confirm') || 'Confirm'}
                                    </button>
                                  )}
                                  {isOrganizer && member.participation_status === 'pending' && (
                                    <>
                                      <button
                                        data-help-id="action-accept-participant"
                                        className="px-3 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600 transition-colors"
                                        onClick={() => handleAcceptParticipant(member.participant_id)}
                                        title={t('btn_accept')}
                                      >
                                        {t('btn_accept')}
                                      </button>
                                      <button
                                        data-help-id="action-reject-participant"
                                        className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600 transition-colors"
                                        onClick={() => handleRejectParticipant(member.participant_id)}
                                        title={t('btn_reject')}
                                      >
                                        {t('btn_reject')}
                                      </button>
                                    </>
                                  )}
                                  {isOrganizer && member.participation_status === 'unconfirmed' && (
                                    <span title="Awaiting player confirmation" className="text-sm text-gray-600">
                                      Awaiting confirmation
                                    </span>
                                  )}
                                  {/* Substitute Player — organizer only, after tournament starts, team active, for accepted members */}
                                  {isOrganizer && ['registration_closed', 'prepared', 'in_progress'].includes(tournament?.status || '') && team.status === 'active' && member.participation_status === 'accepted' && (
                                    <button
                                      data-help-id="action-replace-team-member"
                                      className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors"
                                      title="Replace this player with a substitute"
                                      onClick={() => {
                                        console.log('Substitute button clicked', {
                                          teamId: team.id,
                                          participantId: member.participant_id,
                                          memberNickname: member.nickname
                                        });
                                        setReplacementTeamMembers(team.members_with_elo || []);
                                        setReplacementData({
                                          teamId: team.id,
                                          memberId: member.participant_id,
                                          memberNickname: member.nickname
                                        });
                                        setShowReplacementModal(true);
                                      }}
                                    >
                                      Substitute
                                    </button>
                                  )}
                                  {/* Remove participant — self, organizer, admin, moderator; only before tournament starts */}
                                  {(member.user_id === userId || canManageParticipants) &&
                                   tournament?.status === 'registration_open' && (
                                    <button
                                      data-help-id="action-remove-participant"
                                      className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 transition-colors"
                                      title="Remove from tournament"
                                      onClick={() => handleRemoveParticipant(member.participant_id, member.nickname)}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    ) : (
                      <p className="text-gray-600 text-center py-4">No members</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600">{t('no_participants_yet')}</p>
            )
          ) : (
            // Individual view for ranked/unranked
            participants.length > 0 ? (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_nickname')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_status')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_elo')}</th>
                    {showParticipantActions && <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_actions')}</th>}
                    {directPassGroups.length > 0 && <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">Direct pass</th>}
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-700"><PlayerLink nickname={p.nickname} userId={p.user_id} /></td>
                      <td className="px-4 py-3 text-gray-700">
                        <span 
                          className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold"
                          style={{ backgroundColor: getParticipationStatusColor(p.participation_status) }}
                        >
                          {t(`option_${normalizeStatus(p.participation_status)}`) !== `option_${normalizeStatus(p.participation_status)}` ? t(`option_${normalizeStatus(p.participation_status)}`) : (p.participation_status || t('option_pending'))}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{p.elo_rating || '-'}</td>
                      {showParticipantActions && (
                      <td className="px-4 py-3 text-gray-700">
                        <div className="flex gap-1 flex-wrap">
                        {isOrganizer && p.participation_status === 'pending' && (
                          <>
                          <button 
                            data-help-id="action-accept-participant"
                            className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600 transition-colors"
                            onClick={() => handleAcceptParticipant(p.id)}
                          >
                            {t('btn_accept')}
                          </button>
                          <button 
                            data-help-id="action-reject-participant"
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600 transition-colors"
                            onClick={() => handleRejectParticipant(p.id)}
                          >
                            {t('btn_reject')}
                          </button>
                          </>
                        )}
                        {(p.user_id === userId || canManageParticipants) && (
                          <button
                            data-help-id="action-remove-participant"
                            className="px-2 py-1 bg-red-700 text-white rounded text-xs hover:bg-red-800 transition-colors"
                            title="Remove from tournament"
                            onClick={() => handleRemoveParticipant(p.id, p.nickname)}
                          >
                            ✕
                          </button>
                        )}
                        </div>
                      </td>
                      )}
                      {directPassGroups.length > 0 && <td className="px-4 py-3 text-gray-700">
                        {directPassEditable
                          ? <DirectPassControl tournamentId={id!} entityType="participant" entityId={p.id}
                              groups={directPassGroups} current={p} disabled={p.participation_status !== 'accepted' || Boolean(p.team_id)}
                              onSaved={() => { void refreshDirectPassData(); }} />
                          : directPassDescription(p)
                            ? <span className="font-medium text-indigo-800">{directPassDescription(p)}</span>
                            : <span className="text-gray-400">—</span>}
                      </td>}
                  </tr>
                ))}
              </tbody>
              </table>
              </div>
            ) : (
              <p className="text-gray-600">{t('no_participants_yet')}</p>
            )
          )}
        </div>
      )}

      {activeTab === 'competition' && tournament && (
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8 mt-6">
          <TournamentCompetitionView
            tournamentId={tournament.id}
            canManage={isOrganizer}
            currentUserId={userId}
            participantTeamIds={participants.map((participant: any) => participant.team_id).filter(Boolean)}
            onScheduleGame={(game) => handlePreloadSchedulingData(game.series_id)}
            highlightedSeriesId={highlightedSeriesId}
            highlightedGameId={highlightedCompetitionGameId}
            matchFilter={competitionMatchFilter}
            showOnlyMine={competitionShowOnlyMine}
            showPhasesGroups={competitionShowPhasesGroups}
            refreshKey={tabRefreshKey}
            tournamentStatus={tournament.status}
          />
        </div>
      )}

      {activeTab === 'tournamentStandings' && tournament && (
        <div className="mb-8 mt-6">
          <TournamentOverallStandings tournamentId={tournament.id} refreshKey={tabRefreshKey} />
        </div>
      )}

      {/* Team Join Modal */}
      {showTeamJoinModal && tournament && (
        <TeamJoinModal
          tournamentId={id!}
          onSubmit={handleTeamJoinSubmit}
          onClose={() => setShowTeamJoinModal(false)}
          isLoading={joiningTeamLoading}
          currentUserId={userId || undefined}
          currentUserNickname={user?.nickname || undefined}
          externalError={error}
        />
      )}

      {/* Team Member Replacement Modal */}
      {showReplacementModal && replacementData && tournament && (
        <TeamReplacementModal
          tournamentId={id!}
          teamId={replacementData.teamId}
          isOpen={showReplacementModal}
          teamMembers={replacementTeamMembers}
          onClose={() => {
            setShowReplacementModal(false);
            setReplacementData(null);
            setReplacementTeamMembers([]);
          }}
          onSuccess={() => {
            setShowReplacementModal(false);
            setReplacementData(null);
            setReplacementTeamMembers([]);
            fetchTournamentData();
          }}
        />
      )}

      {/* Delete Tournament Confirmation Modal */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">{t('tournaments.confirm_delete_title') || 'Confirm Tournament Deletion'}</h2>
            <p className="text-gray-600 mb-6">{t('tournaments.no_participants_message') || 'No participants have registered for this tournament. Delete it?'}</p>
            <div className="flex justify-end gap-3">
              <button
                data-help-id="action-cancel-delete-tournament"
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                onClick={() => setShowDeleteConfirmModal(false)}
              >
                {t('cancel_btn') || 'Cancel'}
              </button>
              <button
                data-help-id="action-confirm-delete-tournament"
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                onClick={handleConfirmDelete}
              >
                {t('delete_btn') || 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Team Modal */}
      {renameTeamModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Rename Team</h2>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">New team name</label>
              <input
                data-help-id="field-team-name"
                type="text"
                value={renameTeamValue}
                onChange={(e) => setRenameTeamValue(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Enter team name"
                maxLength={64}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                data-help-id="action-cancel-rename-team"
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                onClick={() => setRenameTeamModal({ open: false, teamId: '', currentName: '' })}
              >
                {t('cancel_btn') || 'Cancel'}
              </button>
              <button
                data-help-id="action-save-team-name"
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                disabled={renameTeamLoading || !renameTeamValue.trim()}
                onClick={handleRenameTeam}
              >
                {renameTeamLoading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Proposal Modal */}
      <ScheduleProposalModal
        isOpen={scheduleProposalModal.isOpen}
        tournamentId={scheduleProposalModal.tournamentId || id!}
        seriesId={scheduleProposalModal.seriesId}
        initialParticipants={scheduleProposalModal.initialParticipants}
        initialProposal={scheduleProposalModal.initialProposal}
        initialViewingTimezone={scheduleProposalModal.initialViewingTimezone}
        initialDisplayDateStart={scheduleProposalModal.initialDisplayDateStart}
        initialScrollToHour={scheduleProposalModal.initialScrollToHour}
        onClose={() => setScheduleProposalModal({ isOpen: false })}
        onSuccess={() => {
          setScheduleProposalModal({ isOpen: false });
          fetchTournamentData();
        }}
      />
    </div></MainLayout>
  );
};

export default TournamentDetail;
