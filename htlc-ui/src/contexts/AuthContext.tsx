/**
 * AuthContext — Supabase-backed identity for the KAAMOS OTC layer.
 *
 *   1. Subscribes to Supabase session changes (handles reload-restore by default).
 *   2. When a session appears, fetches /api/auth/me to hydrate the OtcUser.
 *
 * No global wallet binding. In the per-deal model, wallets are committed
 * at the moment of quote/counter (the modal captures the connected
 * receive-chain wallet and snapshots it onto the quote). This frees users
 * to use a different wallet per deal without "binding the account" first.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { otcApi, type OtcUserPublic } from '../api/orchestrator-client';

interface AuthValue {
  readonly supaSession: Session | null;
  readonly user: OtcUserPublic | null;
  readonly loading: boolean;
  readonly configured: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(username: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export const useAuthContext = (): AuthValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used inside <AuthProvider>');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [supaSession, setSupaSession] = useState<Session | null>(null);
  const [user, setUser] = useState<OtcUserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  // 1) Restore + subscribe to Supabase session.
  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSupaSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSupaSession(sess);
      if (!sess) setUser(null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 2) When session truthy → /api/auth/me.
  useEffect(() => {
    if (!supaSession) return;
    let cancelled = false;
    void (async () => {
      try {
        const { user: me } = await otcApi.me();
        if (cancelled) return;
        setUser(me);
      } catch (e) {
        console.warn('[auth] /auth/me failed', e);
        if (!cancelled) setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supaSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabaseConfigured) {
      throw new Error('Supabase not configured. Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.');
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signUp = useCallback(
    async (username: string, email: string, password: string): Promise<void> => {
      if (!supabaseConfigured) {
        throw new Error('Supabase not configured. Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.');
      }
      // Server-side signup auto-confirms the email (admin.createUser w/
      // email_confirm:true). No inbox round-trip — we sign the user in
      // immediately after to land them in a session.
      await otcApi.signup({ username, email, password });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },
    [],
  );

  const signOut = useCallback(async () => {
    if (!supabaseConfigured) return;
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      supaSession,
      user,
      loading,
      configured: supabaseConfigured,
      signIn,
      signUp,
      signOut,
    }),
    [supaSession, user, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
