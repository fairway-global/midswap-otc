/**
 * Server-side Cardano chain watcher — direction-aware.
 *
 * Transitions handled:
 *
 *   ada-usdc (forward):
 *     alice_claimed        → completed        (taker Withdraw spent the maker's lock)
 *     open | bob_deposited → alice_reclaimed  (maker Reclaim after deadline)
 *
 *   usdc-ada (reverse):
 *     open                 → bob_deposited    (taker lock UTxO appears bound to makerPkh)
 *     bob_deposited        → alice_claimed    (maker Withdraw spent the taker's lock)
 *                                              — also extracts preimage from tx redeemer
 *                                                and PATCHes `midnightPreimage` so the
 *                                                reverse-taker's orchestrator fast-path
 *                                                lights up before Blockfrost.
 *     bob_deposited        → bob_reclaimed    (taker Reclaim after their own deadline)
 *
 * Read-only; no tx submission.
 */

import {
  Data,
  Constr,
  validatorToAddress,
  type Network,
  type SpendingValidator,
} from '@lucid-evolution/lucid';
import { createHash } from 'node:crypto';
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
  inputs: Array<{ tx_hash: string; output_index: number; address?: string; inline_datum?: string | null }>;
}

interface BlockfrostRedeemer {
  purpose: string;
  redeemer_data_hash?: string;
  script_hash?: string;
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

export const resolveCardanoWatcherConfig = (logger: FastifyBaseLogger): CardanoWatcherConfig | null => {
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
    logger.warn({ candidates: candidatePaths }, 'cardano-watcher disabled: cardano/plutus.json not found');
    return null;
  }

  const pollIntervalMs = Number(process.env.CARDANO_POLL_MS ?? 8000);
  return {
    blockfrostUrl,
    blockfrostApiKey: apiKey,
    network: rawNetwork,
    blueprintPath,
    pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs >= 2000 ? pollIntervalMs : 8000,
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

const sha256Hex = (hex: string): string => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = Buffer.from(clean, 'hex');
  return createHash('sha256').update(bytes).digest('hex');
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
        logger.debug({ status: res.status, path }, 'cardano-watcher: Blockfrost non-OK (transient)');
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

  const findSpenderTxHash = async (lockTxHash: string): Promise<string | null> => {
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

  /**
   * Given a tx that spent a script UTxO whose datum contained the target hash,
   * extract the preimage from the Withdraw redeemer. Returns undefined if the
   * tx wasn't a Withdraw or if decoding failed.
   */
  const extractPreimageFromClaimTx = async (spenderTxHash: string, targetHash: string): Promise<string | null> => {
    const redeemers = await bfFetch<BlockfrostRedeemer[]>(`/txs/${spenderTxHash}/redeemers`);
    if (!redeemers) return null;
    const spendRedeemer = redeemers.find((r) => r.purpose === 'spend');
    if (!spendRedeemer?.redeemer_data_hash) return null;

    const datum = await bfFetch<{ cbor: string }>(`/scripts/datum/${spendRedeemer.redeemer_data_hash}/cbor`);
    if (!datum) return null;

    try {
      const parsed = Data.from(datum.cbor) as Constr<string | bigint>;
      if (Number(parsed.index) !== 0) return null; // not Withdraw
      const preimageHex = parsed.fields[0];
      if (typeof preimageHex !== 'string') return null;
      if (sha256Hex(preimageHex) !== targetHash) return null;
      return preimageHex;
    } catch {
      return null;
    }
  };

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;

    const watched = [
      ...store.list({ status: 'open' }),
      ...store.list({ status: 'bob_deposited' }),
      ...store.list({ status: 'alice_claimed' }),
    ];
    if (watched.length === 0) return;

    const utxos = await bfFetch<BlockfrostUtxo[]>(`/addresses/${scriptAddress}/utxos`);
    if (!utxos) return;

    // Build a map of active HTLCs at the script address, keyed by hash.
    const activeByHash = new Map<string, { tx_hash: string; output_index: number; datum: HTLCDatum; lovelace: bigint }>();
    for (const u of utxos) {
      if (!u.inline_datum) continue;
      const datum = decodeDatum(u.inline_datum);
      if (!datum) continue;
      const lovelace = BigInt(u.amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0');
      activeByHash.set(datum.preimageHash, {
        tx_hash: u.tx_hash,
        output_index: u.output_index,
        datum,
        lovelace,
      });
    }

    const now = Date.now();

    for (const swap of watched) {
      if (stopped) return;
      const active = activeByHash.get(swap.hash);

      try {
        if (swap.direction === 'usdm-usdc') {
          // Forward flow. Cardano lock was made by the maker at creation.
          if (!swap.cardanoLockTx) continue; // can't happen in practice but TS is strict
          if (active) continue; // lock still unspent, nothing to do

          if (swap.status === 'alice_claimed') {
            const spenderTx = await findSpenderTxHash(swap.cardanoLockTx);
            store.patch(swap.hash, {
              status: 'completed',
              ...(spenderTx ? { cardanoClaimTx: spenderTx } : {}),
            });
            logger.info(
              { hash: swap.hash.slice(0, 16), claimTx: spenderTx?.slice(0, 16) ?? '(unknown)' },
              'cardano-watcher: alice_claimed → completed (ada-usdc: taker claimed ADA)',
            );
            continue;
          }

          if (swap.status === 'open' || swap.status === 'bob_deposited') {
            if (swap.cardanoDeadlineMs !== null && now < swap.cardanoDeadlineMs) {
              logger.warn(
                { hash: swap.hash.slice(0, 16), status: swap.status },
                'cardano-watcher: lock UTxO vanished before deadline — possible anomaly',
              );
              continue;
            }
            const spenderTx = await findSpenderTxHash(swap.cardanoLockTx);
            store.patch(swap.hash, {
              status: 'alice_reclaimed',
              ...(spenderTx ? { cardanoReclaimTx: spenderTx } : {}),
            });
            logger.info(
              { hash: swap.hash.slice(0, 16), reclaimTx: spenderTx?.slice(0, 16) ?? '(unknown)' },
              'cardano-watcher: → alice_reclaimed (ada-usdc: maker refunded ADA)',
            );
          }
          continue;
        }

        // usdc-ada (reverse). Taker locks Cardano, maker claims Cardano to reveal preimage.
        if (swap.status === 'open') {
          if (!active) continue;
          // Expect the taker's lock to be bound to the maker's own PKH (stored as bobPkh
          // at creation for reverse). Verify before transitioning, to avoid matching
          // stale UTxOs from other swaps at the shared script address.
          if (swap.bobPkh && active.datum.receiver.toLowerCase() !== swap.bobPkh.toLowerCase()) continue;
          store.patch(swap.hash, {
            status: 'bob_deposited',
            cardanoLockTx: active.tx_hash,
            cardanoDeadlineMs: Number(active.datum.deadline),
          });
          logger.info(
            { hash: swap.hash.slice(0, 16), lockTx: active.tx_hash.slice(0, 16) },
            'cardano-watcher: open → bob_deposited (usdc-ada: taker locked ADA)',
          );
          continue;
        }

        if (swap.status === 'bob_deposited' && swap.cardanoLockTx) {
          if (active) continue; // still unspent

          const spenderTx = await findSpenderTxHash(swap.cardanoLockTx);
          if (!spenderTx) {
            logger.debug(
              { hash: swap.hash.slice(0, 16) },
              'cardano-watcher: usdc-ada lock gone but spender not yet found (Blockfrost lag)',
            );
            continue;
          }

          // Try to extract the preimage from the spender's redeemer. If the
          // maker claimed, it's a Withdraw(preimage) and we can relay the
          // preimage to the taker via midnightPreimage. If it's Reclaim, we
          // get null and route to bob_reclaimed.
          const preimage = await extractPreimageFromClaimTx(spenderTx, swap.hash);

          if (preimage) {
            store.patch(swap.hash, {
              status: 'alice_claimed',
              cardanoClaimTx: spenderTx,
              midnightPreimage: preimage,
            });
            logger.info(
              { hash: swap.hash.slice(0, 16), claimTx: spenderTx.slice(0, 16) },
              'cardano-watcher: bob_deposited → alice_claimed (usdc-ada: maker claimed ADA; preimage relayed)',
            );
            continue;
          }

          // No preimage in the spender → it was a Reclaim by the taker.
          if (swap.cardanoDeadlineMs !== null && now < swap.cardanoDeadlineMs) {
            logger.warn(
              { hash: swap.hash.slice(0, 16) },
              'cardano-watcher: usdc-ada lock spent before deadline without a Withdraw redeemer — anomaly',
            );
            continue;
          }
          store.patch(swap.hash, {
            status: 'bob_reclaimed',
            cardanoReclaimTx: spenderTx,
          });
          logger.info(
            { hash: swap.hash.slice(0, 16), reclaimTx: spenderTx.slice(0, 16) },
            'cardano-watcher: bob_deposited → bob_reclaimed (usdc-ada: taker refunded ADA)',
          );
          continue;
        }
      } catch (err) {
        logger.warn({ err, hash: swap.hash.slice(0, 16) }, 'cardano-watcher: swap check failed');
      }
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick()
        .catch((err) => {
          logger.warn({ err: err instanceof Error ? err.message : err }, 'cardano-watcher: tick failed');
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
    'cardano-watcher started (bidirectional)',
  );

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
