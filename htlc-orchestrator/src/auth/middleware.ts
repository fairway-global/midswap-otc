import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { OtcStore } from '../db.js';
import type { OtcUser } from '../types.js';

declare module 'fastify' {
  interface FastifyRequest {
    otcUser?: OtcUser;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    supabase: SupabaseClient;
  }
}

interface SupabaseAuthOptions {
  store: OtcStore;
}

/**
 * Verifies `Authorization: Bearer <jwt>` against Supabase, auto-provisions
 * the corresponding `otc_users` row, and attaches the OtcUser to the request.
 *
 * Use as a route preHandler:
 *   app.get('/api/auth/me', { preHandler: app.requireAuth }, ...)
 *
 * If SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing, the plugin still
 * loads but every protected request is rejected with 503 — the orchestrator
 * keeps serving the existing /api/swaps surface unauthenticated, so legacy
 * paste-bundle flows continue to work.
 */
const pluginImpl: FastifyPluginAsync<SupabaseAuthOptions> = async (app, { store }) => {
    const url = process.env.SUPABASE_URL ?? '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const enabled = Boolean(url && key);
    if (!enabled) {
      app.log.warn(
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — OTC auth disabled (legacy /api/swaps still served)',
      );
    }

    const supabase = createClient(url || 'http://invalid', key || 'invalid', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    app.decorate('supabase', supabase);

    app.decorateRequest('otcUser', undefined);

    app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
      if (!enabled) {
        return reply.code(503).send({ error: 'auth_unavailable' });
      }
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'auth_required' });
      }
      const token = auth.slice('Bearer '.length).trim();
      if (!token) return reply.code(401).send({ error: 'auth_required' });

      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        return reply.code(401).send({ error: 'invalid_session' });
      }
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
      const fullName =
        (typeof meta.full_name === 'string' && meta.full_name) ||
        (typeof meta.fullName === 'string' && meta.fullName) ||
        data.user.email?.split('@')[0] ||
        'Unknown';
      const institutionName =
        (typeof meta.institution_name === 'string' && meta.institution_name) ||
        (typeof meta.institutionName === 'string' && meta.institutionName) ||
        null;

      const otcUser = store.getOrCreateUserBySupabaseId(
        data.user.id,
        data.user.email ?? '',
        fullName,
        institutionName,
      );
      req.otcUser = otcUser;
    });
};

export const supabaseAuthPlugin = fp(pluginImpl, { name: 'supabase-auth' });
