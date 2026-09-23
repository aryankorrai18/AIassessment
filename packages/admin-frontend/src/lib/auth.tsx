import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "./api";
import type { AdminUser } from "./types";

interface AuthValue {
  admin: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAdmin: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAdmin = useCallback(async () => {
    try {
      setAdmin(await api<AdminUser>("/auth/me"));
    } catch {
      setAdmin(null);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setAdmin(null));
    refreshAdmin().finally(() => setLoading(false));
  }, [refreshAdmin]);

  const login = useCallback(async (email: string, password: string) => {
    setAdmin(await api<AdminUser>("/auth/login", { body: { email, password } }));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setAdmin(null);
    }
  }, []);

  return <AuthContext.Provider value={{ admin, loading, login, logout, refreshAdmin }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
