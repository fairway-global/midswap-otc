/**
 * Check Cardano Preview balances for all participants in address.json.
 *
 * Usage:
 *   node --loader ts-node/esm src/check-balance.ts
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
    console.error('ERROR: Set BLOCKFROST_API_KEY in .env or as env var');
    process.exit(1);
  }

  const addressPath = path.resolve(scriptDir, '..', 'address.json');
  if (!fs.existsSync(addressPath)) {
    console.error('ERROR: address.json not found. Run generate-keys.ts first.');
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressPath, 'utf-8'));
  const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');

  const provider = new Blockfrost('https://cardano-preprod.blockfrost.io/api/v0', blockfrostApiKey);
  const lucid = await Lucid(provider, 'Preprod');

  console.log('=== Cardano Preprod Balances ===\n');

  for (const [name, wallets] of Object.entries(addresses) as [string, any][]) {
    const { mnemonic, address } = wallets.cardano;

    lucid.selectWallet.fromSeed(mnemonic);
    const utxos = await lucid.wallet().getUtxos();

    let lovelace = 0n;
    for (const utxo of utxos) {
      lovelace += utxo.assets.lovelace ?? 0n;
    }

    const ada = Number(lovelace) / 1_000_000;
    console.log(`${name.toUpperCase()}`);
    console.log(`  Address:  ${address}`);
    console.log(`  Balance:  ${lovelace} lovelace (${ada} ADA)`);
    console.log(`  UTxOs:    ${utxos.length}`);
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
