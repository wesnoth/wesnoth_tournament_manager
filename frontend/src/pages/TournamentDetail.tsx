import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { publicService, tournamentService, api } from '../services/api';
import TournamentForm from '../components/TournamentForm';
import { TeamJoinModal } from '../components/TeamJoinModal';
import ScheduleProposalModal, { loadSeriesSchedule, type SeriesScheduleState } from '../components/ScheduleProposalModal';
import { TeamReplacementModal } from '../components/TeamReplacementModal';
import TeamRenameModal from '../components/TeamRenameModal';
import MainLayout from '../components/MainLayout';
import { SimulateJoinPanel } from '../components/TestSimulationControls';
import type {
  TournamentDetails,
  TournamentFormatDefinition,
  TournamentFormData,
  TournamentOrganizer,
  TournamentParticipant,
  TournamentRuleVersion,
  TournamentTeam,
  TournamentTeamMember,
  TournamentUpdatePayload,
} from '../types/tournament';
import TournamentCompetitionView from '../components/TournamentCompetitionView';
import TournamentCompositionPreview from '../components/TournamentCompositionPreview';
import TournamentOverallStandings from '../components/TournamentOverallStandings';
import TournamentOrganizersPanel from '../components/TournamentOrganizersPanel';
import TournamentRulesPanel from '../components/TournamentRulesPanel';
import TournamentFormatSummary from '../components/TournamentFormatSummary';
import TournamentActionsBar from '../components/TournamentActionsBar';
import TournamentDetailTabs, {
  defaultCompetitionFilters,
  getDefaultTournamentTab,
  getRequestedTournamentTab,
  type CompetitionFilters,
  type TournamentDetailTab,
} from '../components/TournamentDetailTabs';
import TournamentTeamsList from '../components/TournamentTeamsList';
import TournamentParticipantsTable, { type DirectPassContext, type ParticipantRowActions } from '../components/TournamentParticipantsTable';
import { buildDirectPassGroups } from '../components/TournamentDirectPassControl';
import FormatIssueList from '../components/FormatIssueList';
import { readFormatIssues, type FormatValidationIssue } from '../utils/formatIssues';
import { formatTournamentDate, getTournamentStatusColor, statusLabel, tournamentModeLabel } from '../utils/tournamentStatus';

/**
 * Tournament page: header, summary, format, lifecycle actions, and the
 * participants, standings, and competition tabs. The page loads the
 * tournament data and owns the state shared by several panels; each panel
 * owns its own editing state.
 */
const TournamentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { userId, user, enableRanked, isAdmin, isTournamentModerator } = useAuthStore();

  const [tournament, setTournament] = useState<TournamentDetails | null>(null);
  const [participants, setParticipants] = useState<TournamentParticipant[]>([]);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [rulesHistory, setRulesHistory] = useState<TournamentRuleVersion[]>([]);
  const [teams, setTeams] = useState<TournamentTeam[]>([]);
  const [directPassFormat, setDirectPassFormat] = useState<TournamentFormatDefinition | null>(null);
  const [organizers, setOrganizers] = useState<TournamentOrganizer[]>([]);
  const [unrankedFactions, setUnrankedFactions] = useState<Array<{ id: string; name: string }>>([]);
  const [unrankedMaps, setUnrankedMaps] = useState<Array<{ id: string; name: string }>>([]);
  const [allFactions, setAllFactions] = useState<Array<{ id: string; name: string }>>([]);
  const [allMaps, setAllMaps] = useState<Array<{ id: string; name: string }>>([]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [showTeamJoinModal, setShowTeamJoinModal] = useState(false);
  const [joiningTeamLoading, setJoiningTeamLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Phase-format problems returned when saving the configuration, listed so the organizer knows what to fix.
  const [formatIssues, setFormatIssues] = useState<FormatValidationIssue[]>([]);
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<TournamentDetailTab>(() => getRequestedTournamentTab(searchParams) || 'participants');
  const tabInitializedForTournament = useRef<string | null>(null);
  const [highlightedSeriesId] = useState<string | null>(searchParams.get('seriesId'));
  const [highlightedCompetitionGameId] = useState<string | null>(searchParams.get('gameId'));
  const [competitionFilters, setCompetitionFilters] = useState<CompetitionFilters>(defaultCompetitionFilters);
  const [tabRefreshKey, setTabRefreshKey] = useState(0);
  const [userParticipationStatus, setUserParticipationStatus] = useState<string | null>(null);
  const [isUserInTournament, setIsUserInTournament] = useState(false);
  const [isJoinRequestLoading, setIsJoinRequestLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [renameTeam, setRenameTeam] = useState<{ id: string; name: string } | null>(null);
  // Team whose member the organizer is substituting; the modal picks the member.
  const [replacement, setReplacement] = useState<{ teamId: string; teamMembers: TournamentTeamMember[] } | null>(null);
  const [scheduleSeries, setScheduleSeries] = useState<SeriesScheduleState | null>(null);

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

  /** Show a confirmation banner that clears itself after three seconds. */
  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  // Get the origin page from location state
  const originPage = (location.state as any)?.from || 'tournaments';

  useEffect(() => {
    if (id) {
      fetchTournamentData();
    }
  }, [id, userId]);

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

      // Every tournament uses the phase engine; its format feeds both the
      // configuration summary and the direct-pass controls.
      const formatRes = await tournamentService.getTournamentFormat(id!);
      setTournament(tournamentRes.data);
      setDirectPassFormat(formatRes.data);
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

  const openSeriesSchedule = async (seriesId: string) => {
    try {
      setScheduleSeries(await loadSeriesSchedule(id!, seriesId));
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
    setFormatIssues([]);
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
      // A rejected phase format is explained by the localized issue list, whose
      // title already says what happened; the backend's generic English message
      // would only repeat it.
      const issues = readFormatIssues(err);
      setFormatIssues(issues);
      setError(issues.length > 0 ? '' : err.response?.data?.error || t('error_failed_save_changes'));
    }
  };

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

  const isOrganizer = Boolean(userId && organizers.some((organizer) => organizer.user_id === userId));
  const isTournamentCompleted = ['finished', 'completed', 'complete'].includes(tournament?.status || '');
  const canManageParticipants = isOrganizer || isAdmin || isTournamentModerator;
  const directPass: DirectPassContext = {
    groups: buildDirectPassGroups(directPassFormat),
    // Passes are assigned before preparation compiles the entries into the graph.
    editable: canManageParticipants && ['registration_open', 'registration_closed'].includes(tournament?.status || ''),
    onSaved: () => { void refreshDirectPassData(); },
  };
  const compositionEntries = tournament?.tournament_mode === 'team'
    ? teams.filter(team => team.status === 'active').map(team => ({ id: team.id, direct_group_id: team.direct_group_id, direct_round_number: team.direct_round_number }))
    : participants.filter(participant => participant.participation_status === 'accepted' && !participant.team_id)
      .map(participant => ({ id: participant.id, direct_group_id: participant.direct_group_id, direct_round_number: participant.direct_round_number }));

  const handleTeamRenamed = async () => {
    setRenameTeam(null);
    showSuccess('Team renamed successfully');
    const teamsRes = await publicService.getTournamentTeams(id!);
    setTeams(teamsRes.data?.data || []);
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

  const participantActions: ParticipantRowActions = {
    onAccept: handleAcceptParticipant,
    onReject: handleRejectParticipant,
    onConfirm: handleConfirmParticipation,
    onRemove: handleRemoveParticipant,
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

  return (
    <MainLayout showUserProfileNav={false}><div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
      <div className="flex justify-between items-center mb-8 pb-4 border-b-2 border-gray-300">
        <button data-help-id="action-back-to-tournaments" onClick={handleBackButton} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors">← {t('tournaments.back_to_tournaments')}</button>
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold text-gray-800">{tournament.name}</h1>
          <span 
            className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold"
            style={{ backgroundColor: getTournamentStatusColor(tournament.status) }}
          >
            {statusLabel(t, tournament.status)}
          </span>
        </div>
      </div>

      {error && <p className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded mb-6">{error}</p>}
      <FormatIssueList issues={formatIssues} definition={editData.format_definition} />
      {success && <p className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded mb-6">{success}</p>}

      <div data-help-id="region-tournament-details-summary" className="bg-white rounded-lg shadow-lg p-8 mb-8">
        <TournamentOrganizersPanel
          tournament={tournament}
          organizers={organizers}
          currentUserId={userId}
          onOrganizersChange={setOrganizers}
          onSuccess={showSuccess}
          onError={setError}
        />
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
          <p><strong>{t('label_scheduled_start_date', 'Planned Start')}:</strong> {formatTournamentDate(t, tournament.scheduled_start_at)}</p>
        )}
        <p><strong>{t('tournament.mode', 'Tournament Mode')}:</strong> {tournamentModeLabel(tournament.tournament_mode)}</p>
        <p><strong>{t('label_max_participants')}:</strong> {tournament.max_participants || t('unlimited')}</p>
        <p><strong>{t('label_created')}:</strong> {formatTournamentDate(t, tournament.created_at)}</p>
        {tournament.started_at && <p><strong>{t('label_started')}:</strong> {formatTournamentDate(t, tournament.started_at)}</p>}
        {tournament.finished_at && <p><strong>{t('label_finished')}:</strong> {formatTournamentDate(t, tournament.finished_at)}</p>}
        <TournamentRulesPanel
          key={tournament.id}
          tournament={tournament}
          rulesHistory={rulesHistory}
          canEdit={isOrganizer && !isTournamentCompleted}
          onSaved={fetchTournamentData}
          onSuccess={showSuccess}
          onError={setError}
        />
      </div>

      <TournamentFormatSummary
        tournament={tournament}
        factions={unrankedFactions}
        maps={unrankedMaps}
        format={editData.format_definition}
      />

      {!editMode && ['registration_open', 'registration_closed'].includes(tournament.status) && directPassFormat && (
        <TournamentCompositionPreview
          format={directPassFormat}
          entries={compositionEntries}
        />
      )}

      <TournamentActionsBar
        tournament={tournament}
        canRequestJoin={!editMode && tournament.status === 'registration_open' && !isUserInTournament && Boolean(userId)}
        joinBlockedByRankedSetting={tournament.tournament_mode === 'ranked' && !enableRanked}
        joinLoading={isJoinRequestLoading}
        isOrganizer={isOrganizer && !editMode}
        editReady={assetsLoaded}
        onJoin={handleJoinTournament}
        onEdit={() => setEditMode(true)}
        onCloseRegistration={handleCloseRegistration}
        onPrepare={handlePrepareAndStart}
        onStart={handleStartTournament}
        onCancel={handleCancelTournament}
      />

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
          onCancel={() => { setEditMode(false); setFormatIssues([]); }}
          entryOptions={(tournament?.tournament_mode === 'team' ? teams : participants).map(entry => ({ id: entry.id, name: entry.nickname }))}
        />
      )}

      {userParticipationStatus === 'pending' && (
        <p className="text-orange-600">⏳ {t('join_pending_msg')}</p>
      )}

      {userParticipationStatus === 'denied' && (
        <p className="text-red-600">❌ {t('join_denied_msg')}</p>
      )}

      <TournamentDetailTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        participantsLabel={tournament.tournament_mode === 'team' ? 'Teams' : t('tabs.participants', { count: participants.length })}
        competitionFilters={competitionFilters}
        onCompetitionFiltersChange={setCompetitionFilters}
        onRefresh={refreshActiveTab}
      />

      {activeTab === 'participants' && (
        <div className="mb-8 mt-6">
          {tournament?.tournament_mode === 'team' ? (
            <TournamentTeamsList
              tournament={tournament}
              teams={teams}
              currentUserId={userId}
              userTeamId={userTeamId}
              isOrganizer={isOrganizer}
              canManageParticipants={canManageParticipants}
              directPass={directPass}
              actions={participantActions}
              onRename={(team) => setRenameTeam({ id: team.id, name: team.nickname })}
              onSubstitute={(team) => setReplacement({ teamId: team.id, teamMembers: team.members_with_elo || [] })}
            />
          ) : (
            <TournamentParticipantsTable
              tournament={tournament}
              participants={participants}
              currentUserId={userId}
              isOrganizer={isOrganizer}
              canManageParticipants={canManageParticipants}
              directPass={directPass}
              actions={participantActions}
            />
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
            onScheduleGame={(game) => openSeriesSchedule(game.series_id)}
            highlightedSeriesId={highlightedSeriesId}
            highlightedGameId={highlightedCompetitionGameId}
            matchFilter={competitionFilters.matchFilter}
            showOnlyMine={competitionFilters.showOnlyMine}
            showPhasesGroups={competitionFilters.showPhasesGroups}
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
      {replacement && (
        <TeamReplacementModal
          tournamentId={tournament.id}
          teamId={replacement.teamId}
          isOpen
          teamMembers={replacement.teamMembers}
          onClose={() => setReplacement(null)}
          onSuccess={() => {
            setReplacement(null);
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
      {renameTeam && (
        <TeamRenameModal
          tournamentId={tournament.id}
          team={renameTeam}
          onClose={() => setRenameTeam(null)}
          onRenamed={handleTeamRenamed}
          onError={(message) => {
            setError(message);
            setTimeout(() => setError(''), 4000);
          }}
        />
      )}

      {/* Schedule Proposal Modal */}
      <ScheduleProposalModal
        isOpen={scheduleSeries !== null}
        tournamentId={scheduleSeries?.tournamentId || tournament.id}
        seriesId={scheduleSeries?.seriesId}
        initialParticipants={scheduleSeries?.initialParticipants}
        initialProposal={scheduleSeries?.initialProposal}
        initialViewingTimezone={scheduleSeries?.initialViewingTimezone}
        initialDisplayDateStart={scheduleSeries?.initialDisplayDateStart}
        initialScrollToHour={scheduleSeries?.initialScrollToHour}
        onClose={() => setScheduleSeries(null)}
        onSuccess={() => {
          setScheduleSeries(null);
          fetchTournamentData();
        }}
      />
    </div></MainLayout>
  );
};

export default TournamentDetail;
