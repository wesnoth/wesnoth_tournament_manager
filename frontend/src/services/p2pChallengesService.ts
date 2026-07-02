import { api } from './api';

export const p2pChallengesService = {
  /**
   * Create a new P2P challenge proposal with slots
   */
  proposeChallenge: async (
    challengedUserId: string,
    slotDatetimes: string[],
    notes?: string,
    visibility: 'public' | 'private' = 'private'
  ) => {
    const response = await api.post('/challenges/proposals', {
      challenged_user_id: challengedUserId,
      slot_datetimes: slotDatetimes,
      ...(notes && { notes }),
      visibility,
    });
    return response.data;
  },

  /**
   * Confirm selected slots for a challenge proposal
   */
  confirmSlots: async (proposalId: string, confirmedSlotIds: string[]) => {
    const response = await api.post(`/challenges/proposals/${proposalId}/confirm-slots`, {
      confirmed_slot_ids: confirmedSlotIds,
    });
    return response.data;
  },

  /**
   * Create a counter-proposal for a challenge
   */
  counterPropose: async (
    proposalId: string,
    slotDatetimes: string[],
    notes?: string,
    visibility: 'public' | 'private' = 'private'
  ) => {
    const response = await api.post(`/challenges/proposals/${proposalId}/counter-propose`, {
      slot_datetimes: slotDatetimes,
      ...(notes && { notes }),
      visibility,
    });
    return response.data;
  },

  /**
   * Cancel a challenge proposal
   */
  cancelProposal: async (proposalId: string) => {
    const response = await api.post(`/challenges/proposals/${proposalId}/cancel`);
    return response.data;
  },

  /**
   * Update an existing challenge proposal (only proposer can do this)
   */
  updateProposal: async (
    proposalId: string,
    slotDatetimes: string[],
    notes?: string
  ) => {
    const response = await api.put(`/challenges/proposals/${proposalId}`, {
      slot_datetimes: slotDatetimes,
      ...(notes && { notes }),
    });
    return response.data;
  },

  /**
   * Get a specific P2P proposal
   */
  getProposal: async (proposalId: string) => {
    const response = await api.get(`/challenges/proposals/${proposalId}`);
    return response.data;
  },

  /**
   * List all P2P proposals for the current user
   */
  listProposals: async (mode: 'incoming' | 'outgoing' | 'all' = 'all') => {
    const response = await api.get('/challenges/proposals', {
      params: { mode },
    });
    return response.data;
  },

  /**
   * Get participants availability for a challenge proposal
   */
  getParticipantsAvailability: async (proposalId: string) => {
    const response = await api.get(`/challenges/proposals/${proposalId}/participants-availability`);
    return response.data;
  },
};
