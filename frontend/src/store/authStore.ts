import { create } from 'zustand';
import type { User } from '../types/index.js';
import api from '../services/api.js';

interface AuthState {
  token: string | null;
  userId: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isStreamer: boolean;
  isTournamentModerator: boolean;
  enableRanked: boolean;
  isValidating: boolean;
  setToken: (token: string) => void;
  setUserId: (userId: string) => void;
  setUser: (user: User) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setIsStreamer: (value: boolean) => void;
  setIsTournamentModerator: (value: boolean) => void;
  setEnableRanked: (value: boolean) => void;
  logout: () => void;
  validateToken: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('token'),
  userId: localStorage.getItem('userId'),
  user: null,
  isAuthenticated: !!localStorage.getItem('token'),
  isAdmin: localStorage.getItem('isAdmin') === 'true',
  isStreamer: localStorage.getItem('isStreamer') === 'true',
  isTournamentModerator: localStorage.getItem('isTournamentModerator') === 'true',
  enableRanked: localStorage.getItem('enableRanked') === 'true',
  isValidating: false,

  setToken: (token: string) => {
    localStorage.setItem('token', token);
    set({ token, isAuthenticated: true });
  },

  setUserId: (userId: string) => {
    localStorage.setItem('userId', userId);
    set({ userId });
  },

  setUser: (user: User) => {
    set({ user });
  },

  setIsAdmin: (isAdmin: boolean) => {
    localStorage.setItem('isAdmin', isAdmin.toString());
    set({ isAdmin });
  },

  setIsStreamer: (value: boolean) => {
    localStorage.setItem('isStreamer', value.toString());
    set({ isStreamer: value });
  },

  setIsTournamentModerator: (value: boolean) => {
    localStorage.setItem('isTournamentModerator', value.toString());
    set({ isTournamentModerator: value });
  },

  setEnableRanked: (value: boolean) => {
    localStorage.setItem('enableRanked', value.toString());
    set({ enableRanked: value });
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('isStreamer');
    localStorage.removeItem('isTournamentModerator');
    localStorage.removeItem('enableRanked');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('isAdmin');
    set({ token: null, userId: null, user: null, isAuthenticated: false, isAdmin: false, isStreamer: false, isTournamentModerator: false, enableRanked: false });
  },

  validateToken: async () => {
    const state = get();
    
    if (!state.token) return false;

    set({ isValidating: true });

    try {
      const response = await api.get('/auth/validate-token');
      
      if (response.data && response.data.valid) {
        const isAdmin = response.data.isAdmin || false;
        const isStreamer = response.data.isStreamer || false;
        const isTournamentModerator = response.data.isTournamentModerator || false;

        localStorage.setItem('isTournamentModerator', isTournamentModerator.toString());
        localStorage.setItem('isStreamer', isStreamer.toString());
        
        if (response.data.nickname && !state.user) {
          set({ 
            user: { 
              id: response.data.userId,
              nickname: response.data.nickname,
            } as User,
            isAdmin,
            isStreamer,
            isTournamentModerator,
            userId: response.data.userId
          });
        } else {
          set({ isAdmin, isStreamer, isTournamentModerator, userId: response.data.userId });
        }
        set({ isValidating: false });
        return true;
      }
      
      state.logout();
      set({ isValidating: false });
      return false;
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        state.logout();
      }
      set({ isValidating: false });
      return false;
    }
  },
}));
