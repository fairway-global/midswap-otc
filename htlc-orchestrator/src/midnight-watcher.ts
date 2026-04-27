/**
 * Server-side Midnight chain watcher — direction-aware.
 *
 * Transitions handled:
 *
 *   ada-usdc (forward):
 *     open           → bob_deposited   when htlcAmounts[hash] > 0 (taker deposited)
 *     bob_deposited  → alice_claimed   when revealedPreimages[hash] populated
 *     bob_deposited  → bob_reclaimed   when amount=0 without preimage (taker refunded)
 *
 *   usdc-ada (reverse):
 *     (swap enters DB already `open` with amount > 0 — maker deposited at creation)
 *     bob_deposited  → completed       when amount=0 AND preimage revealed (taker claimed)
 *     open|bob_dep.  → alice_reclaimed when amount=0 without preimage post-deadline (maker refunded)
 *     — preimage reveal on Cardano is observed by the cardano-watcher, not here.
 *
 * This module does NOT submit transactions.
 */

import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { FastifyBaseLogger } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ledger } from './generated/htlc/index.js';
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

    const watched = [
      ...store.list({ status: 'open' }),
      ...store.list({ status: 'bob_deposited' }),
    ];

    if (watched.length === 0) return;

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

    const now = Date.now();

    for (const swap of watched) {
      if (stopped) return;
      try {
        const hashBytes = hexToBytes(swap.hash);
        const hasEntry = decoded.htlcAmounts.member(hashBytes);
        const amount = hasEntry ? decoded.htlcAmounts.lookup(hashBytes) : 0n;
        const hasPreimage = decoded.revealedPreimages.member(hashBytes);

        if (swap.direction === 'usdm-usdc') {
          // Forward flow. Taker deposits on Midnight, maker claims on Midnight.
          if (swap.status === 'open') {
            if (hasEntry && amount > 0n) {
              store.patch(swap.hash, { status: 'bob_deposited' });
              logger.info(
                { hash: swap.hash.slice(0, 16) },
                'midnight-watcher: open → bob_deposited (ada-usdc: taker deposit observed)',
              );
            }
            continue;
          }
          // bob_deposited
          if (hasPreimage && !swap.midnightPreimage) {
            const preimage = bytesToHex(decoded.revealedPreimages.lookup(hashBytes));
            store.patch(swap.hash, { status: 'alice_claimed', midnightPreimage: preimage });
            logger.info(
              { hash: swap.hash.slice(0, 16) },
              'midnight-watcher: bob_deposited → alice_claimed (ada-usdc: preimage revealed on Midnight)',
            );
            continue;
          }
          if (hasEntry && amount === 0n && !hasPreimage) {
            store.patch(swap.hash, { status: 'bob_reclaimed' });
            logger.info(
              { hash: swap.hash.slice(0, 16) },
              'midnight-watcher: bob_deposited → bob_reclaimed (ada-usdc: no preimage; taker refunded)',
            );
          }
          continue;
        }

        // usdc-ada (reverse). Maker deposited on Midnight at creation; the
        // Cardano watcher drives bob_deposited (taker locked ADA) and
        // alice_claimed (maker claimed ADA on Cardano, preimage in redeemer).
        // Here we only care about:
        //   1. taker's final Midnight claim (completed)
        //   2. maker's Midnight reclaim post-deadline (alice_reclaimed)
        if (hasEntry && amount === 0n) {
          if (hasPreimage) {
            // Taker claimed USDC on Midnight using the preimage learned from Cardano.
            const preimage = bytesToHex(decoded.revealedPreimages.lookup(hashBytes));
            store.patch(swap.hash, {
              status: 'completed',
              midnightPreimage: swap.midnightPreimage ?? preimage,
            });
            logger.info(
              { hash: swap.hash.slice(0, 16) },
              'midnight-watcher: → completed (usdc-ada: taker claimed USDC on Midnight)',
            );
          } else if (swap.midnightDeadlineMs !== null && now >= swap.midnightDeadlineMs) {
            // Amount is zero with no preimage post-deadline — maker reclaimed.
            store.patch(swap.hash, { status: 'alice_reclaimed' });
            logger.info(
              { hash: swap.hash.slice(0, 16) },
              'midnight-watcher: → alice_reclaimed (usdc-ada: maker refunded USDC)',
            );
          }
        }
      } catch (err) {
        logger.warn({ err, hash: swap.hash.slice(0, 16) }, 'midnight-watcher: swap check failed');
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
    'midnight-watcher started (bidirectional)',
  );

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
