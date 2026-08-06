import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthRole, User } from '@csb/shared';

interface AuthState {
  token: string | null;
  refresh_token: string | null;
  user: Omit<User, 'created_at'> | null;
  isAuthenticated: boolean;
  login: (token: string, refresh_token: string, user: Omit<User, 'created_at'>) => void;
  /** O usuário é opcional: só o refresh manda um, e quando manda ele é mais novo. */
  setToken: (token: string, user?: Omit<User, 'created_at'>) => void;
  logout: () => void;
  hasRole: (...roles: AuthRole[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refresh_token: null,
      user: null,
      isAuthenticated: false,

      login: (token, refresh_token, user) =>
        set({ token, refresh_token, user, isAuthenticated: true }),

      setToken: (token, user) => set((estado) => ({ token, user: user ?? estado.user })),

      logout: () =>
        set({ token: null, refresh_token: null, user: null, isAuthenticated: false }),

      hasRole: (...roles) => {
        const { user } = get();
        if (!user) return false;
        return roles.includes(user.role);
      },
    }),
    {
      name: 'csb-auth',
      partialize: (state) => ({
        token: state.token,
        refresh_token: state.refresh_token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
