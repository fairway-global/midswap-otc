/**
 * Alice's Cardano USDM reclaim — recover USDM locked on the Cardano HTLC after
 * Alice's Cardano deadline passes without Bob having claimed.
 *
 * Usage:
 *   npx tsx src/reclaim-usdm.ts                 # reads hash from pending-swap.json
 *   npx tsx src/reclaim-usdm.ts --hash <hex>    # explicit hash
 *   npx tsx src/reclaim-usdm.ts --pending <path-to-pending-swap.json>
 *   SWAP_HASH=<hex> npx tsx src/reclaim-usdm.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from './logger-utils.js';
import { CardanoHTLC } from './cardano-htlc';

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');
const POLL_INTERVAL_MS = 10_000;
const RECLAIM_CONFIRM_MS = 180_000;

function loadEnv(): void {
  const envPath = path.resolve(scriptDir, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

function resolveHashHex(): string {
  const cli = getArg('--hash');
  if (cli) return cli;
  if (process.env.SWAP_HASH) return process.env.SWAP_HASH;
  const pendingArg = getArg('--pending');
  const pendingPath = pendingArg
    ? path.resolve(pendingArg)
    : path.resolve(scriptDir, '..', 'pending-swap.json');
  if (fs.existsSync(pendingPath)) {
    const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
    if (typeof pending.hashHex === 'string') return pending.hashHex;
  }
  console.error(
    'ERROR: no hash provided. Pass --hash <hex>, --pending <path>, set SWAP_HASH, ' +
      'or ensure pending-swap.json has hashHex.',
  );
  process.exit(1);
}

async function waitForReclaim(htlc: CardanoHTLC, hashHex: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < RECLAIM_CONFIRM_MS) {
    const found = await htlc.findHTLCUtxo(hashHex);
    if (!found) {
      console.log(`  Reclaim confirmed after ${Math.round((Date.now() - start) / 1000)}s`);
      return;
    }
    console.log(`  Waiting for reclaim confirmation... (${Math.round((Date.now() - start) / 1000)}s)`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Reclaim not confirmed within ${RECLAIM_CONFIRM_MS / 1000}s`);
}

async function main() {
  loadEnv();

  const blockfrostApiKey = process.env.BLOCKFROST_API_KEY;
  if (!blockfrostApiKey) {
    console.error('ERROR: Set BLOCKFROST_API_KEY in .env');
    process.exit(1);
  }

  const addressPath = path.resolve(scriptDir, '..', 'address.json');
  const addresses = JSON.parse(fs.readFileSync(addressPath, 'utf-8'));
  const aliceMnemonic = addresses.alice.cardano.mnemonic;
  if (!aliceMnemonic) {
    console.error('ERROR: alice.cardano.mnemonic not found in address.json');
    process.exit(1);
  }

  const hashHex = resolveHashHex();
  if (hashHex.length !== 64) {
    console.error(`ERROR: hash must be 64 hex chars, got ${hashHex.length}: ${hashHex}`);
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       ALICE — Cardano USDM Reclaim (after deadline)      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`Hash: ${hashHex}\n`);

  const logDir = path.resolve(scriptDir, '..', 'logs', 'reclaim-usdm', `${new Date().toISOString()}.log`);
  const logger = await createLogger(logDir);

  console.log('Building Cardano wallet...');
  const htlc = await CardanoHTLC.init(
    {
      blockfrostUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
      blockfrostApiKey,
      network: 'Preprod' as const,
      blueprintPath: path.resolve(scriptDir, '..', '..', 'cardano', 'plutus.json'),
    },
    logger,
  );
  htlc.selectWalletFromSeed(aliceMnemonic);
  const balanceBefore = await htlc.getBalance();
  console.log(`ADA balance before: ${Number(balanceBefore) / 1e6} ADA (for fees & min-UTxO)\n`);

  console.log('── Locating HTLC UTxO ──');
  const utxo = await htlc.findHTLCUtxo(hashHex);
  if (!utxo) {
    console.error(
      `ERROR: no HTLC UTxO at script address for hash ${hashHex.slice(0, 16)}... ` +
        '(already claimed/reclaimed, or never existed).',
    );
    process.exit(1);
  }
  console.log(`  Found UTxO: ${utxo.txHash}#${utxo.outputIndex}`);
  console.log(
    `  Assets:     ${JSON.stringify(
      Object.fromEntries(Object.entries(utxo.assets).map(([k, v]) => [k, v.toString()])),
    )}`,
  );

  console.log('\n── Submitting reclaim ──');
  const reclaimTxHash = await htlc.reclaim(hashHex);
  console.log(`Reclaim tx: ${reclaimTxHash}`);

  console.log('\nWaiting for on-chain confirmation...');
  await waitForReclaim(htlc, hashHex);

  const balanceAfter = await htlc.getBalance();
  console.log(`ADA balance after:  ${Number(balanceAfter) / 1e6} ADA`);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║               USDM RECLAIM COMPLETE                     ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Assets reclaimed back to wallet (USDM + min-UTxO ADA)`);
  console.log(`║  Hash:      ${hashHex.slice(0, 32)}...`);
  console.log(`║  Tx:        ${reclaimTxHash}`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  process.exit(0);
}

main().catch((e) => {
  console.error('USDM reclaim failed:', e);
  process.exit(1);
});
