/**
 * Notification fanout — server-side bell feed for signed-in users.
 *
 * Writes to the Supabase `public.notifications` table (NOT the local SQLite),
 * which the frontend subscribes to via Supabase Realtime. Service role bypass
 * means we don't need an INSERT RLS policy.
 *
 * All inserts are FIRE-AND-FORGET. The chain-authoritative path
 * (`POST /api/swaps`, `PATCH /api/swaps/:hash`) MUST NOT block on a
 * Supabase round-trip — every call is `void promise.catch(...)`.
 */

import { supabaseAdmin, supabaseAdminEnabled } from '../lib/supabase-admin.js';

// Structural type — both pino Logger and Fastify's FastifyBaseLogger satisfy
// it, so we don't have to import either and tangle the dep graph.
interface NotifierLogger {
  warn(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

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

export interface NotifyInput {
  /** Supabase auth.users.id values — NOT otc_users.id. Resolve via OtcStore. */
  recipientSupabaseIds: ReadonlyArray<string>;
  rfqId: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** App-relative URL the bell click should navigate to, e.g. `/rfq/<id>`. */
  link?: string;
  swapHash?: string;
}

export interface Notifier {
  notify(input: NotifyInput): void;
  /**
   * One-shot startup probe. Pings `public.notifications` once and logs a
   * loud, actionable warning if the table is missing — caught the
   * "forgot to run the SQL migration" footgun in the very first end-to-end
   * test, where the only signal was a per-event warn buried mid-log.
   */
  probe(): Promise<void>;
}

export const createNotifier = (log?: NotifierLogger): Notifier => {
  if (!supabaseAdminEnabled) {
    if (log) {
      log.warn('[notifier] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — notifications disabled');
    }
    return { notify: () => undefined, probe: async () => undefined };
  }

  return {
    async probe() {
      const { error } = await supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true });
      if (!error) {
        log?.info('[notifier] notifications table reachable — Realtime fanout enabled');
        return;
      }
      // PGRST205 = relation not found in PostgREST schema cache → migration
      // never ran. Big banner so it's impossible to miss in pino-pretty output.
      const banner = [
        '',
        '────────────────────────────────────────────────────────────────────',
        '  ⚠  NOTIFICATIONS DISABLED — Supabase `public.notifications` missing',
        '',
        '     Run this once in your Supabase SQL editor:',
        '       cat htlc-orchestrator/supabase/notifications.sql',
        '',
        `     Probe error: ${error.code ?? '?'} ${error.message}`,
        '────────────────────────────────────────────────────────────────────',
        '',
      ].join('\n');
      log?.error({ err: error }, banner);
    },
    notify({ recipientSupabaseIds, rfqId, type, title, body, link, swapHash }) {
      // Dedupe + drop empties. The originator and the selected provider can't
      // be the same person (acceptQuote forbids self-quote) but countering a
      // single-thread RFQ where the originator and provider both interact
      // means de-duping is cheap insurance.
      const recipients = Array.from(new Set(recipientSupabaseIds.filter(Boolean)));
      if (recipients.length === 0) return;

      const rows = recipients.map((uid) => ({
        user_id: uid,
        rfq_id: rfqId,
        swap_hash: swapHash ?? null,
        type,
        title,
        body: body ?? null,
        link: link ?? null,
      }));

      // Fire-and-forget. We deliberately do NOT await — the calling path is
      // either a request handler whose latency we care about, or a watcher
      // tick that should not block the next iteration.
      void supabaseAdmin
        .from('notifications')
        .insert(rows)
        .then(({ error }) => {
          if (error && log) {
            log.warn({ err: error, type, rfqId, count: rows.length }, '[notifier] insert failed');
          }
        });
    },
  };
};
