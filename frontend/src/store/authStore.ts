import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarInitials: string;
  role: string;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setUser: (user: User) => void;
  setToken: (token: string) => void;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setUser:  (user)  => set({ user, isAuthenticated: true }),
      setToken: (token) => set({ token }),
      setAuth:  (user, token) => set({ user, token, isAuthenticated: true }),
      logout:   () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'fq_auth',
      partialize: (s) => ({ token: s.token, user: s.user, isAuthenticated: s.isAuthenticated }),
    }
  )
);

export default useAuthStore;
