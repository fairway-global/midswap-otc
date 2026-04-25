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

  // Optional link back to an OTC RFQ that orchestrated this swap.
  // Set when the maker hits createSwap from the OTC bridge flow
  // (SwapCard hydrated from /api/rfqs/:id, &rfqId=… in URL).
  rfqId: string | null;

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
 *
 *   rfqId — optional OTC bridge linkage. When set, the orchestrator stamps
 *   `rfqs.swap_hash = body.hash` and flips the RFQ status to `Settling`.
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

// ──────────────────────────────────────────────────────────────────────
// OTC layer types
// ──────────────────────────────────────────────────────────────────────

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

export interface OtcUser {
  id: string;
  supabaseId: string;
  email: string;
  fullName: string;
  institutionName: string | null;
  isAdmin: boolean;
  createdAt: number;
}

export interface UserWallet {
  userId: string;
  midnightCpkBytes: string;        // 64-hex
  midnightUnshieldedBytes: string; // 64-hex
  midnightCpkBech32: string;       // mn_shield-cpk_…
  midnightUnshieldedBech32: string;// mn_addr_…
  cardanoPkh: string;              // 56-hex
  cardanoAddress: string;          // addr / addr_test bech32
  updatedAt: number;
}

export interface UserWalletInput {
  midnightCpkBytes: string;
  midnightUnshieldedBytes: string;
  midnightCpkBech32: string;
  midnightUnshieldedBech32: string;
  cardanoPkh: string;
  cardanoAddress: string;
}

export interface Rfq {
  id: string;
  reference: string;               // human-readable, e.g. "RFQ-0001"
  originatorId: string;
  originatorName: string;
  originatorEmail: string;
  side: RfqSide;
  sellAmount: string;              // base-units of the sell token
  indicativeBuyAmount: string;     // base-units of the buy token
  status: RfqStatus;
  selectedQuoteId: string | null;
  selectedProviderId: string | null;
  selectedProviderName: string | null;
  selectedProviderEmail: string | null;
  acceptedPrice: string | null;
  swapHash: string | null;         // ← bridge link to swaps.hash
  // Snapshots taken at quote-accept time so post-accept wallet rebinds
  // can't shift the contract.
  originatorWalletSnapshot: UserWallet | null;
  providerWalletSnapshot: UserWallet | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface CreateRfqInput {
  originatorId: string;
  side: RfqSide;
  sellAmount: string;
  indicativeBuyAmount: string;
  expiresInSeconds: number;
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
  // No submitted_by_role — derived at read time from rfq.originatorId.
  submittedByUserId: string;
  submittedByName: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubmitQuoteInput {
  rfqId: string;
  providerId: string;
  price: string;
  buyAmount: string;
  note?: string;
}

export interface CounterQuoteInput {
  rfqId: string;
  parentQuoteId: string;
  actorId: string;
  price: string;
  buyAmount: string;
  note?: string;
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
