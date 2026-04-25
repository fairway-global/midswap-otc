import type { FastifyPluginAsync } from 'fastify';
import { OtcError, type OtcStore } from '../db.js';
import type { UserWalletInput } from '../types.js';

const isString = (v: unknown): v is string => typeof v === 'string';

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
