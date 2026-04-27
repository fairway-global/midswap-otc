/**
 * Supabase admin client (service-role) — single shared instance for the
 * orchestrator. Used by the auth plugin (JWT verification, admin signup)
 * and the notification fanout. Service role bypasses RLS, so notification
 * INSERTs need no per-table policy.
 *
 * If env is missing the client still loads with placeholder URLs so the
 * legacy /api/swaps surface keeps serving — `enabled` flips to false and
 * downstream callers (auth plugin, notifier) no-op.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const supabaseAdminEnabled: boolean = Boolean(url && key);

export const supabaseAdmin: SupabaseClient = createClient(
  url || 'http://invalid',
  key || 'invalid',
  { auth: { autoRefreshToken: false, persistSession: false } },
);
