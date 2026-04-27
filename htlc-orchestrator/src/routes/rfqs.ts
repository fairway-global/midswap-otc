import type { FastifyPluginAsync } from 'fastify';
import { OtcError, type OtcStore } from '../db.js';
import type { CreateRfqInput, RfqSide, RfqStatus } from '../types.js';

const RFQ_STATUS_VALUES: readonly RfqStatus[] = [
  'OpenForQuotes',
  'Negotiating',
  'QuoteSelected',
  'Settling',
  'Settled',
  'Expired',
  'Cancelled',
];
const SIDE_VALUES: readonly RfqSide[] = ['sell-usdm', 'sell-usdc'];

const isPositiveAmountString = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && /^\d+$/.test(s);

const validateCreateBody = (body: unknown): CreateRfqInput | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (!SIDE_VALUES.includes(b.side as RfqSide)) {
    return `side must be one of: ${SIDE_VALUES.join(', ')}`;
  }
  if (!isPositiveAmountString(b.sellAmount)) return 'sellAmount must be a non-negative integer string';
  if (!isPositiveAmountString(b.indicativeBuyAmount)) {
    return 'indicativeBuyAmount must be a non-negative integer string';
  }
  if (typeof b.expiresInSeconds !== 'number' || b.expiresInSeconds < 60 || b.expiresInSeconds > 86_400) {
    return 'expiresInSeconds must be a number in [60, 86400]';
  }
  return {
    originatorId: '',           // filled by handler from req.otcUser
    side: b.side as RfqSide,
    sellAmount: b.sellAmount,
    indicativeBuyAmount: b.indicativeBuyAmount,
    expiresInSeconds: b.expiresInSeconds,
  };
};

export const rfqsRoutes =
  (store: OtcStore): FastifyPluginAsync =>
  async (app) => {
    // List — public for read-only browsing (so signed-out hero / preview pages
    // can still show the order book), filtered by status / side / mine.
    app.get<{ Querystring: { status?: string; side?: string; mine?: string } }>(
      '/rfqs',
      async (req, reply) => {
        const { status, side, mine } = req.query;
        if (status !== undefined && !RFQ_STATUS_VALUES.includes(status as RfqStatus)) {
          return reply.code(400).send({ error: `status must be one of: ${RFQ_STATUS_VALUES.join(', ')}` });
        }
        if (side !== undefined && !SIDE_VALUES.includes(side as RfqSide)) {
          return reply.code(400).send({ error: `side must be one of: ${SIDE_VALUES.join(', ')}` });
        }
        let mineId: string | undefined;
        if (mine === '1' || mine === 'true') {
          // 'mine' requires a session; verify auth and use req.otcUser.
          await app.requireAuth(req, reply);
          if (reply.sent) return;
          mineId = req.otcUser?.id;
        }
        const rfqs = store.listRfqs({
          status: status ? (status as RfqStatus) : undefined,
          side: side ? (side as RfqSide) : undefined,
          mine: mineId,
        });
        return reply.send({ rfqs });
      },
    );

    app.post('/rfqs', { preHandler: app.requireAuth }, async (req, reply) => {
      const parsed = validateCreateBody(req.body);
      if (typeof parsed === 'string') {
        return reply.code(400).send({ error: parsed });
      }
      try {
        const rfq = store.createRfq({ ...parsed, originatorId: req.otcUser!.id });
        return reply.code(201).send(rfq);
      } catch (err) {
        if (err instanceof OtcError) {
          return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    });

    app.get<{ Params: { id: string } }>('/rfqs/:id', async (req, reply) => {
      const rfq = store.getRfq(req.params.id);
      if (!rfq) return reply.code(404).send({ error: 'not_found' });
      return reply.send(rfq);
    });

    app.delete<{ Params: { id: string } }>('/rfqs/:id', { preHandler: app.requireAuth }, async (req, reply) => {
      try {
        const rfq = store.cancelRfq(req.params.id, req.otcUser!.id);
        return reply.send(rfq);
      } catch (err) {
        if (err instanceof OtcError) {
          return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    });
  };
