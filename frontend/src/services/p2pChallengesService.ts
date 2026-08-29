import { api } from './api';

export const p2pChallengesService = {
  listWaiting: async () => (await api.get('/challenges/waiting')).data,
  getMyWaiting: async () => (await api.get('/challenges/waiting/me')).data,
  publishWaiting: async (availableUntil?: string) => (await api.post('/challenges/waiting', { available_until: availableUntil })).data,
  cancelWaiting: async () => (await api.delete('/challenges/waiting')).data,
  /**
   * Create a new P2P challenge proposal with the selected UTC slots.
   */
  proposeChallenge: async (
    challengedUserId: string,
    slotDatetimes: string[],
    notes?: string
  ) => {
    const response = await api.post('/challenges/proposals', {
      challenged_user_id: challengedUserId,
      slot_datetimes: slotDatetimes,
      ...(notes && { notes }),
      visibility: 'public',
    });
    return response.data;
  },

  /**
   * Confirm the slots selected by the challenged player, or reject them all.
   */
  confirmSlots: async (proposalId: string, confirmedSlotIds: string[]) => {
    const response = await api.post(`/challenges/proposals/${proposalId}/confirm-slots`, {
      confirmed_slot_ids: confirmedSlotIds,
    });
    return response.data;
  },

  /**
   * Replace the current proposal with a counter-proposal from the challenged player.
   */
  counterPropose: async (
    proposalId: string,
    slotDatetimes: string[],
    notes?: string
  ) => {
    const response = await api.post(`/challenges/proposals/${proposalId}/counter-propose`, {
      slot_datetimes: slotDatetimes,
      ...(notes && { notes }),
      visibility: 'public',
    });
    return response.data;
  },

  /**
   * Cancel a proposal owned by the authenticated proposer.
   */
  cancelProposal: async (proposalId: string) => {
    const response = await api.post(`/challenges/proposals/${proposalId}/cancel`);
    return response.data;
  },

  /**
   * Replace the slots and notes of a pending proposal owned by the proposer.
   */
  updateProposal: async (
    proposalId: string,
    slotDatetimes: string[],
    notes?: string
  ) => {
    const response = await api.put(`/challenges/proposals/${proposalId}`, {
      slot_datetimes: slotDatetimes,
      // Send null when the field is cleared so the backend removes old notes.
      notes: notes || null,
    });
    return response.data;
  },

  /**
   * Fetch a proposal visible to the authenticated proposer or challenged player.
   */
  getProposal: async (proposalId: string) => {
    const response = await api.get(`/challenges/proposals/${proposalId}`);
    return response.data;
  },

  /**
   * List proposals visible to the current user, optionally by direction.
   */
  listProposals: async (mode: 'incoming' | 'outgoing' | 'all' = 'all') => {
    const response = await api.get('/challenges/proposals', {
      params: { mode },
    });
    return response.data;
  },

  /**
   * Find active P2P and tournament slots that should be blocked in a grid.
   */
  getOccupiedSlots: async (userIds: string[], excludeProposalId?: string) => {
    const response = await api.get('/challenges/occupied-slots', {
      params: {
        user_ids: userIds.join(','),
        ...(excludeProposalId ? { exclude_proposal_id: excludeProposalId } : {}),
      },
    });
    return response.data;
  },

};
