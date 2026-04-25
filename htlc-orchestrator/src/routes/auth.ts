import type { FastifyPluginAsync } from 'fastify';
import { OtcError, type OtcStore } from '../db.js';
import type { UserWalletInput } from '../types.js';

const isString = (v: unknown): v is string => typeof v === 'string';

interface SignupBody {
  username: string;
  email: string;
  password: string;
}

const validateSignup = (body: unknown): SignupBody | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (!isString(b.username) || b.username.trim().length === 0) return 'username required';
  if (!isString(b.email) || !b.email.includes('@')) return 'email required';
  if (!isString(b.password) || b.password.length < 8) return 'password must be at least 8 characters';
  return {
    username: b.username.trim(),
    email: b.email,
    password: b.password,
  };
};

const validateWalletBody = (body: unknown): UserWalletInput | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  for (const k of [
    'midnightCpkBytes',
    'midnightUnshieldedBytes',
    'midnightCpkBech32',
    'midnightUnshieldedBech32',
    'cardanoPkh',
    'cardanoAddress',
  ] as const) {
    if (!isString(b[k]) || (b[k] as string).length === 0) {
      return `${k} must be a non-empty string`;
    }
  }
  return {
    midnightCpkBytes: b.midnightCpkBytes as string,
    midnightUnshieldedBytes: b.midnightUnshieldedBytes as string,
    midnightCpkBech32: b.midnightCpkBech32 as string,
    midnightUnshieldedBech32: b.midnightUnshieldedBech32 as string,
    cardanoPkh: b.cardanoPkh as string,
    cardanoAddress: b.cardanoAddress as string,
  };
};

export const authRoutes =
  (store: OtcStore): FastifyPluginAsync =>
  async (app) => {
    /**
     * Server-side signup — uses Supabase admin API with `email_confirm: true`
     * so the user lands fully activated and can sign in immediately. Mirrors
     * otc-server (ui/otc-server/src/routes/otc.ts:139). Skips the
     * confirmation-email round-trip; the frontend signs the user in right
     * after this returns.
     */
    app.post('/auth/signup', async (req, reply) => {
      const parsed = validateSignup(req.body);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
      try {
        const { data, error } = await app.supabase.auth.admin.createUser({
          email: parsed.email,
          password: parsed.password,
          email_confirm: true,
          user_metadata: {
            full_name: parsed.username,
            institution_name: null,
          },
        });
        if (error) {
          // 'User already registered' / similar — surface verbatim.
          return reply.code(400).send({ error: 'signup_failed', message: error.message });
        }
        const otcUser = store.getOrCreateUserBySupabaseId(
          data.user!.id,
          parsed.email,
          parsed.username,
          null,
        );
        return reply.code(201).send({ user: otcUser });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'signup failed';
        return reply.code(500).send({ error: 'internal', message });
      }
    });

    app.get('/auth/me', { preHandler: app.requireAuth }, async (req, reply) => {
      const user = req.otcUser!;
      const wallet = store.getUserWallet(user.id) ?? null;
      return reply.send({ user, wallet });
    });

    app.put('/users/me/wallet', { preHandler: app.requireAuth }, async (req, reply) => {
      const parsed = validateWalletBody(req.body);
      if (typeof parsed === 'string') {
        return reply.code(400).send({ error: parsed });
      }
      try {
        const wallet = store.upsertUserWallet(req.otcUser!.id, parsed);
        return reply.send({ wallet });
      } catch (err) {
        if (err instanceof OtcError) {
          return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    });

    // Public: minimal user lookup (name + institution) for RFQ display.
    // No auth required — anyone can resolve a user id to a public profile.
    app.get<{ Params: { id: string } }>('/users/:id', async (req, reply) => {
      const u = store.getUserById(req.params.id);
      if (!u) return reply.code(404).send({ error: 'not_found' });
      return reply.send({
        id: u.id,
        fullName: u.fullName,
        institutionName: u.institutionName,
      });
    });
  };
