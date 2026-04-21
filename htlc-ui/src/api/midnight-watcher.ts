/**
 * Browser port of `htlc-ft-cli/src/midnight-watcher.ts`.
 *
 * These watchers are `setTimeout`-based polling loops — already
 * browser-compatible — but we expose them with an `AbortSignal` so React
 * components can cancel cleanly on unmount.
 */

import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { type PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { ledger } from '../../../contract/src/managed/htlc/contract/index';

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });

export interface HTLCDepositInfo {
  amount: bigint;
  expiry: bigint;
  color: Uint8Array;
  senderAuth: Uint8Array;
  receiverAuth: Uint8Array;
}

export async function watchForHTLCDeposit(
  publicDataProvider: PublicDataProvider,
  contractAddress: ContractAddress,
  hashLock: Uint8Array,
  pollIntervalMs = 5000,
  signal?: AbortSignal,
): Promise<HTLCDepositInfo> {
  while (!signal?.aborted) {
    try {
      const state = await publicDataProvider.queryContractState(contractAddress);
      if (state) {
        const l = ledger(state.data);
        if (l.htlcAmounts.member(hashLock) && l.htlcAmounts.lookup(hashLock) > 0n) {
          return {
            amount: l.htlcAmounts.lookup(hashLock),
            expiry: l.htlcExpiries.lookup(hashLock),
            color: l.htlcColors.lookup(hashLock),
            senderAuth: l.htlcSenderAuth.lookup(hashLock),
            receiverAuth: l.htlcReceiverAuth.lookup(hashLock),
          };
        }
      }
    } catch {
      /* indexer may be temporarily unavailable */
    }
    await sleep(pollIntervalMs, signal);
  }
  throw new Error('aborted');
}

export async function watchForPreimageReveal(
  publicDataProvider: PublicDataProvider,
  contractAddress: ContractAddress,
  hashLock: Uint8Array,
  pollIntervalMs = 5000,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  while (!signal?.aborted) {
    try {
      const state = await publicDataProvider.queryContractState(contractAddress);
      if (state) {
        const l = ledger(state.data);
        if (l.revealedPreimages.member(hashLock)) {
          return l.revealedPreimages.lookup(hashLock);
        }
      }
    } catch {
      /* indexer may be temporarily unavailable */
    }
    await sleep(pollIntervalMs, signal);
  }
  throw new Error('aborted');
}

export async function isHTLCActive(
  publicDataProvider: PublicDataProvider,
  contractAddress: ContractAddress,
  hashLock: Uint8Array,
): Promise<boolean> {
  const state = await publicDataProvider.queryContractState(contractAddress);
  if (!state) return false;
  const l = ledger(state.data);
  return l.htlcAmounts.member(hashLock) && l.htlcAmounts.lookup(hashLock) > 0n;
}
