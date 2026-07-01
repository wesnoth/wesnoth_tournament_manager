import { api } from './api';

export interface CreateChallengeProposalPayload {
  challenged_user_id: string;
  slot_datetimes: string[];
  notes?: string;
  visibility?: 'private' | 'public';
}

export const challengeSchedulingService = {
  listProposals: async (mode: 'incoming' | 'outgoing' | 'all' = 'all') => {
    const response = await api.get('/challenges/proposals', { params: { mode } });
    return response.data;
  },

  getProposal: async (proposalId: string) => {
    const response = await api.get(`/challenges/proposals/${proposalId}`);
    return response.data;
  },

  getParticipantsAvailability: async (proposalId: string) => {
    const response = await api.get(`/challenges/proposals/${proposalId}/participants-availability`);
    return response.data;
  },

  createProposal: async (payload: CreateChallengeProposalPayload) => {
    const response = await api.post('/challenges/proposals', payload);
    return response.data;
  },

  confirmSlots: async (proposalId: string, confirmedSlotIds: string[]) => {
    const response = await api.post(`/challenges/proposals/${proposalId}/confirm-slots`, {
      confirmed_slot_ids: confirmedSlotIds,
    });
    return response.data;
  },

  counterPropose: async (
    proposalId: string,
    payload: { slot_datetimes: string[]; notes?: string; visibility?: 'private' | 'public' }
  ) => {
    const response = await api.post(`/challenges/proposals/${proposalId}/counter-propose`, payload);
    return response.data;
  },

  cancelProposal: async (proposalId: string) => {
    const response = await api.post(`/challenges/proposals/${proposalId}/cancel`);
    return response.data;
  },
};

