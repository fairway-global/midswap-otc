/**
 * NotificationsContext — bell feed for signed-in users, fed by Supabase
 * Realtime on `public.notifications`.
 *
 *   1. Wait for user — `auth.uid()` must be present before subscribing or
 *      the filter binds to `eq.` and matches nothing silently.
 *   2. Fetch the last 50 rows via REST so the bell is correct on tab open.
 *   3. Subscribe to INSERTs filtered by `user_id` (RLS re-applies SELECT
 *      server-side, so a malicious client subscribing to another user's id
 *      gets nothing).
 *   4. Toast each newly-arriving notification.
 *   5. Cleanup: `supabase.removeChannel(channel)` on signout/unmount —
 *      otherwise the channel keeps retrying with stale auth.
 *
 * No-ops when Supabase isn't configured or the user is signed out, mirroring
 * the existing AuthContext pattern.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export type NotificationType =
  | 'quote_submitted'
  | 'quote_countered'
  | 'quote_accepted'
  | 'quote_rejected'
  | 'rfq_cancelled'
  | 'settlement_started'
  | 'swap_bob_deposited'
  | 'swap_alice_claimed'
  | 'settlement_completed'
  | 'swap_expired'
  | 'swap_reclaimed';

export interface Notification {
  id: string;
  user_id: string;
  rfq_id: string | null;
  swap_hash: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationsValue {
  readonly notifications: ReadonlyArray<Notification>;
  readonly unreadCount: number;
  readonly enabled: boolean;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | undefined>(undefined);

const RECENT_LIMIT = 50;

export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const toast = useToast();
  const [notifications, setNotifications] = useState<ReadonlyArray<Notification>>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseId = user?.supabaseId;

  const enabled = supabaseConfigured && Boolean(supabaseId);

  useEffect(() => {
    if (!enabled || !supabaseId) {
      // Clear state when signed out so a re-login doesn't show stale items.
      setNotifications([]);
      return;
    }

    let cancelled = false;

    // 1. Initial fetch — recent 50 (read + unread). Keeps the bell honest
    //    on tab open; Realtime only sees rows after subscribe time.
    void (async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', supabaseId)
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT);
      if (cancelled) return;
      if (error) {
        console.warn('[notifications] initial fetch failed', error);
        return;
      }
      setNotifications((data ?? []) as Notification[]);
    })();

    // 2. Subscribe to INSERTs for this user only. RLS re-applies SELECT on
    //    the broadcast layer so the filter is safe.
    const channel = supabase
      .channel(`notifications:${supabaseId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${supabaseId}`,
        },
        (payload) => {
          const row = payload.new as Notification;
          setNotifications((prev) => {
            // Defend against dupes (initial-fetch + subscribe race window).
            if (prev.some((n) => n.id === row.id)) return prev;
            return [row, ...prev].slice(0, RECENT_LIMIT);
          });
          // Toast nudges the user without making them open the bell.
          toast.info(row.title);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      // Critical: without removeChannel, the channel keeps retrying with the
      // stale token after signOut.
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [enabled, supabaseId, toast]);

  const markRead = useCallback(
    async (id: string): Promise<void> => {
      if (!enabled) return;
      const now = new Date().toISOString();
      // Optimistic — immediate UI response, server is the truth.
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)),
      );
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('id', id);
      if (error) {
        console.warn('[notifications] markRead failed', error);
        // Roll back the optimistic update on failure.
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: null } : n)),
        );
      }
    },
    [enabled],
  );

  const markAllRead = useCallback(async (): Promise<void> => {
    if (!enabled || !supabaseId) return;
    const ids = notifications.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: now })),
    );
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .in('id', ids);
    if (error) {
      console.warn('[notifications] markAllRead failed', error);
    }
  }, [enabled, notifications, supabaseId]);

  const unreadCount = useMemo(
    () => notifications.reduce((acc, n) => (n.read_at ? acc : acc + 1), 0),
    [notifications],
  );

  const value = useMemo<NotificationsValue>(
    () => ({ notifications, unreadCount, enabled, markRead, markAllRead }),
    [notifications, unreadCount, enabled, markRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = (): NotificationsValue => {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return ctx;
};
