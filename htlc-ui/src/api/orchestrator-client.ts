/**
 * Typed REST client for the htlc-orchestrator backend.
 *
 * The orchestrator is an ENHANCEMENT, not a dependency of the swap protocol —
 * all calls are best-effort and log rather than throw. Chain state remains
 * authoritative; the DB only exists so the counterparty can discover offers
 * without a copy-pasted URL, and so cross-chain preimage relay lights up
 * faster than the indexer/Blockfrost catch-up loops.
 *
 * Supports both flow directions via the `direction` field.
 */

export type SwapStatus =
  | 'open'
  | 'bob_deposited'
  | 'alice_claimed'
  | 'completed'
  | 'alice_reclaimed'
  | 'bob_reclaimed'
  | 'expired';

export type FlowDirection = 'usdm-usdc' | 'usdc-usdm';

export interface Swap {
  hash: string;
  direction: FlowDirection;

  aliceCpk: string;
  aliceUnshielded: string;
  usdmAmount: string;
  usdcAmount: string;

  cardanoDeadlineMs: number | null;
  cardanoLockTx: string | null;
  bobPkh: string | null;

  midnightDeadlineMs: number | null;
  midnightDepositTx: string | null;
  bobCpk: string | null;
  bobUnshielded: string | null;

  midnightClaimTx: string | null;
  cardanoClaimTx: string | null;
  cardanoReclaimTx: string | null;
  midnightReclaimTx: string | null;

  midnightPreimage: string | null;

  status: SwapStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * Create-swap body. `direction` defaults to `ada-usdc` server-side.
 *
 *   ada-usdc: send `cardanoLockTx`, `cardanoDeadlineMs`, `bobPkh` (taker's PKH).
 *   usdc-ada: send `midnightDepositTx`, `midnightDeadlineMs`,
 *             `bobCpk`, `bobUnshielded` (taker's keys from the paste-bundle),
 *             `bobPkh` (maker's OWN Cardano PKH — the receiver the taker's
 *             future USDM lock will bind to).
 */
export interface CreateSwapBody {
  hash: string;
  direction?: FlowDirection;

  aliceCpk: string;
  aliceUnshielded: string;
  usdmAmount: string;
  usdcAmount: string;

  cardanoDeadlineMs?: number;
  cardanoLockTx?: string;
  bobPkh?: string;

  midnightDeadlineMs?: number;
  midnightDepositTx?: string;
  bobCpk?: string;
  bobUnshielded?: string;

  /** OTC bridge linkage. Set when the swap was orchestrated via an RFQ. */
  rfqId?: string;
}

export interface PatchSwapBody {
  bobCpk?: string;
  bobUnshielded?: string;
  bobPkh?: string;
  cardanoDeadlineMs?: number;
  cardanoLockTx?: string;
  midnightDeadlineMs?: number;
  midnightDepositTx?: string;
  midnightClaimTx?: string;
  cardanoClaimTx?: string;
  cardanoReclaimTx?: string;
  midnightReclaimTx?: string;
  midnightPreimage?: string;
  status?: SwapStatus;
}

const BASE_URL = ((import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(`orchestrator ${init.method ?? 'GET'} ${path} → ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
};

export interface ListSwapsFilter {
  status?: SwapStatus;
  direction?: FlowDirection;
}

export const orchestratorClient = {
  baseUrl: BASE_URL,

  health: () => request<{ ok: boolean; db: string }>('/health'),

  createSwap: (body: CreateSwapBody) => request<Swap>('/api/swaps', { method: 'POST', body: JSON.stringify(body) }),

  listSwaps: (filter?: SwapStatus | ListSwapsFilter) => {
    const params = new URLSearchParams();
    if (typeof filter === 'string') {
      params.set('status', filter);
    } else if (filter) {
      if (filter.status) params.set('status', filter.status);
      if (filter.direction) params.set('direction', filter.direction);
    }
    const qs = params.toString();
    return request<{ swaps: Swap[] }>(`/api/swaps${qs ? `?${qs}` : ''}`);
  },

  getSwap: (hash: string) => request<Swap>(`/api/swaps/${hash}`),

  patchSwap: (hash: string, body: PatchSwapBody) =>
    request<Swap>(`/api/swaps/${hash}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

/** Fire-and-forget wrapper that swallows errors (logs to console). */
export const tryOrchestrator = async <T>(action: () => Promise<T>, label: string): Promise<T | undefined> => {
  try {
    return await action();
  } catch (e) {
    console.warn(`[orchestrator:${label}]`, e instanceof Error ? e.message : e);
    return undefined;
  }
};

// ──────────────────────────────────────────────────────────────────────
// OTC layer — auth-aware client (Bearer JWT injected per request).
// ──────────────────────────────────────────────────────────────────────

import { supabase, supabaseConfigured } from '../lib/supabase';

const authHeader = async (): Promise<Record<string, string>> => {
  if (!supabaseConfigured) return {};
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const requestAuth = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = await authHeader();
  return request<T>(path, { ...init, headers: { ...(init.headers ?? {}), ...headers } });
};

export interface OtcUserPublic {
  id: string;
  supabaseId: string;
  email: string;
  fullName: string;
  institutionName: string | null;
  isAdmin: boolean;
  createdAt: number;
}

export interface UserWalletDto {
  userId: string;
  midnightCpkBytes: string;
  midnightUnshieldedBytes: string;
  midnightCpkBech32: string;
  midnightUnshieldedBech32: string;
  cardanoPkh: string;
  cardanoAddress: string;
  updatedAt: number;
}

/**
 * Per-deal wallet snapshot — only the chain the party RECEIVES on is set.
 * Backend validates that the right fields are present given the receive
 * chain (derived from rfq.side + role). SwapCard hydration reads exactly
 * the fields it needs per swap direction, so partial snapshots work
 * without branching.
 */
export interface WalletSnapshot {
  midnightCpkBytes?: string;
  midnightUnshieldedBytes?: string;
  midnightCpkBech32?: string;
  midnightUnshieldedBech32?: string;
  cardanoPkh?: string;
  cardanoAddress?: string;
}

export interface WalletPutBody {
  midnightCpkBytes: string;
  midnightUnshieldedBytes: string;
  midnightCpkBech32: string;
  midnightUnshieldedBech32: string;
  cardanoPkh: string;
  cardanoAddress: string;
}

export type RfqSide = 'sell-usdm' | 'sell-usdc';
export type RfqStatus =
  | 'OpenForQuotes'
  | 'Negotiating'
  | 'QuoteSelected'
  | 'Settling'
  | 'Settled'
  | 'Expired'
  | 'Cancelled';
export type QuoteStatus =
  | 'Submitted'
  | 'Countered'
  | 'Accepted'
  | 'Rejected'
  | 'Expired';
export type ActivityType =
  | 'RFQ_CREATED'
  | 'QUOTE_SUBMITTED'
  | 'QUOTE_COUNTERED'
  | 'QUOTE_ACCEPTED'
  | 'QUOTE_REJECTED'
  | 'RFQ_CANCELLED'
  | 'SETTLEMENT_STARTED'
  | 'SETTLEMENT_COMPLETED';

export interface Rfq {
  id: string;
  reference: string;
  originatorId: string;
  originatorName: string;
  originatorEmail: string;
  side: RfqSide;
  sellAmount: string;
  indicativeBuyAmount: string;
  status: RfqStatus;
  selectedQuoteId: string | null;
  selectedProviderId: string | null;
  selectedProviderName: string | null;
  selectedProviderEmail: string | null;
  acceptedPrice: string | null;
  swapHash: string | null;
  /** Originator's receive-side wallet — null in the new model (originator
   *  commits at lock/deposit time). Kept for backward compat. */
  originatorWalletSnapshot: WalletSnapshot | null;
  /** Provider's receive-side wallet — copied from the accepted quote. */
  providerWalletSnapshot: WalletSnapshot | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface Quote {
  id: string;
  rfqId: string;
  providerId: string;
  providerName: string;
  version: number;
  parentQuoteId: string | null;
  price: string;
  sellAmount: string;
  buyAmount: string;
  status: QuoteStatus;
  note: string | null;
  submittedByUserId: string;
  submittedByName: string;
  walletSnapshot: WalletSnapshot | null;
  createdAt: number;
  updatedAt: number;
}

export interface Activity {
  id: string;
  rfqId: string;
  type: ActivityType;
  actorId: string;
  actorName: string;
  summary: string;
  relatedQuoteId: string | null;
  createdAt: number;
}

export interface CreateRfqBody {
  side: RfqSide;
  sellAmount: string;
  indicativeBuyAmount: string;
  expiresInSeconds: number;
}

export interface SubmitQuoteBody {
  rfqId: string;
  price: string;
  buyAmount: string;
  walletSnapshot: WalletSnapshot;
  note?: string;
}

export interface CounterQuoteBody {
  rfqId: string;
  parentQuoteId: string;
  price: string;
  buyAmount: string;
  walletSnapshot: WalletSnapshot;
  note?: string;
}

export interface SignupBody {
  email: string;
  password: string;
  fullName: string;
  institutionName: string;
}

export const otcApi = {
  /** Server-side signup — auto-confirms email, no inbox round-trip. */
  signup: (body: SignupBody) =>
    request<{ user: OtcUserPublic }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  me: () =>
    requestAuth<{ user: OtcUserPublic; wallet: UserWalletDto | null }>('/api/auth/me'),

  putWallet: (body: WalletPutBody) =>
    requestAuth<{ wallet: UserWalletDto }>('/api/users/me/wallet', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  getPublicUser: (id: string) =>
    request<{ id: string; fullName: string; institutionName: string | null }>(
      `/api/users/${id}`,
    ),

  // RFQs
  listRfqs: (filter?: { status?: RfqStatus; side?: RfqSide; mine?: boolean }) => {
    const p = new URLSearchParams();
    if (filter?.status) p.set('status', filter.status);
    if (filter?.side) p.set('side', filter.side);
    if (filter?.mine) p.set('mine', '1');
    const qs = p.toString();
    return requestAuth<{ rfqs: Rfq[] }>(`/api/rfqs${qs ? `?${qs}` : ''}`);
  },
  getRfq: (id: string) => requestAuth<Rfq>(`/api/rfqs/${id}`),
  createRfq: (body: CreateRfqBody) =>
    requestAuth<Rfq>('/api/rfqs', { method: 'POST', body: JSON.stringify(body) }),
  cancelRfq: (id: string) => requestAuth<Rfq>(`/api/rfqs/${id}`, { method: 'DELETE' }),

  // Quotes
  listQuotes: (rfqId: string) => requestAuth<{ quotes: Quote[] }>(`/api/quotes/${rfqId}`),
  submitQuote: (body: SubmitQuoteBody) =>
    requestAuth<Quote>('/api/quotes/submit', { method: 'POST', body: JSON.stringify(body) }),
  counterQuote: (body: CounterQuoteBody) =>
    requestAuth<Quote>('/api/quotes/counter', { method: 'POST', body: JSON.stringify(body) }),
  acceptQuote: (rfqId: string, quoteId: string) =>
    requestAuth<Rfq>('/api/quotes/accept', {
      method: 'POST',
      body: JSON.stringify({ rfqId, quoteId }),
    }),
  rejectQuote: (rfqId: string, quoteId: string) =>
    requestAuth<Rfq>('/api/quotes/reject', {
      method: 'POST',
      body: JSON.stringify({ rfqId, quoteId }),
    }),

  // Activity
  listActivity: (rfqId: string) =>
    requestAuth<{ activities: Activity[] }>(`/api/activity/${rfqId}`),
};
