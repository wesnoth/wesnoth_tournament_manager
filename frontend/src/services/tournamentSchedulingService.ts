import { api } from './api';

export const tournamentSchedulingService = {
  /** Create a multi-slot proposal for a phase-engine series. */
  proposeSeriesSlots: async (tournamentId: string, seriesId: string, slotDatetimes: string[], notes?: string | null) => {
    const response = await api.post(
      `/tournament-scheduling/tournament/${tournamentId}/series/${seriesId}/propose-slots`,
      { slot_datetimes: slotDatetimes, notes: notes ?? null }
    );
    return response.data;
  },

  confirmSeriesSlots: async (tournamentId: string, seriesId: string, proposalId: string, confirmedSlotIds: string[] = []) => {
    const response = await api.post(
      `/tournament-scheduling/tournament/${tournamentId}/series/${seriesId}/confirm-slots`,
      { proposal_id: proposalId, confirmed_slot_ids: confirmedSlotIds }
    );
    return response.data;
  },

  getSeriesProposal: async (tournamentId: string, seriesId: string) => {
    const response = await api.get(
      `/tournament-scheduling/tournament/${tournamentId}/series/${seriesId}/proposal`
    );
    return response.data;
  },

  getSeriesParticipantsAvailability: async (tournamentId: string, seriesId: string) => {
    const response = await api.get(
      `/tournament-scheduling/tournament/${tournamentId}/series/${seriesId}/participants-availability`
    );
    return response.data;
  },

  modifyProposal: async (proposalId: string, slotDatetimes: string[], notes?: string | null) => {
    const response = await api.put(`/tournament-scheduling/proposals/${proposalId}`, {
      slotDatetimes,
      notes: notes ?? null,
    });
    return response.data;
  },

  counterPropose: async (proposalId: string, slotDatetimes: string[], notes?: string | null) => {
    const response = await api.post(`/tournament-scheduling/proposals/${proposalId}/counter-propose`, {
      slotDatetimes,
      notes: notes ?? null,
    });
    return response.data;
  },

  rejectProposal: async (proposalId: string, notes?: string | null) => {
    const response = await api.post(`/tournament-scheduling/proposals/${proposalId}/reject`, {
      notes: notes ?? null,
    });
    return response.data;
  },

  cancelConfirmation: async (proposalId: string) => {
    const response = await api.post(`/tournament-scheduling/proposals/${proposalId}/cancel-confirmation`);
    return response.data;
  },

  /** Create a multi-slot proposal for an entire tournament round match. */

  /**
   * Propose multiple slots for a round match (entire series)
   */
  proposeRoundMatchSlots: async (
    tournamentId: string,
    roundMatchId: string,
    slotDatetimes: string[],
    notes?: string | null
  ) => {
    const response = await api.post(
      `/tournament-scheduling/tournament/${tournamentId}/round-match/${roundMatchId}/propose-slots`,
      {
        slot_datetimes: slotDatetimes,
        notes: notes ?? null
      }
    );
    return response.data;
  },

  /**
   * Propose multiple slots for a single match (individual game)
   */
  proposeMatchSlots: async (
    tournamentId: string,
    matchId: string,
    slotDatetimes: string[],
    notes?: string | null
  ) => {
    const response = await api.post(
      `/tournament-scheduling/tournament/${tournamentId}/match/${matchId}/propose-slots`,
      {
        slot_datetimes: slotDatetimes,
        notes: notes ?? null
      }
    );
    return response.data;
  },

  /**
   * Confirm an existing proposal for a round match
   * All slots in the proposal are confirmed in one action
   */
  confirmRoundMatchSlots: async (
    tournamentId: string,
    roundMatchId: string,
    proposalId: string,
    confirmedSlotIds: string[] = []
  ) => {
    const response = await api.post(
      `/tournament-scheduling/tournament/${tournamentId}/round-match/${roundMatchId}/confirm-slots`,
      {
        proposal_id: proposalId,
        confirmed_slot_ids: confirmedSlotIds
      }
    );
    return response.data;
  },

  /**
   * Confirm an existing proposal for a match with partial slot selection
   * Can select which slots to confirm from the proposed set
   */
  confirmMatchSlots: async (
    tournamentId: string,
    matchId: string,
    proposalId: string,
    confirmedSlotIds: string[] = []
  ) => {
    const response = await api.post(
      `/tournament-scheduling/tournament/${tournamentId}/match/${matchId}/confirm-slots`,
      {
        proposal_id: proposalId,
        confirmed_slot_ids: confirmedSlotIds
      }
    );
    return response.data;
  },

  /**
   * Get active proposal with slots and confirmations for a round match
   */
  getRoundMatchProposal: async (tournamentId: string, roundMatchId: string) => {
    const response = await api.get(
      `/tournament-scheduling/tournament/${tournamentId}/round-match/${roundMatchId}/proposal`
    );
    return response.data;
  },

  /**
   * Get active proposal for a match
   */
  getMatchProposal: async (tournamentId: string, matchId: string) => {
    const response = await api.get(
      `/tournament-scheduling/tournament/${tournamentId}/match/${matchId}/proposal`
    );
    return response.data;
  },

  /**
   * Get all participants' timezone and availability for a round match
   */
  getRoundMatchParticipantsAvailability: async (tournamentId: string, roundMatchId: string) => {
    const response = await api.get(
      `/tournament-scheduling/tournament/${tournamentId}/round-match/${roundMatchId}/participants-availability`
    );
    return response.data;
  },

  /**
   * Get all participants' timezone and availability for a match
   */
  getMatchParticipantsAvailability: async (tournamentId: string, matchId: string) => {
    const response = await api.get(
      `/tournament-scheduling/tournament/${tournamentId}/match/${matchId}/participants-availability`
    );
    return response.data;
  },

  /**
   * Cancel a proposal (delete it completely)
   */
  cancelProposal: async (proposalId: string) => {
    const response = await api.delete(
      `/tournament-scheduling/proposals/${proposalId}`
    );
    return response.data;
  }
};
