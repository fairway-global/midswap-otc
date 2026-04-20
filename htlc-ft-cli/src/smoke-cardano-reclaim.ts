/**
 * Smoke test for Cardano HTLC reclaim path.
 * Alice locks tiny ADA with a short deadline, waits past expiry, reclaims.
 *
 * Usage: npx tsx src/smoke-cardano-reclaim.ts
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createLogger } from './logger-utils.js';
import { CardanoHTLC } from './cardano-htlc';

const LOCK_LOVELACE = 2_000_000n; // 2 ADA
const DEADLINE_SECS = 90;         // short but lucid-validateable
const POLL_INTERVAL_MS = 10_000;
const CONFIRM_TIMEOUT_MS = 180_000; // 3 min max wait for lock confirmation
const RECLAIM_CONFIRM_MS = 120_000; // 2 min max wait for reclaim confirmation

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

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

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function waitForLockConfirmed(htlc: CardanoHTLC, hashHex: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < CONFIRM_TIMEOUT_MS) {
    const found = await htlc.findHTLCUtxo(hashHex);
    if (found) {
      console.log(`  Lock confirmed after ${Math.round((Date.now() - start) / 1000)}s`);
      return;
    }
    console.log(`  Waiting for lock confirmation... (${Math.round((Date.now() - start) / 1000)}s)`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Lock not confirmed within ${CONFIRM_TIMEOUT_MS / 1000}s`);
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
    console.error('ERROR: set BLOCKFROST_API_KEY in .env');
    process.exit(1);
  }

  const addresses = JSON.parse(
    fs.readFileSync(path.resolve(scriptDir, '..', 'address.json'), 'utf-8'),
  );

  const logDir = path.resolve(
    scriptDir,
    '..',
    'logs',
    'smoke-cardano-reclaim',
    `${new Date().toISOString()}.log`,
  );
  const logger = await createLogger(logDir);

  console.log('▶ Smoke test: Cardano HTLC reclaim-after-expiry\n');

  const htlc = await CardanoHTLC.init(
    {
      blockfrostUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
      blockfrostApiKey,
      network: 'Preprod',
      blueprintPath: path.resolve(scriptDir, '..', '..', 'cardano', 'plutus.json'),
    },
    logger,
  );
  htlc.selectWalletFromSeed(addresses.alice.cardano.mnemonic);

  const balanceBefore = await htlc.getBalance();
  console.log(`Alice balance before: ${Number(balanceBefore) / 1e6} ADA`);

  const preimage = crypto.randomBytes(32);
  const hashHex = sha256Hex(preimage);
  const deadlineMs = BigInt(Date.now() + DEADLINE_SECS * 1000);

  console.log(`Locking ${Number(LOCK_LOVELACE) / 1e6} ADA (hash=${hashHex.slice(0, 16)}…, deadline in ${DEADLINE_SECS}s)…`);
  const receiverPkh = addresses.bob.cardano.paymentKeyHash;
  const lockTx = await htlc.lock(LOCK_LOVELACE, hashHex, receiverPkh, deadlineMs);
  console.log(`  Lock tx: ${lockTx}`);

  await waitForLockConfirmed(htlc, hashHex);

  const waitMs = Number(deadlineMs) - Date.now() + 15_000;
  console.log(`Waiting ${Math.max(0, Math.round(waitMs / 1000))}s for deadline + buffer…`);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

  console.log('Reclaiming after deadline…');
  const reclaimTx = await htlc.reclaim(hashHex);
  console.log(`  Reclaim tx: ${reclaimTx}`);

  await waitForReclaim(htlc, hashHex);

  const balanceAfter = await htlc.getBalance();
  const delta = balanceBefore - balanceAfter;
  console.log(`Alice balance after:  ${Number(balanceAfter) / 1e6} ADA`);
  console.log(`Net cost (fees only): ${Number(delta) / 1e6} ADA`);

  if (delta > LOCK_LOVELACE / 2n) {
    throw new Error(
      `Balance delta too large: ${delta} lovelace. Expected fees only (~0.5 ADA), got ${Number(delta) / 1e6} ADA.`,
    );
  }

  console.log('\n✓ Cardano reclaim smoke test passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n✗ Cardano reclaim smoke FAILED:', e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
