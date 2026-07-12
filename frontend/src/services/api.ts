import axios, { AxiosError } from 'axios';

// Determine API URL based on environment
// In production/test: loaded from .env file (VITE_API_BASE_URL)
// In development: defaults to localhost
const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

console.log('[API Config] Using API_URL:', API_URL);

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // Don't add cache busting for public endpoints - they should be cached
  // Only add for authenticated requests
  if (config.method === 'get' && token) {
    config.params = config.params || {};
    config.params._t = Date.now();
  }
  
  return config;
});

// Error handling and 401 logout
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config;
    
    // Handle 401 - logout user
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('userId');
      localStorage.removeItem('username');
      window.location.href = '/login';
      return Promise.reject(error);
    }
    
    // Retry logic for rate limiting (429) and server errors
    const retryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
    };
    
    // Don't retry if no config or if it's not a GET request
    if (!config || config.method !== 'get') {
      return Promise.reject(error);
    }
    
    // Check if we should retry
    const status = error.response?.status;
    const retryCount = (config as any).__retryCount || 0;
    
    // Retry on 429 (Too Many Requests) or 5xx errors
    const shouldRetry = (status === 429 || (status && status >= 500)) && retryCount < retryConfig.maxRetries;
    
    if (shouldRetry) {
      (config as any).__retryCount = retryCount + 1;
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        retryConfig.baseDelay * Math.pow(2, retryCount),
        retryConfig.maxDelay
      );
      
      console.warn(`API error ${status}, retrying in ${delay}ms (attempt ${retryCount + 1}/${retryConfig.maxRetries})`);
      
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
      
      // Retry the request
      return api(config);
    }
    
    return Promise.reject(error);
  }
);

// Authentication service - Wesnoth only
export const authService = {
  // Login with Wesnoth credentials (username only)
  login: (username: string, password: string) => 
    api.post('/auth/login', { username, password }),
  
  // Validate token
  validateToken: () => 
    api.get('/auth/validate-token'),
};

export const userService = {
  getProfile: () => api.get('/users/profile'),
  updateDiscordId: (discordId: string) => api.put('/users/profile/discord', { discord_id: discordId }),
  validateDiscordId: (discordId: string) => api.post('/users/profile/discord/validate', { discord_id: discordId }),
  updateRankedStatus: (enable_ranked: boolean) => api.put('/users/profile/ranked', { enable_ranked }),
  updateProfile: (data: { country?: string; avatar?: string; language?: string; timezone?: string; availability_schedule?: any }) =>
    api.put('/users/profile/update', data),
  getUserStats: (id: string) => api.get(`/users/${id}/stats`),
  getUserMonthlyStats: (id: string) => api.get(`/users/${id}/stats/month`),
  getEloHistory: (id: string) => api.get(`/users/${id}/elo-history`),
  getRecentMatches: (id: string, page = 1, filters?: any) => {
    const params: any = { page };
    if (filters) {
      if (filters.player) params.player = filters.player;
      if (filters.map) params.map = filters.map;
      if (filters.status) params.status = filters.status;
      if (filters.faction) params.faction = filters.faction;
      if (filters.include_pending) params.include_pending = true;
    }
    return api.get(`/users/${id}/matches`, { params });
  },
  getMatches: () => api.get('/matches'),
  searchUsers: (query: string) => api.get(`/users/search/${query}`),
  getGlobalRanking: (page: number = 1, filters?: any, sortBy?: string, sortOrder?: string) => {
    const params: any = { page };
    if (filters) {
      if (filters.nickname) params.nickname = filters.nickname;
      if (filters.min_elo) params.min_elo = filters.min_elo;
      if (filters.max_elo) params.max_elo = filters.max_elo;
    }
    if (sortBy) params.sortBy = sortBy;
    if (sortOrder) params.sortOrder = sortOrder;
    return api.get('/users/ranking/global', { params });
  },
  getAllUsers: () => api.get('/users/all'),
};

export const matchService = {
  confirmMatch: (id: string, data: any) => api.post(`/matches/${id}/confirm`, data),
  getAllMatches: (page: number = 1, filters?: any) => {
    const params: any = { page };
    if (filters) {
      if (filters.player) params.player = filters.player;
      if (filters.map) params.map = filters.map;
      if (filters.status) params.status = filters.status;
      if (filters.confirmed) params.confirmed = filters.confirmed;
    }
    return api.get('/matches', { params });
  },
  getUserMatches: (userId: string, page: number = 1, filters?: any) => {
    const params: any = { page };
    if (filters) {
      if (filters.player) params.player = filters.player;
      if (filters.map) params.map = filters.map;
      if (filters.status) params.status = filters.status;
      if (filters.faction) params.faction = filters.faction;
    }
    return api.get(`/users/${userId}/matches`, { params });
  },
  getPendingMatches: () => api.get('/matches/pending/user'),
  getAllPendingMatches: () => api.get('/matches/pending/all'),
  getAllDisputedMatches: (page: number = 1) => api.get('/matches/disputed/all', { params: { page } }),
  cancelOwnMatch: (id: string) => api.post(`/matches/${id}/cancel-own`),
  validateDispute: (id: string) => api.post(`/matches/admin/${id}/dispute`, { action: 'validate' }),
  rejectDispute: (id: string) => api.post(`/matches/admin/${id}/dispute`, { action: 'reject' }),
  incrementReplayDownloads: (matchId: string) => api.post(`/matches/${matchId}/replay/download-count`),
  reportConfidence1Replay: (
    replayId: string, 
    winner_choice: 'I won' | 'I lost',
    comments?: string,
    rating?: number,
    tournament_match_id?: string
  ) => 
    api.post('/matches/report-confidence-1-replay', { replayId, winner_choice, comments, rating, tournament_match_id }),
  cancelConfidence1Replay: (replayId: string) =>
    api.post('/matches/cancel-confidence-1-replay', { replayId }),
  adminDiscardReplay: (replayId: string) =>
    api.post('/matches/admin-discard-replay', { replayId }),
};

export const tournamentService = {
  createTournament: (data: any) => api.post('/tournaments', data),
  getRuleTemplates: () => api.get('/rule-templates'),
  getTournament: (id: string) => api.get(`/tournaments/${id}`),
  getTournamentOrganizers: (id: string) => api.get(`/tournaments/${id}/organizers`),
  addTournamentOrganizer: (id: string, userId: string) =>
    api.post(`/tournaments/${id}/organizers`, { user_id: userId }),
  removeTournamentOrganizer: (id: string, organizerUserId: string) =>
    api.delete(`/tournaments/${id}/organizers/${organizerUserId}`),
  updateTournament: (id: string, data: any) => api.put(`/tournaments/${id}`, data),
  deleteTournament: (id: string) => api.delete(`/tournaments/${id}`),
  prepareTournament: (id: string) => api.post(`/tournaments/${id}/prepare`),
  startTournament: (id: string) => api.post(`/tournaments/${id}/start`),
  closeRegistration: (id: string, confirm?: boolean) => 
    api.post(`/tournaments/${id}/close-registration`, confirm ? { confirm: true } : {}),
  getAllTournaments: () => api.get('/tournaments'),
  getMyTournaments: () => api.get('/tournaments/my'),
  joinTournament: (id: string) => api.post(`/tournaments/${id}/join`),
  requestJoinTournament: (id: string, data?: { team_name?: string; teammate_name?: string }) => 
    api.post(`/tournaments/${id}/request-join`, data || {}),
  getTournamentRounds: (id: string) => api.get(`/tournaments/${id}/rounds`),
  getTournamentRanking: (id: string) => api.get(`/tournaments/${id}/ranking`),
  getTournamentStandings: (id: string, roundId?: string) => 
    api.get(`/tournaments/${id}/standings`, { params: roundId ? { round_id: roundId } : {} }),
  calculateTournamentTiebreakers: (id: string) => api.post(`/tournaments/${id}/calculate-tiebreakers`, {}),
  calculateLeagueTiebreakers: (leagueId: string) => api.post(`/leagues/${leagueId}/calculate-tiebreakers`, {}),
  getTournamentMatches: (id: string) => api.get(`/tournaments/${id}/matches`),
  getTournamentRoundMatches: (id: string) => api.get(`/tournaments/${id}/round-matches`),
  getRoundMatches: (tournamentId: string, roundId: string) => 
    api.get(`/tournaments/${tournamentId}/rounds/${roundId}/matches`),
  recordMatchResult: (tournamentId: string, matchId: string, data: any) =>
    api.post(`/tournaments/${tournamentId}/matches/${matchId}/result`, data),
  determineMatchWinner: (tournamentId: string, matchId: string, data: any) =>
    api.post(`/tournaments/${tournamentId}/matches/${matchId}/determine-winner`, data),
  startNextRound: (id: string) => api.post(`/tournaments/${id}/next-round`),
  acceptParticipant: (tournamentId: string, participantId: string) => 
    api.post(`/tournaments/${tournamentId}/participants/${participantId}/accept`),
  confirmParticipation: (tournamentId: string, participantId: string) => 
    api.post(`/tournaments/${tournamentId}/participants/${participantId}/confirm`),
  rejectParticipant: (tournamentId: string, participantId: string) => 
    api.post(`/tournaments/${tournamentId}/participants/${participantId}/reject`),
  renameTeam: (tournamentId: string, teamId: string, name: string) =>
    api.put(`/tournaments/${tournamentId}/teams/${teamId}/rename`, { name }),
  removeParticipant: (tournamentId: string, participantId: string) =>
    api.delete(`/tournaments/${tournamentId}/participants/${participantId}`),
};

export const adminService = {
  // User management
  getAllUsers: () => api.get('/admin/users/all'),
  blockUser: (id: string) => api.post(`/admin/users/${id}/block`),
  unblockUser: (id: string) => api.post(`/admin/users/${id}/unblock`),
  unlockAccount: (id: string) => api.post(`/admin/users/${id}/unlock`),
  makeAdmin: (id: string) => api.post(`/admin/users/${id}/make-admin`),
  removeAdmin: (id: string) => api.post(`/admin/users/${id}/remove-admin`),

  // Maintenance mode
  getMaintenanceStatus: () => api.get('/admin/maintenance-status'),
  toggleMaintenance: (enable: boolean, reason?: string) =>
    api.post('/admin/toggle-maintenance', { enable, reason }),
  getMaintenanceLogs: (limit?: number) =>
    api.get('/admin/maintenance-logs', { params: limit ? { limit } : {} }),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
  recalculateAllStats: () => api.post('/admin/recalculate-all-stats'),
  
  // Audit logs
  getAuditLogs: (params?: any) => api.get('/admin/audit-logs', { params }),
  deleteAuditLogs: (logIds: string[]) => api.delete('/admin/audit-logs', { data: { logIds } }),
  deleteOldAuditLogs: (daysBack: number) => api.delete('/admin/audit-logs/old', { data: { daysBack } }),

  // Replays
  getReplays: (params?: any) => api.get('/admin/replays', { params }),
  forceDiscardReplay: (replayId: string) => api.post(`/admin/replays/${replayId}/force-discard`),
  reprocessReplay: (replayId: string) => api.post(`/admin/replays/${replayId}/reprocess`),
  
  // System Settings
  getSystemSettings: () => api.get('/admin/system-settings'),
  updateSystemSetting: (key: string, value: string) => api.put(`/admin/system-settings/${key}`, { setting_value: value }),
  
  // News/Announcements
  getNews: () => api.get('/admin/news'),
  createNews: (data: any) => api.post('/admin/news', data),
  updateNews: (id: string, data: any) => api.put(`/admin/news/${id}`, data),
  deleteNews: (id: string) => api.delete(`/admin/news/${id}`),
  
  // FAQ
  getFaq: () => api.get('/admin/faq'),
  createFaq: (data: any) => api.post('/admin/faq', data),
  updateFaq: (id: string, data: any) => api.put(`/admin/faq/${id}`, data),
  deleteFaq: (id: string) => api.delete(`/admin/faq/${id}`),

  // Tournament rule templates
  getRuleTemplates: () => api.get('/admin/rule-templates'),
  createRuleTemplate: (data: { title: string; content_markdown: string; is_active?: boolean }) =>
    api.post('/admin/rule-templates', data),
  updateRuleTemplate: (id: string, data: { title?: string; content_markdown?: string; is_active?: boolean }) =>
    api.put(`/admin/rule-templates/${id}`, data),
  deleteRuleTemplate: (id: string) => api.delete(`/admin/rule-templates/${id}`),
};

// Public API endpoints (no auth required)
export const publicService = {
  getFaqByLanguage: (language: string) => api.get(`/public/faq`), // Now returns all languages, frontend handles fallback
  getFaq: () => api.get('/public/faq'), // Get all FAQ items (all languages)
  getNews: () => api.get('/public/news'),
  getRecentMatches: () => api.get('/public/matches/recent'),
  getPlayerProfile: (id: string) => api.get(`/public/players/${id}`),
  getFactions: (rankedOnly: boolean = true) => api.get('/public/factions', { params: { is_ranked: rankedOnly } }),
  getAllMatches: (page: number = 1, filters?: any) => {
    const params: any = { page };
    if (filters) {
      if (filters.player) params.player = filters.player;
      if (filters.map) params.map = filters.map;
      if (filters.status) params.status = filters.status;
      if (filters.confirmed) params.confirmed = filters.confirmed;
      if (filters.faction) params.faction = filters.faction;
    }
    return api.get('/public/matches', { params });
  },
  getAllPlayers: (page: number = 1, filters?: any, sortBy?: string, sortOrder?: string) => {
    const params: any = { page };
    if (filters) {
      if (filters.nickname) params.nickname = filters.nickname;
      if (filters.min_elo) params.min_elo = filters.min_elo;
      if (filters.max_elo) params.max_elo = filters.max_elo;
      if (filters.min_matches) params.min_matches = filters.min_matches;
      if (filters.rated_only) params.rated_only = filters.rated_only;
      if (filters.ranked_only) params.ranked_only = filters.ranked_only;
    }
    if (sortBy) params.sortBy = sortBy;
    if (sortOrder) params.sortOrder = sortOrder;
    return api.get('/public/players', { params });
  },
  getTournaments: (page: number = 1, filters?: any) => {
    const params: any = { page };
    if (filters) {
      if (filters.name) params.name = filters.name;
      if (filters.status) params.status = filters.status;
      if (filters.type) params.type = filters.type;
      if (filters.my_tournaments) params.my_tournaments = filters.my_tournaments;
    }
    return api.get('/public/tournaments', { params });
  },
  getTournamentById: (id: string) => api.get(`/public/tournaments/${id}`),
  getTournamentParticipants: (id: string) => api.get(`/public/tournaments/${id}/participants`),
  getTournamentMatches: (id: string) => api.get(`/public/tournaments/${id}/matches`),
  getTournamentUnrankedAssets: (id: string) => api.get(`/public/tournaments/${id}/unranked-assets`),
  getMatch: (id: string) => api.get(`/matches/${id}`),
  getDebug: () => api.get('/public/debug'),
  getPlayerOfMonth: () => api.get('/public/player-of-month'),
  getGlobalStatistics: () => api.get('/statistics/global'),
};

export const reportConfidence1Replay = (
  replayId: string,
  winner_choice: 'I won' | 'I lost',
  comments?: string,
  rating?: number,
  tournament_match_id?: string
) => matchService.reportConfidence1Replay(replayId, winner_choice, comments, rating, tournament_match_id);

export const cancelConfidence1Replay = (replayId: string) =>
  matchService.cancelConfidence1Replay(replayId);

export { api };
export default api;
