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
