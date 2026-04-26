import type { FastifyPluginAsync } from 'fastify';
import type { SwapStore } from '../db.js';
import type { CreateSwapBody, FlowDirection, PatchSwapBody, SwapStatus } from '../types.js';

const HASH_RE = /^[0-9a-f]{64}$/;
const HEX_RE = /^[0-9a-f]+$/i;
const PKH_RE = /^[0-9a-f]{56}$/;
const STATUS_VALUES: readonly SwapStatus[] = [
  'open',
  'bob_deposited',
  'alice_claimed',
  'completed',
  'alice_reclaimed',
  'bob_reclaimed',
  'expired',
];
const DIRECTION_VALUES: readonly FlowDirection[] = ['usdm-usdc', 'usdc-usdm'];

const isHash = (s: unknown): s is string => typeof s === 'string' && HASH_RE.test(s);
const isHex = (s: unknown): s is string => typeof s === 'string' && HEX_RE.test(s);
const isPkh = (s: unknown): s is string => typeof s === 'string' && PKH_RE.test(s);
const isNonEmptyString = (s: unknown): s is string => typeof s === 'string' && s.length > 0;
const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

const validateCreateBody = (body: unknown): CreateSwapBody | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (!isHash(b.hash)) return 'hash must be 64 lowercase hex chars';
  if (!isHex(b.aliceCpk)) return 'aliceCpk must be hex';
  if (!isNonEmptyString(b.aliceUnshielded)) return 'aliceUnshielded must be non-empty string';
  if (!isNonEmptyString(b.usdmAmount)) return 'usdmAmount must be decimal string';
  if (!isNonEmptyString(b.usdcAmount)) return 'usdcAmount must be decimal string';

  const direction: FlowDirection = (b.direction as FlowDirection | undefined) ?? 'usdm-usdc';
  if (!DIRECTION_VALUES.includes(direction)) {
    return `direction must be one of: ${DIRECTION_VALUES.join(', ')}`;
  }

  const out: CreateSwapBody = {
    hash: b.hash,
    direction,
    aliceCpk: b.aliceCpk.toLowerCase(),
    aliceUnshielded: b.aliceUnshielded,
    usdmAmount: b.usdmAmount,
    usdcAmount: b.usdcAmount,
  };

  if (direction === 'usdm-usdc') {
    // Maker has done the Cardano lock at creation time.
    if (!isPosInt(b.cardanoDeadlineMs)) return 'cardanoDeadlineMs required for ada-usdc (integer ms)';
    if (!isNonEmptyString(b.cardanoLockTx)) return 'cardanoLockTx required for ada-usdc';
    if (!isPkh(b.bobPkh)) return 'bobPkh required for ada-usdc (56 hex chars)';
    out.cardanoDeadlineMs = b.cardanoDeadlineMs;
    out.cardanoLockTx = b.cardanoLockTx;
    out.bobPkh = b.bobPkh.toLowerCase();
  } else {
    // Maker has done the Midnight deposit at creation time.
    if (!isPosInt(b.midnightDeadlineMs)) return 'midnightDeadlineMs required for usdc-ada (integer ms)';
    // midnightDepositTx is OPTIONAL — Lace's submit-wrapper sometimes throws
    // even when the tx lands on-chain (Landmine #5). The maker verifies the
    // entry via the indexer and continues without a hash; the on-chain entry
    // is what the watcher needs, the hash is a display nicety.
    if (b.midnightDepositTx !== undefined && !isNonEmptyString(b.midnightDepositTx)) {
      return 'midnightDepositTx, if provided, must be a non-empty string';
    }
    if (!isHex(b.bobCpk)) return 'bobCpk required for usdc-ada (taker Midnight coin key, hex)';
    if (!isNonEmptyString(b.bobUnshielded)) return 'bobUnshielded required for usdc-ada (taker Midnight unshielded)';
    if (!isPkh(b.bobPkh)) return 'bobPkh required for usdc-ada (maker OWN Cardano PKH, 56 hex)';
    out.midnightDeadlineMs = b.midnightDeadlineMs;
    if (b.midnightDepositTx) out.midnightDepositTx = b.midnightDepositTx;
    out.bobCpk = b.bobCpk.toLowerCase();
    out.bobUnshielded = b.bobUnshielded;
    out.bobPkh = b.bobPkh.toLowerCase();
  }

  // Optional bridge linkage to an OTC RFQ. Maker propagates this when the
  // /swap?rfqId=... flow drove the lock. The orchestrator stamps the RFQ
  // with swap_hash + status='Settling' on insert.
  if (b.rfqId !== undefined) {
    if (typeof b.rfqId !== 'string' || b.rfqId.length === 0 || b.rfqId.length > 64) {
      return 'rfqId must be a non-empty string';
    }
    out.rfqId = b.rfqId;
  }

  return out;
};

const validatePatchBody = (body: unknown): PatchSwapBody | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  const out: PatchSwapBody = {};

  if (b.bobCpk !== undefined) {
    if (!isHex(b.bobCpk)) return 'bobCpk must be hex';
    out.bobCpk = (b.bobCpk as string).toLowerCase();
  }
  if (b.bobUnshielded !== undefined) {
    if (!isNonEmptyString(b.bobUnshielded)) return 'bobUnshielded must be string';
    out.bobUnshielded = b.bobUnshielded;
  }
  if (b.bobPkh !== undefined) {
    if (!isHex(b.bobPkh)) return 'bobPkh must be hex';
    out.bobPkh = (b.bobPkh as string).toLowerCase();
  }
  if (b.cardanoDeadlineMs !== undefined) {
    if (!isPosInt(b.cardanoDeadlineMs)) return 'cardanoDeadlineMs must be integer ms';
    out.cardanoDeadlineMs = b.cardanoDeadlineMs;
  }
  if (b.midnightDeadlineMs !== undefined) {
    if (!isPosInt(b.midnightDeadlineMs)) return 'midnightDeadlineMs must be integer ms';
    out.midnightDeadlineMs = b.midnightDeadlineMs;
  }
  for (const field of [
    'cardanoLockTx',
    'midnightDepositTx',
    'midnightClaimTx',
    'cardanoClaimTx',
    'cardanoReclaimTx',
    'midnightReclaimTx',
  ] as const) {
    if (b[field] !== undefined) {
      if (!isNonEmptyString(b[field])) return `${field} must be non-empty string`;
      out[field] = b[field] as string;
    }
  }
  if (b.midnightPreimage !== undefined) {
    if (!isHash(b.midnightPreimage)) return 'midnightPreimage must be 64 lowercase hex chars';
    out.midnightPreimage = b.midnightPreimage;
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !STATUS_VALUES.includes(b.status as SwapStatus)) {
      return `status must be one of: ${STATUS_VALUES.join(', ')}`;
    }
    out.status = b.status as SwapStatus;
  }
  return out;
};

export const swapsRoutes = (store: SwapStore): FastifyPluginAsync => async (app) => {
  app.post('/swaps', async (req, reply) => {
    const parsed = validateCreateBody(req.body);
    if (typeof parsed === 'string') {
      return reply.code(400).send({ error: parsed });
    }
    if (store.get(parsed.hash)) {
      return reply.code(409).send({ error: 'swap with this hash already exists' });
    }
    const swap = store.create(parsed);
    return reply.code(201).send(swap);
  });

  app.get<{ Querystring: { status?: string; direction?: string } }>('/swaps', async (req, reply) => {
    const { status, direction } = req.query;
    if (status !== undefined && !STATUS_VALUES.includes(status as SwapStatus)) {
      return reply.code(400).send({ error: `status must be one of: ${STATUS_VALUES.join(', ')}` });
    }
    if (direction !== undefined && !DIRECTION_VALUES.includes(direction as FlowDirection)) {
      return reply.code(400).send({ error: `direction must be one of: ${DIRECTION_VALUES.join(', ')}` });
    }
    const swaps = store.list({
      status: status ? (status as SwapStatus) : undefined,
      direction: direction ? (direction as FlowDirection) : undefined,
    });
    return reply.send({ swaps });
  });

  app.get<{ Params: { hash: string } }>('/swaps/:hash', async (req, reply) => {
    const { hash } = req.params;
    if (!isHash(hash)) {
      return reply.code(400).send({ error: 'hash must be 64 lowercase hex chars' });
    }
    const swap = store.get(hash);
    if (!swap) return reply.code(404).send({ error: 'swap not found' });
    return reply.send(swap);
  });

  app.patch<{ Params: { hash: string } }>('/swaps/:hash', async (req, reply) => {
    const { hash } = req.params;
    if (!isHash(hash)) {
      return reply.code(400).send({ error: 'hash must be 64 lowercase hex chars' });
    }
    const parsed = validatePatchBody(req.body);
    if (typeof parsed === 'string') {
      return reply.code(400).send({ error: parsed });
    }
    const updated = store.patch(hash, parsed);
    if (!updated) return reply.code(404).send({ error: 'swap not found' });
    return reply.send(updated);
  });
};
