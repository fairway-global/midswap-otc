export type SwapStatus =
  | 'open'
  | 'bob_deposited'
  | 'alice_claimed'
  | 'completed'
  | 'alice_reclaimed'
  | 'bob_reclaimed'
  | 'expired';

/**
 * Which side the maker initiates on.
 *   ada-usdc: maker locks ADA on Cardano first, taker deposits USDC on Midnight
 *   usdc-ada: maker deposits USDC on Midnight first, taker locks ADA on Cardano
 */
export type FlowDirection = 'usdm-usdc' | 'usdc-usdm';

export interface Swap {
  hash: string;
  direction: FlowDirection;

  aliceCpk: string;
  aliceUnshielded: string;
  usdmAmount: string;
  usdcAmount: string;

  // Cardano side:
  //   ada-usdc: set at creation (maker's first-chain lock)
  //   usdc-ada: set later via PATCH when taker locks (second-chain lock)
  cardanoDeadlineMs: number | null;
  cardanoLockTx: string | null;
  // Cardano HTLC receiver PKH: taker's (ada-usdc) or maker's own (usdc-ada).
  bobPkh: string | null;

  // Midnight side:
  //   ada-usdc: set later via PATCH when taker deposits
  //   usdc-ada: set at creation (maker's first-chain deposit)
  midnightDeadlineMs: number | null;
  midnightDepositTx: string | null;
  // Midnight HTLC receiver keys: taker's (either direction).
  bobCpk: string | null;
  bobUnshielded: string | null;

  midnightClaimTx: string | null;
  cardanoClaimTx: string | null;
  cardanoReclaimTx: string | null;
  midnightReclaimTx: string | null;

  // The preimage. Revealed on Midnight (ada-usdc) or Cardano (usdc-ada).
  midnightPreimage: string | null;

  status: SwapStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * Create-swap body. `direction` defaults to `ada-usdc` for backward compat
 * with existing clients.
 *
 *   ada-usdc requires: cardanoLockTx, cardanoDeadlineMs, bobPkh (taker's PKH).
 *   usdc-ada requires: midnightDepositTx, midnightDeadlineMs,
 *                      bobCpk + bobUnshielded (taker's keys from the paste-bundle),
 *                      bobPkh (maker's OWN Cardano PKH — the receiver of the
 *                      future taker lock).
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
