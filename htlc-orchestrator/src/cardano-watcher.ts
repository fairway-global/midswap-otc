/**
 * Server-side Cardano chain watcher.
 *
 * Uses Blockfrost to observe the HTLC script address and advance swap
 * statuses when the Cardano lock UTxO is consumed (claimed or reclaimed).
 *
 * Transitions handled:
 *   alice_claimed           → completed         (Bob's Withdraw spent the lock)
 *   open | bob_deposited    → alice_reclaimed   (Alice's Reclaim spent the lock, post-deadline)
 *
 * We do NOT submit Cardano transactions — this module is read-only.
 */

import {
  Data,
  Constr,
  validatorToAddress,
  type Network,
  type SpendingValidator,
} from '@lucid-evolution/lucid';
import type { FastifyBaseLogger } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SwapStore } from './db.js';

interface HTLCDatum {
  preimageHash: string;
  sender: string;
  receiver: string;
  deadline: bigint;
}

const decodeDatum = (cbor: string): HTLCDatum | null => {
  try {
    const constr = Data.from(cbor) as Constr<string | bigint>;
    return {
      preimageHash: constr.fields[0] as string,
      sender: constr.fields[1] as string,
      receiver: constr.fields[2] as string,
      deadline: constr.fields[3] as bigint,
    };
  } catch {
    return null;
  }
};

interface BlockfrostUtxo {
  tx_hash: string;
  output_index: number;
  amount: Array<{ unit: string; quantity: string }>;
  inline_datum: string | null;
  data_hash: string | null;
}

interface BlockfrostAddressTx {
  tx_hash: string;
  block_height: number;
  block_time: number;
}

interface BlockfrostTxUtxos {
  hash: string;
  inputs: Array<{ tx_hash: string; output_index: number }>;
}

export interface CardanoWatcherConfig {
  blockfrostUrl: string;
  blockfrostApiKey: string;
  network: Network;
  blueprintPath: string;
  pollIntervalMs: number;
}

export interface CardanoWatcher {
  stop(): void;
}

const loadEnvFromFile = (path: string): void => {
  try {
    const contents = readFileSync(path, 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* no file, skip */
  }
};

export const resolveCardanoWatcherConfig = (
  logger: FastifyBaseLogger,
): CardanoWatcherConfig | null => {
  loadEnvFromFile(resolve(process.cwd(), '..', 'htlc-ft-cli', '.env'));
  loadEnvFromFile(resolve(process.cwd(), '.env'));

  const apiKey = process.env.BLOCKFROST_API_KEY;
  if (!apiKey) {
    logger.warn('cardano-watcher disabled: no BLOCKFROST_API_KEY');
    return null;
  }

  const rawNetwork = (process.env.CARDANO_NETWORK ?? 'Preprod') as Network;
  const blockfrostUrl =
    process.env.BLOCKFROST_URL ??
    (rawNetwork === 'Preprod'
      ? 'https://cardano-preprod.blockfrost.io/api/v0'
      : rawNetwork === 'Preview'
        ? 'https://cardano-preview.blockfrost.io/api/v0'
        : 'https://cardano-mainnet.blockfrost.io/api/v0');

  const candidatePaths = [
    process.env.CARDANO_BLUEPRINT_PATH,
    resolve(process.cwd(), '..', 'cardano', 'plutus.json'),
    resolve(process.cwd(), 'cardano', 'plutus.json'),
  ].filter((p): p is string => Boolean(p));

  let blueprintPath: string | null = null;
  for (const p of candidatePaths) {
    try {
      readFileSync(p, 'utf8');
      blueprintPath = p;
      break;
    } catch {
      /* next */
    }
  }
  if (!blueprintPath) {
    logger.warn(
      { candidates: candidatePaths },
      'cardano-watcher disabled: cardano/plutus.json not found',
    );
    return null;
  }

  const pollIntervalMs = Number(process.env.CARDANO_POLL_MS ?? 8000);
  return {
    blockfrostUrl,
    blockfrostApiKey: apiKey,
    network: rawNetwork,
    blueprintPath,
    pollIntervalMs:
      Number.isFinite(pollIntervalMs) && pollIntervalMs >= 2000 ? pollIntervalMs : 8000,
  };
};

const loadValidator = (blueprintPath: string): SpendingValidator => {
  const blueprint = JSON.parse(readFileSync(blueprintPath, 'utf8')) as {
    validators: Array<{ title: string; compiledCode: string }>;
  };
  const v = blueprint.validators.find((x) => x.title === 'htlc.htlc.spend');
  if (!v) throw new Error('htlc.htlc.spend validator not found in blueprint');
  return { type: 'PlutusV3', script: v.compiledCode };
};

export const startCardanoWatcher = (
  store: SwapStore,
  cfg: CardanoWatcherConfig,
  logger: FastifyBaseLogger,
): CardanoWatcher => {
  const validator = loadValidator(cfg.blueprintPath);
  const scriptAddress = validatorToAddress(cfg.network, validator);

  const bfFetch = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(`${cfg.blockfrostUrl}${path}`, {
        headers: { project_id: cfg.blockfrostApiKey },
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        logger.debug(
          { status: res.status, path },
          'cardano-watcher: Blockfrost non-OK (transient)',
        );
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : err, path },
        'cardano-watcher: Blockfrost fetch failed (transient)',
      );
      return null;
    }
  };

  const findSpenderTxHash = async (
    lockTxHash: string,
  ): Promise<string | null> => {
    const lockOutputs = await bfFetch<BlockfrostTxUtxos>(`/txs/${lockTxHash}/utxos`);
    if (!lockOutputs) return null;
    const addrTxs = await bfFetch<BlockfrostAddressTx[]>(
      `/addresses/${scriptAddress}/transactions?order=desc&count=40`,
    );
    if (!addrTxs) return null;

    for (const tx of addrTxs) {
      if (tx.tx_hash === lockTxHash) continue;
      const spendCandidate = await bfFetch<BlockfrostTxUtxos>(`/txs/${tx.tx_hash}/utxos`);
      if (!spendCandidate) continue;
      if (spendCandidate.inputs.some((i) => i.tx_hash === lockTxHash)) {
        return tx.tx_hash;
      }
    }
    return null;
  };

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;

    const watched = [
      ...store.list({ status: 'open' }),
      ...store.list({ status: 'bob_deposited' }),
      ...store.list({ status: 'alice_claimed' }),
    ].filter((s) => s.cardanoLockTx);

    if (watched.length === 0) return;

    const utxos = await bfFetch<BlockfrostUtxo[]>(`/addresses/${scriptAddress}/utxos`);
    if (!utxos) return;

    const activeHashes = new Set<string>();
    for (const u of utxos) {
      if (!u.inline_datum) continue;
      const datum = decodeDatum(u.inline_datum);
      if (datum) activeHashes.add(datum.preimageHash);
    }

    const now = Date.now();

    for (const swap of watched) {
      if (stopped) return;
      if (activeHashes.has(swap.hash)) continue;

      if (swap.status === 'alice_claimed') {
        const spenderTx = await findSpenderTxHash(swap.cardanoLockTx);
        const updated = store.patch(swap.hash, {
          status: 'completed',
          ...(spenderTx ? { cardanoClaimTx: spenderTx } : {}),
        });
        if (updated) {
          logger.info(
            { hash: swap.hash.slice(0, 16), claimTx: spenderTx?.slice(0, 16) ?? '(unknown)' },
            'cardano-watcher: alice_claimed → completed (Bob claimed ADA on Cardano)',
          );
        }
        continue;
      }

      if (swap.status === 'open' || swap.status === 'bob_deposited') {
        if (now < swap.cardanoDeadlineMs) {
          logger.warn(
            { hash: swap.hash.slice(0, 16), status: swap.status },
            'cardano-watcher: lock UTxO vanished before deadline — possible anomaly',
          );
          continue;
        }
        const spenderTx = await findSpenderTxHash(swap.cardanoLockTx);
        const updated = store.patch(swap.hash, {
          status: 'alice_reclaimed',
          ...(spenderTx ? { cardanoReclaimTx: spenderTx } : {}),
        });
        if (updated) {
          logger.info(
            {
              hash: swap.hash.slice(0, 16),
              reclaimTx: spenderTx?.slice(0, 16) ?? '(unknown)',
            },
            'cardano-watcher: open/bob_deposited → alice_reclaimed (ADA refunded to Alice)',
          );
        }
      }
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick()
        .catch((err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : err },
            'cardano-watcher: tick failed',
          );
        })
        .finally(schedule);
    }, cfg.pollIntervalMs);
  };

  logger.info(
    {
      network: cfg.network,
      scriptAddress: scriptAddress.slice(0, 32),
      blockfrost: cfg.blockfrostUrl,
      pollMs: cfg.pollIntervalMs,
    },
    'cardano-watcher started',
  );

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
