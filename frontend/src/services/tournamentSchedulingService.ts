import { api } from './api';

export const tournamentSchedulingService = {
  /** Create a multi-slot proposal for an entire tournament round match. */

  /**
   * Propose multiple slots for a round match (entire series)
   */
  proposeRoundMatchSlots: async (
    tournamentId: string,
    roundMatchId: string,
    slotDatetimes: string[],
    notes?: string
  ) => {
    const response = await api.post(
      `/tournament-scheduling/tournament/${tournamentId}/round-match/${roundMatchId}/propose-slots`,
      {
        slot_datetimes: slotDatetimes,
        ...(notes && { notes })
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
    notes?: string
  ) => {
    const response = await api.post(
      `/tournament-scheduling/tournament/${tournamentId}/match/${matchId}/propose-slots`,
      {
        slot_datetimes: slotDatetimes,
        ...(notes && { notes })
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
