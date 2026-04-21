/**
 * Browser port of `htlc-ft-cli/src/cardano-watcher.ts`.
 *
 * Watches for Cardano HTLC UTxOs (new locks, consumed locks). Identical
 * polling logic; exposes `AbortSignal` for clean unmount.
 */

import type { CardanoHTLCBrowser } from './cardano-htlc-browser';

export interface CardanoHTLCInfo {
  hashHex: string;
  amountLovelace: bigint;
  deadlineMs: bigint;
  senderPkh: string;
  receiverPkh: string;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });

export async function watchForCardanoLock(
  cardanoHtlc: CardanoHTLCBrowser,
  receiverPkh?: string,
  pollIntervalMs = 10_000,
  hashHex?: string,
  signal?: AbortSignal,
): Promise<CardanoHTLCInfo> {
  const seen = new Set<string>();

  while (!signal?.aborted) {
    try {
      const htlcs = await cardanoHtlc.listHTLCs();

      for (const { utxo, datum } of htlcs) {
        const key = `${utxo.txHash}#${utxo.outputIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (receiverPkh && datum.receiver !== receiverPkh) continue;
        if (hashHex && datum.preimageHash !== hashHex) continue;
        if (datum.deadline <= BigInt(Date.now())) continue;

        return {
          hashHex: datum.preimageHash,
          amountLovelace: utxo.assets.lovelace ?? 0n,
          deadlineMs: datum.deadline,
          senderPkh: datum.sender,
          receiverPkh: datum.receiver,
        };
      }
    } catch {
      /* Blockfrost may be temporarily unavailable */
    }
    await sleep(pollIntervalMs, signal);
  }
  throw new Error('aborted');
}

export async function waitForCardanoHTLCConsumed(
  cardanoHtlc: CardanoHTLCBrowser,
  hashHex: string,
  pollIntervalMs = 10_000,
  signal?: AbortSignal,
): Promise<void> {
  while (!signal?.aborted) {
    try {
      const htlcs = await cardanoHtlc.listHTLCs();
      const found = htlcs.find((h) => h.datum.preimageHash === hashHex);
      if (!found) return;
    } catch {
      /* Blockfrost may be temporarily unavailable */
    }
    await sleep(pollIntervalMs, signal);
  }
  throw new Error('aborted');
}
