import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { publicService, tournamentService, userService, api } from '../services/api';
import { tournamentSchedulingService } from '../services/tournamentSchedulingService';
import TournamentForm from '../components/TournamentForm';
import MatchConfirmationModal from '../components/MatchConfirmationModal';
import MatchDetailsModal from '../components/MatchDetailsModal';
import { TeamJoinModal } from '../components/TeamJoinModal';
import PlayerLink from '../components/PlayerLink';
import StarDisplay from '../components/StarDisplay';
import { ReplayConfirmationModal } from '../components/ReplayConfirmationModal';
import ScheduleProposalModal from '../components/ScheduleProposalModal';
import { TeamReplacementModal } from '../components/TeamReplacementModal';
import MarkdownPreview from '../components/MarkdownPreview';
import MainLayout from '../components/MainLayout';
import { SimulateJoinPanel } from '../components/TestSimulationControls';
import type { TournamentFormData, TournamentUpdatePayload } from '../types/tournament';
import TournamentCompetitionView from '../components/TournamentCompetitionView';
import TournamentOverallStandings from '../components/TournamentOverallStandings';

// Helper function to extract parsed replay data from JSON summary
function parseReplaySummary(summaryJson: string | null): {
  winnerName: string | null;
  loserName: string | null;
  map: string | null;
  winnerFaction: string | null;
  loserFaction: string | null;
  winnerSide: number | null;
  winnerTeamName: string | null;
  loserTeamName: string | null;
  winnerTeamFactions: string[] | null;
  loserTeamFactions: string[] | null;
  wmlTeams: Record<string, string> | null;
  detectedTeams: Record<string, any> | null;
} {
  const empty = {
    winnerName: null,
    loserName: null,
    map: null,
    winnerFaction: null,
    loserFaction: null,
    winnerSide: null,
    winnerTeamName: null,
    loserTeamName: null,
    winnerTeamFactions: null,
    loserTeamFactions: null,
    wmlTeams: null,
    detectedTeams: null,
  };
  
  if (!summaryJson) return empty;
  
  try {
    const summary = JSON.parse(summaryJson);
    const victory = summary.replayVictory;
    const detectedTeams = summary.detectedTeams || null;
    const wmlTeams = summary.wmlTeams || {};
    
    let winnerTeamFactions: string[] | null = null;
    let loserTeamFactions: string[] | null = null;
    let winnerTeamName: string | null = null;
    let loserTeamName: string | null = null;
    
    // If detectedTeams is available (team tournament), use it to get faction info
    if (detectedTeams && typeof detectedTeams === 'object') {
      // Find which team the winner belongs to
      let winnerTeam: any = null;
      let loserTeam: any = null;
      
      // Check each team to see if winner player is in their members
      Object.values(detectedTeams).forEach((team: any) => {
        if (team.members && Array.isArray(team.members) && team.members.includes(victory?.winner_name)) {
          winnerTeam = team;
        }
        if (team.members && Array.isArray(team.members) && team.members.includes(victory?.loser_name)) {
          loserTeam = team;
        }
      });
      
      if (winnerTeam) {
        winnerTeamName = winnerTeam.team_name;
        winnerTeamFactions = winnerTeam.factions || null;
      }
      
      if (loserTeam) {
        loserTeamName = loserTeam.team_name;
        loserTeamFactions = loserTeam.factions || null;
      }
    }
    
    return {
      winnerName: victory?.winner_name || null,
      loserName: victory?.loser_name || null,
      map: summary.finalMap || summary.forumMap || null,
      winnerFaction: victory?.winner_faction || null,
      loserFaction: victory?.loser_faction || null,
      winnerSide: victory?.winner_side || null,
      winnerTeamName,
      loserTeamName,
      winnerTeamFactions,
      loserTeamFactions,
      wmlTeams,
      detectedTeams,
    };
  } catch {
    return empty;
  }
}

// Get API URL for direct backend calls - matches RecentGamesTable pattern

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
  competition_model_version?: number;
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
  status: string | null;
  tournament_ranking: number;
  tournament_wins: number;
  tournament_losses: number;
  tournament_points: number;
  elo_rating: number;
  team_id?: string | null;
  team_position?: number | null;
  omp?: number;
  gwp?: number;
  ogp?: number;
  members_with_elo?: Array<{ participant_id: string; user_id: string; nickname: string; elo_rating: number; team_position: number; participation_status: string }>;
  member_user_ids?: string;
  team_size?: number;
  team_total_elo?: number;
  current_round?: number;
}

interface TournamentMatch {
  id: string;
  tournament_id: string;
  round_id: string;
  player1_id: string;
  player2_id: string;
  winner_id: string | null;
  match_id: string | null;
  match_status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'unconfirmed';
  played_at: string | null;
  created_at: string;
  updated_at?: string;
  round_number: number;
  player1_nickname: string;
  player2_nickname: string;
  winner_nickname: string | null;
  loser_nickname?: string;
  match_status_from_matches?: 'confirmed' | 'disputed' | 'reported' | 'unconfirmed' | 'cancelled' | null;
  winner_faction?: string;
  loser_faction?: string;
  is_team_mode?: boolean;
  map?: string;
  winner_comments?: string;
  loser_comments?: string;
  replay_file_path?: string;
  replay_downloads?: number;
  player1_rating?: number | null;
  player2_rating?: number | null;
  winner_rating?: number | null;
  loser_rating?: number | null;
  // Pending replay fields
  pending_replay_id?: string | null;
  pending_replay_summary?: string | null;
  pending_replay_confidence?: number;
  pending_replay_need_integration?: boolean;
  pending_replay_url?: string;
  pending_replay_filename?: string;
  pending_replay_game_name?: string;
  pending_replay_cancel_requested_by?: string | null;
  pending_replay_parse_status?: string;
  replay_url?: string;
  // Team members for mapping (team tournaments only)
  team1_members?: string[] | null;
  team2_members?: string[] | null;
}

const TournamentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { userId, user, enableRanked, isAdmin, isTournamentModerator, token } = useAuthStore();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<TournamentParticipant[]>([]);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [roundMatches, setRoundMatches] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
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
  const [matchConfirmationMap, setMatchConfirmationMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<'participants' | 'matches' | 'rounds' | 'roundMatches' | 'ranking' | 'competition' | 'tournamentStandings' | 'teams'>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'roundMatches' || tabParam === 'matches' || tabParam === 'rounds' || tabParam === 'ranking' || tabParam === 'competition' || tabParam === 'tournamentStandings' || tabParam === 'teams') {
      return tabParam;
    }
    return 'participants';
  });
  const [highlightedMatchId, setHighlightedMatchId] = useState<string | null>(searchParams.get('matchId'));
  const [highlightedSeriesId] = useState<string | null>(searchParams.get('seriesId'));
  const [myMatchesOnly, setMyMatchesOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'completed'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userParticipationStatus, setUserParticipationStatus] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [confirmMatchData, setConfirmMatchData] = useState<any>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [matchDetailsModal, setMatchDetailsModal] = useState<{ isOpen: boolean; match: TournamentMatch | null }>({ isOpen: false, match: null });
  const [disputeManagementModal, setDisputeManagementModal] = useState<{ isOpen: boolean; match: TournamentMatch | null }>({ isOpen: false, match: null });
  const [determineWinnerData, setDetermineWinnerData] = useState<any>(null);
  const [showDetermineWinnerModal, setShowDetermineWinnerModal] = useState(false);
  const [determineWinnerStep, setDetermineWinnerStep] = useState<1 | 2>(1);
  const [pendingWinnerSelection, setPendingWinnerSelection] = useState<string | null>(null);
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
    roundMatchId?: string;
    matchId?: string;
    player1_nickname?: string; 
    player2_nickname?: string;
    scheduled_datetime?: string;
    scheduled_status?: string;
    scheduled_by_player_id?: string;
    // Preloaded scheduling data
    initialParticipants?: any[];
    initialProposal?: any;
    initialViewingTimezone?: string;
    initialDisplayDateStart?: Date;
    initialScrollToHour?: number | null;
  }>({ isOpen: false });
  const [isLoadingScheduling, setIsLoadingScheduling] = useState(false);
  const [proposalCache, setProposalCache] = useState<Record<string, any>>({});
  const [userTimezone, setUserTimezone] = useState<string>('UTC');

    const [showReplayConfirmModal, setShowReplayConfirmModal] = useState(false);
  const [selectedTournamentReplay, setSelectedTournamentReplay] = useState<any>(null);
  const [replayModalChoice, setReplayModalChoice] = useState<'I won' | 'I lost' | 'cancel'>('I won');
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

  // Fetch user timezone once
  useEffect(() => {
    if (userId) {
      userService
        .getProfile()
        .then((res) => {
          if (res.data?.timezone) {
            setUserTimezone(res.data.timezone);
          }
        })
        .catch((err) => {
          console.warn('Could not fetch user timezone:', err);
          setUserTimezone('UTC');
        });
    }
  }, [userId]);

  const fetchTournamentData = async () => {
    try {
      setLoading(true);
      const [tournamentRes, participantsRes, organizersRes] = await Promise.all([
        publicService.getTournamentById(id!),
        publicService.getTournamentParticipants(id!),
        tournamentService.getTournamentOrganizers(id!),
      ]);

      setTournament(tournamentRes.data);
      if (Number(tournamentRes.data.competition_model_version) === 2) {
        // Phase-engine tournaments do not populate the legacy match, round,
        // or aggregate-ranking tables. Open their authoritative competition
        // view unless the caller explicitly requested Participants.
        const requestedTab = searchParams.get('tab');
        if (requestedTab === 'tournamentStandings') setActiveTab('tournamentStandings');
        else if (requestedTab !== 'participants') setActiveTab('competition');
      }
      console.log('📋 Tournament loaded:', {
        id: tournamentRes.data.id,
        name: tournamentRes.data.name,
        tournament_type: tournamentRes.data.tournament_type,
        tournament_mode: tournamentRes.data.tournament_mode
      });
      setParticipants(participantsRes.data || []);
      // Version 2 is authoritative in the phase-engine competition view;
      // legacy rounds, series aggregates, and match rows are no longer loaded.
      setMatches([]);
      setRoundMatches([]);
      setRounds([]);
      setOrganizers(organizersRes.data || []);
      
      // For team mode, extract user's team_id from standings
      if (tournamentRes.data.tournament_mode === 'team' && userId) {
        const userTeam = (participantsRes.data || []).find((p: any) =>
          p.member_user_ids && p.member_user_ids.includes(userId)
        );
        if (userTeam) {
          setUserTeamId(userTeam.id);
          console.log('🎯 User team found:', { teamId: userTeam.id, teamName: userTeam.nickname });
        }
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
        format_definition: Number(tournamentRes.data.competition_model_version) === 2
          ? (await api.get(`/tournaments/${id}/format`)).data
          : undefined,
      });
      
      // Check user's participation status
      if (userId) {
        const userParticipant = (participantsRes.data || []).find((p: TournamentParticipant) => p.user_id === userId);
        setUserParticipationStatus(userParticipant?.participation_status || null);
      }

      setError('');
    } catch (err: any) {
      console.error('Error fetching tournament:', err);
      setError(t('error_loading_tournament'));
    } finally {
      setLoading(false);
    }
  };

  const handlePreloadSchedulingData = async (roundMatchId: string, isRoundMatch: boolean, matchId?: string, isSeries = false) => {
    try {
      setIsLoadingScheduling(true);
      const targetId = roundMatchId || matchId;
      if (!targetId) {
        throw new Error('Match identifier is required to load scheduling data');
      }

      const [availRes, proposalRes] = await Promise.all([
        isSeries
          ? tournamentSchedulingService.getSeriesParticipantsAvailability(id!, targetId)
          : isRoundMatch
          ? tournamentSchedulingService.getRoundMatchParticipantsAvailability(id!, targetId)
          : tournamentSchedulingService.getMatchParticipantsAvailability(id!, targetId),
        isSeries
          ? tournamentSchedulingService.getSeriesProposal(id!, targetId)
          : isRoundMatch
          ? tournamentSchedulingService.getRoundMatchProposal(id!, targetId)
          : tournamentSchedulingService.getMatchProposal(id!, targetId)
      ]);

      const participants = availRes.participants || [];
      const viewingTimezone = availRes.viewing_timezone || 'UTC';

      const proposal = proposalRes.proposal || null;

      // Cache the proposal for display
      if (proposal) {
        const cacheKey = targetId;
        let displaySlots: any[] = [];
         
        if (proposal.status === 'pending') {
          displaySlots = proposal.slots?.filter((s: any) => s.status === 'pending') || [];
        } else if (proposal.status === 'confirmed') {
          displaySlots = proposal.slots?.filter((s: any) => s.status === 'confirmed') || [];
        }
         
        const cachedProposal = {
          ...proposal,
          displaySlots,
          allSlots: proposal.slots || []
        };
        setProposalCache(prev => ({ ...prev, [cacheKey]: cachedProposal }));
      }

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
        seriesId: isSeries ? targetId : undefined,
        roundMatchId: isRoundMatch ? roundMatchId : undefined,
        matchId: !isRoundMatch ? matchId : undefined,
        initialParticipants: participants,
        initialProposal: proposal,
        initialViewingTimezone: viewingTimezone,
        initialDisplayDateStart: displayDateStart,
        initialScrollToHour: scrollToHour
      });
    } catch (err) {
      console.error('Error preloading scheduling data:', err);
      setError('Failed to load scheduling data');
    } finally {
      setIsLoadingScheduling(false);
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
        await tournamentService.requestJoinTournament(id!);
        setSuccess(t('success_join_request_sent'));
        setUserParticipationStatus('pending');
        // Refresh the page after 2 seconds
        setTimeout(() => {
          fetchTournamentData();
        }, 2000);
      } catch (err: any) {
        setError(err.response?.data?.error || t('error_failed_join_tournament'));
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

  // Handle scrolling to highlighted match when roundMatches tab is active
  useEffect(() => {
    if (activeTab === 'roundMatches' && highlightedMatchId && roundMatches.length > 0) {
      console.log('🔍 Looking for match:', highlightedMatchId, 'with roundMatches:', roundMatches.length);
      
      // Increased delay to ensure rendering is complete and DOM is ready
      const timer = setTimeout(() => {
        const matchElement = document.getElementById(`match-${highlightedMatchId}`);
        if (matchElement) {
          console.log('✅ Found match element, scrolling...');
          
          // Try to scroll to element with smooth behavior
          matchElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Also try to find and scroll any parent overflow containers
          let scrollParent = matchElement.parentElement;
          while (scrollParent) {
            const hasOverflow = window.getComputedStyle(scrollParent).overflow;
            if (hasOverflow && (hasOverflow === 'auto' || hasOverflow === 'scroll' || hasOverflow === 'overlay')) {
              console.log('📍 Found scrollable parent, adjusting scroll');
              const rect = matchElement.getBoundingClientRect();
              const parentRect = scrollParent.getBoundingClientRect();
              
              // Calculate scroll position
              const scrollTop = scrollParent.scrollTop + (rect.top - parentRect.top) - (parentRect.height / 2) + (rect.height / 2);
              scrollParent.scrollTop = scrollTop;
              break;
            }
            scrollParent = scrollParent.parentElement;
          }
          
          console.log('🎯 Scrolled to match:', highlightedMatchId);
        } else {
          // Try alternative: check if it exists in DOM
          const allMatches = document.querySelectorAll('[id^="match-"]');
          console.warn('⚠️ Match element not found. Total match elements in DOM:', allMatches.length);
          allMatches.forEach(m => console.log('  - Found:', m.id));
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [activeTab, highlightedMatchId, roundMatches.length]);

  useEffect(() => {
    if (activeTab !== 'competition' || !highlightedSeriesId) return;
    const timer = setTimeout(() => {
      document.getElementById(`series-${highlightedSeriesId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 500);
    return () => clearTimeout(timer);
  }, [activeTab, highlightedSeriesId]);

  const handleTeamJoinSubmit = async (teamName: string, teammateName: string) => {
    try {
      setJoiningTeamLoading(true);
      setError('');
      
      await tournamentService.requestJoinTournament(id!, {
        team_name: teamName,
        teammate_name: teammateName
      });
      
      setSuccess(t('success_join_request_sent'));
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

const handleDownloadReplay = async (matchId: string | null, replayFilePath: string | null | undefined, tournamentMatchId?: string) => {
  try {
    if (!replayFilePath) return;
    const filename = replayFilePath.split('/').pop() || `replay_${matchId || 'tournament'}`;
    
    // Increment download counts
    if (matchId) {
      // For ranked tournaments (with match_id), increment from matches endpoint
      try {
        await api.post(`/matches/${matchId}/replay/download-count`);
      } catch (e) {
        console.error('Failed to increment download count:', e);
      }
    } else {
      // For unranked/team tournaments (no match_id), increment from tournament endpoint
      if (tournamentMatchId) {
        try {
          await api.post(`/public/tournament-matches/${tournamentMatchId}/replay/download-count`);
        } catch (e) {
          console.error('Failed to increment tournament download count:', e);
        }
      }
    }
    
    // Use the replay_file_path HTTPS URL directly
    const link = document.createElement('a');
    link.href = replayFilePath;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('Error downloading replay:', err);
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

  // Fetch confidence=1 replays matching open tournament matches
    const handleOpenReplayModal = (replay: any, choice: 'I won' | 'I lost' | 'cancel') => {
    setSelectedTournamentReplay(replay);
    setReplayModalChoice(choice);
    setShowReplayConfirmModal(true);
  };

  const handleReplayConfirmSuccess = () => {
    setShowReplayConfirmModal(false);
    setSelectedTournamentReplay(null);
    setSuccess(t('success_match_reported'));
    // Add a small delay to ensure server has processed the confirmation
    setTimeout(() => {
      fetchTournamentData();
    }, 500);
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleOpenConfirmModal = (match: TournamentMatch) => {
    setConfirmMatchData(match);
    setShowConfirmModal(true);
  };

  const handleCloseConfirmModal = () => {
    setShowConfirmModal(false);
    setConfirmMatchData(null);
  };

  const handleConfirmSuccess = () => {
      setSuccess(t('success_match_confirmed'));
    handleCloseConfirmModal(); // Close the modal
    fetchTournamentData();
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleDisputeAction = async (action: 'confirm' | 'dismiss', matchId: string) => {
    try {
      console.log(`[DISPUTE] Calling API with action: ${action}, matchId: ${matchId}`);
      await api.post(`/tournaments/${id}/matches/${matchId}/dispute`, { action });
      setSuccess(action === 'confirm' ? t('dispute_confirmed') : t('dispute_dismissed'));
      setDisputeManagementModal({ isOpen: false, match: null });
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error(`[DISPUTE ERROR]`, err);
      setError(err.response?.data?.error || (action === 'confirm' ? t('error_confirming_dispute') : t('error_dismissing_dispute')));
    }
  };

  const handleDetermineWinner = async (winnerId: string, eliminate: boolean) => {
    try {
      if (!determineWinnerData) return;
      
      await tournamentService.determineMatchWinner(id!, determineWinnerData.id, { winner_id: winnerId, eliminate });
      setSuccess(t('success_match_winner_determined'));
      setShowDetermineWinnerModal(false);
      setDetermineWinnerData(null);
      setDetermineWinnerStep(1);
      setPendingWinnerSelection(null);
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('error_failed_determine_winner'));
    }
  };

  const handleDetermineWinnerStep1 = (winnerId: string) => {
    if (!tournament) return;
    const isEliminationType = tournament.tournament_type === 'elimination';
    const isEliminationPhase =
      tournament.tournament_type === 'swiss_elimination' &&
      determineWinnerData?.round_type === 'final';
    if (isEliminationType || isEliminationPhase) {
      // Elimination: skip step 2, always eliminate
      handleDetermineWinner(winnerId, true);
    } else {
      // League / Swiss / Swiss_elimination general phase: go to step 2
      setPendingWinnerSelection(winnerId);
      setDetermineWinnerStep(2);
    }
  };

  const handleStartNextRound = async (currentRoundNumber: number) => {
    try {
      // For Swiss/Swiss-Elimination tournaments in general phase, calculate tiebreakers first
      if (tournament && (tournament.tournament_type === 'swiss' || tournament.tournament_type === 'swiss_elimination')) {
        // Check if we're in general phase (not final elimination phase)
        const currentRound = rounds.find(r => r.round_number === currentRoundNumber);
        if (currentRound && currentRound.round_type === 'general') {
          console.log('🎲 Calculating tiebreakers before generating Swiss pairings...');
          await tournamentService.calculateTournamentTiebreakers(id!);
        }
      }

      await tournamentService.startNextRound(id!);

      setSuccess(t('success_round_started', { number: currentRoundNumber + 1 }));
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || t('error_failed_start_next_round'));
    }
  };

  const handleRecalculateTiebreakers = async () => {
    try {
      setError('');
      await tournamentService.calculateTournamentTiebreakers(id!);
      setSuccess(t('tournaments.tiebreakers_recalculated', 'Tiebreakers recalculated successfully'));
      fetchTournamentData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || t('error_recalculate_tiebreakers', 'Failed to recalculate tiebreakers'));
    }
  };

  const handleNotifyResults = async () => {
    try {
      setError('');
      console.log('📢 Notifying tournament results...');
      await api.post(`/tournaments/${id}/notify-results`);
      setSuccess(t('tournaments.results_notified', 'Results notified successfully'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || t('error_notify_results', 'Failed to notify results'));
    }
  };

  const openDetermineWinnerModal = (match: any) => {
    setDetermineWinnerData(match);
    setDetermineWinnerStep(1);
    setPendingWinnerSelection(null);
    setShowDetermineWinnerModal(true);
  };

  const closeDetermineWinnerModal = () => {
    setShowDetermineWinnerModal(false);
    setDetermineWinnerData(null);
    setDetermineWinnerStep(1);
    setPendingWinnerSelection(null);
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

  // Get team members from participants array by team ID
  const getTeamMembersString = (teamId: string): string => {
    const teamParticipant = participants.find((p: any) => p.id === teamId);
    if (!teamParticipant) return '';
    
    // Only return members if this is actually a team (members_with_elo is an array)
    if (teamParticipant.members_with_elo && Array.isArray(teamParticipant.members_with_elo) && teamParticipant.members_with_elo.length > 0) {
      const members = teamParticipant.members_with_elo
        .filter((m: any) => m && typeof m === 'object' && m.nickname)
        .map((m: any) => m.nickname)
        .join(', ');
      return members || '';
    }
    return '';
  };

  const isOrganizer = Boolean(userId && organizers.some((organizer) => organizer.user_id === userId));
  const isPrimaryOrganizer = Boolean(userId && tournament?.creator_id === userId);
  const isAcceptedParticipant = userParticipationStatus === 'accepted';
  const canManageParticipants = isOrganizer || isAdmin || isTournamentModerator;
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

  const canScheduleMatch = (match: any): boolean => {
    // User must be one of the match participants
    if (match.is_team_mode) {
      // Team tournament: check if user's team is one of the participants
      return userTeamId === match.player1_id || userTeamId === match.player2_id;
    } else {
      // 1v1 tournament: check if user is one of the players
      return userId === match.player1_id || userId === match.player2_id;
    }
  };

  const getScheduleStatus = (match: any): { status: 'no_schedule' | 'awaiting_confirmation' | 'confirmed'; datetime?: string; isUserProposer?: boolean } => {
    // Use schedule data from roundMatches directly
    if (!match || !match.scheduled_status || match.scheduled_status === 'pending') {
      return { status: 'no_schedule' };
    }
    
    if (match.scheduled_status === 'confirmed') {
      return { status: 'confirmed', datetime: match.scheduled_datetime };
    }
    
    // Status is not pending and not confirmed, so it's awaiting confirmation
    const isProposer = match.scheduled_by_player_id === userId;
    return {
      status: 'awaiting_confirmation',
      datetime: match.scheduled_datetime,
      isUserProposer: isProposer
    };
  };

  // No longer needed - schedule data comes from roundMatches endpoint
  const loadAllMatchSchedules = async (matchIds: string[]) => {
    // This function is now deprecated - schedule data is included in roundMatches
    console.log('📌 Schedule data is loaded from phase-engine series endpoints');
  };

  // Helper to get proposal and filter slots based on proposal status
  const getProposalWithSlots = async (matchId: string, roundMatchId?: string) => {
    try {
      const cacheKey = roundMatchId || matchId;
      
      // Check cache first
      if (proposalCache[cacheKey]) {
        return proposalCache[cacheKey];
      }

      // Fetch from API
      const proposalRes = roundMatchId
        ? await tournamentSchedulingService.getRoundMatchProposal(tournament?.id || id!, roundMatchId)
        : await tournamentSchedulingService.getMatchProposal(tournament?.id || id!, matchId);

      const proposal = proposalRes.proposal;
      if (!proposal) return null;

      // Filter slots based on proposal status
      let displaySlots: any[] = [];
      if (proposal.status === 'pending') {
        // Show only pending slots
        displaySlots = proposal.slots?.filter((s: any) => s.status === 'pending') || [];
      } else if (proposal.status === 'confirmed') {
        // Show only confirmed slots
        displaySlots = proposal.slots?.filter((s: any) => s.status === 'confirmed') || [];
      } else if (proposal.status === 'rejected') {
        // Don't show rejected proposals
        displaySlots = [];
      }

      const proposalData = {
        ...proposal,
        displaySlots,
        allSlots: proposal.slots || [],
        userTimezone
      };

      // Cache it
      setProposalCache(prev => ({ ...prev, [cacheKey]: proposalData }));
      return proposalData;
    } catch (err) {
      console.error('Error loading proposal with slots:', err);
      return null;
    }
  };

  // Pre-load proposals for all matches with confirmed or pending schedules
  const preloadProposals = async (roundMatches: any[]) => {
    const matchesToLoad = roundMatches.filter(m => 
      m.scheduled_status === 'confirmed' || (m.scheduled_status && m.scheduled_status !== 'pending')
    );

    if (matchesToLoad.length === 0) return;

    console.log(`📋 Pre-loading proposals for ${matchesToLoad.length} scheduled matches...`);
    
    // Load proposals in parallel (up to 5 at a time)
    for (let i = 0; i < matchesToLoad.length; i += 5) {
      const batch = matchesToLoad.slice(i, i + 5);
      await Promise.all(
        batch.map(m => getProposalWithSlots(m.id, m.id))
      );
    }
  };

  // Helper to format a date in a specific timezone
  const formatDateInTimezone = (date: Date, timezone: string, includeTime: boolean = true) => {
    const formatter = new Intl.DateTimeFormat('es-ES', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(includeTime && { hour: '2-digit', minute: '2-digit' })
    });
    return formatter.format(date);
  };

  // Helper to render schedule slots for a match
  const renderScheduleSlots = (proposal: any) => {
    if (!proposal || !proposal.displaySlots || proposal.displaySlots.length === 0) {
      return null;
    }

    const slots = proposal.displaySlots;
    const timezone = proposal.userTimezone || userTimezone || 'UTC';
    
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
      // Add final range
      const endTime = new Date(currentEnd.getTime() + 30 * 60 * 1000);
      ranges.push({ start: currentStart, end: endTime });
    }

    // Show ranges in single line format
    if (ranges.length === 1) {
      const range = ranges[0];
      const startStr = formatDateInTimezone(range.start, timezone, true);
      const endFormatter = new Intl.DateTimeFormat('es-ES', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit'
      });
      const endStr = endFormatter.format(range.end);
      return (
        <span className="text-xs text-gray-600">
          {startStr} - {endStr}
        </span>
      );
    }

    // Multiple ranges
    return (
      <div className="flex flex-col gap-1">
        {ranges.map((range: any, idx: number) => {
          const startStr = formatDateInTimezone(range.start, timezone, true);
          const endFormatter = new Intl.DateTimeFormat('es-ES', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit'
          });
          const endStr = endFormatter.format(range.end);
          return (
            <span key={idx} className="text-xs text-gray-600">
              {startStr} - {endStr}
            </span>
          );
        })}
      </div>
    );
  };

  const handleRenameTeam = async () => {
    if (!renameTeamValue.trim() || !tournament) return;
    setRenameTeamLoading(true);
    try {
      await tournamentService.renameTeam(tournament.id, renameTeamModal.teamId, renameTeamValue.trim());
      setSuccess('Team renamed successfully');
      setTimeout(() => setSuccess(''), 3000);
      setRenameTeamModal({ open: false, teamId: '', currentName: '' });
      // Refresh participants to reflect the new name
      const participantsRes = await publicService.getTournamentParticipants(tournament.id);
      setParticipants(participantsRes.data || []);
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
      // Refresh participants
      const participantsRes = await publicService.getTournamentParticipants(tournament.id);
      setParticipants(participantsRes.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to remove participant');
      setTimeout(() => setError(''), 4000);
    }
  };

  if (loading) {
    return <MainLayout><div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200"><p>{t('loading')}</p></div></MainLayout>;
  }

  if (!tournament) {
    return (
      <MainLayout><div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
        <p>{error || t('tournament_title')}</p>
        <button data-help-id="action-back-to-tournaments" onClick={() => navigate('/tournaments')}>{t('tournaments.back_to_tournaments')}</button>
      </div></MainLayout>
    );
  }

  const usesPhaseEngine = Number(tournament.competition_model_version) === 2;
  const phaseDefinition = editData.format_definition;

  return (
    <MainLayout><div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
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
        <p><strong>{t('tournament.col_type')}:</strong> {usesPhaseEngine ? 'Flexible phases' : tournament.tournament_type}</p>
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
        <div className="mt-4">
          <strong>{t('label_description')}:</strong>
          <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
            <MarkdownPreview
              markdown={tournament.description || ''}
              emptyMessage={t('tournament.description_preview_empty', 'No description configured for this tournament.')}
            />
          </div>
        </div>
        <div className="mt-4">
          <strong>{t('tournament.rules_content', 'Tournament Rules')}:</strong>
          <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
            <MarkdownPreview
              markdown={tournament.rules_content || ''}
              emptyMessage={t('tournament.rules_preview_empty', 'No rules configured for this tournament.')}
            />
          </div>
        </div>
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
        {usesPhaseEngine ? (
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
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="flex flex-col gap-2">
            <strong className="font-semibold text-gray-700">{t('label_round_duration')}:</strong> <span className="text-gray-600">{tournament.round_duration_days} {t('label_days')}</span>
          </div>
          {tournament.tournament_type !== 'league' && (
            <div className="flex flex-col gap-2">
              <strong className="font-semibold text-gray-700">{t('label_auto_advance_rounds')}:</strong> <span className="text-gray-600">{tournament.auto_advance_round ? t('yes') : t('no')}</span>
            </div>
          )}

          {/* For swiss_elimination tournaments, show structured information */}
          {tournament.tournament_type === 'swiss_elimination' ? (
            <>
              <div className="flex flex-col gap-2">
                <strong className="font-semibold text-gray-700">{t('tournament.number_swiss_rounds', 'Swiss Rounds')}:</strong> <span className="text-gray-600">{tournament.general_rounds}</span>
              </div>
              <div className="flex flex-col gap-2">
                <strong className="font-semibold text-gray-700">{t('tournament.number_elimination_rounds', 'Elimination Rounds')}:</strong> <span className="text-gray-600">{tournament.final_rounds}</span>
              </div>
              <div className="flex flex-col gap-2">
                <strong className="font-semibold text-gray-700">{t('tournament.general_format', 'General Format (Swiss + Elimination except Final)')}:</strong> <span className="text-gray-600">{t('match_format.' + tournament.general_rounds_format)}</span>
              </div>
              <div className="flex flex-col gap-2">
                <strong className="font-semibold text-gray-700">{t('tournament.final_format', 'Final Format (Grand Final)')}:</strong> <span className="text-gray-600">{t('match_format.' + tournament.final_rounds_format)}</span>
              </div>
              <div className="flex flex-col gap-2" style={{ gridColumn: '1 / -1' }}>
                <strong className="font-semibold text-gray-700">{t('tournament.tournament_structure', 'Tournament Structure')}:</strong>
                <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                  <li>{t('tournament.swiss_phase', 'Swiss Phase')}: {tournament.general_rounds} {t('tournament.rounds', 'rounds')} ({t('match_format.' + tournament.general_rounds_format)})</li>
                  {tournament.final_rounds > 1 && (
                    <li>{t('tournament.qualification_phase', 'Qualification Phase')}: {tournament.final_rounds - 1} {t('tournament.rounds', 'rounds')} ({t('match_format.' + tournament.general_rounds_format)})</li>
                  )}
                  <li>{t('tournament.grand_final', 'Grand Final')}: 1 {t('tournament.round', 'round')} ({t('match_format.' + tournament.final_rounds_format)})</li>
                </ul>
              </div>
            </>
          ) : (
            <>
              {/* For other tournament types, show standard fields */}
              <div className="flex flex-col gap-2">
                <strong className="font-semibold text-gray-700">{t('label_general_rounds')}:</strong> <span className="text-gray-600">{tournament.general_rounds}</span>
              </div>
              <div className="flex flex-col gap-2">
                <strong className="font-semibold text-gray-700">{t('label_general_rounds_format')}:</strong> <span className="text-gray-600">{t('match_format.' + tournament.general_rounds_format)}</span>
              </div>
              {tournament.final_rounds > 0 && (
                <>
                  <div className="flex flex-col gap-2">
                    <strong className="font-semibold text-gray-700">{t('label_final_rounds')}:</strong> <span className="text-gray-600">{tournament.final_rounds}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <strong className="font-semibold text-gray-700">{t('label_final_rounds_format')}:</strong> <span className="text-gray-600">{t('match_format.' + tournament.final_rounds_format)}</span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        )}
      </div>

      {/* Tournament Actions Section */}
      <div className="flex flex-row flex-wrap gap-3 items-center justify-between mb-6">
        {/* Join button (only if logged in and NOT in edit mode) - Left side */}
        {!editMode && tournament.status === 'registration_open' && !userParticipationStatus && userId && (
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
            <button data-help-id="action-join-tournament" className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors" onClick={handleJoinTournament}>
              {t('tournaments.request_join')}
            </button>
          )
        )}
        {(!tournament.status || tournament.status !== 'registration_open' || userParticipationStatus || !userId || editMode) && !isOrganizer && (
          <div></div>
        )}

        {/* Organizer Controls - Right side */}
        {isOrganizer && !editMode && (
          <div className="flex flex-wrap gap-3">
            {tournament.status !== 'prepared' && tournament.status !== 'in_progress' && tournament.status !== 'finished' && (
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

            {(tournament.status === 'in_progress' || tournament.status === 'finished') && isOrganizer && (
              <div className="flex items-center gap-3">
                {tournament.status === 'in_progress' && (
                  <p className="text-green-600">✓ {t('tournaments.started_locked')}</p>
                )}
                {!usesPhaseEngine && <button
                  data-help-id="action-recalculate-tiebreakers"
                  onClick={handleRecalculateTiebreakers}
                  className="px-6 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors"
                  title={t('tournaments.btn_recalculate_tiebreakers_tooltip', 'Recalculate OMP, GWP, OGP for all participants')}
                >
                  {t('tournaments.btn_recalculate_tiebreakers')}
                </button>}
                {!usesPhaseEngine && <button
                  data-help-id="action-notify-tournament-results"
                  onClick={handleNotifyResults}
                  className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  title={t('tournaments.btn_notify_results_tooltip', 'Send standings or results to Discord')}
                >
                  {t('tournaments.btn_notify_results')}
                </button>}
              </div>
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
      {isOrganizer && editMode && tournament.status !== 'in_progress' && (
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
          entryOptions={participants.map(participant => ({ id: participant.id, name: participant.nickname }))}
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
          {!usesPhaseEngine && <button
            data-help-id="action-tab-matches"
            className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'matches' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
            onClick={() => setActiveTab('matches')}
          >
            {t('tabs.matches', { count: matches.length })}
          </button>}
          {!usesPhaseEngine && <button
            data-help-id="action-tab-rounds"
            className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'rounds' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
            onClick={() => setActiveTab('rounds')}
          >
            {t('tabs.rounds', { count: rounds.length })}
          </button>}
          {!usesPhaseEngine && <button
            data-help-id="action-tab-round-details"
            className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'roundMatches' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
            onClick={() => setActiveTab('roundMatches')}
          >
            {t('tabs.round_details')}
          </button>}
          {!usesPhaseEngine && <button
            data-help-id="action-tab-ranking"
            className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'ranking' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
            onClick={() => setActiveTab('ranking')}
          >
            {t('tabs.ranking')}
          </button>}
          {usesPhaseEngine && (
            <button
              data-help-id="action-tab-tournament-standings"
              className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'tournamentStandings' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
              onClick={() => setActiveTab('tournamentStandings')}
            >
              Tournament Standings
            </button>
          )}
          {usesPhaseEngine && (
            <button
              data-help-id="action-tab-competition"
              className={`px-4 py-2 rounded font-semibold cursor-pointer transition-all ${activeTab === 'competition' ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
              onClick={() => setActiveTab('competition')}
            >
              Competition
            </button>
          )}
          
          {/* Refresh button */}
          <button
            data-help-id="action-refresh-tournament-detail"
            onClick={() => {
              setIsRefreshing(true);
              fetchTournamentData().finally(() => setIsRefreshing(false));
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

        {/* Filter options for Matches and Round Details tabs */}
        {(activeTab === 'matches' || activeTab === 'roundMatches') && (
          <div className="flex flex-wrap gap-4 items-center bg-gray-50 p-3 rounded border border-gray-200">
            {/* My Matches toggle — only shown when logged in */}
            {userId && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  data-help-id="option-filter-my-matches"
                  type="checkbox"
                  checked={myMatchesOnly}
                  onChange={(e) => setMyMatchesOnly(e.target.checked)}
                  className="cursor-pointer w-4 h-4"
                />
                <span className="text-sm font-medium text-gray-700">{t('common.my_matches')}</span>
              </label>
            )}
            {/* Status filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">{t('common.filter_status')}:</span>
              <div className="flex gap-3">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    data-help-id="option-filter-all-matches"
                    type="radio"
                    name="statusFilter"
                    value="all"
                    checked={statusFilter === 'all'}
                    onChange={() => setStatusFilter('all')}
                    className="cursor-pointer"
                  />
                  <span className="text-sm text-gray-700">{t('common.show_all')}</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    data-help-id="option-filter-scheduled-matches"
                    type="radio"
                    name="statusFilter"
                    value="scheduled"
                    checked={statusFilter === 'scheduled'}
                    onChange={() => setStatusFilter('scheduled')}
                    className="cursor-pointer"
                  />
                  <span className="text-sm text-gray-700">{t('common.filter_scheduled')}</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    data-help-id="option-filter-completed-matches"
                    type="radio"
                    name="statusFilter"
                    value="completed"
                    checked={statusFilter === 'completed'}
                    onChange={() => setStatusFilter('completed')}
                    className="cursor-pointer"
                  />
                  <span className="text-sm text-gray-700">{t('common.filter_completed')}</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {activeTab === 'participants' && (
        <div className="mb-8 mt-6">
          {tournament?.tournament_mode === 'team' ? (
            // Team view: Group participants by team from standings (which has team_total_elo and members_with_elo)
            participants.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {participants
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
                      {!usesPhaseEngine && <div className="flex gap-6 items-center flex-wrap">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-gray-600 font-semibold uppercase tracking-wider">{t('label_wins')}</span>
                          <span className="text-lg font-semibold text-gray-800">{team.tournament_wins || 0}</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-gray-600 font-semibold uppercase tracking-wider">{t('label_losses')}</span>
                          <span className="text-lg font-semibold text-gray-800">{team.tournament_losses || 0}</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-gray-600 font-semibold uppercase tracking-wider">{t('label_points')}</span>
                          <span className="text-lg font-semibold text-gray-800">{team.tournament_points || 0}</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-gray-600 font-semibold uppercase tracking-wider">{t('label_status')}</span>
                          <span 
                            className="inline-block px-2 py-1 text-white rounded-full text-xs font-semibold"
                            style={{ 
                              backgroundColor: team.status === 'eliminated' ? '#dc3545' : '#28a745'
                            }}
                          >
                            {team.status === 'eliminated' ? 'Eliminated' : 'Active'}
                          </span>
                        </div>
                      </div>}
                    </div>
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
                    {!usesPhaseEngine && <>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_classification')}</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_wins')}</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_losses')}</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_points')}</th>
                    </>}
                    {(isOrganizer || canManageParticipants || userId) && tournament?.status === 'registration_open' && <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_actions')}</th>}
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
                      {!usesPhaseEngine && <>
                        <td className="px-4 py-3 text-gray-700">
                          <span className="inline-block px-2 py-1 bg-gray-100 rounded text-xs">
                            {p.status ? (p.status === 'active' ? '✓ ' + t('label_active') : '✗ ' + t('label_eliminated')) : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{p.tournament_wins}</td>
                        <td className="px-4 py-3 text-gray-700">{p.tournament_losses}</td>
                        <td className="px-4 py-3 text-gray-700">{p.tournament_points}</td>
                      </>}
                      {tournament?.status === 'registration_open' && (
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

      {activeTab === 'matches' && (
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8 mt-6">
          {tournament?.status !== 'in_progress' && tournament?.status !== 'finished' ? (
            <p className="bg-gray-100 text-gray-700 text-center py-8 px-4 rounded">{t('matches_will_be_generated')}</p>
          ) : (
            <>
            {/* Scheduled Matches Section */}
            {statusFilter !== 'completed' && (
            <div className="mb-8">
              <h3 className="text-2xl font-bold text-gray-800 mb-4 pb-3 border-b-2 border-blue-500">{t('matches.scheduled')}</h3>
              {rounds.length > 0 ? (
                  <>
                    {rounds.map((round) => {
                      const rawScheduled = matches
                        .filter((m) => {
                          if (m.round_id !== round.id || m.match_status !== 'pending') return false;
                          if (myMatchesOnly) {
                            return m.is_team_mode
                              ? userTeamId === m.player1_id || userTeamId === m.player2_id
                              : userId === m.player1_id || userId === m.player2_id;
                          }
                          return true;
                        });
                      // A best-of series contains one row per individual game.
                      // Keep every pending game visible; only the organizer action
                      // is limited to the first row of each series below.
                      const scheduledMatches = rawScheduled
                        .sort((a, b) => (a.player1_nickname || '').localeCompare(b.player1_nickname || ''));
                      
                      if (scheduledMatches.length === 0) return null;
                      
                      return (
                        <div key={round.id} className="mb-6 p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500">
                          <h4 className="text-lg font-semibold text-gray-800 mb-4 uppercase tracking-wide">
                            {t('label_round')} {round.round_number}
                            {round.round_phase_label && ` [${round.round_phase_label}]`}
                            {round.round_classification && ` (${round.round_classification})`}
                            {' '}-{' '}
                            {t(`option_${normalizeStatus(round.round_status)}`) !== `option_${normalizeStatus(round.round_status)}` ? t(`option_${normalizeStatus(round.round_status)}`) : (round.round_status || t('option_pending'))}
                          </h4>
                          <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-200">
                              <tr>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">{scheduledMatches.length > 0 && scheduledMatches[0].is_team_mode ? t('label_team1') : t('label_player1')}</th>
                                <th className="px-4 py-3 text-center font-semibold text-gray-700">vs</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">{scheduledMatches.length > 0 && scheduledMatches[0].is_team_mode ? t('label_team2') : t('label_player2')}</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('label_map')}</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('label_status')}</th>
                                {canManageParticipants && <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('label_actions')}</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {scheduledMatches.map((match, matchIndex) => {
                                const seriesId = match.series_id || match.id;
                                const firstSeriesRow = scheduledMatches.findIndex(
                                  (candidate) => (candidate.series_id || candidate.id) === seriesId
                                ) === matchIndex;
                                // Check if current user is one of the players/teams
                                let isPlayer = false;
                                if (match.is_team_mode) {
                                  // Team mode: compare user's team_id against match player1_id and player2_id
                                  isPlayer = userTeamId === match.player1_id || userTeamId === match.player2_id;
                                } else {
                                  // 1v1 mode: compare user_id directly
                                  isPlayer = userId === match.player1_id || userId === match.player2_id;
                                }
                                
                                return (
                                  <tr id={`scheduled-series-${seriesId}`} key={match.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                                    <td className="px-4 py-3 text-gray-700">
                                      <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                          <strong>{match.is_team_mode ? match.player1_nickname : <PlayerLink nickname={match.player1_nickname} userId={match.player1_id} />}</strong>
                                        </div>
                                        {Boolean(match.is_team_mode) && (
                                          <span className="text-xs text-gray-500">({getTeamMembersString(match.player1_id)})</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">vs</td>
                                    <td className="px-4 py-3 text-gray-700">
                                      <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                          <strong>{match.is_team_mode ? match.player2_nickname : <PlayerLink nickname={match.player2_nickname} userId={match.player2_id} />}</strong>
                                        </div>
                                        {Boolean(match.is_team_mode) && (
                                          <span className="text-xs text-gray-500">({getTeamMembersString(match.player2_id)})</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-gray-700">{match.map || '-'}</td>
                                    <td className="px-4 py-3 text-gray-700">
                                      <div className="flex gap-2 items-center flex-wrap">
                                        <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold text-white bg-yellow-500">
                                           {t('option_pending')}
                                         </span>
                                      </div>
                                    </td>
                                    {canManageParticipants && (
                                      <td className="px-4 py-3 text-gray-700">
                                        {firstSeriesRow && <button
                                          data-help-id="action-determine-match-winner"
                                          className="px-3 py-1 bg-orange-500 text-white rounded text-xs font-semibold hover:bg-orange-600 transition-colors whitespace-nowrap"
                                          onClick={() => openDetermineWinnerModal({
                                            id: match.series_id || match.id,
                                            player1_id: match.player1_id,
                                            player2_id: match.player2_id,
                                            player1_nickname: match.player1_nickname,
                                            player2_nickname: match.player2_nickname,
                                            is_team_mode: match.is_team_mode,
                                            round_type: round.round_type,
                                          })}
                                          title={t('determine_winner')}
                                        >
                                          ⚖️ {t('determine_winner')}
                                        </button>}
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          </div>
                        </div>
                      );
                    })}
                    {matches.filter((m) => m.match_status === 'pending').length === 0 && (
                      <p className="text-gray-600">{t('no_scheduled_matches')}</p>
                    )}
                  </>
                ) : (
                  <p className="text-gray-600">{t('no_rounds_configured')}</p>
                )}
              </div>
            )}

               {/* Completed Matches Section */}
               {statusFilter !== 'scheduled' && (
               <div className="mb-8">
                 <h3 className="text-2xl font-bold text-gray-800 mb-4 pb-3 border-b-2 border-blue-500">{t('matches.completed')}</h3>
                 {matches.filter((m) => {
                    if (m.match_status === 'pending') return false;
                    if (myMatchesOnly) {
                      return m.is_team_mode
                        ? userTeamId === m.player1_id || userTeamId === m.player2_id
                        : userId === m.player1_id || userId === m.player2_id;
                    }
                    return true;
                  }).length > 0 ? (
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('label_round')}</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('label_winner')}</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('label_loser')}</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">{tournament?.tournament_mode === 'unranked' ? `${t('label_map')} / Factions` : t('label_map')}</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Status / Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches
                         .filter((m) => {
                           if (m.match_status === 'pending') return false;
                           if (myMatchesOnly) {
                             return m.is_team_mode
                               ? userTeamId === m.player1_id || userTeamId === m.player2_id
                               : userId === m.player1_id || userId === m.player2_id;
                           }
                           return true;
                         })
                        .map((match) => {
                           // Check if this is a pending replay (not yet confirmed)
                            const isPendingReplay = match.match_status === 'unconfirmed';
                            const isConfidenceOneReplay = isPendingReplay && Number(match.pending_replay_confidence) === 1;
                            const isDueReplay = isPendingReplay && match.pending_replay_parse_status === 'due';
                           
                            // Extract replay data if pending
                            let replayData: ReturnType<typeof parseReplaySummary> = { winnerName: null, loserName: null, map: null, winnerFaction: null, loserFaction: null, winnerSide: null, winnerTeamName: null, loserTeamName: null, winnerTeamFactions: null, loserTeamFactions: null, wmlTeams: null, detectedTeams: null };
                            if (isPendingReplay && match.pending_replay_summary) {
                              replayData = parseReplaySummary(match.pending_replay_summary);
                            }
                           
                            // Use replay data if pending, otherwise use match data
                            // For team tournaments, determine winner/loser by matching sides to tournament_round_match teams
                            // In team mode: player1_id and player2_id are team IDs, not user IDs
                            let winnerNickname = '';
                            let loserNickname = '';
                            let winnerId = '';
                            let loserId = '';
                            
                            if (isPendingReplay && match.is_team_mode) {
                              // For team tournaments, match the winner player to the correct team
                              // based on which team has that player in team1_members or team2_members
                              const team1Members = match.team1_members && Array.isArray(match.team1_members) ? match.team1_members : [];
                              const team2Members = match.team2_members && Array.isArray(match.team2_members) ? match.team2_members : [];
                              
                              // Check if winner player belongs to team1 or team2
                              const winnerInTeam1 = team1Members.includes(replayData.winnerName || '');
                              const winnerInTeam2 = team2Members.includes(replayData.winnerName || '');
                              
                              if (winnerInTeam1) {
                                winnerNickname = match.player1_nickname || '';
                                winnerId = match.player1_id;
                                loserNickname = match.player2_nickname || '';
                                loserId = match.player2_id;
                              } else if (winnerInTeam2) {
                                winnerNickname = match.player2_nickname || '';
                                winnerId = match.player2_id;
                                loserNickname = match.player1_nickname || '';
                                loserId = match.player1_id;
                              } else {
                                // Fallback if player not found (shouldn't happen)
                                winnerNickname = match.player1_nickname || '';
                                winnerId = match.player1_id;
                                loserNickname = match.player2_nickname || '';
                                loserId = match.player2_id;
                              }
                            } else if (isPendingReplay) {
                              // For non-team tournaments, use player names from replay
                              winnerNickname = replayData.winnerName || '';
                              loserNickname = replayData.loserName || '';
                              // The replay summary contains the authoritative
                              // winner/loser names; do not assume player 1 won.
                              winnerId = winnerNickname.toLowerCase() === match.player1_nickname?.toLowerCase()
                                ? match.player1_id
                                : match.player2_id;
                              loserId = winnerNickname.toLowerCase() === match.player1_nickname?.toLowerCase()
                                ? match.player2_id
                                : match.player1_id;
                            } else {
                              // For confirmed matches, use match.winner_id directly if available
                              if (match.winner_id) {
                                winnerId = match.winner_id;
                                // Determine loser as the other player
                                loserId = (match.winner_id === match.player1_id ? match.player2_id : match.player1_id);
                                winnerNickname = match.winner_nickname || '';
                                loserNickname = (match.winner_id === match.player1_id ? match.player2_nickname : match.player1_nickname) || '';
                              } else {
                                // Fallback to using winner_nickname if winner_id is not set
                                winnerNickname = match.winner_nickname || '';
                                loserNickname = (match.winner_nickname === match.player1_nickname ? match.player2_nickname : match.player1_nickname) || '';
                                winnerId = (match.winner_nickname === match.player1_nickname ? match.player1_id : match.player2_id);
                                loserId = (match.winner_nickname === match.player1_nickname ? match.player2_id : match.player1_id);
                              }
                            }
                           
                           const displayMap = isPendingReplay ? replayData.map : match.map;
                           const winnerFaction = isPendingReplay ? replayData.winnerFaction : match.winner_faction;
                           const loserFaction = isPendingReplay ? replayData.loserFaction : match.loser_faction;
                           
                           // Determine if current user is the loser (for team mode, check team_id)
                           let isCurrentUserLoser = false;
                           if (match.is_team_mode) {
                             isCurrentUserLoser = userTeamId === loserId;
                           } else {
                             isCurrentUserLoser = userId === loserId;
                           }

                           // Determine if current user is the winner (for team mode, check team_id)
                           let isCurrentUserWinner = false;
                           if (match.is_team_mode) {
                             isCurrentUserWinner = userTeamId === winnerId;
                           } else {
                             isCurrentUserWinner = userId === winnerId;
                           }
                           
                           // If no match_id and status is pending (and not a pending replay), it was determined by admin
                           const isAdminDetermined = !match.match_id && match.match_status === 'pending' && !isPendingReplay;
                           const hasReportedMatch = match.match_id || (['unranked', 'team'].includes(tournament?.tournament_mode || '') && match.match_status === 'completed');
                           // Use match_status_from_matches from the matches table (confirmed, disputed, unconfirmed, cancelled)
                           const confirmationStatus = isAdminDetermined ? 'admin' : (isPendingReplay ? 'auto_detected' : (match.match_status_from_matches || 'unconfirmed'));
                           
                           // Check if next round has been started (for unranked and team tournaments)
                           const nextRound = ['unranked', 'team'].includes(tournament?.tournament_mode || '') 
                             ? rounds.find(r => r.round_number === (match.round_number || 0) + 1)
                             : null;
                           const nextRoundStarted = nextRound && nextRound.round_status !== 'pending';

                           return (
                             <tr key={match.id} className={`border-b border-gray-200 transition-colors ${isDueReplay ? 'bg-red-100 hover:bg-red-50' : isPendingReplay ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50'}`}>
                               <td className="px-4 py-3 text-gray-700">{t('label_round')} {match.round_number}</td>
                               <td className="px-4 py-3 text-gray-700">
                                 <div className="flex flex-col gap-1">
                                   <div className="flex items-center gap-2">
                                     <strong className={isDueReplay ? 'text-red-700' : isPendingReplay ? 'text-amber-600' : 'text-green-600'}>{match.is_team_mode ? winnerNickname : <PlayerLink nickname={winnerNickname || '-'} userId={winnerId} />}</strong>
                                     {!isPendingReplay && <StarDisplay rating={match.loser_rating} size="sm" />}
                                   </div>
                                   {Boolean(match.is_team_mode) && (
                                     <span className="text-xs text-gray-500">({getTeamMembersString(winnerId)})</span>
                                   )}
                                   {!isPendingReplay && match.winner_comments && (
                                     <div className="text-xs text-gray-600 italic">
                                       {match.winner_comments}
                                     </div>
                                   )}
                                 </div>
                               </td>
                               <td className="px-4 py-3 text-gray-700">
                                 <div className="flex flex-col gap-1">
                                   <div className="flex items-center gap-2">
                                     <strong className={isDueReplay ? 'text-red-700' : isPendingReplay ? 'text-amber-600' : 'text-red-600'}>{match.is_team_mode ? loserNickname : <PlayerLink nickname={loserNickname} userId={loserId} />}</strong>
                                     {!isPendingReplay && <StarDisplay rating={match.winner_rating} size="sm" />}
                                   </div>
                                   {Boolean(match.is_team_mode) && (
                                     <span className="text-xs text-gray-500">({getTeamMembersString(loserId)})</span>
                                   )}
                                   {!isPendingReplay && match.loser_comments && (
                                     <div className="text-xs text-gray-600 italic">
                                       {match.loser_comments}
                                     </div>
                                   )}
                                 </div>
                               </td>
                               <td className="px-4 py-3 text-gray-700">
                                 <div className="flex flex-col gap-1">
                                   <span>{displayMap || '-'}</span>
                                   {isPendingReplay && match.is_team_mode && replayData.detectedTeams ? (
                                      <div className="flex flex-col gap-2 text-xs text-gray-600 mt-1">
                                        {(() => {
                                          // Determine S1 and S2 teams based on WML team names
                                          let s1Team: any = null;
                                          let s2Team: any = null;
                                          
                                          Object.values(replayData.detectedTeams).forEach((team: any) => {
                                            if (team.sides && team.sides.includes(1)) s1Team = team;
                                            if (team.sides && team.sides.includes(2)) s2Team = team;
                                          });
                                          
                                          return (
                                            <>
                                              {s1Team && (
                                                <div className="flex flex-wrap gap-1 items-center">
                                                  <span className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">S1 ({s1Team.team_wml_name})</span>
                                                  {s1Team.factions?.map((faction: string, idx: number) => (
                                                    <span key={idx} className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">{faction}</span>
                                                  ))}
                                                </div>
                                              )}
                                              {s2Team && (
                                                <div className="flex flex-wrap gap-1 items-center">
                                                  <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-semibold">S2 ({s2Team.team_wml_name})</span>
                                                  {s2Team.factions?.map((faction: string, idx: number) => (
                                                    <span key={idx} className="inline-block px-1.5 py-0.5 bg-red-100 text-red-700 rounded">{faction}</span>
                                                  ))}
                                                </div>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </div>
                                    ) : (!isPendingReplay && match.is_team_mode && (match.winner_faction || match.loser_faction)) ? (
                                      <div className="flex flex-col gap-2 text-xs text-gray-600 mt-1">
                                        {match.winner_faction && (
                                          <div className="flex flex-wrap gap-1 items-center">
                                            <span className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">Winner</span>
                                            {match.winner_faction.split(', ').map((faction, idx) => (
                                              <span key={idx} className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">{faction}</span>
                                            ))}
                                          </div>
                                        )}
                                        {match.loser_faction && (
                                          <div className="flex flex-wrap gap-1 items-center">
                                            <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-semibold">Loser</span>
                                            {match.loser_faction.split(', ').map((faction, idx) => (
                                              <span key={idx} className="inline-block px-1.5 py-0.5 bg-red-100 text-red-700 rounded">{faction}</span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap gap-1 items-center text-xs text-gray-600 mt-1">
                                        <span className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">{winnerFaction || '-'}</span>
                                        {replayData.winnerSide && <span className={`inline-block px-1.5 py-0.5 rounded font-semibold ${replayData.winnerSide === 1 ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>S{replayData.winnerSide}</span>}
                                        <span>vs</span>
                                        <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-semibold">{loserFaction || '-'}</span>
                                        {replayData.winnerSide && <span className={`inline-block px-1.5 py-0.5 rounded font-semibold ${replayData.winnerSide === 1 ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>S{replayData.winnerSide === 1 ? 2 : 1}</span>}
                                      </div>
                                    )}
                                 </div>
                               </td>
                               <td className="px-4 py-3 text-gray-700">
                                 <div className="flex flex-col gap-2">
                                   <div>
                                     {isPendingReplay ? (
                                       <></>
                                     ) : isAdminDetermined ? (
                                       <span className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold bg-purple-500">{t('admin_tag')}</span>
                                     ) : confirmationStatus === 'confirmed' ? (
                                       <span className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold bg-green-500">{t('match_status_confirmed')}</span>
                                     ) : confirmationStatus === 'disputed' ? (
                                       <span className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold bg-orange-500">{t('match_status_disputed')}</span>
                                     ) : confirmationStatus === 'reported' ? (
                                       <span className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold bg-orange-400">{t('match_status_reported')}</span>
                                     ) : (
                                       <span className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold bg-gray-400">{t('match_status_unconfirmed')}</span>
                                     )}
                                   </div>
                                   <div className="flex flex-wrap gap-2">
                                     {isDueReplay ? (
                                       // Due replay: read-only mode
                                       <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 italic">
                                         {t('replay_due') || 'Due Replay - Download only'}
                                       </div>
                                     ) : isConfidenceOneReplay && (userId === winnerId || (match.is_team_mode && userTeamId === winnerId)) ? (
                                       <>
                                         <button
                                           data-help-id="action-confirm-match-won"
                                           className="px-2 py-1 text-xs bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                                           onClick={() => {
                                             setSelectedTournamentReplay(match);
                                             setReplayModalChoice('I won');
                                             setShowReplayConfirmModal(true);
                                           }}
                                           title={t('confirm_i_won')}
                                         >
                                           ✓ {t('i_won') || 'I Won'}
                                         </button>
                                         <button
                                           data-help-id="action-confirm-match-lost"
                                           className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                                           onClick={() => {
                                             setSelectedTournamentReplay(match);
                                             setReplayModalChoice('I lost');
                                             setShowReplayConfirmModal(true);
                                           }}
                                           title={t('confirm_i_lost')}
                                         >
                                           ✗ {t('i_lost') || 'I Lost'}
                                         </button>
                                       {match.pending_replay_url && (
                                            <a
                                              href={match.pending_replay_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="px-2 py-1 text-xs bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                                              title={t('download_replay')}
                                            >
                                              ⬇️
                                            </a>
                                          )}</>
                                     ) : isDueReplay ? (
                                       // Due replay: read-only mode
                                       <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 italic">
                                         {t('replay_due') || 'Due Replay - Download only'}
                                       </div>
                                     ) : isConfidenceOneReplay && (userId === loserId || (match.is_team_mode && userTeamId === loserId)) ? (
                                       <>
                                         <button
                                           data-help-id="action-confirm-match-won"
                                           className="px-2 py-1 text-xs bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                                           onClick={() => {
                                             setSelectedTournamentReplay(match);
                                             setReplayModalChoice('I won');
                                             setShowReplayConfirmModal(true);
                                           }}
                                           title={t('confirm_i_won')}
                                         >
                                           ✓ {t('i_won') || 'I Won'}
                                         </button>
                                         <button
                                           data-help-id="action-confirm-match-lost"
                                           className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                                           onClick={() => {
                                             setSelectedTournamentReplay(match);
                                             setReplayModalChoice('I lost');
                                             setShowReplayConfirmModal(true);
                                           }}
                                           title={t('confirm_i_lost')}
                                         >
                                           ✗ {t('i_lost') || 'I Lost'}
                                         </button>
                                       {match.pending_replay_url && (
                                            <a
                                              href={match.pending_replay_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="px-2 py-1 text-xs bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                                              title={t('download_replay')}
                                            >
                                              ⬇️
                                            </a>
                                          )}</>
                                     ) : hasReportedMatch ? (
                                       <>
                                         <button
                                           data-help-id="action-view-match-details"
                                           className="px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                                           onClick={() => setMatchDetailsModal({ isOpen: true, match })}
                                           title={t('view_match_details')}
                                         >
                                           {t('details_btn')}
                                         </button>
                                         {match.replay_file_path ? (
                                             <a
                                              data-help-id="action-download-replay"
                                              href={match.replay_url || match.replay_file_path}
                                             target="_blank"
                                             rel="noopener noreferrer"
                                             className="px-2 py-1 text-xs bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                                             onClick={() => handleDownloadReplay(match.match_id, match.replay_file_path, match.id)}
                                             title={`${t('downloads')}: ${match.replay_downloads || 0}`}
                                           >
                                             ⬇️
                                           </a>
                                         ) : (
                                           <span className="text-xs text-gray-500">{t('no_replay')}</span>
                                         )}
                                       </>
                                     ) : (
                                       <span className="text-xs text-gray-500">-</span>
                                     )}
                                     {!isAdminDetermined && !isPendingReplay && isCurrentUserLoser && ['unconfirmed', 'reported'].includes(confirmationStatus) && (
                                       <button
                                         data-help-id="action-confirm-match-dispute"
                                         className="px-2 py-1 text-xs bg-yellow-500 hover:bg-yellow-600 text-white rounded transition-colors"
                                         onClick={() => handleOpenConfirmModal(match)}
                                       >
                                         {t('report_match_link') || 'Report Match'}
                                       </button>
                                     )}
                                     {!isAdminDetermined && !isPendingReplay && isCurrentUserWinner && !match.winner_comments && !match.winner_rating && (
                                       <button
                                         data-help-id="action-inform-match-result"
                                         className="px-2 py-1 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors"
                                         onClick={() => handleOpenConfirmModal(match)}
                                       >
                                         {t('match_inform')}
                                       </button>
                                     )}
                                     {isOrganizer && !isPendingReplay && confirmationStatus === 'disputed' && (
                                       <button
                                         data-help-id="action-manage-match-dispute"
                                         className="px-2 py-1 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors"
                                         onClick={() => {
                                           console.log('[MANAGE DISPUTE] Button clicked for match:', match.id, 'confirmationStatus:', confirmationStatus);
                                           setDisputeManagementModal({ isOpen: true, match });
                                         }}
                                       >
                                         {t('manage_dispute')}
                                       </button>
                                     )}
                                   </div>
                                 </div>
                               </td>
                             </tr>
                           );
                         })}
                    </tbody>
                  </table>
                  </div>
                ) : (
                  <p>{t('no_completed_matches')}</p>
                )}
              </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Rounds Section */}
      {activeTab === 'rounds' && (
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8 mt-6 overflow-x-auto">
          {rounds.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_round_number')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_type')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_status')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_start_date')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_end_date')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_format')}</th>
                  {isOrganizer && tournament.tournament_type !== 'league' && <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {rounds.map((round) => (
                  <tr key={round.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-700">
                      <strong>{round.round_number}</strong>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{round.round_phase_label || round.round_type || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <span className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold" style={{ backgroundColor: getStatusColor(round.round_status) }}>
                        {t(`option_${normalizeStatus(round.round_status)}`) !== `option_${normalizeStatus(round.round_status)}` ? t(`option_${normalizeStatus(round.round_status)}`) : (round.round_status || t('option_pending'))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{round.round_start_date ? formatDate(round.round_start_date) : '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{round.round_end_date ? formatDate(round.round_end_date) : '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{(round as any)?.match_format ? t('match_format.' + (round as any).match_format) : '-'}</td>
                    {isOrganizer && tournament.tournament_type !== 'league' && (
                      <td className="px-4 py-3 text-gray-700">
                        {round.round_status === 'completed' && round.round_number < rounds.length ? (
                          (() => {
                            const nextRound = rounds.find(r => r.round_number === round.round_number + 1);
                            return nextRound && nextRound.round_status === 'pending' ? (
                              <button
                                data-help-id="action-start-next-round"
                                className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 transition-colors"
                                onClick={() => handleStartNextRound(round.round_number)}
                                title={t('start_next_round')}
                              >
                                {t('start_round')} {round.round_number + 1}
                              </button>
                            ) : (
                              <span className="text-gray-400">-</span>
                            );
                          })()
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-600">{t('no_rounds_configured_tournament')}</p>
          )}
        </div>
      )}

      {/* Round Matches Section */}
      {activeTab === 'roundMatches' && (
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8 mt-6 overflow-x-auto">
          {rounds.length > 0 ? (
            <>
              {rounds.map((round) => {
                const matchesInRound = roundMatches.filter((m) => {
                  if (m.round_id !== round.id) return false;
                  // Status filter: series_status 'in_progress' = scheduled, 'completed'/'bye' = completed
                  if (statusFilter === 'scheduled' && m.series_status !== 'in_progress') return false;
                  if (statusFilter === 'completed' && m.series_status === 'in_progress') return false;
                  // My matches filter
                  if (myMatchesOnly) {
                    return m.is_team_mode
                      ? userTeamId === m.player1_id || userTeamId === m.player2_id
                      : userId === m.player1_id || userId === m.player2_id;
                  }
                  return true;
                });
                const byesInRound = matchesInRound.filter((match) => match.is_bye);
                const playableMatchesInRound = matchesInRound.filter((match) => !match.is_bye);
                
                if (matchesInRound.length === 0) return null;
                
                return (
                  <div key={round.id} className="mb-8">
                    <h3 className="text-2xl font-bold text-gray-800 mb-4 pb-3 border-b-2 border-gray-300">{t('label_round')} {round.round_number} - {round.round_phase_label || round.round_type || 'Round'}</h3>
                    {byesInRound.length > 0 && (
                      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                        <h4 className="font-semibold text-amber-900">{t('label_bye', 'Bye')}</h4>
                        {byesInRound.map((bye) => (
                          <div key={bye.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm text-amber-900">
                            <strong>{bye.is_team_mode ? bye.player1_nickname : <PlayerLink nickname={bye.player1_nickname} userId={bye.player1_id} />}</strong>
                            <span>{t('bye_automatic_advancement', 'advanced automatically')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {playableMatchesInRound.length > 0 && (
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{playableMatchesInRound.length > 0 && playableMatchesInRound[0].is_team_mode ? t('label_team1') : t('label_player1')}</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('vs')}</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{playableMatchesInRound.length > 0 && playableMatchesInRound[0].is_team_mode ? t('label_team2') : t('label_player2')}</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_winner')}</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_status')}</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">Schedule</th>
                          {canManageParticipants && <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_actions')}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {playableMatchesInRound.map((match) => {
                          const isHighlighted = highlightedMatchId === match.id;
                          return (
                            <tr 
                              key={match.id} 
                              id={`match-${match.id}`}
                              className={`border-b transition-all ${
                                isHighlighted 
                                  ? 'bg-yellow-200 border-yellow-500 font-semibold' 
                                  : 'border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                            <td className="px-4 py-3 text-gray-700">
                              <div className="flex flex-col gap-1">
                                <div>
                                  <strong>{match.is_team_mode ? match.player1_nickname : <PlayerLink nickname={match.player1_nickname} userId={match.player1_id} />}</strong>
                                </div>
                                {Boolean(match.is_team_mode) && getTeamMembersString(match.player1_id) && (
                                  <span className="text-xs text-gray-500">({getTeamMembersString(match.player1_id)})</span>
                                )}
                              </div>
                              {(match as any).player1_wins !== undefined && (
                                <span className="text-gray-600 text-sm">
                                  {' '}({(match as any).player1_wins})
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700">vs</td>
                            <td className="px-4 py-3 text-gray-700">
                              <div className="flex flex-col gap-1">
                                <div>
                                  <strong>{match.is_team_mode ? match.player2_nickname : <PlayerLink nickname={match.player2_nickname} userId={match.player2_id} />}</strong>
                                </div>
                                {Boolean(match.is_team_mode) && getTeamMembersString(match.player2_id) && (
                                  <span className="text-xs text-gray-500">({getTeamMembersString(match.player2_id)})</span>
                                )}
                              </div>
                              {(match as any).player2_wins !== undefined && (
                                <span className="text-gray-600 text-sm">
                                  {' '}({(match as any).player2_wins})
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              <div className="flex flex-col gap-1">
                                {match.winner_id === match.player1_id ? (
                                   <>
                                     <strong className="text-green-600">{match.is_team_mode ? match.player1_nickname : <PlayerLink nickname={match.player1_nickname} userId={match.player1_id} />}</strong>
                                     {Boolean(match.is_team_mode) && getTeamMembersString(match.player1_id) && (
                                       <span className="text-xs text-gray-500">({getTeamMembersString(match.player1_id)})</span>
                                     )}
                                   </>
                                 ) : match.winner_id === match.player2_id ? (
                                   <>
                                     <strong className="text-green-600">{match.is_team_mode ? match.player2_nickname : <PlayerLink nickname={match.player2_nickname} userId={match.player2_id} />}</strong>
                                     {Boolean(match.is_team_mode) && getTeamMembersString(match.player2_id) && (
                                       <span className="text-xs text-gray-500">({getTeamMembersString(match.player2_id)})</span>
                                     )}
                                   </>
                                 ) : (
                                   <span className="text-gray-400">-</span>
                                 )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              <span className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold" style={{ backgroundColor: getStatusColor((match as any).series_status) }}>
                                {t(`option_${normalizeStatus((match as any).series_status)}`) !== `option_${normalizeStatus((match as any).series_status)}` ? t(`option_${normalizeStatus((match as any).series_status)}`) : ((match as any).series_status || t('option_pending'))}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {(match as any).series_status !== 'completed' && (
                                <>
                                  {(() => {
                                    const schedStatus = getScheduleStatus(match);
                                    const cacheKey = match.series_id || match.id;
                                    const cachedProposal = proposalCache[cacheKey];
                                    
                                    if (schedStatus.status === 'confirmed') {
                                      return (
                                       <div className="flex flex-col gap-1">
                                         {canScheduleMatch(match) && (
                                           <button
                                             data-help-id="action-schedule-match"
                                             className="px-3 py-1 bg-green-500 text-white rounded text-xs font-semibold hover:bg-green-600 transition-colors whitespace-nowrap"
                                             onClick={() => handlePreloadSchedulingData(match.series_id || match.id, true)}
                                             disabled={isLoadingScheduling}
                                             title="Click to reschedule the match"
                                           >
                                             ✅ Confirmed
                                           </button>
                                         )}
                                         {!canScheduleMatch(match) && (
                                           <span className="px-3 py-1 bg-green-500 text-white rounded text-xs font-semibold">
                                             ✅ Confirmed
                                           </span>
                                         )}
                                         {cachedProposal && renderScheduleSlots(cachedProposal)}
                                         {!cachedProposal && schedStatus.datetime && (
                                           <span className="text-xs text-gray-600">
                                             {new Date(schedStatus.datetime).toLocaleString('es-ES', {
                                               year: 'numeric',
                                               month: '2-digit',
                                               day: '2-digit',
                                               hour: '2-digit',
                                               minute: '2-digit'
                                             })}
                                           </span>
                                         )}
                                       </div>
                                      );
                                    }
                                    
                                    if (schedStatus.status === 'awaiting_confirmation') {
                                      return (
                                       <div className="flex flex-col gap-1">
                                         {canScheduleMatch(match) && (
                                           <button
                                             data-help-id="action-schedule-match"
                                             className="px-3 py-1 bg-purple-500 text-white rounded text-xs font-semibold hover:bg-purple-600 transition-colors whitespace-nowrap"
                                             onClick={() => handlePreloadSchedulingData(match.series_id || match.id, true)}
                                             disabled={isLoadingScheduling}
                                             title={schedStatus.isUserProposer ? 'View proposed schedule' : 'Confirm opponent proposal'}
                                           >
                                             {schedStatus.isUserProposer ? '⏳ Awaiting Confirmation' : '✋ Awaiting Your Confirmation'}
                                           </button>
                                         )}
                                         {!canScheduleMatch(match) && (
                                           <span className="px-3 py-1 bg-purple-500 text-white rounded text-xs font-semibold">
                                             ⏳ Awaiting Confirmation
                                           </span>
                                         )}
                                         {cachedProposal && renderScheduleSlots(cachedProposal)}
                                         {!cachedProposal && schedStatus.datetime && (
                                           <span className="text-xs text-orange-600">
                                             {new Date(schedStatus.datetime).toLocaleString('es-ES', {
                                               year: 'numeric',
                                               month: '2-digit',
                                               day: '2-digit',
                                               hour: '2-digit',
                                               minute: '2-digit'
                                             })}
                                           </span>
                                         )}
                                       </div>
                                      );
                                    }
                                    
                                    // status === 'no_schedule'
                                    return (
                                      <>
                                       {canScheduleMatch(match) && (
                                         <button
                                           data-help-id="action-schedule-match"
                                           className="px-3 py-1 bg-purple-500 text-white rounded text-xs font-semibold hover:bg-purple-600 transition-colors whitespace-nowrap"
                                           onClick={() => handlePreloadSchedulingData(match.id, true)}
                                           disabled={isLoadingScheduling}
                                           title="Schedule or view match time"
                                         >
                                           🗓️ Schedule
                                         </button>
                                       )}
                                       {!canScheduleMatch(match) && (
                                         <span className="text-xs text-gray-500">Pending schedule</span>
                                       )}
                                      </>
                                    );
                                  })()}
                                </>
                              )}
                              {(match as any).series_status === 'completed' && (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </td>
                            {canManageParticipants && (
                              <td className="px-4 py-3 text-gray-700">
                                {(match as any).series_status === 'in_progress' && (
                                  <button
                                    data-help-id="action-determine-match-winner"
                                    className="px-3 py-1 bg-orange-500 text-white rounded text-xs font-semibold hover:bg-orange-600 transition-colors whitespace-nowrap"
                                    onClick={() => openDetermineWinnerModal({
                                      id: match.id,
                                      player1_id: match.player1_id,
                                      player2_id: match.player2_id,
                                      player1_nickname: match.player1_nickname,
                                      player2_nickname: match.player2_nickname,
                                      is_team_mode: match.is_team_mode,
                                      round_type: round.round_type,
                                    })}
                                    title={t('determine_winner')}
                                  >
                                    ⚖️ {t('determine_winner')}
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <p className="text-gray-600">{t('no_rounds_configured_tournament')}</p>
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
            onScheduleGame={(game) => handlePreloadSchedulingData(game.series_id, false, undefined, true)}
            highlightedSeriesId={highlightedSeriesId}
          />
        </div>
      )}

      {activeTab === 'tournamentStandings' && tournament && (
        <div className="mb-8 mt-6">
          <TournamentOverallStandings tournamentId={tournament.id} />
        </div>
      )}

      {/* Ranking Section */}
      {activeTab === 'ranking' && (
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8 mt-6 overflow-x-auto">
          {tournament?.tournament_mode === 'team' ? (
            // Team ranking
            participants.length > 0 ? (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_rank')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">Team Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">Members</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_wins')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_losses')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_points')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300" title="Opponent Match Points">OMP</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300" title="Game Win Percentage">GWP</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300" title="Opponent Game Percentage">OGP</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {participants
                    .sort((a, b) => {
                      const pointsDiff = (b.tournament_points || 0) - (a.tournament_points || 0);
                      if (pointsDiff !== 0) return pointsDiff;
                      const ompDiff = (Number(b.omp) || 0) - (Number(a.omp) || 0);
                      if (ompDiff !== 0) return ompDiff;
                      const gwpDiff = (Number(b.gwp) || 0) - (Number(a.gwp) || 0);
                      if (gwpDiff !== 0) return gwpDiff;
                      const ogpDiff = (Number(b.ogp) || 0) - (Number(a.ogp) || 0);
                      if (ogpDiff !== 0) return ogpDiff;
                      return (b.tournament_wins || 0) - (a.tournament_wins || 0);
                    })
                    .map((team, index) => {
                      // Get team members from members_with_elo (already included in standings data)
                      const membersList = (team.members_with_elo && Array.isArray(team.members_with_elo))
                        ? team.members_with_elo.map((m: any) => m.nickname).join(', ')
                        : 'N/A';
                      
                      return (
                        <tr key={team.id}>
                          <td><strong>#{index + 1}</strong></td>
                          <td className="px-4 py-3 text-gray-700"><strong>{team.nickname}</strong></td>
                          <td className="px-4 py-3 text-gray-700">{membersList}</td>
                          <td className="px-4 py-3 text-gray-700">{team.tournament_wins || 0}</td>
                          <td className="px-4 py-3 text-gray-700">{team.tournament_losses || 0}</td>
                          <td className="px-4 py-3 text-gray-700"><strong>{team.tournament_points || 0}</strong></td>
                          <td className="px-4 py-3 text-gray-700">{team.omp != null ? Number(team.omp).toFixed(2) : '-'}</td>
                          <td className="px-4 py-3 text-gray-700">{team.gwp != null ? Number(team.gwp).toFixed(2) : '-'}</td>
                          <td className="px-4 py-3 text-gray-700">{team.ogp != null ? Number(team.ogp).toFixed(2) : '-'}</td>
                          <td className="px-4 py-3 text-gray-700">
                            <span className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold" style={{ backgroundColor: getStatusColor(team.status) }}>
                              {t(`option_${normalizeStatus(team.status)}`) !== `option_${normalizeStatus(team.status)}` ? t(`option_${normalizeStatus(team.status)}`) : (team.status || t('option_active'))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="text-gray-600">{t('no_participants_in_tournament')}</p>
            )
          ) : (
            // Individual ranking
            participants.length > 0 ? (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_rank')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_nickname')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_wins')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_losses')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_points')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300" title="Opponent Match Points">OMP</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300" title="Game Win Percentage">GWP</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300" title="Opponent Game Percentage">OGP</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {participants
                    .sort((a, b) => {
                      const pointsDiff = (b.tournament_points || 0) - (a.tournament_points || 0);
                      if (pointsDiff !== 0) return pointsDiff;
                      const ompDiff = (Number(b.omp) || 0) - (Number(a.omp) || 0);
                      if (ompDiff !== 0) return ompDiff;
                      const gwpDiff = (Number(b.gwp) || 0) - (Number(a.gwp) || 0);
                      if (gwpDiff !== 0) return gwpDiff;
                      const ogpDiff = (Number(b.ogp) || 0) - (Number(a.ogp) || 0);
                      if (ogpDiff !== 0) return ogpDiff;
                      return (b.tournament_wins || 0) - (a.tournament_wins || 0);
                    })
                    .map((participant, index) => (
                      <tr key={participant.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-700">
                          <strong>#{index + 1}</strong>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{participant.nickname}</td>
                        <td className="px-4 py-3 text-gray-700">{participant.tournament_wins || 0}</td>
                        <td className="px-4 py-3 text-gray-700">{participant.tournament_losses || 0}</td>
                        <td className="px-4 py-3 text-gray-700"><strong>{participant.tournament_points || 0}</strong></td>
                        <td className="px-4 py-3 text-gray-700">{participant.omp != null ? Number(participant.omp).toFixed(2) : '-'}</td>
                        <td className="px-4 py-3 text-gray-700">{participant.gwp != null ? Number(participant.gwp).toFixed(2) : '-'}</td>
                        <td className="px-4 py-3 text-gray-700">{participant.ogp != null ? Number(participant.ogp).toFixed(2) : '-'}</td>
                        <td className="px-4 py-3 text-gray-700">
                          <span className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold" style={{ backgroundColor: getParticipationStatusColor(participant.participation_status) }}>
                            {t(`option_${normalizeStatus(participant.participation_status)}`) !== `option_${normalizeStatus(participant.participation_status)}` ? t(`option_${normalizeStatus(participant.participation_status)}`) : (participant.participation_status || t('option_pending'))}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="text-gray-600">{t('no_participants_in_tournament')}</p>
            )
          )}
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

      {/* Report Match Modal */}
      {/* Replay Confirmation Modal - for confidence=1 replays in tournament matches */}
      {showReplayConfirmModal && selectedTournamentReplay && (
        <ReplayConfirmationModal
          isOpen={showReplayConfirmModal}
          replayId={selectedTournamentReplay.id}
          player1_nickname={selectedTournamentReplay.player1_nickname}
          player2_nickname={selectedTournamentReplay.player2_nickname}
          currentUserNickname={user?.nickname?.toLowerCase() || ''}
          your_choice={replayModalChoice}
          map={selectedTournamentReplay.map}
          player1_faction={selectedTournamentReplay.winner_faction}
          player2_faction={selectedTournamentReplay.loser_faction}
          onClose={() => { setShowReplayConfirmModal(false); setSelectedTournamentReplay(null); }}
          onSuccess={handleReplayConfirmSuccess}
        />
      )}

      {/* Confirm/Dispute Match Modal */}
      {showConfirmModal && confirmMatchData && (
        <MatchConfirmationModal
          currentPlayerId={userId!}
          match={confirmMatchData}
          onClose={handleCloseConfirmModal}
          onSubmit={handleConfirmSuccess}
          isTeamMode={confirmMatchData.is_team_mode}
          currentUserTeamId={userTeamId || undefined}
        />
      )}

      {/* Determine Winner Modal */}
      {showDetermineWinnerModal && determineWinnerData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={closeDetermineWinnerModal}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">
                {determineWinnerStep === 1
                  ? `${t('determine_winner_title')} / ${t('tournaments.player_abandoned') || 'Player Abandoned'}`
                  : t('tournaments.eliminate_step2_title')}
              </h3>
              <button
                data-help-id="action-close-determine-winner"
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                onClick={closeDetermineWinnerModal}
              >
                ✕
              </button>
            </div>

            {determineWinnerStep === 1 ? (
              <div>
                <p className="mb-4 text-gray-600">
                  {t('determine_winner_prompt', { p1: determineWinnerData.player1_nickname, p2: determineWinnerData.player2_nickname })}
                </p>
                <p className="mb-6 text-sm text-gray-500">
                  {t('tournaments.abandonment_note') || 'Select the winner. If a player abandoned, their opponent automatically wins (no ELO impact, tournament points awarded).'}
                </p>
                <div className="flex gap-4">
                  <button
                    data-help-id="action-select-winner-player-one"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                    onClick={() => handleDetermineWinnerStep1(determineWinnerData.player1_id)}
                  >
                    {determineWinnerData.player1_nickname} {t('label_wins')}
                  </button>
                  <button
                    data-help-id="action-select-winner-player-two"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                    onClick={() => handleDetermineWinnerStep1(determineWinnerData.player2_id)}
                  >
                    {determineWinnerData.player2_nickname} {t('label_wins')}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="mb-4 text-gray-600">
                  {tournament?.tournament_type === 'league'
                    ? t('tournaments.eliminate_league_note')
                    : t('tournaments.eliminate_swiss_note')}
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    data-help-id="action-keep-series-active"
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                    onClick={() => handleDetermineWinner(pendingWinnerSelection!, false)}
                  >
                    {t('tournaments.eliminate_only_series')}
                  </button>
                  <button
                    data-help-id="action-eliminate-from-tournament"
                    className="w-full px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
                    onClick={() => handleDetermineWinner(pendingWinnerSelection!, true)}
                  >
                    {t('tournaments.eliminate_from_tournament')}
                  </button>
                </div>
                <button
                  data-help-id="action-back-determine-winner-step"
                  className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline w-full text-center"
                  onClick={() => { setDetermineWinnerStep(1); setPendingWinnerSelection(null); }}
                >
                  ← {t('label_back') || 'Back'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <MatchDetailsModal match={matchDetailsModal.match} isOpen={matchDetailsModal.isOpen} onClose={() => setMatchDetailsModal({ isOpen: false, match: null })} onDownloadReplay={handleDownloadReplay} />

      {/* Dispute Management Modal */}
      {disputeManagementModal.isOpen && disputeManagementModal.match && (
        <>
          {console.log('[MODAL] Dispute management modal opened for match:', disputeManagementModal.match.id)}
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
              <div className="mb-4">
                <h2 className="text-xl font-bold text-gray-800">Manage Dispute</h2>
              </div>
              <div className="mb-6">
                <p className="text-gray-700 mb-4">
                  {`Round ${disputeManagementModal.match.round_number}: ${disputeManagementModal.match.winner_nickname || '-'} vs ${disputeManagementModal.match.loser_nickname || '-'}`}
                </p>
                <p className="text-gray-600 text-sm">
                  Confirming the dispute will revert the match to pending and reset both players' stats.
                </p>
              </div>
              <div className="flex gap-3 justify-end">
                <button 
                  data-help-id="action-close-dispute-modal"
                  className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded transition-colors"
                  onClick={() => setDisputeManagementModal({ isOpen: false, match: null })}
                >
                  {t('cancel_btn')}
                </button>
                <button 
                  data-help-id="action-reject-dispute"
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                  onClick={() => handleDisputeAction('dismiss', disputeManagementModal.match!.id)}
                >
                  ✗ Reject Dispute
                </button>
                <button 
                  data-help-id="action-validate-dispute"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                  onClick={() => handleDisputeAction('confirm', disputeManagementModal.match!.id)}
                >
                  ✓ Validate Dispute
                </button>
              </div>
            </div>
          </div>
        </>
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
        roundMatchId={scheduleProposalModal.roundMatchId}
        matchId={scheduleProposalModal.matchId}
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
