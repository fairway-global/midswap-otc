/**
 * swap-bridge — single source of truth for the OTC ↔ swap protocol bridge.
 *
 *   - Amount mapping: an RFQ's `sellAmount` + `acceptedPrice` (set at quote-
 *     accept time) collapse to (`usdmAmount`, `usdcAmount`) using the
 *     conversion below. Both backend and frontend MUST call the same helper
 *     so the swap row insert and the LP share-URL composition agree on the
 *     numbers.
 *   - Share-URL composition: when an RFQ-linked swap is created, the LP
 *     view of `/swap?…` needs the existing legacy parameter names verbatim
 *     (CLAUDE.md "Things to NOT change"). This helper builds them from the
 *     authoritative swap row + the RFQ snapshot.
 *
 *   USDM and USDC are 0-decimal stablecoins in this build (the contracts
 *   treat them as integer base units). `acceptedPrice` is therefore a plain
 *   integer ratio: "how many base-units of the buy-token per base-unit of
 *   the sell-token". For sub-integer pricing, scale by a precision factor
 *   in the price string (e.g. price="9950" with precision=10000 = 0.995).
 *   The current build uses raw integer pricing.
 */

import type { Rfq, Swap } from '../types.js';

const PRICE_PRECISION = 1n;

const computeBuyAmount = (sellAmount: string, acceptedPrice: string): string => {
  // buy = sell * price / precision
  const sell = BigInt(sellAmount);
  const price = BigInt(acceptedPrice);
  return ((sell * price) / PRICE_PRECISION).toString();
};

/**
 * Map an accepted RFQ to the (usdmAmount, usdcAmount) tuple the swap row
 * stores. `flowDirection` follows from `rfq.side`:
 *   sell-usdm → 'usdm-usdc' (forward)
 *   sell-usdc → 'usdc-usdm' (reverse)
 */
export const rfqAmounts = (
  rfq: Rfq,
): { usdmAmount: string; usdcAmount: string; direction: 'usdm-usdc' | 'usdc-usdm' } => {
  if (!rfq.acceptedPrice) {
    throw new Error('rfqAmounts requires an accepted price');
  }
  if (rfq.side === 'sell-usdm') {
    // Maker sells USDM, receives USDC (the buy token).
    return {
      direction: 'usdm-usdc',
      usdmAmount: rfq.sellAmount,
      usdcAmount: computeBuyAmount(rfq.sellAmount, rfq.acceptedPrice),
    };
  }
  return {
    direction: 'usdc-usdm',
    usdcAmount: rfq.sellAmount,
    usdmAmount: computeBuyAmount(rfq.sellAmount, rfq.acceptedPrice),
  };
};

/**
 * Compose the LP-side share URL params for an RFQ-linked swap. Mirrors the
 * existing share-URL contract — DO NOT rename keys here, the in-the-wild
 * URLs and the frontend's URL-parser depend on them.
 */
export const composeShareUrlParams = (rfq: Rfq, swap: Swap): URLSearchParams => {
  const p = new URLSearchParams();
  p.set('hash', swap.hash);
  p.set('role', 'bob');
  p.set('rfqId', rfq.id);
  p.set('usdmAmount', swap.usdmAmount);
  p.set('usdcAmount', swap.usdcAmount);

  if (swap.direction === 'usdm-usdc') {
    // Forward — taker sees maker's Midnight keys + Cardano deadline.
    p.set('aliceCpk', swap.aliceCpk);
    p.set('aliceUnshielded', swap.aliceUnshielded);
    if (swap.cardanoDeadlineMs !== null) p.set('cardanoDeadlineMs', String(swap.cardanoDeadlineMs));
  } else {
    // Reverse — taker sees direction + maker's PKH + midnight deadline.
    p.set('direction', 'usdc-usdm');
    if (swap.bobPkh) p.set('makerPkh', swap.bobPkh);
    if (swap.midnightDeadlineMs !== null) p.set('midnightDeadlineMs', String(swap.midnightDeadlineMs));
  }
  return p;
};
