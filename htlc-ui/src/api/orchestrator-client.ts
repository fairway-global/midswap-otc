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
