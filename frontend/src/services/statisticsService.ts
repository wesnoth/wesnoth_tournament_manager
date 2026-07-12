import { api } from './api.js';

export const statisticsService = {
  // Get configuration (including min games threshold)
  getConfig: async () => {
    const response = await api.get('/statistics/config');
    return response.data;
  },

  // Get faction statistics by map
  getFactionByMapStats: async () => {
    const response = await api.get('/statistics/faction-by-map');
    return response.data;
  },

  // Get matchup statistics (unbalanced matchups)
  getMatchupStats: async (minGames = 5) => {
    const response = await api.get('/statistics/matchups', {
      params: { minGames },
    });
    return response.data;
  },

  // Get global faction winrates
  getGlobalFactionStats: async (minGames = 5) => {
    const response = await api.get('/statistics/faction-global', { params: { minGames } });
    return response.data;
  },

  // Get map balance statistics
  getMapBalanceStats: async (minGames = 5) => {
    const response = await api.get('/statistics/map-balance', { params: { minGames } });
    return response.data;
  },

  // Get statistics for a specific faction
  getFactionStats: async (factionId: string) => {
    const response = await api.get(`/statistics/faction/${factionId}`);
    return response.data;
  },

  // Get statistics for a specific map
  getMapStats: async (mapId: string) => {
    const response = await api.get(`/statistics/map/${mapId}`);
    return response.data;
  },

  // ===== BALANCE HISTORY =====
  
  // Get balance events with optional filters
  getBalanceEvents: async (filters?: { factionId?: string; mapId?: string; eventType?: string; limit?: number; offset?: number }) => {
    const response = await api.get('/statistics/history/events', { params: filters });
    return response.data;
  },

  // Get balance trend for a specific matchup over date range
  getBalanceTrend: async (mapId: string, factionId: string, opponentFactionId: string, dateFrom: string, dateTo: string) => {
    const response = await api.get('/statistics/history/trend', {
      params: { mapId, factionId, opponentFactionId, dateFrom, dateTo },
    });
    return response.data;
  },

  // Get balance event forward impact (from event date onwards)
  getEventImpact: async (eventId: string) => {
    const response = await api.get(`/statistics/history/events/${eventId}/impact`);
    return response.data;
  },

  // Create a new balance event (admin only)
  createBalanceEvent: async (event: {
    event_date: string;
    event_type: 'BUFF' | 'NERF' | 'REWORK' | 'HOTFIX' | 'GENERAL_BALANCE_CHANGE';
    description: string;
    faction_id?: string;
    map_id?: string;
    patch_version?: string;
    notes?: string;
  }) => {
    const response = await api.post('/statistics/history/events', event);
    return response.data;
  },

  // Update a balance event
  updateBalanceEvent: async (eventId: string, event: {
    event_date: string;
    event_type: string;
    description: string;
    faction_id?: string;
    map_id?: string;
    patch_version?: string;
    notes?: string;
  }) => {
    const response = await api.put(`/statistics/history/events/${eventId}`, event);
    return response.data;
  },

  // Get snapshot for a specific date
  getSnapshot: async (date: string, minGames = 2) => {
    const response = await api.get('/statistics/history/snapshot', {
      params: { date, minGames },
    });
    return response.data;
  },
};
