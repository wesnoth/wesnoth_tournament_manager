import { api } from './api.js';

export const playerStatisticsService = {
  // Get global player statistics
  getGlobalStats: async (playerId: string, side = 0) => {
    const response = await api.get(`/player-statistics/player/${playerId}/global`, {
      params: { side },
    });
    return response.data;
  },

  // Get player statistics by map
  getStatsByMap: async (playerId: string, minGames = 2, side = 0) => {
    const response = await api.get(`/player-statistics/player/${playerId}/by-map`, {
      params: { minGames, side },
    });
    return response.data;
  },

  // Get player statistics by faction
  getStatsByFaction: async (playerId: string, minGames = 2, side = 0) => {
    const response = await api.get(`/player-statistics/player/${playerId}/by-faction`, {
      params: { minGames, side },
    });
    return response.data;
  },

  // Get player statistics by faction matchup
  getStatsByMatchup: async (playerId: string, minGames = 2, side = 0) => {
    const response = await api.get(`/player-statistics/player/${playerId}/by-matchup`, {
      params: { minGames, side },
    });
    return response.data;
  },

  // Get head-to-head vs specific opponent
  getHeadToHead: async (playerId: string, opponentId: string, side = 0) => {
    const response = await api.get(`/player-statistics/player/${playerId}/vs-player/${opponentId}`, {
      params: { side },
    });
    return response.data;
  },

  // Get player stats on specific map
  getMapStats: async (playerId: string, mapId: string, side = 0) => {
    const response = await api.get(`/player-statistics/player/${playerId}/map/${mapId}`, {
      params: { side },
    });
    return response.data;
  },

  // Get player stats with specific faction
  getFactionStats: async (playerId: string, factionId: string, side = 0) => {
    const response = await api.get(`/player-statistics/player/${playerId}/faction/${factionId}`, {
      params: { side },
    });
    return response.data;
  },

  // Get player stats with faction on map
  getMapFactionStats: async (playerId: string, mapId: string, factionId: string, side = 0) => {
    const response = await api.get(`/player-statistics/player/${playerId}/map/${mapId}/faction/${factionId}`, {
      params: { side },
    });
    return response.data;
  },

  // Get recent opponents
  getRecentOpponents: async (playerId: string, limit = 10, side = 0) => {
    const response = await api.get(`/player-statistics/player/${playerId}/recent-opponents`, {
      params: { limit, side },
    });
    return response.data;
  },
};

