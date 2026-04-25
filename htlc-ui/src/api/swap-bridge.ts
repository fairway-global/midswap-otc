/**
 * Frontend mirror of htlc-orchestrator/src/services/swap-bridge.ts —
 * keep these two files in lockstep. Used by RfqDetail (LP redirect on
 * settlement-started) and by SwapCard (originator hydration from RFQ
 * snapshot before lock).
 */

import type { Rfq, Swap, FlowDirection } from './orchestrator-client';

const PRICE_PRECISION = 1n;

const computeBuyAmount = (sellAmount: string, acceptedPrice: string): string => {
  const sell = BigInt(sellAmount);
  const price = BigInt(acceptedPrice);
  return ((sell * price) / PRICE_PRECISION).toString();
};

export const rfqAmounts = (
  rfq: Rfq,
): { usdmAmount: string; usdcAmount: string; direction: FlowDirection } => {
  if (!rfq.acceptedPrice) {
    throw new Error('rfqAmounts requires an accepted price');
  }
  if (rfq.side === 'sell-usdm') {
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

export const composeShareUrlParams = (rfq: Rfq, swap: Swap): URLSearchParams => {
  const p = new URLSearchParams();
  p.set('hash', swap.hash);
  p.set('role', 'bob');
  p.set('rfqId', rfq.id);
  p.set('usdmAmount', swap.usdmAmount);
  p.set('usdcAmount', swap.usdcAmount);

  if (swap.direction === 'usdm-usdc') {
    p.set('aliceCpk', swap.aliceCpk);
    p.set('aliceUnshielded', swap.aliceUnshielded);
    if (swap.cardanoDeadlineMs !== null) p.set('cardanoDeadlineMs', String(swap.cardanoDeadlineMs));
  } else {
    p.set('direction', 'usdc-usdm');
    if (swap.bobPkh) p.set('makerPkh', swap.bobPkh);
    if (swap.midnightDeadlineMs !== null) p.set('midnightDeadlineMs', String(swap.midnightDeadlineMs));
  }
  return p;
};
