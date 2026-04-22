/**
 * Server-side Midnight chain watcher.
 *
 * Polls the HTLC contract's ledger state on an interval and advances swap
 * statuses in the orchestrator DB the moment on-chain evidence appears —
 * independently of whether Bob's or Alice's browser is still open.
 *
 * Transitions handled:
 *   open           → bob_deposited   when htlcAmounts[hash] > 0
 *   bob_deposited  → alice_claimed   when revealedPreimages[hash] is populated
 *
 * All state lives in the DB; this module does NOT submit transactions.
 */

import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { FastifyBaseLogger } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ledger } from '../../contract/src/managed/htlc/contract/index.js';
import type { SwapStore } from './db.js';

export type MidnightNetwork = 'preprod' | 'undeployed';

interface WatcherConfig {
  network: MidnightNetwork;
  indexerUrl: string;
  indexerWsUrl: string;
  htlcContractAddress: ContractAddress;
  pollIntervalMs: number;
}

const PREPROD: Omit<WatcherConfig, 'htlcContractAddress' | 'pollIntervalMs'> = {
  network: 'preprod',
  indexerUrl: 'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
};

const UNDEPLOYED: Omit<WatcherConfig, 'htlcContractAddress' | 'pollIntervalMs'> = {
  network: 'undeployed',
  indexerUrl: 'http://127.0.0.1:8088/api/v3/graphql',
  indexerWsUrl: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
};

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('hex string has odd length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export interface MidnightWatcher {
  stop(): void;
}

interface SwapStateFile {
  htlcContractAddress?: string;
  network?: string;
}

const tryReadSwapState = (logger: FastifyBaseLogger): SwapStateFile | null => {
  const candidates = [
    process.env.SWAP_STATE_PATH,
    resolve(process.cwd(), '..', 'htlc-ft-cli', 'swap-state.json'),
    resolve(process.cwd(), 'htlc-ft-cli', 'swap-state.json'),
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as SwapStateFile;
      logger.info({ path }, 'midnight-watcher: loaded contract address from swap-state.json');
      return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
};

export const resolveWatcherConfig = (logger: FastifyBaseLogger): WatcherConfig | null => {
  const fileState = tryReadSwapState(logger);
  const rawNetwork = (process.env.MIDNIGHT_NETWORK ?? fileState?.network ?? '').toLowerCase();
  const htlcAddr = process.env.HTLC_CONTRACT_ADDRESS ?? fileState?.htlcContractAddress;

  if (!rawNetwork || !htlcAddr) {
    logger.warn(
      {
        hasNetwork: Boolean(rawNetwork),
        hasContractAddress: Boolean(htlcAddr),
      },
      'midnight-watcher disabled: set MIDNIGHT_NETWORK + HTLC_CONTRACT_ADDRESS (or place swap-state.json next to the orchestrator) to enable',
    );
    return null;
  }

  const base = rawNetwork === 'preprod' ? PREPROD : rawNetwork === 'undeployed' ? UNDEPLOYED : null;
  if (!base) {
    logger.error({ rawNetwork }, 'unsupported MIDNIGHT_NETWORK; watcher disabled');
    return null;
  }

  const pollIntervalMs = Number(process.env.MIDNIGHT_POLL_MS ?? 4000);
  return {
    ...base,
    htlcContractAddress: htlcAddr as ContractAddress,
    pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs >= 1000 ? pollIntervalMs : 4000,
  };
};

export const startMidnightWatcher = (
  store: SwapStore,
  cfg: WatcherConfig,
  logger: FastifyBaseLogger,
): MidnightWatcher => {
  setNetworkId(cfg.network);

  const publicDataProvider = indexerPublicDataProvider(cfg.indexerUrl, cfg.indexerWsUrl);
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;

    const openSwaps = store.list({ status: 'open' });
    const depositedSwaps = store.list({ status: 'bob_deposited' });

    if (openSwaps.length === 0 && depositedSwaps.length === 0) return;

    let state;
    try {
      state = await publicDataProvider.queryContractState(cfg.htlcContractAddress);
    } catch (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : err },
        'midnight-watcher: queryContractState failed (transient)',
      );
      return;
    }
    if (!state) return;

    let decoded;
    try {
      decoded = ledger(state.data);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        'midnight-watcher: ledger decode failed; check HTLC_CONTRACT_ADDRESS matches the running network',
      );
      return;
    }

    for (const swap of openSwaps) {
      if (stopped) return;
      try {
        const hashBytes = hexToBytes(swap.hash);
        if (decoded.htlcAmounts.member(hashBytes) && decoded.htlcAmounts.lookup(hashBytes) > 0n) {
          const updated = store.patch(swap.hash, { status: 'bob_deposited' });
          if (updated) {
            logger.info(
              { hash: swap.hash.slice(0, 16) },
              'midnight-watcher: open → bob_deposited (on-chain deposit observed)',
            );
          }
        }
      } catch (err) {
        logger.warn({ err, hash: swap.hash.slice(0, 16) }, 'midnight-watcher: open-swap check failed');
      }
    }

    for (const swap of depositedSwaps) {
      if (stopped) return;
      try {
        const hashBytes = hexToBytes(swap.hash);
        if (!decoded.revealedPreimages.member(hashBytes)) continue;
        if (swap.midnightPreimage) continue;

        const preimage = decoded.revealedPreimages.lookup(hashBytes);
        const preimageHex = bytesToHex(preimage);
        const updated = store.patch(swap.hash, {
          status: 'alice_claimed',
          midnightPreimage: preimageHex,
        });
        if (updated) {
          logger.info(
            { hash: swap.hash.slice(0, 16) },
            'midnight-watcher: bob_deposited → alice_claimed (preimage revealed on-chain)',
          );
        }
      } catch (err) {
        logger.warn({ err, hash: swap.hash.slice(0, 16) }, 'midnight-watcher: deposited-swap check failed');
      }
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick()
        .catch((err) => {
          logger.warn({ err: err instanceof Error ? err.message : err }, 'midnight-watcher: tick failed');
        })
        .finally(schedule);
    }, cfg.pollIntervalMs);
  };

  logger.info(
    {
      network: cfg.network,
      indexer: cfg.indexerUrl,
      contract: cfg.htlcContractAddress.slice(0, 16),
      pollMs: cfg.pollIntervalMs,
    },
    'midnight-watcher started',
  );

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
