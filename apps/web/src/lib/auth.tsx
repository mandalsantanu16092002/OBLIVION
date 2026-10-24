import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Role } from '@onboardiq/shared';
import { api, setActingRole, setToken, setUnauthorizedHandler } from './api';

export interface User {
  id: number;
  email: string;
  full_name: string;
  roles: Role[];
}

interface AuthCtx {
  user: User | null;
  role: Role | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (full_name: string, email: string, password: string) => Promise<User>;
  logout: () => void;
  switchRole: (r: Role) => void;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
const KEY = 'onboardiq.session';

function load(): { token: string; user: User; role: Role } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = load();
  const [user, setUser] = useState<User | null>(initial?.user ?? null);
  const [role, setRole] = useState<Role | null>(initial?.role ?? null);
  const [ready, setReady] = useState(false);

  if (initial && !ready) {
    setToken(initial.token);
    setActingRole(initial.role);
  }

  const persist = (token: string, u: User, r: Role) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ token, user: u, role: r }));
    } catch {
      /* private mode: session lives in memory only */
    }
  };

  const logout = useCallback(() => {
    setToken(null);
    setActingRole(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
    setRole(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!initial) return setReady(true);
    api<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => logout())
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (token: string, u: User) => {
    const r = u.roles[0];
    setToken(token);
    setActingRole(r);
    persist(token, u, r);
    setUser(u);
    setRole(r);
    return u;
  };

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      role,
      ready,
      login: async (email, password) => {
        const r = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } });
        return start(r.token, r.user);
      },
      register: async (full_name, email, password) => {
        const r = await api<{ token: string; user: User }>('/auth/register', { body: { full_name, email, password } });
        return start(r.token, r.user);
      },
      logout,
      switchRole: (r: Role) => {
        setActingRole(r);
        setRole(r);
        const s = load();
        if (s) persist(s.token, s.user, r);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, role, ready, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
