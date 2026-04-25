import type { FastifyPluginAsync } from 'fastify';
import { OtcError, type OtcStore } from '../db.js';
import type { WalletSnapshot } from '../types.js';

const isPositiveAmountString = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && /^\d+$/.test(s);
const isPriceString = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && /^\d+(\.\d+)?$/.test(s);
const isOptionalNote = (s: unknown): s is string | undefined =>
  s === undefined || (typeof s === 'string' && s.length <= 500);

const isWalletSnapshot = (v: unknown): v is WalletSnapshot => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  // Light shape check; per-chain field validation runs in the store
  // (validateWalletSnapshot) where we know the required receive chain.
  for (const k of [
    'midnightCpkBytes',
    'midnightUnshieldedBytes',
    'midnightCpkBech32',
    'midnightUnshieldedBech32',
    'cardanoPkh',
    'cardanoAddress',
  ]) {
    if (o[k] !== undefined && typeof o[k] !== 'string') return false;
  }
  return true;
};

interface SubmitBody {
  rfqId: string;
  price: string;
  buyAmount: string;
  walletSnapshot: WalletSnapshot;
  note?: string;
}
interface CounterBody {
  rfqId: string;
  parentQuoteId: string;
  price: string;
  buyAmount: string;
  walletSnapshot: WalletSnapshot;
  note?: string;
}
interface AcceptRejectBody {
  rfqId: string;
  quoteId: string;
}

const validateSubmit = (body: unknown): SubmitBody | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (typeof b.rfqId !== 'string' || !b.rfqId) return 'rfqId required';
  if (!isPriceString(b.price)) return 'price must be a positive decimal string';
  if (!isPositiveAmountString(b.buyAmount)) return 'buyAmount must be a non-negative integer string';
  if (!isOptionalNote(b.note)) return 'note too long';
  if (!isWalletSnapshot(b.walletSnapshot)) return 'walletSnapshot required';
  return {
    rfqId: b.rfqId,
    price: b.price,
    buyAmount: b.buyAmount,
    walletSnapshot: b.walletSnapshot,
    note: b.note as string | undefined,
  };
};

const validateCounter = (body: unknown): CounterBody | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (typeof b.rfqId !== 'string' || !b.rfqId) return 'rfqId required';
  if (typeof b.parentQuoteId !== 'string' || !b.parentQuoteId) return 'parentQuoteId required';
  if (!isPriceString(b.price)) return 'price must be a positive decimal string';
  if (!isPositiveAmountString(b.buyAmount)) return 'buyAmount must be a non-negative integer string';
  if (!isOptionalNote(b.note)) return 'note too long';
  if (!isWalletSnapshot(b.walletSnapshot)) return 'walletSnapshot required';
  return {
    rfqId: b.rfqId,
    parentQuoteId: b.parentQuoteId,
    price: b.price,
    buyAmount: b.buyAmount,
    walletSnapshot: b.walletSnapshot,
    note: b.note as string | undefined,
  };
};

const validateAcceptReject = (body: unknown): AcceptRejectBody | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (typeof b.rfqId !== 'string' || !b.rfqId) return 'rfqId required';
  if (typeof b.quoteId !== 'string' || !b.quoteId) return 'quoteId required';
  return { rfqId: b.rfqId, quoteId: b.quoteId };
};

const handleErr = (reply: import('fastify').FastifyReply, err: unknown) => {
  if (err instanceof OtcError) {
    return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
  }
  throw err;
};

export const quotesRoutes =
  (store: OtcStore): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { rfqId: string } }>('/quotes/:rfqId', async (req, reply) => {
      const quotes = store.listQuotes(req.params.rfqId);
      return reply.send({ quotes });
    });

    app.post('/quotes/submit', { preHandler: app.requireAuth }, async (req, reply) => {
      const parsed = validateSubmit(req.body);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
      try {
        const quote = store.submitQuote({
          rfqId: parsed.rfqId,
          providerId: req.otcUser!.id,
          price: parsed.price,
          buyAmount: parsed.buyAmount,
          walletSnapshot: parsed.walletSnapshot,
          note: parsed.note,
        });
        return reply.code(201).send(quote);
      } catch (err) {
        return handleErr(reply, err);
      }
    });

    app.post('/quotes/counter', { preHandler: app.requireAuth }, async (req, reply) => {
      const parsed = validateCounter(req.body);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
      try {
        const quote = store.counterQuote({
          rfqId: parsed.rfqId,
          parentQuoteId: parsed.parentQuoteId,
          actorId: req.otcUser!.id,
          price: parsed.price,
          buyAmount: parsed.buyAmount,
          walletSnapshot: parsed.walletSnapshot,
          note: parsed.note,
        });
        return reply.code(201).send(quote);
      } catch (err) {
        return handleErr(reply, err);
      }
    });

    app.post('/quotes/accept', { preHandler: app.requireAuth }, async (req, reply) => {
      const parsed = validateAcceptReject(req.body);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
      try {
        const rfq = store.acceptQuote(parsed.rfqId, parsed.quoteId, req.otcUser!.id);
        return reply.send(rfq);
      } catch (err) {
        return handleErr(reply, err);
      }
    });

    app.post('/quotes/reject', { preHandler: app.requireAuth }, async (req, reply) => {
      const parsed = validateAcceptReject(req.body);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
      try {
        const rfq = store.rejectQuote(parsed.rfqId, parsed.quoteId, req.otcUser!.id);
        return reply.send(rfq);
      } catch (err) {
        return handleErr(reply, err);
      }
    });
  };
