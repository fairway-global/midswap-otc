/**
 * Send ADA between participants using address.json wallets.
 *
 * Usage:
 *   node --loader ts-node/esm src/send-ada.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

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

async function main() {
  loadEnv();

  const blockfrostApiKey = process.env.BLOCKFROST_API_KEY;
  if (!blockfrostApiKey) {
    console.error('ERROR: Set BLOCKFROST_API_KEY in .env');
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(path.resolve(scriptDir, '..', 'address.json'), 'utf-8'));
  const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');

  const provider = new Blockfrost('https://cardano-preprod.blockfrost.io/api/v0', blockfrostApiKey);
  const lucid = await Lucid(provider, 'Preprod');

  const aliceAddr = addresses.alice.cardano.address;
  const amount = 300_000_000n; // 300 ADA

  // Bob → Alice: 300 ADA
  console.log('Sending 300 ADA from Bob to Alice...');
  lucid.selectWallet.fromSeed(addresses.bob.cardano.mnemonic);
  const tx1 = await lucid.newTx()
    .pay.ToAddress(aliceAddr, { lovelace: amount })
    .complete();
  const signed1 = await tx1.sign.withWallet().complete();
  const hash1 = await signed1.submit();
  console.log(`  Tx submitted: ${hash1}`);

  // Charlie → Alice: 300 ADA
  console.log('Sending 300 ADA from Charlie to Alice...');
  lucid.selectWallet.fromSeed(addresses.charlie.cardano.mnemonic);
  const tx2 = await lucid.newTx()
    .pay.ToAddress(aliceAddr, { lovelace: amount })
    .complete();
  const signed2 = await tx2.sign.withWallet().complete();
  const hash2 = await signed2.submit();
  console.log(`  Tx submitted: ${hash2}`);

  console.log('\nDone. Wait ~20s for confirmation, then run check-balance.ts.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
